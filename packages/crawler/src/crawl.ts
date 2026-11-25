/**
 * @codehud/crawler — turns a repository into a SystemMap without executing any of it.
 *
 * Pipeline (deterministic; adapters supply the convention-specific parts):
 *   1. context: packages + frameworks from manifests, file walk, source texts
 *   2. adapters that detect the repo; import graph (TypeScript compiler API, regex fallback, python)
 *   3. prepare: cross-file tables (router configs)
 *   4. classify every file into a draft node (first adapter by priority that claims it)
 *   5. scan: persistence, infrastructure, externals; infra "handlers" absorb their source files
 *   6. group by directory / route prefix, roll up oversized groups
 *   7. edges: imports, HTTP calls, navigation, plus each adapter's own signals; infra-declared edges
 *   8. lanes: route vocabulary, else workspace packages; propagate to neighbours
 *   9. overlay (.codehud/map.overrides.json), validate
 */
import { WELL_KNOWN_LAYERS, validateSystemMap, type FileRef, type SysEdge, type SysNode, type SystemMap } from '../../schema/src/index.ts';
import { ADAPTERS } from './adapters/index.ts';
import { EdgeBag, routeEntry, buildEdges } from './edges.ts';
import { packageFor } from './framework.ts';
import { baseOf, dirOf } from './fs.ts';
import { withGuard } from './guard.ts';
import { buildContext, buildImportGraph } from './context.ts';
import { packageLanes, propagateLanes, resolveLanes } from './lanes.ts';
import { applyOverlay, readOverlay } from './overlay.ts';
import type { Adapter, Classified, CrawlContext, CrawlOptions, Draft, EdgeDraft, ResolvedOptions, RouteEntry, ScanOutput } from './types.ts';

export const GENERATOR = { name: '@codehud/crawler', version: '0.1.0' };

const LAYER_ORDER = new Map(WELL_KNOWN_LAYERS.map((l, i) => [l.id, i]));
const STRONG_LANE_KINDS = new Set(['page', 'route', 'service', 'module']);

export interface CrawlResult {
  map: SystemMap;
  /** adapter ids that took part */
  adapters: string[];
  /** overlay warnings (unknown ids) */
  warnings: string[];
  tsImports: boolean;
  overlayApplied: boolean;
}

interface Grouped { nodes: Draft[]; replaced: Map<string, string> }

function applyGroups(drafts: Draft[], fanIn: Map<string, number>, dirs: Set<string>, opts: ResolvedOptions): Grouped {
  const byGroup = new Map<string, { key: Draft['group'] & object; members: Draft[] }>();
  for (const d of drafts) {
    if (!d.group) continue;
    const entry = byGroup.get(d.group.id) ?? { key: d.group, members: [] };
    entry.members.push(d);
    byGroup.set(d.group.id, entry);
  }
  const removed = new Set<string>();
  const added: Draft[] = [];
  const replaced = new Map<string, string>();
  for (const { key, members } of [...byGroup.values()].sort((a, b) => a.key.id.localeCompare(b.key.id))) {
    for (const m of members) m.laneHint ??= key.laneHint;
    if (members.length < key.min) continue;
    const dirRef: FileRef[] | undefined = key.dir && dirs.has(key.dir.replace(/\/$/, '')) ? [{ path: key.dir, role: 'source' }] : undefined;
    const group: Draft = {
      id: key.id,
      label: key.label,
      kind: key.kind,
      layer: key.layer,
      summary: `${members.length} ${key.summaryNoun}`,
      files: dirRef ?? members.flatMap((m) => m.files ?? []),
      tags: ['group'],
      laneHint: key.laneHint,
      ownedFiles: [],
    };
    added.push(group);
    members.sort((a, b) => (fanIn.get(b.ownedFiles[0] ?? '') ?? 0) - (fanIn.get(a.ownedFiles[0] ?? '') ?? 0) || a.id.localeCompare(b.id));
    const keep = members.length > opts.maxChildren ? members.slice(0, opts.maxChildren - 1) : members;
    const rest = members.slice(keep.length);
    for (const m of keep) m.parent = key.id;
    if (rest.length) {
      const rollup: Draft = {
        id: `${key.id}+more`,
        label: `+${rest.length} more`,
        kind: key.kind,
        layer: key.layer,
        parent: key.id,
        summary: rest.map((r) => r.label).slice(0, 8).join(', ') + (rest.length > 8 ? ', …' : ''),
        files: rest.flatMap((r) => r.files ?? []),
        tags: ['rollup'],
        meta: { rolledUp: rest.map((r) => r.id) },
        laneHint: key.laneHint,
        ownedFiles: rest.flatMap((r) => r.ownedFiles),
      };
      added.push(rollup);
      for (const r of rest) {
        removed.add(r.id);
        replaced.set(r.id, rollup.id);
      }
    }
  }
  const nodes = [...drafts.filter((d) => !removed.has(d.id)), ...added];
  for (const n of nodes) if (n.parent && replaced.has(n.parent)) n.parent = replaced.get(n.parent);
  return { nodes, replaced };
}

function tableLaneByName(label: string, laneIds: Set<string>): string | undefined {
  const tokens = label.replace(/([a-z])([A-Z])/g, '$1_$2').toLowerCase().split(/[_\-.]/).filter(Boolean);
  for (const lane of laneIds) if (tokens.some((t) => t === lane || t.startsWith(lane) || (lane.startsWith(t) && t.length >= 4))) return lane;
  return undefined;
}

function emptyScan(): ScanOutput {
  return { drafts: [], idents: new Map(), prismaModels: new Map(), bindings: new Map(), resources: new Map(), envRefs: new Map(), edges: [], handlers: new Map() };
}

export function activeAdapters(ctx: CrawlContext): Adapter[] {
  const wanted = ctx.opts.adapters ? new Set(ctx.opts.adapters) : undefined;
  return ADAPTERS.filter((a) => (wanted ? wanted.has(a.id) || a.id === 'generic' : true) && a.detect(ctx));
}

export async function crawl(root: string, options: CrawlOptions = {}): Promise<SystemMap> {
  return (await crawlDetailed(root, options)).map;
}

export async function crawlDetailed(root: string, options: CrawlOptions = {}): Promise<CrawlResult> {
  return withGuard(root, async () => crawlUnguarded(root, options));
}

async function crawlUnguarded(root: string, options: CrawlOptions): Promise<CrawlResult> {
  // adapters that add code extensions (python) need to be known before sources are read, so detect twice
  const probe = buildContext(root, options, new Set());
  const extraExts = new Set<string>();
  for (const a of ADAPTERS) if (a.codeExts && a.detect(probe)) for (const e of a.codeExts) extraExts.add(e);
  const ctx = extraExts.size ? buildContext(root, options, extraExts) : probe;
  const opts = ctx.opts;
  const adapters = activeAdapters(ctx);
  const byPriority = [...adapters].sort((a, b) => (b.priority ?? 0) - (a.priority ?? 0));

  buildImportGraph(ctx, adapters);
  for (const a of adapters) a.prepare?.(ctx);

  // classify
  const drafts: Draft[] = [];
  const configFiles: string[] = [];
  const testsByPkg = new Map<string, string[]>();
  const attachments: Extract<Classified, { kind: 'attach' }>[] = [];
  for (const s of [...ctx.sources, ...ctx.others]) {
    let c: Classified | undefined;
    for (const a of byPriority) {
      c = a.classify?.(s, ctx);
      if (c) break;
    }
    if (!c || c.kind === 'skip') continue;
    if (c.kind === 'config') configFiles.push(s.rel);
    else if (c.kind === 'test') (testsByPkg.get(s.pkg.dir) ?? testsByPkg.set(s.pkg.dir, []).get(s.pkg.dir)!).push(s.rel);
    else if (c.kind === 'node') drafts.push(c.draft, ...(c.extra ?? []));
    else if (c.kind === 'attach') attachments.push(c);
  }
  for (const a of attachments) {
    const target = drafts.find((d) => d.id === a.toId);
    if (target) {
      target.files = [...(target.files ?? []), { path: a.fallback.files![0]!.path, role: a.role }];
      target.ownedFiles.push(a.fallback.files![0]!.path);
    } else drafts.push(a.fallback);
  }

  // scans
  const scan = emptyScan();
  for (const a of adapters) a.scan?.(ctx, scan);
  // infra function nodes absorb the source files they deploy
  for (const [file, nodeIds] of scan.handlers) {
    const fns = nodeIds.map((id) => scan.drafts.find((d) => d.id === id)).filter((d): d is Draft => !!d);
    if (!fns.length) continue;
    const idx = drafts.findIndex((d) => d.ownedFiles.includes(file));
    const source = idx >= 0 ? drafts[idx]! : undefined;
    fns.forEach((fn, i) => {
      fn.files = [...(fn.files ?? []), { path: file, role: 'source' }];
      if (i === 0) fn.ownedFiles.push(file); // the first deployer owns the file for edge attribution
      if (source) {
        if (source.summary && !/^Lambda/.test(source.summary)) fn.summary = source.summary;
        if (source.meta?.exports) fn.meta = { ...fn.meta, exports: source.meta.exports };
      }
    });
    if (source) {
      // a module with route children (express inside lambda): keep the children under the function
      for (const d of drafts) if (d.parent === source.id) d.parent = fns[0]!.id;
      drafts.splice(idx, 1);
    }
  }
  drafts.push(...scan.drafts);

  // the module that defines the tables gets a schema summary instead of the first table's doc comment
  const tablesByFile = new Map<string, string[]>();
  for (const t of scan.drafts) {
    const f = t.kind === 'table' && t.files?.[0]?.role === 'schema' ? t.files[0].path : undefined;
    if (f) (tablesByFile.get(f) ?? tablesByFile.set(f, []).get(f)!).push(t.label);
  }
  for (const [file, tables] of tablesByFile) {
    const owner = drafts.find((d) => d.ownedFiles.includes(file));
    if (!owner) continue;
    owner.summary = `${tables.length} table${tables.length === 1 ? '' : 's'}: ${tables.slice(0, 8).join(', ')}${tables.length > 8 ? ', …' : ''}`;
    if (!owner.tags?.includes('schema')) owner.tags = [...(owner.tags ?? []), 'schema'];
  }

  // tests + config
  if (opts.includeTests) {
    for (const [dir, list] of [...testsByPkg.entries()].sort()) {
      const pkg = ctx.packages.find((p) => p.dir === dir) ?? ctx.packages[0]!;
      drafts.push({
        id: `tests:${dir || 'root'}`,
        label: ctx.packages.length > 1 && dir ? `tests (${pkg.name})` : 'tests',
        kind: 'test',
        layer: 'domain',
        summary: `${list.length} test file${list.length === 1 ? '' : 's'}`,
        files: list.map((p) => ({ path: p, role: 'test' })),
        tags: ['tests'],
        ownedFiles: list,
      });
    }
  }
  if (configFiles.length) {
    const names = [...new Set(configFiles.map(baseOf))];
    drafts.push({
      id: 'config:root',
      label: 'config',
      kind: 'config',
      layer: 'edge',
      summary: names.slice(0, 5).join(', ') + (names.length > 5 ? `, +${names.length - 5} more` : ''),
      files: configFiles.map((p) => ({ path: p, role: 'config' })),
      tags: ['config'],
      ownedFiles: configFiles,
    });
  }

  // grouping
  const { nodes, replaced } = applyGroups(drafts, ctx.fanIn, ctx.dirs, opts);
  const owner = new Map<string, string>();
  for (const n of nodes) for (const f of n.ownedFiles) owner.set(f, n.id);
  const nodeMap = new Map<string, SysNode>(nodes.map((n) => [n.id, n]));
  // parents that vanished (rolled up) or never existed
  for (const n of nodes) if (n.parent && !nodeMap.has(n.parent)) delete n.parent;

  // routes index (after rollup so fetch edges land on the visible node)
  const routes: RouteEntry[] = [];
  for (const d of drafts) {
    if (!d.routePath || (d.kind !== 'page' && d.kind !== 'route')) continue;
    routes.push(routeEntry(replaced.get(d.id) ?? d.id, d.kind, d.routePath));
  }

  // edges
  const envByPrefix = (ctx.scratch.get('env-externals.byPrefix') as Map<string, string> | undefined) ?? new Map();
  const edgeDrafts: EdgeDraft[] = buildEdges({
    ctx,
    sources: ctx.sources,
    importsOf: ctx.importsOf,
    owner,
    nodes: nodeMap,
    routes,
    scan,
    externals: new Set(nodes.filter((n) => n.kind === 'external').map((n) => n.id)),
    envExternals: envByPrefix,
    opts,
  }, adapters);
  // infra-declared edges, through rollups and the same ancestor / confidence rules as code edges
  const edgeIds = new Set(edgeDrafts.map((e) => e.id));
  const infraBag = new EdgeBag(nodeMap, opts.lowConfidenceEdges ? 'low' : 'medium');
  for (const e of scan.edges) infraBag.add(replaced.get(e.from) ?? e.from, replaced.get(e.to) ?? e.to, e.kind, e.confidence, String(e.meta?.via ?? 'infra'), e.label);
  for (const e of infraBag.edges.values()) if (!edgeIds.has(e.id!)) { edgeIds.add(e.id!); edgeDrafts.push(e); }
  edgeDrafts.sort((a, b) => a.id!.localeCompare(b.id!));

  // lanes: route / directory vocabulary first; a workspace without it gets package lanes
  const strongHints = nodes.filter((n) => STRONG_LANE_KINDS.has(n.kind)).map((n) => n.laneHint);
  const routeHints = drafts.filter((d) => d.routePath).map((d) => d.laneHint);
  let laneRes = resolveLanes(strongHints, opts.maxLanes);
  const routeLanes = resolveLanes(routeHints, opts.maxLanes).lanes.filter((l) => l.id !== 'other').length;
  let lanes = laneRes.lanes;
  const pkgLanes = routeLanes < 2 ? packageLanes(nodes, ctx.packages, opts.maxLanes) : undefined;
  if (pkgLanes) {
    lanes = pkgLanes.lanes;
    for (const n of nodes) { const l = pkgLanes.laneOfNode.get(n.id); if (l) n.lane = l; }
    laneRes = { lanes, resolve: () => undefined };
  } else {
    const laneIds = new Set(lanes.map((l) => l.id).filter((id) => id !== 'other'));
    for (const n of nodes) {
      const lane = laneRes.resolve(n.laneHint);
      if (lane) n.lane = lane;
      else if (n.kind === 'table') n.lane = tableLaneByName(n.label, laneIds);
    }
  }
  propagateLanes(nodes, edgeDrafts);
  const usedLanes = new Set(nodes.map((n) => n.lane).filter(Boolean));
  lanes = lanes.filter((l) => usedLanes.has(l.id));

  // assemble
  const depth = (n: SysNode): number => {
    let d = 0;
    let cur: SysNode | undefined = n;
    const seen = new Set<string>();
    while (cur?.parent && !seen.has(cur.parent)) { seen.add(cur.parent); d++; cur = nodeMap.get(cur.parent); }
    return d;
  };
  const finalNodes: SysNode[] = nodes
    .sort((a, b) => depth(a) - depth(b) || (LAYER_ORDER.get(a.layer) ?? 9) - (LAYER_ORDER.get(b.layer) ?? 9) || a.id.localeCompare(b.id))
    .map((d) => {
      const { group: _g, laneHint: _h, routePath: _r, ownedFiles: _o, ...node } = d;
      void _g; void _h; void _r; void _o;
      if (!node.lane) delete node.lane;
      if (!node.summary) delete node.summary;
      if (!node.tags?.length) delete node.tags;
      if (!node.files?.length) delete node.files;
      if (node.meta) node.meta = Object.fromEntries(Object.entries(node.meta).filter(([, v]) => v !== undefined && !(Array.isArray(v) && v.length === 0)));
      if (!node.meta || !Object.keys(node.meta).length) delete node.meta;
      return node;
    });
  const finalEdges: SysEdge[] = edgeDrafts.map(({ confidence, ...e }) => ({ ...e, meta: { ...e.meta, confidence } }));

  const rootPkg = ctx.packages[0]!;
  const fwList = [...ctx.frameworks].filter((f) => f !== 'unknown');
  let map: SystemMap = {
    version: 1,
    name: opts.name ?? rootPkg.name,
    description: `Heuristic crawl (${fwList.length ? fwList.join(', ') : 'no framework detected'}); ${ctx.sources.length} source files, ${finalNodes.length} nodes, ${finalEdges.length} edges.`,
    root: ctx.root,
    generatedAt: new Date().toISOString(),
    generator: GENERATOR,
    layers: WELL_KNOWN_LAYERS,
    lanes,
    nodes: finalNodes,
    edges: finalEdges,
  };

  // overlay
  let warnings: string[] = [];
  let overlayApplied = false;
  if (opts.overlay) {
    const o = readOverlay(ctx.root);
    if (o) {
      const r = applyOverlay(map, o.overlay);
      map = r.map;
      warnings = r.warnings;
      overlayApplied = true;
      map.description = `${map.description} Overlay applied from ${o.path.slice(ctx.root.length + 1).replace(/\\/g, '/')}.`;
    }
  }

  const result = validateSystemMap(map);
  if (!result.ok) throw new Error(`crawler produced an invalid SystemMap:\n  ${result.errors.join('\n  ')}`);
  return { map: result.map, adapters: adapters.map((a) => a.id), warnings, tsImports: ctx.tsImports, overlayApplied };
}

export { dirOf, packageFor };
