#!/usr/bin/env node
/**
 * codehud local server.
 *
 *   node packages/server/src/index.ts [--map path.json] [--port 4777] [--open]
 *
 * - Serves the built HUD from packages/hud/dist
 * - Holds the current SystemMap
 * - Accepts focus / question / note calls from the MCP bridge (bearer token)
 * - Streams ServerEvents to browsers over SSE (cookie auth)
 *
 * Security posture (POC), see docs/research/security.md:
 * - binds 127.0.0.1 only; exact Host allowlist incl. port (DNS rebinding)
 * - random per-run bearer token for local clients, written to ~/.codehud/server.json
 * - the browser gets the token out of band in the URL fragment (#t=...), exchanges it
 *   at POST /api/session/claim for a separate random session id in an HttpOnly,
 *   SameSite=Strict cookie, and strips the fragment. Serving the page never authenticates.
 * - cookie-authenticated requests must carry an exact-match Origin (or same-origin
 *   Sec-Fetch-Site); JSON content-type required on all writes; no CORS headers ever.
 * - every /api/* route except /api/health requires auth, GETs and SSE included.
 */
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import { execFile } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import { MapIndex, validateSystemMap, type SystemMap } from '../../schema/src/index.ts';
import type {
  ActivityItem, AgentSession, Answer, FocusRequest, Question, QuestionInput, ServerEvent, ServerInfo,
} from '../../schema/src/protocol.ts';

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------
const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '../../..');
const args = parseArgs(process.argv.slice(2));
const PORT = Number(args.port ?? process.env.CODEHUD_PORT ?? 4777);
const HOST = '127.0.0.1';
const TOKEN = process.env.CODEHUD_TOKEN ?? crypto.randomBytes(24).toString('base64url');
const HUD_DIST = path.resolve(here, '../../hud/dist');
const INFO_DIR = path.join(os.homedir(), '.codehud');
const INFO_FILE = path.join(INFO_DIR, 'server.json');
const DEFAULT_MAP = path.resolve(repoRoot, 'examples/sample-webapp.system.json');
const MAX_BODY = 64 * 1024;
const MAX_MAP_BODY = 4 * 1024 * 1024;
const MAX_SSE_CLIENTS = 16;
const MAX_PENDING_PER_SESSION = 3;
const ORIGIN = `http://${HOST}:${PORT}`;
const ALLOWED_HOSTS = new Set([`${HOST}:${PORT}`, `localhost:${PORT}`, `[::1]:${PORT}`]);
/** Browser session ids issued in exchange for the token. */
const sessionIds = new Set<string>();

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------
const state = {
  map: null as SystemMap | null,
  index: null as MapIndex | null,
  mapPath: null as string | null,
  questions: new Map<string, Question>(),
  sessions: new Map<string, AgentSession>(),
  activity: [] as ActivityItem[],
  clients: new Set<http.ServerResponse>(),
  waiters: new Map<string, Set<() => void>>(),
};

function loadMap(file: string) {
  const raw = JSON.parse(fs.readFileSync(file, 'utf8'));
  const v = validateSystemMap(raw);
  if (!v.ok) throw new Error(`Invalid system map ${file}:\n  ${v.errors.join('\n  ')}`);
  setMap(v.map, file);
}
function setMap(map: SystemMap, file: string | null) {
  state.map = map;
  state.index = new MapIndex(map);
  state.mapPath = file;
  broadcast({ type: 'map', map });
  log('map', `Loaded map "${map.name}" (${map.nodes.length} nodes, ${map.edges.length} edges)`);
}

function log(kind: ActivityItem['kind'], text: string, extra: Partial<ActivityItem> = {}) {
  const item: ActivityItem = { id: crypto.randomUUID(), at: new Date().toISOString(), kind, text, ...extra };
  state.activity.push(item);
  if (state.activity.length > 200) state.activity.splice(0, state.activity.length - 200);
  broadcast({ type: 'activity', item });
  console.log(`[${item.at.slice(11, 19)}] ${kind.padEnd(8)} ${text}`);
}

function broadcast(ev: ServerEvent) {
  const payload = `data: ${JSON.stringify(ev)}\n\n`;
  for (const res of state.clients) {
    try { res.write(payload); } catch { state.clients.delete(res); }
  }
}

function resolveNodes(nodes?: string[], files?: (string | { path: string })[]): string[] {
  const out = new Set<string>();
  const idx = state.index;
  if (!idx) return [];
  for (const id of nodes ?? []) if (idx.get(id)) out.add(id);
  for (const f of files ?? []) {
    const p = typeof f === 'string' ? f : f.path;
    const hits = idx.nodesForFile(p);
    if (hits[0]) out.add(hits[0].id);
  }
  return [...out];
}

// ---------------------------------------------------------------------------
// HTTP plumbing
// ---------------------------------------------------------------------------
type Req = http.IncomingMessage;
type Res = http.ServerResponse;

class HttpError extends Error { status: number; constructor(status: number, msg: string) { super(msg); this.status = status; } }

function hostAllowed(hostHeader: string | undefined) {
  return !!hostHeader && ALLOWED_HOSTS.has(hostHeader);
}
function parseCookies(req: Req): Record<string, string> {
  const out: Record<string, string> = {};
  for (const part of (req.headers.cookie ?? '').split(';')) {
    const i = part.indexOf('=');
    if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}
/** 'bearer' for local clients, 'cookie' for the browser, null otherwise. */
function authKind(req: Req): 'bearer' | 'cookie' | null {
  const auth = req.headers.authorization;
  if (auth?.startsWith('Bearer ') && safeEq(auth.slice(7), TOKEN)) return 'bearer';
  const sid = parseCookies(req).codehud_sid;
  if (sid && [...sessionIds].some((s) => safeEq(s, sid))) return 'cookie';
  return null;
}
/** Cookie-authenticated requests must prove they come from our own origin. */
function sameOriginOk(req: Req) {
  const origin = req.headers.origin;
  if (origin !== undefined) return origin === ORIGIN;
  const sfs = req.headers['sec-fetch-site'];
  if (sfs !== undefined) return sfs === 'same-origin' || sfs === 'none';
  // Old browsers send neither; only allow safe GETs then.
  return req.method === 'GET' || req.method === 'HEAD';
}
function safeEq(a: string, b: string) {
  const ab = Buffer.from(a), bb = Buffer.from(b);
  return ab.length === bb.length && crypto.timingSafeEqual(ab, bb);
}
async function readJson(req: Req, max = MAX_BODY): Promise<any> {
  const ct = req.headers['content-type'] ?? '';
  if (!ct.includes('application/json')) throw new HttpError(415, 'content-type must be application/json');
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > max) throw new HttpError(413, 'body too large');
    chunks.push(chunk);
  }
  if (!size) return {};
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { throw new HttpError(400, 'invalid json'); }
}
function json(res: Res, status: number, body: unknown) {
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff',
  });
  res.end(JSON.stringify(body));
}

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon',
  '.woff2': 'font/woff2', '.woff': 'font/woff', '.map': 'application/json', '.txt': 'text/plain; charset=utf-8',
};

function serveStatic(req: Req, res: Res, urlPath: string) {
  if (!fs.existsSync(HUD_DIST)) {
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    res.end(`<!doctype html><meta charset="utf-8"><title>codehud</title>
<body style="font:14px/1.5 ui-monospace,monospace;background:#0b0e14;color:#cdd6f4;padding:2rem">
<h1 style="font-size:18px">codehud server is running</h1>
<p>The HUD has not been built yet. Run <code>pnpm build</code> (or <code>pnpm dev</code> and open the Vite URL).</p>
<p>API is live at <code>/api/*</code>. Map: ${state.map ? escapeHtml(state.map.name) : 'none'}.</p></body>`);
    return;
  }
  let rel = decodeURIComponent(urlPath.split('?')[0]);
  if (rel === '/' || !path.extname(rel)) rel = '/index.html';
  const file = path.normalize(path.join(HUD_DIST, rel));
  if (!file.startsWith(HUD_DIST) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
    res.writeHead(404); res.end('not found'); return;
  }
  const ext = path.extname(file);
  const headers: Record<string, string> = {
    'content-type': MIME[ext] ?? 'application/octet-stream',
    'x-content-type-options': 'nosniff',
    'cache-control': ext === '.html' ? 'no-store' : 'public, max-age=3600',
  };
  if (ext === '.html') {
    headers['content-security-policy'] =
      "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; font-src 'self'; frame-ancestors 'none'; base-uri 'none'";
    headers['referrer-policy'] = 'no-referrer';
  }
  res.writeHead(200, headers);
  fs.createReadStream(file).pipe(res);
}
function escapeHtml(s: string) { return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!)); }

// ---------------------------------------------------------------------------
// API
// ---------------------------------------------------------------------------
async function handleApi(req: Req, res: Res, url: URL) {
  const method = req.method ?? 'GET';
  const p = url.pathname;

  if (p === '/api/health') return json(res, 200, { ok: true, name: 'codehud', map: state.map?.name ?? null, pid: process.pid, browsers: state.clients.size });

  // Browser exchanges the fragment token for a session cookie. Same-origin only.
  if (p === '/api/session/claim' && method === 'POST') {
    if (!sameOriginOk(req)) throw new HttpError(403, 'bad origin');
    const { token } = await readJson(req);
    if (typeof token !== 'string' || !safeEq(token, TOKEN)) throw new HttpError(401, 'bad token');
    const sid = crypto.randomBytes(24).toString('base64url');
    sessionIds.add(sid);
    if (sessionIds.size > 32) sessionIds.delete(sessionIds.values().next().value!);
    res.setHeader('set-cookie', `codehud_sid=${sid}; Path=/; SameSite=Strict; HttpOnly`);
    return json(res, 200, { ok: true });
  }

  const kind = authKind(req);
  if (!kind) throw new HttpError(401, 'unauthorized');
  if (kind === 'cookie' && !sameOriginOk(req)) throw new HttpError(403, 'bad origin');

  if (p === '/api/events' && method === 'GET') return sse(req, res);

  if (p === '/api/session' && method === 'GET') {
    return json(res, 200, { ok: true, map: state.map?.name ?? null, mapPath: state.mapPath, sessions: [...state.sessions.values()] });
  }

  if (p === '/api/map' && method === 'GET') return json(res, 200, state.map);
  if (p === '/api/map' && method === 'PUT') {
    const body = await readJson(req, MAX_MAP_BODY);
    const v = validateSystemMap(body);
    if (!v.ok) throw new HttpError(400, v.errors.join('; '));
    setMap(v.map, null);
    return json(res, 200, { ok: true, nodes: v.map.nodes.length });
  }
  if (p === '/api/map/load' && method === 'POST') {
    const { path: file } = await readJson(req);
    if (typeof file !== 'string') throw new HttpError(400, 'path required');
    try { loadMap(path.resolve(file)); } catch (e: any) { throw new HttpError(400, e.message); }
    return json(res, 200, { ok: true, name: state.map!.name, nodes: state.map!.nodes.length });
  }

  if (p === '/api/nodes' && method === 'GET') {
    if (!state.index) return json(res, 200, []);
    const file = url.searchParams.get('file');
    const q = url.searchParams.get('q');
    const nodes = file ? state.index.nodesForFile(file) : q ? state.index.search(q) : [];
    return json(res, 200, nodes.slice(0, 20));
  }

  if (p === '/api/file' && method === 'GET') return serveSnippet(res, url);

  if (p === '/api/focus' && method === 'POST') {
    const body = (await readJson(req)) as FocusRequest;
    const resolvedNodes = resolveNodes(body.nodes, body.files?.map(relToRoot));
    touchSession(body.session, 'working');
    const source = body.source === 'hook' ? 'hook' : 'agent';
    broadcast({ type: 'focus', focus: { ...body, source, zoom: source === 'hook' ? false : body.zoom, resolvedNodes } });
    const labels = resolvedNodes.map((id) => state.index?.get(id)?.label ?? id);
    if (source === 'agent' || body.note) log('focus', body.note ? `${body.note} — ${labels.join(', ')}` : `Focus ${labels.join(', ')}`, { nodes: resolvedNodes, session: body.session });
    return json(res, 200, { resolvedNodes, unresolved: (body.nodes ?? []).filter((n) => !resolvedNodes.includes(n)) });
  }

  if (p === '/api/notes' && method === 'POST') {
    const { text, session } = await readJson(req);
    if (typeof text !== 'string') throw new HttpError(400, 'text required');
    touchSession(session, 'working');
    log('note', text.slice(0, 500), { session });
    return json(res, 200, { ok: true });
  }

  if (p === '/api/sessions' && method === 'POST') {
    const body = (await readJson(req)) as Partial<AgentSession>;
    if (!body.id) throw new HttpError(400, 'id required');
    const s: AgentSession = { ...(state.sessions.get(body.id) ?? { id: body.id }), ...body, lastSeen: new Date().toISOString() } as AgentSession;
    const isNew = !state.sessions.has(s.id);
    state.sessions.set(s.id, s);
    broadcast({ type: 'session', session: s });
    if (isNew) log('session', `Agent session connected: ${s.label ?? s.id}${s.cwd ? ` (${s.cwd})` : ''}`, { session: s.id });
    return json(res, 200, s);
  }

  if (p === '/api/questions' && method === 'GET') return json(res, 200, [...state.questions.values()]);
  if (p === '/api/questions' && method === 'POST') {
    const input = (await readJson(req)) as QuestionInput;
    if (typeof input.question !== 'string' || !input.question.trim()) throw new HttpError(400, 'question required');
    if (input.session && [...state.questions.values()].filter((q) => q.status === 'pending' && q.session === input.session).length >= MAX_PENDING_PER_SESSION) {
      throw new HttpError(429, `session already has ${MAX_PENDING_PER_SESSION} pending questions; wait for answers first`);
    }
    const q: Question = {
      allowFreeText: true,
      ...input,
      context: typeof input.context === 'string' ? input.context : '',
      id: crypto.randomUUID(),
      createdAt: new Date().toISOString(),
      status: 'pending',
      resolvedNodes: resolveNodes(input.nodes, input.files),
    };
    state.questions.set(q.id, q);
    touchSession(q.session, 'waiting');
    broadcast({ type: 'question', question: q });
    log('question', q.question.slice(0, 200), { nodes: q.resolvedNodes, session: q.session });
    return json(res, 201, q);
  }

  const qm = p.match(/^\/api\/questions\/([\w-]+)(?:\/(answer|cancel))?$/);
  if (qm) {
    const q = state.questions.get(qm[1]);
    if (!q) throw new HttpError(404, 'no such question');
    if (!qm[2] && method === 'GET') {
      const wait = Math.min(Number(url.searchParams.get('wait') ?? 0), 30_000);
      if (q.status === 'pending' && wait > 0) await waitFor(q.id, wait);
      return json(res, 200, q);
    }
    if (qm[2] === 'answer' && method === 'POST') {
      if (q.status !== 'pending') throw new HttpError(409, `question is ${q.status}`);
      const body = await readJson(req);
      const text = String(body.text ?? '').slice(0, 4000);
      const optionId = body.optionId ? String(body.optionId) : undefined;
      if (!text && !optionId) throw new HttpError(400, 'text or optionId required');
      const opt = q.options?.find((o) => o.id === optionId);
      const answer: Answer = { text: text || opt?.label || '', optionId, answeredAt: new Date().toISOString() };
      q.status = 'answered';
      q.answer = answer;
      touchSession(q.session, 'working');
      broadcast({ type: 'answer', question: q });
      log('answer', `${opt ? `[${opt.label}] ` : ''}${answer.text}`.slice(0, 300), { nodes: q.resolvedNodes, session: q.session });
      wake(q.id);
      return json(res, 200, q);
    }
    if (qm[2] === 'cancel' && method === 'POST') {
      if (q.status === 'pending') { q.status = 'cancelled'; broadcast({ type: 'answer', question: q }); wake(q.id); }
      return json(res, 200, q);
    }
  }

  throw new HttpError(404, `no route ${method} ${p}`);
}

function touchSession(id: string | undefined, status: AgentSession['status']) {
  if (!id) return;
  const s = state.sessions.get(id) ?? { id, lastSeen: '' };
  s.lastSeen = new Date().toISOString();
  s.status = status;
  state.sessions.set(id, s);
  broadcast({ type: 'session', session: s });
}

function waitFor(qid: string, ms: number) {
  return new Promise<void>((resolve) => {
    const set = state.waiters.get(qid) ?? new Set();
    const done = () => { clearTimeout(t); set.delete(done); resolve(); };
    const t = setTimeout(done, ms);
    set.add(done);
    state.waiters.set(qid, set);
  });
}
function wake(qid: string) { for (const fn of state.waiters.get(qid) ?? []) fn(); }

/** Hooks send absolute paths; make them relative to the map root when possible. */
function relToRoot(p: string | { path: string }) {
  const raw = (typeof p === 'string' ? p : p.path).replace(/\\/g, '/');
  const root = state.map?.root?.replace(/\\/g, '/').replace(/\/$/, '');
  if (root && raw.toLowerCase().startsWith(root.toLowerCase() + '/')) return raw.slice(root.length + 1);
  return raw;
}

function sse(req: Req, res: Res) {
  if (state.clients.size >= MAX_SSE_CLIENTS) throw new HttpError(503, 'too many clients');
  res.writeHead(200, {
    'content-type': 'text/event-stream',
    'cache-control': 'no-store',
    connection: 'keep-alive',
    'x-accel-buffering': 'no',
  });
  res.write(':ok\n\n');
  const hello: ServerEvent = { type: 'hello', map: state.map, questions: [...state.questions.values()], sessions: [...state.sessions.values()], activity: state.activity.slice(-100) };
  res.write(`data: ${JSON.stringify(hello)}\n\n`);
  state.clients.add(res);
  const hb = setInterval(() => { try { res.write(':hb\n\n'); } catch { /* ignore */ } }, 25_000);
  req.on('close', () => { clearInterval(hb); state.clients.delete(res); });
}

/** Read a slice of a file under the map root for "show me more context". */
function serveSnippet(res: Res, url: URL) {
  const root = state.map?.root;
  const rel = url.searchParams.get('path');
  if (!root || !rel) throw new HttpError(400, 'map has no root or path missing');
  const abs = path.resolve(root, rel);
  const rootAbs = path.resolve(root);
  if (!abs.startsWith(rootAbs + path.sep) && abs !== rootAbs) throw new HttpError(403, 'outside map root');
  if (!fs.existsSync(abs) || fs.statSync(abs).isDirectory()) throw new HttpError(404, 'file not found');
  const from = Math.max(1, Number(url.searchParams.get('from') ?? 1));
  const to = Math.min(from + 400, Number(url.searchParams.get('to') ?? from + 120));
  const lines = fs.readFileSync(abs, 'utf8').split(/\r?\n/);
  return json(res, 200, { path: rel, from, to: Math.min(to, lines.length), total: lines.length, lines: lines.slice(from - 1, to) });
}

// ---------------------------------------------------------------------------
// Server
// ---------------------------------------------------------------------------
const server = http.createServer(async (req, res) => {
  try {
    if (!hostAllowed(req.headers.host)) throw new HttpError(421, 'bad host');
    const url = new URL(req.url ?? '/', ORIGIN);
    if (url.pathname.startsWith('/api/')) return await handleApi(req, res, url);
    if (req.method !== 'GET' && req.method !== 'HEAD') throw new HttpError(405, 'method not allowed');
    return serveStatic(req, res, url.pathname);
  } catch (e: any) {
    const status = e instanceof HttpError ? e.status : 500;
    if (status === 500) console.error(e);
    if (!res.headersSent) json(res, status, { error: e.message ?? 'error' });
    else res.end();
  }
});

server.headersTimeout = 15_000;
server.requestTimeout = 60_000;
server.listen(PORT, HOST, () => {
  const info: ServerInfo = { version: 1, port: PORT, host: HOST, url: ORIGIN, token: TOKEN, pid: process.pid, startedAt: new Date().toISOString() };
  fs.mkdirSync(INFO_DIR, { recursive: true });
  // Atomic write; mode is a no-op on Windows where the profile ACL protects the file.
  const tmp = INFO_FILE + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(info, null, 2), { mode: 0o600 });
  fs.renameSync(tmp, INFO_FILE);
  const mapFile = args.map ? path.resolve(String(args.map)) : fs.existsSync(DEFAULT_MAP) ? DEFAULT_MAP : null;
  if (mapFile) { try { loadMap(mapFile); } catch (e: any) { console.error(e.message); } }
  const url = `${ORIGIN}/#t=${TOKEN}`;
  console.log(`codehud ▸ open ${url}`);
  console.log(`         (the fragment is a one-time sign-in; details in ${INFO_FILE})`);
  if (args.open) openBrowser(url);
});
server.on('error', (e: NodeJS.ErrnoException) => {
  if (e.code === 'EADDRINUSE') { console.error(`port ${PORT} is in use (another codehud? try --port)`); process.exit(1); }
  throw e;
});

function openBrowser(url: string) {
  const cmd = process.platform === 'win32' ? ['cmd', ['/c', 'start', '', url]] as const
    : process.platform === 'darwin' ? ['open', [url]] as const : ['xdg-open', [url]] as const;
  execFile(cmd[0], [...cmd[1]], () => { /* best effort */ });
}

function cleanup() {
  try {
    const cur = JSON.parse(fs.readFileSync(INFO_FILE, 'utf8')) as ServerInfo;
    if (cur.pid === process.pid) fs.unlinkSync(INFO_FILE);
  } catch { /* ignore */ }
  process.exit(0);
}
process.on('SIGINT', cleanup);
process.on('SIGTERM', cleanup);

function parseArgs(argv: string[]) {
  const out: Record<string, string | boolean> = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith('--')) continue;
    const key = a.slice(2);
    const next = argv[i + 1];
    if (next && !next.startsWith('--')) { out[key] = next; i++; } else out[key] = true;
  }
  return out;
}
