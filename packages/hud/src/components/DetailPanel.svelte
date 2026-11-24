<script lang="ts">
  import { hud } from '../lib/state.svelte.ts';
  import { md } from '../lib/md.ts';
  import { KIND_GLYPH } from '../lib/layout.ts';

  const node = $derived(hud.selected && hud.index ? hud.index.get(hud.selected) ?? null : null);
  const kids = $derived(node && hud.index ? hud.index.childrenOf(node.id) : []);
  const outgoing = $derived(node && hud.map ? hud.map.edges.filter((e) => e.from === node.id) : []);
  const incoming = $derived(node && hud.map ? hud.map.edges.filter((e) => e.to === node.id) : []);
  const decisions = $derived(node ? hud.decisionsByNode.get(node.id) ?? [] : []);
  const label = (id: string) => hud.index?.get(id)?.label ?? id;
  const metaEntries = $derived(node?.meta ? Object.entries(node.meta).filter(([, v]) => typeof v !== 'object') : []);
</script>

{#if node}
  <section class="detail">
    <header>
      <span class="kind" style="--c: var(--layer-{node.layer}, var(--layer-default))">{KIND_GLYPH[node.kind] ?? '•'} {node.kind} · {node.layer}{node.lane ? ` / ${node.lane}` : ''}</span>
      <button class="ghost" onclick={() => hud.select(null)} title="Close (Esc)">✕</button>
    </header>
    <h2>{node.label}</h2>
    {#if node.summary}<p class="summary">{node.summary}</p>{/if}
    <div class="actions">
      {#if kids.length}<button class="primary" onclick={() => hud.descend(node.id)}>Open {kids.length} inside <kbd>↵</kbd></button>{/if}
      <button onclick={() => hud.goTo([node.id], { highlight: false })}>Zoom to</button>
    </div>
    {#if node.description}<div class="md desc">{@html md(node.description)}</div>{/if}

    {#if metaEntries.length}
      <dl class="meta">
        {#each metaEntries as [k, v] (k)}<dt>{k}</dt><dd>{String(v)}</dd>{/each}
      </dl>
    {/if}

    {#if node.files?.length}
      <h3>Files</h3>
      <ul class="plain">
        {#each node.files as f (f.path + (f.lines?.[0] ?? ''))}
          <li><code>{f.path}{f.lines ? `:${f.lines[0]}-${f.lines[1]}` : ''}</code>{#if f.role}<span class="muted"> {f.role}</span>{/if}</li>
        {/each}
      </ul>
    {/if}

    {#if kids.length}
      <h3>Inside</h3>
      <ul class="plain">
        {#each kids as k (k.id)}
          <li><button class="link" onclick={() => hud.goTo([k.id], { select: true })}>{KIND_GLYPH[k.kind] ?? '•'} {k.label}</button>{#if k.summary}<span class="muted"> — {k.summary}</span>{/if}</li>
        {/each}
      </ul>
    {/if}

    {#if outgoing.length || incoming.length}
      <h3>Connections</h3>
      <ul class="plain edges">
        {#each outgoing as e (e.id)}
          <li><span class="ek">{e.kind} →</span> <button class="link" onclick={() => hud.goTo([e.to], { select: true })}>{label(e.to)}</button>{#if e.label}<span class="muted"> {e.label}</span>{/if}</li>
        {/each}
        {#each incoming as e (e.id)}
          <li><span class="ek">← {e.kind}</span> <button class="link" onclick={() => hud.goTo([e.from], { select: true })}>{label(e.from)}</button>{#if e.label}<span class="muted"> {e.label}</span>{/if}</li>
        {/each}
      </ul>
    {/if}

    {#if decisions.length}
      <h3>Decisions here</h3>
      <ul class="plain">
        {#each decisions as d (d.id)}
          <li class="decision"><span class="dq">{d.question}</span><br /><span class="da">✓ {d.options?.find((o) => o.id === d.answer?.optionId)?.label ?? d.answer?.text}</span></li>
        {/each}
      </ul>
    {/if}
    <div class="id">{node.id}</div>
  </section>
{/if}

<style>
  .detail { border: 1px solid var(--line); border-radius: 10px; padding: 12px 14px; background: var(--bg-2); }
  header { display: flex; justify-content: space-between; align-items: center; }
  .kind { font: 11px var(--mono); color: var(--c); letter-spacing: .04em; }
  h2 { font-size: 16px; margin: 4px 0 2px; }
  .summary { color: var(--fg-2); margin: 0 0 8px; }
  .actions { display: flex; gap: 6px; margin: 6px 0 10px; }
  .desc { font-size: 12.5px; color: var(--fg-2); margin-bottom: 8px; }
  h3 { font-size: 11px; text-transform: uppercase; letter-spacing: .06em; color: var(--fg-3); margin: 12px 0 4px; }
  .plain { list-style: none; margin: 0; padding: 0; font-size: 12px; }
  .plain li { padding: 2px 0; }
  .muted { color: var(--fg-3); }
  .link { background: none; border: none; padding: 0; color: var(--fg); text-decoration: underline dotted var(--fg-3); text-underline-offset: 3px; }
  .link:hover { color: var(--agent); }
  .ek { font: 11px var(--mono); color: var(--fg-2); display: inline-block; min-width: 72px; }
  .meta { display: grid; grid-template-columns: auto 1fr; gap: 2px 10px; font-size: 12px; margin: 6px 0; }
  .meta dt { color: var(--fg-3); font-family: var(--mono); font-size: 11px; }
  .meta dd { margin: 0; font-family: var(--mono); }
  .decision .dq { color: var(--fg-2); }
  .decision .da { color: var(--ok); }
  .id { margin-top: 12px; font: 10px var(--mono); color: var(--fg-3); }
</style>
