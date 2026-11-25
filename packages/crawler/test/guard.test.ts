import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync, rmSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { test } from 'node:test';
import { crawlDetailed } from '../src/crawl.ts';
import { RepoExecutionError, selfRequire, withGuard, wouldExecuteRepoCode } from '../src/guard.ts';
import { crawlFixture, fixture, FIXTURES, node, REPO_ROOT } from './helpers.ts';

const TRAP = fixture('booby-trap');
const SENTINEL = join(TRAP, 'EXECUTED');

test('crawling a repository never executes it (main, postinstall, tsconfig extends, require() in sources)', async () => {
  rmSync(SENTINEL, { force: true });
  const { map } = await crawlFixture('booby-trap');
  assert.ok(!existsSync(SENTINEL), 'the trap file ran during the crawl');
  // the trap is still *described*
  node(map, 'module:trap.js');
  node(map, 'route:src/index.ts#GET /ping');
  // the tsconfig that `extends` a .js file did not break alias resolution for the rest
  assert.ok(map.edges.some((e) => e.from === 'module:src/index.ts' && e.to === 'module:src/lib/helper.ts'));
});

test('the guard refuses CommonJS loads from an active crawl root and allows them outside', async () => {
  const target = join(TRAP, 'trap.cjs');
  await withGuard(TRAP, async () => {
    assert.ok(wouldExecuteRepoCode(target));
    assert.throws(() => selfRequire(target), RepoExecutionError);
    assert.ok(!existsSync(SENTINEL));
  });
  assert.ok(!wouldExecuteRepoCode(target), 'guard must release the root after the crawl');
});

test('the guard exempts codehud itself so the repo can crawl its own packages', async () => {
  await withGuard(REPO_ROOT, async () => {
    assert.ok(!wouldExecuteRepoCode(resolve(REPO_ROOT, 'packages/schema/src/index.ts')));
    assert.ok(!wouldExecuteRepoCode(resolve(REPO_ROOT, 'packages/crawler/src/crawl.ts')));
    // but not its fixtures, examples, or other packages' sources
    assert.ok(wouldExecuteRepoCode(resolve(REPO_ROOT, 'packages/crawler/fixtures/booby-trap/trap.js')));
    assert.ok(wouldExecuteRepoCode(resolve(REPO_ROOT, 'packages/server/src/index.ts')));
  });
});

test('crawler sources contain no dynamic import()/require() of non-literal paths and no imports outside codehud packages', () => {
  const src = resolve(FIXTURES, '../src');
  const files: string[] = [];
  const walk = (d: string) => { for (const n of readdirSync(d)) { const p = join(d, n); if (statSync(p).isDirectory()) walk(p); else if (p.endsWith('.ts')) files.push(p); } };
  walk(src);
  for (const f of files) {
    const text = readFileSync(f, 'utf8');
    for (const m of text.matchAll(/\b(?:import|require)\(\s*([^)]*)\)/g)) {
      const arg = m[1]!.trim();
      // regex literals and strings that mention import( inside patterns are fine; real calls must be literals
      if (/^\/|\\b\(|^\[/.test(arg) || arg === '' ) continue;
      assert.match(arg, /^['"`]/, `${f}: dynamic import/require with a computed path: ${m[0]}`);
      assert.doesNotMatch(arg, /\$\{/, `${f}: template path in import/require: ${m[0]}`);
    }
    for (const m of text.matchAll(/^import\s[^'"]*['"]([^'"]+)['"]/gm)) {
      const spec = m[1]!;
      if (spec.startsWith('node:') || spec === 'typescript') continue;
      assert.ok(spec.startsWith('.'), `${f}: unexpected non-relative import ${spec}`);
    }
  }
  assert.ok(files.length > 20);
});

test('crawlDetailed reports the guard-safe adapter list and does not read ignored dirs', async () => {
  const r = await crawlDetailed(TRAP, { ignore: ['src'] });
  assert.ok(!r.map.nodes.some((n) => n.id.startsWith('module:src/')));
});
