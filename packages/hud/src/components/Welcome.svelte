<script lang="ts">
  /** Empty state: the server is up but no system map is loaded yet. */
  import { hud } from '../lib/state.svelte.ts';
  import Sprite from './Sprite.svelte';
</script>

<div class="welcome">
  <div class="card">
    <div class="art">
      <Sprite kind="service" size={64} color="var(--palette-3)" state="dim" />
      <Sprite kind="route" size={64} color="var(--palette-2)" state="dim" />
      <Sprite kind="table" size={64} color="var(--palette-4)" state="dim" />
    </div>
    <h1>Waiting for a system</h1>
    <p>codehud is {hud.connected ? 'connected' : 'starting'}, but nothing is loaded. Point it at a system map and the agent's work will appear here.</p>
    <ol>
      <li><b>Crawl a repo</b><pre>pnpm crawl C:/path/to/repo --out C:/path/to/repo/.codehud/system.json</pre></li>
      <li><b>Load it</b><pre>pnpm start --map C:/path/to/repo/.codehud/system.json</pre>
        <span class="or">or let the agent do it with the <code>hud_load_map</code> tool, or <code>PUT /api/map</code> with the JSON.</span></li>
    </ol>
    <p class="or">A map declares its own layers (any names, any order) and lanes; the HUD colours whatever it finds. <code>examples/service-mesh.system.json</code> shows a non-web layer set.</p>
    <p class="foot">Want to see it working first? <a href="/demo">Run the demo</a> on a sample system.</p>
  </div>
</div>

<style>
  .welcome { position: absolute; inset: 0; display: grid; place-items: center; padding: 24px; }
  .card { max-width: 560px; width: 100%; padding: 28px 32px; background: var(--bg-2); border: 1px solid var(--line); border-radius: 14px; box-shadow: 0 30px 80px -40px rgba(0, 0, 0, .6); }
  .art { display: flex; gap: 18px; justify-content: center; margin-bottom: 14px; opacity: .85; }
  h1 { margin: 0 0 8px; font-size: 20px; letter-spacing: -.01em; }
  p { margin: 0 0 14px; color: var(--fg-2); line-height: 1.45; }
  ol { margin: 0; padding: 0 0 0 20px; color: var(--fg-2); }
  li { margin-bottom: 12px; }
  li b { color: var(--fg); }
  pre { margin: 6px 0 4px; padding: 8px 10px; background: var(--bg); border: 1px solid var(--line); border-radius: 8px; font: 12px var(--mono); white-space: pre-wrap; word-break: break-all; }
  .or { font-size: 12.5px; color: var(--fg-3); }
  code { font: 12px var(--mono); color: var(--fg); }
  .foot { margin: 16px 0 0; font-size: 13px; }
  a { color: var(--accent); }
</style>
