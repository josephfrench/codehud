<script lang="ts">
  import { onMount } from 'svelte';
  import { hud } from './lib/state.svelte.ts';
  import Hud from './components/Hud.svelte';
  import TopBar from './components/TopBar.svelte';
  import Breadcrumbs from './components/Breadcrumbs.svelte';
  import QuestionPanel from './components/QuestionPanel.svelte';
  import DetailPanel from './components/DetailPanel.svelte';
  import Activity from './components/Activity.svelte';
  import Overlays from './components/Overlays.svelte';
  import FocusView from './components/FocusView.svelte';

  let topbar: ReturnType<typeof TopBar>;
  let qpanel: ReturnType<typeof QuestionPanel> | undefined = $state();

  onMount(() => { hud.connect(); });

  function typing(e: KeyboardEvent) {
    const t = e.target as HTMLElement | null;
    return !!t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable);
  }
  function onKey(e: KeyboardEvent) {
    if (e.key === 'Escape' && typing(e)) { (e.target as HTMLElement).blur(); return; }
    if (typing(e) || e.metaKey || e.ctrlKey || e.altKey) return;
    switch (e.key) {
      case 'Escape': case 'ArrowUp':
        if (hud.showHelp) hud.showHelp = false;
        else if (hud.selected) hud.select(null);
        else hud.ascend();
        break;
      case 'Enter': case 'ArrowDown': {
        const id = hud.selected ?? [...hud.highlighted][0];
        if (id && hud.index?.hasChildren(id)) hud.descend(id);
        else if (id) hud.select(id);
        break;
      }
      case 'ArrowLeft': if (!hud.sibling(-1)) hud.swipeLane(-1); break;
      case 'ArrowRight': if (!hud.sibling(1)) hud.swipeLane(1); break;
      case 'f': hud.toggleMode(); break;
      case 'i': hud.showImports = !hud.showImports; break;
      case 'a': hud.showActivity = !hud.showActivity; break;
      case 't': hud.toggleTheme(); break;
      case 'm': hud.view = hud.view === 'map' ? 'focus' : 'map'; break;
      case '?': hud.showHelp = !hud.showHelp; break;
      case '/': e.preventDefault(); topbar.focusSearch(); break;
      default:
        if (/^[1-9]$/.test(e.key) && hud.activeQuestion?.status === 'pending') qpanel?.pick(Number(e.key) - 1);
        else return;
    }
    e.preventDefault();
  }
</script>

<svelte:window onkeydown={onKey} />

<div class="app" class:with-activity={hud.showActivity} class:map={hud.view === 'map'}>
  <TopBar bind:this={topbar} />
  <main>
    <section class="stage">
      {#if hud.view === 'map'}
        <Hud />
        <Breadcrumbs />
      {:else}
        <FocusView bind:qpanel />
      {/if}
      <Overlays />
    </section>
    {#if hud.view === 'map'}
      <aside class="side">
        <QuestionPanel bind:this={qpanel} />
        <DetailPanel />
        {#if !hud.activeQuestion && !hud.selected}
          <div class="idle">
            <p><b>Idle.</b> Click a node to inspect it, double-click to open it. When the agent asks something it will appear here and the map will zoom to it.</p>
            <p class="muted">Follow mode keeps the viewport on the agent. Any manual navigation switches to free roam; press <kbd>f</kbd> to re-follow.</p>
          </div>
        {/if}
      </aside>
    {/if}
  </main>
  {#if hud.showActivity}
    <footer><Activity /></footer>
  {/if}
</div>

<style>
  .app { height: 100%; display: grid; grid-template-rows: 46px 1fr; }
  .app.with-activity { grid-template-rows: 46px 1fr 128px; }
  main { display: grid; grid-template-columns: 1fr; min-height: 0; }
  .map main { grid-template-columns: 1fr 380px; }
  .stage { position: relative; min-width: 0; overflow: hidden; }
  .side { border-left: 1px solid var(--line); background: var(--bg); padding: 12px; overflow: auto; display: flex; flex-direction: column; gap: 12px; }
  footer { border-top: 1px solid var(--line); background: var(--bg-2); min-height: 0; }
  .idle { color: var(--fg-2); font-size: 12.5px; padding: 4px 2px; }
  .muted { color: var(--fg-3); }
  @media (max-width: 1100px) { .map main { grid-template-columns: 1fr 320px; } }
</style>
