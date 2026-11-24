/** Where the specifics card sits relative to the element it blew out of. */
export const CARD_W = 400;
export const CARD_MAX_H_VH = 0.7;

export function anchorFor(from: { x: number; y: number } | null, vw: number, vh: number) {
  const maxH = vh * CARD_MAX_H_VH;
  if (!from) return { left: vw - CARD_W - 24, top: 72, side: 'right' as const, maxH };
  let side: 'right' | 'left' = 'right';
  let left = from.x + 110;
  if (left + CARD_W > vw - 16) { side = 'left'; left = from.x - 110 - CARD_W; }
  if (left < 16) { left = 16; }
  const top = Math.min(Math.max(from.y - 150, 56), Math.max(56, vh - 24 - maxH));
  return { left, top, side, maxH };
}
