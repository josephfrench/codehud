/**
 * Colour helpers. Nothing in the HUD may assume the six well-known layers: a map can declare any
 * layer set, in any order. Well-known ids keep their CSS variables; anything else falls back to a
 * palette slot chosen by the layer's position in `map.layers`, unless the layer declares `color`.
 */
import type { Layer } from '../../../schema/src/index.ts';

const WELL_KNOWN = new Set(['client', 'edge', 'api', 'domain', 'persistence', 'external']);
export const PALETTE_SIZE = 8;

export function layerColor(layers: Layer[], id: string): string {
  const i = layers.findIndex((l) => l.id === id);
  const l = layers[i];
  if (l?.color) return l.color;
  if (WELL_KNOWN.has(id)) return `var(--layer-${id})`;
  return `var(--layer-${id}, var(--palette-${(i < 0 ? PALETTE_SIZE - 1 : i) % PALETTE_SIZE}))`;
}

/** Six agent hues, themed in app.css (`--agent-0` … `--agent-5`); slot 0 is the classic agent blue. */
export const AGENT_SLOTS = 6;

function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}

/** Per-session colour: the session's own `color` when it declares one, else a palette slot derived from its id. */
export function sessionColor(session: { id: string; color?: string } | string | null | undefined): string {
  if (!session) return 'var(--agent)';
  if (typeof session !== 'string' && session.color) return session.color;
  const id = typeof session === 'string' ? session : session.id;
  return `var(--agent-${hash(id) % AGENT_SLOTS})`;
}
