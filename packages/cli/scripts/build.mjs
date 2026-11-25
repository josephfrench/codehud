/**
 * Builds the publishable `codehud` package into packages/cli/dist:
 *   dist/cli.js      the bin (this CLI)
 *   dist/server.js   the local server      (packages/server)
 *   dist/mcp.js      the MCP stdio bridge  (packages/mcp)
 *   dist/crawler.js  the crawler library   (packages/crawler)
 *   dist/hud/        the built browser HUD (packages/hud/dist)
 *   templates/       hook + CLAUDE.md snippet (copied from /templates)
 *
 * Everything under node_modules stays external (declared in dependencies); workspace code is bundled.
 * Two path constants in server/mcp sources point at sibling workspace folders; they are rewritten at
 * bundle time so the installed layout works. The rewrite asserts the exact source text, so a change in
 * those files fails the build loudly instead of shipping a broken package.
 */
import { build } from 'esbuild';
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { execSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const pkgDir = path.resolve(here, '..');
const repo = path.resolve(pkgDir, '../..');
const dist = path.join(pkgDir, 'dist');
const hudDist = path.join(repo, 'packages/hud/dist');

if (!process.argv.includes('--no-hud')) {
  execSync('pnpm --filter @codehud/hud build', { cwd: repo, stdio: 'inherit' });
}
if (!existsSync(path.join(hudDist, 'index.html'))) throw new Error(`HUD build missing at ${hudDist}`);

rmSync(dist, { recursive: true, force: true });
mkdirSync(dist, { recursive: true });

const REWRITES = [
  { file: path.join(repo, 'packages/server/src/index.ts'), from: "path.resolve(here, '../../hud/dist')", to: "path.resolve(here, 'hud')" },
  { file: path.join(repo, 'packages/mcp/src/index.ts'), from: "path.resolve(here, '../../server/src/index.ts')", to: "path.resolve(here, 'server.js')" },
].map((r) => ({ ...r, file: path.normalize(r.file) }));

const rewritePaths = {
  name: 'codehud-rewrite-paths',
  setup(b) {
    b.onLoad({ filter: /[\\/]packages[\\/](server|mcp)[\\/]src[\\/]index\.ts$/ }, (args) => {
      let contents = readFileSync(args.path, 'utf8');
      for (const r of REWRITES) {
        if (path.normalize(args.path) !== r.file) continue;
        if (!contents.includes(r.from)) throw new Error(`${r.file}: expected to find ${r.from}`);
        contents = contents.replace(r.from, r.to);
      }
      return { contents, loader: 'ts' };
    });
  },
};

await build({
  entryPoints: {
    cli: path.join(pkgDir, 'src/cli.ts'),
    server: path.join(repo, 'packages/server/src/index.ts'),
    mcp: path.join(repo, 'packages/mcp/src/index.ts'),
    crawler: path.join(repo, 'packages/crawler/src/index.ts'),
  },
  outdir: dist,
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node22',
  packages: 'external',
  sourcemap: false,
  legalComments: 'none',
  logLevel: 'info',
  plugins: [rewritePaths],
});

cpSync(hudDist, path.join(dist, 'hud'), { recursive: true });
rmSync(path.join(pkgDir, 'templates'), { recursive: true, force: true });
cpSync(path.join(repo, 'templates'), path.join(pkgDir, 'templates'), { recursive: true });
writeFileSync(path.join(dist, 'BUILD.json'), JSON.stringify({ builtAt: new Date().toISOString(), node: process.version }, null, 2));
console.log(`codehud package built in ${dist}`);
