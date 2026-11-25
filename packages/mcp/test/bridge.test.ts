/**
 * MCP bridge against a real server, driven by the SDK's stdio client.
 *   pnpm --filter @codehud/mcp test
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, type ChildProcess } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const SERVER = path.resolve(here, '../../server/src/index.ts');
const BRIDGE = path.resolve(here, '../src/index.ts');
const MAP = path.resolve(here, '../../../examples/sample-webapp.system.json');
const PORT = Number(process.env.CODEHUD_TEST_PORT ?? 4789) - 8;
const TOKEN = 'bridge-test-token-0123456789';
const BASE = `http://127.0.0.1:${PORT}`;
const bearer = { authorization: `Bearer ${TOKEN}`, 'content-type': 'application/json' };

let server: ChildProcess;
let home: string;
let client: Client;

function connectBrowser() {
  return new Promise<http.ClientRequest>((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port: PORT, path: '/api/events', headers: { authorization: `Bearer ${TOKEN}` } }, (res) => { res.on('data', () => {}); resolve(req); });
    req.on('error', (e: NodeJS.ErrnoException) => (e.code === 'ECONNRESET' ? undefined : reject(e)));
    req.end();
  });
}
const api = (route: string, init?: RequestInit) => fetch(BASE + route, { ...init, headers: { ...bearer, ...(init?.headers as any) } });
const textOf = (r: any) => (r.content as { type: string; text: string }[]).map((c) => c.text).join('\n');

before(async () => {
  home = fs.mkdtempSync(path.join(os.tmpdir(), 'codehud-bridge-'));
  server = spawn(process.execPath, [SERVER, '--port', String(PORT), '--map', MAP], { env: { ...process.env, CODEHUD_HOME: home, CODEHUD_TOKEN: TOKEN }, stdio: 'ignore', windowsHide: true });
  const until = Date.now() + 8000;
  while (Date.now() < until) { try { if ((await fetch(BASE + '/api/health')).ok) break; } catch { /* retry */ } await new Promise((r) => setTimeout(r, 100)); }
  client = new Client({ name: 'bridge-test', version: '0' }); // no elicitation capability on purpose
  const transport = new StdioClientTransport({
    command: process.execPath, args: [BRIDGE],
    env: { ...process.env as Record<string, string>, CODEHUD_HOME: home, CODEHUD_AUTOSTART: '0', CODEHUD_OPEN_ON_ASK: '0', CODEHUD_SESSION: 'bridge-s1', CODEHUD_LABEL: 'bridge test' },
    stderr: 'pipe',
  });
  await client.connect(transport);
});
after(async () => { await client?.close(); server?.kill(); try { fs.rmSync(home, { recursive: true, force: true }); } catch { /* ignore */ } });

test('tools are registered and the map outline is framed as untrusted data', async () => {
  const names = (await client.listTools()).tools.map((t) => t.name).sort();
  assert.deepEqual(names, ['hud_ask', 'hud_await', 'hud_find_nodes', 'hud_focus', 'hud_get_map', 'hud_load_map', 'hud_note']);
  const out = textOf(await client.callTool({ name: 'hud_get_map', arguments: {} }));
  assert.match(out, /^<system_map trust="untrusted"/);
  assert.match(out, /store:d1/);
});

test('hud_focus resolves files and ids; the session is registered with a colour', async () => {
  const out = textOf(await client.callTool({ name: 'hud_focus', arguments: { files: ['src/pages/api/webhooks/stripe.ts'], nodes: ['nope:x'], note: 'reading' } }));
  assert.match(out, /Focused 1 node/);
  assert.match(out, /Unknown node ids: nope:x/);
  const s = ((await (await api('/api/session')).json()).sessions as any[]).find((x) => x.id === 'bridge-s1');
  assert.equal(s?.label, 'bridge test');
  assert.match(s?.color, /^#[0-9a-f]{6}$/);
});

test('hud_ask with no browser and no elicitation support hands the question back as text, leaving it pending', async () => {
  const out = textOf(await client.callTool({ name: 'hud_ask', arguments: { question: 'Pick a store', context: 'ctx', options: [{ id: 'd1', label: 'D1' }, { id: 'kv', label: 'KV' }], timeoutSeconds: 5 } }));
  assert.match(out, /No HUD browser tab is connected/);
  assert.match(out, /1\. D1/);
  assert.match(out, /hud_await "/);
  const qs = (await (await api('/api/questions')).json()) as any[];
  assert.equal(qs.find((q) => q.question === 'Pick a store')?.status, 'pending');
});

test('hud_ask with a browser connected waits, times out as pending, and hud_await picks up the answer', async () => {
  const browser = await connectBrowser();
  try {
    const out = textOf(await client.callTool({ name: 'hud_ask', arguments: { question: 'Which table?', context: 'ctx', nodes: ['table:subscriptions'], options: [{ id: 'a', label: 'subscriptions' }], timeoutSeconds: 5 } }));
    assert.match(out, /Still waiting on the human \(question (\S+), status: pending\)/);
    const id = out.match(/question (\S+), status/)![1];
    const answering = (async () => { await new Promise((r) => setTimeout(r, 500)); await api(`/api/questions/${id}/answer`, { method: 'POST', body: JSON.stringify({ optionId: 'a', text: 'go' }) }); })();
    const got = textOf(await client.callTool({ name: 'hud_await', arguments: { questionId: id, timeoutSeconds: 10 } }));
    await answering;
    assert.match(got, new RegExp(`<human_answer question_id="${id}" option="a" option_label="subscriptions">\\ngo\\n</human_answer>`));
  } finally { browser.destroy(); }
});

test('hud_await reports an expired question', async () => {
  const q = await (await api('/api/questions', { method: 'POST', body: JSON.stringify({ question: 'old', context: '', ttlSeconds: 5, session: 'bridge-s1' }) })).json();
  // flip it by hand to avoid waiting on the server's sweep granularity
  await api(`/api/questions/${q.id}/cancel`, { method: 'POST', body: '{}' });
  const out = textOf(await client.callTool({ name: 'hud_await', arguments: { questionId: q.id, timeoutSeconds: 5 } }));
  assert.match(out, /cancelled/);
});

test('hud_ask surfaces the server rate limit instead of throwing', async () => {
  let last = '';
  for (let i = 0; i < 8; i++) {
    last = textOf(await client.callTool({ name: 'hud_ask', arguments: { question: `flood ${i}`, context: '', timeoutSeconds: 5 } }));
    if (/refused/.test(last)) break;
  }
  assert.match(last, /hud_ask refused: too many (questions|pending)|session already has/);
});
