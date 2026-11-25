<script lang="ts">
  /** RPG-style dialogue box: the agent as a character at the bottom of the scene. Pick an option to preview its path, then confirm. */
  import { fly } from 'svelte/transition';
  import { hud } from '../lib/state.svelte.ts';
  import { md, timeAgo } from '../lib/md.ts';

  const q = $derived(hud.activeQuestion);
  const session = $derived(
    (q?.session ? hud.sessions.find((s) => s.id === q.session) : undefined)
    ?? (hud.followSession ? hud.sessions.find((s) => s.id === hud.followSession) : undefined)
    ?? hud.liveSessions.at(-1));
  const sessionColor = $derived(hud.sessionColor(session?.id ?? q?.session));
  const status = $derived(q?.status === 'pending' ? 'needs you' : session?.status ?? 'offline');
  let text = $state('');
  let more = $state(false);
  let sending = $state(false);
  let lastId: string | null = null;
  $effect(() => { if (q?.id !== lastId) { lastId = q?.id ?? null; text = ''; more = false; hud.previewOption = null; } });

  const previewed = $derived(q?.options && hud.previewOption !== null ? q.options[hud.previewOption] ?? null : null);
  const touches = $derived((previewed?.resolvedNodes ?? []).map((id) => hud.index?.get(id)?.label ?? id));

  /** First press previews the option; pressing it again (or Confirm / Enter) sends it. */
  export async function pick(i: number) {
    if (!q || q.status !== 'pending' || !q.options?.[i]) return;
    if (hud.previewOption === i) await confirm();
    else hud.previewOption = i;
  }
  export async function confirm() {
    if (!q || sending) return;
    if (previewed) await send({ optionId: previewed.id, text: text.trim() || undefined });
    else if (text.trim()) await send({ text: text.trim() });
  }
  async function send(body: { optionId?: string; text?: string }) {
    if (!q || sending) return;
    sending = true;
    try { await hud.answer(q, body); text = ''; hud.previewOption = null; } finally { sending = false; }
  }
  const lastNote = $derived([...hud.activity].reverse().find((a) => (a.kind === 'note' || a.kind === 'focus') && (!hud.followSession || a.session === hud.followSession)));
</script>

{#if more && q?.moreContext}
  <div class="more md" transition:fly={{ x: -40, duration: 220 }}><button class="ghost closemore" onclick={() => (more = false)}>✕</button>{@html md(q.moreContext)}</div>
{/if}

<section class="dialogue" class:pending={q?.status === 'pending'} class:collapsed={!hud.questionOpen} style="--agent: {sessionColor}">
  <div class="avatar" class:talking={q?.status === 'pending'}>
    <svg viewBox="0 0 100 100" width="64" height="64" aria-hidden="true">
      <circle cx="50" cy="50" r="40" class="ring" />
      <circle cx="50" cy="50" r="27" class="core" />
      <circle cx="42" cy="46" r="4" class="eye" /><circle cx="58" cy="46" r="4" class="eye" />
      <path d="M40 60 q10 7 20 0" class="mouth" fill="none" />
    </svg>
    <div class="name">{session?.label ?? 'agent'}</div>
    <div class="status">{status}</div>
  </div>

  <div class="speech">
    {#if hud.questionOpen}
      {#if q && q.status === 'pending'}
        <p class="line">{q.question}</p>
        {#if q.context}<div class="ctx md">{@html md(q.context)}</div>{/if}
        {#if q.options?.length}
          <ol class="opts">
            {#each q.options as o, i (o.id)}
              <li>
                <button class="opt" class:on={hud.previewOption === i} disabled={sending} onclick={() => pick(i)}>
                  <kbd>{i + 1}</kbd><span><b>{o.label}</b>{#if o.description}<small>{o.description}</small>{/if}</span>
                </button>
              </li>
            {/each}
          </ol>
        {/if}
        <div class="reply">
          {#if previewed}
            <span class="path"><b>{previewed.label}</b>{#if touches.length} → {touches.join(', ')}{:else} (no nodes attached){/if}</span>
            <button class="primary" disabled={sending} onclick={confirm}>Confirm <kbd>↵</kbd></button>
            <button class="ghost" onclick={() => (hud.previewOption = null)}>clear</button>
          {:else}
            <input type="text" placeholder={q.options?.length ? 'or type a reply…' : 'type your answer…'} bind:value={text} disabled={sending}
              onkeydown={(e) => { if (e.key === 'Enter' && text.trim()) confirm(); e.stopPropagation(); }} />
            <button class="primary" disabled={sending || !text.trim()} onclick={confirm}>Send</button>
          {/if}
          {#if q.moreContext || q.files?.length}<button class="ghost" onclick={() => (more = !more)}>{more ? 'less' : 'more context'}</button>{/if}
        </div>
      {:else if q && q.status === 'answered'}
        <p class="line muted">Got it: <b>{q.options?.find((o) => o.id === q.answer?.optionId)?.label ?? q.answer?.text}</b>. {lastNote?.text ?? ''}</p>
      {:else if lastNote}
        <p class="line muted">{lastNote.text} <span class="ago">{timeAgo(lastNote.at, hud.now)}</span></p>
      {:else}
        <p class="line muted">No agent here yet. Run <code>pnpm demo</code> or connect Claude Code with the codehud MCP server.</p>
      {/if}
    {:else}
      <p class="line muted">{q?.status === 'pending' ? 'Question waiting…' : lastNote?.text ?? ''}</p>
    {/if}
  </div>
  <button class="ghost toggle" onclick={() => (hud.questionOpen = !hud.questionOpen)} title="Collapse / expand (c)">{hud.questionOpen ? '▾' : '▴'}</button>
</section>

<style>
  .dialogue { position: absolute; left: 50%; bottom: 18px; transform: translateX(-50%); width: min(960px, calc(100% - 40px)); display: grid; grid-template-columns: 96px 1fr 32px; gap: 14px; padding: 14px 14px 14px 10px; z-index: 20;
    background: color-mix(in srgb, var(--bg-2) 88%, transparent); border: 1px solid var(--line-2); border-radius: 16px; backdrop-filter: blur(12px); box-shadow: 0 30px 60px -30px #000; transition: border-color .3s; }
  .dialogue.pending { border-color: color-mix(in srgb, var(--accent) 70%, var(--line-2)); }
  .avatar { display: flex; flex-direction: column; align-items: center; gap: 2px; }
  .ring { fill: none; stroke: var(--agent); stroke-width: 2; opacity: .5; stroke-dasharray: 6 8; animation: spin 24s linear infinite; transform-origin: 50px 50px; }
  .core { fill: color-mix(in srgb, var(--agent) 25%, var(--bg)); stroke: var(--agent); stroke-width: 2; }
  .eye { fill: var(--agent); animation: blink 6s infinite; transform-origin: 50px 46px; }
  .mouth { stroke: var(--agent); stroke-width: 2.5; stroke-linecap: round; }
  .talking .mouth { animation: talk 1.2s ease-in-out infinite; transform-origin: 50px 60px; }
  .pending .core { fill: color-mix(in srgb, var(--accent) 25%, var(--bg)); stroke: var(--accent); }
  .pending .eye { fill: var(--accent); } .pending .mouth, .pending .ring { stroke: var(--accent); }
  .name { font: 600 11px var(--mono); color: var(--fg); margin-top: 2px; }
  .status { font: 10px var(--mono); color: var(--fg-3); text-transform: uppercase; letter-spacing: .08em; }
  .pending .status { color: var(--accent); }
  .speech { min-width: 0; align-self: center; }
  .line { margin: 0 0 6px; font-size: 15.5px; line-height: 1.4; }
  .muted { color: var(--fg-2); font-size: 13.5px; }
  .ago { color: var(--fg-3); font-size: 11px; margin-left: 6px; }
  .ctx { color: var(--fg-2); font-size: 12.5px; margin-bottom: 8px; }
  .opts { list-style: none; margin: 0 0 8px; padding: 0; display: grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap: 6px; }
  .opt { display: flex; gap: 10px; align-items: flex-start; width: 100%; text-align: left; padding: 8px 10px; border-radius: 10px; background: var(--bg-3); transition: border-color .15s, box-shadow .15s; }
  .opt:hover { border-color: color-mix(in srgb, var(--accent) 60%, var(--line-2)); }
  .opt.on { border-color: var(--accent); box-shadow: 0 0 0 1px color-mix(in srgb, var(--accent) 50%, transparent), 0 0 24px -8px var(--accent); background: color-mix(in srgb, var(--accent) 10%, var(--bg-3)); }
  .opt kbd { margin: 2px 0 0; }
  .opt span { display: flex; flex-direction: column; gap: 2px; font-size: 12.5px; }
  .opt small { color: var(--fg-2); font-size: 11.5px; }
  .reply { display: flex; gap: 8px; align-items: center; min-height: 34px; }
  .reply input { flex: 1; }
  .path { flex: 1; font-size: 12.5px; color: var(--fg-2); }
  .path b { color: var(--accent); }
  .toggle { align-self: start; padding: 2px 6px; }
  .more { position: absolute; left: 16px; top: 56px; bottom: 230px; width: min(420px, 38vw); overflow: auto; padding: 14px 18px; z-index: 19; font-size: 12.5px;
    background: color-mix(in srgb, var(--bg-2) 92%, transparent); border: 1px solid var(--line-2); border-radius: 14px; backdrop-filter: blur(12px); }
  .closemore { float: right; padding: 0 6px; }
  @keyframes spin { to { transform: rotate(360deg); } }
  @keyframes blink { 0%, 92%, 100% { transform: scaleY(1); } 95% { transform: scaleY(.1); } }
  @keyframes talk { 0%, 100% { transform: scaleY(1); } 50% { transform: scaleY(1.8); } }
</style>
