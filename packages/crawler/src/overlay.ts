/**
 * The overlay: `.codehud/map.overrides.json` in the crawled repo. Humans or an agent record the
 * corrections the heuristics cannot make (lane names, merges, summaries, hidden nodes, missing
 * edges); every crawl re-applies them, so output = deterministic(repo) ⊕ overlay.
 *
 * {
 *   "version": 1,
 *   "name": "Acme Portal",                      // optional map name / description
 *   "description": "...",
 *   "lanes": {
 *     "crm":   { "mergeInto": "checkout" },      // fold a lane into another
 *     "esign": { "label": "E-sign", "description": "..." },
 *     "admin": { "hide": true }                 // drop the lane (nodes become lane-less)
 *   },
 *   "addLanes": [{ "id": "billing", "label": "Billing" }],
 *   "laneOrder": ["checkout", "auth", "billing"],
 *   "nodes": {
 *     "route:src/pages/api/webhooks/*": { "lane": "billing" },        // trailing * = prefix match
 *     "module:src/lib/legacy.ts":      { "hide": true },             // children reparent, edges lift
 *     "table:users": { "summary": "One row per human", "label": "users", "tags": ["pii"] },
 *     "service:src/lib/crm.ts": { "parent": "module:src/lib/checkout/", "kind": "service", "layer": "domain" }
 *   },
 *   "addNodes": [{ "id": "external:bank", "label": "Bank API", "kind": "external", "layer": "external" }],
 *   "addEdges": [{ "from": "service:src/lib/crm.ts", "to": "external:bank", "kind": "calls", "label": "ACH" }],
 *   "removeEdges": ["imports:a->b", { "from": "a", "to": "b" }]   // by id, or by endpoints (+ optional kind)
 * }
 */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Lane, SysEdge, SysNode, SystemMap } from '../../schema/src/index.ts';

export interface NodeOverride {
  lane?: string | null;
  label?: string;
  summary?: string;
  description?: string;
  kind?: SysNode['kind'];
  layer?: string;
  parent?: string | null;
  tags?: string[];
  meta?: Record<string, unknown>;
  hide?: boolean;
}

export interface Overlay {
  version?: 1;
  name?: string;
  description?: string;
  lanes?: Record<string, { label?: string; description?: string; mergeInto?: string; hide?: boolean }>;
  addLanes?: Lane[];
  laneOrder?: string[];
  nodes?: Record<string, NodeOverride>;
  addNodes?: SysNode[];
  addEdges?: SysEdge[];
  removeEdges?: (string | { from: string; to: string; kind?: string })[];
}

export const OVERLAY_PATH = '.codehud/map.overrides.json';

export function readOverlay(root: string): { overlay: Overlay; path: string } | undefined {
  const path = join(root, OVERLAY_PATH);
  if (!existsSync(path)) return undefined;
  const overlay = JSON.parse(readFileSync(path, 'utf8')) as Overlay; // JSON only: never executes anything
  if (overlay && typeof overlay === 'object') return { overlay, path };
  throw new Error(`${OVERLAY_PATH} must be a JSON object`);
}

function matches(pattern: string, id: string): boolean {
  if (pattern.endsWith('*')) return id.startsWith(pattern.slice(0, -1));
  return pattern === id;
}

/** Apply the overlay to a map in place and return it. Unknown ids are reported in `warnings`. */
export function applyOverlay(map: SystemMap, overlay: Overlay): { map: SystemMap; warnings: string[] } {
  const warnings: string[] = [];
  if (overlay.name) map.name = overlay.name;
  if (overlay.description) map.description = overlay.description;

  // lanes
  const laneMap = new Map<string, string | null>(); // old -> new (null = dropped)
  for (const [id, o] of Object.entries(overlay.lanes ?? {})) {
    const lane = map.lanes.find((l) => l.id === id);
    if (!lane && !o.mergeInto) { warnings.push(`lanes: unknown lane ${id}`); continue; }
    if (o.hide) { laneMap.set(id, null); map.lanes = map.lanes.filter((l) => l.id !== id); continue; }
    if (o.mergeInto) {
      laneMap.set(id, o.mergeInto);
      map.lanes = map.lanes.filter((l) => l.id !== id);
      if (!map.lanes.some((l) => l.id === o.mergeInto) && !overlay.addLanes?.some((l) => l.id === o.mergeInto)) map.lanes.push({ id: o.mergeInto, label: labelOf(o.mergeInto) });
      continue;
    }
    if (lane) { if (o.label) lane.label = o.label; if (o.description) lane.description = o.description; }
  }
  for (const l of overlay.addLanes ?? []) if (!map.lanes.some((x) => x.id === l.id)) map.lanes.push(l);
  if (laneMap.size) for (const n of map.nodes) if (n.lane && laneMap.has(n.lane)) { const to = laneMap.get(n.lane); if (to) n.lane = to; else delete n.lane; }
  if (overlay.laneOrder?.length) {
    const order = new Map(overlay.laneOrder.map((id, i) => [id, i]));
    map.lanes.sort((a, b) => (order.get(a.id) ?? 999) - (order.get(b.id) ?? 999));
  }

  // nodes
  const byId = new Map(map.nodes.map((n) => [n.id, n]));
  const hidden = new Set<string>();
  for (const [pattern, o] of Object.entries(overlay.nodes ?? {})) {
    const targets = map.nodes.filter((n) => matches(pattern, n.id));
    if (!targets.length) { warnings.push(`nodes: no node matches ${pattern}`); continue; }
    for (const n of targets) {
      if (o.hide) { hidden.add(n.id); continue; }
      if (o.lane !== undefined) { if (o.lane === null) delete n.lane; else { n.lane = o.lane; if (!map.lanes.some((l) => l.id === o.lane)) map.lanes.push({ id: o.lane, label: labelOf(o.lane) }); } }
      if (o.label) n.label = o.label;
      if (o.summary !== undefined) n.summary = o.summary;
      if (o.description !== undefined) n.description = o.description;
      if (o.kind) n.kind = o.kind;
      if (o.layer) { n.layer = o.layer; if (!map.layers.some((l) => l.id === o.layer)) warnings.push(`nodes: ${n.id} moved to unknown layer ${o.layer}`); }
      if (o.parent !== undefined) { if (o.parent === null) delete n.parent; else if (byId.has(o.parent) || overlay.addNodes?.some((a) => a.id === o.parent)) n.parent = o.parent; else warnings.push(`nodes: ${n.id} parent ${o.parent} does not exist`); }
      if (o.tags) n.tags = [...new Set([...(n.tags ?? []), ...o.tags])];
      if (o.meta) n.meta = { ...n.meta, ...o.meta };
    }
  }
  if (hidden.size) {
    // children of a hidden node move up to its parent; edges touching it lift to that parent (or vanish)
    const parentOf = (id: string): string | undefined => {
      let cur = byId.get(id)?.parent;
      while (cur && hidden.has(cur)) cur = byId.get(cur)?.parent;
      return cur;
    };
    for (const n of map.nodes) if (n.parent && hidden.has(n.parent)) { const p = parentOf(n.parent); if (p) n.parent = p; else delete n.parent; }
    map.nodes = map.nodes.filter((n) => !hidden.has(n.id));
    const lifted: SysEdge[] = [];
    const seen = new Set<string>();
    for (const e of map.edges) {
      const from = hidden.has(e.from) ? parentOf(e.from) : e.from;
      const to = hidden.has(e.to) ? parentOf(e.to) : e.to;
      if (!from || !to || from === to) continue;
      const id = `${e.kind}:${from}->${to}`;
      if (seen.has(id)) continue;
      seen.add(id);
      lifted.push(from === e.from && to === e.to ? e : { ...e, id, from, to, meta: { ...e.meta, lifted: true } });
    }
    map.edges = lifted;
  }
  for (const n of overlay.addNodes ?? []) {
    if (map.nodes.some((x) => x.id === n.id)) { warnings.push(`addNodes: ${n.id} already exists`); continue; }
    map.nodes.push({ ...n, meta: { ...n.meta, overlay: true } });
  }
  const ids = new Set(map.nodes.map((n) => n.id));
  for (const e of overlay.addEdges ?? []) {
    if (!ids.has(e.from) || !ids.has(e.to)) { warnings.push(`addEdges: ${e.from} -> ${e.to} references a missing node`); continue; }
    const id = e.id ?? `${e.kind}:${e.from}->${e.to}`;
    if (map.edges.some((x) => x.id === id)) continue;
    map.edges.push({ ...e, id, meta: { ...e.meta, confidence: 'high', via: 'overlay' } });
  }
  for (const r of overlay.removeEdges ?? []) {
    const before = map.edges.length;
    map.edges = map.edges.filter((e) => (typeof r === 'string' ? e.id !== r : !(e.from === r.from && e.to === r.to && (!r.kind || e.kind === r.kind))));
    if (map.edges.length === before) warnings.push(`removeEdges: nothing matched ${typeof r === 'string' ? r : `${r.from} -> ${r.to}`}`);
  }
  const usedLanes = new Set(map.nodes.map((n) => n.lane).filter(Boolean));
  map.lanes = map.lanes.filter((l) => usedLanes.has(l.id) || overlay.addLanes?.some((a) => a.id === l.id));
  return { map, warnings };
}

function labelOf(id: string): string {
  return id.length <= 3 ? id.toUpperCase() : id.replace(/(^|-)([a-z])/g, (_, s: string, c: string) => (s ? ' ' : '') + c.toUpperCase());
}

/** A starter overlay listing current lanes and top-level nodes, ready to edit. */
export function overlayTemplate(map: SystemMap): Overlay & { $comment: string } {
  const nodes: Record<string, NodeOverride> = {};
  for (const n of map.nodes.filter((x) => !x.parent)) nodes[n.id] = { lane: n.lane ?? null, summary: n.summary ?? '' };
  const lanes: NonNullable<Overlay['lanes']> = {};
  for (const l of map.lanes) lanes[l.id] = { label: l.label };
  return {
    $comment: 'codehud overlay: edit lanes / nodes / edges here; the crawler re-applies this file on every run. Delete entries you do not need. Node keys may end in * to match a prefix.',
    version: 1,
    name: map.name,
    lanes,
    addLanes: [],
    nodes,
    addNodes: [],
    addEdges: [],
    removeEdges: [],
  };
}
