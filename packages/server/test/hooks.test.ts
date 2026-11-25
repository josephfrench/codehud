/**
 * The Claude Code hooks pack (templates/hooks) against a real server: presence, session-start, ask.
 *   pnpm --filter @codehud/server test
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, execFile, type ChildProcess } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const ENTRY = path.resolve(here, '../src/index.ts');
const HOOKS = path.resolve(here, '../../../templates/hooks');
const MAP = path.resolve(here, '../../../examples/sample-webapp.system.json');
const PORT = Number(process.env.CODEHUD_TEST_PORT ?? 4789) - 5;
const TOKEN = 'hook-test-token-0123456789';
const BASE = `http://127.0.0.1:${PORT}`;
const bearer = { authorization: `Bearer ${TOKEN}`, 'content-type': 'application/json' };

let child: ChildProcess;
let home: string;

/** Run a hook script with a JSON payload on stdin; resolve with stdout + exit code. */
function runHook(script: string, payload: unknown, env: Record<string, string> = {}, timeoutMs = 20_000) {
  return new Promise<{ code: number | null; stdout: string; stderr: string }>((resolve) => {
    const p = execFile(process.execPath, [path.join(HOOKS, script)], { env: { ...process.env, CODEHUD_HOME: home, ...env }, timeout: timeoutMs, windowsHide: true }, (err, stdout, stderr) => {
      resolve({ code: err ? (err as any).code ?? 1 : 0, stdout, stderr });
    });
    p.stdin!.end(JSON.stringify(payload));
  });
}
/** Hold an SSE connection open so the server counts one browser. */
function connectBrowser() {
  return new Promise<http.ClientRequest>((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port: PORT, path: '/api/events', headers: { authorization: `Bearer ${TOKEN}` } }, (res) => { res.on('data', () => {}); resolve(req); });
    req.on('error', (e: NodeJS.ErrnoException) => (e.code === 'ECONNRESET' ? undefined : reject(e)));
    req.end();
  });
}
const api = (route: string, init?: RequestInit) => fetch(BASE + route, { ...init, headers: { ...bearer, ...(init?.headers as any) } });

before(async () => {
  home = fs.mkdtempSync(path.join(os.tmpdir(), 'codehud-hooks-'));
  child = spawn(process.execPath, [ENTRY, '--port', String(PORT), '--map', MAP], { env: { ...process.env, CODEHUD_HOME: home, CODEHUD_TOKEN: TOKEN }, stdio: 'ignore', windowsHide: true });
  const until = Date.now() + 8000;
  while (Date.now() < until) { try { if ((await fetch(BASE + '/api/health')).ok) break; } catch { /* retry */ } await new Promise((r) => setTimeout(r, 100)); }
});
after(() => { child?.kill(); try { fs.rmSync(home, { recursive: true, force: true }); } catch { /* ignore */ } });

test('presence.mjs posts a non-zooming hook focus for the touched file', async () => {
  const r = await runHook('presence.mjs', { session_id: 'hook-s1', tool_name: 'Edit', tool_input: { file_path: 'C:/example/acme-portal/src/pages/api/webhooks/stripe.ts' } });
  assert.equal(r.code, 0);
  assert.equal(r.stdout, '');
  const sessions = (await (await api('/api/session')).json()).sessions;
  assert.ok(sessions.some((s: any) => s.id === 'hook-s1'), 'session created by the hook');
});

test('presence.mjs and session-start.mjs stay silent when there is no server', async () => {
  const empty = fs.mkdtempSync(path.join(os.tmpdir(), 'codehud-nohome-'));
  const a = await runHook('presence.mjs', { tool_input: { file_path: 'x.ts' } }, { CODEHUD_HOME: empty });
  const b = await runHook('session-start.mjs', { session_id: 'x', cwd: empty }, { CODEHUD_HOME: empty });
  assert.deepEqual([a.code, a.stdout, b.code, b.stdout], [0, '', 0, '']);
  fs.rmSync(empty, { recursive: true, force: true });
});

test('session-start.mjs registers the session and injects additionalContext when the server is up', async () => {
  const r = await runHook('session-start.mjs', { session_id: 'hook-s2', cwd: 'C:/example/acme-portal', hook_event_name: 'SessionStart' });
  assert.equal(r.code, 0);
  const out = JSON.parse(r.stdout);
  assert.equal(out.hookSpecificOutput.hookEventName, 'SessionStart');
  assert.match(out.hookSpecificOutput.additionalContext, /codehud is live at http:\/\/127\.0\.0\.1:\d+/);
  assert.match(out.hookSpecificOutput.additionalContext, /Acme Portal/);
  const sessions = (await (await api('/api/session')).json()).sessions;
  assert.equal(sessions.find((s: any) => s.id === 'hook-s2')?.label, 'acme-portal');
});

const askPayload = {
  session_id: 'hook-s3', hook_event_name: 'PreToolUse', tool_name: 'AskUserQuestion',
  tool_input: { questions: [{ question: 'Which framework?', header: 'Framework', options: [{ label: 'React', description: 'Component library' }, { label: 'Vue', description: 'Progressive framework' }], multiSelect: false }] },
};

test('ask.mjs falls through (no output) when no browser is connected', async () => {
  const r = await runHook('ask.mjs', askPayload);
  assert.equal(r.code, 0);
  assert.equal(r.stdout, '');
  const qs = await (await api('/api/questions')).json();
  assert.ok(!qs.some((q: any) => q.question === 'Which framework?'), 'no HUD question was created');
});

test('ask.mjs routes the question to the HUD and returns allow + updatedInput.answers', async () => {
  const browser = await connectBrowser();
  try {
    const run = runHook('ask.mjs', askPayload);
    // find the question in the HUD and answer it like the human would
    let q: any;
    for (let i = 0; i < 50 && !q; i++) {
      await new Promise((r) => setTimeout(r, 100));
      q = ((await (await api('/api/questions')).json()) as any[]).find((x) => x.question === 'Which framework?' && x.status === 'pending');
    }
    assert.ok(q, 'question reached the server');
    assert.equal(q.agent, 'claude-code');
    assert.deepEqual(q.options.map((o: any) => o.label), ['React', 'Vue']);
    await api(`/api/questions/${q.id}/answer`, { method: 'POST', body: JSON.stringify({ optionId: q.options[1].id }) });
    const r = await run;
    assert.equal(r.code, 0, r.stderr);
    const out = JSON.parse(r.stdout);
    assert.equal(out.hookSpecificOutput.permissionDecision, 'allow');
    assert.deepEqual(out.hookSpecificOutput.updatedInput.questions, askPayload.tool_input.questions);
    assert.deepEqual(out.hookSpecificOutput.updatedInput.answers, { 'Which framework?': 'Vue' });
  } finally { browser.destroy(); }
});

test('ask.mjs falls through when the HUD question is cancelled or the wait runs out', async () => {
  const browser = await connectBrowser();
  try {
    const r = await runHook('ask.mjs', { ...askPayload, session_id: 'hook-s4' }, { CODEHUD_ASK_HOOK_WAIT_S: '2' });
    assert.equal(r.code, 0);
    assert.equal(r.stdout, '', 'timed-out hook prints nothing so the terminal prompt appears');
    const qs = (await (await api('/api/questions')).json()) as any[];
    assert.ok(qs.filter((q) => q.session === 'hook-s4').every((q) => q.status !== 'pending'), 'HUD question was cancelled/expired');
  } finally { browser.destroy(); }
});
