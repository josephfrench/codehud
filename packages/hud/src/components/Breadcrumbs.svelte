<script lang="ts">
  import { hud } from '../lib/state.svelte.ts';
  const crumbs = $derived(hud.focusPath.map((id) => hud.index?.get(id)).filter(Boolean));
  const sibIndex = $derived(hud.current ? hud.siblings.findIndex((s) => s.id === hud.current!.id) : -1);
</script>

<nav class="crumbs">
  <button class="crumb root" class:current={!hud.current} onclick={() => hud.jumpTo(0)} title="Top level">
    {hud.map?.name ?? 'codehud'}
  </button>
  {#each crumbs as n, i (n!.id)}
    <span class="sep">›</span>
    <button class="crumb" class:current={i === crumbs.length - 1} onclick={() => hud.jumpTo(i + 1)}>{n!.label}</button>
  {/each}
  {#if hud.current && hud.siblings.length > 1}
    <span class="sibs">
      <button class="ghost" onclick={() => hud.sibling(-1)} title="Previous sibling (←)">‹</button>
      <span class="n">{sibIndex + 1}/{hud.siblings.length}</span>
      <button class="ghost" onclick={() => hud.sibling(1)} title="Next sibling (→)">›</button>
    </span>
  {/if}
  <button class="crumb docs" onclick={() => (hud.view = 'docs')} title="Files and docs (d)">≣ docs</button>
  <button class="crumb docs" onclick={() => (hud.view = 'focus')} title="Back to the agent (m)">◎ play</button>
  <span class="hint">
    {#if hud.current}<kbd>Esc</kbd> up{:else}<kbd>←</kbd><kbd>→</kbd> lanes{/if}
    <kbd>?</kbd> keys
  </span>
</nav>

<style>
  .crumbs { position: absolute; top: 10px; left: 12px; display: flex; align-items: center; gap: 2px; padding: 4px 6px;
    background: color-mix(in srgb, var(--bg-2) 85%, transparent); border: 1px solid var(--line); border-radius: 8px; backdrop-filter: blur(6px); z-index: 2; }
  .crumb { background: none; border: none; padding: 3px 8px; color: var(--fg-2); font-weight: 500; border-radius: 5px; }
  .crumb:hover { background: var(--bg-3); color: var(--fg); }
  .crumb.current { color: var(--fg); font-weight: 600; }
  .root { font-family: var(--mono); font-size: 12px; }
  .sep { color: var(--fg-3); }
  .docs { margin-left: 8px; font-size: 12px; border-left: 1px solid var(--line); border-radius: 0; }
  .sibs { display: inline-flex; align-items: center; margin-left: 6px; padding-left: 6px; border-left: 1px solid var(--line); }
  .sibs .ghost { padding: 1px 7px; font-size: 15px; line-height: 1; }
  .n { font: 11px var(--mono); color: var(--fg-3); }
  .hint { margin-left: 10px; font-size: 11px; color: var(--fg-3); white-space: nowrap; }
</style>
