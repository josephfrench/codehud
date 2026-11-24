#!/usr/bin/env node
/**
 * node packages/crawler/src/cli.ts <repoRoot> [--out file.json] [--name x]
 *   [--max-children 12] [--max-lanes 8] [--no-tests] [--no-low-confidence]
 * Prints the SystemMap JSON to stdout when --out is omitted; a short summary always goes to stderr.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { crawl, type CrawlOptions } from './index.ts';

function usage(code: number): never {
  process.stderr.write(
    'usage: codehud-crawl <repoRoot> [--out file.json] [--name name] [--max-children n] [--max-lanes n] [--no-tests] [--no-low-confidence] [--quiet]\n',
  );
  process.exit(code);
}

const args = process.argv.slice(2);
if (!args.length || args.includes('-h') || args.includes('--help')) usage(args.length ? 0 : 1);

let root: string | undefined;
let out: string | undefined;
let quiet = false;
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

const map = await crawl(root, opts);
const json = JSON.stringify(map, null, 2) + '\n';

if (!quiet) {
  const byLayer = new Map<string, number>();
  for (const n of map.nodes) byLayer.set(n.layer, (byLayer.get(n.layer) ?? 0) + 1);
  const topLevel = map.nodes.filter((n) => !n.parent).length;
  const byKind = new Map<string, number>();
  for (const e of map.edges) byKind.set(e.kind, (byKind.get(e.kind) ?? 0) + 1);
  process.stderr.write(
    [
      `${map.name}: ${map.nodes.length} nodes (${topLevel} top-level), ${map.edges.length} edges, ${map.lanes.length} lanes`,
      `  lanes:  ${map.lanes.map((l) => l.id).join(', ') || '(none)'}`,
      `  layers: ${[...byLayer.entries()].map(([k, v]) => `${k}=${v}`).join(' ')}`,
      `  edges:  ${[...byKind.entries()].map(([k, v]) => `${k}=${v}`).join(' ')}`,
      '',
    ].join('\n'),
  );
}

if (out) {
  const abs = resolve(out);
  mkdirSync(dirname(abs), { recursive: true });
  writeFileSync(abs, json);
  if (!quiet) process.stderr.write(`wrote ${abs}\n`);
} else {
  process.stdout.write(json);
}
