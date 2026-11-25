/**
 * Edges that leave the current container, rendered as "stubs" at the boundary of the level so a
 * nested view is never an island. Grouped by the outside endpoint lifted to the container's own
 * level (a sibling or cousin of the container).
 */
import type { MapIndex } from '../../../schema/src/index.ts';
import { BAND_LABEL_W, LANE_HEAD_H, type Layout } from './layout.ts';

const HIDDEN_BY_DEFAULT = ['imports', 'depends'];

export interface Stub {
  id: string;
  label: string;
  kind: string;
  layer: string;
  side: 'top' | 'bottom' | 'left' | 'right';
  x: number;
  y: number;
  count: number;
  out: number;
  inn: number;
  kinds: string[];
  /** exact outside nodes behind this stub */
  targets: { id: string; label: string; kind: string }[];
  /** visible cards at this level the stub connects to */
  insideReps: string[];
}

export function outsideStubs(index: MapIndex, containerId: string | null, layout: Layout, opts: { showImports?: boolean } = {}): Stub[] {
  if (!containerId) return [];
  const container = index.get(containerId);
  if (!container) return [];
  const map = index.map;
  const inside = new Set<string>([containerId, ...index.descendants(containerId).map((n) => n.id)]);
  const depth = index.ancestors(containerId).length;
  const liftOutside = (id: string) => index.ancestors(id)[depth]?.id ?? id;
  const liftInside = (id: string): string | null => {
    let cur: string | undefined = id;
    while (cur && cur !== containerId) { if (layout.cardById.has(cur)) return cur; cur = index.get(cur)?.parent; }
    return null;
  };
  const groups = new Map<string, Stub>();
  for (const e of map.edges) {
    if (!opts.showImports && HIDDEN_BY_DEFAULT.includes(e.kind)) continue;
    const fi = inside.has(e.from), ti = inside.has(e.to);
    if (fi === ti) continue;
    const otherId = fi ? e.to : e.from;
    const innerId = fi ? e.from : e.to;
    const other = index.get(otherId);
    if (!other) continue;
    const repId = liftOutside(otherId);
    const rep = index.get(repId) ?? other;
    const g: Stub = groups.get(repId) ?? { id: repId, label: rep.label, kind: rep.kind, layer: index.layerOf(rep), side: 'right', x: 0, y: 0, count: 0, out: 0, inn: 0, kinds: [], targets: [], insideReps: [] };
    g.count++;
    if (fi) g.out++; else g.inn++;
    if (!g.kinds.includes(e.kind)) g.kinds.push(e.kind);
    if (!g.targets.some((t) => t.id === otherId)) g.targets.push({ id: otherId, label: other.label, kind: other.kind });
    const ir = liftInside(innerId);
    if (ir && !g.insideReps.includes(ir)) g.insideReps.push(ir);
    groups.set(repId, g);
  }
  // side: by layer order relative to the container, then lane order
  const layerIdx = new Map(map.layers.map((l, i) => [l.id, i]));
  const laneIdx = new Map(map.lanes.map((l, i) => [l.id, i]));
  const cl = layerIdx.get(index.layerOf(container)) ?? 0;
  const cn = laneIdx.get(index.laneOf(container) ?? '') ?? map.lanes.length;
  const stubs = [...groups.values()].sort((a, b) => a.id.localeCompare(b.id));
  for (const s of stubs) {
    const rep = index.get(s.id)!;
    const li = layerIdx.get(index.layerOf(rep)) ?? cl;
    if (li < cl) s.side = 'top';
    else if (li > cl) s.side = 'bottom';
    else s.side = (laneIdx.get(index.laneOf(rep) ?? '') ?? map.lanes.length) < cn ? 'left' : 'right';
  }
  for (const side of ['top', 'bottom', 'left', 'right'] as const) {
    const list = stubs.filter((s) => s.side === side);
    list.forEach((s, i) => {
      const t = (i + 1) / (list.length + 1);
      if (side === 'top') { s.x = BAND_LABEL_W + (layout.width - BAND_LABEL_W) * t; s.y = -30; }
      else if (side === 'bottom') { s.x = BAND_LABEL_W + (layout.width - BAND_LABEL_W) * t; s.y = layout.height + 30; }
      else if (side === 'left') { s.x = -40; s.y = LANE_HEAD_H + (layout.height - LANE_HEAD_H) * t; }
      else { s.x = layout.width + 80; s.y = LANE_HEAD_H + (layout.height - LANE_HEAD_H) * t; }
    });
  }
  return stubs;
}
