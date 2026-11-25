/** Remix / React Router v7 framework mode: `app/routes/**` flat routes, plus `app/routes.ts` route config. */
import { stripExt } from '../fs.ts';
import type { Adapter } from '../types.ts';
import { pageDraft, pageGroup, pkgPrefixOf, routeDraft, routeGroup, tidyRoute } from './drafts.ts';
import { middlewareFile, preClassify } from './generic.ts';

/**
 * `route("path", "file")`, `index("file")`, `layout("file", [...])`, `prefix("p", [...])` in app/routes.ts.
 * Returns file (root-relative) -> URL path. Nested arrays after prefix()/route() extend the path.
 */
export function parseRouteConfig(text: string, appDir: string): Map<string, string> {
  const out = new Map<string, string>();
  const frames: { path: string; depth: number }[] = [];
  let depth = 0;
  let pendingPrefix: string | null = null;
  const token = /\b(route|index|layout|prefix)\(\s*(?:(['"`])([^'"`]*)\2\s*(?:,\s*(['"`])([^'"`]*)\4)?)?|(\[)|(\])|(['"`])(?:\\.|(?!\8)[^\\])*\8/g;
  const cur = () => frames.map((f) => f.path).join('/');
  const join = (p: string) => '/' + `${cur()}/${p}`.split('/').filter(Boolean).join('/');
  for (const m of text.matchAll(token)) {
    if (m[6]) { depth++; if (pendingPrefix !== null) { frames.push({ path: pendingPrefix, depth }); pendingPrefix = null; } continue; }
    if (m[7]) { if (frames.length && frames[frames.length - 1]!.depth === depth) frames.pop(); depth--; continue; }
    if (m[8]) continue; // a string that is not an argument we care about
    const fn = m[1]!;
    const a = m[3];
    const b = m[5];
    if (fn === 'route' && a !== undefined && b) { out.set(appDir + b, join(a)); pendingPrefix = a; }
    else if (fn === 'index' && a) out.set(appDir + a, join(''));
    else if (fn === 'layout' && a) { out.set(appDir + a, join('')); pendingPrefix = ''; }
    else if (fn === 'prefix' && a !== undefined) pendingPrefix = a;
  }
  return out;
}

export const remix: Adapter = {
  id: 'remix',
  priority: 60,
  detect: (ctx) => ctx.frameworks.has('remix') || ctx.hasFile(/(^|\/)app\/routes\.[jt]s$/),
  prepare(ctx) {
    const map = new Map<string, string>();
    for (const f of ctx.sources) {
      const m = /^(.*app\/)routes\.[jt]s$/.exec(f.rel);
      if (!m) continue;
      for (const [file, path] of parseRouteConfig(f.text, m[1]!)) map.set(file, path);
    }
    ctx.scratch.set('remix.routes', map);
  },
  classify(file, ctx) {
    const pre = preClassify(file);
    if (pre) return pre;
    const mw = middlewareFile(file);
    if (mw) return mw;
    const pkgPrefix = pkgPrefixOf(file);
    const withinPkg = file.rel.slice(pkgPrefix.length);
    const routesDir = pkgPrefix + 'app/routes/';
    const configured = (ctx.scratch.get('remix.routes') as Map<string, string> | undefined)?.get(file.rel);
    if (configured !== undefined) {
      const isResource = !/export\s+default/.test(file.text);
      return { kind: 'node', draft: isResource ? routeDraft(file.rel, configured, file.text, 'react-router', routeGroup(configured, routesDir, ctx.opts.routeGroupMin)) : pageDraft(file.rel, configured, file.text, 'react-router', pageGroup(configured, routesDir, ctx.opts.routeGroupMin)) };
    }
    if (!(ctx.frameworks.has('remix') && /^app\/routes\//.test(withinPkg) && /^(tsx|jsx|ts|js|mdx)$/.test(file.ext))) return undefined;
    const sub = stripExt(withinPkg.slice('app/routes/'.length)).replace(/\/route$/, '');
    const segs = sub
      .split(/[./]/)
      .filter((s) => s && !/^_[a-z]/.test(s) || s === '_index')
      .map((s) => (s === '_index' ? 'index' : s.replace(/^\$(\w+)$/, '[$1]').replace(/^\$$/, '[...rest]')));
    const routePath = tidyRoute(segs);
    const isResource = !/export\s+default/.test(file.text);
    return {
      kind: 'node',
      draft: isResource
        ? routeDraft(file.rel, routePath, file.text, 'remix', routeGroup(routePath, routesDir, ctx.opts.routeGroupMin))
        : pageDraft(file.rel, routePath, file.text, 'remix', pageGroup(routePath, routesDir, ctx.opts.routeGroupMin)),
    };
  },
};
