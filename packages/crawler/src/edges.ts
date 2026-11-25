/** Edge extraction: the generic signals (imports, HTTP calls, navigation) plus each adapter's own. */
import type { EdgeKind, SysNode } from '../../schema/src/index.ts';
import { HTTP_CLIENT_IDENTS } from './adapters/generic.ts';
import { vercelCronEdges } from './adapters/vercel.ts';
import { isDynamicSegment } from './lanes.ts';
import type { Adapter, Confidence, EdgeContext, EdgeDraft, EdgeSink, RouteEntry } from './types.ts';

const RANK: Record<Confidence, number> = { low: 0, medium: 1, high: 2 };

export function routeEntry(nodeId: string, kind: 'page' | 'route', routePath: string): RouteEntry {
  const segments = routePath.split('/').filter(Boolean);
  const rest = segments.some((s) => s.includes('...'));
  return { nodeId, kind, segments, rest };
}

/** Match a concrete (or templated) URL path against route patterns; most specific wins. */
export function matchRoute(routes: RouteEntry[], path: string, kind?: 'page' | 'route'): RouteEntry | undefined {
  const segs = path.split('?')[0]!.split('#')[0]!.split('/').filter(Boolean);
  let best: { entry: RouteEntry; score: number } | undefined;
  for (const r of routes) {
    if (kind && r.kind !== kind) continue;
    let score = 0;
    let ok = true;
    let i = 0;
    for (; i < r.segments.length; i++) {
      const pat = r.segments[i]!;
      const got = segs[i];
      if (pat.includes('...')) { score += 1; i = r.segments.length; break; }
      if (got === undefined) { ok = false; break; }
      if (isDynamicSegment(pat) || got === '*') score += 2;
      else if (pat === got) score += 5;
      else { ok = false; break; }
    }
    if (!ok) continue;
    if (!r.rest && segs.length !== r.segments.length) continue;
    if (!best || score > best.score) best = { entry: r, score };
  }
  return best?.entry;
}

export class EdgeBag implements EdgeSink {
  readonly edges = new Map<string, EdgeDraft>();
  private nodes: Map<string, SysNode>;
  private minConfidence: Confidence;
  constructor(nodes: Map<string, SysNode>, minConfidence: Confidence) {
    this.nodes = nodes;
    this.minConfidence = minConfidence;
  }

  private related(a: string, b: string): boolean {
    for (const [x, y] of [[a, b], [b, a]] as const) {
      let cur = this.nodes.get(x)?.parent;
      const seen = new Set<string>();
      while (cur && !seen.has(cur)) {
        if (cur === y) return true;
        seen.add(cur);
        cur = this.nodes.get(cur)?.parent;
      }
    }
    return false;
  }

  add(from: string, to: string, kind: EdgeKind, confidence: Confidence, via: string, label?: string): void {
    if (from === to || RANK[confidence] < RANK[this.minConfidence]) return;
    if (!this.nodes.has(from) || !this.nodes.has(to)) return;
    if (this.related(from, to)) return;
    const id = `${kind}:${from}->${to}`;
    const existing = this.edges.get(id);
    if (existing) {
      if (RANK[confidence] > RANK[existing.confidence]) existing.confidence = confidence;
      if (label && existing.label && !existing.label.split(' | ').includes(label) && existing.label.split(' | ').length < 3) existing.label += ` | ${label}`;
      else if (label && !existing.label) existing.label = label;
      const vias = String(existing.meta?.via ?? '').split(',');
      if (!vias.includes(via)) existing.meta = { ...existing.meta, via: [...vias, via].join(',') };
      return;
    }
    this.edges.set(id, { id, from, to, kind, label, confidence, meta: { via } });
  }
}

const FETCH_RE = /\bfetch\(\s*(?:(['"])([^'"\n]*)\1|`([^`\n]*)`)/g;
/** axios.get('/x'), http.post<T>('/x'), $fetch('/x'), useFetch('/x'), ky.get('x') ... */
const CLIENT_CALL_RE = /\b(\$fetch|useFetch|useLazyFetch|ofetch|axios|ky|got|http|https|api|client|httpClient|apiClient|request|fetcher|instance)(?:\.(get|post|put|patch|delete|head|options))?(?:<[^>()]*>)?\(\s*(?:(['"])(\/[^'"\n]*)\3|`([^`\n]*)`)/g;
const NAV_RE = /(?:href=|redirect\(\s*|navigate\(\s*|goto\(\s*|push\(\s*|replace\(\s*|href:\s*|navigateTo\(\s*|routerLink=|to=)(?:(['"])(\/[^'"\n]*)\1|`(\/[^`\n]*)`)/g;

function templateToPath(tpl: string): string {
  return tpl.replace(/^\$\{[^}]*\}/, '').replace(/\$\{[^}]*\}/g, '*');
}

function methodNear(text: string, index: number): string {
  const window = text.slice(index, index + 240);
  return /method\s*:\s*['"](\w+)['"]/i.exec(window)?.[1]?.toUpperCase() ?? 'GET';
}

export function buildEdges(ctx: EdgeContext, adapters: Adapter[]): EdgeDraft[] {
  const bag = new EdgeBag(ctx.nodes, ctx.opts.lowConfidenceEdges ? 'low' : 'medium');
  const nodeOf = (file: string) => ctx.owner.get(file);
  const serverIdents = new Set<string>();
  // identifiers that declare server routes in this repo must not count as HTTP clients
  for (const n of ctx.nodes.values()) if (typeof n.meta?.declaredIn === 'string') serverIdents.add(n.meta.declaredIn);

  for (const file of ctx.sources) {
    const from = nodeOf(file.rel);
    if (!from) continue;
    const fromNode = ctx.nodes.get(from)!;
    const text = file.text;

    // imports -> imports / renders
    for (const imp of ctx.importsOf.get(file.rel) ?? []) {
      if (!imp.file) continue;
      const to = nodeOf(imp.file);
      if (!to || to === from) continue;
      const toNode = ctx.nodes.get(to);
      if (!toNode) continue;
      const fromRenders = fromNode.kind === 'page' || fromNode.kind === 'component' || /\.(svelte|astro|vue|tsx|jsx)$/.test(file.rel);
      const renders = fromRenders && toNode.kind === 'component';
      bag.add(from, to, renders ? 'renders' : 'imports', 'high', 'import');
    }

    if (file.ext !== 'py') {
      // fetch('/api/...') -> calls route
      for (const m of text.matchAll(FETCH_RE)) {
        const raw = m[2] ?? (m[3] !== undefined ? templateToPath(m[3]) : undefined);
        if (!raw || !raw.startsWith('/')) continue;
        const hit = matchRoute(ctx.routes, raw, 'route');
        if (!hit) continue;
        const method = methodNear(text, m.index!);
        const label = `${method} ${'/' + hit.segments.join('/')}`;
        bag.add(from, hit.nodeId, 'calls', m[2] !== undefined ? 'high' : 'medium', 'fetch', label);
      }
      // http client libraries -> calls route
      for (const m of text.matchAll(CLIENT_CALL_RE)) {
        const ident = m[1]!;
        if (serverIdents.has(ident) || (!HTTP_CLIENT_IDENTS.has(ident) && !/^(useFetch|useLazyFetch)$/.test(ident))) continue;
        const raw = m[4] ?? (m[5] !== undefined ? templateToPath(m[5]) : undefined);
        if (!raw || !raw.startsWith('/')) continue;
        const hit = matchRoute(ctx.routes, raw, 'route');
        if (!hit) continue;
        const method = (m[2] ?? methodNear(text, m.index!)).toUpperCase();
        bag.add(from, hit.nodeId, 'calls', m[4] !== undefined ? 'high' : 'medium', ident === '$fetch' || ident.startsWith('useFetch') ? 'nuxt-fetch' : 'http-client', `${method} /${hit.segments.join('/')}`);
      }
      // href="/x" / redirect('/x') -> navigates page
      if (fromNode.kind === 'page' || fromNode.kind === 'component' || fromNode.kind === 'middleware') {
        for (const m of text.matchAll(NAV_RE)) {
          const raw = m[2] ?? (m[3] !== undefined ? templateToPath(m[3]) : undefined);
          if (!raw || raw.startsWith('//') || /\.[a-z0-9]{2,5}$/i.test(raw)) continue;
          const hit = matchRoute(ctx.routes, raw, 'page');
          if (hit) bag.add(from, hit.nodeId, 'navigates', 'medium', 'href');
        }
      }
    }

    for (const a of adapters) a.edges?.(file, from, ctx, bag);
  }

  vercelCronEdges({ drafts: [...ctx.nodes.values()].map((n) => ({ ...n, ownedFiles: [] })) }, ctx.routes, bag);
  return [...bag.edges.values()].sort((a, b) => a.id!.localeCompare(b.id!));
}
