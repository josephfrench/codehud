import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { SystemMap } from '../../schema/src/index.ts';
import { crawlDetailed, type CrawlResult } from '../src/crawl.ts';
import type { CrawlOptions } from '../src/types.ts';

export const FIXTURES = resolve(fileURLToPath(import.meta.url), '../../fixtures');
export const REPO_ROOT = resolve(fileURLToPath(import.meta.url), '../../../..');

export function fixture(name: string): string {
  return resolve(FIXTURES, name);
}

const cache = new Map<string, Promise<CrawlResult>>();

/** Crawl a fixture once per test run (options other than the default get their own entry). */
export function crawlFixture(name: string, opts: CrawlOptions = {}): Promise<CrawlResult> {
  const key = name + JSON.stringify(opts);
  let p = cache.get(key);
  if (!p) { p = crawlDetailed(fixture(name), opts); cache.set(key, p); }
  return p;
}

export function node(map: SystemMap, id: string) {
  const n = map.nodes.find((x) => x.id === id);
  assert.ok(n, `expected node ${id}; have:\n  ${map.nodes.map((x) => x.id).join('\n  ')}`);
  return n;
}

export function noNode(map: SystemMap, id: string) {
  assert.ok(!map.nodes.find((x) => x.id === id), `did not expect node ${id}`);
}

export function edge(map: SystemMap, kind: string, from: string, to: string) {
  const e = map.edges.find((x) => x.kind === kind && x.from === from && x.to === to);
  assert.ok(e, `expected edge ${kind}: ${from} -> ${to}; have:\n  ${map.edges.map((x) => `${x.kind}: ${x.from} -> ${x.to}`).join('\n  ')}`);
  return e;
}

export function noEdge(map: SystemMap, kind: string, from: string, to: string) {
  assert.ok(!map.edges.find((x) => x.kind === kind && x.from === from && x.to === to), `did not expect edge ${kind}: ${from} -> ${to}`);
}

export function laneOf(map: SystemMap, id: string): string | undefined {
  return node(map, id).lane;
}

export function stable(map: SystemMap): Omit<SystemMap, 'generatedAt'> {
  const { generatedAt: _g, ...rest } = map;
  void _g;
  return rest;
}
