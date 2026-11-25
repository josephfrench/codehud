/**
 * Client-side router tables (Angular `Routes`, vue-router, react-router, TanStack code routes) all
 * look alike: an array of `{ path: 'x', component: X | () => import('./x'), children: [...] }`.
 * This parses such arrays into (component file -> URL path) by following the file's imports.
 */
import { dirOf } from '../fs.ts';
import { resolveSpecifier } from '../imports.ts';
import type { CrawlContext, SourceFile } from '../types.ts';
import { tidyRoute } from './drafts.ts';

export interface RouteHit {
  file: string;
  path: string;
  /** the symbol the route pointed at, when it was not resolved to a file */
  symbol?: string;
  /** the route has children: its component is a layout / outlet, not a leaf page */
  layout?: boolean;
}

export interface RouteParseOptions {
  prefix?: string;
  /** called for every file followed through loadChildren / lazy route modules */
  onChildFile?: (file: string) => void;
}

function importMap(file: SourceFile, ctx: CrawlContext): Map<string, string> {
  const m = new Map<string, string>();
  for (const imp of ctx.importsOf.get(file.rel) ?? []) {
    if (!imp.file) continue;
    for (const n of imp.names) m.set(n, imp.file);
    // default imports: `import Home from './Home.vue'`
    const def = new RegExp(`import\\s+([A-Za-z_$][\\w$]*)\\s*(?:,|from)\\s*(?:\\{[^}]*\\}\\s*from\\s*)?['"]${imp.spec.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}['"]`).exec(file.text);
    if (def?.[1]) m.set(def[1], imp.file);
  }
  return m;
}

/** Walk `{ path: ..., component: ..., children: [...] }` objects; braces are matched textually. */
export function parseRouteArray(file: SourceFile, text: string, ctx: CrawlContext, opts: RouteParseOptions = {}): RouteHit[] {
  const prefix = opts.prefix ?? '';
  const hits: RouteHit[] = [];
  const imports = importMap(file, ctx);
  const objects = splitObjects(text);
  for (const obj of objects) {
    const path = /\bpath\s*:\s*(['"`])([^'"`]*)\1/.exec(obj.head)?.[2];
    const isIndex = /\bindex\s*:\s*true/.test(obj.head);
    const full = path === undefined && !isIndex ? prefix : joinPath(prefix, path ?? '');
    const comp = /\b(?:component|Component|element|loadComponent|lazy|page)\s*:\s*(?:\(\s*\)\s*=>\s*)?(?:import\(\s*(['"])([^'"]+)\1\s*\)|<\s*([A-Z][\w$.]*)|([A-Z][\w$]*))/.exec(obj.head);
    const lazyChildren = /\bloadChildren\s*:\s*\(\s*\)\s*=>\s*import\(\s*(['"])([^'"]+)\1/.exec(obj.head);
    if (comp && path !== undefined || comp && isIndex) {
      const spec = comp[2];
      const sym = comp[3] ?? comp[4];
      let resolved: string | undefined;
      if (spec) resolved = resolveSpecifier(spec, file, ctx.fileSet);
      else if (sym) resolved = imports.get(sym.split('.')[0]!);
      const layout = !!obj.children || undefined;
      if (resolved) hits.push({ file: resolved, path: tidyRoute(full.split('/')), layout });
      else if (sym) hits.push({ file: '', path: tidyRoute(full.split('/')), symbol: sym, layout });
    }
    if (lazyChildren) {
      const resolved = resolveSpecifier(lazyChildren[2]!, file, ctx.fileSet);
      const target = resolved ? ctx.sources.find((s) => s.rel === resolved) : undefined;
      if (target) {
        opts.onChildFile?.(target.rel);
        for (const h of routeArraysIn(target, ctx, { ...opts, prefix: full })) hits.push(h);
      }
    }
    if (obj.children) hits.push(...parseRouteArray(file, obj.children, ctx, { ...opts, prefix: full }));
  }
  return hits;
}

function joinPath(prefix: string, path: string): string {
  const p = path.startsWith('/') ? path : `${prefix}/${path}`;
  return '/' + p.split('/').filter(Boolean).join('/');
}

/** Top-level `{ ... }` objects of an array literal, with the `children: [ ... ]` body split off. */
function splitObjects(text: string): { head: string; children?: string }[] {
  const out: { head: string; children?: string }[] = [];
  let i = 0;
  while (i < text.length) {
    const open = text.indexOf('{', i);
    if (open < 0) break;
    const close = matchBrace(text, open, '{', '}');
    const body = text.slice(open + 1, close - 1);
    const childIdx = body.search(/\bchildren\s*:\s*\[/);
    if (childIdx >= 0) {
      const arrOpen = body.indexOf('[', childIdx);
      const arrClose = matchBrace(body, arrOpen, '[', ']');
      out.push({ head: body.slice(0, arrOpen) + body.slice(arrClose), children: body.slice(arrOpen + 1, arrClose - 1) });
    } else out.push({ head: body });
    i = close;
  }
  return out;
}

export function matchBrace(text: string, openIndex: number, open: string, close: string): number {
  let depth = 0;
  let quote: string | null = null;
  for (let i = openIndex; i < text.length; i++) {
    const c = text[i]!;
    if (quote) {
      if (c === '\\') i++;
      else if (c === quote) quote = null;
      continue;
    }
    if (c === '"' || c === "'" || c === '`') quote = c;
    else if (c === '/' && text[i + 1] === '/') { i = text.indexOf('\n', i); if (i < 0) return text.length; }
    else if (c === '/' && text[i + 1] === '*') { i = text.indexOf('*/', i) + 1; if (i <= 0) return text.length; }
    else if (c === open) depth++;
    else if (c === close) {
      depth--;
      if (depth === 0) return i + 1;
    }
  }
  return text.length;
}

const ROUTE_ARRAY_RE = /(?:\bRoutes\s*=\s*|\broutes\s*(?::\s*(?:Routes|RouteRecordRaw\[\]|RouteObject\[\]))?\s*[=:]\s*|\bcreateBrowserRouter\(\s*|\bcreateHashRouter\(\s*|\bcreateMemoryRouter\(\s*|\bcreateRouter\(\s*\{[^[]*?\broutes\s*:\s*)\[/g;

/** Every route array in a file, flattened to (file -> path) hits. */
export function routeArraysIn(file: SourceFile, ctx: CrawlContext, opts: RouteParseOptions = {}): RouteHit[] {
  const hits: RouteHit[] = [];
  const text = file.text;
  for (const m of text.matchAll(ROUTE_ARRAY_RE)) {
    const open = m.index! + m[0].length - 1;
    const close = matchBrace(text, open, '[', ']');
    hits.push(...parseRouteArray(file, text.slice(open + 1, close - 1), ctx, opts));
  }
  return hits;
}

/** JSX `<Route path="x" element={<X />}>` trees (react-router) → hits. */
export function jsxRoutesIn(file: SourceFile, ctx: CrawlContext): RouteHit[] {
  const hits: RouteHit[] = [];
  if (!/<Route\b/.test(file.text)) return hits;
  const imports = importMap(file, ctx);
  const stack: string[] = [];
  const re = /<Route\b([^>]*?)(\/?)>|<\/Route>/g;
  for (const m of file.text.matchAll(re)) {
    if (m[0] === '</Route>') { stack.pop(); continue; }
    const attrs = m[1]!;
    const path = /\bpath=(?:"([^"]*)"|'([^']*)'|\{\s*['"`]([^'"`]*)['"`]\s*\})/.exec(attrs);
    const p = path?.[1] ?? path?.[2] ?? path?.[3];
    const isIndex = /\bindex\b/.test(attrs);
    const parent = stack[stack.length - 1] ?? '';
    const full = p === undefined ? parent : p.startsWith('/') ? p : `${parent}/${p}`;
    const comp = /\b(?:element|Component)=\{\s*<?\s*([A-Z][\w$.]*)/.exec(attrs)?.[1] ?? /\blazy=\{\s*\(\s*\)\s*=>\s*import\(\s*['"]([^'"]+)['"]/.exec(attrs)?.[1];
    if (comp && (p !== undefined || isIndex)) {
      const resolved = comp.startsWith('.') || comp.startsWith('@') ? resolveSpecifier(comp, file, ctx.fileSet) : imports.get(comp.split('.')[0]!);
      hits.push({ file: resolved ?? '', path: tidyRoute(full.split('/')), symbol: resolved ? undefined : comp, layout: m[2] ? undefined : true });
    }
    if (!m[2]) stack.push(full);
  }
  return hits;
}

export { dirOf };
