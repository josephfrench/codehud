<script lang="ts">
  /** /assets — temporary gallery of the resource sprites. */
  import Sprite from '../components/Sprite.svelte';
  const kinds: [string, string, string][] = [
    ['page', 'client', 'A screen a human sees'], ['component', 'client', 'A UI building block'], ['app', 'client', 'A deployable'],
    ['middleware', 'edge', 'Guards and shapes requests'], ['route', 'api', 'An HTTP / RPC endpoint'],
    ['service', 'domain', 'Business logic'], ['function', 'domain', 'A notable function'], ['job', 'domain', 'Scheduled work'],
    ['queue', 'domain', 'A queue or topic'], ['event', 'domain', 'A domain event'],
    ['table', 'persistence', 'A table / collection'], ['store', 'persistence', 'A datastore or bucket'], ['cache', 'persistence', 'A cache / KV'],
    ['external', 'external', 'A third-party system'], ['config', 'external', 'Config / infra definition'], ['test', 'domain', 'A test suite'], ['other', 'other', 'Anything else'],
  ];
  let size = $state(120);
</script>

<main>
  <header>
    <h1>codehud <span>assets</span></h1>
    <p>One animated sprite per resource kind. Accent follows the layer colour. States: idle · active (agent here) · pending (needs you) · dim.</p>
    <label>size <input type="range" min="48" max="220" bind:value={size} /> {size}px</label>
    <nav><a href="/demo">/demo</a><a href="/">full HUD</a></nav>
  </header>
  <section class="grid">
    {#each kinds as [kind, layer, blurb] (kind)}
      <article>
        <div class="row">
          <Sprite {kind} {size} color="var(--layer-{layer}, var(--layer-default))" />
          <Sprite {kind} size={size * 0.55} color="var(--layer-{layer}, var(--layer-default))" state="active" />
          <Sprite {kind} size={size * 0.55} color="var(--accent)" state="pending" />
          <Sprite {kind} size={size * 0.55} color="var(--layer-{layer}, var(--layer-default))" state="dim" />
        </div>
        <h2>{kind}<small>{layer}</small></h2>
        <p>{blurb}</p>
      </article>
    {/each}
  </section>
</main>

<style>
  main { min-height: 100%; padding: 28px 36px 60px; background: var(--bg); color: var(--fg); overflow: auto; height: 100%; }
  header { display: grid; grid-template-columns: 1fr auto; gap: 6px 24px; align-items: center; margin-bottom: 24px; }
  h1 { margin: 0; font: 600 22px var(--mono); } h1 span { color: var(--fg-3); }
  header p { grid-column: 1; margin: 0; color: var(--fg-2); font-size: 13px; }
  label { grid-column: 1; font-size: 12px; color: var(--fg-3); display: flex; gap: 10px; align-items: center; }
  nav { grid-column: 2; grid-row: 1 / span 3; display: flex; gap: 14px; }
  nav a { color: var(--agent); font-family: var(--mono); font-size: 13px; }
  .grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(340px, 1fr)); gap: 18px; }
  article { background: var(--bg-2); border: 1px solid var(--line); border-radius: 14px; padding: 18px; }
  .row { display: flex; align-items: center; gap: 10px; min-height: 130px; }
  h2 { font: 600 15px var(--mono); margin: 14px 0 2px; } h2 small { margin-left: 8px; color: var(--fg-3); font-weight: 400; font-size: 11px; }
  article p { margin: 0; color: var(--fg-2); font-size: 12.5px; }
</style>
