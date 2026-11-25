#!/usr/bin/env node
/**
 * ACP driver spike (docs/research/acp.md). A minimal Agent Client Protocol *client* that forwards what an
 * agent does to the codehud HUD:
 *   tool_call / tool_call_update locations  -> POST /api/focus  (presence, no zoom)
 *   session/request_permission              -> POST /api/questions, long-poll, reply with the chosen option
 *   agent_message_chunk                     -> POST /api/notes (one note per turn)
 *
 *   node packages/acp-spike/src/index.ts                       # in-process stub agent: one tool call + one permission request
 *   node packages/acp-spike/src/index.ts --agent "gemini --acp" --cwd C:/path/app --prompt "fix the webhook"
 *
 * Needs a running codehud server (reads server.json from CODEHUD_HOME or ~/.codehud).
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { Readable, Writable } from 'node:stream';
import { agent, client, methods, ndJsonStream, type AgentApp } from '@agentclientprotocol/sdk';
import type * as acp from '@agentclientprotocol/sdk';
import type { Question, ServerInfo } from '../../schema/src/protocol.ts';

// ---------------------------------------------------------------------------
// codehud server client
// ---------------------------------------------------------------------------
const INFO_FILE = path.join(process.env.CODEHUD_HOME ? path.resolve(process.env.CODEHUD_HOME) : path.join(os.homedir(), '.codehud'), 'server.json');
const info: ServerInfo = JSON.parse(fs.readFileSync(INFO_FILE, 'utf8'));
async function api<T = any>(method: string, route: string, body?: unknown, timeoutMs = 35_000): Promise<T> {
  const r = await fetch(info.url + route, {
    method,
    headers: { authorization: `Bearer ${info.token}`, ...(body !== undefined ? { 'content-type': 'application/json' } : {}) },
    body: body !== undefined ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(timeoutMs),
  });
  const text = await r.text();
  const data = text ? JSON.parse(text) : null;
  if (!r.ok) throw new Error(data?.error ?? `${r.status} ${route}`);
  return data as T;
}

const args = process.argv.slice(2);
const opt = (k: string) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : undefined; };
const AGENT_CMD = opt('--agent');
const CWD = path.resolve(opt('--cwd') ?? process.cwd());
const PROMPT = opt('--prompt') ?? 'Make the Stripe webhook idempotent.';

// ---------------------------------------------------------------------------
// The codehud ACP client: every ACP callback becomes a HUD call
// ---------------------------------------------------------------------------
let hudSession = 'acp';
let turnText = '';

const hud = client({ name: 'codehud', version: '0.0.1' } as any)
  .onNotification(methods.client.session.update, async ({ params }) => {
    const u = params.update as any;
    if ((u.sessionUpdate === 'tool_call' || u.sessionUpdate === 'tool_call_update') && u.locations?.length) {
      await api('POST', '/api/focus', { files: u.locations.map((l: acp.ToolCallLocation) => l.path), source: 'hook', zoom: false, session: hudSession, note: u.title ?? u.kind ?? 'tool call' }).catch(() => {});
    }
    if (u.sessionUpdate === 'agent_message_chunk' && u.content?.type === 'text') turnText += u.content.text;
  })
  .onRequest(methods.client.session.requestPermission, async ({ params }) => {
    const tc = params.toolCall;
    const files = (tc.locations ?? []).map((l) => ({ path: l.path }));
    const q: Question = await api('POST', '/api/questions', {
      question: tc.title ?? `Allow ${tc.kind ?? 'this tool call'}?`,
      context: [`The agent asks permission for a **${tc.kind ?? 'tool'}** call.`, files.length ? `Files: ${files.map((f) => `\`${f.path}\``).join(', ')}` : ''].filter(Boolean).join('\n\n'),
      files,
      options: params.options.map((o) => ({ id: o.optionId, label: o.name, description: o.kind.replace('_', ' '), files: files.map((f) => f.path) })),
      allowFreeText: false,
      session: hudSession,
      agent: 'acp',
    });
    let cur = q;
    while (cur.status === 'pending') cur = await api('GET', `/api/questions/${q.id}?wait=25000`);
    const picked = params.options.find((o) => o.optionId === cur.answer?.optionId);
    const outcome: acp.RequestPermissionOutcome = cur.status === 'answered' && picked ? { outcome: 'selected', optionId: picked.optionId } : { outcome: 'cancelled' };
    return { outcome };
  });

// ---------------------------------------------------------------------------
// A stub agent for the in-process demo: one turn = presence + one permission request
// ---------------------------------------------------------------------------
function stubAgent(): AgentApp {
  const sessionId = 'sess_stub_1';
  return agent({ name: 'stub-agent', version: '0.0.1' } as any)
    .onRequest(methods.agent.initialize, async () => ({ protocolVersion: 1, agentCapabilities: {} }))
    .onRequest(methods.agent.session.new, async () => ({ sessionId }))
    .onRequest(methods.agent.session.prompt, async ({ client: c }) => {
      const locations: acp.ToolCallLocation[] = [{ path: path.join(CWD, 'src/pages/api/webhooks/stripe.ts'), line: 12 }];
      await c.notify(methods.client.session.update, { sessionId, update: { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: 'Looking at the webhook route first. ' } } });
      await c.notify(methods.client.session.update, { sessionId, update: { sessionUpdate: 'tool_call', toolCallId: 'call_1', title: 'Add idempotency guard to the Stripe webhook', kind: 'edit', status: 'pending', locations } });
      const perm = await c.request(methods.client.session.requestPermission, {
        sessionId,
        toolCall: { toolCallId: 'call_1', title: 'Add idempotency guard to the Stripe webhook', kind: 'edit', locations },
        options: [
          { optionId: 'allow', name: 'Allow this edit', kind: 'allow_once' },
          { optionId: 'always', name: 'Allow edits here for the session', kind: 'allow_always' },
          { optionId: 'reject', name: 'Reject', kind: 'reject_once' },
        ],
      });
      const granted = perm.outcome.outcome === 'selected' && perm.outcome.optionId !== 'reject';
      await c.notify(methods.client.session.update, { sessionId, update: { sessionUpdate: 'tool_call_update', toolCallId: 'call_1', status: granted ? 'completed' : 'failed', locations } });
      await c.notify(methods.client.session.update, { sessionId, update: { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: granted ? 'Edit applied.' : 'Skipped the edit as asked.' } } });
      return { stopReason: 'end_turn' };
    });
}

// ---------------------------------------------------------------------------
async function main() {
  await api('POST', '/api/sessions', { id: hudSession, label: AGENT_CMD ? `acp: ${AGENT_CMD.split(' ')[0]}` : 'acp stub', cwd: CWD, status: 'working' });

  const target = AGENT_CMD ? spawnAgent(AGENT_CMD) : stubAgent();
  await hud.connectWith(target as any, async (a) => {
    const init = await a.request(methods.agent.initialize, { protocolVersion: 1, clientCapabilities: { fs: { readTextFile: false, writeTextFile: false }, terminal: false } });
    console.log(`[acp] agent protocol v${init.protocolVersion}`);
    const s = await a.request(methods.agent.session.new, { cwd: CWD, mcpServers: [] });
    hudSession = `acp-${s.sessionId}`;
    await api('POST', '/api/sessions', { id: hudSession, label: AGENT_CMD ? `acp: ${AGENT_CMD.split(' ')[0]}` : 'acp stub', cwd: CWD, status: 'working' });
    console.log(`[acp] session ${s.sessionId}; prompting: ${PROMPT}`);
    const r = await a.request(methods.agent.session.prompt, { sessionId: s.sessionId, prompt: [{ type: 'text', text: PROMPT }] });
    if (turnText.trim()) await api('POST', '/api/notes', { text: turnText.trim().slice(0, 500), session: hudSession }).catch(() => {});
    console.log(`[acp] turn ended: ${r.stopReason}${turnText ? `\n${turnText}` : ''}`);
  });
  await api('POST', '/api/sessions', { id: hudSession, status: 'idle' }).catch(() => {});
}

/** Spawn a real ACP agent over stdio and wrap it as an ACP stream. */
function spawnAgent(cmd: string) {
  const [bin, ...rest] = cmd.split(' ');
  const child = spawn(bin, rest, { cwd: CWD, stdio: ['pipe', 'pipe', 'inherit'], shell: process.platform === 'win32' });
  child.on('exit', (code) => { if (code) console.error(`[acp] agent exited with ${code}`); });
  return ndJsonStream(Writable.toWeb(child.stdin!) as WritableStream<Uint8Array>, Readable.toWeb(child.stdout!) as ReadableStream<Uint8Array>);
}

main().catch((e) => { console.error(e); process.exit(1); });
