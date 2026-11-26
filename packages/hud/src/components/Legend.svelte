<script lang="ts">
  /** The key to the ground: one row per layer of the loaded map, same textures as the map and the tiles. */
  import { hud } from '../lib/state.svelte.ts';
  import { layerGround, GROUND_MEANING } from '../lib/terrain.ts';
  import Terrain from './Terrain.svelte';
  const rows = $derived((hud.map?.layers ?? []).map((l) => ({ id: l.id, label: l.label, ground: layerGround(hud.map, l.id), color: hud.layerColor(l.id) })));
</script>

{#if rows.length}
  <aside class="legend" aria-label="Ground key">
    <svg width="0" height="0" aria-hidden="true"><Terrain /></svg>
    <h3>Ground</h3>
    {#each rows as r (r.id)}
      <div class="row" title={GROUND_MEANING[r.ground]}>
        <svg class="swatch" width="34" height="16" style="color: {r.color}"><rect width="34" height="16" rx="3" fill="currentColor" opacity=".18" /><rect width="34" height="16" rx="3" fill="url(#tex-{r.ground})" opacity=".9" /></svg>
        <span class="layer">{r.label}</span>
        <span class="ground">{r.ground}</span>
      </div>
    {/each}
    <p>Each row of the map is a layer; its ground says what kind. Columns are lanes. Paths run along the rows and cross at the gutters between lanes.</p>
  </aside>
{/if}

<style>
  .legend { position: absolute; left: 14px; bottom: 14px; width: 220px; padding: 10px 12px; background: color-mix(in srgb, var(--bg-2) 92%, transparent); border: 1px solid var(--line); border-radius: 10px; font-size: 11.5px; color: var(--fg-2); z-index: 3; }
  h3 { margin: 0 0 6px; font: 600 10.5px var(--mono); letter-spacing: .12em; text-transform: uppercase; color: var(--fg-3); }
  .row { display: grid; grid-template-columns: 34px 1fr auto; gap: 8px; align-items: center; padding: 2px 0; }
  .layer { color: var(--fg); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .ground { font: 10.5px var(--mono); color: var(--fg-3); }
  p { margin: 8px 0 0; font-size: 10.5px; color: var(--fg-3); line-height: 1.4; }
</style>
