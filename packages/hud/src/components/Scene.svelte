<script lang="ts">
  /**
   * 3D floor scene. Two modes:
   *   play  — the relevant slice around the agent / question (focal, callers behind, callees in front, a faint second ring)
   *   map   — the whole current level laid out as layer rows × lane columns (same layout as the grid explorer)
   * left-drag pan · right-drag orbit · wheel zoom · WASD/arrows steer · Q/E yaw · R/F tilt · 0 reset
   * click = centre · double-click = specifics · triple/right-click = focus (play) or open (map)
   */
  import { fade } from 'svelte/transition';
  import { untrack } from 'svelte';
  import { hud } from '../lib/state.svelte.ts';
  import { focusLayout } from '../lib/focusLayout.ts';
  import { computeLayout, EDGE_STYLE, KIND_GLYPH } from '../lib/layout.ts';
  import { outsideStubs, type Stub } from '../lib/stubs.ts';
  import { anchorFor } from '../lib/anchor.ts';
  import Sprite from './Sprite.svelte';
  import type { SysNode, EdgeKind } from '../../../schema/src/index.ts';

  let { mode = 'play' as 'play' | 'map' } = $props();

  const PLANE_W = 3200, PLANE_H = 2200;
  type Role = 'focal' | 'up' | 'down' | 'more' | 'far' | 'ghost' | 'node';
  interface Placed { id: string; node: SysNode | null; role: Role; x: number; y: number; s: number; children: SysNode[]; moreCount?: number; via?: string }
  interface Line { key: string; from: string; to: string; label: string; flow: boolean; faint?: boolean; preview?: boolean; d: string; mx: number; my: number }
  interface Band { label: string; color: string; y0: number; y1: number }
  interface Col { label: string; x: number }
  interface PlacedStub { stub: Stub; x: number; y: number }
  const HIDDEN: EdgeKind[] = ['imports', 'depends'];
  const EMPTY = { placed: [] as Placed[], lines: [] as Line[], bands: [] as Band[], cols: [] as Col[], stubs: [] as PlacedStub[], zone: null as SysNode | null, width: 1200 };
  const FLOW: EdgeKind[] = ['calls', 'writes', 'emits', 'navigates'];

  const focalIds = $derived(hud.highlighted.size ? [...hud.highlighted] : hud.agentAt?.nodes ?? []);
  const previewIds = $derived.by(() => {
    const q = hud.activeQuestion;
    const o = q?.options && hud.previewOption !== null ? q.options[hud.previewOption] : null;
    return o?.resolvedNodes ?? [];
  });
  const previewSet = $derived(new Set(previewIds));

  const curve = (a: Placed, b: Placed) => {
    const x1 = a.x + PLANE_W / 2, y1 = a.y + PLANE_H / 2, x2 = b.x + PLANE_W / 2, y2 = b.y + PLANE_H / 2, my = (y1 + y2) / 2;
    return { d: `M${x1},${y1} C${x1},${my} ${x2},${my} ${x2},${y2}`, mx: (x1 + x2) / 2 - PLANE_W / 2, my: my - PLANE_H / 2 };
  };

  // ----- play layout --------------------------------------------------------------
  const ROW = { up: { y: -480, s: 0.8, step: 280 }, focal: { y: 0, s: 1.15, step: 330 }, down: { y: 330, s: 0.9, step: 300 } } as const;
  function playScene(): typeof EMPTY {
    const idx = hud.index!;
    const layout = focusLayout(idx, focalIds, { showImports: hud.showImports, maxSide: 6 });
    if (!layout) return EMPTY;
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
    const byId = () => new Map(placed.map((p) => [p.id, p]));
    let pos = byId();
    for (const e of layout.edges) {
      const a = pos.get(e.from), b = pos.get(e.to);
      if (a && b) lines.push({ key: e.key, from: e.from, to: e.to, label: e.label, flow: e.flow, ...curve(a, b) });
    }
    // second ring
    const focalSet = new Set(focalIds);
    const far: Placed[] = [];
    const farSeen = new Set<string>();
    outer: for (const r of placed.filter((p) => (p.role === 'up' || p.role === 'down') && p.node)) {
      let k = 0;
      for (const e of idx.map.edges) {
        if (HIDDEN.includes(e.kind) || k >= 2) continue;
        const other = e.from === r.id ? e.to : e.to === r.id ? e.from : null;
        if (!other || shown.has(other) || farSeen.has(other) || focalSet.has(other)) continue;
        const node = idx.get(other);
        if (!node) continue;
        farSeen.add(other); k++;
        far.push({ id: other, node, role: 'far', x: 0, y: 0, s: 0.55, children: idx.childrenOf(other), via: r.id });
        if (far.length >= 8) break outer;
      }
    }
    for (const role of ['up', 'down'] as const) {
      const group = far.filter((f) => pos.get(f.via!)?.role === role);
      const rowItems = placed.filter((p) => p.role === role || (p.role === 'more' && (role === 'up' ? p.y < 0 : p.y > 0)));
      const extent = rowItems.length ? Math.max(...rowItems.map((p) => Math.abs(p.x))) + 300 : 300;
      const y = role === 'up' ? ROW.up.y - 40 : ROW.down.y + 20;
      group.forEach((f, i) => { f.x = (i % 2 === 0 ? -1 : 1) * (extent + Math.floor(i / 2) * 230); f.y = y; placed.push(f); });
    }
    pos = byId();
    for (const f of far) {
      const a = pos.get(f.via!), b = pos.get(f.id);
      if (!a || !b) continue;
      const e = idx.map.edges.find((e) => !HIDDEN.includes(e.kind) && ((e.from === f.via && e.to === f.id) || (e.to === f.via && e.from === f.id)));
      const from = e?.from === f.id ? b : a, to = from === a ? b : a;
      lines.push({ key: `far:${f.via}>${f.id}`, from: from.id, to: to.id, label: e?.kind ?? '', flow: false, faint: true, ...curve(from, to) });
    }
    // option preview
    if (previewIds.length) {
      const ghosts = previewIds.filter((id) => !pos.has(id)).map((id) => idx.get(id)).filter((n): n is SysNode => !!n);
      const extent = Math.max(...placed.filter((p) => p.role === 'down').map((p) => Math.abs(p.x)), 0) + 320;
      ghosts.forEach((n, i) => placed.push({ id: n.id, node: n, role: 'ghost', x: (i % 2 === 0 ? 1 : -1) * (extent + Math.floor(i / 2) * 240), y: 150, s: 0.85, children: idx.childrenOf(n.id) }));
      pos = byId();
      const label = hud.activeQuestion?.options?.[hud.previewOption ?? -1]?.label ?? 'option';
      previewIds.forEach((pid, i) => {
        const b = pos.get(pid);
        if (!b) return;
        const cands = focalIds.filter((f) => f !== pid).map((f) => pos.get(f)).filter((a): a is Placed => !!a);
        if (!cands.length) return;
        const a = cands.reduce((best, c) => (Math.hypot(c.x - b.x, c.y - b.y) < Math.hypot(best.x - b.x, best.y - b.y) ? c : best));
        lines.push({ key: `pv:${a.id}>${pid}`, from: a.id, to: pid, label: i === 0 ? label : '', flow: true, preview: true, ...curve(a, b) });
      });
    }
    return { placed, lines, bands: [], cols: [], stubs: [], zone: layout.container?.parent ?? null, width: 1400 };
  }

  // ----- map layout: the grid explorer's layout, on the floor -----------------------
  const K = 1.3;
  function mapScene(): typeof EMPTY {
    const idx = hud.index!;
    const layout = computeLayout(idx, hud.visible, { showImports: hud.showImports });
    const ox = layout.width / 2, oy = layout.height / 2;
    const toPlane = (x: number, y: number) => ({ x: (x - ox) * K, y: (y - oy) * K });
    const placed: Placed[] = layout.cards.map((c) => ({ id: c.id, node: c.node, role: 'node' as Role, x: (c.x + c.w / 2 - ox) * K, y: (c.y + c.h / 2 - oy) * K, s: 1, children: idx.childrenOf(c.id) }));
    const pos = new Map(placed.map((p) => [p.id, p]));
    const lines: Line[] = [];
    for (const e of layout.edges) {
      const a = pos.get(e.from), b = pos.get(e.to);
      if (!a || !b) continue;
      const label = e.count > 1 ? `${EDGE_STYLE[e.kind]?.label ?? e.kind} ×${e.count}` : e.labels[0] ?? (EDGE_STYLE[e.kind]?.label ?? e.kind);
      lines.push({ key: e.key, from: e.from, to: e.to, label, flow: FLOW.includes(e.kind), ...curve(a, b) });
    }
    const bands: Band[] = layout.bands.map((b) => ({ label: b.layer.label, color: hud.layerColor(b.layer.id), y0: (b.y - oy) * K, y1: (b.y + b.h - oy) * K }));
    const cols: Col[] = layout.columns.map((c) => ({ label: c.lane?.label ?? 'Shared', x: (c.x + c.w / 2 - ox) * K }));
    // edges that leave this level: stubs just outside the bands, beams to the cards they touch
    const stubs: PlacedStub[] = outsideStubs(idx, hud.current?.id ?? null, layout, { showImports: hud.showImports }).map((s) => {
      const p = toPlane(s.x, s.y);
      const off = s.side === 'top' ? { x: 0, y: -90 } : s.side === 'bottom' ? { x: 0, y: 60 } : s.side === 'left' ? { x: -120, y: 0 } : { x: 60, y: 0 };
      return { stub: s, x: p.x + off.x, y: p.y + off.y };
    });
    for (const ps of stubs) {
      const a: Placed = { id: 'stub:' + ps.stub.id, node: null, role: 'node', x: ps.x, y: ps.y, s: 1, children: [] };
      for (const rep of ps.stub.insideReps) {
        const b = pos.get(rep);
        if (!b) continue;
        const from = ps.stub.out && !ps.stub.inn ? b : a, to = from === a ? b : a;
        lines.push({ key: `stub:${ps.stub.id}>${rep}`, from: from.id, to: to.id, label: '', flow: false, faint: true, ...curve(from, to) });
      }
    }
    return { placed, lines, bands, cols, stubs, zone: null, width: layout.width * K };
  }

  const scene = $derived.by(() => (!hud.index ? EMPTY : mode === 'map' ? mapScene() : playScene()));
  /** map mode re-mounts the sprites per level so they fade in after the camera has moved (staged zoom) */
  const levelKey = $derived(mode === 'map' ? 'map:' + hud.focusPath.join('/') : 'play');
  const placed = $derived(scene.placed);
  const lines = $derived(scene.lines);
  const leftEdge = $derived(Math.min(...placed.map((p) => p.x), -scene.width / 2));

  // ----- camera ------------------------------------------------------------------
  const CAM0 = { x: 0, y: 70, z: 1, tilt: 52, yaw: 0 };
  let cam = $state({ ...CAM0 });
  let stage: HTMLDivElement;
  let size = $state({ w: 1200, h: 800 });
  let drag: { btn: number; x: number; y: number; c: typeof cam; moved: boolean } | null = null;
  function onWheel(e: WheelEvent) {
    e.preventDefault();
    cam = { ...cam, z: Math.min(Math.max(cam.z * Math.exp(-e.deltaY * 0.0016), 0.3), 2.8) };
  }
  function onDown(e: PointerEvent) { if (e.button === 0 || e.button === 2) drag = { btn: e.button, x: e.clientX, y: e.clientY, c: { ...cam }, moved: false }; }
  function onMove(e: PointerEvent) {
    if (!drag) return;
    const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
    if (!drag.moved && Math.abs(dx) + Math.abs(dy) > 4) { drag.moved = true; stage.setPointerCapture(e.pointerId); }
    if (!drag.moved) return;
    if (drag.btn === 0) cam = { ...cam, x: drag.c.x + dx, y: drag.c.y + dy };
    else cam = { ...cam, yaw: drag.c.yaw + dx * 0.3, tilt: Math.min(80, Math.max(15, drag.c.tilt - dy * 0.25)) };
    hud.roam();
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
  $effect(() => {
    const k = mode + ':' + (mode === 'map' ? hud.visible.map((n) => n.id).join('|') : focalIds.join('|'));
    const w = scene.width, s = size;
    if (k !== lastKey) {
      lastKey = k;
      const z = mode === 'map' ? Math.min(1, (s.w * 0.9) / Math.max(w, 1)) : 1;
      untrack(() => (cam = { ...cam, x: 0, y: mode === 'map' ? 40 : 70, z }));
    }
  });
  $effect(() => {
    const ro = new ResizeObserver(() => { const r = stage.getBoundingClientRect(); if (r.width && r.height) size = { w: r.width, h: r.height }; });
    ro.observe(stage);
    return () => ro.disconnect();
  });

  // ----- clicks: 1 = centre, 2 = specifics, 3 = focus/open ------------------------
  let clickTimer: ReturnType<typeof setTimeout> | undefined;
  function onClick(e: MouseEvent, p: Placed) {
    if (suppressClick || !p.node) return;
    clearTimeout(clickTimer);
    const el = e.currentTarget as Element, id = p.id, n = e.detail;
    if (n >= 3) { activate(id); return; }
    clickTimer = setTimeout(() => { if (n === 2) openFrom(el, id); else centerOn(el); }, 240);
  }
  function centerOn(el: Element) {
    const r = el.getBoundingClientRect(), s = stage.getBoundingClientRect();
    cam = { ...cam, x: cam.x + (s.left + s.width / 2 - (r.left + r.width / 2)), y: cam.y + (s.top + s.height * 0.4 - (r.top + r.height / 2)) };
    hud.roam();
  }
  function openFrom(el: Element | null, id: string) {
    const r = el?.getBoundingClientRect();
    hud.openBlowout(id, r ? { x: r.left + r.width / 2, y: r.top + r.height / 2 } : null);
  }
  /** Triple / right click: in play mode focus the node; in map mode open its children (or focus it if it has none). */
  function activate(id: string) {
    hud.selected = null; target = null; hud.previewOption = null;
    if (mode === 'map') { if (hud.index?.hasChildren(id)) hud.descend(id); else { hud.highlighted = new Set([id]); hud.view = 'play'; } }
    else { hud.highlighted = new Set([id]); hud.roam(); }
  }

  // ----- targeting / steering ---------------------------------------------------
  let target = $state<string | null>(null);
  let hover = $state<string | null>(null);
  export function steer(key: string, shift = false): boolean {
    const step = 60;
    switch (key) {
      case 'w': cam = { ...cam, y: cam.y + step }; return true;
      case 's': cam = { ...cam, y: cam.y - step }; return true;
      case 'a': cam = { ...cam, x: cam.x + step }; return true;
      case 'd': cam = { ...cam, x: cam.x - step }; return true;
      case 'q': cam = { ...cam, yaw: cam.yaw - 8 }; return true;
      case 'e': cam = { ...cam, yaw: cam.yaw + 8 }; return true;
      case 'r': cam = { ...cam, tilt: Math.max(15, cam.tilt - 5) }; return true;
      case 'f': cam = { ...cam, tilt: Math.min(80, cam.tilt + 5) }; return true;
      case '0': lastKey = ''; return true;
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
      case 'x': case ' ': if (target) activate(target); return true;
    }
    return false;
  }

  const hot = (id: string) => !!hover && (id === hover || lines.some((l) => (l.from === hover && l.to === id) || (l.to === hover && l.from === id)));
  const layerColor = (n: SysNode | null) => hud.nodeColor(n);
  function stubTip(e: MouseEvent, s: Stub) {
    const dir = s.out && s.inn ? '↔' : s.out ? '→' : '←';
    hud.showTip({ x: e.clientX, y: e.clientY, title: `${dir} ${s.label} · ${s.count} edge${s.count === 1 ? '' : 's'} (${s.kinds.join(', ')})`, lines: s.targets.map((t) => `${KIND_GLYPH[t.kind] ?? '•'} ${t.label}`), accent: hud.layerColor(s.layer) });
  }
  function whyTip(e: MouseEvent, id: string) {
    const d = hud.latestDecision(id);
    if (!d) return;
    const chosen = d.options?.find((o) => o.id === d.answer?.optionId)?.label ?? d.answer?.text ?? '';
    const n = hud.decisionsByNode.get(id)?.length ?? 0;
    hud.showTip({ x: e.clientX, y: e.clientY, title: 'Why is this here?', lines: [d.question, `✓ ${chosen}`, ...(n > 1 ? [`+${n - 1} earlier decision${n > 2 ? 's' : ''} · press h`] : [])], accent: 'var(--ok)' });
  }
  const stubLabel = (s: Stub) => `${s.out && s.inn ? '↔' : s.out ? '→' : '←'} ${s.label.length > 16 ? s.label.slice(0, 15) + '…' : s.label}${s.count > 1 ? ` ×${s.count}` : ''}`;
  const stateOf = (id: string) => (previewSet.has(id) ? 'pending' : previewSet.size ? 'dim' : (hud.pendingByNode.get(id)?.length ?? 0) > 0 ? 'pending' : hud.agentSet.has(id) ? 'active' : hud.litSet.has(id) && mode === 'map' ? 'active' : hover && !hot(id) ? 'dim' : 'idle');
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

<div class="scene" bind:this={stage} onwheel={onWheel} onpointerdown={onDown} onpointermove={onMove} onpointerup={onUp} onpointercancel={() => (drag = null)} oncontextmenu={(e) => e.preventDefault()} role="application" aria-label="Scene">
  <div class="sky"></div>
  <div class="camera" style="transform: translate({cam.x}px, {cam.y}px) scale({cam.z})">
    <div class="plane" style="width: {PLANE_W}px; height: {PLANE_H}px; margin-left: {-PLANE_W / 2}px; margin-top: {-PLANE_H / 2}px; transform: rotateX({cam.tilt}deg) rotateZ({cam.yaw}deg)">
      <div class="grid"></div>
      {#if !hud.map}
        <div class="empty" style="transform: translate(-50%, -50%) {billboard}">No system map loaded.</div>
      {:else if !placed.length}
        <div class="empty" style="transform: translate(-50%, -50%) {billboard}"><b>{hud.map.name}</b><br />{mode === 'map' ? 'Nothing at this level.' : 'Waiting for the agent to go somewhere.'}</div>
      {:else}
        {#each scene.bands as b (b.label)}
          <div class="band" style="top: {PLANE_H / 2 + b.y0}px; height: {b.y1 - b.y0}px; --c: {b.color}">
            <span class="bandlabel" style="left: {PLANE_W / 2 + leftEdge - 120}px; transform: translate(-100%, -50%) {billboard}">{b.label.toUpperCase()}</span>
          </div>
        {/each}
        {#each scene.cols as c (c.label)}
          <div class="collabel" style="left: {PLANE_W / 2 + c.x}px; top: {PLANE_H / 2 + (scene.bands[0]?.y0 ?? 0) - 70}px; transform: translate(-50%, -100%) {billboard}">{c.label}</div>
        {/each}

        <svg class="links" viewBox="0 0 {PLANE_W} {PLANE_H}" width={PLANE_W} height={PLANE_H}>
          {#each lines as l (l.key)}
            <g class="link" class:hot={hover === l.from || hover === l.to} class:dim={(!!hover && hover !== l.from && hover !== l.to) || (previewSet.size > 0 && !l.preview)} class:faint={l.faint} class:preview={l.preview} transition:fade={{ duration: 200 }}>
              <path d={l.d} class="beam" /><path d={l.d} class="dots" class:flow={l.flow} />
            </g>
          {/each}
        </svg>
        {#if scene.zone}
          <div class="zone" transition:fade><span style="transform: {billboard}">{scene.zone.label}</span></div>
        {/if}
        {#each lines as l (l.key + ':l')}
          {#if l.label}
            <div class="linklabel" class:dim={(!!hover && hover !== l.from && hover !== l.to) || (previewSet.size > 0 && !l.preview)} class:preview={l.preview} class:faint={l.faint} style="left: {PLANE_W / 2 + l.mx}px; top: {PLANE_H / 2 + l.my}px; transform: translate(-50%, -50%) {billboard}">{l.label}</div>
          {/if}
        {/each}

        {#each scene.stubs as ps (ps.stub.id)}
          <!-- svelte-ignore a11y_click_events_have_key_events a11y_no_static_element_interactions a11y_mouse_events_have_key_events -->
          <div class="stubpill" style="left: {PLANE_W / 2 + ps.x}px; top: {PLANE_H / 2 + ps.y}px; transform: translate(-50%, -50%) {billboard}; --c: {hud.layerColor(ps.stub.layer)}"
            onclick={(e) => { e.stopPropagation(); if (suppressClick) return; hud.hideTip(); hud.goTo(ps.stub.targets.map((t) => t.id)); }}
            onmouseenter={(e) => stubTip(e, ps.stub)} onmousemove={(e) => stubTip(e, ps.stub)} onmouseleave={() => hud.hideTip()}>{stubLabel(ps.stub)}</div>
        {/each}

        {#key levelKey}
        {#each placed as p (p.id)}
          <div class="shadow" style="left: {PLANE_W / 2 + p.x}px; top: {PLANE_H / 2 + p.y}px; --s: {p.s}"></div>
          <!-- svelte-ignore a11y_click_events_have_key_events a11y_no_static_element_interactions a11y_mouse_events_have_key_events -->
          <div
            class="res {p.role}"
            class:targeted={target === p.id}
            class:selected={hud.selected === p.id}
            data-id={p.id}
            style="left: {PLANE_W / 2 + p.x}px; top: {PLANE_H / 2 + p.y}px; transform: translate(-50%, -100%) {billboard} scale({p.s}); --c: {layerColor(p.node)}"
            onclick={(e) => onClick(e, p)}
            oncontextmenu={(e) => { e.preventDefault(); if (!suppressClick && p.node) activate(p.id); }}
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
              {#if p.children.length}<div class="kids">{p.children.length} inside{mode === 'map' ? ' · right-click to open' : ''}</div>{/if}
              {#if hud.agentSet.has(p.id)}<div class="here" style="color: {hud.agentColorByNode.get(p.id) ?? 'var(--agent)'}">agent here</div>{/if}
              {#if previewSet.has(p.id)}<div class="would">would touch</div>{/if}
              {#if hud.decisionsByNode.has(p.id)}
                <!-- svelte-ignore a11y_click_events_have_key_events a11y_no_static_element_interactions a11y_mouse_events_have_key_events -->
                <div class="why" onmouseenter={(e) => whyTip(e, p.id)} onmouseleave={() => hud.hideTip()} onclick={(e) => { e.stopPropagation(); hud.hideTip(); hud.showTimeline = true; }}>✓ why?</div>
              {/if}
              {#if target === p.id}<div class="reticle"></div>{/if}
            {:else}
              <div class="plate"><span class="label">+{p.moreCount} more</span></div>
            {/if}
          </div>
        {/each}
        {/key}
      {/if}
    </div>
  </div>

  {#if hud.selected && hud.blowoutFrom}
    <svg class="callout" transition:fade={{ duration: 200 }}>
      <line x1={hud.blowoutFrom.x} y1={hud.blowoutFrom.y} x2={anchor.side === 'right' ? anchor.left : anchor.left + 400} y2={anchor.top + 150} />
      <circle cx={hud.blowoutFrom.x} cy={hud.blowoutFrom.y} r="5" />
    </svg>
  {/if}
</div>

<style>
  .scene { position: absolute; inset: 0; overflow: hidden; background: var(--bg); cursor: grab; touch-action: none; user-select: none; perspective: 1100px; perspective-origin: 50% 30%; }
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
  .band { position: absolute; left: 0; right: 0; background: color-mix(in srgb, var(--c) 7%, transparent); border-top: 1px solid color-mix(in srgb, var(--c) 30%, transparent); pointer-events: none; }
  .bandlabel { position: absolute; top: 50%; transform-origin: 100% 50%; font: 700 26px var(--mono); letter-spacing: .16em; color: var(--c); white-space: nowrap; opacity: .9; }
  .collabel { position: absolute; transform-origin: 50% 100%; font: 600 24px var(--sans); color: var(--fg-2); white-space: nowrap; letter-spacing: .04em; }
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

  .shadow { position: absolute; width: calc(150px * var(--s)); height: calc(44px * var(--s)); transform: translate(-50%, -50%); border-radius: 50%; background: radial-gradient(ellipse, color-mix(in srgb, var(--fg) 40%, transparent), transparent 70%); pointer-events: none; }
  .res { position: absolute; transform-origin: 50% 100%; display: flex; flex-direction: column; align-items: center; cursor: pointer; transition: left .6s cubic-bezier(.2,.8,.2,1), top .6s cubic-bezier(.2,.8,.2,1), transform .25s ease-out, opacity .3s; }
  .res.up, .res.down { opacity: .88; }
  .res.far { opacity: .45; }
  .res.far:hover { opacity: .9; }
  .res.ghost .plate { border-style: dashed; }
  .res.selected .plate { border-color: var(--fg); }
  .plate { display: flex; flex-direction: column; align-items: center; gap: 1px; margin-bottom: -4px; padding: 4px 12px; border-radius: 8px; background: color-mix(in srgb, var(--bg-2) 82%, transparent); border: 1px solid var(--line); white-space: nowrap; }
  .plate.pending { border-color: var(--accent); }
  .plate .kind { font: 10px var(--mono); color: var(--c); letter-spacing: .08em; text-transform: uppercase; }
  .plate .label { font: 600 14px var(--sans); color: var(--fg); }
  .plate .meta { font: 11px var(--mono); color: var(--fg-2); }
  .kids { font: 10.5px var(--mono); color: var(--fg-3); margin-top: -8px; }
  .here { font: 10px var(--mono); color: var(--agent); letter-spacing: .08em; text-transform: uppercase; }
  .would { font: 10px var(--mono); color: var(--accent); letter-spacing: .08em; text-transform: uppercase; }
  .why { font: 10px var(--mono); color: var(--ok); letter-spacing: .06em; cursor: help; opacity: .75; }
  .why:hover { opacity: 1; text-decoration: underline dotted; }
  .stubpill { position: absolute; transform-origin: 50% 50%; font: 600 12px var(--mono); color: var(--c); background: color-mix(in srgb, var(--bg-2) 88%, transparent); border: 1.5px solid var(--c); border-radius: 999px; padding: 4px 12px; white-space: nowrap; cursor: pointer; }
  .stubpill:hover { background: var(--bg-3); box-shadow: 0 0 18px -6px var(--c); }
  /* staged zoom in map mode: the camera moves first, then the level's sprites fade in */
  .res.node { animation: res-in .32s .16s cubic-bezier(.2,.8,.2,1) both; }
  @keyframes res-in { from { opacity: 0; transform: translate(-50%, -90%) scale(.8); } }
  .reticle { position: absolute; inset: -10px -14px; border: 1.5px solid var(--agent); border-radius: 14px; pointer-events: none; animation: reticle 1.6s ease-in-out infinite; }
  @keyframes reticle { 0%, 100% { opacity: .5; } 50% { opacity: 1; } }
  .zone { position: absolute; left: 50%; top: 50%; width: 1150px; height: 460px; transform: translate(-50%, -50%); border: 1.5px dashed color-mix(in srgb, var(--fg-3) 50%, transparent); border-radius: 50%; pointer-events: none; }
  .zone span { position: absolute; left: 50%; top: 14px; display: inline-block; transform-origin: 50% 100%; font: 600 11px var(--mono); color: var(--fg-3); letter-spacing: .14em; text-transform: uppercase; margin-left: -60px; }
  .empty { position: absolute; left: 50%; top: 50%; text-align: center; color: var(--fg-2); width: 320px; transform-origin: 50% 50%; }
  .callout { position: fixed; inset: 0; width: 100%; height: 100%; pointer-events: none; z-index: 29; }
  .callout line { stroke: var(--agent); stroke-width: 1.5; stroke-dasharray: 1400; animation: draw .35s ease-out forwards; }
  .callout circle { fill: var(--agent); }
  @keyframes draw { from { stroke-dashoffset: 1400; } to { stroke-dashoffset: 0; } }
</style>
