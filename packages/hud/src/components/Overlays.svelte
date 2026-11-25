<script lang="ts">
  import { hud, INTERRUPT_AFTER_MS } from '../lib/state.svelte.ts';
  let token = $state('');
  let busy = $state(false);
  async function signIn() {
    busy = true;
    const ok = await hud.claimFromFragment(token.trim());
    busy = false;
    if (ok) { token = ''; hud.connect(); }
  }
  let vw = $state(window.innerWidth), vh = $state(window.innerHeight);
  const tipLeft = $derived(hud.tip ? Math.min(hud.tip.x + 14, vw - 300) : 0);
  const tipTop = $derived(hud.tip ? Math.min(hud.tip.y + 14, vh - 160) : 0);
</script>

<svelte:window onresize={() => { vw = window.innerWidth; vh = window.innerHeight; }} />

<!-- toasts -->
<div class="toasts">
  {#each hud.toasts as t (t.id)}
    <div class="toast {t.kind}">
      <span class="tx">{t.text}</span>
      {#if t.nodes?.length}<button class="primary" onclick={() => { hud.follow(); hud.dismissToast(t.id); }}>Go <kbd>Shift+F</kbd></button>{/if}
      <button class="ghost" onclick={() => hud.dismissToast(t.id)}>✕</button>
    </div>
  {/each}
</div>

<!-- shared hover tooltip -->
{#if hud.tip}
  <div class="tip" style="left: {tipLeft}px; top: {tipTop}px; --c: {hud.tip.accent ?? 'var(--fg-3)'}">
    <div class="tt">{hud.tip.title}</div>
    {#each hud.tip.lines.slice(0, 8) as l, i (i)}<div class="tl">{l}</div>{/each}
    {#if hud.tip.lines.length > 8}<div class="tl muted">+{hud.tip.lines.length - 8} more</div>{/if}
  </div>
{/if}

{#if hud.showHelp}
  <!-- svelte-ignore a11y_click_events_have_key_events a11y_no_static_element_interactions -->
  <div class="scrim" role="presentation" onclick={() => (hud.showHelp = false)}>
    <div class="modal" role="presentation" onclick={(e) => e.stopPropagation()}>
      <h2>Keys</h2>
      <table>
        <tbody>
          <tr><td><kbd>1</kbd>…<kbd>9</kbd></td><td>preview that answer on the stage; press again or <kbd>↵</kbd> to confirm</td></tr>
          <tr><td>click · 2× · 3×</td><td>centre · specifics card · focus (play) or open (map)</td></tr>
          <tr><td><kbd>W</kbd><kbd>A</kbd><kbd>S</kbd><kbd>D</kbd></td><td>steer the camera · <kbd>Q</kbd><kbd>E</kbd> orbit · <kbd>R</kbd><kbd>F</kbd> tilt · <kbd>0</kbd> reset</td></tr>
          <tr><td>drag · right-drag · wheel</td><td>pan · orbit · zoom</td></tr>
          <tr><td><kbd>Tab</kbd></td><td>target the next resource; <kbd>↵</kbd> specifics, <kbd>X</kbd> focus</td></tr>
          <tr><td><kbd>m</kbd> <kbd>d</kbd></td><td>map explorer · docs</td></tr>
          <tr><td><kbd>g</kbd></td><td>map style: grid or 3D</td></tr>
          <tr><td><kbd>←</kbd> <kbd>→</kbd> <kbd>↑</kbd> <kbd>↓</kbd></td><td>map: siblings or lanes, up a level, open the selected node</td></tr>
          <tr><td>stubs at the edge</td><td>connections that leave this level; hover lists them, click follows them</td></tr>
          <tr><td><kbd>h</kbd></td><td>history: decisions, notes and map loads; <code>✓n</code> on a node shows why it is there</td></tr>
          <tr><td><kbd>Esc</kbd></td><td>close the card or drawer, clear the preview, or go up a level</td></tr>
          <tr><td><kbd>c</kbd> <kbd>l</kbd> <kbd>i</kbd> <kbd>t</kbd> <kbd>b</kbd></td><td>collapse dialogue · log · import edges · theme · lane terrain</td></tr>
          <tr><td><kbd>Shift+F</kbd> <kbd>/</kbd></td><td>follow or free roam · jump to a node (ranked by what the agent touched last)</td></tr>
        </tbody>
      </table>
      <p class="muted">Agent presence is a coloured dot (one colour per session); amber is something that needs you. Dashed amber border means a child inside needs you.</p>
      <p class="muted">A new question never steals focus: it badges the node and the top bar, and only pulls the view when this window is already focused, when you come back to it, or after {Math.round(INTERRUPT_AFTER_MS / 1000)} s unanswered.</p>
    </div>
  </div>
{/if}

{#if hud.authError}
  <div class="scrim">
    <div class="modal">
      <h2>Sign in to this HUD</h2>
      <p>The server printed a URL ending in <code>#t=…</code> when it started. Open that URL, or paste the token here (it is also in <code>~/.codehud/server.json</code>).</p>
      <input type="text" placeholder="token" bind:value={token} onkeydown={(e) => e.key === 'Enter' && signIn()} />
      <div class="row"><button class="primary" disabled={busy || !token.trim()} onclick={signIn}>Sign in</button><span class="muted">{hud.authError}</span></div>
    </div>
  </div>
{/if}

<style>
  .toasts { position: absolute; top: 12px; right: 12px; display: flex; flex-direction: column; gap: 8px; z-index: 5; }
  .toast { display: flex; align-items: center; gap: 10px; padding: 10px 12px; background: var(--bg-2); border: 1px solid var(--accent); border-radius: 10px; max-width: 420px; box-shadow: 0 10px 30px -10px #000; }
  .toast.info { border-color: var(--line-2); }
  .toast .tx { font-size: 12.5px; }
  .tip { position: fixed; z-index: 60; max-width: 290px; padding: 8px 10px; pointer-events: none; font-size: 12px;
    background: color-mix(in srgb, var(--bg-2) 96%, transparent); border: 1px solid var(--line-2); border-left: 3px solid var(--c); border-radius: 8px; box-shadow: 0 12px 30px -12px #000; }
  .tt { font-weight: 600; margin-bottom: 4px; color: var(--fg); }
  .tl { color: var(--fg-2); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .scrim { position: fixed; inset: 0; background: rgba(0,0,0,.5); display: grid; place-items: center; z-index: 50; }
  .modal { width: min(560px, 92vw); background: var(--bg-2); border: 1px solid var(--line-2); border-radius: 12px; padding: 18px 20px; }
  h2 { margin: 0 0 10px; font-size: 15px; }
  table { border-collapse: collapse; width: 100%; font-size: 12.5px; }
  td { padding: 4px 6px; vertical-align: top; }
  td:first-child { white-space: nowrap; color: var(--fg-2); }
  .muted { color: var(--fg-3); font-size: 12px; }
  .row { display: flex; align-items: center; gap: 10px; margin-top: 10px; }
</style>
