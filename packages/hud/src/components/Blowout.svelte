<script lang="ts">
  /** Specifics card: blows out of the clicked element and floats beside it. Data model, signature, config, code, connections. */
  import { cubicOut } from 'svelte/easing';
  import { hud } from '../lib/state.svelte.ts';
  import { api } from '../lib/api.ts';
  import { md } from '../lib/md.ts';
  import { anchorFor, CARD_W } from '../lib/anchor.ts';
  import Sprite from './Sprite.svelte';

  const node = $derived(hud.selected && hud.index ? hud.index.get(hud.selected) ?? null : null);
  const kids = $derived(node && hud.index ? hud.index.childrenOf(node.id) : []);
  const out = $derived(node && hud.map ? hud.map.edges.filter((e) => e.from === node.id && e.kind !== 'imports') : []);
  const inn = $derived(node && hud.map ? hud.map.edges.filter((e) => e.to === node.id && e.kind !== 'imports') : []);
  const decisions = $derived(node ? hud.decisionsByNode.get(node.id) ?? [] : []);
  const label = (id: string) => hud.index?.get(id)?.label ?? id;
  const color = $derived(node ? `var(--layer-${hud.index?.layerOf(node)}, var(--layer-default))` : 'var(--fg-2)');
  const columns = $derived(Array.isArray(node?.meta?.columns) ? (node!.meta!.columns as unknown[]).map((c) => (typeof c === 'string' ? { name: c, type: '' } : { name: (c as any).name ?? '?', type: (c as any).type ?? '' })) : []);
  const metaEntries = $derived(node?.meta ? Object.entries(node.meta).filter(([k, v]) => k !== 'columns' && k !== 'signature' && typeof v !== 'object') : []);
  const configEntries = $derived(node?.meta ? Object.entries(node.meta).filter(([k, v]) => k !== 'columns' && typeof v === 'object' && v !== null) : []);

  let vw = $state(window.innerWidth), vh = $state(window.innerHeight);
  const anchor = $derived(anchorFor(hud.blowoutFrom, vw, vh));

  let code = $state<{ path: string; from: number; lines: string[]; total: number } | 'loading' | { error: string } | null>(null);
  let codeFor = $state<string | null>(null);
  $effect(() => { node?.id; code = null; codeFor = null; });
  async function view(path: string, lines?: [number, number]) {
    if (codeFor === path) { code = null; codeFor = null; return; }
    codeFor = path; code = 'loading';
    try { code = await api.snippet(path, lines?.[0], lines?.[1]); }
    catch { code = { error: hud.map?.root ? `Could not read ${path} under ${hud.map.root}` : 'This map has no root path, so files cannot be opened.' }; }
  }
  function go(id: string) { hud.highlighted = new Set([id]); hud.selected = null; hud.roam(); }

  /** Grow out of the element that was clicked. */
  function blow(el: HTMLElement, { from }: { from: { x: number; y: number } | null }) {
    const r = el.getBoundingClientRect();
    const ox = from ? from.x - r.left : 0, oy = from ? from.y - r.top : r.height / 2;
    return {
      duration: 300, easing: cubicOut,
      css: (t: number) => `transform-origin: ${ox}px ${oy}px; transform: scale(${0.04 + 0.96 * t}); opacity: ${Math.min(1, t * 1.8)}`,
    };
  }
</script>

<svelte:window onresize={() => { vw = window.innerWidth; vh = window.innerHeight; }} />

{#if node}
  <section class="card {anchor.side}" transition:blow={{ from: hud.blowoutFrom }}
    style="left: {anchor.left}px; top: {anchor.top}px; width: {CARD_W}px; max-height: {anchor.maxH}px; --c: {color}">
    <header>
      <Sprite kind={node.kind} size={56} {color} state="active" />
      <div class="title">
        <div class="kind">{node.kind} · {hud.index?.layerOf(node)}{hud.index?.laneOf(node) ? ` / ${hud.index?.laneOf(node)}` : ''}</div>
        <h2>{node.label}</h2>
        {#if node.summary}<p class="sum">{node.summary}</p>{/if}
      </div>
      <button class="ghost close" onclick={() => (hud.selected = null)} title="Close (Esc)">✕</button>
    </header>

    <div class="body">
      {#if node.meta?.signature}<h3>Signature</h3><pre class="sig">{node.meta.signature}</pre>{/if}
      {#if columns.length}
        <h3>Data model</h3>
        <table class="cols"><tbody>{#each columns as c (c.name)}<tr><td><code>{c.name}</code></td><td class="t">{c.type}</td></tr>{/each}</tbody></table>
      {/if}
      {#if metaEntries.length}
        <h3>Details</h3>
        <dl class="meta">{#each metaEntries as [k, v] (k)}<dt>{k}</dt><dd>{String(v)}</dd>{/each}</dl>
      {/if}
      {#each configEntries as [k, v] (k)}<h3>{k}</h3><pre class="cfg">{JSON.stringify(v, null, 2)}</pre>{/each}
      {#if node.description}<h3>About</h3><div class="md">{@html md(node.description)}</div>{/if}

      {#if node.files?.length}
        <h3>Code</h3>
        <ul class="files">
          {#each node.files as f (f.path + (f.lines?.[0] ?? ''))}
            <li><button class="file" class:on={codeFor === f.path} onclick={() => view(f.path, f.lines)}>
              <code>{f.path}{f.lines ? `:${f.lines[0]}-${f.lines[1]}` : ''}</code><span class="muted">{codeFor === f.path ? 'hide' : 'view'}</span>
            </button></li>
          {/each}
        </ul>
        {#if code === 'loading'}<div class="muted">loading…</div>
        {:else if code && 'error' in code}<div class="muted">{code.error}</div>
        {:else if code}
          <pre class="code">{#each code.lines as line, i}<span class="ln">{code.from + i}</span>{line}
{/each}</pre>
        {/if}
      {/if}

      {#if kids.length}
        <h3>Inside</h3>
        <ul class="list">{#each kids as k (k.id)}<li><button class="link" onclick={() => go(k.id)}>{k.label}</button><span class="muted"> {k.kind}</span></li>{/each}</ul>
      {/if}
      {#if out.length || inn.length}
        <h3>Connections</h3>
        <ul class="list">
          {#each out as e (e.id)}<li><span class="ek">{e.kind} →</span><button class="link" onclick={() => go(e.to)}>{label(e.to)}</button></li>{/each}
          {#each inn as e (e.id)}<li><span class="ek">← {e.kind}</span><button class="link" onclick={() => go(e.from)}>{label(e.from)}</button></li>{/each}
        </ul>
      {/if}
      {#if decisions.length}
        <h3>Decisions</h3>
        <ul class="list">{#each decisions as d (d.id)}<li><span class="muted">{d.question}</span><br /><span class="ok">✓ {d.options?.find((o) => o.id === d.answer?.optionId)?.label ?? d.answer?.text}</span></li>{/each}</ul>
      {/if}
      <button class="focusbtn" onclick={() => go(node.id)}>Make this the focus</button>
    </div>
  </section>
{/if}

<style>
  .card { position: fixed; z-index: 30; display: flex; flex-direction: column; background: color-mix(in srgb, var(--bg-2) 94%, transparent); border: 1px solid var(--line-2); border-top: 3px solid var(--c); border-radius: 14px; box-shadow: 0 30px 70px -24px #000, 0 0 0 1px color-mix(in srgb, var(--c) 25%, transparent); backdrop-filter: blur(12px); }
  .card::before { content: ''; position: absolute; top: 150px; width: 12px; height: 12px; background: inherit; border-left: 1px solid var(--line-2); border-bottom: 1px solid var(--line-2); transform: rotate(45deg); }
  .card.right::before { left: -7px; }
  .card.left::before { right: -7px; transform: rotate(-135deg); }
  header { display: flex; align-items: flex-start; gap: 12px; padding: 12px 14px 10px; border-bottom: 1px solid var(--line); }
  .title { flex: 1; min-width: 0; }
  .kind { font: 10.5px var(--mono); color: var(--c); letter-spacing: .05em; }
  h2 { font-size: 17px; margin: 2px 0; }
  .sum { margin: 0; color: var(--fg-2); font-size: 12px; }
  .body { overflow: auto; padding: 2px 14px 14px; }
  h3 { font-size: 10.5px; text-transform: uppercase; letter-spacing: .1em; color: var(--fg-3); margin: 14px 0 6px; }
  .sig, .cfg { margin: 0; font-size: 11.5px; }
  .cols { border-collapse: collapse; font-size: 12px; width: 100%; }
  .cols td { padding: 3px 8px 3px 0; border-bottom: 1px solid var(--line); }
  .cols .t { color: var(--fg-3); font-family: var(--mono); font-size: 11px; }
  .meta { display: grid; grid-template-columns: auto 1fr; gap: 3px 12px; font-size: 12px; margin: 0; }
  .meta dt { color: var(--fg-3); font-family: var(--mono); font-size: 11px; }
  .meta dd { margin: 0; font-family: var(--mono); }
  .files, .list { list-style: none; margin: 0; padding: 0; font-size: 12px; }
  .list li { padding: 3px 0; }
  .file { display: flex; justify-content: space-between; width: 100%; background: none; border: none; padding: 4px 6px; border-radius: 5px; text-align: left; }
  .file:hover, .file.on { background: var(--bg-3); }
  .file code { color: var(--agent); font-size: 11.5px; }
  .code { margin: 8px 0 0; max-height: 34vh; font-size: 11.5px; line-height: 1.5; }
  .ln { display: inline-block; width: 3.5ch; margin-right: 12px; color: var(--fg-3); text-align: right; user-select: none; }
  .muted { color: var(--fg-3); font-size: 11.5px; }
  .ok { color: var(--ok); }
  .link { background: none; border: none; padding: 0; color: var(--fg); text-decoration: underline dotted var(--fg-3); text-underline-offset: 3px; text-align: left; }
  .link:hover { color: var(--agent); }
  .ek { display: inline-block; min-width: 70px; font: 11px var(--mono); color: var(--fg-2); }
  .focusbtn { margin-top: 16px; width: 100%; }
</style>
