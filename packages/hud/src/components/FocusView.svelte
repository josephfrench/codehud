<script lang="ts">
  /**
   * Play view: the relevant slice of the system as a graph you can walk.
   *   left-drag pan · wheel zoom · left-click a node = specifics modal · right-click a node = make it the focus
   */
  import { fade } from 'svelte/transition';
  import { untrack } from 'svelte';
  import { hud } from '../lib/state.svelte.ts';
  import { focusLayout, type FNode, type FEdge } from '../lib/focusLayout.ts';
  import { KIND_GLYPH } from '../lib/layout.ts';
  import type { SysNode } from '../../../schema/src/index.ts';

  let container: HTMLDivElement;
  let svgEl: SVGSVGElement;
  let size = $state({ w: 1200, h: 700 });
  let hover = $state<string | null>(null);

  const focalIds = $derived(hud.highlighted.size ? [...hud.highlighted] : hud.agentAt?.nodes ?? []);
  const layout = $derived(hud.index ? focusLayout(hud.index, focalIds, { showImports: hud.showImports }) : null);
  const crumbs = $derived.by(() => {
    if (!hud.index || !focalIds.length) return [] as SysNode[];
    const chains = focalIds.map((id) => hud.index!.ancestors(id).map((a) => a.id));
    let prefix = chains[0] ?? [];
    for (const c of chains.slice(1)) { let i = 0; while (i < prefix.length && i < c.length && prefix[i] === c[i]) i++; prefix = prefix.slice(0, i); }
    return prefix.map((id) => hud.index!.get(id)!).filter(Boolean);
  });

  // ----- viewport: auto-fit on layout change, manual pan/zoom otherwise ------
  let vb = $state({ x: -600, y: -350, w: 1200, h: 700 });
  let anim: number | null = null;
  let lastKey = '';
  $effect(() => {
    const l = layout;
    const s = size;
    if (!l) return;
    const key = l.nodes.map((n) => n.id).join('|');
    const pad = 70;
    const aspect = s.w / s.h;
    let w = Math.max(l.bbox.w + pad * 2, 900);
    let h = Math.max(l.bbox.h + pad * 2, 900 / aspect);
    if (w / h < aspect) w = h * aspect; else h = w / aspect;
    const target = { x: l.bbox.x + l.bbox.w / 2 - w / 2, y: l.bbox.y + l.bbox.h / 2 - h / 2, w, h };
    if (key !== lastKey) { lastKey = key; untrack(() => animateTo(target)); }
    else { const cur = untrack(() => vb); vb = { ...cur, h: cur.w / aspect }; } // resize only: keep the user's pan/zoom
  });
  function animateTo(t: typeof vb) {
    if (anim) cancelAnimationFrame(anim);
    const from = { ...vb }, t0 = performance.now(), dur = 450;
    const step = (now: number) => {
      const p = Math.min(1, (now - t0) / dur), e = 1 - Math.pow(1 - p, 3);
      vb = { x: from.x + (t.x - from.x) * e, y: from.y + (t.y - from.y) * e, w: from.w + (t.w - from.w) * e, h: from.h + (t.h - from.h) * e };
      anim = p < 1 ? requestAnimationFrame(step) : null;
    };
    anim = requestAnimationFrame(step);
  }
  $effect(() => {
    const ro = new ResizeObserver(() => { const r = container.getBoundingClientRect(); if (r.width && r.height) size = { w: r.width, h: r.height }; });
    ro.observe(container);
    return () => ro.disconnect();
  });
  function toWorld(cx: number, cy: number) {
    const r = svgEl.getBoundingClientRect();
    return { x: vb.x + ((cx - r.left) / r.width) * vb.w, y: vb.y + ((cy - r.top) / r.height) * vb.h };
  }
  function onWheel(e: WheelEvent) {
    e.preventDefault();
    if (anim) { cancelAnimationFrame(anim); anim = null; }
    const f = Math.min(Math.max(Math.exp((e.ctrlKey ? 0.01 : 0.0018) * e.deltaY), 0.5), 2);
    const nw = Math.min(Math.max(vb.w * f, 500), 12000), k = nw / vb.w;
    const p = toWorld(e.clientX, e.clientY);
    vb = { x: p.x - (p.x - vb.x) * k, y: p.y - (p.y - vb.y) * k, w: nw, h: vb.h * k };
  }
  let drag: { x: number; y: number; vx: number; vy: number; moved: boolean } | null = null;
  function onPointerDown(e: PointerEvent) {
    if (e.button !== 0) return;
    drag = { x: e.clientX, y: e.clientY, vx: vb.x, vy: vb.y, moved: false };
  }
  function onPointerMove(e: PointerEvent) {
    if (!drag) return;
    const r = svgEl.getBoundingClientRect();
    const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
    if (!drag.moved && Math.abs(dx) + Math.abs(dy) > 4) { drag.moved = true; svgEl.setPointerCapture(e.pointerId); if (anim) { cancelAnimationFrame(anim); anim = null; } }
    if (drag.moved) vb = { ...vb, x: drag.vx - (dx / r.width) * vb.w, y: drag.vy - (dy / r.height) * vb.h };
  }
  function onPointerUp(e: PointerEvent) {
    if (!drag) return;
    const moved = drag.moved;
    drag = null;
    if (svgEl.hasPointerCapture(e.pointerId)) svgEl.releasePointerCapture(e.pointerId);
    if (moved) hud.roam();
  }

  // ----- helpers ---------------------------------------------------------------
  const layerColor = (n: SysNode | null) => (n ? `var(--layer-${hud.index?.layerOf(n) ?? n.layer}, var(--layer-default))` : 'var(--fg-3)');
  const trunc = (s: string | undefined, n: number) => (!s ? '' : s.length > n ? s.slice(0, n - 1) + '…' : s);
  const metaLine = (n: SysNode) => {
    const m = n.meta ?? {};
    if (m.signature) return String(m.signature);
    if (m.method && m.path) return `${m.method} ${m.path}`;
    if (Array.isArray(m.columns)) return `${m.columns.length} columns`;
    return n.summary ?? '';
  };
  const edgeHot = (e: FEdge) => !!hover && (e.from === hover || e.to === hover);
  const edgeDim = (e: FEdge) => !!hover && !edgeHot(e);
  const nodeDim = (n: FNode) => !!hover && hover !== n.id && !layout?.edges.some((e) => (e.from === hover && e.to === n.id) || (e.to === hover && e.from === n.id));

  function focusOn(id: string) { hud.highlighted = new Set([id]); hud.selected = null; hud.roam(); }
  function openSpecifics(e: MouseEvent, id: string) {
    if (drag?.moved) return;
    const r = (e.currentTarget as Element).getBoundingClientRect();
    hud.openBlowout(id, { x: r.left + r.width / 2, y: r.top + r.height / 2 });
  }
  function onContext(e: MouseEvent, n: FNode) {
    e.preventDefault();
    if (n.role !== 'more' && n.node) focusOn(n.id);
  }
</script>

<div class="stage" bind:this={container} style="left: {hud.activeQuestion && hud.questionOpen ? 'min(440px, 42vw)' : '0'}">
  {#if !hud.map}
    <div class="empty">No system map loaded.</div>
  {:else if !layout}
    <div class="empty">
      <div class="name">{hud.map.name}</div>
      <p>Waiting for the agent. When it moves or asks something, that part of the system appears here.</p>
      <button onclick={() => (hud.view = 'map')}>Open the map <kbd>m</kbd></button>
    </div>
  {:else}
    <nav class="crumbs">
      <button class="crumb" onclick={() => (hud.view = 'map')} title="Open the map (m)">{hud.map.name}</button>
      {#each crumbs as c (c.id)}<span class="sep">›</span><button class="crumb" onclick={() => focusOn(c.id)}>{c.label}</button>{/each}
      <span class="hint">drag · wheel · right-click to focus · click for details</span>
    </nav>

    <svg
      bind:this={svgEl}
      viewBox="{vb.x} {vb.y} {vb.w} {vb.h}"
      preserveAspectRatio="xMidYMid meet"
      role="application"
      aria-label="Focus graph"
      onwheel={onWheel}
      onpointerdown={onPointerDown}
      onpointermove={onPointerMove}
      onpointerup={onPointerUp}
      onpointercancel={() => (drag = null)}
      oncontextmenu={(e) => e.preventDefault()}
    >
      <defs>
        <marker id="fa" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="8" markerHeight="8" orient="auto">
          <path d="M0,1.5 L8,5 L0,8.5 z" fill="var(--fg-3)" />
        </marker>
        <marker id="fa-hot" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="8" markerHeight="8" orient="auto">
          <path d="M0,1.5 L8,5 L0,8.5 z" fill="var(--agent)" />
        </marker>
        <radialGradient id="halo"><stop offset="0" stop-color="var(--accent)" stop-opacity=".16" /><stop offset="1" stop-color="var(--accent)" stop-opacity="0" /></radialGradient>
      </defs>

      {#if layout.container}
        {@const c = layout.container}
        <g class="container" transition:fade={{ duration: 250 }}>
          <rect x={c.x} y={c.y} width={c.w} height={c.h} rx="18" />
          <!-- svelte-ignore a11y_click_events_have_key_events a11y_no_static_element_interactions -->
          <g class="ctitle" onclick={() => focusOn(c.parent.id)}>
            <text x={c.x + 16} y={c.y + 22}>{KIND_GLYPH[c.parent.kind] ?? '•'} {c.parent.label.toUpperCase()}</text>
            <text x={c.x + c.w - 14} y={c.y + 22} text-anchor="end" class="hint">focus parent ↗</text>
          </g>
        </g>
      {/if}

      <g class="edges">
        {#each layout.edges as e (e.key)}
          <g class="edge" class:hot={edgeHot(e)} class:dim={edgeDim(e)} transition:fade={{ duration: 200 }}>
            <path d={e.d} class="wire" />
            <path d={e.d} class="line" class:flow={e.flow} class:dashed={!e.flow} marker-end={edgeHot(e) ? 'url(#fa-hot)' : 'url(#fa)'} />
            <g transform="translate({e.mid.x} {e.mid.y})">
              <rect x={-e.label.length * 3.6 - 8} y={-9} width={e.label.length * 7.2 + 16} height={18} rx="9" />
              <text y="4" text-anchor="middle">{e.label}</text>
            </g>
          </g>
        {/each}
      </g>

      {#each layout.nodes as n (n.id)}
        {@const pending = (hud.pendingByNode.get(n.id)?.length ?? 0) > 0}
        <!-- svelte-ignore a11y_click_events_have_key_events a11y_no_static_element_interactions a11y_mouse_events_have_key_events -->
        <g
          class="node {n.role}"
          class:dim={nodeDim(n)}
          class:selected={hud.selected === n.id}
          class:pending
          style="transform: translate({n.x}px, {n.y}px); --c: {layerColor(n.node)}"
          onclick={(e) => n.node && openSpecifics(e, n.id)}
          oncontextmenu={(e) => onContext(e, n)}
          onmouseenter={() => (hover = n.id)}
          onmouseleave={() => (hover = null)}
        >
          {#if n.role === 'focal'}
            <circle r={Math.max(n.w, n.h) * 0.8} fill="url(#halo)" />
            {#if pending}<rect class="ring" x={-n.w / 2 - 6} y={-n.h / 2 - 6} width={n.w + 12} height={n.h + 12} rx="18" />{/if}
          {/if}
          <rect class="bg" x={-n.w / 2} y={-n.h / 2} width={n.w} height={n.h} rx={n.role === 'focal' ? 14 : 10} />
          <rect class="bar" x={-n.w / 2} y={-n.h / 2 + 10} width="4" height={n.h - 20} rx="2" />
          {#if n.role === 'more'}
            <text class="label" text-anchor="middle" y="5">+{n.moreCount} more</text>
          {:else if n.node}
            {@const nd = n.node}
            {#if n.role === 'focal'}
              <text class="glyph" x={-n.w / 2 + 18} y={-n.h / 2 + 34}>{KIND_GLYPH[nd.kind] ?? '•'}</text>
              <text class="kind" x={-n.w / 2 + 44} y={-n.h / 2 + 22}>{nd.kind} · {hud.index?.layerOf(nd)}{hud.index?.laneOf(nd) ? ' / ' + hud.index?.laneOf(nd) : ''}</text>
              <text class="label big" x={-n.w / 2 + 44} y={-n.h / 2 + 44}>{trunc(nd.label, 24)}</text>
              <text class="meta" x={-n.w / 2 + 44} y={-n.h / 2 + 64}>{trunc(metaLine(nd), 34)}</text>
              {#if n.children.length}
                <g transform="translate({-n.w / 2 + 14} {n.h / 2 - 24})">
                  {#each n.children.slice(0, 3) as k, i (k.id)}
                    <!-- svelte-ignore a11y_click_events_have_key_events a11y_no_static_element_interactions -->
                    <g class="chip" transform="translate({i * 74} 0)" onclick={(ev) => { ev.stopPropagation(); focusOn(k.id); }}>
                      <rect width="68" height="18" rx="9" /><text x="34" y="12.5" text-anchor="middle">{trunc(k.label, 10)}</text>
                    </g>
                  {/each}
                  {#if n.children.length > 3}<text class="more" x={3 * 74 + 2} y="12.5">+{n.children.length - 3}</text>{/if}
                </g>
              {/if}
            {:else}
              <text class="glyph small" x={-n.w / 2 + 14} y="6">{KIND_GLYPH[nd.kind] ?? '•'}</text>
              <text class="kind" x={-n.w / 2 + 36} y={-n.h / 2 + 20}>{nd.kind}</text>
              <text class="label" x={-n.w / 2 + 36} y={-n.h / 2 + 40}>{trunc(nd.label, 20)}</text>
              <text class="meta" x={-n.w / 2 + 36} y={-n.h / 2 + 56}>{trunc(nd.summary, 24)}</text>
            {/if}
          {/if}
          {#if n.node && hud.agentSet.has(n.id)}<circle class="agent-dot" cx={n.w / 2 - 10} cy={-n.h / 2 + 10} r="4" />{/if}
          {#if pending}<circle class="pend" cx={n.w / 2} cy={-n.h / 2} r="7" />{/if}
        </g>
      {/each}
    </svg>
    {#if !layout.edges.length}
      <div class="nolinks">No connections recorded for this node yet.</div>
    {/if}
  {/if}
</div>

<style>
  .stage { position: absolute; inset: 0; overflow: hidden; transition: left .25s;
    background: radial-gradient(ellipse at 50% 45%, color-mix(in srgb, var(--bg-3) 70%, transparent), var(--bg) 70%),
      radial-gradient(circle at 1px 1px, var(--line) 1px, transparent 1px) 0 0 / 28px 28px, var(--bg); }
  svg { width: 100%; height: 100%; display: block; cursor: grab; touch-action: none; user-select: none; }
  svg:active { cursor: grabbing; }
  .empty { position: absolute; inset: 0; display: grid; place-content: center; text-align: center; color: var(--fg-2); }
  .empty .name { font: 600 18px var(--sans); color: var(--fg); margin-bottom: 8px; }
  .nolinks { position: absolute; bottom: 16px; left: 50%; transform: translateX(-50%); font-size: 12px; color: var(--fg-3); }
  .crumbs { position: absolute; top: 10px; left: 12px; z-index: 2; display: flex; align-items: center; gap: 2px; font-size: 12px; }
  .crumb { background: none; border: none; padding: 3px 7px; color: var(--fg-2); font-family: var(--mono); border-radius: 5px; }
  .crumb:hover { color: var(--fg); background: var(--bg-3); }
  .sep { color: var(--fg-3); }
  .crumbs .hint { margin-left: 14px; color: var(--fg-3); font-size: 11px; }

  .container rect { fill: color-mix(in srgb, var(--bg-2) 55%, transparent); stroke: var(--line-2); stroke-dasharray: 6 6; }
  .ctitle { cursor: pointer; }
  .ctitle text { font: 600 11px var(--mono); fill: var(--fg-3); letter-spacing: .12em; }
  .ctitle .hint { letter-spacing: 0; font-weight: 400; opacity: 0; transition: opacity .15s; }
  .ctitle:hover text { fill: var(--fg); }
  .ctitle:hover .hint { opacity: 1; }

  .edge { transition: opacity .2s; }
  .edge.dim { opacity: .12; }
  .wire { fill: none; stroke: var(--bg); stroke-width: 6; opacity: .6; }
  .line { fill: none; stroke: var(--fg-3); stroke-width: 1.6; opacity: .85; }
  .line.dashed { stroke-dasharray: 2 5; }
  .line.flow { stroke-dasharray: 7 9; animation: flow 3.2s linear infinite; }
  .edge.hot .line { stroke: var(--agent); stroke-width: 2.2; opacity: 1; animation-duration: 1.2s; }
  .edge rect { fill: var(--bg-2); stroke: var(--line-2); }
  .edge text { font: 10.5px var(--mono); fill: var(--fg-2); }
  .edge.hot rect { stroke: var(--agent); }
  .edge.hot text { fill: var(--agent); }
  @keyframes flow { to { stroke-dashoffset: -16; } }

  .node { cursor: pointer; transition: transform .5s cubic-bezier(.2,.8,.2,1), opacity .2s; }
  .node.dim { opacity: .3; }
  .node .bg { fill: var(--card); stroke: var(--line-2); stroke-width: 1; transition: stroke .15s, fill .15s; filter: drop-shadow(0 10px 18px rgba(0,0,0,.35)); }
  .node:hover .bg { fill: var(--card-2); stroke: var(--c); }
  .node .bar { fill: var(--c); }
  .node .glyph { font: 22px var(--mono); fill: var(--c); }
  .node .glyph.small { font-size: 16px; }
  .node .kind { font: 10px var(--mono); fill: var(--c); letter-spacing: .05em; }
  .node .label { font: 600 13px var(--sans); fill: var(--fg); }
  .node .label.big { font-size: 15px; }
  .node .meta { font: 11px var(--mono); fill: var(--fg-2); }
  .node .more { font: 10px var(--mono); fill: var(--fg-3); }
  .focal .bg { stroke: var(--c); stroke-width: 1.5; }
  .focal.selected .bg { stroke: var(--fg); }
  .ring { fill: none; stroke: var(--accent); stroke-width: 1.5; opacity: .7; animation: ring 3s ease-out infinite; }
  .chip rect { fill: var(--bg); stroke: var(--line-2); }
  .chip text { font: 10px var(--mono); fill: var(--fg-2); }
  .chip:hover rect { stroke: var(--c); }
  .chip:hover text { fill: var(--fg); }
  .agent-dot { fill: var(--agent); }
  .pend { fill: var(--accent); stroke: var(--bg); stroke-width: 2; }
  .up .bg, .down .bg { fill: color-mix(in srgb, var(--card) 85%, transparent); }
  .more .bg { stroke-dasharray: 4 4; }
  .more .label { fill: var(--fg-3); }
</style>
