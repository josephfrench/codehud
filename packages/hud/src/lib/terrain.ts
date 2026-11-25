/**
 * Ground. Every layer (a horizontal row of the map) is a kind of terrain, and the key is the same
 * everywhere: the grid's bands, the 3D floor's strips, and the tile a sprite stands on in play view.
 * Lanes are districts: they get fences between them, not textures.
 * Pattern defs live in components/Terrain.svelte (ids `tex-<ground>`); the key is in Legend.svelte.
 */
import type { SystemMap } from '../../../schema/src/index.ts';

export const GROUNDS = ['plaza', 'wall', 'road', 'town', 'water', 'fog', 'rail', 'field'] as const;
export type Ground = (typeof GROUNDS)[number];

/** what each ground stands for, for the legend */
export const GROUND_MEANING: Record<Ground, string> = {
  plaza: 'what people see and touch',
  wall: 'the boundary: guards, limits, sessions',
  road: 'where requests travel',
  town: 'where the work happens',
  water: 'what is kept: tables, stores, caches',
  fog: 'beyond the border: other systems',
  rail: 'things that move on a schedule or a queue',
  field: 'everything else',
};

const BY_WORD: [RegExp, Ground][] = [
  [/client|ui\b|web|front|browser|page|view|screen/i, 'plaza'],
  [/edge|gateway|middleware|proxy|ingress|guard|auth/i, 'wall'],
  [/api|route|http|handler|controller|endpoint|rpc/i, 'road'],
  [/domain|service|logic|core|business|worker|app|module/i, 'town'],
  [/persist|data|db|store|storage|cache|table|repo/i, 'water'],
  [/external|third|vendor|saas|outside|provider|integration/i, 'fog'],
  [/infra|queue|job|event|bus|message|pipeline|cron|schedule/i, 'rail'],
];

/** The ground of a layer: by what its id and label say, else by its position among the layers. */
export function layerGround(map: SystemMap | null, layerId: string | undefined): Ground {
  if (!map || !layerId) return 'field';
  const i = map.layers.findIndex((l) => l.id === layerId);
  const layer = map.layers[i];
  const text = `${layerId} ${layer?.label ?? ''}`;
  for (const [re, g] of BY_WORD) if (re.test(text)) return g;
  return i < 0 ? 'field' : GROUNDS[i % GROUNDS.length];
}
