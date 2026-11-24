/**
 * @codehud/crawler — v0 heuristic crawler for JS/TS web apps.
 *
 * Pipeline (all deterministic, no third-party deps):
 *   1. discover packages + frameworks + externals from package.json files
 *   2. walk the repo, read source files, build a file-level import graph
 *   3. classify each file into a draft node (page, route, middleware, component, service, module...)
 *   4. find persistence: drizzle tables, prisma models, wrangler bindings
 *   5. group drafts by directory / route prefix, roll up oversized groups
 *   6. derive edges: imports/renders, fetch -> route, table reads/writes, bindings, externals
 *   7. derive lanes from route + directory hints, then propagate to neighbours
 *   8. validate against @codehud/schema and return
 */
import { resolve } from 'node:path';
// TODO: import from '@codehud/schema' once the workspace is installed (pnpm install at the root).
import type { FileRef, SysEdge, SysNode, SystemMap } from '../../schema/src/index.ts';
import { FALLBACK_LAYERS, loadSchemaRuntime } from './schema-runtime.ts';
import { classifyFile, type Classified } from './classify.ts';
import { buildEdges, routeEntry, type RouteEntry } from './edges.ts';
import { scanEnvExternals } from './env-externals.ts';
import { CODE_EXTS, baseOf, dirOf, posix, readText, walk } from './fs.ts';
import { EXTERNALS, discoverPackages, externalFor, mergedFrameworks, packageFor } from './framework.ts';
import { scanImports } from './imports.ts';
import { laneHintFromPath, propagateLanes, resolveLanes } from './lanes.ts';
import { scanPersistence } from './persistence.ts';
import type { CrawlOptions, Draft, EdgeDraft, ImportRecord, ResolvedOptions, SourceFile } from './types.ts';

export type { CrawlOptions } from './types.ts';

export const GENERATOR = { name: '@codehud/crawler', version: '0.0.1' };

const LAYER_ORDER = new Map(FALLBACK_LAYERS.map((l, i) => [l.id, i]));
const STRONG_LANE_KINDS = new Set(['page', 'route', 'service', 'module']);
const TEXT_EXTS = new Set([...CODE_EXTS, 'md', 'mdx', 'json', 'jsonc', 'toml', 'yaml', 'yml', 'prisma']);

function resolveOptions(opts: CrawlOptions): ResolvedOptions {
  return {
    name: opts.name,
    maxChildren: opts.maxChildren ?? 12,
    maxLanes: opts.maxLanes ?? 8,
    dirGroupMin: opts.dirGroupMin ?? 2,
    routeGroupMin: opts.routeGroupMin ?? 3,
    includeTests: opts.includeTests ?? true,
    lowConfidenceEdges: opts.lowConfidenceEdges ?? true,
    ignore: opts.ignore ?? [],
  };
}

interface Grouped {
  nodes: Draft[];
  /** rolled-up leaf id -> rollup node id */
  replaced: Map<string, string>;
}

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
  const tokens = label
    .replace(/([a-z])([A-Z])/g, '$1_$2')
    .toLowerCase()
    .split(/[_\-.]/)
    .filter(Boolean);
  for (const lane of laneIds) if (tokens.some((t) => t === lane || t.startsWith(lane) || lane.startsWith(t) && t.length >= 4)) return lane;
  return undefined;
}

export async function crawl(root: string, options: CrawlOptions = {}): Promise<SystemMap> {
  const opts = resolveOptions(options);
  const schema = await loadSchemaRuntime();
  const rootAbs = posix(resolve(root));
  const packages = discoverPackages(rootAbs);
  const frameworks = mergedFrameworks(packages);
  const files = walk(rootAbs, opts.ignore);
  const fileSet = new Set(files.map((f) => f.rel));
  const dirs = new Set<string>();
  for (const f of files) {
    let d = dirOf(f.rel);
    while (d && !dirs.has(d)) { dirs.add(d); d = dirOf(d); }
  }

  const sources: SourceFile[] = [];
  const others: SourceFile[] = [];
  for (const f of files) {
    if (!TEXT_EXTS.has(f.ext) && f.base !== 'Dockerfile') continue;
    const pkg = packageFor(f.rel, packages);
    if (CODE_EXTS.has(f.ext)) sources.push({ ...f, text: readText(f.abs), pkg });
    else others.push({ ...f, text: '', pkg });
  }

  // file-level import graph
  const importsOf = new Map<string, ImportRecord[]>();
  const fanIn = new Map<string, number>();
  const importedPkgs = new Set<string>();
  for (const s of sources) {
    const recs = scanImports(s, fileSet);
    importsOf.set(s.rel, recs);
    for (const r of recs) {
      if (r.file) fanIn.set(r.file, (fanIn.get(r.file) ?? 0) + 1);
      if (r.pkg) importedPkgs.add(r.pkg);
    }
  }

  // classify
  const ctx = { frameworks, opts };
  const drafts: Draft[] = [];
  const configFiles: string[] = [];
  const testsByPkg = new Map<string, string[]>();
  const attachments: Extract<Classified, { kind: 'attach' }>[] = [];
  for (const s of [...sources, ...others]) {
    const c = classifyFile(s, ctx);
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

  // persistence + externals
  const persistence = scanPersistence(files, sources);
  drafts.push(...persistence.drafts);
  const externalPkgs = new Map<string, Set<string>>();
  const depNames = new Set<string>(importedPkgs);
  for (const p of packages) for (const d of Object.keys(p.deps)) depNames.add(d);
  for (const dep of [...depNames].sort()) {
    const def = externalFor(dep);
    if (def) (externalPkgs.get(def.id) ?? externalPkgs.set(def.id, new Set()).get(def.id)!).add(dep);
  }
  for (const def of EXTERNALS) {
    const pkgs = externalPkgs.get(def.id);
    if (!pkgs) continue;
    drafts.push({
      id: `external:${def.id}`,
      label: def.label,
      kind: 'external',
      layer: 'external',
      summary: `npm: ${[...pkgs].join(', ')}`,
      tags: def.tags,
      meta: { packages: [...pkgs] },
      ownedFiles: [],
    });
  }
  const envExternals = scanEnvExternals(sources, new Set(drafts.filter((d) => d.kind === 'external').map((d) => d.id)));
  drafts.push(...envExternals.drafts);

  // the module that defines the tables gets a schema summary instead of the first table's doc comment
  const tablesByFile = new Map<string, string[]>();
  for (const t of persistence.drafts) {
    const f = t.kind === 'table' ? t.files?.[0]?.path : undefined;
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
      const pkg = packages.find((p) => p.dir === dir) ?? packages[0]!;
      drafts.push({
        id: `tests:${dir || 'root'}`,
        label: packages.length > 1 && dir ? `tests (${pkg.name})` : 'tests',
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
  const { nodes, replaced } = applyGroups(drafts, fanIn, dirs, opts);
  const owner = new Map<string, string>();
  for (const n of nodes) for (const f of n.ownedFiles) owner.set(f, n.id);
  const nodeMap = new Map<string, SysNode>(nodes.map((n) => [n.id, n]));

  // routes index (after rollup so fetch edges land on the visible node)
  const routes: RouteEntry[] = [];
  for (const d of drafts) {
    if (!d.routePath || (d.kind !== 'page' && d.kind !== 'route')) continue;
    routes.push(routeEntry(replaced.get(d.id) ?? d.id, d.kind, d.routePath));
  }

  // edges
  const edgeDrafts: EdgeDraft[] = buildEdges({
    sources,
    importsOf,
    owner,
    nodes: nodeMap,
    routes,
    persistence,
    externals: new Set(nodes.filter((n) => n.kind === 'external').map((n) => n.id)),
    envExternals: envExternals.byPrefix,
    opts,
  });

  // lanes
  const strongHints = nodes.filter((n) => STRONG_LANE_KINDS.has(n.kind)).map((n) => n.laneHint);
  const laneRes = resolveLanes(strongHints, opts.maxLanes);
  const laneIds = new Set(laneRes.lanes.map((l) => l.id).filter((id) => id !== 'other'));
  for (const n of nodes) {
    const lane = laneRes.resolve(n.laneHint);
    if (lane) n.lane = lane;
    else if (n.kind === 'table') n.lane = tableLaneByName(n.label, laneIds);
  }
  propagateLanes(nodes, edgeDrafts);
  const usedLanes = new Set(nodes.map((n) => n.lane).filter(Boolean));
  const lanes = laneRes.lanes.filter((l) => usedLanes.has(l.id));

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
      if (!node.meta || !Object.keys(node.meta).length) delete node.meta;
      return node;
    });
  const finalEdges: SysEdge[] = edgeDrafts.map(({ confidence, ...e }) => ({ ...e, meta: { ...e.meta, confidence } }));

  const rootPkg = packages[0]!;
  const fwList = [...frameworks];
  const map: SystemMap = {
    version: 1,
    name: opts.name ?? rootPkg.name,
    description: `Heuristic crawl (${fwList.length ? fwList.join(', ') : 'no framework detected'}); ${sources.length} source files, ${finalNodes.length} nodes, ${finalEdges.length} edges.`,
    root: rootAbs,
    generatedAt: new Date().toISOString(),
    generator: GENERATOR,
    layers: schema.WELL_KNOWN_LAYERS,
    lanes,
    nodes: finalNodes,
    edges: finalEdges,
  };
  const result = schema.validateSystemMap(map);
  if (!result.ok) throw new Error(`crawler produced an invalid SystemMap:\n  ${result.errors.join('\n  ')}`);
  return result.map;
}

export { laneHintFromPath };
