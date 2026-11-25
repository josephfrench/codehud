/**
 * Single reactive store for the HUD (Svelte 5 runes in a class).
 */
import { MapIndex, type SystemMap, type SysNode } from '../../../schema/src/index.ts';
import type { Question, ActivityItem, AgentSession, ServerEvent } from '../../../schema/src/protocol.ts';
import { api } from './api.ts';
import { layerColor, sessionColor } from './colors.ts';

export type Mode = 'follow' | 'roam';

export interface Toast { id: number; text: string; nodes?: string[]; kind: 'question' | 'info' }
export interface AgentPos { session: string; nodes: string[]; note?: string; at: string }
export interface Tip { x: number; y: number; title: string; lines: string[]; accent?: string }

/**
 * Interruption policy (interface-patterns.md §3): a new question is *negotiated* by default: amber badge on
 * the node, count in the top bar, a quiet toast. It becomes *immediate* (auto-zoom) only when this window
 * already has focus, when it regains focus, or when nobody has acted on it for this long.
 */
export const INTERRUPT_AFTER_MS = 20_000;

class HudState {
  map = $state.raw<SystemMap | null>(null);
  index = $state.raw<MapIndex | null>(null);
  /** ids from the root container down to the current container (empty = top level) */
  focusPath = $state<string[]>([]);
  selected = $state<string | null>(null);
  /** exact node ids the agent / question pointed at */
  highlighted = $state.raw<Set<string>>(new Set());
  /** where each agent session last was */
  agents = $state.raw<Map<string, AgentPos>>(new Map());
  questions = $state<Question[]>([]);
  activity = $state<ActivityItem[]>([]);
  sessions = $state<AgentSession[]>([]);
  connected = $state(false);
  /** /demo: everything runs in the browser; no server, answers are handled locally */
  demo = $state(false);
  onLocalAnswer: ((id: string, body: { text?: string; optionId?: string }) => void) | null = null;
  mode = $state<Mode>('follow');
  /** follow mode tracks only this session when set (null = every session) */
  followSession = $state<string | null>(null);
  activeQuestionId = $state<string | null>(null);
  showImports = $state(false);
  showHelp = $state(false);
  showActivity = $state(false);
  /** decision log / timeline drawer */
  showTimeline = $state(false);
  /** 'play' shows only the relevant slice; 'map' is the whole layer x lane grid; 'docs' the files */
  view = $state<'play' | 'map' | 'docs'>('play');
  /** how the map explorer draws: the original layer x lane grid, or the 3D scene */
  mapStyle = $state<'grid' | 'scene'>((() => { try { return (localStorage.getItem('codehud-map-style') as 'grid' | 'scene') || 'grid'; } catch { return 'grid'; } })());
  /** question drawer expanded (focus view) */
  questionOpen = $state(true);
  /** screen point the specifics modal grows out of */
  blowoutFrom = $state.raw<{ x: number; y: number } | null>(null);
  /** option index being previewed in the dialogue (null = none) */
  previewOption = $state<number | null>(null);
  /** shared hover tooltip (stubs, "why is this here?") */
  tip = $state.raw<Tip | null>(null);
  theme = $state<'dark' | 'light'>((() => { try { return (localStorage.getItem('codehud-theme') as 'dark' | 'light') || 'dark'; } catch { return 'dark'; } })());
  toasts = $state<Toast[]>([]);
  /** bump to ask the canvas to fit these ids (null = whole level) */
  fit = $state.raw<{ ids: string[] | null; lane?: string; seq: number }>({ ids: null, seq: 0 });
  /** which lane column the ←/→ keys are parked on at the top level */
  laneIndex = $state(-1);
  now = $state(Date.now());
  /** node id -> last time an agent focused it (ms); feeds search ranking */
  focusedAt = $state.raw<Map<string, number>>(new Map());
  /** questions that have already pulled the viewport (never re-alert) */
  private zoomedQuestions = new Set<string>();
  private interruptTimers = new Map<string, ReturnType<typeof setTimeout>>();

  // ----- derived -----------------------------------------------------------
  current = $derived.by<SysNode | null>(() => {
    const id = this.focusPath.at(-1);
    return id && this.index ? (this.index.get(id) ?? null) : null;
  });
  visible = $derived.by<SysNode[]>(() => (this.index ? this.index.childrenOf(this.current?.id ?? null) : []));
  siblings = $derived.by<SysNode[]>(() => {
    if (!this.index || !this.current) return [];
    return this.index.childrenOf(this.current.parent ?? null);
  });
  pending = $derived(this.questions.filter((q) => q.status === 'pending'));
  /** pending questions from the followed session (or all) */
  pendingFollowed = $derived(this.pending.filter((q) => !this.followSession || q.session === this.followSession));
  activeQuestion = $derived.by<Question | null>(() =>
    this.questions.find((q) => q.id === this.activeQuestionId) ?? this.pendingFollowed[0] ?? this.pending[0] ?? null);
  /** the agent position the HUD follows: the followed session's, else the most recent */
  agentAt = $derived.by<AgentPos | null>(() => {
    if (this.followSession) return this.agents.get(this.followSession) ?? null;
    let best: AgentPos | null = null;
    for (const a of this.agents.values()) if (!best || a.at > best.at) best = a;
    return best;
  });
  /** highlighted ids plus all their ancestors (so containers glow when a child is targeted) */
  litSet = $derived.by<Set<string>>(() => this.withAncestors(this.highlighted));
  /** every node (plus ancestors) some agent is at */
  agentSet = $derived.by<Set<string>>(() => this.withAncestors(new Set([...this.agents.values()].flatMap((a) => a.nodes))));
  /** node id -> colour of the agent there (first session wins; ancestors inherit) */
  agentColorByNode = $derived.by<Map<string, string>>(() => {
    const m = new Map<string, string>();
    const list = [...this.agents.values()].sort((a, b) => a.at.localeCompare(b.at));
    for (const a of list) for (const id of this.withAncestors(new Set(a.nodes))) if (!m.has(id)) m.set(id, this.sessionColor(a.session));
    return m;
  });
  /** node id -> pending questions touching it or its descendants */
  pendingByNode = $derived.by<Map<string, Question[]>>(() => {
    const m = new Map<string, Question[]>();
    for (const q of this.pending) for (const id of this.withAncestors(new Set(q.resolvedNodes))) m.set(id, [...(m.get(id) ?? []), q]);
    return m;
  });
  decisionsByNode = $derived.by<Map<string, Question[]>>(() => {
    const m = new Map<string, Question[]>();
    for (const q of this.questions) if (q.status === 'answered') for (const id of this.withAncestors(new Set(q.resolvedNodes))) m.set(id, [...(m.get(id) ?? []), q]);
    return m;
  });
  /** pending count per session id ('' = unattributed) */
  pendingBySession = $derived.by<Map<string, Question[]>>(() => {
    const m = new Map<string, Question[]>();
    for (const q of this.pending) m.set(q.session ?? '', [...(m.get(q.session ?? '') ?? []), q]);
    return m;
  });
  liveSessions = $derived(this.sessions.filter((s) => this.now - new Date(s.lastSeen).getTime() < 10 * 60_000));

  private withAncestors(ids: Set<string>): Set<string> {
    const out = new Set<string>();
    if (!this.index) return out;
    for (const id of ids) {
      out.add(id);
      for (const a of this.index.ancestors(id)) out.add(a.id);
    }
    return out;
  }

  // ----- colours -----------------------------------------------------------
  layerColor(id: string | undefined | null): string { return id ? layerColor(this.map?.layers ?? [], id) : 'var(--layer-default)'; }
  nodeColor(n: SysNode | null | undefined): string { return n ? this.layerColor(this.index?.layerOf(n) || n.layer) : 'var(--fg-3)'; }
  sessionColor(id: string | undefined | null): string { return sessionColor(this.sessions.find((s) => s.id === id) ?? id); }
  /** the latest answered question on a node (or its descendants): "why is this here?" */
  latestDecision(id: string): Question | null {
    const list = this.decisionsByNode.get(id);
    if (!list?.length) return null;
    return [...list].sort((a, b) => (b.answer?.answeredAt ?? '').localeCompare(a.answer?.answeredAt ?? ''))[0];
  }

  // ----- search ------------------------------------------------------------
  /** Text search, re-ranked by what matters right now: pending questions first, then recent agent focus. */
  search(q: string, limit = 8): { node: SysNode; why: string | null }[] {
    if (!this.index) return [];
    const base = this.index.search(q, limit * 4);
    const now = this.now;
    const scored = base.map((node, i) => {
      let s = (base.length - i) / base.length; // keep the text order as a tiebreaker
      let why: string | null = null;
      const at = this.focusedAt.get(node.id);
      if (at) { const ageMin = (now - at) / 60_000; s += ageMin < 2 ? 3 : ageMin < 15 ? 2 : ageMin < 120 ? 1 : 0.3; why = `agent · ${timeAgoShort(at, now)}`; }
      if (this.pendingByNode.has(node.id)) { s += 5; why = 'waiting on you'; }
      return { node, why, s };
    });
    return scored.sort((a, b) => b.s - a.s).slice(0, limit);
  }

  // ----- connection --------------------------------------------------------
  private es: EventSource | null = null;
  authError = $state<string | null>(null);

  /** Exchange a #t=<token> fragment for a session cookie, then strip it from the URL. */
  async claimFromFragment(token?: string) {
    const m = token ?? location.hash.match(/[#&]t=([\w-]+)/)?.[1];
    if (!m) return false;
    try {
      await api.claim(m);
      history.replaceState(null, '', location.pathname + location.search);
      this.authError = null;
      return true;
    } catch (e: any) {
      this.authError = e.message === '401' || /token/i.test(e.message) ? 'That token was not accepted.' : e.message;
      return false;
    }
  }

  async connect() {
    if (this.es || this.demo) return;
    await this.claimFromFragment();
    const es = new EventSource('/api/events');
    this.es = es;
    es.onopen = () => { this.connected = true; this.authError = null; };
    es.onerror = async () => {
      this.connected = false;
      // Distinguish "server down" from "not signed in" so the UI can ask for a token.
      try {
        const r = await fetch('/api/session', { credentials: 'same-origin' });
        if (r.status === 401 || r.status === 403) { es.close(); this.es = null; this.authError = 'Sign in with the token printed by the server.'; }
      } catch { /* server down; EventSource will retry */ }
    };
    es.onmessage = (m) => {
      try { this.handle(JSON.parse(m.data) as ServerEvent); } catch (e) { console.error('bad event', e); }
    };
    setInterval(() => (this.now = Date.now()), 10_000);
  }

  /** Apply a server event (also used by /demo to replay a scripted session). */
  dispatch(ev: ServerEvent) { this.handle(ev); }

  private followed(session: string | undefined): boolean { return !this.followSession || session === this.followSession; }

  private handle(ev: ServerEvent) {
    switch (ev.type) {
      case 'hello': {
        if (ev.map) this.setMap(ev.map);
        this.questions = ev.questions;
        this.sessions = ev.sessions;
        this.activity = ev.activity;
        // rebuild per-session positions and focus recency from the activity log
        const agents = new Map<string, AgentPos>();
        const focusedAt = new Map<string, number>();
        for (const a of ev.activity) {
          if (!a.nodes?.length) continue;
          const t = new Date(a.at).getTime();
          for (const id of a.nodes) focusedAt.set(id, t);
          if (a.kind === 'focus') agents.set(a.session ?? '', { session: a.session ?? '', nodes: a.nodes, note: a.text, at: a.at });
        }
        this.agents = agents;
        this.focusedAt = focusedAt;
        const p = this.pendingFollowed[0] ?? this.pending[0];
        if (p) { this.activeQuestionId = p.id; this.zoomedQuestions.add(p.id); this.goTo(p.resolvedNodes); }
        else if (this.agentAt?.nodes.length) this.goTo(this.agentAt.nodes); // resume where the agent last was
        else this.requestFit(null);
        break;
      }
      case 'map': this.setMap(ev.map); break;
      case 'focus': {
        const session = ev.focus.session ?? '';
        const next = new Map(this.agents);
        next.set(session, { session, nodes: ev.focus.resolvedNodes, note: ev.focus.note, at: new Date().toISOString() });
        this.agents = next;
        const fa = new Map(this.focusedAt);
        for (const id of ev.focus.resolvedNodes) fa.set(id, Date.now());
        this.focusedAt = fa;
        if (ev.focus.source === 'hook') break; // passive presence: show the dot, never move the viewport
        if (this.mode === 'follow' && this.followed(ev.focus.session) && ev.focus.resolvedNodes.length) {
          this.highlighted = new Set(ev.focus.resolvedNodes);
          if (ev.focus.zoom !== false) this.goTo(ev.focus.resolvedNodes);
        }
        break;
      }
      case 'question': {
        const q = ev.question;
        const isNew = !this.questions.some((x) => x.id === q.id);
        this.questions = [...this.questions.filter((x) => x.id !== q.id), q];
        this.questionOpen = true;
        if (!isNew || q.status !== 'pending') break;
        const mine = this.mode === 'follow' && this.followed(q.session);
        if (!this.activeQuestionId || mine) this.activeQuestionId = q.id;
        if (mine && this.hasFocus()) this.interrupt(q.id);
        else {
          // negotiated: badge + count + quiet toast; escalate after INTERRUPT_AFTER_MS
          this.toast({ text: `Agent needs you: ${q.question}`, nodes: q.resolvedNodes, kind: 'question' });
          if (mine) this.interruptTimers.set(q.id, setTimeout(() => this.interrupt(q.id), INTERRUPT_AFTER_MS));
        }
        break;
      }
      case 'answer': {
        this.questions = this.questions.map((q) => (q.id === ev.question.id ? ev.question : q));
        this.previewOption = null;
        this.clearInterrupt(ev.question.id);
        if (this.activeQuestionId === ev.question.id) this.activeQuestionId = this.pendingFollowed[0]?.id ?? this.pending[0]?.id ?? null;
        break;
      }
      case 'session': {
        this.sessions = [...this.sessions.filter((s) => s.id !== ev.session.id), ev.session];
        break;
      }
      case 'activity': {
        this.activity = [...this.activity.slice(-199), ev.item];
        break;
      }
    }
  }

  private hasFocus() { try { return document.hasFocus() && document.visibilityState === 'visible'; } catch { return true; } }
  /** Pull the viewport to a pending question, once. */
  private interrupt(id: string) {
    this.clearInterrupt(id);
    const q = this.questions.find((x) => x.id === id);
    if (!q || q.status !== 'pending' || this.zoomedQuestions.has(id)) return;
    if (this.mode !== 'follow' || !this.followed(q.session)) return;
    this.zoomedQuestions.add(id);
    this.activeQuestionId = id;
    this.toasts = this.toasts.filter((t) => t.kind !== 'question' || !t.nodes || t.nodes.join() !== q.resolvedNodes.join());
    this.goTo(q.resolvedNodes);
  }
  private clearInterrupt(id: string) {
    const t = this.interruptTimers.get(id);
    if (t) { clearTimeout(t); this.interruptTimers.delete(id); }
  }
  /** Call when the window regains focus: a waiting question becomes immediate now that the human is looking. */
  onWindowFocus() {
    const q = this.pendingFollowed.find((x) => !this.zoomedQuestions.has(x.id));
    if (q && this.mode === 'follow') this.interrupt(q.id);
  }

  /** Forget everything except view preferences (used when the demo replays). */
  reset() {
    this.map = null; this.index = null; this.focusPath = []; this.selected = null; this.highlighted = new Set();
    this.agents = new Map(); this.questions = []; this.activity = []; this.sessions = []; this.activeQuestionId = null;
    this.previewOption = null; this.blowoutFrom = null; this.mode = 'follow'; this.followSession = null; this.focusedAt = new Map();
    this.zoomedQuestions.clear();
    for (const t of this.interruptTimers.values()) clearTimeout(t);
    this.interruptTimers.clear();
  }

  private setMap(map: SystemMap) {
    this.map = map;
    this.index = new MapIndex(map);
    // keep the focus path if the nodes still exist
    this.focusPath = this.focusPath.filter((id) => this.index!.get(id));
    if (this.selected && !this.index.get(this.selected)) this.selected = null;
    this.requestFit(null);
  }

  // ----- navigation --------------------------------------------------------
  requestFit(ids: string[] | null, lane?: string) { this.fit = { ids, lane, seq: this.fit.seq + 1 }; }

  /** At the top level ←/→ swipe between swim-lane columns. */
  swipeLane(dir: 1 | -1) {
    if (!this.map) return;
    const lanes = [...this.map.lanes.map((l) => l.id), '__shared'];
    this.laneIndex = this.laneIndex < 0 ? (dir > 0 ? 0 : lanes.length - 1) : (this.laneIndex + dir + lanes.length) % lanes.length;
    this.roam();
    this.requestFit(null, lanes[this.laneIndex]);
  }

  /** Zoom to the level that contains all ids and highlight them. */
  goTo(ids: string[], opts: { highlight?: boolean; select?: boolean } = {}) {
    if (!this.index || !ids.length) return;
    const chains = ids.filter((id) => this.index!.get(id)).map((id) => this.index!.ancestors(id).map((a) => a.id));
    if (!chains.length) return;
    // longest common prefix of ancestor chains
    let prefix = chains[0];
    for (const c of chains.slice(1)) {
      let i = 0;
      while (i < prefix.length && i < c.length && prefix[i] === c[i]) i++;
      prefix = prefix.slice(0, i);
    }
    this.focusPath = prefix;
    if (opts.highlight !== false) this.highlighted = new Set(ids);
    const reps = ids.map((id) => (this.index!.ancestors(id)[prefix.length]?.id ?? id));
    if (opts.select && ids.length === 1) this.selected = reps[0];
    this.requestFit([...new Set(reps)]);
  }

  descend(id: string) {
    if (!this.index?.get(id)) return;
    this.focusPath = [...this.index.ancestors(id).map((a) => a.id), id];
    this.selected = null;
    this.roam();
    this.requestFit(null);
  }
  ascend() {
    if (!this.focusPath.length) return;
    const from = this.focusPath.at(-1)!;
    this.focusPath = this.focusPath.slice(0, -1);
    this.selected = from;
    this.roam();
    this.requestFit(null);
  }
  jumpTo(depth: number) {
    this.focusPath = this.focusPath.slice(0, depth);
    this.selected = null;
    this.roam();
    this.requestFit(null);
  }
  /** Switch the current container to its previous/next sibling. Returns false at the top level. */
  sibling(dir: 1 | -1): boolean {
    if (!this.current) return false;
    const sibs = this.siblings;
    const i = sibs.findIndex((s) => s.id === this.current!.id);
    const next = sibs[(i + dir + sibs.length) % sibs.length];
    if (!next || next.id === this.current.id) return true;
    this.focusPath = [...this.focusPath.slice(0, -1), next.id];
    this.selected = null;
    this.roam();
    this.requestFit(null);
    return true;
  }
  select(id: string | null) { this.selected = id; }
  openBlowout(id: string, from: { x: number; y: number } | null) { this.blowoutFrom = from; this.selected = id; }
  roam() { if (this.mode !== 'roam') this.mode = 'roam'; }
  follow(session?: string | null) {
    if (session !== undefined) this.followSession = session;
    this.mode = 'follow';
    const q = this.pendingFollowed[0];
    if (q) { this.activeQuestionId = q.id; this.zoomedQuestions.add(q.id); this.clearInterrupt(q.id); this.goTo(q.resolvedNodes); }
    else if (this.agentAt?.nodes.length) this.goTo(this.agentAt.nodes);
    else this.requestFit(null);
  }
  toggleMode() { this.mode === 'follow' ? this.roam() : this.follow(); }
  toggleMapStyle() {
    this.mapStyle = this.mapStyle === 'grid' ? 'scene' : 'grid';
    try { localStorage.setItem('codehud-map-style', this.mapStyle); } catch { /* ignore */ }
  }
  toggleTheme() {
    this.theme = this.theme === 'dark' ? 'light' : 'dark';
    document.documentElement.dataset.theme = this.theme;
    try { localStorage.setItem('codehud-theme', this.theme); } catch { /* ignore */ }
  }

  // ----- questions ---------------------------------------------------------
  async answer(q: Question, body: { text?: string; optionId?: string }) {
    if (this.demo) { this.onLocalAnswer?.(q.id, body); return; }
    await api.answer(q.id, body);
  }
  toast(t: Omit<Toast, 'id'>) {
    const id = Date.now() + Math.random();
    this.toasts = [...this.toasts, { ...t, id }];
    setTimeout(() => (this.toasts = this.toasts.filter((x) => x.id !== id)), 8000);
  }
  dismissToast(id: number) { this.toasts = this.toasts.filter((x) => x.id !== id); }

  // ----- tooltips ----------------------------------------------------------
  showTip(tip: Tip) { this.tip = tip; }
  hideTip() { this.tip = null; }
}

function timeAgoShort(t: number, now: number): string {
  const s = Math.max(0, Math.round((now - t) / 1000));
  return s < 60 ? 'just now' : s < 3600 ? `${Math.round(s / 60)}m ago` : `${Math.round(s / 3600)}h ago`;
}

export const hud = new HudState();
