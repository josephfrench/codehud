/**
 * Layout for the focus graph: focal nodes in the middle, upstream (things that
 * call / render / guard the focus) above, downstream (what the focus calls,
 * reads, writes, emits) below. Deterministic.
 */
import type { MapIndex, SysNode, SysEdge, EdgeKind } from '../../../schema/src/index.ts';

export type Role = 'focal' | 'up' | 'down' | 'more';
export interface FNode { id: string; node: SysNode | null; role: Role; x: number; y: number; w: number; h: number; children: SysNode[]; moreCount?: number }
export interface FEdge { key: string; from: string; to: string; kinds: EdgeKind[]; label: string; d: string; mid: { x: number; y: number }; flow: boolean }
export interface Container { parent: SysNode; x: number; y: number; w: number; h: number }
export interface FocusLayout { nodes: FNode[]; edges: FEdge[]; container: Container | null; bbox: { x: number; y: number; w: number; h: number } }

const FOCAL_W = 250, FOCAL_H = 92, SIDE_W = 190, SIDE_H = 66, GAP_Y = 215, CHIP_ROW = 30;
const HIDDEN: EdgeKind[] = ['imports', 'depends'];

export function focusLayout(index: MapIndex, focalIds: string[], opts: { maxSide?: number; showImports?: boolean } = {}): FocusLayout | null {
  const maxSide = opts.maxSide ?? 7;
  const focal = focalIds.map((id) => index.get(id)).filter((n): n is SysNode => !!n);
  if (!focal.length) return null;
  const focalSet = new Set(focal.map((n) => n.id));

  // Classify neighbours. A node that is both up and down of the focus goes below.
  const up = new Map<string, SysEdge[]>();
  const down = new Map<string, SysEdge[]>();
  const internal: SysEdge[] = [];
  for (const e of index.map.edges) {
    if (!opts.showImports && HIDDEN.includes(e.kind)) continue;
    const f = focalSet.has(e.from), t = focalSet.has(e.to);
    if (f && t) { internal.push(e); continue; }
    if (t && !f) (up.get(e.from) ?? up.set(e.from, []).get(e.from)!).push(e);
    if (f && !t) (down.get(e.to) ?? down.set(e.to, []).get(e.to)!).push(e);
  }
  for (const id of [...up.keys()]) if (down.has(id)) { down.get(id)!.push(...up.get(id)!); up.delete(id); }

  const order = new Map(index.map.nodes.map((n, i) => [n.id, i]));
  const sortIds = (ids: string[]) => ids.sort((a, b) => (order.get(a) ?? 0) - (order.get(b) ?? 0));
  const pick = (ids: string[]) => (ids.length > maxSide ? { shown: ids.slice(0, maxSide - 1), more: ids.length - (maxSide - 1) } : { shown: ids, more: 0 });
  const upPick = pick(sortIds([...up.keys()]));
  const downPick = pick(sortIds([...down.keys()]));

  const nodes: FNode[] = [];
  const place = (ids: string[], more: number, role: 'up' | 'down') => {
    const total = ids.length + (more ? 1 : 0);
    const step = SIDE_W + 26;
    const y = role === 'up' ? -GAP_Y : GAP_Y;
    ids.forEach((id, i) => nodes.push({ id, node: index.get(id)!, role, x: (i - (total - 1) / 2) * step, y, w: SIDE_W, h: SIDE_H, children: [] }));
    if (more) nodes.push({ id: `more:${role}`, node: null, role: 'more', x: (ids.length - (total - 1) / 2) * step, y, w: SIDE_W, h: SIDE_H, children: [], moreCount: more });
  };
  place(upPick.shown, upPick.more, 'up');
  place(downPick.shown, downPick.more, 'down');

  const fstep = FOCAL_W + 34;
  focal.forEach((n, i) => {
    const kids = index.childrenOf(n.id);
    nodes.push({ id: n.id, node: n, role: 'focal', x: (i - (focal.length - 1) / 2) * fstep, y: 0, w: FOCAL_W, h: FOCAL_H + (kids.length ? CHIP_ROW : 0), children: kids });
  });

  const byId = new Map(nodes.map((n) => [n.id, n]));
  const edges: FEdge[] = [];
  const addEdges = (list: SysEdge[], fromId: string, toId: string) => {
    const a = byId.get(fromId), b = byId.get(toId);
    if (!a || !b) return;
    const kinds = [...new Set(list.map((e) => e.kind))];
    const labels = [...new Set(list.map((e) => e.label).filter(Boolean))] as string[];
    const p1 = { x: a.x, y: a.y + a.h / 2 };
    const p2 = { x: b.x, y: b.y - b.h / 2 };
    const goingDown = p2.y > p1.y;
    const s = goingDown ? p1 : { x: a.x, y: a.y - a.h / 2 };
    const t = goingDown ? p2 : { x: b.x, y: b.y + b.h / 2 };
    const k = Math.max(40, Math.abs(t.y - s.y) * 0.5);
    const c1 = { x: s.x, y: s.y + (goingDown ? k : -k) };
    const c2 = { x: t.x, y: t.y - (goingDown ? k : -k) };
    const d = `M${s.x},${s.y} C${c1.x},${c1.y} ${c2.x},${c2.y} ${t.x},${t.y}`;
    const mid = { x: 0.125 * s.x + 0.375 * c1.x + 0.375 * c2.x + 0.125 * t.x, y: 0.125 * s.y + 0.375 * c1.y + 0.375 * c2.y + 0.125 * t.y };
    edges.push({ key: `${fromId}>${toId}`, from: fromId, to: toId, kinds, label: labels[0] ?? kinds.join(' · '), d, mid, flow: kinds.some((x) => x === 'calls' || x === 'writes' || x === 'emits' || x === 'navigates') });
  };
  for (const [id, list] of up) if (byId.has(id)) {
    const byTarget = new Map<string, SysEdge[]>();
    for (const e of list) (byTarget.get(e.to) ?? byTarget.set(e.to, []).get(e.to)!).push(e);
    for (const [to, l] of byTarget) addEdges(l, id, to);
  }
  for (const [id, list] of down) if (byId.has(id)) {
    const bySource = new Map<string, SysEdge[]>();
    for (const e of list) {
      const src = focalSet.has(e.from) ? e.from : e.to; // edges that were re-homed from `up` point the other way
      (bySource.get(src) ?? bySource.set(src, []).get(src)!).push(e);
    }
    for (const [from, l] of bySource) addEdges(l, from, id);
  }
  for (const e of internal) addEdges([e], e.from, e.to);

  // Container: shared parent of all focal nodes.
  let container: Container | null = null;
  const parents = new Set(focal.map((n) => n.parent ?? ''));
  if (parents.size === 1 && focal[0].parent) {
    const parent = index.get(focal[0].parent);
    if (parent) {
      const fs = nodes.filter((n) => n.role === 'focal');
      const x0 = Math.min(...fs.map((n) => n.x - n.w / 2)) - 34, x1 = Math.max(...fs.map((n) => n.x + n.w / 2)) + 34;
      const y0 = Math.min(...fs.map((n) => n.y - n.h / 2)) - 44, y1 = Math.max(...fs.map((n) => n.y + n.h / 2)) + 30;
      container = { parent, x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
    }
  }

  const xs = nodes.flatMap((n) => [n.x - n.w / 2, n.x + n.w / 2]).concat(container ? [container.x, container.x + container.w] : []);
  const ys = nodes.flatMap((n) => [n.y - n.h / 2, n.y + n.h / 2]).concat(container ? [container.y, container.y + container.h] : []);
  const bbox = { x: Math.min(...xs), y: Math.min(...ys), w: Math.max(...xs) - Math.min(...xs), h: Math.max(...ys) - Math.min(...ys) };
  return { nodes, edges, container, bbox };
}
