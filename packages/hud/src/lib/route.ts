/**
 * Edge routing for the layer x lane grid.
 *
 * Edges are footpaths, not wires: a path leaves a card, drops into the gap below it, walks along a
 * free channel, and goes round any card that sits in the way, instead of cutting straight through
 * it. Channels are the band boundaries (always free: every cell keeps CELL_PAD clear of them) and
 * the row gaps inside a cell. Corridors are the free x positions between cards. Deterministic:
 * same cards in, same polyline out.
 */
export interface Pt { x: number; y: number }
export interface Box { id: string; x: number; y: number; w: number; h: number }

const MX = 7;        // keep this far from a card horizontally
const MY = 5;        // and vertically
const APPROACH = 9;  // last channel before entering a card: the middle of a row gap (GAP = 18)
const NARROW = 22;   // corridors narrower than this are a squeeze between two cards; avoided when possible

interface Ctx { boxes: Box[]; skip: Set<string> }

const cx = (b: Box) => b.x + b.w / 2;

function blockedV(c: Ctx, x: number, y0: number, y1: number): boolean {
  const lo = Math.min(y0, y1), hi = Math.max(y0, y1);
  if (hi - lo < 1) return false;
  for (const b of c.boxes) {
    if (c.skip.has(b.id)) continue;
    if (x <= b.x - MX || x >= b.x + b.w + MX) continue;
    if (hi <= b.y - MY || lo >= b.y + b.h + MY) continue;
    return true;
  }
  return false;
}

/** Free x positions over the vertical span [y0, y1], as gaps between the cards that overlap it. */
function corridor(c: Ctx, y0: number, y1: number, target: number, cur: number, xmin: number, xmax: number): number {
  const lo = Math.min(y0, y1), hi = Math.max(y0, y1);
  const iv: [number, number][] = [];
  for (const b of c.boxes) {
    if (c.skip.has(b.id)) continue;
    if (hi <= b.y - MY || lo >= b.y + b.h + MY) continue;
    iv.push([b.x - MX, b.x + b.w + MX]);
  }
  iv.sort((a, b) => a[0] - b[0]);
  const merged: [number, number][] = [];
  for (const i of iv) {
    const last = merged[merged.length - 1];
    if (last && i[0] <= last[1]) last[1] = Math.max(last[1], i[1]);
    else merged.push([i[0], i[1]]);
  }
  const gaps: [number, number][] = [];
  let edge = xmin;
  for (const [a, b] of merged) { if (a > edge) gaps.push([edge, a]); edge = Math.max(edge, b); }
  if (edge < xmax) gaps.push([edge, xmax]);
  let best: number | null = null, bestScore = Infinity;
  for (const [a, b] of gaps) {
    if (b - a < 6) continue;
    const x = Math.min(Math.max(target, a + 3), b - 3);
    const score = Math.abs(x - target) + 0.35 * Math.abs(x - cur) + (b - a < NARROW ? 40 : 0);
    if (score < bestScore) { bestScore = score; best = x; }
  }
  return best ?? target;
}

/**
 * Walk from (x, y) to the level `toY`, sidestepping along `channelY` when the straight drop is blocked.
 * Prefers `target` x when the drop at target is free, else the current x, else the nearest free corridor.
 */
function drop(c: Ctx, pts: Pt[], toY: number, channelY: number, target: number, xmin: number, xmax: number, headTo: boolean) {
  const cur = pts[pts.length - 1];
  let x: number;
  if (headTo && Math.abs(target - cur.x) > 0.5 && !blockedV(c, target, channelY, toY)) x = target;
  else if (!blockedV(c, cur.x, cur.y, toY)) x = cur.x;
  else x = corridor(c, channelY, toY, headTo ? target : cur.x, cur.x, xmin, xmax);
  if (Math.abs(x - cur.x) > 0.5) {
    if (Math.abs(channelY - cur.y) > 0.5) pts.push({ x: cur.x, y: channelY });
    pts.push({ x, y: channelY });
  }
  pts.push({ x, y: toY });
}

/**
 * Route from card `a` to card `b`. `off` fans out parallel edges. `levels` are the free horizontal
 * channels between the two cards' bands (band boundaries), in travel order. `xRange` bounds corridors.
 */
export function routeBoxes(a: Box, b: Box, off: number, boxes: Box[], levels: number[], xRange: [number, number]): Pt[] {
  const c: Ctx = { boxes, skip: new Set([a.id, b.id]) };
  const [xmin, xmax] = xRange;
  const sameBand = levels.length === 0;

  if (sameBand) {
    // Same layer. Straight across when nothing is in the way, else down into the gap and round.
    const right = cx(b) > cx(a);
    const y = (a.y + a.h / 2 + b.y + b.h / 2) / 2 + off;
    const x1 = right ? a.x + a.w : a.x, x2 = right ? b.x : b.x + b.w;
    const sameRow = Math.abs(a.y - b.y) < 2;
    if (sameRow && !blockedH(c, y, x1, x2)) return [{ x: x1, y }, { x: x2, y }];
    const below = Math.max(a.y + a.h, b.y + b.h) + APPROACH + off * 0.5;
    const pts: Pt[] = [{ x: cx(a) + off, y: a.y + a.h }];
    drop(c, pts, below, a.y + a.h + APPROACH, cx(a) + off, xmin, xmax, false);
    const back: Pt[] = [{ x: cx(b) + off, y: b.y + b.h }];
    drop(c, back, below, b.y + b.h + APPROACH, cx(b) + off, xmin, xmax, false);
    back.reverse();
    return dedupe([...pts, ...back]);
  }

  const down = b.y > a.y;
  const sgn = down ? 1 : -1;
  const exitY = down ? a.y + a.h : a.y;
  const entryY = down ? b.y : b.y + b.h;
  const target = cx(b) + off;
  const pts: Pt[] = [{ x: cx(a) + off, y: exitY }];
  const lv = levels.map((y) => y + off * 0.5);

  // out of a's band: sidestep in the row gap right below a only if the straight drop is blocked
  drop(c, pts, lv[0], exitY + sgn * APPROACH, target, xmin, xmax, false);
  // through every intermediate band: move along the boundary, descend through a free corridor
  for (let i = 1; i < lv.length; i++) drop(c, pts, lv[i], lv[i - 1], target, xmin, xmax, true);
  // into b's band: aim for b's column, else the nearest free corridor, then the last gap and in
  const approachY = entryY - sgn * APPROACH;
  drop(c, pts, approachY, lv[lv.length - 1], target, xmin, xmax, true);
  const last = pts[pts.length - 1];
  if (Math.abs(last.x - target) > 0.5) pts.push({ x: target, y: approachY });
  pts.push({ x: target, y: entryY });
  return dedupe(pts);
}

function blockedH(c: Ctx, y: number, x0: number, x1: number): boolean {
  const lo = Math.min(x0, x1), hi = Math.max(x0, x1);
  for (const b of c.boxes) {
    if (c.skip.has(b.id)) continue;
    if (y <= b.y - MY || y >= b.y + b.h + MY) continue;
    if (hi <= b.x - MX || lo >= b.x + b.w + MX) continue;
    return true;
  }
  return false;
}

function dedupe(pts: Pt[]): Pt[] {
  const out: Pt[] = [];
  for (const p of pts) {
    const l = out[out.length - 1];
    if (l && Math.abs(l.x - p.x) < 0.5 && Math.abs(l.y - p.y) < 0.5) continue;
    out.push(p);
  }
  // drop collinear middles
  for (let i = out.length - 2; i > 0; i--) {
    const p = out[i - 1], q = out[i], r = out[i + 1];
    if ((Math.abs(p.x - q.x) < 0.5 && Math.abs(q.x - r.x) < 0.5) || (Math.abs(p.y - q.y) < 0.5 && Math.abs(q.y - r.y) < 0.5)) out.splice(i, 1);
  }
  return out;
}

/** SVG path through the points with rounded corners. */
export function roundedPath(pts: Pt[], r = 10, tx: (p: Pt) => Pt = (p) => p): string {
  if (!pts.length) return '';
  const p = pts.map(tx);
  if (p.length === 1) return `M${f(p[0].x)},${f(p[0].y)}`;
  let d = `M${f(p[0].x)},${f(p[0].y)}`;
  for (let i = 1; i < p.length - 1; i++) {
    const a = p[i - 1], b = p[i], c = p[i + 1];
    const l1 = Math.hypot(b.x - a.x, b.y - a.y), l2 = Math.hypot(c.x - b.x, c.y - b.y);
    const rr = Math.min(r, l1 / 2, l2 / 2);
    if (rr < 0.5) { d += ` L${f(b.x)},${f(b.y)}`; continue; }
    const p1 = { x: b.x + ((a.x - b.x) / l1) * rr, y: b.y + ((a.y - b.y) / l1) * rr };
    const p2 = { x: b.x + ((c.x - b.x) / l2) * rr, y: b.y + ((c.y - b.y) / l2) * rr };
    d += ` L${f(p1.x)},${f(p1.y)} Q${f(b.x)},${f(b.y)} ${f(p2.x)},${f(p2.y)}`;
  }
  const e = p[p.length - 1];
  return d + ` L${f(e.x)},${f(e.y)}`;
}

/**
 * Several paths share a channel (a band boundary). Give each its own track inside the channel so they
 * run side by side instead of on top of each other. Mutates the points in place; call before building `d`.
 */
export function spreadChannels(paths: Pt[][], step = 6) {
  interface Seg { pts: Pt[]; i: number; x0: number; x1: number }
  const byY = new Map<number, Seg[]>();
  for (const pts of paths) {
    for (let i = 0; i + 1 < pts.length; i++) {
      const a = pts[i], b = pts[i + 1];
      if (Math.abs(a.y - b.y) > 0.5 || Math.abs(a.x - b.x) < 1) continue;
      const y = Math.round(a.y);
      (byY.get(y) ?? byY.set(y, []).get(y)!).push({ pts, i, x0: Math.min(a.x, b.x), x1: Math.max(a.x, b.x) });
    }
  }
  for (const segs of byY.values()) {
    if (segs.length < 2) continue;
    segs.sort((p, q) => p.x0 - q.x0 || p.x1 - q.x1);
    const tracks: number[] = []; // right edge of the last segment on each track
    const assigned: number[] = [];
    for (const s of segs) {
      let t = tracks.findIndex((end) => end + 12 <= s.x0);
      if (t < 0) { t = tracks.length; tracks.push(s.x1); } else tracks[t] = s.x1;
      assigned.push(t);
    }
    if (tracks.length < 2) continue;
    segs.forEach((s, k) => {
      const dy = (assigned[k] - (tracks.length - 1) / 2) * step;
      s.pts[s.i] = { x: s.pts[s.i].x, y: s.pts[s.i].y + dy };
      s.pts[s.i + 1] = { x: s.pts[s.i + 1].x, y: s.pts[s.i + 1].y + dy };
    });
  }
}

/** Where a label sits: the middle of the longest vertical run (paths leave cards vertically, so that spreads labels out), else half way along. */
export function labelPoint(pts: Pt[]): Pt {
  let best: Pt | null = null, bestLen = 18;
  for (let i = 0; i + 1 < pts.length; i++) {
    const a = pts[i], b = pts[i + 1];
    const len = Math.abs(b.y - a.y);
    if (Math.abs(a.x - b.x) < 0.5 && len > bestLen) { bestLen = len; best = { x: a.x, y: (a.y + b.y) / 2 }; }
  }
  return best ?? polylineMid(pts);
}

/** The point half way along the polyline, by length. */
export function polylineMid(pts: Pt[]): Pt {
  if (pts.length < 2) return pts[0] ?? { x: 0, y: 0 };
  let total = 0;
  for (let i = 1; i < pts.length; i++) total += Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y);
  let acc = 0;
  for (let i = 1; i < pts.length; i++) {
    const seg = Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y);
    if (acc + seg >= total / 2) {
      const t = seg ? (total / 2 - acc) / seg : 0;
      return { x: pts[i - 1].x + (pts[i].x - pts[i - 1].x) * t, y: pts[i - 1].y + (pts[i].y - pts[i - 1].y) * t };
    }
    acc += seg;
  }
  return pts[pts.length - 1];
}

const f = (n: number) => (Math.round(n * 10) / 10).toString();
