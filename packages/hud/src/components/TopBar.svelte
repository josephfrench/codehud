<script lang="ts">
  import { hud } from '../lib/state.svelte.ts';
  import { KIND_GLYPH } from '../lib/layout.ts';
  import { timeAgo } from '../lib/md.ts';

  let query = $state('');
  let open = $state(false);
  let input: HTMLInputElement;
  const results = $derived(query.trim() && hud.index ? hud.index.search(query.trim(), 8) : []);

  export function focusSearch() { input?.focus(); input?.select(); }
  function go(id: string) {
    hud.goTo([id], { select: true });
    query = ''; open = false; input.blur();
  }
  function onKey(e: KeyboardEvent) {
    if (e.key === 'Enter' && results[0]) go(results[0].id);
    if (e.key === 'Escape') { query = ''; open = false; input.blur(); }
    e.stopPropagation();
  }
  const statusColor = (s?: string) => (s === 'waiting' ? 'var(--accent)' : s === 'working' ? 'var(--agent)' : 'var(--fg-3)');
  const liveSessions = $derived(hud.sessions.filter((s) => hud.now - new Date(s.lastSeen).getTime() < 10 * 60_000));
</script>

<header class="top">
  <div class="brand">
    <span class="logo">code<b>hud</b></span>
    {#if hud.map}<span class="map">{hud.map.name} <span class="n">{hud.map.nodes.length} nodes</span></span>{/if}
  </div>

  <div class="search">
    <input type="text" bind:this={input} bind:value={query} placeholder="Jump to… ( / )" onfocus={() => (open = true)} onblur={() => setTimeout(() => (open = false), 150)} onkeydown={onKey} />
    {#if open && results.length}
      <ul class="results">
        {#each results as r (r.id)}
          <li><button onmousedown={() => go(r.id)}><span class="k">{KIND_GLYPH[r.kind] ?? '•'}</span> {r.label} <span class="muted">{r.layer}{r.lane ? ` / ${r.lane}` : ''}{r.summary ? ` — ${r.summary}` : ''}</span></button></li>
        {/each}
      </ul>
    {/if}
  </div>

  <div class="right">
    {#each liveSessions as s (s.id)}
      <span class="session" title={s.cwd ?? s.id}><span class="sdot" style="background: {statusColor(s.status)}"></span>{s.label ?? s.id}<span class="muted"> {s.status ?? ''}</span></span>
    {/each}
    {#if hud.pending.length}
      <button class="pending" onclick={() => hud.follow()}>{hud.pending.length} waiting</button>
    {/if}
    <button class="mode" class:follow={hud.mode === 'follow'} onclick={() => hud.toggleMode()} title="Toggle follow / free roam (f)">
      {hud.mode === 'follow' ? '● following agent' : '○ free roam'}
    </button>
    <button class="ghost" class:on={hud.view === 'map'} onclick={() => (hud.view = hud.view === 'map' ? 'focus' : 'map')} title="Toggle focus / whole map (m)">{hud.view === 'map' ? 'focus' : 'map'}</button>
    <button class="ghost" class:on={hud.showActivity} onclick={() => (hud.showActivity = !hud.showActivity)} title="Toggle activity (a)">log</button>
    <button class="ghost" onclick={() => hud.toggleTheme()} title="Toggle theme (t)">{hud.theme === 'dark' ? '☾' : '☀'}</button>
    <button class="ghost" onclick={() => (hud.showHelp = !hud.showHelp)} title="Keyboard help (?)">?</button>
    <span class="conn" class:ok={hud.connected} title={hud.connected ? 'connected' : 'disconnected'}></span>
  </div>
</header>

<style>
  .top { height: 46px; display: flex; align-items: center; gap: 16px; padding: 0 14px; border-bottom: 1px solid var(--line); background: var(--bg-2); }
  .brand { display: flex; align-items: baseline; gap: 12px; white-space: nowrap; }
  .logo { font: 15px var(--mono); color: var(--fg-2); letter-spacing: -.02em; }
  .logo b { color: var(--fg); }
  .map { font-weight: 600; }
  .n { font: 11px var(--mono); color: var(--fg-3); margin-left: 4px; }
  .search { position: relative; flex: 1; max-width: 420px; }
  .search input { padding: 5px 10px; font-size: 12.5px; background: var(--bg); }
  .results { position: absolute; top: 100%; left: 0; right: 0; margin: 4px 0 0; padding: 4px; list-style: none; background: var(--bg-2); border: 1px solid var(--line-2); border-radius: 8px; z-index: 20; box-shadow: 0 12px 30px -10px #000; }
  .results button { width: 100%; text-align: left; background: none; border: none; padding: 6px 8px; border-radius: 5px; }
  .results button:hover { background: var(--bg-3); }
  .results .k { font-family: var(--mono); color: var(--fg-2); }
  .muted { color: var(--fg-3); font-size: 11.5px; }
  .right { margin-left: auto; display: flex; align-items: center; gap: 8px; white-space: nowrap; }
  .session { font-size: 12px; display: inline-flex; align-items: center; gap: 6px; padding: 3px 9px; border: 1px solid var(--line); border-radius: 999px; }
  .sdot { width: 7px; height: 7px; border-radius: 50%; }
  .pending { background: var(--accent); color: #140c00; border-color: transparent; font-weight: 600; animation: pulse 1.6s infinite; }
  .mode { font-size: 12px; }
  .mode.follow { color: var(--agent); border-color: color-mix(in srgb, var(--agent) 50%, var(--line-2)); }
  .ghost.on { color: var(--fg); background: var(--bg-3); }
  .conn { width: 8px; height: 8px; border-radius: 50%; background: var(--danger); margin-left: 4px; }
  .conn.ok { background: var(--ok); }
</style>
