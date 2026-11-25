<script lang="ts">
  import { onMount } from 'svelte';
  import { hud } from './lib/state.svelte.ts';
  import Hud from './components/Hud.svelte';
  import Scene from './components/Scene.svelte';
  import TopBar from './components/TopBar.svelte';
  import Breadcrumbs from './components/Breadcrumbs.svelte';
  import Dialogue from './components/Dialogue.svelte';
  import Blowout from './components/Blowout.svelte';
  import Activity from './components/Activity.svelte';
  import Overlays from './components/Overlays.svelte';
  import DocsView from './components/DocsView.svelte';
  import Minimap from './components/Minimap.svelte';
  import Welcome from './components/Welcome.svelte';
  import Timeline from './components/Timeline.svelte';

  let topbar: ReturnType<typeof TopBar>;
  let dialogue: Dialogue | undefined = $state();
  let scene: Scene | undefined = $state();

  onMount(() => { hud.connect(); });

  const inScene = $derived(hud.view === 'play' || (hud.view === 'map' && hud.mapStyle === 'scene'));

  function typing(e: KeyboardEvent) {
    const t = e.target as HTMLElement | null;
    return !!t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable);
  }
  function onKey(e: KeyboardEvent) {
    if (e.key === 'Escape') {
      if (typing(e)) { (e.target as HTMLElement).blur(); return; }
      if (hud.tip) hud.hideTip();
      else if (hud.showHelp) hud.showHelp = false;
      else if (hud.showTimeline) hud.showTimeline = false;
      else if (hud.selected) hud.select(null);
      else if (hud.previewOption !== null) hud.previewOption = null;
      else if (hud.view === 'map') hud.ascend();
      return;
    }
    if (typing(e) || e.metaKey || e.ctrlKey || e.altKey) return;
    if (e.key === 'Enter' && hud.previewOption !== null) { dialogue?.confirm(); e.preventDefault(); return; }
    if (/^[1-9]$/.test(e.key) && hud.activeQuestion?.status === 'pending') { dialogue?.pick(Number(e.key) - 1); e.preventDefault(); return; }
    switch (e.key) {
      case 'm': hud.view = hud.view === 'map' ? 'play' : 'map'; break;
      case 'd': hud.view = hud.view === 'docs' ? 'play' : 'docs'; break;
      case 'g': if (hud.view === 'map') hud.toggleMapStyle(); break;
      case 'c': hud.questionOpen = !hud.questionOpen; break;
      case 'i': hud.showImports = !hud.showImports; break;
      case 'l': hud.showActivity = !hud.showActivity; break;
      case 'h': hud.showTimeline = !hud.showTimeline; break;
      case 't': hud.toggleTheme(); break;
      case 'b': hud.toggleTerrain(); break;
      case '?': hud.showHelp = !hud.showHelp; break;
      case '/': topbar.focusSearch(); break;
      case 'F': hud.toggleMode(); break;
      default: {
        if (hud.view === 'map') {
          if (e.key === 'ArrowLeft') { if (!hud.sibling(-1)) hud.swipeLane(-1); break; }
          if (e.key === 'ArrowRight') { if (!hud.sibling(1)) hud.swipeLane(1); break; }
          if (e.key === 'ArrowUp') { hud.ascend(); break; }
          if (e.key === 'ArrowDown' || e.key === 'Enter') { const id = hud.selected ?? [...hud.highlighted][0]; if (id && hud.index?.hasChildren(id)) hud.descend(id); break; }
        }
        if (inScene && scene?.steer(e.key, e.shiftKey)) break;
        return;
      }
    }
    e.preventDefault();
  }
</script>

<!-- a waiting question becomes immediate once the human is actually looking at this window -->
<svelte:window onkeydown={onKey} onfocus={() => hud.onWindowFocus()} />
<svelte:document onvisibilitychange={() => { if (document.visibilityState === 'visible') hud.onWindowFocus(); }} />

<div class="app" class:with-activity={hud.showActivity}>
  <TopBar bind:this={topbar} />
  <main>
    <section class="stage">
      {#if !hud.map && !hud.demo}
        <Welcome />
      {:else if hud.view === 'docs'}
        <DocsView />
      {:else if hud.view === 'map' && hud.mapStyle === 'grid'}
        <Hud />
        <Breadcrumbs />
      {:else}
        <Scene bind:this={scene} mode={hud.view === 'map' ? 'map' : 'play'} />
        {#if hud.view === 'map'}<Breadcrumbs />{/if}
        {#if hud.view === 'play'}<div class="mini"><Minimap /></div>{/if}
      {/if}
      {#if hud.view !== 'docs' && hud.map}
        <Dialogue bind:this={dialogue} />
      {/if}
      {#if hud.showTimeline}<Timeline />{/if}
      <Blowout />
      <Overlays />
    </section>
  </main>
  {#if hud.showActivity}
    <footer><Activity /></footer>
  {/if}
</div>

<style>
  .app { height: 100%; display: grid; grid-template-rows: 46px 1fr; }
  .app.with-activity { grid-template-rows: 46px 1fr 128px; }
  main { min-height: 0; }
  .stage { position: relative; height: 100%; min-width: 0; overflow: hidden; }
  footer { border-top: 1px solid var(--line); background: var(--bg-2); min-height: 0; }
  .mini :global(.minimap) { top: 12px; bottom: auto; right: 14px; width: 190px; height: 118px; }
</style>
