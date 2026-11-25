/**
 * Swimlane terrain: every lane gets a texture and a tone, so a lane reads as a kind of ground
 * wherever its nodes appear (grid columns, 3D floor strips, tiles under sprites in play view).
 * The shared lane has no terrain. Pattern defs live in components/Terrain.svelte (ids `tex-<name>`).
 */
import type { SystemMap } from '../../../schema/src/index.ts';

export const TEXTURES = ['dots', 'diag', 'waves', 'grid', 'zigzag', 'rings', 'checker', 'cross'] as const;
export type Texture = (typeof TEXTURES)[number];

const PALETTE_SIZE = 8;

function laneIndex(map: SystemMap | null, laneId: string | undefined): number {
  if (!map || !laneId) return -1;
  return map.lanes.findIndex((l) => l.id === laneId);
}

/** The lane's texture by its position in `map.lanes`; null for the shared lane or an unknown id. */
export function laneTexture(map: SystemMap | null, laneId: string | undefined): Texture | null {
  const i = laneIndex(map, laneId);
  return i < 0 ? null : TEXTURES[i % TEXTURES.length];
}

/** The lane's tone: a palette slot offset from the layer slots so neighbours differ. */
export function laneTone(map: SystemMap | null, laneId: string | undefined): string {
  const i = laneIndex(map, laneId);
  return i < 0 ? 'var(--fg-3)' : `var(--palette-${(i + 5) % PALETTE_SIZE})`;
}
