<script lang="ts">
  /** Game-style minimap: the whole system at a glance, bottom-right. Click to open the map explorer. */
  import { hud } from '../lib/state.svelte.ts';
  import { computeLayout } from '../lib/layout.ts';
  const layout = $derived(hud.index ? computeLayout(hud.index, hud.index.roots, {}) : null);
  const layerColor = (id: string) => `var(--layer-${id}, var(--layer-default))`;
</script>

{#if layout}
  <button class="minimap" onclick={() => (hud.view = 'map')} title="Open the map (m)">
    <svg viewBox="0 0 {layout.width} {layout.height}" preserveAspectRatio="xMidYMid meet">
      {#each layout.bands as b (b.layer.id)}
        <rect x="0" y={b.y} width={layout.width} height={b.h} fill={layerColor(b.layer.id)} opacity="0.08" />
      {/each}
      {#each layout.columns as c, i (c.id)}
        {#if i > 0}<line x1={c.x} y1="0" x2={c.x} y2={layout.height} stroke="var(--line-2)" stroke-width="3" />{/if}
      {/each}
      {#each layout.cards as c (c.id)}
        <rect x={c.x} y={c.y} width={c.w} height={c.h} rx="10"
          fill={hud.litSet.has(c.id) ? 'var(--accent)' : hud.agentSet.has(c.id) ? 'var(--agent)' : layerColor(c.layer)}
          opacity={hud.litSet.has(c.id) || hud.agentSet.has(c.id) ? 1 : 0.35} />
      {/each}
    </svg>
    <span class="cap">map <kbd>m</kbd></span>
  </button>
{/if}

<style>
  .minimap { position: absolute; right: 14px; bottom: 14px; width: 220px; height: 136px; padding: 6px; z-index: 3;
    background: color-mix(in srgb, var(--bg-2) 85%, transparent); border: 1px solid var(--line-2); border-radius: 10px; backdrop-filter: blur(6px); cursor: pointer; }
  .minimap:hover { border-color: var(--fg-3); }
  svg { width: 100%; height: 100%; display: block; }
  .cap { position: absolute; left: 10px; bottom: 6px; font: 10.5px var(--mono); color: var(--fg-3); }
</style>
