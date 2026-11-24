<script lang="ts">
  import { onMount } from 'svelte';
  import { hud } from '../lib/state.svelte.ts';
  import Scene from './Scene.svelte';
  import Dialogue from '../components/Dialogue.svelte';
  import Overlays from '../components/Overlays.svelte';

  let dialogue: Dialogue | undefined = $state();
  let scene: Scene | undefined = $state();
  onMount(() => { hud.connect(); });

  function typing(e: KeyboardEvent) {
    const t = e.target as HTMLElement | null;
    return !!t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA');
  }
  function onKey(e: KeyboardEvent) {
    if (e.key === 'Escape') { if (typing(e)) (e.target as HTMLElement).blur(); else if (hud.selected) hud.selected = null; else if (hud.previewOption !== null) hud.previewOption = null; return; }
    if (e.key === 'Enter' && !typing(e) && hud.previewOption !== null) { dialogue?.confirm(); e.preventDefault(); return; }
    if (typing(e) || e.metaKey || e.ctrlKey || e.altKey) return;
    if (/^[1-9]$/.test(e.key)) { dialogue?.pick(Number(e.key) - 1); e.preventDefault(); return; }
    if (e.key === 'c') { hud.questionOpen = !hud.questionOpen; return; }
    if (e.key === 'm') { location.assign('/'); return; }
    if (scene?.steer(e.key, e.shiftKey)) e.preventDefault();
  }
</script>

<svelte:window onkeydown={onKey} />
<Scene bind:this={scene} bind:dialogue />
<Overlays />
