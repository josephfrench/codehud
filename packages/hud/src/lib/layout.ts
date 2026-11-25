/**
 * Deterministic layer x lane grid layout for one zoom level.
 * Same input => same output, always. Nodes keep their declared order.
 */
import type { MapIndex, SysNode, SysEdge, Layer, Lane, EdgeKind } from '../../../schema/src/index.ts';
import { routeBoxes, roundedPath, labelPoint, spreadChannels, type Pt } from './route.ts';

export const CARD_W = 200;
export const CARD_H = 72;
export const GAP = 18;
export const CELL_PAD = 26;
export const BAND_LABEL_W = 120;
export const LANE_HEAD_H = 40;
export const MIN_COL_W = CARD_W + CELL_PAD * 2;
export const MIN_ROW_H = CARD_H + CELL_PAD * 2;

export interface Card { id: string; node: SysNode; x: number; y: number; w: number; h: number; layer: string; lane: string }
export interface Band { layer: Layer; y: number; h: number }
export interface Column { lane: Lane | null; id: string; x: number; w: number }
export interface VisEdge {
  key: string;
  from: string;
  to: string;
  kind: EdgeKind;
  count: number;
  labels: string[];
  /** original edge ids folded into this one */
  ids: string[];
  /** true when at least one original edge connects exactly these two visible nodes (not lifted) */
  direct: boolean;
  /** the footpath: card edge -> channels and corridors -> card edge (layout coordinates) */
  points: Pt[];
  d: string;
  mid: { x: number; y: number };
}
export interface Layout {
  width: number;
  height: number;
  bands: Band[];
  columns: Column[];
  cards: Card[];
  cardById: Map<string, Card>;
  edges: VisEdge[];
}

export const SHARED_LANE = '__shared';
const HIDDEN_BY_DEFAULT: EdgeKind[] = ['imports', 'depends'];

export function computeLayout(index: MapIndex, visible: SysNode[], opts: { showImports?: boolean } = {}): Layout {
  const map = index.map;
  const layerOrder = new Map(map.layers.map((l, i) => [l.id, i]));
  const laneOrder = new Map(map.lanes.map((l, i) => [l.id, i]));

  // Which layers / lanes appear at this level
  const cells = new Map<string, SysNode[]>();
  const usedLayers = new Set<string>();
  const usedLanes = new Set<string>();
  for (const n of visible) {
    const layer = index.layerOf(n) || map.layers[0]?.id || 'other';
    const lane = index.laneOf(n) ?? SHARED_LANE;
    usedLayers.add(layer);
    usedLanes.add(lane);
    const k = `${layer}|${lane}`;
    const arr = cells.get(k) ?? [];
    arr.push(n);
    cells.set(k, arr);
  }
  const layers = map.layers.filter((l) => usedLayers.has(l.id)).sort((a, b) => (layerOrder.get(a.id)! - layerOrder.get(b.id)!));
  const laneIds = [...map.lanes.filter((l) => usedLanes.has(l.id)).sort((a, b) => laneOrder.get(a.id)! - laneOrder.get(b.id)!).map((l) => l.id)];
  if (usedLanes.has(SHARED_LANE)) laneIds.push(SHARED_LANE);

  // Grid geometry per cell
  const gridOf = (n: number) => {
    const cols = n <= 3 ? n : n <= 8 ? Math.ceil(n / 2) : Math.ceil(Math.sqrt(n));
    return { cols, rows: Math.ceil(n / cols) };
  };
  const colW = new Map<string, number>();
  const rowH = new Map<string, number>();
  for (const laneId of laneIds) colW.set(laneId, MIN_COL_W);
  for (const l of layers) rowH.set(l.id, MIN_ROW_H);
  for (const [k, nodes] of cells) {
    const [layer, lane] = k.split('|');
    const { cols, rows } = gridOf(nodes.length);
    colW.set(lane, Math.max(colW.get(lane)!, cols * CARD_W + (cols - 1) * GAP + CELL_PAD * 2));
    rowH.set(layer, Math.max(rowH.get(layer)!, rows * CARD_H + (rows - 1) * GAP + CELL_PAD * 2));
  }

  const columns: Column[] = [];
  let x = BAND_LABEL_W;
  for (const laneId of laneIds) {
    const w = colW.get(laneId)!;
    columns.push({ id: laneId, lane: map.lanes.find((l) => l.id === laneId) ?? null, x, w });
    x += w;
  }
  const width = x;
  const bands: Band[] = [];
  let y = LANE_HEAD_H;
  for (const l of layers) {
    const h = rowH.get(l.id)!;
    bands.push({ layer: l, y, h });
    y += h;
  }
  const height = y;

  // Cards
  const cards: Card[] = [];
  const cardById = new Map<string, Card>();
  for (const [k, nodes] of cells) {
    const [layer, lane] = k.split('|');
    const col = columns.find((c) => c.id === lane)!;
    const band = bands.find((b) => b.layer.id === layer)!;
    const { cols, rows } = gridOf(nodes.length);
    const blockW = cols * CARD_W + (cols - 1) * GAP;
    const blockH = rows * CARD_H + (rows - 1) * GAP;
    const ox = col.x + (col.w - blockW) / 2;
    const oy = band.y + (band.h - blockH) / 2;
    nodes.forEach((n, i) => {
      const c = i % cols, r = Math.floor(i / cols);
      const card: Card = { id: n.id, node: n, x: ox + c * (CARD_W + GAP), y: oy + r * (CARD_H + GAP), w: CARD_W, h: CARD_H, layer, lane };
      cards.push(card);
      cardById.set(n.id, card);
    });
  }

  // Edges: lift to visible representatives and aggregate
  const rep = (id: string): string | null => {
    let cur: string | undefined = id;
    const seen = new Set<string>();
    while (cur && !seen.has(cur)) {
      if (cardById.has(cur)) return cur;
      seen.add(cur);
      cur = index.get(cur)?.parent;
    }
    return null;
  };
  const agg = new Map<string, VisEdge>();
  for (const e of map.edges as (SysEdge & { id: string })[]) {
    if (!opts.showImports && HIDDEN_BY_DEFAULT.includes(e.kind)) continue;
    const a = rep(e.from), b = rep(e.to);
    if (!a || !b || a === b) continue;
    const key = `${a}|${b}|${e.kind}`;
    const direct = e.from === a && e.to === b;
    const cur = agg.get(key);
    if (cur) {
      cur.count++;
      cur.ids.push(e.id);
      cur.direct ||= direct;
      if (e.label && !cur.labels.includes(e.label)) cur.labels.push(e.label);
    } else {
      agg.set(key, { key, from: a, to: b, kind: e.kind, count: 1, labels: e.label ? [e.label] : [], ids: [e.id], direct, points: [], d: '', mid: { x: 0, y: 0 } });
    }
  }
  // Group parallel edges between the same pair so we can fan them out
  const pairs = new Map<string, VisEdge[]>();
  for (const ve of agg.values()) {
    const pk = ve.from < ve.to ? `${ve.from}|${ve.to}` : `${ve.to}|${ve.from}`;
    const arr = pairs.get(pk) ?? [];
    arr.push(ve);
    pairs.set(pk, arr);
  }
  const bandIndex = new Map(bands.map((b, i) => [b.layer.id, i]));
  const xRange: [number, number] = [BAND_LABEL_W + 6, width - 6];
  for (const group of pairs.values()) {
    group.forEach((ve, i) => {
      const off = (i - (group.length - 1) / 2) * 14;
      const a = cardById.get(ve.from)!, b = cardById.get(ve.to)!;
      ve.points = routeBoxes(a, b, off, cards, levelsBetween(bands, bandIndex.get(a.layer)!, bandIndex.get(b.layer)!), xRange);
    });
  }
  const all = [...agg.values()];
  spreadChannels(all.map((ve) => ve.points));
  for (const ve of all) { ve.d = roundedPath(ve.points, 10); ve.mid = labelPoint(ve.points); }
  return { width, height, bands, columns, cards, cardById, edges: [...agg.values()] };
}

/** The free horizontal channels (band boundaries) a path crosses going from band i to band j, in travel order. */
function levelsBetween(bands: Band[], i: number, j: number): number[] {
  const out: number[] = [];
  if (j > i) for (let k = i; k < j; k++) out.push(bands[k].y + bands[k].h);
  else if (j < i) for (let k = i; k > j; k--) out.push(bands[k].y);
  return out;
}

export function bbox(cards: Card[]) {
  if (!cards.length) return null;
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const c of cards) { x0 = Math.min(x0, c.x); y0 = Math.min(y0, c.y); x1 = Math.max(x1, c.x + c.w); y1 = Math.max(y1, c.y + c.h); }
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}

export const KIND_GLYPH: Record<string, string> = {
  app: '▣', page: '▭', component: '◇', route: '⇄', middleware: '⛨', service: '⚙', module: '▦', function: 'ƒ',
  job: '⏱', queue: '≡', event: '⚡', table: '▤', store: '⬢', cache: '◍', external: '☁', config: '⚒', test: '✓', other: '•',
};

export const EDGE_STYLE: Record<string, { dash?: string; label: string }> = {
  calls: { label: 'calls' },
  renders: { dash: '2 4', label: 'renders' },
  navigates: { dash: '6 4', label: 'navigates' },
  reads: { dash: '1 4', label: 'reads' },
  writes: { label: 'writes' },
  emits: { dash: '8 3 2 3', label: 'emits' },
  listens: { dash: '8 3 2 3', label: 'listens' },
  guards: { dash: '3 3', label: 'guards' },
  imports: { dash: '1 3', label: 'imports' },
  depends: { dash: '1 3', label: 'depends' },
  other: { label: '' },
};
