import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { SystemMap } from '../../schema/src/index.ts';
import { applyOverlay, overlayTemplate } from '../src/overlay.ts';
import { crawlFixture, edge, laneOf, node, noNode, REPO_ROOT } from './helpers.ts';
import { crawlDetailed } from '../src/crawl.ts';

test('monorepo without routes: one lane per workspace package', async () => {
  const { map } = await crawlFixture('monorepo', { overlay: false });
  assert.deepEqual(map.lanes.map((l) => l.id), ['api', 'shared', 'web']); // workspace order (packages/* sorted)
  assert.equal(laneOf(map, 'components:packages/web/src/components/'), 'web');
  assert.equal(laneOf(map, 'module:packages/api/src/index.ts'), 'api');
  assert.equal(laneOf(map, 'module:packages/shared/src/'), 'shared');
  // workspace package imports resolve across packages
  edge(map, 'imports', 'module:packages/api/src/index.ts', 'module:packages/shared/src/index.ts');
  edge(map, 'calls', 'module:packages/web/src/main.tsx', 'route:packages/api/src/index.ts#GET /api/orders');
  node(map, 'module:packages/api/src/legacy.ts');
});

test('overlay: .codehud/map.overrides.json renames, merges lanes, hides nodes, adds nodes and edges', async () => {
  const { map, overlayApplied, warnings } = await crawlFixture('monorepo');
  assert.ok(overlayApplied);
  assert.deepEqual(warnings, []);
  assert.equal(map.name, 'Acme (overlaid)');
  assert.deepEqual(map.lanes.map((l) => l.id), ['api', 'web']);
  assert.equal(laneOf(map, 'module:packages/shared/src/'), 'api');
  assert.equal(node(map, 'module:packages/shared/src/money.ts').summary, 'Shared types used by web and api');
  noNode(map, 'module:packages/api/src/legacy.ts');
  node(map, 'external:bank');
  edge(map, 'calls', 'module:packages/api/src/index.ts', 'external:bank');
});

test('applyOverlay: hidden nodes reparent children and lift edges; unknown ids are warnings, not errors', () => {
  const map: SystemMap = {
    version: 1, name: 'x', layers: [{ id: 'domain', label: 'Domain' }], lanes: [{ id: 'a', label: 'A' }, { id: 'b', label: 'B' }],
    nodes: [
      { id: 'g', label: 'group', kind: 'module', layer: 'domain', lane: 'a' },
      { id: 'g/x', label: 'x', kind: 'module', layer: 'domain', parent: 'g', lane: 'a' },
      { id: 'g/x/leaf', label: 'leaf', kind: 'function', layer: 'domain', parent: 'g/x', lane: 'a' },
      { id: 'y', label: 'y', kind: 'service', layer: 'domain', lane: 'b' },
    ],
    edges: [{ id: 'imports:y->g/x', from: 'y', to: 'g/x', kind: 'imports' }, { id: 'calls:g/x->y', from: 'g/x', to: 'y', kind: 'calls' }],
  };
  const { map: out, warnings } = applyOverlay(map, {
    lanes: { b: { mergeInto: 'a' }, zzz: { label: 'nope' } },
    nodes: { 'g/x': { hide: true }, 'g/*': { tags: ['grp'] }, nope: { label: 'x' } },
    removeEdges: ['nothing'],
  });
  assert.ok(!out.nodes.some((n) => n.id === 'g/x'));
  assert.equal(out.nodes.find((n) => n.id === 'g/x/leaf')?.parent, 'g');
  assert.deepEqual(out.edges.map((e) => `${e.kind}:${e.from}->${e.to}`).sort(), ['calls:g->y', 'imports:y->g']);
  assert.equal(out.nodes.find((n) => n.id === 'y')?.lane, 'a');
  assert.deepEqual(out.lanes.map((l) => l.id), ['a']);
  assert.ok(out.nodes.find((n) => n.id === 'g/x/leaf')?.tags?.includes('grp')); // 'g/*' is a prefix match on g/
  assert.ok(!out.nodes.find((n) => n.id === 'g')?.tags?.includes('grp'));
  assert.equal(warnings.length, 3);
  const tpl = overlayTemplate(out);
  assert.equal(tpl.version, 1);
  assert.ok('g' in tpl.nodes!);
});

test('codehud itself: workspace packages become lanes, TypeScript import graph, exports summarised', async () => {
  const { map, tsImports } = await crawlDetailed(REPO_ROOT, { ignore: ['fixtures'] });
  assert.ok(tsImports);
  const lanes = map.lanes.map((l) => l.id);
  for (const l of ['schema', 'server', 'hud', 'mcp', 'crawler']) assert.ok(lanes.includes(l), `lane ${l} in ${lanes}`);
  const guard = map.nodes.find((n) => n.id === 'module:packages/crawler/src/guard.ts' || n.id === 'module:packages/crawler/src/+more');
  assert.ok(guard);
  assert.equal(map.nodes.find((n) => n.id === 'module:packages/hud/src/lib/anchor.ts')?.lane, 'hud');
});
