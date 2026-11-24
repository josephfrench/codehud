// TODO: import from '@codehud/schema' once the workspace is installed.
import type { Lane, SysEdge, SysNode } from '../../schema/src/index.ts';

/**
 * Path segments that describe code organisation rather than a feature. A lane is whatever is left
 * once these are skipped: `src/lib/checkout/service.ts` -> checkout, `/api/admin/users` -> admin.
 */
const STRUCTURAL = new Set([
  'src', 'app', 'apps', 'api', 'apis', 'pages', 'routes', 'route', 'views', 'screens', 'lib', 'libs', 'server',
  'services', 'service', 'domain', 'core', 'utils', 'util', 'shared', 'common', 'helpers', 'helper', 'types',
  'type', 'db', 'database', 'schema', 'schemas', 'config', 'configs', 'components', 'component', 'ui',
  'layouts', 'layout', 'http', 'client', 'stores', 'store', 'hooks', 'composables', 'styles', 'assets',
  'models', 'model', 'entities', 'entity', 'repositories', 'repository', 'controllers', 'controller',
  'handlers', 'handler', 'middleware', 'middlewares', 'plugins', 'plugin', 'adapters', 'adapter',
  'providers', 'provider', 'integrations', 'integration', 'workers', 'worker', 'jobs', 'job', 'tasks',
  'queues', 'queue', 'events', 'event', 'emails', 'email', 'templates', 'i18n', 'locales', 'constants',
  'enums', 'interfaces', 'dto', 'dtos', 'validators', 'validation', 'guards', 'decorators', 'filters',
  'pipes', 'interceptors', 'modules', 'module', 'features', 'feature', 'internal', 'public', 'index',
  'webhooks', 'webhook', 'v1', 'v2', 'v3', 'actions', 'action', 'trpc', 'graphql', 'rest', 'rpc',
  'functions', 'function', 'scripts', 'test', 'tests', '__tests__', 'spec', 'packages', 'mock', 'mocks',
  'fixtures', 'data', 'static', 'health', 'dashboard', 'admin-panel', 'home', 'main',
]);

export function isDynamicSegment(seg: string): boolean {
  return /^[\[(@$:_*]/.test(seg) || seg.startsWith('+') || seg.includes('...');
}

/** First feature-ish segment of a URL path or directory path, or undefined. */
export function laneHintFromPath(path: string): string | undefined {
  for (const raw of path.split('/')) {
    const seg = raw.trim().toLowerCase();
    if (!seg || isDynamicSegment(seg) || STRUCTURAL.has(seg)) continue;
    if (!/^[a-z][a-z0-9-]*$/.test(seg)) continue;
    return seg;
  }
  return undefined;
}

export function laneLabel(id: string): string {
  if (id.length <= 3) return id.toUpperCase();
  return id.replace(/(^|-)([a-z])/g, (_, sep: string, c: string) => (sep ? ' ' : '') + c.toUpperCase());
}

export interface LaneResolution {
  lanes: Lane[];
  /** Hint -> final lane id (or undefined when dropped). */
  resolve(hint: string | undefined): string | undefined;
}

/**
 * Keep lanes that at least two nodes vote for, cap the count, collapse the tail into `other`.
 */
export function resolveLanes(hints: (string | undefined)[], maxLanes: number): LaneResolution {
  const counts = new Map<string, number>();
  for (const h of hints) if (h) counts.set(h, (counts.get(h) ?? 0) + 1);
  const ranked = [...counts.entries()]
    .filter(([, c]) => c >= 2)
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([id]) => id);
  const kept = ranked.length > maxLanes ? ranked.slice(0, maxLanes - 1) : ranked;
  const collapsed = new Set(ranked.slice(kept.length));
  const lanes: Lane[] = kept.map((id) => ({ id, label: laneLabel(id) }));
  if (collapsed.size) lanes.push({ id: 'other', label: 'Other', description: `Collapsed lanes: ${[...collapsed].join(', ')}` });
  const keptSet = new Set(kept);
  return {
    lanes,
    resolve: (hint) => (hint && keptSet.has(hint) ? hint : hint && collapsed.has(hint) ? 'other' : undefined),
  };
}

const VOTING_KINDS = new Set(['page', 'component', 'module', 'service', 'route', 'table', 'job', 'function', 'external', 'store', 'queue']);

/**
 * Fill lanes for nodes that have none: a node adopts the lane of its neighbours when they
 * unanimously agree (shared utilities touched from several lanes stay lane-less), children
 * inherit from parents, and a lane-less parent adopts its children's unanimous lane.
 *
 * Votes are counted against a snapshot taken before the pass, so lanes do not chain-react
 * through shared code (a base layout must not become "checkout" because a checkout layout
 * that became "checkout" imports it). Middleware never votes: it is cross-cutting by definition.
 */
export function propagateLanes(nodes: SysNode[], edges: SysEdge[], passes = 1): void {
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const neighbours = new Map<string, Set<string>>();
  const link = (a: string, b: string) => {
    if (!neighbours.has(a)) neighbours.set(a, new Set());
    neighbours.get(a)!.add(b);
  };
  for (const e of edges) {
    link(e.from, e.to);
    link(e.to, e.from);
  }
  const children = new Map<string, SysNode[]>();
  for (const n of nodes) if (n.parent) (children.get(n.parent) ?? children.set(n.parent, []).get(n.parent)!).push(n);

  for (let pass = 0; pass < passes; pass++) {
    const snapshot = new Map(nodes.map((n) => [n.id, n.lane]));
    for (const n of [...nodes].sort((a, b) => a.id.localeCompare(b.id))) {
      if (n.lane || !VOTING_KINDS.has(n.kind)) continue;
      const votes = new Set<string>();
      for (const other of neighbours.get(n.id) ?? []) {
        if (byId.get(other)?.kind === 'middleware') continue;
        const lane = snapshot.get(other);
        if (lane && lane !== 'other') votes.add(lane);
      }
      if (votes.size === 1) n.lane = [...votes][0];
    }
    for (const n of nodes) {
      if (n.lane) continue;
      const kids = children.get(n.id);
      if (!kids?.length) continue;
      const set = new Set(kids.map((k) => k.lane).filter(Boolean));
      if (set.size === 1 && kids.every((k) => k.lane)) n.lane = [...set][0];
    }
    for (const n of nodes) {
      if (n.lane || !n.parent) continue;
      const parentLane = byId.get(n.parent)?.lane;
      if (parentLane) n.lane = parentLane;
    }
  }
}
