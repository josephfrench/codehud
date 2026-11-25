<script lang="ts">
  import { hud } from '../lib/state.svelte.ts';
  import { timeAgo } from '../lib/md.ts';
  let list: HTMLDivElement;
  const ICON: Record<string, string> = { focus: '◎', question: '?', answer: '✓', note: '·', map: '▦', session: '⌁' };
  $effect(() => {
    hud.activity.length;
    queueMicrotask(() => list?.scrollTo({ top: list.scrollHeight, behavior: 'smooth' }));
  });
</script>

<div class="wrap">
  <div class="activity" bind:this={list}>
    {#each hud.activity as a (a.id)}
      <button class="item {a.kind}" class:clickable={!!a.nodes?.length} onclick={() => a.nodes?.length && hud.goTo(a.nodes, { select: a.nodes.length === 1 })}>
        <span class="t">{timeAgo(a.at, hud.now)}</span>
        <span class="who" style="background: {hud.sessionColor(a.session)}" title={a.session ?? ''}></span>
        <span class="i">{ICON[a.kind] ?? '·'}</span>
        <span class="x">{a.text}</span>
      </button>
    {:else}
      <div class="empty">Agent activity will appear here. Run <code>pnpm demo</code> to simulate one.</div>
    {/each}
  </div>
  <button class="ghost hist" onclick={() => (hud.showTimeline = !hud.showTimeline)} title="History drawer (h)">✓ history</button>
</div>

<style>
  .wrap { position: relative; height: 100%; }
  .activity { height: 100%; overflow: auto; padding: 6px 10px; font-size: 12px; display: flex; flex-direction: column; gap: 1px; }
  .item { display: grid; grid-template-columns: 60px 7px 16px 1fr; gap: 8px; align-items: center; text-align: left; background: none; border: none; padding: 3px 6px; border-radius: 4px; color: var(--fg-2); cursor: default; }
  .item.clickable { cursor: pointer; }
  .item.clickable:hover { background: var(--bg-3); color: var(--fg); }
  .t { font: 11px var(--mono); color: var(--fg-3); }
  .who { width: 7px; height: 7px; border-radius: 50%; }
  .i { font-family: var(--mono); text-align: center; }
  .focus .i { color: var(--agent); }
  .question .i { color: var(--accent); font-weight: 700; }
  .question .x { color: var(--fg); }
  .answer .i { color: var(--ok); }
  .map .i, .session .i { color: var(--fg-3); }
  .x { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .empty { color: var(--fg-3); padding: 8px; }
  .hist { position: absolute; right: 10px; top: 6px; font-size: 11px; padding: 2px 8px; }
</style>
