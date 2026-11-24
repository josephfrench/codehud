<script lang="ts">
  import { hud } from '../lib/state.svelte.ts';
  let token = $state('');
  let busy = $state(false);
  async function signIn() {
    busy = true;
    const ok = await hud.claimFromFragment(token.trim());
    busy = false;
    if (ok) { token = ''; hud.connect(); }
  }
</script>

<!-- toasts -->
<div class="toasts">
  {#each hud.toasts as t (t.id)}
    <div class="toast {t.kind}">
      <span class="tx">{t.text}</span>
      {#if t.nodes?.length}<button class="primary" onclick={() => { hud.follow(); hud.dismissToast(t.id); }}>Go <kbd>f</kbd></button>{/if}
      <button class="ghost" onclick={() => hud.dismissToast(t.id)}>✕</button>
    </div>
  {/each}
</div>

{#if hud.showHelp}
  <!-- svelte-ignore a11y_click_events_have_key_events a11y_no_static_element_interactions -->
  <div class="scrim" role="presentation" onclick={() => (hud.showHelp = false)}>
    <div class="modal" role="presentation" onclick={(e) => e.stopPropagation()}>
      <h2>Keys</h2>
      <table>
        <tbody>
          <tr><td><kbd>↵</kbd></td><td>open the selected node (its children)</td></tr>
          <tr><td><kbd>Esc</kbd> / <kbd>↑</kbd></td><td>deselect, then zoom out to the parent</td></tr>
          <tr><td><kbd>←</kbd> <kbd>→</kbd></td><td>swipe between sibling nodes (zoomed in) or swim lanes (top level)</td></tr>
          <tr><td><kbd>1</kbd>…<kbd>9</kbd></td><td>answer the pending question with that option</td></tr>
          <tr><td><kbd>f</kbd></td><td>toggle follow-the-agent / free roam</td></tr>
          <tr><td><kbd>/</kbd></td><td>jump to a node by name</td></tr>
          <tr><td><kbd>i</kbd></td><td>toggle import / dependency edges</td></tr>
          <tr><td><kbd>a</kbd></td><td>toggle the activity trail</td></tr>
          <tr><td><kbd>t</kbd></td><td>toggle dark / light theme</td></tr>
          <tr><td><kbd>m</kbd></td><td>toggle focus view / whole map</td></tr>
          <tr><td><kbd>d</kbd></td><td>docs: project files with markdown preview</td></tr>
          <tr><td><kbd>q</kbd></td><td>collapse / expand the question drawer</td></tr>
          <tr><td>wheel / drag</td><td>zoom / pan (switches to free roam)</td></tr>
          <tr><td>double-click</td><td>open a node</td></tr>
        </tbody>
      </table>
      <p class="muted">Agent presence is the blue dot; amber is something that needs you. Dashed amber border means a child inside needs you.</p>
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
  .toast .tx { font-size: 12.5px; }
  .scrim { position: fixed; inset: 0; background: rgba(0,0,0,.5); display: grid; place-items: center; z-index: 50; }
  .modal { width: min(520px, 92vw); background: var(--bg-2); border: 1px solid var(--line-2); border-radius: 12px; padding: 18px 20px; }
  h2 { margin: 0 0 10px; font-size: 15px; }
  table { border-collapse: collapse; width: 100%; font-size: 12.5px; }
  td { padding: 4px 6px; vertical-align: top; }
  td:first-child { white-space: nowrap; color: var(--fg-2); }
  .muted { color: var(--fg-3); font-size: 12px; }
  .row { display: flex; align-items: center; gap: 10px; margin-top: 10px; }
</style>
