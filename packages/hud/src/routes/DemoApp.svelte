<script lang="ts">
  import { onMount } from 'svelte';
  import { hud } from '../lib/state.svelte.ts';
  import Scene from './Scene.svelte';
  import Dialogue from '../components/Dialogue.svelte';
  import Overlays from '../components/Overlays.svelte';

  let dialogue: Dialogue | undefined = $state();
  onMount(() => { hud.connect(); });

  function typing(e: KeyboardEvent) {
    const t = e.target as HTMLElement | null;
    return !!t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA');
  }
  function onKey(e: KeyboardEvent) {
    if (e.key === 'Escape') { if (typing(e)) (e.target as HTMLElement).blur(); else if (hud.selected) hud.selected = null; return; }
    if (typing(e) || e.metaKey || e.ctrlKey || e.altKey) return;
    if (/^[1-9]$/.test(e.key)) { dialogue?.pick(Number(e.key) - 1); e.preventDefault(); }
    else if (e.key === 'q') hud.questionOpen = !hud.questionOpen;
    else if (e.key === 'f') hud.follow();
    else if (e.key === 'm') location.assign('/');
  }
</script>

<svelte:window onkeydown={onKey} />
<Scene bind:dialogue />
<Overlays />
