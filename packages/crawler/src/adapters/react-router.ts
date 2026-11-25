/**
 * React SPA routers: react-router (`createBrowserRouter([...])`, `<Route>` trees), TanStack Router
 * (file routes under `src/routes/`, `createFileRoute('/x')`, code routes). Pages are the component
 * files the router points at; `src/pages/**` without a router is handled by the astro adapter.
 */
import { baseOf, dirOf, firstDocSentence, stripExt } from '../fs.ts';
import type { Adapter, Draft } from '../types.ts';
import { componentDraft, dirGroup, pageDraft, pageGroup, srcRootOf, tidyRoute } from './drafts.ts';
import { preClassify } from './generic.ts';
import { jsxRoutesIn, routeArraysIn } from './route-tables.ts';

/** TanStack file route → URL: `posts.$postId.tsx` → /posts/[postId]; `_layout` pathless; `(group)` ignored. */
function tanstackPath(sub: string): string | undefined {
  const base = stripExt(sub).replace(/\/route$/, '').replace(/\/index$/, '').replace(/^index$/, '');
  if (base === '__root' || /(^|[./])__root$/.test(base)) return undefined;
  const segs = base
    .split(/[./]/)
    .filter((s) => s && !/^_/.test(s) && !/^\(.*\)$/.test(s))
    .map((s) => s.replace(/^\$(\w+)$/, '[$1]').replace(/^\$$/, '[...rest]').replace(/_$/, ''));
  return tidyRoute(segs);
}

export const reactRouter: Adapter = {
  id: 'react-router',
  priority: 58,
  detect: (ctx) => ctx.frameworks.has('react-router') || ctx.frameworks.has('tanstack-router') || ctx.hasFile(/(^|\/)src\/routes\/__root\.tsx$/),
  prepare(ctx) {
    const pages = new Map<string, string[]>();
    const add = (file: string, path: string) => (pages.get(file) ?? pages.set(file, []).get(file)!).push(path);
    for (const f of ctx.sources) {
      if (!/\b(createBrowserRouter|createHashRouter|createMemoryRouter|createRoutesFromElements|<Route\b|createRoute\(|RouteObject)/.test(f.text)) continue;
      for (const h of routeArraysIn(f, ctx)) if (h.file && !h.layout) add(h.file, h.path);
      for (const h of jsxRoutesIn(f, ctx)) if (h.file && !h.layout) add(h.file, h.path);
      // TanStack code-based: createRoute({ getParentRoute, path: '/x', component: X })
      for (const m of f.text.matchAll(/createRoute\(\s*\{([\s\S]*?)\}\s*\)/g)) {
        const path = /\bpath\s*:\s*(['"`])([^'"`]*)\1/.exec(m[1]!)?.[2];
        const sym = /\bcomponent\s*:\s*([A-Z][\w$]*)/.exec(m[1]!)?.[1];
        if (!path || !sym) continue;
        const imp = (ctx.importsOf.get(f.rel) ?? []).find((i) => i.names.includes(sym) && i.file);
        if (imp?.file) add(imp.file, tidyRoute(path.split('/')));
      }
    }
    ctx.scratch.set('react-router.pages', pages);
  },
  classify(file, ctx) {
    const pre = preClassify(file);
    if (pre) return pre;
    if (!/^(tsx|jsx|ts|js)$/.test(file.ext)) return undefined;
    const srcRoot = srcRootOf(file);
    const within = file.rel.slice(srcRoot.length);
    const text = file.text;

    // TanStack file-based routes
    if (/^routes\//.test(within) && (ctx.frameworks.has('tanstack-router') || /\bcreateFileRoute\(|createRootRoute\(/.test(text))) {
      const sub = within.slice('routes/'.length);
      const explicit = /createFileRoute\(\s*(['"`])([^'"`]+)\1/.exec(text)?.[2];
      const routePath = explicit ? tidyRoute(explicit.split('/').filter((s) => !/^_/.test(s) && !/^\(.*\)$/.test(s)).map((s) => s.replace(/_$/, ''))) : tanstackPath(sub);
      const routesDir = `${srcRoot}routes/`;
      if (routePath === undefined || /createRootRoute(WithContext)?\(/.test(text)) {
        const d = componentDraft(file, routesDir, srcRoot, ctx.opts.dirGroupMin);
        d.group = dirGroup(`components:${routesDir}`, 'app shell', 'component', 'client', routesDir, 'layouts', ctx.opts.dirGroupMin);
        d.label = /^_/.test(baseOf(sub)) || /^_/.test(dirOf(sub)) ? `${stripExt(baseOf(sub))} layout` : 'root layout';
        return { kind: 'node', draft: d };
      }
      if (/\b(loader|server|api)\b/.test(baseOf(sub)) && !/export\s+(default|const\s+Route)/.test(text)) return undefined;
      const d = pageDraft(file.rel, routePath, text, 'tanstack-router', pageGroup(routePath, routesDir, ctx.opts.routeGroupMin));
      return { kind: 'node', draft: d };
    }

    const routes = (ctx.scratch.get('react-router.pages') as Map<string, string[]> | undefined)?.get(file.rel);
    if (routes?.length) {
      const routePath = [...routes].sort((a, b) => a.length - b.length)[0]!;
      const pagesDir = /^((?:[\w.-]+\/)*?(?:pages|views|screens|routes)\/)/.exec(within)?.[1];
      const d: Draft = pageDraft(file.rel, routePath, text, 'react-router', pageGroup(routePath, srcRoot + (pagesDir ?? ''), ctx.opts.routeGroupMin));
      d.summary = firstDocSentence(text) ?? d.summary;
      if (routes.length > 1) d.meta = { ...d.meta, routes };
      return { kind: 'node', draft: d };
    }
    const viewsMatch = /^((?:[\w.-]+\/)*?(?:views|screens)\/)/.exec(within);
    if (viewsMatch && /^(tsx|jsx)$/.test(file.ext)) {
      const d = componentDraft(file, srcRoot + viewsMatch[1]!, srcRoot, ctx.opts.dirGroupMin);
      d.tags = ['react', 'view'];
      return { kind: 'node', draft: d };
    }
    return undefined;
  },
};
