<script lang="ts">
  /**
   * /demo — guided third-person scene on a real 3D floor.
   *   left-drag pan · right-drag orbit · wheel zoom · WASD/arrows steer · Q/E yaw · R/F tilt · 0 reset
   *   click = centre · double-click = specifics · triple-click (or right-click) = focus
   *   Tab/Shift+Tab target · Enter specifics · X focus
   */
  import { fade } from 'svelte/transition';
  import { hud } from '../lib/state.svelte.ts';
  import { focusLayout } from '../lib/focusLayout.ts';
  import { anchorFor } from '../lib/anchor.ts';
  import Sprite from '../components/Sprite.svelte';
  import Dialogue from '../components/Dialogue.svelte';
  import Blowout from '../components/Blowout.svelte';
  import Minimap from '../components/Minimap.svelte';
  import type { SysNode, EdgeKind } from '../../../schema/src/index.ts';

  let { dialogue = $bindable() }: { dialogue?: Dialogue } = $props();

  // ----- layout on the floor plane (px, origin at plane centre) ---------------
  const PLANE_W = 2600, PLANE_H = 1800;
  type Role = 'focal' | 'up' | 'down' | 'more' | 'far' | 'ghost';
  interface Placed { id: string; node: SysNode | null; role: Role; x: number; y: number; s: number; children: SysNode[]; moreCount?: number; via?: string }
  interface Line { key: string; from: string; to: string; label: string; flow: boolean; faint?: boolean; preview?: boolean; d: string; mx: number; my: number }
  const HIDDEN: EdgeKind[] = ['imports', 'depends'];

  const focalIds = $derived(hud.highlighted.size ? [...hud.highlighted] : hud.agentAt?.nodes ?? []);
  const layout = $derived(hud.index ? focusLayout(hud.index, focalIds, { showImports: hud.showImports, maxSide: 6 }) : null);
  const previewIds = $derived.by(() => {
    const q = hud.activeQuestion;
    const o = q?.options && hud.previewOption !== null ? q.options[hud.previewOption] : null;
    return o?.resolvedNodes ?? [];
  });

  const ROW = { up: { y: -480, s: 0.8, step: 280 }, focal: { y: 0, s: 1.15, step: 330 }, down: { y: 330, s: 0.9, step: 300 } } as const;
  const scene = $derived.by<{ placed: Placed[]; lines: Line[] }>(() => {
    const idx = hud.index;
    if (!layout || !idx) return { placed: [], lines: [] };
    const rows: Record<'up' | 'focal' | 'down', Placed[]> = { up: [], focal: [], down: [] };
    for (const n of layout.nodes) {
      const role = n.role === 'more' ? (n.y < 0 ? 'up' : 'down') : n.role;
      rows[role].push({ id: n.id, node: n.node, role: n.role, x: 0, y: 0, s: 1, children: n.children, moreCount: n.moreCount });
    }
    const placed: Placed[] = [];
    for (const role of ['up', 'focal', 'down'] as const) {
      const list = rows[role], cfg = ROW[role];
      list.forEach((p, i) => placed.push({ ...p, x: (i - (list.length - 1) / 2) * cfg.step, y: cfg.y, s: cfg.s }));
    }
    const shown = new Set(placed.map((p) => p.id));
    const lines: Line[] = [];
    const curve = (a: Placed, b: Placed) => {
      const x1 = a.x + PLANE_W / 2, y1 = a.y + PLANE_H / 2, x2 = b.x + PLANE_W / 2, y2 = b.y + PLANE_H / 2, my = (y1 + y2) / 2;
      return { d: `M${x1},${y1} C${x1},${my} ${x2},${my} ${x2},${y2}`, mx: (x1 + x2) / 2 - PLANE_W / 2, my: my - PLANE_H / 2 };
    };
    const byId = () => new Map(placed.map((p) => [p.id, p]));
    let pos = byId();
    for (const e of layout.edges) {
      const a = pos.get(e.from), b = pos.get(e.to);
      if (a && b) lines.push({ key: e.key, from: e.from, to: e.to, label: e.label, flow: e.flow, ...curve(a, b) });
    }

    // one more layer out: neighbours of the first ring, smaller and fainter, beside their parent row
    const focalSet = new Set(focalIds);
    const ring = placed.filter((p) => (p.role === 'up' || p.role === 'down') && p.node);
    const far: Placed[] = [];
    const farSeen = new Set<string>();
    outer: for (const r of ring) {
      let k = 0;
      for (const e of idx.map.edges) {
        if (HIDDEN.includes(e.kind) || k >= 2) continue;
        const other = e.from === r.id ? e.to : e.to === r.id ? e.from : null;
        if (!other || shown.has(other) || farSeen.has(other) || focalSet.has(other)) continue;
        const node = idx.get(other);
        if (!node) continue;
        farSeen.add(other);
        k++;
        far.push({ id: other, node, role: 'far', x: 0, y: 0, s: 0.55, children: idx.childrenOf(other), via: r.id });
        if (far.length >= 8) break outer;
      }
    }
    for (const role of ['up', 'down'] as const) {
      const group = far.filter((f) => pos.get(f.via!)?.role === role);
      const rowItems = placed.filter((p) => p.role === role || (p.role === 'more' && (role === 'up' ? p.y < 0 : p.y > 0)));
      const extent = rowItems.length ? Math.max(...rowItems.map((p) => Math.abs(p.x))) + 300 : 300;
      const y = role === 'up' ? ROW.up.y - 40 : ROW.down.y + 20;
      group.forEach((f, i) => { const side = i % 2 === 0 ? -1 : 1; const k = Math.floor(i / 2); f.x = side * (extent + k * 230); f.y = y; placed.push(f); });
    }
    pos = byId();
    for (const f of far) {
      const a = pos.get(f.via!), b = pos.get(f.id);
      if (!a || !b) continue;
      const e = idx.map.edges.find((e) => !HIDDEN.includes(e.kind) && ((e.from === f.via && e.to === f.id) || (e.to === f.via && e.from === f.id)));
      const from = e?.from === f.id ? b : a, to = from === a ? b : a;
      lines.push({ key: `far:${f.via}>${f.id}`, from: from.id, to: to.id, label: e?.kind ?? '', flow: false, faint: true, ...curve(from, to) });
    }

    // option preview: the nodes an option would touch
    if (previewIds.length) {
      const ghosts = previewIds.filter((id) => !pos.has(id)).map((id) => idx.get(id)).filter((n): n is SysNode => !!n);
      const extent = Math.max(...placed.filter((p) => p.role === 'down').map((p) => Math.abs(p.x)), 0) + 320;
      ghosts.forEach((n, i) => placed.push({ id: n.id, node: n, role: 'ghost', x: (i % 2 === 0 ? 1 : -1) * (extent + Math.floor(i / 2) * 240), y: 150, s: 0.85, children: idx.childrenOf(n.id) }));
      pos = byId();
      const q = hud.activeQuestion;
      const label = q?.options?.[hud.previewOption ?? -1]?.label ?? 'option';
      // one beam per option node, from the nearest focal node that is not the node itself
      previewIds.forEach((pid, i) => {
        const b = pos.get(pid);
        if (!b) return;
        const cands = focalIds.filter((f) => f !== pid).map((f) => pos.get(f)).filter((a): a is Placed => !!a);
        if (!cands.length) return;
        const a = cands.reduce((best, c) => (Math.hypot(c.x - b.x, c.y - b.y) < Math.hypot(best.x - b.x, best.y - b.y) ? c : best));
        lines.push({ key: `pv:${a.id}>${pid}`, from: a.id, to: pid, label: i === 0 ? label : '', flow: true, preview: true, ...curve(a, b) });
      });
    }
    return { placed, lines };
  });
  const placed = $derived(scene.placed);
  const lines = $derived(scene.lines);
  const previewSet = $derived(new Set(previewIds));

  // ----- camera ------------------------------------------------------------------
  const CAM0 = { x: 0, y: 70, z: 1, tilt: 52, yaw: 0 };
  let cam = $state({ ...CAM0 });
  let stage: HTMLDivElement;
  let drag: { btn: number; x: number; y: number; c: typeof cam; moved: boolean } | null = null;
  function onWheel(e: WheelEvent) {
    e.preventDefault();
    cam = { ...cam, z: Math.min(Math.max(cam.z * Math.exp(-e.deltaY * 0.0016), 0.45), 2.8) };
  }
  function onDown(e: PointerEvent) { if (e.button === 0 || e.button === 2) drag = { btn: e.button, x: e.clientX, y: e.clientY, c: { ...cam }, moved: false }; }
  function onMove(e: PointerEvent) {
    if (!drag) return;
    const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
    if (!drag.moved && Math.abs(dx) + Math.abs(dy) > 4) { drag.moved = true; stage.setPointerCapture(e.pointerId); }
    if (!drag.moved) return;
    if (drag.btn === 0) cam = { ...cam, x: drag.c.x + dx, y: drag.c.y + dy };
    else cam = { ...cam, yaw: drag.c.yaw + dx * 0.3, tilt: Math.min(80, Math.max(15, drag.c.tilt - dy * 0.25)) };
  }
  function onUp(e: PointerEvent) {
    if (!drag) return;
    if (stage.hasPointerCapture(e.pointerId)) stage.releasePointerCapture(e.pointerId);
    const moved = drag.moved;
    drag = null;
    if (moved) { suppressClick = true; setTimeout(() => (suppressClick = false), 50); }
  }
  let suppressClick = false;
  let lastKey = '';
  $effect(() => { const k = focalIds.join('|'); if (k !== lastKey) { lastKey = k; cam = { ...cam, x: 0, y: 70 }; } });

  // ----- clicks: 1 = centre, 2 = specifics, 3 = focus --------------------------------
  let clickTimer: ReturnType<typeof setTimeout> | undefined;
  function onClick(e: MouseEvent, p: Placed) {
    if (suppressClick || !p.node) return;
    clearTimeout(clickTimer);
    const el = e.currentTarget as Element, id = p.id, n = e.detail;
    if (n >= 3) { focusOn(id); return; }
    clickTimer = setTimeout(() => { if (n === 2) openFrom(el, id); else centerOn(el); }, 240);
  }
  function centerOn(el: Element) {
    const r = el.getBoundingClientRect(), s = stage.getBoundingClientRect();
    cam = { ...cam, x: cam.x + (s.left + s.width / 2 - (r.left + r.width / 2)), y: cam.y + (s.top + s.height * 0.4 - (r.top + r.height / 2)) };
  }
  function openFrom(el: Element | null, id: string) {
    const r = el?.getBoundingClientRect();
    hud.openBlowout(id, r ? { x: r.left + r.width / 2, y: r.top + r.height / 2 } : null);
  }
  function focusOn(id: string) { hud.highlighted = new Set([id]); hud.selected = null; target = null; hud.previewOption = null; hud.roam(); }

  // ----- targeting / steering ---------------------------------------------------
  let target = $state<string | null>(null);
  let hover = $state<string | null>(null);
  export function steer(key: string, shift = false): boolean {
    const step = 60;
    switch (key) {
      case 'w': case 'ArrowUp': cam = { ...cam, y: cam.y + step }; return true;
      case 's': case 'ArrowDown': cam = { ...cam, y: cam.y - step }; return true;
      case 'a': case 'ArrowLeft': cam = { ...cam, x: cam.x + step }; return true;
      case 'd': case 'ArrowRight': cam = { ...cam, x: cam.x - step }; return true;
      case 'q': cam = { ...cam, yaw: cam.yaw - 8 }; return true;
      case 'e': cam = { ...cam, yaw: cam.yaw + 8 }; return true;
      case 'r': cam = { ...cam, tilt: Math.max(15, cam.tilt - 5) }; return true;
      case 'f': cam = { ...cam, tilt: Math.min(80, cam.tilt + 5) }; return true;
      case '0': cam = { ...CAM0 }; return true;
      case 'Tab': {
        const ids = placed.filter((p) => p.node).map((p) => p.id);
        if (!ids.length) return true;
        const i = target ? ids.indexOf(target) : -1;
        target = ids[(i + (shift ? -1 : 1) + ids.length) % ids.length];
        const el = stage.querySelector(`[data-id="${CSS.escape(target)}"]`);
        if (el) centerOn(el);
        return true;
      }
      case 'Enter': if (target) openFrom(stage.querySelector(`[data-id="${CSS.escape(target)}"]`), target); return true;
      case 'x': case ' ': if (target) focusOn(target); return true;
    }
    return false;
  }

  const hot = (id: string) => !!hover && (id === hover || lines.some((l) => (l.from === hover && l.to === id) || (l.to === hover && l.from === id)));
  const layerColor = (n: SysNode | null) => (n ? `var(--layer-${hud.index?.layerOf(n) ?? n.layer}, var(--layer-default))` : 'var(--fg-3)');
  const stateOf = (id: string) => (previewSet.has(id) ? 'pending' : previewSet.size ? 'dim' : (hud.pendingByNode.get(id)?.length ?? 0) > 0 ? 'pending' : hud.agentSet.has(id) ? 'active' : hover && !hot(id) ? 'dim' : 'idle');
  const metaLine = (n: SysNode) => {
    const m = n.meta ?? {};
    if (m.method && m.path) return `${m.method} ${m.path}`;
    if (Array.isArray(m.columns)) return `${m.columns.length} columns`;
    if (m.signature) { const sig = String(m.signature); return sig.length > 44 ? sig.slice(0, 43) + '…' : sig; }
    return n.summary ?? '';
  };
  const billboard = $derived(`rotateZ(${-cam.yaw}deg) rotateX(${-cam.tilt}deg)`);

  let vw = $state(window.innerWidth), vh = $state(window.innerHeight);
  const anchor = $derived(anchorFor(hud.blowoutFrom, vw, vh));
</script>

<svelte:window onresize={() => { vw = window.innerWidth; vh = window.innerHeight; }} />

<div class="scene" bind:this={stage} onwheel={onWheel} onpointerdown={onDown} onpointermove={onMove} onpointerup={onUp} onpointercancel={() => (drag = null)} oncontextmenu={(e) => e.preventDefault()} role="application" aria-label="Guided scene">
  <div class="sky"></div>
  <div class="camera" style="transform: translate({cam.x}px, {cam.y}px) scale({cam.z})">
    <div class="plane" style="width: {PLANE_W}px; height: {PLANE_H}px; margin-left: {-PLANE_W / 2}px; margin-top: {-PLANE_H / 2}px; transform: rotateX({cam.tilt}deg) rotateZ({cam.yaw}deg)">
      <div class="grid"></div>
      {#if layout}
        <svg class="links" viewBox="0 0 {PLANE_W} {PLANE_H}" width={PLANE_W} height={PLANE_H}>
          {#each lines as l (l.key)}
            <g class="link" class:hot={hover === l.from || hover === l.to} class:dim={(!!hover && hover !== l.from && hover !== l.to) || (previewSet.size > 0 && !l.preview)} class:faint={l.faint} class:preview={l.preview} transition:fade={{ duration: 200 }}>
              <path d={l.d} class="beam" /><path d={l.d} class="dots" class:flow={l.flow} />
            </g>
          {/each}
        </svg>
        {#if layout.container}
          <div class="zone" transition:fade><span style="transform: {billboard}">{layout.container.parent.label}</span></div>
        {/if}
        {#each lines as l (l.key + ':l')}
          {#if l.label}
            <div class="linklabel" class:dim={(!!hover && hover !== l.from && hover !== l.to) || (previewSet.size > 0 && !l.preview)} class:preview={l.preview} class:faint={l.faint} style="left: {PLANE_W / 2 + l.mx}px; top: {PLANE_H / 2 + l.my}px; transform: translate(-50%, -50%) {billboard}">{l.label}</div>
          {/if}
        {/each}

        {#each placed as p (p.id)}
          <div class="shadow" style="left: {PLANE_W / 2 + p.x}px; top: {PLANE_H / 2 + p.y}px; --s: {p.s}"></div>
          <!-- svelte-ignore a11y_click_events_have_key_events a11y_no_static_element_interactions a11y_mouse_events_have_key_events -->
          <div
            class="res {p.role}"
            class:targeted={target === p.id}
            class:previewed={previewSet.has(p.id)}
            data-id={p.id}
            style="left: {PLANE_W / 2 + p.x}px; top: {PLANE_H / 2 + p.y}px; transform: translate(-50%, -100%) {billboard} scale({p.s}); --c: {layerColor(p.node)}"
            onclick={(e) => onClick(e, p)}
            oncontextmenu={(e) => { e.preventDefault(); if (!suppressClick && p.node) focusOn(p.id); }}
            onmouseenter={() => (hover = p.id)}
            onmouseleave={() => (hover = null)}
          >
            {#if p.node}
              <div class="plate" class:pending={stateOf(p.id) === 'pending'}>
                <span class="kind">{p.node.kind}</span>
                <span class="label">{p.node.label}</span>
                {#if p.role === 'focal' && metaLine(p.node)}<span class="meta">{metaLine(p.node)}</span>{/if}
              </div>
              <Sprite kind={p.node.kind} size={136} color={stateOf(p.id) === 'pending' ? 'var(--accent)' : layerColor(p.node)} state={stateOf(p.id)} />
              {#if p.children.length}<div class="kids">{p.children.length} inside</div>{/if}
              {#if hud.agentSet.has(p.id)}<div class="here">agent here</div>{/if}
              {#if previewSet.has(p.id)}<div class="would">would touch</div>{/if}
              {#if target === p.id}<div class="reticle"></div>{/if}
            {:else}
              <div class="plate"><span class="label">+{p.moreCount} more</span></div>
            {/if}
          </div>
        {/each}
      {:else if hud.map}
        <div class="empty" style="transform: translate(-50%, -50%) {billboard}"><b>{hud.map.name}</b><br />Waiting for the agent to go somewhere.</div>
      {/if}
    </div>
  </div>

  {#if hud.selected && hud.blowoutFrom}
    <svg class="callout" transition:fade={{ duration: 200 }}>
      <line x1={hud.blowoutFrom.x} y1={hud.blowoutFrom.y} x2={anchor.side === 'right' ? anchor.left : anchor.left + 400} y2={anchor.top + 150} />
      <circle cx={hud.blowoutFrom.x} cy={hud.blowoutFrom.y} r="5" />
    </svg>
  {/if}

  <header class="hud-top">
    <span class="brand">code<b>hud</b> <span class="muted">/ {hud.map?.name ?? ''}</span></span>
    <span class="hint">click centre · double-click specifics · triple/right-click focus · WASD steer · right-drag orbit · wheel zoom · Tab target · 0 reset</span>
    <nav><a href="/assets">assets</a><a href="/">full HUD</a><span class="conn" class:ok={hud.connected}></span></nav>
  </header>

  <div class="mini"><Minimap /></div>
  <Dialogue bind:this={dialogue} />
  <Blowout />
</div>

<style>
  .scene { position: fixed; inset: 0; overflow: hidden; background: var(--bg); cursor: grab; touch-action: none; user-select: none; perspective: 1100px; perspective-origin: 50% 30%; }
  .scene:active { cursor: grabbing; }
  .sky { position: absolute; inset: 0; background: radial-gradient(ellipse at 50% 28%, color-mix(in srgb, var(--agent) 10%, transparent), transparent 60%), linear-gradient(var(--bg), color-mix(in srgb, var(--bg-3) 60%, var(--bg)) 50%, var(--bg)); }
  .camera { position: absolute; left: 50%; top: 36%; width: 0; height: 0; transform-style: preserve-3d; transition: transform .28s cubic-bezier(.2,.8,.2,1); }
  .plane { position: absolute; left: 0; top: 0; transform-style: preserve-3d; transform-origin: 50% 50%; transition: transform .25s ease-out; }
  .grid { position: absolute; inset: 0; transform: translateZ(-1px);
    background:
      linear-gradient(90deg, color-mix(in srgb, var(--agent) 16%, transparent) 1px, transparent 1px) 0 0 / 100px 100px,
      linear-gradient(0deg, color-mix(in srgb, var(--agent) 16%, transparent) 1px, transparent 1px) 0 0 / 100px 100px,
      radial-gradient(ellipse at 50% 50%, color-mix(in srgb, var(--agent) 10%, transparent), transparent 60%);
    mask-image: radial-gradient(ellipse at 50% 50%, #000 30%, transparent 72%); }
  .links { position: absolute; left: 0; top: 0; overflow: visible; pointer-events: none; }
  .beam { fill: none; stroke: var(--agent); stroke-width: 14; opacity: .07; }
  .dots { fill: none; stroke: var(--fg-3); stroke-width: 2.5; stroke-dasharray: 5 11; opacity: .8; }
  .dots.flow { animation: flow 4s linear infinite; }
  .link.hot .dots { stroke: var(--agent); opacity: 1; animation-duration: 1.4s; }
  .link.hot .beam { opacity: .22; }
  .link.dim { opacity: .15; }
  .link.faint { opacity: .4; }
  .link.faint .dots { stroke-width: 1.8; }
  .link.preview .dots { stroke: var(--accent); opacity: 1; animation-duration: 1.6s; }
  .link.preview .beam { stroke: var(--accent); opacity: .18; }
  .linklabel { position: absolute; transform-origin: 50% 50%; font: 11px var(--mono); color: var(--fg-2); background: color-mix(in srgb, var(--bg-2) 85%, transparent); border: 1px solid var(--line); border-radius: 999px; padding: 1px 8px; pointer-events: none; transition: opacity .2s; white-space: nowrap; }
  .linklabel.dim { opacity: .15; }
  .linklabel.faint { opacity: .5; font-size: 10px; }
  .linklabel.preview { color: var(--accent); border-color: var(--accent); opacity: 1; }
  @keyframes flow { to { stroke-dashoffset: -32; } }

  .shadow { position: absolute; width: calc(150px * var(--s)); height: calc(44px * var(--s)); transform: translate(-50%, -50%); border-radius: 50%; background: radial-gradient(ellipse, rgba(0,0,0,.6), transparent 70%); pointer-events: none; }
  .res { position: absolute; transform-origin: 50% 100%; display: flex; flex-direction: column; align-items: center; cursor: pointer; transition: left .6s cubic-bezier(.2,.8,.2,1), top .6s cubic-bezier(.2,.8,.2,1), transform .25s ease-out, opacity .3s; }
  .res.up, .res.down { opacity: .88; }
  .res.far { opacity: .45; }
  .res.far:hover { opacity: .9; }
  .res.ghost { opacity: .9; }
  .res.ghost .plate { border-style: dashed; }
  .plate { display: flex; flex-direction: column; align-items: center; gap: 1px; margin-bottom: -4px; padding: 4px 12px; border-radius: 8px; background: color-mix(in srgb, var(--bg-2) 82%, transparent); border: 1px solid var(--line); white-space: nowrap; }
  .plate.pending { border-color: var(--accent); }
  .plate .kind { font: 10px var(--mono); color: var(--c); letter-spacing: .08em; text-transform: uppercase; }
  .plate .label { font: 600 14px var(--sans); color: var(--fg); }
  .plate .meta { font: 11px var(--mono); color: var(--fg-2); }
  .kids { font: 10.5px var(--mono); color: var(--fg-3); margin-top: -8px; }
  .here { font: 10px var(--mono); color: var(--agent); letter-spacing: .08em; text-transform: uppercase; }
  .would { font: 10px var(--mono); color: var(--accent); letter-spacing: .08em; text-transform: uppercase; }
  .reticle { position: absolute; inset: -10px -14px; border: 1.5px solid var(--agent); border-radius: 14px; pointer-events: none; animation: reticle 1.6s ease-in-out infinite; }
  @keyframes reticle { 0%, 100% { opacity: .5; } 50% { opacity: 1; } }
  .zone { position: absolute; left: 50%; top: 50%; width: 1150px; height: 460px; transform: translate(-50%, -50%); border: 1.5px dashed color-mix(in srgb, var(--fg-3) 50%, transparent); border-radius: 50%; pointer-events: none; }
  .zone span { position: absolute; left: 50%; top: 14px; display: inline-block; transform-origin: 50% 100%; font: 600 11px var(--mono); color: var(--fg-3); letter-spacing: .14em; text-transform: uppercase; margin-left: -60px; }
  .empty { position: absolute; left: 50%; top: 50%; text-align: center; color: var(--fg-2); width: 320px; transform-origin: 50% 50%; }

  .callout { position: fixed; inset: 0; width: 100%; height: 100%; pointer-events: none; z-index: 29; }
  .callout line { stroke: var(--agent); stroke-width: 1.5; stroke-dasharray: 1400; animation: draw .35s ease-out forwards; }
  .callout circle { fill: var(--agent); }
  @keyframes draw { from { stroke-dashoffset: 1400; } to { stroke-dashoffset: 0; } }

  .hud-top { position: absolute; top: 0; left: 0; right: 0; display: flex; align-items: center; gap: 18px; padding: 10px 16px; font-size: 12px; z-index: 10; pointer-events: none; }
  .hud-top > * { pointer-events: auto; }
  .brand { font: 15px var(--mono); color: var(--fg-2); } .brand b { color: var(--fg); } .muted { color: var(--fg-3); font-size: 12px; }
  .hint { color: var(--fg-3); font-size: 11px; }
  nav { margin-left: auto; display: flex; gap: 14px; align-items: center; }
  nav a { color: var(--fg-2); font-family: var(--mono); } nav a:hover { color: var(--fg); }
  .mini :global(.minimap) { top: 44px; bottom: auto; right: 14px; width: 190px; height: 118px; }
  .conn { width: 8px; height: 8px; border-radius: 50%; background: var(--danger); } .conn.ok { background: var(--ok); }
</style>
