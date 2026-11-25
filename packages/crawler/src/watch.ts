/**
 * `--watch`: re-crawl when files change (debounced), write the map when it differs, and push it
 * to a running codehud server (`~/.codehud/server.json`) so the HUD updates live.
 */
import { existsSync, readFileSync, watch, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import type { SystemMap } from '../../schema/src/index.ts';
import { crawlDetailed, type CrawlResult } from './crawl.ts';
import { IGNORED_DIRS, posix } from './fs.ts';
import type { CrawlOptions } from './types.ts';

interface ServerInfo { host: string; port: number; url: string; token: string }

export function readServerInfo(): ServerInfo | undefined {
  try {
    const info = JSON.parse(readFileSync(join(homedir(), '.codehud', 'server.json'), 'utf8')) as ServerInfo;
    return info && info.url && info.token ? info : undefined;
  } catch {
    return undefined;
  }
}

/** Load a map into the running server: by path when the server can read it (keeps the map root for file views), else by body. */
export async function pushMap(map: SystemMap, outFile: string | undefined, info = readServerInfo()): Promise<string> {
  if (!info) return 'no running codehud server (~/.codehud/server.json missing)';
  const headers = { authorization: `Bearer ${info.token}`, 'content-type': 'application/json' };
  try {
    const r = outFile
      ? await fetch(`${info.url}/api/map/load`, { method: 'POST', headers, body: JSON.stringify({ path: resolve(outFile) }) })
      : await fetch(`${info.url}/api/map`, { method: 'PUT', headers, body: JSON.stringify(map) });
    if (!r.ok) return `server refused the map: ${r.status} ${await r.text()}`;
    return `pushed to ${info.url}`;
  } catch (e: any) {
    return `could not reach ${info.url}: ${e.message}`;
  }
}

export function stableJson(map: SystemMap): string {
  const { generatedAt: _g, ...rest } = map;
  void _g;
  return JSON.stringify(rest);
}

export interface WatchOptions {
  root: string;
  out?: string;
  crawl: CrawlOptions;
  push: boolean;
  debounceMs?: number;
  log: (msg: string) => void;
  onResult?: (r: CrawlResult) => void;
}

export function startWatch(o: WatchOptions): () => void {
  const root = resolve(o.root);
  const ignore = new Set([...IGNORED_DIRS, ...(o.crawl.ignore ?? [])]);
  let timer: NodeJS.Timeout | null = null;
  let running = false;
  let dirty = false;
  let last = '';
  if (o.out && existsSync(o.out)) { try { last = stableJson(JSON.parse(readFileSync(o.out, 'utf8'))); } catch { /* ignore */ } }

  const run = async () => {
    if (running) { dirty = true; return; }
    running = true;
    try {
      const started = Date.now();
      const r = await crawlDetailed(root, o.crawl);
      const json = stableJson(r.map);
      if (json === last) { o.log(`no change (${Date.now() - started} ms)`); }
      else {
        last = json;
        if (o.out) writeFileSync(o.out, JSON.stringify(r.map, null, 2) + '\n');
        o.log(`${r.map.nodes.length} nodes, ${r.map.edges.length} edges, ${r.map.lanes.length} lanes (${Date.now() - started} ms)${o.out ? ` → ${o.out}` : ''}`);
        if (o.push) o.log(await pushMap(r.map, o.out));
      }
      o.onResult?.(r);
    } catch (e: any) {
      o.log(`crawl failed: ${e.message}`);
    } finally {
      running = false;
      if (dirty) { dirty = false; schedule(); }
    }
  };
  const schedule = () => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(run, o.debounceMs ?? 400);
  };
  const watcher = watch(root, { recursive: true }, (_event, filename) => {
    if (!filename) return schedule();
    const rel = posix(String(filename));
    if (rel.split('/').some((seg) => ignore.has(seg))) return;
    if (o.out && resolve(root, rel) === resolve(o.out)) return;
    schedule();
  });
  void run();
  return () => { watcher.close(); if (timer) clearTimeout(timer); };
}
