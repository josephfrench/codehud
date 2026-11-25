<script lang="ts">
  /** Docs tab: browse the project's files under the map root, preview markdown, view code. */
  import { hud } from '../lib/state.svelte.ts';
  import { api } from '../lib/api.ts';
  import { md } from '../lib/md.ts';

  type Entry = { name: string; dir: boolean; size: number };
  let tree = $state<Record<string, Entry[]>>({});
  let open = $state<Set<string>>(new Set(['']));
  let error = $state<string | null>(null);
  let current = $state<string | null>(null);
  let content = $state<{ lines: string[]; total: number } | 'loading' | null>(null);
  let raw = $state(false);
  let q = $state('');

  async function load(dir: string) {
    if (hud.demo) { error = 'The demo runs without a server, so there are no project files to browse. Load a real system at / and this tab shows its files.'; return; }
    try { const r = await api.tree(dir); tree = { ...tree, [dir]: r.entries }; error = null; }
    catch (e: any) { error = e.message; }
  }
  $effect(() => { hud.map?.root; tree = {}; open = new Set(['']); current = null; content = null; load(''); });

  function toggle(dir: string) {
    const next = new Set(open);
    if (next.has(dir)) next.delete(dir); else { next.add(dir); if (!tree[dir]) load(dir); }
    open = next;
  }
  async function show(path: string) {
    current = path; content = 'loading'; raw = false;
    try { const r = await api.fileAll(path); content = { lines: r.lines, total: r.total }; }
    catch (e: any) { content = null; error = e.message; }
  }
  const isMd = (p: string | null) => !!p && /\.(md|mdx|markdown)$/i.test(p);
  const ext = (n: string) => n.split('.').pop()?.toLowerCase() ?? '';
  const icon = (e: Entry) => (e.dir ? '▸' : ext(e.name) === 'md' ? '≣' : /^(ts|js|mjs|tsx|jsx|svelte|astro|py|go|rs)$/.test(ext(e.name)) ? '‹›' : /^(json|jsonc|yaml|yml|toml)$/.test(ext(e.name)) ? '{}' : '·');
  const docsFirst = (entries: Entry[]) => (q ? entries.filter((e) => e.dir || e.name.toLowerCase().includes(q.toLowerCase())) : entries);
  const kb = (n: number) => (n < 1024 ? `${n} B` : `${(n / 1024).toFixed(n < 10240 ? 1 : 0)} KB`);

  /** Quick list of markdown files at the top two levels for the "docs" shortcut strip. */
  const quickDocs = $derived.by(() => {
    const out: string[] = [];
    for (const [dir, entries] of Object.entries(tree)) for (const e of entries) if (!e.dir && isMd(e.name)) out.push(dir ? `${dir}/${e.name}` : e.name);
    return out.sort((a, b) => (a.toLowerCase().startsWith('readme') ? -1 : b.toLowerCase().startsWith('readme') ? 1 : a.localeCompare(b))).slice(0, 12);
  });
</script>

{#snippet folder(dir: string, depth: number)}
  {#each docsFirst(tree[dir] ?? []) as e (e.name)}
    {@const p = dir ? `${dir}/${e.name}` : e.name}
    {#if e.dir}
      <button class="row dir" style="padding-left: {10 + depth * 14}px" onclick={() => toggle(p)}>
        <span class="ic" class:open={open.has(p)}>▸</span>{e.name}
      </button>
      {#if open.has(p)}{@render folder(p, depth + 1)}{/if}
    {:else}
      <button class="row file" class:on={current === p} class:md={isMd(e.name)} style="padding-left: {10 + depth * 14}px" onclick={() => show(p)}>
        <span class="ic">{icon(e)}</span>{e.name}<span class="sz">{kb(e.size)}</span>
      </button>
    {/if}
  {/each}
{/snippet}

<div class="docs">
  <aside class="tree">
    <div class="root" title={hud.map?.root}>{hud.map?.name} <span class="path">{hud.map?.root ?? ''}</span></div>
    <input class="search" type="text" placeholder="filter files…" bind:value={q} />
    {#if error}<div class="err">{error}</div>{/if}
    {#if quickDocs.length}
      <div class="quick">{#each quickDocs as d (d)}<button class="q" class:on={current === d} onclick={() => show(d)}>{d.split('/').pop()}</button>{/each}</div>
    {/if}
    <div class="list">{@render folder('', 0)}</div>
  </aside>
  <section class="preview">
    {#if !current}
      <div class="empty">Pick a file. Markdown renders as a document; everything else shows as code.</div>
    {:else}
      <header>
        <code>{current}</code>
        {#if isMd(current)}<button class="ghost" onclick={() => (raw = !raw)}>{raw ? 'preview' : 'source'}</button>{/if}
        {#if content && content !== 'loading' && content.total > content.lines.length}<span class="muted">first {content.lines.length} of {content.total} lines</span>{/if}
      </header>
      {#if content === 'loading'}<div class="muted">loading…</div>
      {:else if content}
        {#if isMd(current) && !raw}
          <article class="md doc">{@html md(content.lines.join('\n'))}</article>
        {:else}
          <pre class="code">{#each content.lines as line, i}<span class="ln">{i + 1}</span>{line}
{/each}</pre>
        {/if}
      {/if}
    {/if}
  </section>
</div>

<style>
  .docs { position: absolute; inset: 0; display: grid; grid-template-columns: 300px 1fr; }
  .tree { border-right: 1px solid var(--line); background: var(--bg-2); overflow: auto; display: flex; flex-direction: column; }
  .root { padding: 10px 12px 6px; font-weight: 600; font-size: 12.5px; }
  .root .path { display: block; font: 10.5px var(--mono); color: var(--fg-3); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .search { width: calc(100% - 20px); margin: 4px 10px 6px; padding: 4px 8px; font-size: 12px; }
  .err { margin: 6px 12px; color: var(--danger); font-size: 12px; }
  .quick { display: flex; flex-wrap: wrap; gap: 4px; padding: 4px 10px 8px; border-bottom: 1px solid var(--line); }
  .q { font-size: 11px; padding: 2px 8px; border-radius: 999px; background: var(--bg-3); border-color: transparent; color: var(--fg-2); }
  .q.on, .q:hover { color: var(--fg); border-color: var(--line-2); }
  .list { padding: 6px 0; }
  .row { display: flex; align-items: center; gap: 6px; width: 100%; text-align: left; background: none; border: none; border-radius: 0; padding: 3px 10px; font-size: 12.5px; color: var(--fg-2); white-space: nowrap; }
  .row:hover { background: var(--bg-3); color: var(--fg); }
  .row.on { background: var(--bg-3); color: var(--fg); }
  .row.md { color: var(--fg); }
  .ic { display: inline-block; width: 14px; font-family: var(--mono); font-size: 11px; color: var(--fg-3); transition: transform .15s; }
  .ic.open { transform: rotate(90deg); }
  .sz { margin-left: auto; font: 10px var(--mono); color: var(--fg-3); }
  .preview { overflow: auto; padding: 18px 28px 40px; }
  header { display: flex; align-items: center; gap: 12px; margin-bottom: 14px; font-size: 12px; }
  header code { color: var(--agent); }
  .empty { color: var(--fg-3); padding: 40px; text-align: center; }
  .muted { color: var(--fg-3); font-size: 12px; }
  .doc { max-width: 780px; font-size: 14px; line-height: 1.6; }
  .doc :global(h1) { font-size: 22px; text-transform: none; letter-spacing: 0; color: var(--fg); margin: 18px 0 10px; }
  .doc :global(h2) { font-size: 17px; text-transform: none; letter-spacing: 0; color: var(--fg); margin: 22px 0 8px; border-bottom: 1px solid var(--line); padding-bottom: 4px; }
  .doc :global(h3) { font-size: 14px; text-transform: none; letter-spacing: 0; color: var(--fg); margin: 16px 0 6px; }
  .doc :global(table) { border-collapse: collapse; font-size: 13px; margin: 8px 0; }
  .doc :global(td), .doc :global(th) { border: 1px solid var(--line-2); padding: 4px 8px; }
  .doc :global(blockquote) { border-left: 3px solid var(--line-2); margin: 8px 0; padding: 2px 12px; color: var(--fg-2); }
  .code { font-size: 12px; line-height: 1.5; }
  .ln { display: inline-block; width: 4ch; margin-right: 14px; color: var(--fg-3); text-align: right; user-select: none; }
</style>
