<script lang="ts">
  /**
   * /demo — guided "third person" scene.
   * The focal resources stand centre stage on a perspective floor; callers behind, callees in front.
   * Left-drag pans, wheel zooms, right-click a resource to focus it, left-click opens its specifics on the right.
   * The agent is a character at the bottom with a dialogue box.
   */
  import { fade } from 'svelte/transition';
  import { hud } from '../lib/state.svelte.ts';
  import { focusLayout, type FNode } from '../lib/focusLayout.ts';
  import Sprite from '../components/Sprite.svelte';
  import Dialogue from '../components/Dialogue.svelte';
  import Blowout from '../components/Blowout.svelte';
  import Minimap from '../components/Minimap.svelte';
  import type { SysNode } from '../../../schema/src/index.ts';

  let { dialogue = $bindable() }: { dialogue?: Dialogue } = $props();

  const focalIds = $derived(hud.highlighted.size ? [...hud.highlighted] : hud.agentAt?.nodes ?? []);
  const layout = $derived(hud.index ? focusLayout(hud.index, focalIds, { showImports: hud.showImports, maxSide: 6 }) : null);

  interface Placed { n: FNode; x: number; y: number; s: number; node: SysNode | null }
  const ROW = { up: { y: 17, s: 0.6, spread: 64 }, focal: { y: 40, s: 1, spread: 56 }, down: { y: 61, s: 0.72, spread: 60 }, more: { y: 0, s: 0.6, spread: 0 } } as const;
  const placed = $derived.by<Placed[]>(() => {
    if (!layout) return [];
    const rows: Record<string, FNode[]> = { up: [], focal: [], down: [] };
    for (const n of layout.nodes) rows[n.role === 'more' ? (n.y < 0 ? 'up' : 'down') : n.role].push(n);
    const out: Placed[] = [];
    for (const role of ['up', 'focal', 'down'] as const) {
      const list = rows[role];
      const cfg = ROW[role];
      const step = list.length > 1 ? Math.min(cfg.spread / (list.length - 1), 22) : 0;
      list.forEach((n, i) => out.push({ n, node: n.node, x: 50 + (i - (list.length - 1) / 2) * step, y: cfg.y, s: cfg.s }));
    }
    return out;
  });
  const pos = $derived(new Map(placed.map((p) => [p.n.id, p])));
  const lines = $derived((layout?.edges ?? []).map((e) => {
    const a = pos.get(e.from), b = pos.get(e.to);
    if (!a || !b) return null;
    const x1 = a.x * 10, y1 = a.y * 6 + 30 * a.s, x2 = b.x * 10, y2 = b.y * 6 - 30 * b.s;
    const my = (y1 + y2) / 2;
    return { ...e, d: `M${x1},${y1} C${x1},${my} ${x2},${my} ${x2},${y2}`, mx: (x1 + x2) / 2, my };
  }).filter((l): l is NonNullable<typeof l> => !!l));

  let hover = $state<string | null>(null);
  const hot = (id: string) => !!hover && (id === hover || lines.some((l) => (l.from === hover && l.to === id) || (l.to === hover && l.from === id)));
  const layerColor = (n: SysNode | null) => (n ? `var(--layer-${hud.index?.layerOf(n) ?? n.layer}, var(--layer-default))` : 'var(--fg-3)');
  const stateOf = (id: string) => ((hud.pendingByNode.get(id)?.length ?? 0) > 0 ? 'pending' : hud.agentSet.has(id) ? 'active' : hover && !hot(id) ? 'dim' : 'idle');
  const metaLine = (n: SysNode) => {
    const m = n.meta ?? {};
    if (m.method && m.path) return `${m.method} ${m.path}`;
    if (Array.isArray(m.columns)) return `${m.columns.length} columns`;
    if (m.signature) { const sig = String(m.signature); return sig.length > 44 ? sig.slice(0, 43) + '…' : sig; }
    return n.summary ?? '';
  };
  function focusOn(id: string) { hud.highlighted = new Set([id]); hud.selected = null; hud.roam(); }

  // pan / zoom on the world
  let pan = $state({ x: 0, y: 0, z: 1 });
  let stage: HTMLDivElement;
  let drag: { x: number; y: number; px: number; py: number; moved: boolean } | null = null;
  function onWheel(e: WheelEvent) {
    e.preventDefault();
    const f = Math.exp(-e.deltaY * 0.0016);
    const z = Math.min(Math.max(pan.z * f, 0.5), 2.6);
    const r = stage.getBoundingClientRect();
    const cx = e.clientX - r.left - r.width / 2, cy = e.clientY - r.top - r.height / 2;
    const k = z / pan.z;
    pan = { x: cx - (cx - pan.x) * k, y: cy - (cy - pan.y) * k, z };
  }
  function onDown(e: PointerEvent) { if (e.button === 0) drag = { x: e.clientX, y: e.clientY, px: pan.x, py: pan.y, moved: false }; }
  function onMove(e: PointerEvent) {
    if (!drag) return;
    const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
    if (!drag.moved && Math.abs(dx) + Math.abs(dy) > 4) { drag.moved = true; stage.setPointerCapture(e.pointerId); }
    if (drag.moved) pan = { ...pan, x: drag.px + dx, y: drag.py + dy };
  }
  function onUp(e: PointerEvent) {
    if (!drag) return;
    if (stage.hasPointerCapture(e.pointerId)) stage.releasePointerCapture(e.pointerId);
    drag = null;
  }
  let lastKey = '';
  $effect(() => { const k = focalIds.join('|'); if (k !== lastKey) { lastKey = k; pan = { x: 0, y: 0, z: 1 }; } });
  function onClickSprite(e: MouseEvent, id: string) {
    if (drag?.moved) return;
    const r = (e.currentTarget as Element).getBoundingClientRect();
    hud.openBlowout(id, { x: r.left + r.width / 2, y: r.top + r.height / 2 });
  }
</script>

<div class="scene" bind:this={stage} onwheel={onWheel} onpointerdown={onDown} onpointermove={onMove} onpointerup={onUp} onpointercancel={() => (drag = null)} oncontextmenu={(e) => e.preventDefault()} role="application" aria-label="Guided scene">
  <div class="sky"></div>
  <div class="world" style="transform: translate({pan.x}px, {pan.y}px) scale({pan.z})">
    <div class="ground"></div>
    <div class="horizon"></div>

    {#if layout}
      <svg class="links" viewBox="0 0 1000 600" preserveAspectRatio="none">
        {#each lines as l (l.key)}
          <g class="link" class:hot={hover === l.from || hover === l.to} class:dim={!!hover && hover !== l.from && hover !== l.to} transition:fade={{ duration: 200 }}>
            <path d={l.d} class="beam" vector-effect="non-scaling-stroke" />
            <path d={l.d} class="dots" class:flow={l.flow} vector-effect="non-scaling-stroke" />
          </g>
        {/each}
      </svg>
      {#each lines as l (l.key + ':l')}
        <div class="linklabel" class:dim={!!hover && hover !== l.from && hover !== l.to} style="left: {l.mx / 10}%; top: {l.my / 6}%">{l.label}</div>
      {/each}

      {#each placed as p (p.n.id)}
        <!-- svelte-ignore a11y_click_events_have_key_events a11y_no_static_element_interactions a11y_mouse_events_have_key_events -->
        <div
          class="res {p.n.role}"
          style="left: {p.x}%; top: {p.y}%; --s: {p.s}; --c: {layerColor(p.node)}"
          onclick={(e) => p.node && onClickSprite(e, p.n.id)}
          oncontextmenu={(e) => { e.preventDefault(); if (p.node) focusOn(p.n.id); }}
          onmouseenter={() => (hover = p.n.id)}
          onmouseleave={() => (hover = null)}
        >
          {#if p.node}
            <div class="plate" class:pending={stateOf(p.n.id) === 'pending'}>
              <span class="kind">{p.node.kind}</span>
              <span class="label">{p.node.label}</span>
              {#if p.n.role === 'focal' && metaLine(p.node)}<span class="meta">{metaLine(p.node)}</span>{/if}
            </div>
            <div class="shadow"></div>
            <Sprite kind={p.node.kind} size={150} color={stateOf(p.n.id) === 'pending' ? 'var(--accent)' : layerColor(p.node)} state={stateOf(p.n.id)} />
            {#if p.n.children.length}<div class="kids">{p.n.children.length} inside</div>{/if}
            {#if hud.agentSet.has(p.n.id)}<div class="here">agent here</div>{/if}
          {:else}
            <div class="plate"><span class="label">+{p.n.moreCount} more</span></div>
          {/if}
        </div>
      {/each}

      {#if layout.container}
        <div class="zone" transition:fade>{layout.container.parent.label}</div>
      {/if}
    {:else if hud.map}
      <div class="empty"><b>{hud.map.name}</b><br />Waiting for the agent to go somewhere.</div>
    {/if}
  </div>

  <header class="hud-top">
    <span class="brand">code<b>hud</b> <span class="muted">/ {hud.map?.name ?? ''}</span></span>
    <span class="hint">drag · wheel · right-click = focus · click = specifics</span>
    <nav><a href="/assets">assets</a><a href="/">full HUD</a><span class="conn" class:ok={hud.connected}></span></nav>
  </header>

  <div class="mini"><Minimap /></div>
  <Dialogue bind:this={dialogue} />
  <Blowout />
</div>

<style>
  .scene { position: fixed; inset: 0; overflow: hidden; background: var(--bg); cursor: grab; touch-action: none; user-select: none; }
  .scene:active { cursor: grabbing; }
  .sky { position: absolute; inset: 0; background: radial-gradient(ellipse at 50% 30%, color-mix(in srgb, var(--agent) 9%, transparent), transparent 60%), linear-gradient(var(--bg), color-mix(in srgb, var(--bg-3) 60%, var(--bg)) 55%, var(--bg)); }
  .world { position: absolute; inset: 0; transform-origin: 50% 45%; transition: transform .05s linear; }
  .ground { position: absolute; left: -60%; right: -60%; top: 26%; bottom: -40%; transform: perspective(900px) rotateX(64deg); transform-origin: 50% 0;
    background:
      linear-gradient(90deg, color-mix(in srgb, var(--agent) 14%, transparent) 1px, transparent 1px) 0 0 / 80px 80px,
      linear-gradient(0deg, color-mix(in srgb, var(--agent) 14%, transparent) 1px, transparent 1px) 0 0 / 80px 80px;
    mask-image: radial-gradient(ellipse at 50% 20%, #000 20%, transparent 70%); }
  .horizon { position: absolute; left: 0; right: 0; top: 25%; height: 2px; background: linear-gradient(90deg, transparent, color-mix(in srgb, var(--agent) 35%, transparent), transparent); }
  .links { position: absolute; inset: 0; width: 100%; height: 100%; overflow: visible; pointer-events: none; }
  .beam { fill: none; stroke: var(--agent); stroke-width: 6; opacity: .08; }
  .dots { fill: none; stroke: var(--fg-3); stroke-width: 1.6; stroke-dasharray: 3 7; opacity: .7; }
  .dots.flow { animation: flow 4s linear infinite; }
  .link.hot .dots { stroke: var(--agent); opacity: 1; animation-duration: 1.4s; }
  .link.hot .beam { opacity: .25; }
  .link.dim { opacity: .18; }
  .linklabel { position: absolute; transform: translate(-50%, -50%); font: 10.5px var(--mono); color: var(--fg-2); background: color-mix(in srgb, var(--bg-2) 85%, transparent); border: 1px solid var(--line); border-radius: 999px; padding: 1px 8px; pointer-events: none; transition: opacity .2s; }
  .linklabel.dim { opacity: .2; }
  @keyframes flow { to { stroke-dashoffset: -20; } }

  .res { position: absolute; transform: translate(-50%, -50%) scale(var(--s)); display: flex; flex-direction: column; align-items: center; cursor: pointer; transition: left .6s cubic-bezier(.2,.8,.2,1), top .6s cubic-bezier(.2,.8,.2,1), transform .6s cubic-bezier(.2,.8,.2,1); }
  .res:hover { transform: translate(-50%, -50%) scale(calc(var(--s) * 1.06)); }
  .plate { display: flex; flex-direction: column; align-items: center; gap: 1px; margin-bottom: -6px; padding: 4px 12px; border-radius: 8px; background: color-mix(in srgb, var(--bg-2) 80%, transparent); border: 1px solid var(--line); backdrop-filter: blur(6px); white-space: nowrap; }
  .plate.pending { border-color: var(--accent); }
  .plate .kind { font: 10px var(--mono); color: var(--c); letter-spacing: .08em; text-transform: uppercase; }
  .plate .label { font: 600 14px var(--sans); color: var(--fg); }
  .plate .meta { font: 11px var(--mono); color: var(--fg-2); }
  .shadow { position: absolute; bottom: 10px; width: 110px; height: 22px; border-radius: 50%; background: radial-gradient(ellipse, rgba(0,0,0,.55), transparent 70%); z-index: -1; }
  .kids { font: 10.5px var(--mono); color: var(--fg-3); margin-top: -10px; }
  .here { font: 10px var(--mono); color: var(--agent); letter-spacing: .08em; text-transform: uppercase; margin-top: 2px; }
  .zone { position: absolute; left: 50%; top: 40%; transform: translate(-50%, -50%); width: 70%; height: 36%; border: 1px dashed color-mix(in srgb, var(--fg-3) 50%, transparent); border-radius: 50%; pointer-events: none;
    font: 600 11px var(--mono); color: var(--fg-3); letter-spacing: .14em; text-transform: uppercase; text-align: center; line-height: 1; padding-top: 8px; }
  .empty { position: absolute; left: 50%; top: 46%; transform: translate(-50%, -50%); text-align: center; color: var(--fg-2); }

  .hud-top { position: absolute; top: 0; left: 0; right: 0; display: flex; align-items: center; gap: 18px; padding: 10px 16px; font-size: 12px; z-index: 10; pointer-events: none; }
  .hud-top > * { pointer-events: auto; }
  .brand { font: 15px var(--mono); color: var(--fg-2); } .brand b { color: var(--fg); } .muted { color: var(--fg-3); font-size: 12px; }
  .hint { color: var(--fg-3); font-size: 11px; }
  nav { margin-left: auto; display: flex; gap: 14px; align-items: center; }
  nav a { color: var(--fg-2); font-family: var(--mono); } nav a:hover { color: var(--fg); }
  .mini :global(.minimap) { top: 44px; bottom: auto; right: 14px; width: 190px; height: 118px; }
  .conn { width: 8px; height: 8px; border-radius: 50%; background: var(--danger); } .conn.ok { background: var(--ok); }
</style>
