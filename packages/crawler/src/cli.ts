#!/usr/bin/env node
/**
 * node packages/crawler/src/cli.ts <repoRoot> [--out file.json] [--name x]
 *   [--max-children 12] [--max-lanes 8] [--no-tests] [--no-low-confidence] [--no-ts] [--no-overlay]
 *   [--adapters a,b] [--write-overlay-template] [--watch] [--push] [--quiet]
 * Prints the SystemMap JSON to stdout when --out is omitted; a short summary always goes to stderr.
 */
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { crawlDetailed } from './crawl.ts';
import { OVERLAY_PATH, overlayTemplate } from './overlay.ts';
import type { CrawlOptions } from './types.ts';
import { pushMap, startWatch } from './watch.ts';

function usage(code: number): never {
  process.stderr.write(
    'usage: codehud-crawl <repoRoot> [--out file.json] [--name name] [--max-children n] [--max-lanes n]\n' +
      '       [--no-tests] [--no-low-confidence] [--no-ts] [--no-overlay] [--adapters a,b] [--ignore dir,dir]\n' +
      '       [--write-overlay-template] [--watch] [--push] [--quiet]\n' +
      '  --write-overlay-template  write .codehud/map.overrides.json (a starter you edit) and exit\n' +
      '  --watch                   re-crawl on file changes; with --out, rewrite the file when the map changes\n' +
      '  --push                    load the map into the running codehud server (~/.codehud/server.json)\n',
  );
  process.exit(code);
}

const args = process.argv.slice(2);
if (!args.length || args.includes('-h') || args.includes('--help')) usage(args.length ? 0 : 1);

let root: string | undefined;
let out: string | undefined;
let quiet = false;
let watchMode = false;
let push = false;
let writeTemplate = false;
const opts: CrawlOptions = {};
for (let i = 0; i < args.length; i++) {
  const a = args[i]!;
  const next = () => {
    const v = args[++i];
    if (v === undefined) usage(1);
    return v;
  };
  if (a === '--out' || a === '-o') out = next();
  else if (a === '--name') opts.name = next();
  else if (a === '--max-children') opts.maxChildren = Number(next());
  else if (a === '--max-lanes') opts.maxLanes = Number(next());
  else if (a === '--no-tests') opts.includeTests = false;
  else if (a === '--no-low-confidence') opts.lowConfidenceEdges = false;
  else if (a === '--no-ts') opts.typescript = false;
  else if (a === '--no-overlay') opts.overlay = false;
  else if (a === '--adapters') opts.adapters = next().split(',').map((s) => s.trim()).filter(Boolean);
  else if (a === '--ignore') opts.ignore = next().split(',').map((s) => s.trim()).filter(Boolean);
  else if (a === '--write-overlay-template') writeTemplate = true;
  else if (a === '--watch' || a === '-w') watchMode = true;
  else if (a === '--push') push = true;
  else if (a === '--quiet' || a === '-q') quiet = true;
  else if (a.startsWith('-')) usage(1);
  else if (!root) root = a;
  else usage(1);
}
if (!root) usage(1);

// `codehud-crawl . | head` must not crash with EPIPE once the reader closes
process.stdout.on('error', (err: NodeJS.ErrnoException) => {
  if (err.code === 'EPIPE') process.exit(0);
  throw err;
});

const log = (msg: string) => { if (!quiet) process.stderr.write(msg + '\n'); };

if (watchMode) {
  log(`watching ${resolve(root)} (ctrl-c to stop)`);
  const stop = startWatch({ root, out, crawl: opts, push, log: (m) => log(`[${new Date().toISOString().slice(11, 19)}] ${m}`) });
  process.on('SIGINT', () => { stop(); process.exit(0); });
} else {
  const started = Date.now();
  const result = await crawlDetailed(root, opts);
  const map = result.map;
  const json = JSON.stringify(map, null, 2) + '\n';

  if (!quiet) {
    const byLayer = new Map<string, number>();
    for (const n of map.nodes) byLayer.set(n.layer, (byLayer.get(n.layer) ?? 0) + 1);
    const topLevel = map.nodes.filter((n) => !n.parent).length;
    const byKind = new Map<string, number>();
    for (const e of map.edges) byKind.set(e.kind, (byKind.get(e.kind) ?? 0) + 1);
    process.stderr.write(
      [
        `${map.name}: ${map.nodes.length} nodes (${topLevel} top-level), ${map.edges.length} edges, ${map.lanes.length} lanes (${Date.now() - started} ms)`,
        `  adapters: ${result.adapters.join(', ')}${result.tsImports ? ' · imports via TypeScript' : ' · imports via regex'}${result.overlayApplied ? ' · overlay applied' : ''}`,
        `  lanes:  ${map.lanes.map((l) => l.id).join(', ') || '(none)'}`,
        `  layers: ${[...byLayer.entries()].map(([k, v]) => `${k}=${v}`).join(' ')}`,
        `  edges:  ${[...byKind.entries()].map(([k, v]) => `${k}=${v}`).join(' ')}`,
        ...result.warnings.map((w) => `  overlay: ${w}`),
        '',
      ].join('\n'),
    );
  }

  if (writeTemplate) {
    const file = join(resolve(root), OVERLAY_PATH);
    if (existsSync(file)) { process.stderr.write(`${file} already exists; not overwriting\n`); process.exit(2); }
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, JSON.stringify(overlayTemplate(map), null, 2) + '\n');
    log(`wrote ${file}`);
  } else if (out) {
    const abs = resolve(out);
    mkdirSync(dirname(abs), { recursive: true });
    writeFileSync(abs, json);
    log(`wrote ${abs}`);
  } else if (!push) {
    process.stdout.write(json);
  }
  if (push) log(await pushMap(map, out));
}
