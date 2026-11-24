// TODO: import from '@codehud/schema' once the workspace is installed.
import type { NodeKind } from '../../schema/src/index.ts';
import { CODE_EXTS, baseOf, dirOf, firstDocSentence, stripExt } from './fs.ts';
import { laneHintFromPath } from './lanes.ts';
import type { Draft, Framework, GroupKey, ResolvedOptions, SourceFile } from './types.ts';

export type Classified =
  | { kind: 'node'; draft: Draft; extra?: Draft[] }
  | { kind: 'config' }
  | { kind: 'test' }
  | { kind: 'attach'; toId: string; role: string; fallback: Draft }
  | { kind: 'skip' };

export interface ClassifyContext {
  frameworks: Set<Framework>;
  opts: ResolvedOptions;
}

const CONFIG_RE =
  /(^|\/)(astro|next|svelte|vite|vitest|drizzle|tailwind|postcss|playwright|eslint|prettier|remix|nuxt|tsup|rollup|webpack|jest|uno|panda)\.config\.(ts|js|mjs|cjs|mts|json)$|(^|\/)(wrangler\.(jsonc?|toml)|vercel\.json|netlify\.toml|package\.json|tsconfig(\.[\w-]+)?\.json|Dockerfile|docker-compose\.ya?ml|fly\.toml|render\.yaml|pnpm-workspace\.yaml|turbo\.json|nx\.json|alchemy\.run\.ts)$|(^|\/)\.github\/workflows\/[^/]+\.ya?ml$/;
const TEST_RE = /[.\-_](test|spec)\.[cm]?[jt]sx?$|(^|\/)(__tests__|tests?|e2e|spec|__mocks__)\//;
const SKIP_RE = /\.d\.ts$|\.stories\.[jt]sx?$|\.min\.js$|(^|\/)(\.storybook|storybook-static|public|static|fixtures)\//;
const HTTP_CLIENT_IDENTS = new Set([
  'fetch', 'axios', 'api', 'http', 'https', 'client', 'ky', 'got', 'superagent', 'request', 'agent', 'fetcher',
  'supertest', 'instance', 'httpClient', 'apiClient', '$fetch', 'ofetch', 'wretch', 'needle', 'res', 'response', 'headers',
]);
const HTTP_ROUTE_RE = /\b([A-Za-z_$][\w$]*)\.(get|post|put|patch|delete|options|head|all)\(\s*(['"`])(\/[^'"`\n]*)\3/g;
const EXPORTED_METHOD_RE = /export\s+(?:const|let|async\s+function|function)\s+(GET|POST|PUT|PATCH|DELETE|OPTIONS|HEAD|ALL)\b/g;
const METHODS_ORDER = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS', 'HEAD', 'ALL'];

function tidyRoute(segments: string[]): string {
  const kept = segments
    .filter((s) => s && !/^\(.*\)$/.test(s) && !s.startsWith('@'))
    .map((s) => s.replace(/^\$(\w+)$/, '[$1]').replace(/^\$$/, '[...rest]').replace(/^:(\w+)$/, '[$1]'));
  if (kept[kept.length - 1] === 'index') kept.pop();
  return '/' + kept.join('/');
}

function fileRef(rel: string, role = 'source') {
  return { path: rel, role };
}

function exportedMethods(text: string): string[] {
  const set = new Set<string>();
  for (const m of text.matchAll(EXPORTED_METHOD_RE)) set.add(m[1]!);
  return METHODS_ORDER.filter((m) => set.has(m));
}

/** `src/` root of the file's package (root-relative, trailing slash) or the package dir itself. */
export function srcRootOf(file: SourceFile): string {
  const pkgPrefix = file.pkg.dir ? file.pkg.dir + '/' : '';
  const within = file.rel.slice(pkgPrefix.length);
  if (within.startsWith('src/')) return pkgPrefix + 'src/';
  return pkgPrefix;
}

function pageDraft(rel: string, routePath: string, text: string, fw: Framework, group: GroupKey | undefined): Draft {
  const title = /\btitle\s*=\s*["']([^"'\n]{1,80})["']/.exec(text)?.[1] ?? /<title>([^<\n]{1,80})<\/title>/.exec(text)?.[1];
  const summary = title ? `${title}` : `Page ${routePath}`;
  return {
    id: `page:${rel}`,
    label: routePath,
    kind: 'page',
    layer: 'client',
    summary,
    files: [fileRef(rel)],
    tags: [fw],
    meta: { path: routePath, framework: fw },
    routePath,
    laneHint: laneHintFromPath(routePath),
    group,
    ownedFiles: [rel],
  };
}

function routeDraft(rel: string, routePath: string, text: string, fw: Framework, group: GroupKey | undefined): Draft {
  const methods = exportedMethods(text);
  const label = methods.length ? `${methods.join(', ')} ${routePath}` : routePath;
  return {
    id: `route:${rel}`,
    label,
    kind: 'route',
    layer: 'api',
    summary: firstDocSentence(text, /export\s+(?:const|let|async\s+function|function|default)\s/) ?? label,
    files: [fileRef(rel)],
    tags: [fw],
    meta: { method: methods.length === 1 ? methods[0] : methods, path: routePath, framework: fw },
    routePath,
    laneHint: laneHintFromPath(routePath),
    group,
    ownedFiles: [rel],
  };
}

function pageGroup(routePath: string, pagesDir: string, min: number): GroupKey | undefined {
  const first = routePath.split('/').filter(Boolean)[0];
  if (!first) return undefined;
  const prefix = `/${first}`;
  return {
    id: `pages:${prefix}`,
    label: `${prefix}/*`,
    kind: 'page',
    layer: 'client',
    laneHint: laneHintFromPath(prefix),
    dir: `${pagesDir}${first}/`,
    summaryNoun: 'pages',
    min,
  };
}

function routeGroup(routePath: string, apiDir: string, min: number): GroupKey | undefined {
  const segs = routePath.split('/').filter(Boolean);
  const idx = segs[0] === 'api' ? 1 : 0;
  const first = segs[idx];
  if (!first) return undefined;
  const prefix = '/' + segs.slice(0, idx + 1).join('/');
  return {
    id: `routes:${prefix}`,
    label: `${prefix}/*`,
    kind: 'route',
    layer: 'api',
    laneHint: laneHintFromPath(prefix),
    dir: `${apiDir}${segs.slice(0, idx + 1).join('/')}/`,
    summaryNoun: 'routes',
    min,
  };
}

function componentDraft(file: SourceFile, componentsDir: string, srcRoot: string, min: number): Draft {
  const relToComponents = file.rel.slice(componentsDir.length);
  const sub = relToComponents.includes('/') ? relToComponents.split('/')[0]! : '';
  const dir = sub ? `${componentsDir}${sub}/` : componentsDir;
  const label = dir.slice(srcRoot.length).replace(/\/$/, '') || dir.replace(/\/$/, '');
  const group: GroupKey = {
    id: `components:${dir}`,
    label,
    kind: 'component',
    layer: 'client',
    laneHint: laneHintFromPath(dir.slice(srcRoot.length)),
    dir,
    summaryNoun: 'components',
    min,
  };
  const ext = file.ext;
  const flavour = ext === 'svelte' ? 'Svelte' : ext === 'astro' ? 'Astro' : ext === 'vue' ? 'Vue' : ext === 'tsx' || ext === 'jsx' ? 'React' : 'UI';
  return {
    id: `component:${file.rel}`,
    label: stripExt(baseOf(file.rel)),
    kind: 'component',
    layer: 'client',
    // single-file components indent their script, so accept an indented doc block
    summary: firstDocSentence(file.text, /^(svelte|vue|astro)$/.test(ext) ? 'any' : undefined) ?? `${flavour} component`,
    files: [fileRef(file.rel)],
    group,
    laneHint: group.laneHint,
    ownedFiles: [file.rel],
  };
}

function moduleDraft(file: SourceFile, srcRoot: string, ctx: ClassifyContext): Draft {
  const within = file.rel.slice(srcRoot.length);
  const dirSegs = dirOf(within).split('/').filter(Boolean);
  const groupSegs = dirSegs.slice(0, 2);
  const dir = srcRoot + (groupSegs.length ? groupSegs.join('/') + '/' : '');
  const pathLower = file.rel.toLowerCase();
  const isClientExt = /^(svelte|vue|tsx|jsx)$/.test(file.ext);
  const clientDir = /(^|\/)(components|layouts|ui|stores|hooks|composables|client|islands)\//.test(within);
  const apiDir = /(^|\/)(routes|controllers|handlers|api|actions|functions|endpoints)\//.test(within) && file.pkg.role !== 'frontend';
  const serverAction = /^\s*['"]use server['"]/.test(file.text);
  const edge = /(^|\/)(middleware|middlewares|guards)\//.test(within);
  let layer: string;
  if (edge) layer = 'edge';
  else if (serverAction || apiDir) layer = 'api';
  else if (isClientExt || clientDir || file.pkg.role === 'frontend') layer = 'client';
  else if (file.pkg.role === 'server' && dirSegs.length === 0) layer = 'api'; // the entry of a server package
  else layer = 'domain';
  const service = /(^|\/)(services?|server|domain|core|usecases?|use-cases)\//.test(within) || /^lib\/[^/]+\//.test(within) || /^src\/lib\/[^/]+\//.test(within);
  const kind: NodeKind = layer === 'api' && !serverAction ? 'module' : service ? 'service' : 'module';
  const groupLabel = (dir.replace(/\/$/, '') || '.').replace(/^src\//, '').replace(/\/src$/, '') || 'src';
  const group: GroupKey = {
    id: `module:${dir}`,
    label: groupLabel,
    kind,
    layer,
    laneHint: laneHintFromPath(within.split('/').slice(0, -1).slice(0, 2).join('/')),
    dir,
    summaryNoun: 'modules',
    min: ctx.opts.dirGroupMin,
  };
  const labelBase = stripExt(baseOf(file.rel));
  const owningDir = groupSegs.length ? groupSegs[groupSegs.length - 1]! : file.pkg.dir.split('/').pop() || dirOf(file.rel).split('/').pop() || '';
  const label = groupSegs.length || /^(index|main|app|server)$/.test(labelBase) ? `${owningDir}/${labelBase}` : labelBase;
  const draft: Draft = {
    id: `${kind}:${file.rel}`,
    label,
    kind,
    layer,
    summary: firstDocSentence(file.text),
    files: [fileRef(file.rel)],
    tags: serverAction ? ['server-actions'] : undefined,
    group,
    laneHint: group.laneHint,
    ownedFiles: [file.rel],
  };
  if (pathLower.includes('/schema') || /(^|\/)schema\.[cm]?[jt]s$/.test(pathLower)) draft.tags = [...(draft.tags ?? []), 'schema'];
  return draft;
}

/** `app.get('/x', ...)` style routes declared in a module (Express, Hono, Fastify, Koa-router). */
function httpRoutes(file: SourceFile, owner: Draft, ctx: ClassifyContext): Draft[] {
  const serverFw = ['express', 'hono', 'fastify', 'koa'].some((f) => ctx.frameworks.has(f as Framework));
  const importsServer = /from\s+['"](express|hono|fastify|koa|@hono\/|@koa\/|itty-router|elysia)/.test(file.text);
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

export function classifyFile(file: SourceFile, ctx: ClassifyContext): Classified {
  const rel = file.rel;
  if (CONFIG_RE.test(rel)) return { kind: 'config' };
  if (!CODE_EXTS.has(file.ext) && !/^(md|mdx)$/.test(file.ext)) return { kind: 'skip' };
  if (SKIP_RE.test(rel)) return { kind: 'skip' };
  if (TEST_RE.test(rel)) return { kind: 'test' };

  const srcRoot = srcRootOf(file);
  const within = rel.slice(srcRoot.length);
  const pkgPrefix = file.pkg.dir ? file.pkg.dir + '/' : '';
  const withinPkg = rel.slice(pkgPrefix.length);
  const noExt = stripExt(within);
  const fwTag = (fw: Framework) => (ctx.frameworks.has(fw) ? fw : fw);

  // -- middleware / edge -----------------------------------------------------
  if (/^(src\/)?(middleware|proxy)\.[cm]?[jt]s$/.test(withinPkg) || /^src\/hooks\.server\.[jt]s$/.test(withinPkg)) {
    return {
      kind: 'node',
      draft: {
        id: `middleware:${rel}`,
        label: baseOf(noExt),
        kind: 'middleware',
        layer: 'edge',
        summary: firstDocSentence(file.text) ?? 'Request middleware',
        files: [fileRef(rel)],
        ownedFiles: [rel],
      },
    };
  }

  // -- Astro: src/pages -------------------------------------------------------
  if (within.startsWith('pages/') && (srcRoot.endsWith('src/') || ctx.frameworks.has('astro'))) {
    const sub = noExt.slice('pages/'.length);
    const segs = sub.split('/');
    if (segs.some((s) => s.startsWith('_'))) return { kind: 'skip' };
    const routePath = tidyRoute(segs);
    const isEndpoint = sub.startsWith('api/') || /^(ts|js|mts|mjs)$/.test(file.ext);
    const pagesDir = `${srcRoot}pages/`;
    if (isEndpoint) {
      return { kind: 'node', draft: routeDraft(rel, routePath, file.text, fwTag('astro'), routeGroup(routePath, pagesDir, ctx.opts.routeGroupMin)) };
    }
    if (/^(md|mdx)$/.test(file.ext) && !ctx.frameworks.has('astro')) return { kind: 'skip' };
    return { kind: 'node', draft: pageDraft(rel, routePath, file.text, fwTag('astro'), pageGroup(routePath, pagesDir, ctx.opts.routeGroupMin)) };
  }

  // -- Next.js app router -----------------------------------------------------
  const appMatch = /^((?:src\/)?app\/)(.*)$/.exec(withinPkg);
  if (appMatch && /^(tsx|jsx|ts|js|mdx)$/.test(file.ext)) {
    const appDir = pkgPrefix + appMatch[1]!;
    const sub = appMatch[2]!;
    const base = stripExt(baseOf(sub));
    const dirSegs = dirOf(sub).split('/');
    if (base === 'route') {
      const routePath = tidyRoute(dirSegs);
      return { kind: 'node', draft: routeDraft(rel, routePath, file.text, 'next', routeGroup(routePath, appDir, ctx.opts.routeGroupMin)) };
    }
    if (base === 'page') {
      const routePath = tidyRoute(dirSegs);
      return { kind: 'node', draft: pageDraft(rel, routePath, file.text, 'next', pageGroup(routePath, appDir, ctx.opts.routeGroupMin)) };
    }
    if (/^(layout|loading|error|not-found|template|default|global-error)$/.test(base)) {
      const draft = componentDraft(file, appDir, appDir, ctx.opts.dirGroupMin);
      draft.group = { id: `components:${appDir}`, label: 'app shell', kind: 'component', layer: 'client', dir: appDir, summaryNoun: 'layouts', min: ctx.opts.dirGroupMin };
      draft.label = `${dirSegs.filter(Boolean).pop() ?? 'root'} ${base}`;
      return { kind: 'node', draft };
    }
  }

  // -- Next.js pages router --------------------------------------------------
  if (ctx.frameworks.has('next') && /^(src\/)?pages\//.test(withinPkg)) {
    const sub = stripExt(withinPkg.replace(/^(src\/)?pages\//, ''));
    if (/^_(app|document|error)$/.test(sub)) return { kind: 'skip' };
    const routePath = tidyRoute(sub.split('/'));
    const pagesDir = pkgPrefix + (withinPkg.startsWith('src/') ? 'src/pages/' : 'pages/');
    if (sub.startsWith('api/')) return { kind: 'node', draft: routeDraft(rel, routePath, file.text, 'next', routeGroup(routePath, pagesDir, ctx.opts.routeGroupMin)) };
    return { kind: 'node', draft: pageDraft(rel, routePath, file.text, 'next', pageGroup(routePath, pagesDir, ctx.opts.routeGroupMin)) };
  }

  // -- SvelteKit: src/routes --------------------------------------------------
  if (within.startsWith('routes/') && srcRoot.endsWith('src/') && /^\+/.test(baseOf(rel))) {
    const routesDir = `${srcRoot}routes/`;
    const dirSegs = dirOf(within.slice('routes/'.length)).split('/');
    const routePath = tidyRoute(dirSegs);
    const base = baseOf(rel);
    if (base.startsWith('+server.')) return { kind: 'node', draft: routeDraft(rel, routePath, file.text, 'sveltekit', routeGroup(routePath, routesDir, ctx.opts.routeGroupMin)) };
    if (base === '+page.svelte') return { kind: 'node', draft: pageDraft(rel, routePath, file.text, 'sveltekit', pageGroup(routePath, routesDir, ctx.opts.routeGroupMin)) };
    if (/^\+page(\.server)?\.[jt]s$/.test(base)) {
      const fallback = routeDraft(rel, routePath, file.text, 'sveltekit', routeGroup(routePath, routesDir, ctx.opts.routeGroupMin));
      fallback.summary = `load/actions for ${routePath}`;
      return { kind: 'attach', toId: `page:${dirOf(rel)}/+page.svelte`, role: base.includes('.server') ? 'loader' : 'universal-loader', fallback };
    }
    if (/^\+layout/.test(base)) {
      const draft = componentDraft(file, routesDir, srcRoot, ctx.opts.dirGroupMin);
      draft.group = { id: `components:${routesDir}`, label: 'layouts', kind: 'component', layer: 'client', dir: routesDir, summaryNoun: 'layouts', min: ctx.opts.dirGroupMin };
      draft.label = `${routePath} layout`;
      return { kind: 'node', draft };
    }
    return { kind: 'skip' };
  }

  // -- Remix / React Router flat routes ---------------------------------------
  if (ctx.frameworks.has('remix') && /^app\/routes\//.test(withinPkg) && /^(tsx|jsx|ts|js|mdx)$/.test(file.ext)) {
    const sub = stripExt(withinPkg.slice('app/routes/'.length)).replace(/\/route$/, '');
    const segs = sub
      .split(/[./]/)
      .filter((s) => s && !/^_[a-z]/.test(s) || s === '_index')
      .map((s) => (s === '_index' ? 'index' : s.replace(/^\$(\w+)$/, '[$1]').replace(/^\$$/, '[...rest]')));
    const routePath = tidyRoute(segs);
    const routesDir = pkgPrefix + 'app/routes/';
    const isResource = !/export\s+default/.test(file.text);
    return {
      kind: 'node',
      draft: isResource
        ? routeDraft(rel, routePath, file.text, 'remix', routeGroup(routePath, routesDir, ctx.opts.routeGroupMin))
        : pageDraft(rel, routePath, file.text, 'remix', pageGroup(routePath, routesDir, ctx.opts.routeGroupMin)),
    };
  }

  if (/^(md|mdx)$/.test(file.ext)) return { kind: 'skip' };

  // -- Components / layouts ---------------------------------------------------
  const compMatch = /^((?:[\w.-]+\/)*?(?:components|layouts|ui|islands)\/)/.exec(within);
  if (compMatch) {
    const draft = componentDraft(file, srcRoot + compMatch[1]!, srcRoot, ctx.opts.dirGroupMin);
    // plain .ts/.js helpers inside components/ stay in the client layer next to their components
    if (/^(ts|js|mts|mjs|cts|cjs)$/.test(file.ext)) draft.summary = firstDocSentence(file.text) ?? 'Component helper';
    return { kind: 'node', draft };
  }

  // -- Generic module (lib/, server/, services/, anything else under src) ------
  const draft = moduleDraft(file, srcRoot, ctx);
  const routes = httpRoutes(file, draft, ctx);
  if (routes.length) {
    draft.layer = 'api';
    draft.kind = 'module';
    draft.id = `module:${rel}`;
    for (const r of routes) r.parent = draft.id;
    draft.group = undefined;
    draft.summary = draft.summary ?? `${routes.length} HTTP routes`;
    draft.tags = [...(draft.tags ?? []), 'router'];
    return { kind: 'node', draft, extra: routes };
  }
  return { kind: 'node', draft };
}
