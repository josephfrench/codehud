<script lang="ts">
  /** Decision log: a filterable timeline of answered questions, notes, focus and map loads. A drawer, not a fixed panel. */
  import { fly } from 'svelte/transition';
  import { hud } from '../lib/state.svelte.ts';
  import { timeAgo } from '../lib/md.ts';
  import type { ActivityItem, Question } from '../../../schema/src/protocol.ts';

  type Kind = 'answer' | 'note' | 'focus' | 'question' | 'map' | 'session';
  const KINDS: { id: Kind; label: string }[] = [
    { id: 'answer', label: 'decisions' }, { id: 'question', label: 'questions' }, { id: 'note', label: 'notes' },
    { id: 'focus', label: 'focus' }, { id: 'map', label: 'map' }, { id: 'session', label: 'sessions' },
  ];
  let on = $state<Set<Kind>>(new Set(['answer', 'question', 'note', 'map']));
  let q = $state('');
  let input: HTMLInputElement | undefined;
  const ICON: Record<string, string> = { focus: '◎', question: '?', answer: '✓', note: '·', map: '▦', session: '⌁' };

  interface Entry { id: string; at: string; kind: Kind; text: string; nodes?: string[]; session?: string; decision?: Question }
  const entries = $derived.by<Entry[]>(() => {
    const byQ = new Map<string, Question>(hud.questions.map((x) => [x.id, x]));
    const out: Entry[] = hud.activity.map((a: ActivityItem) => ({ ...a, kind: a.kind as Kind }));
    // answered questions always appear, even if the activity log rolled over
    for (const d of hud.questions) {
      if (d.status !== 'answered' || !d.answer) continue;
      const i = out.findIndex((e) => e.kind === 'answer' && e.session === d.session && Math.abs(new Date(e.at).getTime() - new Date(d.answer!.answeredAt).getTime()) < 2000);
      const chosen = d.options?.find((o) => o.id === d.answer?.optionId)?.label ?? d.answer.text;
      const text = `${d.question} → ${chosen}${d.answer.optionId && d.answer.text && d.answer.text !== chosen ? ` (${d.answer.text})` : ''}`;
      if (i >= 0) out[i] = { ...out[i], text, decision: d, nodes: d.resolvedNodes };
      else out.push({ id: 'd:' + d.id, at: d.answer.answeredAt, kind: 'answer', text, nodes: d.resolvedNodes, session: d.session, decision: d });
    }
    void byQ;
    const needle = q.trim().toLowerCase();
    return out
      .filter((e) => on.has(e.kind))
      .filter((e) => !needle || e.text.toLowerCase().includes(needle) || (e.nodes ?? []).some((id) => (hud.index?.get(id)?.label ?? id).toLowerCase().includes(needle)))
      .sort((a, b) => b.at.localeCompare(a.at));
  });
  function toggle(k: Kind) { const n = new Set(on); if (n.has(k)) n.delete(k); else n.add(k); on = n; }
  function go(e: Entry) { if (e.nodes?.length) { hud.goTo(e.nodes, { select: e.nodes.length === 1 }); } }
  const labels = (ids: string[] = []) => ids.map((id) => hud.index?.get(id)?.label ?? id);
  export function focusFilter() { input?.focus(); }
</script>

<aside class="timeline" transition:fly={{ x: 40, duration: 220 }}>
  <header>
    <h2>History</h2>
    <span class="muted">{entries.length}</span>
    <button class="ghost close" onclick={() => (hud.showTimeline = false)} title="Close (Esc)">✕</button>
  </header>
  <div class="filters">
    <input type="text" placeholder="filter…" bind:value={q} bind:this={input} onkeydown={(e) => { if (e.key === 'Escape') { if (q) { q = ''; e.stopPropagation(); } } else e.stopPropagation(); }} />
    <div class="chips">
      {#each KINDS as k (k.id)}
        <button class="chip {k.id}" class:on={on.has(k.id)} onclick={() => toggle(k.id)}>{ICON[k.id]} {k.label}</button>
      {/each}
    </div>
  </div>
  <ol>
    {#each entries as e (e.id)}
      <li class={e.kind}>
        <button class="entry" class:clickable={!!e.nodes?.length} onclick={() => go(e)} disabled={!e.nodes?.length}>
          <span class="when">{timeAgo(e.at, hud.now)}</span>
          <span class="who" style="background: {hud.sessionColor(e.session)}" title={e.session ?? ''}></span>
          <span class="i">{ICON[e.kind] ?? '·'}</span>
          <span class="body">
            {#if e.decision}
              <span class="qq">{e.decision.question}</span>
              <span class="aa">✓ {e.decision.options?.find((o) => o.id === e.decision?.answer?.optionId)?.label ?? e.decision.answer?.text}</span>
            {:else}
              <span class="tx">{e.text}</span>
            {/if}
            {#if e.nodes?.length}<span class="nodes">{labels(e.nodes).slice(0, 4).join(' · ')}{e.nodes.length > 4 ? ` +${e.nodes.length - 4}` : ''}</span>{/if}
          </span>
        </button>
      </li>
    {:else}
      <li class="empty">Nothing yet{q ? ' for that filter' : ''}. Decisions, notes and map loads collect here.</li>
    {/each}
  </ol>
</aside>

<style>
  .timeline { position: absolute; top: 10px; right: 12px; bottom: 12px; width: min(400px, 90vw); z-index: 24; display: flex; flex-direction: column;
    background: color-mix(in srgb, var(--bg-2) 94%, transparent); border: 1px solid var(--line-2); border-radius: 14px; backdrop-filter: blur(12px); box-shadow: 0 30px 70px -30px #000; }
  header { display: flex; align-items: center; gap: 8px; padding: 12px 14px 8px; }
  h2 { margin: 0; font-size: 14px; }
  .close { margin-left: auto; }
  .filters { padding: 0 14px 8px; border-bottom: 1px solid var(--line); }
  .chips { display: flex; flex-wrap: wrap; gap: 4px; margin-top: 8px; }
  .chip { padding: 2px 8px; font: 11px var(--mono); border-radius: 999px; color: var(--fg-3); background: transparent; }
  .chip.on { color: var(--fg); background: var(--bg-3); }
  .chip.answer.on { color: var(--ok); } .chip.question.on { color: var(--accent); } .chip.focus.on { color: var(--agent); }
  ol { list-style: none; margin: 0; padding: 6px 8px 10px; overflow: auto; flex: 1; }
  .entry { display: grid; grid-template-columns: 54px 7px 14px 1fr; gap: 8px; align-items: start; width: 100%; text-align: left; background: none; border: none; padding: 6px 6px; border-radius: 8px; color: var(--fg-2); cursor: default; }
  .entry.clickable { cursor: pointer; }
  .entry.clickable:hover { background: var(--bg-3); color: var(--fg); }
  .when { font: 10.5px var(--mono); color: var(--fg-3); padding-top: 2px; }
  .who { width: 7px; height: 7px; border-radius: 50%; margin-top: 5px; }
  .i { font-family: var(--mono); text-align: center; }
  .answer .i { color: var(--ok); } .question .i { color: var(--accent); font-weight: 700; } .focus .i { color: var(--agent); }
  .body { display: flex; flex-direction: column; gap: 2px; min-width: 0; font-size: 12px; }
  .qq { color: var(--fg); }
  .aa { color: var(--ok); font-weight: 600; }
  .tx { overflow-wrap: anywhere; }
  .nodes { font: 10.5px var(--mono); color: var(--fg-3); }
  .empty { color: var(--fg-3); padding: 24px 10px; text-align: center; font-size: 12.5px; }
  .muted { color: var(--fg-3); font: 11px var(--mono); }
</style>
