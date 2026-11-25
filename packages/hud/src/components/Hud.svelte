<script lang="ts">
  import { untrack } from 'svelte';
  import { hud } from '../lib/state.svelte.ts';
  import { computeLayout, bbox, KIND_GLYPH, EDGE_STYLE, LANE_HEAD_H, type Layout, type VisEdge, type Card } from '../lib/layout.ts';
  import { outsideStubs, type Stub } from '../lib/stubs.ts';
  import Minimap from './Minimap.svelte';

  let container: HTMLDivElement;
  let svgEl: SVGSVGElement;
  let size = $state({ w: 1200, h: 800 });
  let vb = $state({ x: 0, y: 0, w: 1200, h: 800 });

  const layout = $derived<Layout | null>(hud.index ? computeLayout(hud.index, hud.visible, { showImports: hud.showImports }) : null);
  const hasHighlight = $derived(hud.highlighted.size > 0);
  const stubs = $derived<Stub[]>(hud.index && layout ? outsideStubs(hud.index, hud.current?.id ?? null, layout, { showImports: hud.showImports }) : []);
  const reducedMotion = () => { try { return matchMedia('(prefers-reduced-motion: reduce)').matches; } catch { return false; } };

  // ----- staged zoom (interface-patterns.md §2) ------------------------------
  // Zoom in: (1) siblings compress and dim, the focus card grows, (2) the level swaps, (3) children and edges fade in.
  // Zoom out: the card we came from starts enlarged and settles into place while its siblings fade in.
  const LEAVE_MS = 150, ENTER_MS = 260;
  let shown = $state.raw<Layout | null>(null);
  let shownStubs = $state.raw<Stub[]>([]);
  let phase = $state<'idle' | 'leaving' | 'entering'>('idle');
  let leavingId = $state<string | null>(null);
  let arrivingId = $state<string | null>(null);
  let lastDepth = -1;
  let lastLevel = '';
  let stageTimer: ReturnType<typeof setTimeout> | undefined;
  $effect(() => {
    const l = layout, s = stubs;
    const depth = hud.focusPath.length;
    const level = hud.focusPath.join('/');
    const into = hud.focusPath.at(-1);
    // everything below reads/writes staging state only; it must not re-trigger this effect
    untrack(() => {
      const prev = shown;
      const swap = () => { shown = l; shownStubs = s; };
      if (!l || !prev || reducedMotion() || level === lastLevel) { swap(); lastDepth = depth; lastLevel = level; return; }
      clearTimeout(stageTimer);
      if (depth > lastDepth && into && prev.cardById.has(into)) {
        phase = 'leaving'; leavingId = into; arrivingId = null;
        stageTimer = setTimeout(() => { swap(); phase = 'entering'; leavingId = null; stageTimer = setTimeout(() => (phase = 'idle'), ENTER_MS); }, LEAVE_MS);
      } else {
        swap();
        const sel = hud.selected;
        arrivingId = depth < lastDepth && sel && l.cardById.has(sel) ? sel : null;
        phase = 'entering'; leavingId = null;
        stageTimer = setTimeout(() => { phase = 'idle'; arrivingId = null; }, ENTER_MS + 80);
      }
      lastDepth = depth; lastLevel = level;
    });
  });

  // ----- fit / animation ----------------------------------------------------
  let lastSeq = -1;
  let anim: number | null = null;
  $effect(() => {
    const f = hud.fit;
    const l = layout;
    if (!l || f.seq === lastSeq) return;
    lastSeq = f.seq;
    if (f.lane) {
      const col = l.columns.find((c) => c.id === f.lane);
      if (col) fitTo({ x: col.x, y: 0, w: col.w, h: l.height }, 30, 500);
      return;
    }
    const cards = f.ids ? l.cards.filter((c) => f.ids!.includes(c.id)) : l.cards;
    if (f.ids && cards.length) fitTo(bbox(cards)!, 160, 760);
    else fitTo({ x: 0, y: 0, w: l.width, h: l.height }, hud.current ? 90 : 24, 600);
  });

  function fitTo(box: { x: number; y: number; w: number; h: number }, pad: number, minW: number) {
    const aspect = size.w / size.h;
    let w = Math.max(box.w + pad * 2, minW);
    let h = Math.max(box.h + pad * 2, minW / aspect);
    if (w / h < aspect) w = h * aspect; else h = w / aspect;
    animateTo({ x: box.x + box.w / 2 - w / 2, y: box.y + box.h / 2 - h / 2, w, h });
  }
  function animateTo(target: typeof vb) {
    if (anim) cancelAnimationFrame(anim);
    if (reducedMotion()) { vb = target; return; }
    const from = { ...vb };
    const t0 = performance.now();
    const dur = 380;
    const step = (t: number) => {
      const p = Math.min(1, (t - t0) / dur);
      const e = p < 0.5 ? 4 * p * p * p : 1 - Math.pow(-2 * p + 2, 3) / 2;
      vb = { x: from.x + (target.x - from.x) * e, y: from.y + (target.y - from.y) * e, w: from.w + (target.w - from.w) * e, h: from.h + (target.h - from.h) * e };
      if (p < 1) anim = requestAnimationFrame(step); else anim = null;
    };
    anim = requestAnimationFrame(step);
  }

  $effect(() => {
    const ro = new ResizeObserver(() => {
      const r = container.getBoundingClientRect();
      if (r.width && r.height) {
        const aspect = r.width / r.height;
        size = { w: r.width, h: r.height };
        vb = { ...vb, h: vb.w / aspect };
      }
    });
    ro.observe(container);
    return () => ro.disconnect();
  });

  // ----- pan / zoom ----------------------------------------------------------
  function toWorld(cx: number, cy: number) {
    const r = svgEl.getBoundingClientRect();
    return { x: vb.x + ((cx - r.left) / r.width) * vb.w, y: vb.y + ((cy - r.top) / r.height) * vb.h };
  }
  function onWheel(e: WheelEvent) {
    e.preventDefault();
    if (anim) { cancelAnimationFrame(anim); anim = null; }
    const factor = Math.exp((e.ctrlKey ? e.deltaY * 0.01 : e.deltaY * 0.0018));
    const nw = Math.min(Math.max(vb.w * factor, 300), 20000);
    const f = nw / vb.w;
    const p = toWorld(e.clientX, e.clientY);
    vb = { x: p.x - (p.x - vb.x) * f, y: p.y - (p.y - vb.y) * f, w: nw, h: vb.h * f };
    hud.roam();
  }
  let drag: { x: number; y: number; vx: number; vy: number; moved: boolean } | null = null;
  function onPointerDown(e: PointerEvent) {
    if (e.button !== 0) return;
    drag = { x: e.clientX, y: e.clientY, vx: vb.x, vy: vb.y, moved: false };
    // No pointer capture here: capturing retargets the click to the <svg>, which would swallow card clicks.
  }
  function onPointerMove(e: PointerEvent) {
    if (!drag) return;
    const r = svgEl.getBoundingClientRect();
    const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
    if (!drag.moved && Math.abs(dx) + Math.abs(dy) > 4) { drag.moved = true; svgEl.setPointerCapture(e.pointerId); }
    if (drag.moved) {
      if (anim) { cancelAnimationFrame(anim); anim = null; }
      vb = { ...vb, x: drag.vx - (dx / r.width) * vb.w, y: drag.vy - (dy / r.height) * vb.h };
    }
  }
  function onPointerUp(e: PointerEvent) {
    if (!drag) return;
    const wasDrag = drag.moved;
    drag = null;
    if (svgEl.hasPointerCapture(e.pointerId)) svgEl.releasePointerCapture(e.pointerId);
    if (wasDrag) hud.roam();
    else if ((e.target as Element).closest('.card, .stub') === null) hud.select(null);
  }

  // ----- helpers ---------------------------------------------------------------
  const layerColor = (id: string) => hud.layerColor(id);
  const trunc = (s: string | undefined, n: number) => (!s ? '' : s.length > n ? s.slice(0, n - 1) + '…' : s);
  const childCount = (id: string) => hud.index?.childrenOf(id).length ?? 0;
  const isLit = (id: string) => hud.highlighted.has(id);
  const isSoft = (id: string) => !hud.highlighted.has(id) && hud.litSet.has(id);
  const hasAgent = (id: string) => hud.agentSet.has(id);
  const agentColor = (id: string) => hud.agentColorByNode.get(id) ?? 'var(--agent)';
  const pendingCount = (id: string) => hud.pendingByNode.get(id)?.length ?? 0;
  const decisionCount = (id: string) => hud.decisionsByNode.get(id)?.length ?? 0;
  function edgeLit(e: VisEdge) { return hud.litSet.has(e.from) && hud.litSet.has(e.to); }
  function edgeDim(e: VisEdge) { return hasHighlight && !(hud.litSet.has(e.from) || hud.litSet.has(e.to)); }
  function cardDim(c: Card) {
    if (!hasHighlight) return false;
    if (hud.litSet.has(c.id) || hud.selected === c.id) return false;
    // keep direct neighbours of lit nodes readable
    return !shown!.edges.some((e) => (e.from === c.id && hud.litSet.has(e.to)) || (e.to === c.id && hud.litSet.has(e.from)));
  }
  function onCardClick(e: MouseEvent, id: string) {
    e.stopPropagation();
    if (hud.selected === id) { hud.select(null); return; }
    const r = (e.currentTarget as Element).getBoundingClientRect();
    hud.openBlowout(id, { x: r.left + r.width / 2, y: r.top + r.height / 2 });
  }
  function onCardDbl(e: MouseEvent, id: string) {
    e.stopPropagation();
    if (childCount(id)) hud.descend(id);
  }
  function onBadge(e: MouseEvent, id: string) {
    e.stopPropagation();
    hud.descend(id);
  }
  function stubLine(s: Stub, repId: string) {
    const c = shown!.cardById.get(repId);
    if (!c) return '';
    const cx = c.x + c.w / 2, cy = c.y + c.h / 2;
    return `M${s.x},${s.y} L${cx},${cy}`;
  }
  function onStubClick(e: MouseEvent, s: Stub) {
    e.stopPropagation();
    hud.hideTip();
    hud.goTo(s.targets.map((t) => t.id));
  }
  function stubTip(e: MouseEvent, s: Stub) {
    const dir = s.out && s.inn ? '↔' : s.out ? '→' : '←';
    hud.showTip({ x: e.clientX, y: e.clientY, title: `${dir} ${s.label} · ${s.count} edge${s.count === 1 ? '' : 's'} (${s.kinds.join(', ')})`, lines: s.targets.map((t) => `${KIND_GLYPH[t.kind] ?? '•'} ${t.label}`), accent: layerColor(s.layer) });
  }
  function whyTip(e: MouseEvent, id: string) {
    const d = hud.latestDecision(id);
    if (!d) return;
    const chosen = d.options?.find((o) => o.id === d.answer?.optionId)?.label ?? d.answer?.text ?? '';
    const n = decisionCount(id);
    hud.showTip({ x: e.clientX, y: e.clientY, title: 'Why is this here?', lines: [d.question, `✓ ${chosen}`, ...(n > 1 ? [`+${n - 1} earlier decision${n > 2 ? 's' : ''} · press h`] : [])], accent: 'var(--ok)' });
  }
  const stubLabel = (s: Stub) => `${s.out && s.inn ? '↔' : s.out ? '→' : '←'} ${trunc(s.label, 14)}${s.count > 1 ? ` ×${s.count}` : ''}`;
  const showMini = $derived(!!shown && (hud.focusPath.length > 0 || shown.width > size.w));
</script>

<div class="canvas" bind:this={container}>
  <svg
    bind:this={svgEl}
    class={phase}
    viewBox="{vb.x} {vb.y} {vb.w} {vb.h}"
    preserveAspectRatio="xMidYMid meet"
    onwheel={onWheel}
    onpointerdown={onPointerDown}
    onpointermove={onPointerMove}
    onpointerup={onPointerUp}
    onpointercancel={() => (drag = null)}
    role="application"
    aria-label="System map"
  >
    <defs>
      <marker id="arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
        <path d="M0,1 L9,5 L0,9 z" fill="var(--fg-3)" />
      </marker>
      <marker id="arrow-lit" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
        <path d="M0,1 L9,5 L0,9 z" fill="var(--accent)" />
      </marker>
      <filter id="glow" x="-20%" y="-40%" width="140%" height="180%">
        <feGaussianBlur stdDeviation="6" result="b" />
        <feMerge><feMergeNode in="b" /><feMergeNode in="SourceGraphic" /></feMerge>
      </filter>
    </defs>

    {#if shown}
      {@const layout = shown}
      <!-- layer bands -->
      {#each layout.bands as b (b.layer.id)}
        <rect x={-2000} y={b.y} width={layout.width + 4000} height={b.h} fill={layerColor(b.layer.id)} opacity="0.045" />
        <line x1={-2000} y1={b.y} x2={layout.width + 4000} y2={b.y} stroke="var(--line)" />
        <rect x={0} y={b.y + 10} width={3} height={b.h - 20} rx="1.5" fill={layerColor(b.layer.id)} opacity="0.8" />
        <text x={14} y={b.y + 24} class="band-label" fill={layerColor(b.layer.id)}>{b.layer.label.toUpperCase()}</text>
        {#if b.layer.description}
          <text x={14} y={b.y + 40} class="band-desc">{trunc(b.layer.description, 18)}</text>
        {/if}
      {/each}

      <!-- lane columns -->
      {#each layout.columns as c, i (c.id)}
        {#if i > 0}<line x1={c.x} y1={LANE_HEAD_H - 10} x2={c.x} y2={layout.height} stroke="var(--line)" stroke-dasharray="2 6" />{/if}
        <text x={c.x + c.w / 2} y={LANE_HEAD_H - 14} text-anchor="middle" class="lane-label" class:shared={!c.lane}>
          {c.lane?.label ?? 'Shared'}
        </text>
      {/each}

      <!-- edges to the outside: stubs at the boundary -->
      <g class="stubs">
        {#each shownStubs as s (s.id)}
          {#each s.insideReps as rep (rep)}
            <path d={stubLine(s, rep)} class="stub-line" />
          {/each}
          <!-- svelte-ignore a11y_click_events_have_key_events a11y_no_static_element_interactions a11y_mouse_events_have_key_events -->
          <g class="stub" transform="translate({s.x} {s.y})" style="--c: {layerColor(s.layer)}"
            onclick={(e) => onStubClick(e, s)} onmouseenter={(e) => stubTip(e, s)} onmousemove={(e) => stubTip(e, s)} onmouseleave={() => hud.hideTip()}>
            <rect x={-64} y={-11} width={128} height={22} rx="11" />
            <text y="4" text-anchor="middle">{stubLabel(s)}</text>
          </g>
        {/each}
      </g>

      <!-- edges -->
      <g class="edges">
        {#each layout.edges as e (e.key)}
          <path
            d={e.d}
            class="edge"
            class:lit={edgeLit(e)}
            class:dim={edgeDim(e)}
            class:lifted={!e.direct}
            stroke-dasharray={EDGE_STYLE[e.kind]?.dash}
            marker-end={edgeLit(e) ? 'url(#arrow-lit)' : 'url(#arrow)'}
          />
          {#if e.count > 1 || e.labels.length}
            <g transform="translate({e.mid.x} {e.mid.y})" class="edge-tag" class:lit={edgeLit(e)} class:dim={edgeDim(e)}>
              <rect x={-28} y={-9} width={56} height={18} rx="9" />
              <text y="4" text-anchor="middle">{e.count > 1 ? `${EDGE_STYLE[e.kind]?.label ?? e.kind} ×${e.count}` : trunc(e.labels[0] ?? e.kind, 12)}</text>
            </g>
          {:else}
            <g transform="translate({e.mid.x} {e.mid.y})" class="edge-kind" class:dim={edgeDim(e)}>
              <text y="3" text-anchor="middle">{EDGE_STYLE[e.kind]?.label ?? e.kind}</text>
            </g>
          {/if}
        {/each}
      </g>

      <!-- cards -->
      {#each layout.cards as c (c.id)}
        {@const kids = childCount(c.id)}
        {@const lit = isLit(c.id)}
        {@const pend = pendingCount(c.id)}
        {@const dec = decisionCount(c.id)}
        <!-- svelte-ignore a11y_click_events_have_key_events a11y_no_static_element_interactions -->
        <g
          class="card"
          class:lit
          class:soft={isSoft(c.id)}
          class:agent={hasAgent(c.id)}
          class:selected={hud.selected === c.id}
          class:dim={cardDim(c)}
          class:has-pending={pend > 0}
          class:leave-focus={leavingId === c.id}
          class:leave-sib={!!leavingId && leavingId !== c.id}
          class:arrive={arrivingId === c.id}
          transform="translate({c.x} {c.y})"
          style="--c: {layerColor(c.layer)}; --a: {agentColor(c.id)}"
          onclick={(e) => onCardClick(e, c.id)}
          ondblclick={(e) => onCardDbl(e, c.id)}
        >
          <g class="inner">
            {#if lit || pend}
              <rect class="ring" x={-4} y={-4} width={c.w + 8} height={c.h + 8} rx="12" />
            {/if}
            <rect class="bg" width={c.w} height={c.h} rx="8" />
            <rect class="accent" x="0" y="8" width="3" height={c.h - 16} rx="1.5" />
            <text class="kind" x="14" y="17">{KIND_GLYPH[c.node.kind] ?? '•'} {c.node.kind}</text>
            <text class="label" x="14" y="38">{trunc(c.node.label, 24)}</text>
            <text class="summary" x="14" y="56">{trunc(c.node.summary, 30)}</text>
            {#if kids}
              <!-- svelte-ignore a11y_click_events_have_key_events a11y_no_static_element_interactions -->
              <g class="badge" transform="translate({c.w - 40} {c.h - 22})" onclick={(e) => onBadge(e, c.id)}>
                <rect width="32" height="16" rx="8" />
                <text x="16" y="12" text-anchor="middle">▸ {kids}</text>
              </g>
            {/if}
            {#if dec}
              <!-- svelte-ignore a11y_no_static_element_interactions a11y_mouse_events_have_key_events -->
              <g class="why" transform="translate({c.w - 12} 17)" onmouseenter={(e) => whyTip(e, c.id)} onmouseleave={() => hud.hideTip()}
                onclick={(e) => { e.stopPropagation(); hud.showTimeline = true; }}>
                <rect x={-30} y={-12} width={34} height={16} rx="8" />
                <text text-anchor="end">✓{dec}</text>
              </g>
            {/if}
            {#if pend}
              <g transform="translate({c.w - 6} 6)">
                <circle r="9" class="pend" />
                <text y="4" text-anchor="middle" class="pend-n">{pend}</text>
              </g>
            {/if}
            {#if hasAgent(c.id)}
              <circle cx="6" cy="6" r="4" class="agent-dot" />
            {/if}
          </g>
        </g>
      {/each}
    {:else}
      <text x="40" y="60" fill="var(--fg-2)" font-size="16">No system map loaded. Start the server with --map, or call hud_load_map from the agent.</text>
    {/if}
  </svg>
  {#if showMini}<Minimap viewport={hud.focusPath.length ? null : vb} />{/if}
</div>

<style>
  .canvas { position: absolute; inset: 0; background:
    radial-gradient(circle at 1px 1px, var(--line) 1px, transparent 1px) 0 0 / 28px 28px, var(--bg); }
  svg { width: 100%; height: 100%; display: block; cursor: grab; touch-action: none; user-select: none; }
  svg:active { cursor: grabbing; }
  .band-label { font: 600 11px var(--mono); letter-spacing: .12em; opacity: .9; }
  .band-desc { font: 10px var(--sans); fill: var(--fg-3); }
  .lane-label { font: 600 12px var(--sans); fill: var(--fg-2); letter-spacing: .04em; }
  .lane-label.shared { fill: var(--fg-3); font-style: italic; }

  .edge { fill: none; stroke: var(--fg-3); stroke-width: 1.4; opacity: .7; transition: opacity .2s, stroke .2s; }
  .edge.lifted { stroke-width: 2.2; }
  .edge.lit { stroke: var(--accent); opacity: 1; stroke-width: 2.4; }
  .edge.dim { opacity: .14; }
  .edge-tag rect { fill: var(--bg-2); stroke: var(--line-2); }
  .edge-tag text { font: 10px var(--mono); fill: var(--fg-2); }
  .edge-tag.lit rect { stroke: var(--accent); }
  .edge-tag.lit text { fill: var(--accent); }
  .edge-tag.dim, .edge-kind.dim { opacity: .15; }
  .edge-kind text { font: 9px var(--mono); fill: var(--fg-3); paint-order: stroke; stroke: var(--bg); stroke-width: 4px; stroke-linejoin: round; }

  /* stubs: edges leaving this level */
  .stub-line { fill: none; stroke: var(--fg-3); stroke-width: 1.2; stroke-dasharray: 3 5; opacity: .45; }
  .stub { cursor: pointer; }
  .stub rect { fill: var(--bg-2); stroke: var(--c); stroke-width: 1.2; opacity: .9; }
  .stub text { font: 600 10.5px var(--mono); fill: var(--c); }
  .stub:hover rect { fill: var(--bg-3); stroke-width: 2; opacity: 1; }

  .card { cursor: pointer; transition: opacity .25s; }
  .card .inner { transform-box: fill-box; transform-origin: center; transition: transform .15s ease-in, opacity .15s ease-in; }
  .card .bg { fill: var(--card); stroke: var(--line-2); stroke-width: 1; transition: stroke .15s, fill .15s; }
  .card:hover .bg { fill: var(--card-2); stroke: var(--fg-3); }
  .card .accent { fill: var(--c); }
  .card .kind { font: 10px var(--mono); fill: var(--c); letter-spacing: .04em; }
  .card .label { font: 600 13px var(--sans); fill: var(--fg); }
  .card .summary { font: 11px var(--sans); fill: var(--fg-2); }
  .card.dim { opacity: .38; }
  .card.selected .bg { stroke: var(--fg); stroke-width: 1.5; }
  .card.soft .bg { stroke: var(--accent); stroke-dasharray: 4 3; }
  .card.lit .bg { stroke: var(--accent); stroke-width: 2; fill: var(--card-2); filter: url(#glow); }
  .card .ring { fill: none; stroke: var(--accent); stroke-width: 2; animation: ring 1.6s ease-out infinite; pointer-events: none; }
  .card.agent .bg { stroke: var(--a); }
  .card.lit.agent .bg { stroke: var(--accent); }
  .agent-dot { fill: var(--a); animation: pulse 1.4s ease-in-out infinite; }
  .badge rect { fill: var(--bg-3); stroke: var(--line-2); }
  .badge text { font: 600 10px var(--mono); fill: var(--fg-2); }
  .badge:hover rect { stroke: var(--fg); }
  .badge:hover text { fill: var(--fg); }
  .why { cursor: help; }
  .why rect { fill: transparent; }
  .why:hover rect { fill: var(--bg-3); }
  .why text { font: 600 10px var(--mono); fill: var(--ok); }
  .pend { fill: var(--accent); }
  .pend-n { font: 700 10px var(--mono); fill: #140c00; }

  /* staged zoom */
  .card.leave-sib .inner { opacity: .15; transform: scale(.9); }
  .card.leave-focus .inner { transform: scale(1.3); }
  .card.leave-focus .bg { stroke: var(--fg); }
  svg.entering .card .inner { animation: card-in .26s ease-out both; }
  svg.entering .edges, svg.entering .stubs { animation: fade-in .3s .08s ease-out both; }
  svg.entering .card.arrive .inner { animation: card-arrive .3s ease-out both; }
  @keyframes card-in { from { opacity: 0; transform: scale(.85); } to { opacity: 1; transform: scale(1); } }
  @keyframes card-arrive { from { opacity: 1; transform: scale(1.5); } to { opacity: 1; transform: scale(1); } }
  @keyframes fade-in { from { opacity: 0; } to { opacity: 1; } }
</style>
