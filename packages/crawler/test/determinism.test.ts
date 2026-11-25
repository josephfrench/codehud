import assert from 'node:assert/strict';
import { test } from 'node:test';
import { validateSystemMap } from '../../schema/src/index.ts';
import { crawlDetailed } from '../src/crawl.ts';
import { ADAPTERS } from '../src/adapters/index.ts';
import { fixture, stable } from './helpers.ts';

const ALL = ['angular-app', 'nuxt-app', 'react-spa', 'tanstack-app', 'nest-api', 'serverless-aws', 'sam-app', 'cdk-app', 'terraform-infra', 'compose-app', 'sequelize-app', 'supabase-app', 'python-fastapi', 'django-app', 'monorepo', 'booby-trap'];

test('every fixture crawls twice to byte-identical output (minus generatedAt) and validates', async () => {
  for (const name of ALL) {
    const a = await crawlDetailed(fixture(name));
    const b = await crawlDetailed(fixture(name));
    assert.deepEqual(stable(a.map), stable(b.map), `${name} is not deterministic`);
    assert.equal(JSON.stringify(stable(a.map)), JSON.stringify(stable(b.map)), `${name}: key order differs`);
    const v = validateSystemMap(a.map);
    assert.ok(v.ok, `${name}: ${v.ok ? '' : v.errors.join('; ')}`);
    // every node sits in a known layer and every edge in a known node
    const ids = new Set(a.map.nodes.map((n) => n.id));
    for (const e of a.map.edges) assert.ok(ids.has(e.from) && ids.has(e.to), `${name}: dangling edge ${e.id}`);
    for (const n of a.map.nodes) if (n.parent) assert.ok(ids.has(n.parent), `${name}: dangling parent on ${n.id}`);
  }
});

test('adapter ids are unique and the generic adapter is always last', () => {
  const ids = ADAPTERS.map((a) => a.id);
  assert.equal(new Set(ids).size, ids.length);
  assert.equal(ids[ids.length - 1], 'generic');
});

test('--no-ts falls back to the regex scanner with the same nodes', async () => {
  const ts = await crawlDetailed(fixture('react-spa'));
  const rx = await crawlDetailed(fixture('react-spa'), { typescript: false });
  assert.ok(ts.tsImports && !rx.tsImports);
  assert.deepEqual(rx.map.nodes.map((n) => n.id).sort(), ts.map.nodes.map((n) => n.id).sort());
});
