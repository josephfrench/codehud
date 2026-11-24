/**
 * Single reactive store for the HUD (Svelte 5 runes in a class).
 */
import { MapIndex, type SystemMap, type SysNode } from '../../../schema/src/index.ts';
import type { Question, ActivityItem, AgentSession, ServerEvent } from '../../../schema/src/protocol.ts';
import { api } from './api.ts';

export type Mode = 'follow' | 'roam';

export interface Toast { id: number; text: string; nodes?: string[]; kind: 'question' | 'info' }

class HudState {
  map = $state.raw<SystemMap | null>(null);
  index = $state.raw<MapIndex | null>(null);
  /** ids from the root container down to the current container (empty = top level) */
  focusPath = $state<string[]>([]);
  selected = $state<string | null>(null);
  /** exact node ids the agent / question pointed at */
  highlighted = $state.raw<Set<string>>(new Set());
  agentAt = $state.raw<{ nodes: string[]; note?: string; at: string; session?: string } | null>(null);
  questions = $state<Question[]>([]);
  activity = $state<ActivityItem[]>([]);
  sessions = $state<AgentSession[]>([]);
  connected = $state(false);
  mode = $state<Mode>('follow');
  activeQuestionId = $state<string | null>(null);
  showImports = $state(false);
  showHelp = $state(false);
  showActivity = $state(false);
  /** 'focus' shows only the relevant slice; 'map' is the whole layer x lane grid */
  view = $state<'focus' | 'map'>('focus');
  theme = $state<'dark' | 'light'>((() => { try { return (localStorage.getItem('codehud-theme') as 'dark' | 'light') || 'dark'; } catch { return 'dark'; } })());
  toasts = $state<Toast[]>([]);
  /** bump to ask the canvas to fit these ids (null = whole level) */
  fit = $state.raw<{ ids: string[] | null; lane?: string; seq: number }>({ ids: null, seq: 0 });
  /** which lane column the ←/→ keys are parked on at the top level */
  laneIndex = $state(-1);
  now = $state(Date.now());

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
  activeQuestion = $derived.by<Question | null>(() =>
    this.questions.find((q) => q.id === this.activeQuestionId) ?? this.pending[0] ?? null);
  /** highlighted ids plus all their ancestors (so containers glow when a child is targeted) */
  litSet = $derived.by<Set<string>>(() => this.withAncestors(this.highlighted));
  agentSet = $derived.by<Set<string>>(() => this.withAncestors(new Set(this.agentAt?.nodes ?? [])));
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

  private withAncestors(ids: Set<string>): Set<string> {
    const out = new Set<string>();
    if (!this.index) return out;
    for (const id of ids) {
      out.add(id);
      for (const a of this.index.ancestors(id)) out.add(a.id);
    }
    return out;
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
    if (this.es) return;
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

  private handle(ev: ServerEvent) {
    switch (ev.type) {
      case 'hello': {
        if (ev.map) this.setMap(ev.map);
        this.questions = ev.questions;
        this.sessions = ev.sessions;
        this.activity = ev.activity;
        const p = this.pending[0];
        if (p) { this.activeQuestionId = p.id; this.goTo(p.resolvedNodes); }
        else this.requestFit(null);
        break;
      }
      case 'map': this.setMap(ev.map); break;
      case 'focus': {
        this.agentAt = { nodes: ev.focus.resolvedNodes, note: ev.focus.note, at: new Date().toISOString(), session: ev.focus.session };
        if (ev.focus.source === 'hook') break; // passive presence: show the dot, never move the viewport
        if (this.mode === 'follow' && ev.focus.resolvedNodes.length) {
          this.highlighted = new Set(ev.focus.resolvedNodes);
          if (ev.focus.zoom !== false) this.goTo(ev.focus.resolvedNodes);
        }
        break;
      }
      case 'question': {
        this.questions = [...this.questions.filter((q) => q.id !== ev.question.id), ev.question];
        if (this.mode === 'follow' || !this.activeQuestionId) {
          this.activeQuestionId = ev.question.id;
          this.goTo(ev.question.resolvedNodes);
        } else {
          this.toast({ text: `Agent needs you: ${ev.question.question}`, nodes: ev.question.resolvedNodes, kind: 'question' });
        }
        break;
      }
      case 'answer': {
        this.questions = this.questions.map((q) => (q.id === ev.question.id ? ev.question : q));
        if (this.activeQuestionId === ev.question.id) this.activeQuestionId = this.pending[0]?.id ?? null;
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
  roam() { if (this.mode !== 'roam') this.mode = 'roam'; }
  follow() {
    this.mode = 'follow';
    const q = this.pending[0];
    if (q) { this.activeQuestionId = q.id; this.goTo(q.resolvedNodes); }
    else if (this.agentAt?.nodes.length) this.goTo(this.agentAt.nodes);
    else this.requestFit(null);
  }
  toggleMode() { this.mode === 'follow' ? this.roam() : this.follow(); }
  toggleTheme() {
    this.theme = this.theme === 'dark' ? 'light' : 'dark';
    document.documentElement.dataset.theme = this.theme;
    try { localStorage.setItem('codehud-theme', this.theme); } catch { /* ignore */ }
  }

  // ----- questions ---------------------------------------------------------
  async answer(q: Question, body: { text?: string; optionId?: string }) {
    await api.answer(q.id, body);
  }
  toast(t: Omit<Toast, 'id'>) {
    const id = Date.now() + Math.random();
    this.toasts = [...this.toasts, { ...t, id }];
    setTimeout(() => (this.toasts = this.toasts.filter((x) => x.id !== id)), 8000);
  }
  dismissToast(id: number) { this.toasts = this.toasts.filter((x) => x.id !== id); }
}

export const hud = new HudState();
