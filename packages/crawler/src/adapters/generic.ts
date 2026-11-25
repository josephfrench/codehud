/**
 * The adapter of last resort for JS/TS: config and test files, root middleware, component
 * directories, generic modules, and `app.get('/x')` style routers (Express, Hono, Fastify, Koa).
 */
import { CODE_EXTS, baseOf, firstDocSentence, stripExt } from '../fs.ts';
import { laneHintFromPath } from '../lanes.ts';
import type { Adapter, Classified, CrawlContext, Draft, SourceFile } from '../types.ts';
import { componentDraft, fileRef, moduleDraft, srcRootOf, tidyRoute } from './drafts.ts';

export const CONFIG_RE =
  /(^|\/)(astro|next|svelte|vite|vitest|drizzle|tailwind|postcss|playwright|eslint|prettier|remix|nuxt|tsup|rollup|webpack|jest|uno|panda|nest-cli|angular|capacitor|expo|babel|cypress|karma|protractor|sequelize|typeorm|knexfile|mikro-orm|prisma|commitlint|lint-staged|release|changeset|biome|oxlint|stylelint|tsdown|rspack|rsbuild|farm|turbo|wxt|electron\.vite|electron-builder|forge)\.config\.(ts|js|mjs|cjs|mts|json)$|(^|\/)(wrangler\.(jsonc?|toml)|vercel\.json|netlify\.toml|package\.json|tsconfig(\.[\w-]+)?\.json|jsconfig\.json|Dockerfile|docker-compose(\.[\w-]+)?\.ya?ml|compose(\.[\w-]+)?\.ya?ml|fly\.toml|render\.yaml|railway\.(json|toml)|pnpm-workspace\.yaml|turbo\.json|nx\.json|project\.json|angular\.json|nest-cli\.json|alchemy\.run\.ts|serverless\.ya?ml|template\.ya?ml|samconfig\.toml|cdk\.json|pyproject\.toml|requirements(-[\w]+)?\.txt|Pipfile|setup\.(py|cfg)|manage\.py|wsgi\.py|asgi\.py|settings\.py|\.env(\.[\w-]+)?\.example|Procfile|app\.ya?ml|firebase\.json|supabase\/config\.toml)$|(^|\/)\.github\/workflows\/[^/]+\.ya?ml$/;
export const TEST_RE = /[.\-_](test|spec)\.[cm]?[jt]sx?$|[._]test\.py$|(^|\/)test_[\w]+\.py$|(^|\/)(__tests__|tests?|e2e|spec|__mocks__|cypress)\//;
export const SKIP_RE = /\.d\.ts$|\.stories\.[jt]sx?$|\.min\.js$|(^|\/)(\.storybook|storybook-static|public|static|fixtures|migrations|__pycache__|\.venv|venv)\/|(^|\/)(polyfills|test-setup|setup-jest)\.[jt]s$/;

export const HTTP_CLIENT_IDENTS = new Set([
  'fetch', 'axios', 'api', 'http', 'https', 'client', 'ky', 'got', 'superagent', 'request', 'agent', 'fetcher',
  'supertest', 'instance', 'httpClient', 'apiClient', '$fetch', 'ofetch', 'wretch', 'needle', 'res', 'response', 'headers',
]);
const HTTP_ROUTE_RE = /\b([A-Za-z_$][\w$]*)\.(get|post|put|patch|delete|options|head|all)\(\s*(['"`])(\/[^'"`\n]*)\3/g;

/** `app.get('/x', ...)` style routes declared in a module (Express, Hono, Fastify, Koa-router). */
export function httpRoutes(file: SourceFile, owner: Draft, ctx: CrawlContext): Draft[] {
  const serverFw = (['express', 'hono', 'fastify', 'koa'] as const).some((f) => ctx.frameworks.has(f));
  const importsServer = /from\s+['"](express|hono|fastify|koa|@hono\/|@koa\/|itty-router|elysia)/.test(file.text) || /require\(\s*['"](express|hono|fastify|koa)['"]\s*\)/.test(file.text);
  if (!serverFw && !importsServer) return [];
  const out: Draft[] = [];
  const seen = new Set<string>();
  for (const m of file.text.matchAll(HTTP_ROUTE_RE)) {
    const ident = m[1]!;
    if (HTTP_CLIENT_IDENTS.has(ident)) continue;
    const method = m[2]!.toUpperCase();
    const path = m[4]!.replace(/\/+$/, '') || '/';
    const key = `${method} ${path}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const routePath = tidyRoute(path.split('/'));
    out.push({
      id: `route:${file.rel}#${method} ${routePath}`,
      label: key,
      kind: 'route',
      layer: 'api',
      parent: owner.id,
      summary: key,
      files: [fileRef(file.rel)],
      meta: { method, path: routePath, declaredIn: ident },
      routePath,
      laneHint: laneHintFromPath(routePath),
      ownedFiles: [],
    });
    if (out.length >= 24) break;
  }
  return out;
}

/** Shared pre-filter: config / test / skip decisions every JS adapter agrees on. undefined = a real source file. */
export function preClassify(file: SourceFile): Classified | undefined {
  const rel = file.rel;
  if (CONFIG_RE.test(rel)) return { kind: 'config' };
  if (!CODE_EXTS.has(file.ext) && !/^(md|mdx)$/.test(file.ext)) return { kind: 'skip' };
  if (SKIP_RE.test(rel)) return { kind: 'skip' };
  if (TEST_RE.test(rel)) return { kind: 'test' };
  return undefined;
}

export function middlewareFile(file: SourceFile): Classified | undefined {
  const withinPkg = file.rel.slice(file.pkg.dir ? file.pkg.dir.length + 1 : 0);
  if (/^(src\/)?(middleware|proxy)\.[cm]?[jt]s$/.test(withinPkg) || /^src\/hooks\.server\.[jt]s$/.test(withinPkg)) {
    return {
      kind: 'node',
      draft: {
        id: `middleware:${file.rel}`,
        label: stripExt(baseOf(file.rel)),
        kind: 'middleware',
        layer: 'edge',
        summary: firstDocSentence(file.text) ?? 'Request middleware',
        files: [fileRef(file.rel)],
        ownedFiles: [file.rel],
      },
    };
  }
  return undefined;
}

export const generic: Adapter = {
  id: 'generic',
  priority: -100,
  detect: () => true,
  classify(file, ctx) {
    const pre = preClassify(file);
    if (pre) return pre;
    const mw = middlewareFile(file);
    if (mw) return mw;
    if (/^(md|mdx)$/.test(file.ext)) return { kind: 'skip' };
    const srcRoot = srcRootOf(file);
    const within = file.rel.slice(srcRoot.length);

    // -- Components / layouts -------------------------------------------------
    const compMatch = /^((?:[\w.-]+\/)*?(?:components|layouts|ui|islands)\/)/.exec(within);
    if (compMatch) {
      const draft = componentDraft(file, srcRoot + compMatch[1]!, srcRoot, ctx.opts.dirGroupMin);
      // plain .ts/.js helpers inside components/ stay in the client layer next to their components
      if (/^(ts|js|mts|mjs|cts|cjs)$/.test(file.ext)) draft.summary = firstDocSentence(file.text) ?? 'Component helper';
      return { kind: 'node', draft };
    }

    // -- Generic module (lib/, server/, services/, anything else under src) ----
    const draft = moduleDraft(file, srcRoot, ctx);
    const routes = httpRoutes(file, draft, ctx);
    if (routes.length) {
      draft.layer = 'api';
      draft.kind = 'module';
      draft.id = `module:${file.rel}`;
      for (const r of routes) r.parent = draft.id;
      draft.group = undefined;
      draft.summary = draft.summary ?? `${routes.length} HTTP routes`;
      draft.tags = [...(draft.tags ?? []), 'router'];
      return { kind: 'node', draft, extra: routes };
    }
    return { kind: 'node', draft };
  },
};
