<script lang="ts">
  import { hud } from '../lib/state.svelte.ts';
  import { KIND_GLYPH } from '../lib/layout.ts';
  import { DEMO_MAP_URL, startDemo } from '../lib/demo.ts';

  let query = $state('');
  let open = $state(false);
  let input: HTMLInputElement;
  const results = $derived(query.trim() ? hud.search(query.trim(), 8) : []);

  export function focusSearch() { input?.focus(); input?.select(); }
  function go(id: string) {
    hud.goTo([id], { select: true });
    query = ''; open = false; input.blur();
  }
  function onKey(e: KeyboardEvent) {
    if (e.key === 'Enter' && results[0]) go(results[0].node.id);
    if (e.key === 'Escape') { query = ''; open = false; input.blur(); }
    e.stopPropagation();
  }
  const statusColor = (s?: string) => (s === 'waiting' ? 'var(--accent)' : s === 'working' ? 'var(--agent)' : 'var(--fg-3)');
  /** click a session pill: follow only that agent; click again to follow all */
  function pickSession(id: string) {
    if (hud.followSession === id) hud.follow(null);
    else hud.follow(id);
  }
  const waitingGroups = $derived([...hud.pendingBySession.entries()]);
  const sessionLabel = (id: string) => hud.sessions.find((s) => s.id === id)?.label ?? id ?? 'agent';
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
        {#each results as r (r.node.id)}
          <li><button onmousedown={() => go(r.node.id)}>
            <span class="k">{KIND_GLYPH[r.node.kind] ?? '•'}</span> {r.node.label}
            <span class="muted">{r.node.layer}{r.node.lane ? ` / ${r.node.lane}` : ''}{r.node.summary ? ` — ${r.node.summary}` : ''}</span>
            {#if r.why}<span class="why" class:hot={r.why === 'waiting on you'}>{r.why}</span>{/if}
          </button></li>
        {/each}
      </ul>
    {/if}
  </div>

  <div class="right">
    {#each hud.liveSessions as s (s.id)}
      <button class="session" class:picked={hud.followSession === s.id} class:other={!!hud.followSession && hud.followSession !== s.id}
        style="--sc: {hud.sessionColor(s.id)}" title={(s.cwd ?? s.id) + (hud.liveSessions.length > 1 ? ' · click to follow only this agent' : '')} onclick={() => pickSession(s.id)}>
        <span class="sdot" style="background: {hud.sessionColor(s.id)}; box-shadow: 0 0 0 2px {statusColor(s.status)}33"></span>{s.label ?? s.id}<span class="muted"> {s.status ?? ''}</span>
      </button>
    {/each}
    {#if hud.pending.length}
      {#if waitingGroups.length > 1}
        {#each waitingGroups as [sid, qs] (sid)}
          <button class="pending" style="--sc: {hud.sessionColor(sid)}" onclick={() => hud.follow(sid)} title="{sessionLabel(sid)}: {qs.length} waiting">
            <span class="sdot" style="background: var(--sc)"></span>{qs.length}
          </button>
        {/each}
      {:else}
        <button class="pending" onclick={() => hud.follow()}>{hud.pending.length} waiting</button>
      {/if}
    {/if}
    <button class="mode" class:follow={hud.mode === 'follow'} onclick={() => hud.toggleMode()} title="Toggle follow / free roam (Shift+F)">
      {hud.mode === 'follow' ? (hud.followSession ? `● following ${sessionLabel(hud.followSession)}` : '● following agent') : '○ free roam'}
    </button>
    <span class="views">
      <button class="ghost" class:on={hud.view === 'play'} onclick={() => (hud.view = 'play')} title="Follow the agent">play</button>
      <button class="ghost" class:on={hud.view === 'map'} onclick={() => (hud.view = 'map')} title="Whole map (m)">map</button>
      <button class="ghost" class:on={hud.view === 'docs'} onclick={() => (hud.view = 'docs')} title="Files and docs (d)">docs</button>
    </span>
    {#if hud.view === 'map'}
      <span class="views">
        <button class="ghost" class:on={hud.mapStyle === 'grid'} onclick={() => { if (hud.mapStyle !== 'grid') hud.toggleMapStyle(); }} title="Layer x lane grid (g)">grid</button>
        <button class="ghost" class:on={hud.mapStyle === 'scene'} onclick={() => { if (hud.mapStyle !== 'scene') hud.toggleMapStyle(); }} title="3D scene (g)">3D</button>
      </span>
    {/if}
    <button class="ghost" class:on={hud.showActivity} onclick={() => (hud.showActivity = !hud.showActivity)} title="Toggle activity (l)">log</button>
    <button class="ghost" class:on={hud.showTimeline} onclick={() => (hud.showTimeline = !hud.showTimeline)} title="History: decisions, notes, map loads (h)">history</button>
    <button class="ghost" onclick={() => hud.toggleTheme()} title="Toggle theme (t)">{hud.theme === 'dark' ? '☾' : '☀'}</button>
    <button class="ghost" onclick={() => (hud.showHelp = !hud.showHelp)} title="Keyboard help (?)">?</button>
    {#if hud.demo}
      <span class="demo" title="Scripted agent on a sample system; nothing is connected">
        demo
        <button class="ghost" onclick={() => startDemo()} title="Replay the scripted session">replay</button>
        <a class="ghost" href={DEMO_MAP_URL} target="_blank" rel="noopener" title="The sample system map: the SystemMap JSON the crawler emits">json</a>
        <a class="ghost" href="/" title="Leave the demo">exit</a>
      </span>
    {:else}
      <span class="conn" class:ok={hud.connected} title={hud.connected ? 'connected' : 'disconnected'}></span>
    {/if}
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
  .results button { width: 100%; text-align: left; background: none; border: none; padding: 6px 8px; border-radius: 5px; display: flex; gap: 6px; align-items: baseline; }
  .results button:hover { background: var(--bg-3); }
  .results .k { font-family: var(--mono); color: var(--fg-2); }
  .results .muted { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .why { font: 10.5px var(--mono); color: var(--agent); white-space: nowrap; }
  .why.hot { color: var(--accent); }
  .muted { color: var(--fg-3); font-size: 11.5px; }
  .right { margin-left: auto; display: flex; align-items: center; gap: 8px; white-space: nowrap; }
  .demo { display: inline-flex; align-items: center; gap: 4px; padding: 2px 4px 2px 9px; font: 11px var(--mono); color: var(--accent); border: 1px solid var(--accent); border-radius: 999px; }
  .demo a { text-decoration: none; }
  .demo .ghost { padding: 2px 7px; font-size: 11px; color: var(--fg-2); }
  .session { font-size: 12px; display: inline-flex; align-items: center; gap: 6px; padding: 3px 9px; border: 1px solid var(--line); border-radius: 999px; background: transparent; }
  .session.picked { border-color: var(--sc); color: var(--fg); }
  .session.other { opacity: .55; }
  .sdot { width: 7px; height: 7px; border-radius: 50%; }
  .pending { display: inline-flex; align-items: center; gap: 6px; background: var(--accent); color: #140c00; border-color: transparent; font-weight: 600; animation: pulse 1.6s infinite; }
  .mode { font-size: 12px; }
  .mode.follow { color: var(--agent); border-color: color-mix(in srgb, var(--agent) 50%, var(--line-2)); }
  .ghost.on { color: var(--fg); background: var(--bg-3); }
  .views { display: inline-flex; gap: 2px; padding: 2px; border: 1px solid var(--line); border-radius: 8px; }
  .views .ghost { padding: 3px 9px; }
  .conn { width: 8px; height: 8px; border-radius: 50%; background: var(--danger); margin-left: 4px; }
  .conn.ok { background: var(--ok); }
</style>
