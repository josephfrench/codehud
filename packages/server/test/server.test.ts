/**
 * Server integration tests: spawn the real server on a spare port with an isolated CODEHUD_HOME.
 *   pnpm --filter @codehud/server test
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, type ChildProcess } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const ENTRY = path.resolve(here, '../src/index.ts');
const MAP = path.resolve(here, '../../../examples/sample-webapp.system.json');
const PORT = Number(process.env.CODEHUD_TEST_PORT ?? 4789);
const TOKEN = 'test-token-0123456789abcdef';
const BASE = `http://127.0.0.1:${PORT}`;

let child: ChildProcess;
let home: string;
let logs = '';

function startServer(extraArgs: string[] = [], env: Record<string, string> = {}, port = PORT) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'codehud-test-'));
  const c = spawn(process.execPath, [ENTRY, '--port', String(port), '--map', MAP, ...extraArgs], {
    env: { ...process.env, CODEHUD_HOME: dir, CODEHUD_TOKEN: TOKEN, CODEHUD_QUESTION_TTL_S: '2', CODEHUD_ASK_BURST: '3', CODEHUD_ASK_PER_MIN: '60', ...env },
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
  });
  let out = '';
  c.stdout!.on('data', (d) => { out += d; logs += d; });
  c.stderr!.on('data', (d) => { out += d; logs += d; });
  return { child: c, dir, output: () => out };
}

async function waitHealthy(port: number, ms = 8000) {
  const until = Date.now() + ms;
  while (Date.now() < until) {
    try { const r = await fetch(`http://127.0.0.1:${port}/api/health`); if (r.ok) return; } catch { /* retry */ }
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error(`server on ${port} did not come up:\n${logs}`);
}

const bearer = { authorization: `Bearer ${TOKEN}` };
const jsonHeaders = { ...bearer, 'content-type': 'application/json' };
const api = (route: string, init?: RequestInit) => fetch(BASE + route, init);
const post = (route: string, body: unknown, headers: Record<string, string> = jsonHeaders) =>
  api(route, { method: 'POST', headers, body: JSON.stringify(body) });

/** Raw request with a custom Host header (fetch forbids setting it). */
function rawGet(pathname: string, headers: Record<string, string>) {
  return new Promise<{ status: number; headers: http.IncomingHttpHeaders; body: string }>((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port: PORT, path: pathname, method: 'GET', headers }, (res) => {
      let body = '';
      res.on('data', (d) => (body += d));
      res.on('end', () => resolve({ status: res.statusCode!, headers: res.headers, body }));
    });
    req.on('error', reject);
    req.end();
  });
}

/** Open an SSE stream, collect raw frames for `ms`, then close. */
function sseCollect(headers: Record<string, string>, ms: number) {
  return new Promise<string>((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port: PORT, path: '/api/events', method: 'GET', headers: { ...bearer, ...headers } }, (res) => {
      let body = '';
      res.on('data', (d) => (body += d));
      setTimeout(() => { req.destroy(); resolve(body); }, ms);
    });
    req.on('error', (e: NodeJS.ErrnoException) => (e.code === 'ECONNRESET' ? undefined : reject(e)));
    req.end();
  });
}
function sseIds(frames: string) { return [...frames.matchAll(/^id: (\d+)$/gm)].map((m) => Number(m[1])); }
function sseEvents(frames: string) { return [...frames.matchAll(/^data: (.*)$/gm)].map((m) => JSON.parse(m[1])); }

before(async () => {
  const s = startServer();
  child = s.child; home = s.dir;
  await waitHealthy(PORT);
});
after(() => { child?.kill(); try { fs.rmSync(home, { recursive: true, force: true }); } catch { /* ignore */ } });

test('health is public, everything else needs auth', async () => {
  const h = await (await api('/api/health')).json();
  assert.equal(h.ok, true);
  assert.equal(h.map, 'Acme Portal');
  assert.equal(h.remote, false);
  assert.equal((await api('/api/map')).status, 401);
  assert.equal((await api('/api/events')).status, 401);
  assert.equal((await api('/api/map', { headers: bearer })).status, 200);
});

test('server.json lands in CODEHUD_HOME', () => {
  const info = JSON.parse(fs.readFileSync(path.join(home, 'server.json'), 'utf8'));
  assert.equal(info.port, PORT);
  assert.equal(info.token, TOKEN);
  assert.equal(info.pid, child.pid);
});

test('token claim issues a cookie; cookie requests need an exact Origin; wrong token is 401', async () => {
  const bad = await post('/api/session/claim', { token: 'nope' }, { 'content-type': 'application/json', origin: BASE });
  assert.equal(bad.status, 401);
  const r = await post('/api/session/claim', { token: TOKEN }, { 'content-type': 'application/json', origin: BASE });
  assert.equal(r.status, 200);
  const cookie = r.headers.get('set-cookie')!;
  assert.match(cookie, /^codehud_sid=[\w-]+; Path=\/; SameSite=Strict; HttpOnly$/);
  const sid = cookie.split(';')[0];
  assert.equal((await api('/api/map', { headers: { cookie: sid, origin: BASE } })).status, 200);
  assert.equal((await api('/api/map', { headers: { cookie: sid, origin: 'http://localhost:' + PORT } })).status, 403);
  assert.equal((await api('/api/map', { headers: { cookie: sid, origin: 'http://evil.example' } })).status, 403);
  // writes need JSON content type even with a good cookie
  const w = await api('/api/notes', { method: 'POST', headers: { cookie: sid, origin: BASE, 'content-type': 'text/plain' }, body: 'x' });
  assert.equal(w.status, 415);
});

test('unknown Host is 421; localhost and [::1] page loads redirect to 127.0.0.1 and keep the path', async () => {
  assert.equal((await rawGet('/', { host: 'evil.example:' + PORT })).status, 421);
  const r = await rawGet('/demo?v=1', { host: `localhost:${PORT}` });
  assert.equal(r.status, 307);
  assert.equal(r.headers.location, `${BASE}/demo?v=1`);
  const r6 = await rawGet('/', { host: `[::1]:${PORT}` });
  assert.equal(r6.status, 307);
  // API calls on the alias host are not redirected (bearer clients may use localhost)
  const a = await rawGet('/api/health', { host: `localhost:${PORT}` });
  assert.equal(a.status, 200);
});

test('questions: create, long-poll, answer, 409 on double answer', async () => {
  const r = await post('/api/questions', { question: 'Which store?', context: 'ctx', nodes: ['store:d1'], options: [{ id: 'a', label: 'A' }], session: 's-q' });
  assert.equal(r.status, 201);
  const q = await r.json();
  assert.deepEqual(q.resolvedNodes, ['store:d1']);
  assert.ok(q.expiresAt);
  const t0 = Date.now();
  const poll = api(`/api/questions/${q.id}?wait=3000`, { headers: bearer });
  await new Promise((r) => setTimeout(r, 200));
  const a = await post(`/api/questions/${q.id}/answer`, { optionId: 'a' });
  assert.equal(a.status, 200);
  const polled = await (await poll).json();
  assert.equal(polled.status, 'answered');
  assert.equal(polled.answer.optionId, 'a');
  assert.ok(Date.now() - t0 < 2500, 'long-poll woke on answer');
  assert.equal((await post(`/api/questions/${q.id}/answer`, { text: 'again' })).status, 409);
});

test('pending questions expire (CODEHUD_QUESTION_TTL_S), waiters wake, SSE sees it', async () => {
  const q = await (await post('/api/questions', { question: 'expire me', context: '', session: 's-exp' })).json();
  const frames = sseCollect({}, 3500);
  const polled = await (await api(`/api/questions/${q.id}?wait=4000`, { headers: bearer })).json();
  assert.equal(polled.status, 'expired');
  const evs = sseEvents(await frames).filter((e) => e.type === 'answer' && e.question.id === q.id);
  assert.equal(evs.length, 1);
  assert.equal(evs[0].question.status, 'expired');
});

test('ttlSeconds shortens a question\'s life but never exceeds the server cap', async () => {
  const q = await (await post('/api/questions', { question: 'short', context: '', ttlSeconds: 9999, session: 's-ttl' })).json();
  assert.ok(Date.parse(q.expiresAt) - Date.parse(q.createdAt) <= 2100);
});

test('question creation is rate limited per session with retry-after', async () => {
  const codes: number[] = [];
  let retry: string | null = null;
  for (let i = 0; i < 5; i++) {
    const r = await post('/api/questions', { question: `flood ${i}`, context: '' }); // anonymous bucket
    codes.push(r.status);
    if (r.status === 429) retry = r.headers.get('retry-after');
  }
  assert.deepEqual(codes.slice(0, 3), [201, 201, 201]);
  assert.ok(codes.slice(3).every((c) => c === 429), `expected 429s, got ${codes}`);
  assert.ok(Number(retry) >= 1);
  // another session has its own bucket
  assert.equal((await post('/api/questions', { question: 'other', context: '', session: 's-other' })).status, 201);
});

test('pending cap per session is separate from the rate limit', async () => {
  const codes: number[] = [];
  for (let i = 0; i < 4; i++) codes.push((await post('/api/questions', { question: `cap ${i}`, context: '', session: 's-cap' })).status);
  assert.deepEqual(codes, [201, 201, 201, 429]);
});

test('focus and notes resolve files to nodes and are throttled only under a real flood', async () => {
  const r = await post('/api/focus', { files: ['C:/example/acme-portal/src/pages/api/webhooks/stripe.ts'], session: 's-f', source: 'hook' });
  assert.equal(r.status, 200);
  const body = await r.json();
  assert.ok(body.resolvedNodes.length >= 1, 'absolute path under the map root resolves');
  let last = 200;
  for (let i = 0; i < 70 && last === 200; i++) last = (await post('/api/focus', { nodes: ['store:d1'], session: 's-flood' })).status;
  assert.equal(last, 429);
});

test('sessions get a stable colour from the palette', async () => {
  const a = await (await post('/api/sessions', { id: 'c-1', label: 'one' })).json();
  const b = await (await post('/api/sessions', { id: 'c-2', label: 'two' })).json();
  const a2 = await (await post('/api/sessions', { id: 'c-1', status: 'idle' })).json();
  assert.match(a.color, /^#[0-9a-f]{6}$/);
  assert.notEqual(a.color, b.color);
  assert.equal(a2.color, a.color);
});

test('SSE: events carry ids; Last-Event-ID replays the gap; a stale id gets a fresh hello', async () => {
  const first = await sseCollect({}, 400);
  const hello = sseEvents(first)[0];
  assert.equal(hello.type, 'hello');
  const helloId = sseIds(first)[0];
  // generate two events while nobody listens
  await post('/api/notes', { text: 'one', session: 's-sse' });
  await post('/api/notes', { text: 'two', session: 's-sse' });
  const replay = await sseCollect({ 'last-event-id': String(helloId) }, 400);
  const evs = sseEvents(replay);
  assert.ok(!evs.some((e) => e.type === 'hello'), 'no hello on a clean replay');
  const notes = evs.filter((e) => e.type === 'activity' && e.item.kind === 'note').map((e) => e.item.text);
  assert.deepEqual(notes.slice(-2), ['one', 'two']);
  const ids = sseIds(replay);
  assert.ok(ids.every((id, i) => i === 0 || id > ids[i - 1]), 'ids increase');
  assert.ok(ids[0] > helloId);
  // an id from the future (e.g. before a restart) falls back to hello
  const stale = await sseCollect({ 'last-event-id': '999999' }, 400);
  assert.equal(sseEvents(stale)[0].type, 'hello');
});

test('remote mode refuses to start without an operator token, and --bind needs --allow-remote', async () => {
  const noTok = startServer(['--allow-remote', 'box.tail1234.ts.net'], { CODEHUD_OPERATOR_TOKEN: '' }, PORT + 1);
  const code = await new Promise<number | null>((r) => noTok.child.on('exit', r));
  assert.equal(code, 2);
  assert.match(noTok.output(), /operator-token/);
  const bindOnly = startServer(['--bind', '0.0.0.0'], {}, PORT + 1);
  assert.equal(await new Promise<number | null>((r) => bindOnly.child.on('exit', r)), 2);
  fs.rmSync(noTok.dir, { recursive: true, force: true });
  fs.rmSync(bindOnly.dir, { recursive: true, force: true });
});

test('remote mode: operator token claims a page from the remote host; local token still works; other hosts stay 421', async () => {
  const port = PORT + 2;
  const op = 'operator-secret-0123456789';
  const s = startServer(['--allow-remote', 'box.tail1234.ts.net', '--operator-token', op], {}, port);
  try {
    await waitHealthy(port);
    const claim = (token: string, origin: string, host: string) => new Promise<number>((resolve, reject) => {
      const body = JSON.stringify({ token });
      const req = http.request({ host: '127.0.0.1', port, path: '/api/session/claim', method: 'POST', headers: { host, origin, 'content-type': 'application/json', 'content-length': Buffer.byteLength(body), 'x-forwarded-proto': 'https' } }, (res) => { res.resume(); res.on('end', () => resolve(res.statusCode!)); });
      req.on('error', reject); req.end(body);
    });
    assert.equal(await claim(op, 'https://box.tail1234.ts.net', 'box.tail1234.ts.net'), 200);
    assert.equal(await claim(TOKEN, 'https://box.tail1234.ts.net', 'box.tail1234.ts.net'), 200);
    assert.equal(await claim('wrong-operator-token-xx', 'https://box.tail1234.ts.net', 'box.tail1234.ts.net'), 401);
    assert.equal(await claim(op, 'https://other.example', 'box.tail1234.ts.net'), 403);
    assert.equal(await claim(op, 'https://box.tail1234.ts.net', 'other.example'), 421);
    const h = await (await fetch(`http://127.0.0.1:${port}/api/health`)).json();
    assert.equal(h.remote, true);
  } finally {
    s.child.kill();
    fs.rmSync(s.dir, { recursive: true, force: true });
  }
});
