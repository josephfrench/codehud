<script lang="ts">
  /**
   * Game-style minimap: the whole system at a glance. In play it opens the map explorer; in the grid it
   * shows where the current level sits and (at the top level) the viewport rectangle.
   */
  import { hud } from '../lib/state.svelte.ts';
  import { computeLayout } from '../lib/layout.ts';
  let { viewport = null as { x: number; y: number; w: number; h: number } | null } = $props();
  const layout = $derived(hud.index ? computeLayout(hud.index, hud.index.roots, {}) : null);
  /** the top-level ancestor of the current container, so a zoomed-in level is marked on the overview */
  const hereId = $derived(hud.focusPath[0] ?? null);
  const layerColor = (id: string) => hud.layerColor(id);
  const fill = (id: string, layer: string) => (hud.litSet.has(id) ? 'var(--accent)' : hud.agentColorByNode.get(id) ?? layerColor(layer));
  function onClick() {
    if (hud.view !== 'map') hud.view = 'map';
    else if (hud.focusPath.length) hud.jumpTo(0);
  }
</script>

{#if layout}
  <button class="minimap" onclick={onClick} title={hud.view === 'map' ? (hud.focusPath.length ? 'Back to the top level' : 'Whole system') : 'Open the map (m)'}>
    <svg viewBox="0 0 {layout.width} {layout.height}" preserveAspectRatio="xMidYMid meet">
      {#each layout.bands as b (b.layer.id)}
        <rect x="0" y={b.y} width={layout.width} height={b.h} fill={layerColor(b.layer.id)} opacity="0.08" />
      {/each}
      {#each layout.columns as c, i (c.id)}
        {#if i > 0}<line x1={c.x} y1="0" x2={c.x} y2={layout.height} stroke="var(--line-2)" stroke-width="3" />{/if}
      {/each}
      {#each layout.cards as c (c.id)}
        <rect x={c.x} y={c.y} width={c.w} height={c.h} rx="10"
          fill={fill(c.id, c.layer)}
          opacity={hud.litSet.has(c.id) || hud.agentSet.has(c.id) || c.id === hereId ? 1 : 0.35} />
        {#if c.id === hereId}
          <rect x={c.x - 10} y={c.y - 10} width={c.w + 20} height={c.h + 20} rx="14" fill="none" stroke="var(--fg)" stroke-width="5" />
        {/if}
      {/each}
      {#if viewport}
        <rect x={viewport.x} y={viewport.y} width={viewport.w} height={viewport.h} fill="none" stroke="var(--fg)" stroke-width="4" opacity=".6" />
      {/if}
    </svg>
    <span class="cap">{hud.view === 'map' ? (hud.focusPath.length ? `inside ${hud.current?.label ?? ''}` : 'overview') : 'map'} {#if hud.view !== 'map'}<kbd>m</kbd>{/if}</span>
  </button>
{/if}

<style>
  .minimap { position: absolute; right: 14px; bottom: 14px; width: 220px; height: 136px; padding: 6px; z-index: 3;
    background: color-mix(in srgb, var(--bg-2) 85%, transparent); border: 1px solid var(--line-2); border-radius: 10px; backdrop-filter: blur(6px); cursor: pointer; }
  .minimap:hover { border-color: var(--fg-3); }
  svg { width: 100%; height: 100%; display: block; }
  .cap { position: absolute; left: 10px; bottom: 6px; font: 10.5px var(--mono); color: var(--fg-3); white-space: nowrap; max-width: 190px; overflow: hidden; text-overflow: ellipsis; }
</style>
