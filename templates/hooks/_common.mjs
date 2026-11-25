/**
 * Shared helpers for the codehud Claude Code hooks. Zero dependencies; Node 22+.
 *
 * Hooks never call process.exit(): on Windows, exiting while a fetch socket is still closing trips a libuv
 * assertion and the process dies with a non-zero code, which makes Claude Code ignore the hook's output.
 * Each hook is a main() that returns early instead; a finished hook exits by itself within ~50 ms.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export const HOME = process.env.CODEHUD_HOME ? path.resolve(process.env.CODEHUD_HOME) : path.join(os.homedir(), '.codehud');

/** Read the whole hook payload from stdin as JSON (null when absent or malformed). */
export async function readPayload() {
  let raw = '';
  for await (const chunk of process.stdin) raw += chunk;
  try { return JSON.parse(raw); } catch { return null; }
}

/** ~/.codehud/server.json, or null when no server has announced itself. */
export function readInfo() {
  try { return JSON.parse(fs.readFileSync(path.join(HOME, 'server.json'), 'utf8')); } catch { return null; }
}

/** GET /api/health with a short timeout; null when the server is down. */
export async function health(info, timeoutMs = 1500) {
  if (!info?.url) return null;
  try {
    const r = await fetch(`${info.url}/api/health`, { signal: AbortSignal.timeout(timeoutMs) });
    return r.ok ? await r.json() : null;
  } catch { return null; }
}

export async function api(info, method, route, body, timeoutMs = 5000) {
  const r = await fetch(info.url + route, {
    method,
    headers: { authorization: `Bearer ${info.token}`, ...(body !== undefined ? { 'content-type': 'application/json' } : {}) },
    body: body !== undefined ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(timeoutMs),
  });
  const text = await r.text();
  const data = text ? JSON.parse(text) : null;
  if (!r.ok) throw new Error(data?.error ?? `${r.status} ${route}`);
  return data;
}

/** Print a hook decision. The caller returns afterwards; the process ends on its own. */
export function emit(obj) {
  process.stdout.write(JSON.stringify(obj));
}
