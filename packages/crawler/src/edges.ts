// TODO: import from '@codehud/schema' once the workspace is installed.
import type { EdgeKind, SysNode } from '../../schema/src/index.ts';
import { ENV_VAR_RE, envPrefix } from './env-externals.ts';
import { externalFor } from './framework.ts';
import { stripComments } from './fs.ts';
import { isDynamicSegment } from './lanes.ts';
import type { Confidence, Draft, EdgeDraft, ImportRecord, ResolvedOptions, SourceFile } from './types.ts';
import type { PersistenceResult } from './persistence.ts';

export interface RouteEntry {
  nodeId: string;
  kind: 'page' | 'route';
  segments: string[];
  rest: boolean;
}

export interface EdgeContext {
  sources: SourceFile[];
  importsOf: Map<string, ImportRecord[]>;
  /** file -> owning node id */
  owner: Map<string, string>;
  nodes: Map<string, SysNode>;
  routes: RouteEntry[];
  persistence: PersistenceResult;
  /** external node ids present in the map */
  externals: Set<string>;
  /** env-var prefix (e.g. CRM) -> external node id */
  envExternals: Map<string, string>;
  opts: ResolvedOptions;
}

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

class EdgeBag {
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
const NAV_RE = /(?:href=|redirect\(\s*|navigate\(\s*|goto\(\s*|push\(\s*|replace\(\s*|href:\s*)(?:(['"])(\/[^'"\n]*)\1|`(\/[^`\n]*)`)/g;
const ENV_BINDING_RE = /\benv\.([A-Z][A-Z0-9_]{1,40})\b/g;
const PRISMA_RE = /\b(?:prisma|db|client|tx|ctx\.db|ctx\.prisma)\.(\w+)\.(findMany|findFirst|findUnique|findUniqueOrThrow|findFirstOrThrow|count|aggregate|groupBy|create|createMany|createManyAndReturn|update|updateMany|upsert|delete|deleteMany)\(/g;

function templateToPath(tpl: string): string {
  return tpl.replace(/^\$\{[^}]*\}/, '').replace(/\$\{[^}]*\}/g, '*');
}

function methodNear(text: string, index: number): string {
  const window = text.slice(index, index + 240);
  return /method\s*:\s*['"](\w+)['"]/i.exec(window)?.[1]?.toUpperCase() ?? 'GET';
}

export function buildEdges(ctx: EdgeContext): EdgeDraft[] {
  const bag = new EdgeBag(ctx.nodes, ctx.opts.lowConfidenceEdges ? 'low' : 'medium');
  const nodeOf = (file: string) => ctx.owner.get(file);
  const idents = ctx.persistence.tableIdents;
  const identRe = idents.size ? new RegExp(`\\b(${[...idents.keys()].map((k) => k.replace(/\$/g, '\\$')).join('|')})\\b`) : undefined;

  for (const file of ctx.sources) {
    const from = nodeOf(file.rel);
    if (!from) continue;
    const fromNode = ctx.nodes.get(from)!;
    const text = file.text;

    // imports -> imports / renders / calls(external)
    for (const imp of ctx.importsOf.get(file.rel) ?? []) {
      if (imp.file) {
        const to = nodeOf(imp.file);
        if (!to || to === from) continue;
        const toNode = ctx.nodes.get(to);
        if (!toNode) continue;
        const fromRenders = fromNode.kind === 'page' || fromNode.kind === 'component' || /\.(svelte|astro|vue|tsx|jsx)$/.test(file.rel);
        const renders = fromRenders && toNode.kind === 'component';
        bag.add(from, to, renders ? 'renders' : 'imports', 'high', 'import');
      } else if (imp.pkg) {
        const def = externalFor(imp.pkg);
        if (def && ctx.externals.has(`external:${def.id}`)) bag.add(from, `external:${def.id}`, 'calls', 'high', 'dep', imp.pkg);
      }
    }

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

    // href="/x" / redirect('/x') -> navigates page
    if (fromNode.kind === 'page' || fromNode.kind === 'component' || fromNode.kind === 'middleware') {
      for (const m of text.matchAll(NAV_RE)) {
        const raw = m[2] ?? (m[3] !== undefined ? templateToPath(m[3]) : undefined);
        if (!raw || raw.startsWith('//') || /\.[a-z0-9]{2,5}$/i.test(raw)) continue;
        const hit = matchRoute(ctx.routes, raw, 'page');
        if (hit) bag.add(from, hit.nodeId, 'navigates', 'medium', 'href');
      }
    }

    // drizzle table access (a file may both read and write a table: emit both)
    if (identRe && identRe.test(text)) {
      const touched = new Map<string, Set<EdgeKind>>();
      const mark = (ident: string, kind: EdgeKind) => {
        const id = idents.get(ident);
        if (!id) return;
        (touched.get(id) ?? touched.set(id, new Set()).get(id)!).add(kind);
      };
      for (const m of text.matchAll(/\.(from|leftJoin|innerJoin|rightJoin|fullJoin)\(\s*(\w+)/g)) mark(m[2]!, 'reads');
      for (const m of text.matchAll(/\bquery\.(\w+)\.(?:findFirst|findMany)\b/g)) mark(m[1]!, 'reads');
      for (const m of text.matchAll(/\.(insert|update|delete)\(\s*(\w+)\s*\)/g)) mark(m[2]!, 'writes');
      for (const imp of ctx.importsOf.get(file.rel) ?? []) for (const n of imp.names) if (idents.has(n) && !touched.has(idents.get(n)!)) mark(n, 'depends');
      for (const [id, kinds] of touched) {
        if (ctx.nodes.get(id)?.files?.[0]?.path === file.rel) continue; // the schema file itself
        for (const kind of kinds) bag.add(from, id, kind, kind === 'depends' ? 'low' : 'high', 'drizzle', kind === 'depends' ? 'references' : undefined);
      }
    }

    // env-configured externals: env.CRM_URL / env.CRM_API_KEY -> external node for CRM
    if (ctx.envExternals.size && !/(^|\/)env\.[cm]?[jt]s$/.test(file.rel)) {
      for (const m of stripComments(text).matchAll(ENV_VAR_RE)) {
        if (/_(MODE|REGION|ENABLED|FLAG)$/.test(m[1]!)) continue; // toggles are configuration, not calls
        const prefix = envPrefix(m[1]!);
        const to = prefix && ctx.envExternals.get(prefix);
        if (to) bag.add(from, to, 'calls', 'medium', 'env', m[1]);
      }
    }

    // prisma model access
    if (ctx.persistence.prismaModels.size) {
      for (const m of text.matchAll(PRISMA_RE)) {
        const id = ctx.persistence.prismaModels.get(m[1]!);
        if (!id) continue;
        const kind: EdgeKind = /^(find|count|aggregate|groupBy)/.test(m[2]!) ? 'reads' : 'writes';
        bag.add(from, id, kind, 'high', 'prisma');
      }
    }

    // Worker bindings: env.DB / env.KV ...
    if (ctx.persistence.bindings.size) {
      for (const m of text.matchAll(ENV_BINDING_RE)) {
        const b = ctx.persistence.bindings.get(m[1]!);
        if (!b) continue;
        let kind: EdgeKind = 'calls';
        if (b.type === 'kv' || b.type === 'r2') {
          const uses = text.slice(m.index!, m.index! + 80);
          kind = /\.(put|delete)\(/.test(uses) ? 'writes' : /\.(get|list|head|getWithMetadata)\(/.test(uses) ? 'reads' : 'calls';
        } else if (b.type === 'queue') kind = 'emits';
        bag.add(from, b.id, kind, 'medium', 'binding', `binding ${m[1]}`);
      }
    }
  }

  return [...bag.edges.values()].sort((a, b) => a.id!.localeCompare(b.id!));
}

export type { Draft };
