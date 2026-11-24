<script lang="ts">
  /**
   * Focus view: only what matters right now.
   *   faded ancestors  →  focal cards (full)  →  question  →  faded children
   */
  import { hud } from '../lib/state.svelte.ts';
  import { KIND_GLYPH } from '../lib/layout.ts';
  import QuestionPanel from './QuestionPanel.svelte';
  import type { SysNode } from '../../../schema/src/index.ts';

  let { qpanel = $bindable() }: { qpanel?: QuestionPanel } = $props();

  const focal = $derived.by<SysNode[]>(() => {
    const idx = hud.index;
    if (!idx) return [];
    const ids = hud.highlighted.size ? [...hud.highlighted] : hud.agentAt?.nodes ?? [];
    return ids.map((id) => idx.get(id)).filter((n): n is SysNode => !!n);
  });
  const ancestors = $derived.by<SysNode[]>(() => {
    const idx = hud.index;
    if (!idx) return [];
    const seen = new Set<string>();
    const out: SysNode[] = [];
    for (const n of focal) for (const a of idx.ancestors(n.id)) if (!seen.has(a.id) && !focal.some((f) => f.id === a.id)) { seen.add(a.id); out.push(a); }
    return out;
  });
  const children = $derived.by<SysNode[]>(() => {
    const idx = hud.index;
    if (!idx) return [];
    const seen = new Set(focal.map((f) => f.id));
    const out: SysNode[] = [];
    for (const n of focal) for (const c of idx.childrenOf(n.id)) if (!seen.has(c.id)) { seen.add(c.id); out.push(c); }
    return out;
  });
  /** Direct neighbours of the focal set that are not already shown. */
  const related = $derived.by<{ node: SysNode; kind: string; dir: '→' | '←' }[]>(() => {
    const idx = hud.index;
    if (!idx || !hud.map) return [];
    const shown = new Set([...focal, ...ancestors, ...children].map((n) => n.id));
    const out: { node: SysNode; kind: string; dir: '→' | '←' }[] = [];
    const seen = new Set<string>();
    for (const e of hud.map.edges) {
      if (e.kind === 'imports' || e.kind === 'depends') continue;
      const f = focal.find((n) => n.id === e.from), t = focal.find((n) => n.id === e.to);
      const other = f && !t ? e.to : t && !f ? e.from : null;
      if (!other || shown.has(other) || seen.has(other)) continue;
      const n = idx.get(other);
      if (n) { seen.add(other); out.push({ node: n, kind: e.kind, dir: f ? '→' : '←' }); }
    }
    return out.slice(0, 8);
  });

  let expanded = $state<string | null>(null);
  const layerColor = (n: SysNode) => `var(--layer-${hud.index?.layerOf(n) ?? n.layer}, var(--layer-default))`;
  const metaLine = (n: SysNode) => {
    const m = n.meta ?? {};
    if (m.method && m.path) return `${m.method} ${m.path}`;
    if (Array.isArray(m.columns)) return `${m.columns.length} columns`;
    if (m.signature) return String(m.signature);
    return '';
  };
  const columns = (n: SysNode) => (Array.isArray(n.meta?.columns) ? (n.meta!.columns as unknown[]).map((c) => (typeof c === 'string' ? c : (c as any).name ?? JSON.stringify(c))) : []);
  function focusOn(n: SysNode) { hud.highlighted = new Set([n.id]); expanded = null; hud.roam(); }
</script>

<div class="focus">
  {#if !hud.map}
    <div class="empty">No system map loaded.</div>
  {:else if !focal.length}
    <div class="empty">
      <div class="name">{hud.map.name}</div>
      <p>Waiting for the agent. When it moves or asks something, only that part of the system will appear here.</p>
      <button onclick={() => (hud.view = 'map')}>Browse the whole map <kbd>m</kbd></button>
    </div>
  {:else}
    {#if ancestors.length}
      <div class="row ancestors">
        {#each ancestors as a (a.id)}
          <button class="mini" style="--c: {layerColor(a)}" onclick={() => focusOn(a)} title={a.summary}>
            <span class="k">{KIND_GLYPH[a.kind] ?? '•'}</span>{a.label}
          </button>
        {/each}
      </div>
      <div class="stem"></div>
    {/if}

    <div class="row focal">
      {#each focal as n (n.id)}
        {@const open = expanded === n.id}
        {@const cols = columns(n)}
        <div class="card" class:open class:agent={hud.agentSet.has(n.id)} style="--c: {layerColor(n)}">
          <button class="head" onclick={() => (expanded = open ? null : n.id)}>
            <span class="kind">{KIND_GLYPH[n.kind] ?? '•'} {n.kind}<span class="where"> · {hud.index?.layerOf(n)}{hud.index?.laneOf(n) ? ` / ${hud.index?.laneOf(n)}` : ''}</span></span>
            <span class="label">{n.label}</span>
            {#if n.summary}<span class="summary">{n.summary}</span>{/if}
            {#if metaLine(n)}<code class="meta">{metaLine(n)}</code>{/if}
          </button>
          {#if open}
            <div class="body">
              {#if cols.length}
                <div class="sect">columns</div>
                <div class="cols">{#each cols as c}<code>{c}</code>{/each}</div>
              {/if}
              {#if n.files?.length}
                <div class="sect">files</div>
                {#each n.files as f (f.path + (f.lines?.[0] ?? ''))}<code class="file">{f.path}{f.lines ? `:${f.lines[0]}-${f.lines[1]}` : ''}</code>{/each}
              {/if}
              {#if n.description}<div class="sect">about</div><p class="desc">{n.description}</p>{/if}
            </div>
          {/if}
        </div>
      {/each}
    </div>

    {#if related.length}
      <div class="row related">
        {#each related as r (r.node.id)}
          <button class="mini rel" style="--c: {layerColor(r.node)}" onclick={() => focusOn(r.node)} title="{r.kind}">
            <span class="ek">{r.dir === '→' ? `${r.kind} →` : `← ${r.kind}`}</span>{r.node.label}
          </button>
        {/each}
      </div>
    {/if}

    {#if hud.activeQuestion}
      <div class="stem"></div>
      <div class="question"><QuestionPanel bind:this={qpanel} compact /></div>
    {/if}

    {#if children.length}
      <div class="stem"></div>
      <div class="row children">
        {#each children as c (c.id)}
          <button class="mini" style="--c: {layerColor(c)}" onclick={() => focusOn(c)} title={c.summary}>
            <span class="k">{KIND_GLYPH[c.kind] ?? '•'}</span>{c.label}
          </button>
        {/each}
      </div>
    {/if}
  {/if}
</div>

<style>
  .focus { position: absolute; inset: 0; overflow: auto; display: flex; flex-direction: column; align-items: center; padding: 48px 24px 40px; gap: 6px; }
  .empty { margin: auto; text-align: center; color: var(--fg-2); max-width: 420px; }
  .empty .name { font: 600 18px var(--sans); color: var(--fg); margin-bottom: 8px; }
  .row { display: flex; flex-wrap: wrap; justify-content: center; gap: 8px; max-width: 980px; }
  .ancestors, .children { opacity: .45; transition: opacity .2s; }
  .ancestors:hover, .children:hover { opacity: .9; }
  .related { opacity: .7; margin-top: 2px; }
  .stem { width: 1px; height: 18px; background: var(--line-2); }
  .mini { display: inline-flex; align-items: center; gap: 6px; font-size: 12px; padding: 4px 10px; border-radius: 999px; background: var(--bg-2); border: 1px solid var(--line); color: var(--fg-2); border-left: 3px solid var(--c); }
  .mini:hover { color: var(--fg); border-color: var(--fg-3); border-left-color: var(--c); }
  .mini .k { color: var(--c); font-family: var(--mono); }
  .mini .ek { font: 10px var(--mono); color: var(--fg-3); }
  .focal { gap: 12px; }
  .card { width: 300px; background: var(--card); border: 1px solid var(--line-2); border-left: 4px solid var(--c); border-radius: 10px; box-shadow: 0 10px 40px -20px #000; }
  .card.agent { box-shadow: 0 0 0 1px color-mix(in srgb, var(--agent) 60%, transparent), 0 10px 40px -20px #000; }
  .head { display: flex; flex-direction: column; align-items: flex-start; gap: 3px; width: 100%; text-align: left; background: none; border: none; padding: 12px 14px; border-radius: 10px; }
  .head:hover { background: var(--card-2); }
  .kind { font: 10.5px var(--mono); color: var(--c); letter-spacing: .04em; }
  .where { color: var(--fg-3); }
  .label { font: 600 15px var(--sans); color: var(--fg); }
  .summary { font-size: 12.5px; color: var(--fg-2); }
  .meta { font-size: 11px; color: var(--fg-2); background: var(--bg); padding: 1px 6px; border-radius: 4px; margin-top: 2px; }
  .body { padding: 0 14px 12px; border-top: 1px solid var(--line); font-size: 12px; }
  .sect { font: 10px var(--mono); text-transform: uppercase; letter-spacing: .08em; color: var(--fg-3); margin: 10px 0 4px; }
  .cols { display: flex; flex-wrap: wrap; gap: 4px; }
  .cols code { background: var(--bg); padding: 1px 6px; border-radius: 4px; font-size: 11px; }
  .file { display: block; color: var(--agent); font-size: 11px; }
  .desc { color: var(--fg-2); margin: 0; }
  .question { width: min(620px, 100%); }
</style>
