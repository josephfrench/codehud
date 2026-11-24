<script lang="ts">
  import { hud } from '../lib/state.svelte.ts';
  import { api } from '../lib/api.ts';
  import { md, timeAgo } from '../lib/md.ts';
  import type { Question } from '../../../schema/src/protocol.ts';

  const q = $derived(hud.activeQuestion);
  let more = $state(false);
  let text = $state('');
  let sending = $state(false);
  let error = $state<string | null>(null);
  let snippets = $state<Record<string, { lines: string[]; from: number } | 'loading' | 'error'>>({});
  let lastId: string | null = null;
  $effect(() => {
    if (q?.id !== lastId) { lastId = q?.id ?? null; more = false; text = ''; error = null; snippets = {}; }
  });

  const pendingIdx = $derived(q ? hud.pending.findIndex((p) => p.id === q.id) : -1);
  const session = $derived(q?.session ? hud.sessions.find((s) => s.id === q.session) : undefined);
  const nodeLabel = (id: string) => hud.index?.get(id)?.label ?? id;

  export async function pick(i: number) {
    const opt = q?.options?.[i];
    if (opt) await send({ optionId: opt.id, text: text.trim() || undefined });
  }
  async function send(body: { optionId?: string; text?: string }) {
    if (!q || sending) return;
    sending = true; error = null;
    try { await hud.answer(q, body); text = ''; }
    catch (e: any) { error = e.message; }
    finally { sending = false; }
  }
  async function viewFile(path: string, lines?: [number, number]) {
    if (snippets[path]) { const { [path]: _, ...rest } = snippets; snippets = rest; return; }
    snippets = { ...snippets, [path]: 'loading' };
    try {
      const r = await api.snippet(path, lines?.[0], lines?.[1]);
      snippets = { ...snippets, [path]: { lines: r.lines, from: r.from } };
    } catch { snippets = { ...snippets, [path]: 'error' }; }
  }
  function onKey(e: KeyboardEvent) {
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); if (text.trim()) send({ text: text.trim() }); }
  }
  const recent = $derived(hud.questions.filter((x) => x.status === 'answered').slice(-4).reverse());
</script>

{#if q}
  <section class="q" class:pending={q.status === 'pending'}>
    <header>
      <span class="who"><span class="dot"></span>{session?.label ?? q.agent ?? 'agent'} needs you</span>
      <span class="meta">
        {#if hud.pending.length > 1 && pendingIdx >= 0}
          <button class="ghost" onclick={() => (hud.activeQuestionId = hud.pending[(pendingIdx - 1 + hud.pending.length) % hud.pending.length].id)}>‹</button>
          <span>{pendingIdx + 1}/{hud.pending.length}</span>
          <button class="ghost" onclick={() => (hud.activeQuestionId = hud.pending[(pendingIdx + 1) % hud.pending.length].id)}>›</button>
        {/if}
        <span class="time">{timeAgo(q.createdAt, hud.now)}</span>
      </span>
    </header>

    {#if q.resolvedNodes.length}
      <div class="where">
        {#each q.resolvedNodes as id (id)}
          <button class="chip" onclick={() => hud.goTo([id], { select: true })}>{nodeLabel(id)}</button>
        {/each}
      </div>
    {/if}

    <h2>{q.question}</h2>
    {#if q.context}<div class="md context">{@html md(q.context)}</div>{/if}

    <button class="more ghost" onclick={() => (more = !more)}>
      {more ? '▾ less context' : '▸ show me more context'}
      {#if !more && (q.moreContext || q.files?.length)}<span class="count">{q.files?.length ? `${q.files.length} file${q.files.length > 1 ? 's' : ''}` : 'reasoning'}</span>{/if}
    </button>
    {#if more}
      <div class="morebox">
        {#if q.moreContext}<div class="md">{@html md(q.moreContext)}</div>{/if}
        {#if q.files?.length}
          <ul class="files">
            {#each q.files as f (f.path)}
              <li>
                <button class="ghost file" onclick={() => viewFile(f.path, f.lines)}>
                  <code>{f.path}{f.lines ? `:${f.lines[0]}-${f.lines[1]}` : ''}</code>
                </button>
                {#if snippets[f.path] === 'loading'}<div class="muted">loading…</div>
                {:else if snippets[f.path] === 'error'}<div class="muted">not readable from this machine (map root: {hud.map?.root ?? 'unset'})</div>
                {:else if snippets[f.path]}
                  {@const s = snippets[f.path]}
                  {#if typeof s === 'object'}
                    <pre>{#each s.lines as line, i}<span class="ln">{s.from + i}</span>{line}
{/each}</pre>
                  {/if}
                {/if}
              </li>
            {/each}
          </ul>
        {/if}
        {#if !q.moreContext && !q.files?.length}<div class="muted">The agent did not attach more context.</div>{/if}
      </div>
    {/if}

    {#if q.status === 'pending'}
      {#if q.options?.length}
        <div class="options">
          {#each q.options as o, i (o.id)}
            <button class="opt" class:first={i === 0} disabled={sending} onclick={() => pick(i)}>
              <span class="k">{i + 1}</span>
              <span class="body"><span class="l">{o.label}</span>{#if o.description}<span class="d">{o.description}</span>{/if}</span>
            </button>
          {/each}
        </div>
      {/if}
      {#if q.allowFreeText !== false}
        <div class="free">
          <textarea rows="2" placeholder={q.options?.length ? 'Or type an answer / add a note to your choice…' : 'Type your answer…'} bind:value={text} onkeydown={onKey} disabled={sending}></textarea>
          <div class="row">
            <button class="primary" disabled={sending || !text.trim()} onclick={() => send({ text: text.trim() })}>Send <kbd>⌘↵</kbd></button>
            <button class="ghost" disabled={sending} onclick={() => api.cancel(q.id)}>Dismiss</button>
            {#if error}<span class="err">{error}</span>{/if}
          </div>
        </div>
      {/if}
    {:else}
      <div class="answered">
        {#if q.status === 'answered'}✓ Answered{#if q.answer?.optionId}: <b>{q.options?.find((o) => o.id === q.answer!.optionId)?.label}</b>{/if}
          {#if q.answer?.text && q.answer.text !== q.options?.find((o) => o.id === q.answer!.optionId)?.label}<div class="atext">{q.answer.text}</div>{/if}
        {:else}✕ {q.status}{/if}
      </div>
    {/if}
  </section>
{/if}

{#if recent.length}
  <section class="recent">
    <h3>Recent decisions</h3>
    {#each recent as r (r.id)}
      <button class="dec" onclick={() => { hud.activeQuestionId = r.id; hud.goTo(r.resolvedNodes); }}>
        <span class="dq">{r.question}</span>
        <span class="da">✓ {r.options?.find((o) => o.id === r.answer?.optionId)?.label ?? r.answer?.text}</span>
      </button>
    {/each}
  </section>
{/if}

<style>
  .q { border: 1px solid var(--line-2); border-radius: 10px; padding: 12px 14px; background: var(--bg-2); }
  .q.pending { border-color: var(--accent); box-shadow: 0 0 0 1px color-mix(in srgb, var(--accent) 35%, transparent), 0 8px 30px -12px var(--accent); }
  header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px; font-size: 11px; color: var(--fg-2); text-transform: uppercase; letter-spacing: .06em; }
  .who { display: inline-flex; align-items: center; gap: 6px; font-weight: 600; color: var(--accent); }
  .dot { width: 7px; height: 7px; border-radius: 50%; background: var(--accent); animation: pulse 1.4s infinite; }
  .meta { display: inline-flex; align-items: center; gap: 4px; text-transform: none; letter-spacing: 0; }
  .meta .ghost { padding: 0 6px; }
  .time { color: var(--fg-3); }
  .where { display: flex; flex-wrap: wrap; gap: 4px; margin-bottom: 8px; }
  .chip { font: 11px var(--mono); padding: 2px 8px; border-radius: 999px; background: var(--bg-3); border-color: var(--line-2); color: var(--fg-2); }
  .chip:hover { color: var(--fg); border-color: var(--accent); }
  h2 { font-size: 15px; line-height: 1.35; margin: 0 0 8px; }
  .context { color: var(--fg-2); font-size: 12.5px; }
  .more { padding: 4px 0; margin-top: 6px; font-size: 12px; color: var(--agent); }
  .more .count { color: var(--fg-3); margin-left: 6px; }
  .morebox { border-left: 2px solid var(--line-2); padding: 4px 0 4px 10px; margin: 4px 0 8px; font-size: 12.5px; max-height: 40vh; overflow: auto; }
  .files { list-style: none; padding: 0; margin: 8px 0 0; }
  .file { padding: 2px 0; }
  .file code { color: var(--agent); }
  .ln { display: inline-block; width: 3.5ch; color: var(--fg-3); text-align: right; margin-right: 10px; user-select: none; }
  .muted { color: var(--fg-3); font-size: 11.5px; }
  .options { display: flex; flex-direction: column; gap: 6px; margin: 10px 0 8px; }
  .opt { display: flex; gap: 10px; align-items: flex-start; text-align: left; padding: 8px 10px; background: var(--bg-3); border-radius: 8px; }
  .opt:hover { border-color: var(--accent); }
  .opt.first { border-color: color-mix(in srgb, var(--accent) 60%, var(--line-2)); }
  .opt .k { font: 600 11px var(--mono); color: var(--fg-2); background: var(--bg); border: 1px solid var(--line-2); border-radius: 4px; padding: 1px 6px; margin-top: 1px; }
  .opt .body { display: flex; flex-direction: column; gap: 2px; }
  .opt .l { font-weight: 600; }
  .opt .d { color: var(--fg-2); font-size: 11.5px; }
  .free { margin-top: 6px; }
  .row { display: flex; gap: 8px; align-items: center; margin-top: 6px; }
  .err { color: var(--danger); font-size: 12px; }
  .answered { margin-top: 10px; color: var(--ok); font-weight: 600; }
  .atext { color: var(--fg-2); font-weight: 400; margin-top: 4px; }
  .recent { margin-top: 14px; }
  h3 { font-size: 11px; text-transform: uppercase; letter-spacing: .06em; color: var(--fg-3); margin: 0 0 6px; }
  .dec { display: flex; flex-direction: column; align-items: flex-start; gap: 2px; width: 100%; text-align: left; background: none; border-color: transparent; padding: 6px 8px; border-radius: 6px; }
  .dec:hover { background: var(--bg-2); }
  .dq { color: var(--fg-2); font-size: 12px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 100%; }
  .da { color: var(--ok); font-size: 12px; }
</style>
