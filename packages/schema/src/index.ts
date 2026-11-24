/**
 * The System Map: a generic, framework-agnostic description of a software
 * system that the HUD can render. Crawlers (or humans, or an AI) produce one
 * of these; the HUD consumes it. Keep it boring and serialisable.
 *
 * Mental model:
 *   - LAYERS are horizontal bands (client, edge, api, domain, persistence, external...).
 *   - LANES are vertical swim lanes (features / bounded contexts: auth, billing, ...).
 *   - NODES sit in a (layer, lane) cell and may nest via `parent`.
 *   - EDGES connect nodes. Edges between hidden descendants are lifted to the
 *     nearest visible ancestors when rendering.
 */

export type NodeKind =
  | 'app'          // a deployable / a whole application
  | 'page'         // a user-facing screen or route rendered to a human
  | 'component'    // a UI component
  | 'route'        // an HTTP/RPC endpoint
  | 'middleware'   // request pipeline step (auth guard, rate limiter, ...)
  | 'service'      // a module of business logic
  | 'module'       // generic code module / package
  | 'function'     // a single notable function
  | 'job'          // scheduled / background job
  | 'queue'        // queue or topic
  | 'event'        // domain event
  | 'table'        // database table / collection
  | 'store'        // a datastore (db instance, kv namespace, bucket)
  | 'cache'
  | 'external'     // third-party system (Stripe, Resend, GitHub...)
  | 'config'       // configuration / infra definition
  | 'test'
  | 'other';

export type EdgeKind =
  | 'calls'        // sync call (HTTP, RPC, function call)
  | 'imports'      // static code dependency
  | 'renders'      // page/component renders component
  | 'navigates'    // page links to page
  | 'reads'        // reads from a store/table
  | 'writes'       // writes to a store/table
  | 'emits'        // publishes event / enqueues
  | 'listens'      // subscribes / consumes
  | 'guards'       // middleware protects route
  | 'depends'      // generic dependency
  | 'other';

export interface Layer {
  id: string;
  label: string;
  description?: string;
  /** Optional accent colour (CSS). The HUD has defaults per well-known id. */
  color?: string;
}

export interface Lane {
  id: string;
  label: string;
  description?: string;
}

export interface FileRef {
  /** Path relative to `SystemMap.root`. Forward slashes. A trailing slash marks a directory. */
  path: string;
  /** Optional 1-based inclusive line range. */
  lines?: [number, number];
  /** What this file is to the node: 'source' | 'test' | 'schema' | 'config' ... */
  role?: string;
}

export interface SysNode {
  id: string;
  label: string;
  kind: NodeKind;
  layer: string;
  lane?: string;
  /** Parent node id for nesting. */
  parent?: string;
  /** One line. Shown on the card. */
  summary?: string;
  /** Longer markdown. Shown in the detail panel. */
  description?: string;
  files?: FileRef[];
  tags?: string[];
  /** Free-form extras: http method+path, table columns, env vars, etc. */
  meta?: Record<string, unknown>;
}

export interface SysEdge {
  id?: string;
  from: string;
  to: string;
  kind: EdgeKind;
  label?: string;
  meta?: Record<string, unknown>;
}

export interface SystemMap {
  $schema?: string;
  version: 1;
  name: string;
  description?: string;
  /** Repo root the file refs are relative to. Absolute path on the machine that produced it. */
  root?: string;
  generatedAt?: string;
  generator?: { name: string; version?: string };
  layers: Layer[];
  lanes: Lane[];
  nodes: SysNode[];
  edges: SysEdge[];
}

/** Conventional layer ids. Crawlers should prefer these so the HUD can style them. */
export const WELL_KNOWN_LAYERS: Layer[] = [
  { id: 'client', label: 'Client', description: 'Pages, components, browser state' },
  { id: 'edge', label: 'Edge', description: 'Middleware, auth guards, routing, CDN' },
  { id: 'api', label: 'API', description: 'HTTP / RPC endpoints, server actions' },
  { id: 'domain', label: 'Domain', description: 'Business logic, services, jobs' },
  { id: 'persistence', label: 'Persistence', description: 'Databases, tables, caches, buckets' },
  { id: 'external', label: 'External', description: 'Third-party systems' },
];

// ---------------------------------------------------------------------------
// Validation & helpers (no deps; usable in node and browser)
// ---------------------------------------------------------------------------

export function validateSystemMap(input: unknown): { ok: true; map: SystemMap } | { ok: false; errors: string[] } {
  const errors: string[] = [];
  const m = input as Partial<SystemMap>;
  if (!m || typeof m !== 'object') return { ok: false, errors: ['map must be an object'] };
  if (m.version !== 1) errors.push('version must be 1');
  if (typeof m.name !== 'string' || !m.name) errors.push('name is required');
  for (const k of ['layers', 'lanes', 'nodes', 'edges'] as const) {
    if (!Array.isArray(m[k])) errors.push(`${k} must be an array`);
  }
  if (errors.length) return { ok: false, errors };

  const layerIds = new Set(m.layers!.map((l) => l.id));
  const laneIds = new Set(m.lanes!.map((l) => l.id));
  const nodeIds = new Set<string>();
  for (const n of m.nodes!) {
    if (!n.id) errors.push('node without id');
    else if (nodeIds.has(n.id)) errors.push(`duplicate node id: ${n.id}`);
    nodeIds.add(n.id);
    if (!n.label) errors.push(`node ${n.id} missing label`);
    if (!n.layer) errors.push(`node ${n.id} missing layer`);
    else if (!layerIds.has(n.layer)) errors.push(`node ${n.id} references unknown layer ${n.layer}`);
    if (n.lane && !laneIds.has(n.lane)) errors.push(`node ${n.id} references unknown lane ${n.lane}`);
  }
  for (const n of m.nodes!) {
    if (n.parent && !nodeIds.has(n.parent)) errors.push(`node ${n.id} references unknown parent ${n.parent}`);
    if (n.parent === n.id) errors.push(`node ${n.id} is its own parent`);
  }
  m.edges!.forEach((e, i) => {
    if (!nodeIds.has(e.from)) errors.push(`edge[${i}] from unknown node ${e.from}`);
    if (!nodeIds.has(e.to)) errors.push(`edge[${i}] to unknown node ${e.to}`);
  });
  for (const n of m.nodes!) {
    const seen = new Set<string>();
    let cur: SysNode | undefined = n;
    while (cur?.parent) {
      if (seen.has(cur.parent)) { errors.push(`parent cycle at ${n.id}`); break; }
      seen.add(cur.parent);
      const pid: string = cur.parent;
      cur = m.nodes!.find((x) => x.id === pid);
    }
  }
  return errors.length ? { ok: false, errors } : { ok: true, map: m as SystemMap };
}

export class MapIndex {
  readonly byId = new Map<string, SysNode>();
  readonly children = new Map<string, SysNode[]>();
  readonly roots: SysNode[] = [];

  constructor(public readonly map: SystemMap) {
    for (const n of map.nodes) this.byId.set(n.id, n);
    for (const n of map.nodes) {
      if (n.parent && this.byId.has(n.parent)) {
        const arr = this.children.get(n.parent) ?? [];
        arr.push(n);
        this.children.set(n.parent, arr);
      } else this.roots.push(n);
    }
    map.edges.forEach((e, i) => { if (!e.id) e.id = `e${i}`; });
  }

  get(id: string) { return this.byId.get(id); }
  childrenOf(id: string | null) { return id ? (this.children.get(id) ?? []) : this.roots; }
  hasChildren(id: string) { return (this.children.get(id)?.length ?? 0) > 0; }

  /** Ancestor chain root -> ... -> parent (excludes the node itself). */
  ancestors(id: string): SysNode[] {
    const out: SysNode[] = [];
    let cur = this.byId.get(id);
    const seen = new Set<string>();
    while (cur?.parent && !seen.has(cur.parent)) {
      seen.add(cur.parent);
      const p = this.byId.get(cur.parent);
      if (!p) break;
      out.unshift(p);
      cur = p;
    }
    return out;
  }

  /** All descendants (depth-first). */
  descendants(id: string): SysNode[] {
    const out: SysNode[] = [];
    const stack = [...(this.children.get(id) ?? [])];
    while (stack.length) {
      const n = stack.pop()!;
      out.push(n);
      stack.push(...(this.children.get(n.id) ?? []));
    }
    return out;
  }

  /** Nodes whose files match a path (exact, suffix, or directory-prefix match). Most specific first. */
  nodesForFile(path: string): SysNode[] {
    const norm = path.replace(/\\/g, '/').replace(/^\.\//, '');
    const scored: { n: SysNode; score: number }[] = [];
    for (const n of this.map.nodes) {
      for (const f of n.files ?? []) {
        const fp = f.path.replace(/\\/g, '/');
        if (fp === norm || norm.endsWith('/' + fp) || fp.endsWith('/' + norm)) scored.push({ n, score: 3 + fp.length / 1000 });
        else if (fp.endsWith('/') && (norm.startsWith(fp) || norm.includes('/' + fp))) scored.push({ n, score: 1 + fp.length / 1000 });
        else if (norm.startsWith(fp + '/')) scored.push({ n, score: 1 + fp.length / 1000 });
      }
    }
    scored.sort((a, b) => b.score - a.score);
    const seen = new Set<string>();
    return scored.filter(({ n }) => (seen.has(n.id) ? false : (seen.add(n.id), true))).map((s) => s.n);
  }

  /** Simple text search over id/label/summary/tags/files. */
  search(q: string, limit = 20): SysNode[] {
    const needle = q.toLowerCase();
    const hits: { n: SysNode; s: number }[] = [];
    for (const n of this.map.nodes) {
      let s = 0;
      if (n.id.toLowerCase() === needle) s += 10;
      if (n.label.toLowerCase().includes(needle)) s += 5;
      if (n.id.toLowerCase().includes(needle)) s += 3;
      if (n.summary?.toLowerCase().includes(needle)) s += 2;
      if (n.tags?.some((t) => t.toLowerCase().includes(needle))) s += 2;
      if (n.files?.some((f) => f.path.toLowerCase().includes(needle))) s += 1;
      if (s) hits.push({ n, s });
    }
    return hits.sort((a, b) => b.s - a.s).slice(0, limit).map((h) => h.n);
  }
}
