import type { EdgeKind, NodeKind, SysEdge, SysNode } from '../../schema/src/index.ts';

export interface CrawlOptions {
  /** Map name; defaults to the root package.json name or the directory name. */
  name?: string;
  /** Leaf children kept under a group before the rest are rolled up (default 12). */
  maxChildren?: number;
  /** Maximum number of lanes; extra lanes collapse into `other` (default 8). */
  maxLanes?: number;
  /** Minimum members for a directory group (default 2) and a route-prefix group (default 3). */
  dirGroupMin?: number;
  routeGroupMin?: number;
  /** Emit a `tests` node per package (default true). */
  includeTests?: boolean;
  /** Emit low-confidence edges (default true). */
  lowConfidenceEdges?: boolean;
  /** Extra directory names to ignore. */
  ignore?: string[];
  /** Use the TypeScript compiler API for the import graph when available (default true). */
  typescript?: boolean;
  /** Apply `.codehud/map.overrides.json` from the crawl root (default true). */
  overlay?: boolean;
  /** Only run these adapters (ids); default all that detect. */
  adapters?: string[];
}

export type ResolvedOptions = Required<Omit<CrawlOptions, 'name' | 'adapters'>> & { name?: string; adapters?: string[] };

export type Framework =
  | 'astro'
  | 'next'
  | 'sveltekit'
  | 'remix'
  | 'express'
  | 'hono'
  | 'fastify'
  | 'koa'
  | 'vite'
  | 'angular'
  | 'vue'
  | 'nuxt'
  | 'react'
  | 'react-router'
  | 'tanstack-router'
  | 'nest'
  | 'cdk'
  | 'serverless'
  | 'sam'
  | 'terraform'
  | 'python'
  | 'fastapi'
  | 'flask'
  | 'django'
  | 'unknown';

export type PackageRole = 'frontend' | 'server' | 'library';

export interface PackageInfo {
  /** Directory relative to root, '' for the root package. No trailing slash. */
  dir: string;
  name: string;
  deps: Record<string, string>;
  frameworks: Framework[];
  role: PackageRole;
  /** Path-alias prefixes (e.g. '@/' -> 'src/') relative to root, from tsconfig paths + conventions. */
  aliases: Record<string, string>;
  /** Language ecosystem the manifest came from. */
  ecosystem?: 'node' | 'python';
}

export interface RepoFile {
  /** Root-relative, forward slashes. */
  rel: string;
  abs: string;
  /** Lower-case extension without the dot. */
  ext: string;
  /** Basename. */
  base: string;
}

export interface SourceFile extends RepoFile {
  text: string;
  pkg: PackageInfo;
}

export interface ImportRecord {
  spec: string;
  /** Resolved root-relative file for relative/alias imports. */
  file?: string;
  /** npm package name for bare imports. */
  pkg?: string;
  /** Named (non-type) imports. */
  names: string[];
  /** The whole import is `import type` / `export type`. */
  typeOnly?: boolean;
}

export interface ExportInfo {
  name: string;
  kind: 'function' | 'class' | 'const' | 'type' | 'default' | 'other';
  /** `name(params): ret` for functions, `class X extends Y` for classes. */
  signature?: string;
}

export type Confidence = 'high' | 'medium' | 'low';

/** A node before grouping; `group` keys decide the parent, `laneHint` feeds lane resolution. */
export interface Draft extends SysNode {
  group?: GroupKey;
  laneHint?: string;
  routePath?: string;
  /** Files whose ownership this node claims (for the file -> node map). */
  ownedFiles: string[];
}

export interface GroupKey {
  id: string;
  label: string;
  kind: NodeKind;
  layer: string;
  laneHint?: string;
  /** Directory the group covers (root-relative, trailing slash), when it has one. */
  dir?: string;
  summaryNoun: string;
  min: number;
}

export interface EdgeDraft extends SysEdge {
  confidence: Confidence;
}

export type Classified =
  | { kind: 'node'; draft: Draft; extra?: Draft[] }
  | { kind: 'config' }
  | { kind: 'test' }
  | { kind: 'attach'; toId: string; role: string; fallback: Draft }
  | { kind: 'skip' };

/** Everything the adapters share while crawling one repository. */
export interface CrawlContext {
  /** Absolute crawl root, forward slashes. */
  root: string;
  opts: ResolvedOptions;
  packages: PackageInfo[];
  frameworks: Set<Framework>;
  /** Every file outside ignored directories, sorted. */
  files: RepoFile[];
  fileSet: Set<string>;
  /** Every directory that contains a file (root-relative, no trailing slash). */
  dirs: Set<string>;
  /** Code files with their text and owning package. */
  sources: SourceFile[];
  /** Other text files (config, docs, infra) with text loaded lazily via `textOf`. */
  others: SourceFile[];
  textOf(rel: string): string;
  /** Union of dependency names across all manifests. */
  deps: Set<string>;
  hasDep(name: string | RegExp): boolean;
  hasFile(pattern: RegExp): boolean;
  importsOf: Map<string, ImportRecord[]>;
  exportsOf: Map<string, ExportInfo[]>;
  fanIn: Map<string, number>;
  importedPkgs: Set<string>;
  /** true when the TypeScript compiler API produced the import graph. */
  tsImports: boolean;
  /** Per-adapter scratch space (route tables found in `prepare`). */
  scratch: Map<string, unknown>;
}

/** Nodes and lookup tables produced by repo-wide scans (ORMs, infra, externals). */
export interface ScanOutput {
  drafts: Draft[];
  /** code identifier (exported table/model/entity name) -> node id, with the adapter that owns it */
  idents: Map<string, { id: string; via: string }>;
  /** lowerFirst(prisma model) -> table node id */
  prismaModels: Map<string, string>;
  /** Worker binding name -> store/queue node id, with the kind of resource. */
  bindings: Map<string, { id: string; type: string }>;
  /** infra logical name / terraform address / construct id -> node id */
  resources: Map<string, string>;
  /** environment variable name -> node id it points at (TABLE_NAME -> table node) */
  envRefs: Map<string, string>;
  /** edges declared by infrastructure, between scan node ids */
  edges: EdgeDraft[];
  /** source file -> infra nodes that deploy it (lambda handler files); the first one owns the file */
  handlers: Map<string, string[]>;
}

export interface RouteEntry {
  nodeId: string;
  kind: 'page' | 'route';
  segments: string[];
  rest: boolean;
}

export interface EdgeContext {
  ctx: CrawlContext;
  sources: SourceFile[];
  importsOf: Map<string, ImportRecord[]>;
  /** file -> owning node id */
  owner: Map<string, string>;
  nodes: Map<string, SysNode>;
  routes: RouteEntry[];
  scan: ScanOutput;
  /** external node ids present in the map */
  externals: Set<string>;
  /** env-var prefix (e.g. CRM) -> external node id */
  envExternals: Map<string, string>;
  opts: ResolvedOptions;
}

export interface EdgeSink {
  add(from: string, to: string, kind: EdgeKind, confidence: Confidence, via: string, label?: string): void;
}

/**
 * One convention the crawler understands (a framework, an ORM, an infra format). Adapters only
 * read files; none of them may import or execute anything from the crawled repository.
 */
export interface Adapter {
  id: string;
  /** Higher runs earlier when classifying; the generic adapter is lowest. */
  priority?: number;
  /** Extra extensions treated as code (python: 'py'). */
  codeExts?: string[];
  detect(ctx: CrawlContext): boolean;
  /** Once per crawl, before classification: route tables, DI graphs, anything cross-file. */
  prepare?(ctx: CrawlContext): void;
  /** Import records for languages the TS scanner does not cover; undefined = not mine. */
  imports?(file: SourceFile, ctx: CrawlContext): ImportRecord[] | undefined;
  /** Classify one file; undefined = not mine, let the next adapter try. */
  classify?(file: SourceFile, ctx: CrawlContext): Classified | undefined;
  /** Repo-wide scan for persistence, infrastructure, externals. */
  scan?(ctx: CrawlContext, out: ScanOutput): void;
  /** Per-source-file edges once all nodes exist (`from` is the file's owning node). */
  edges?(file: SourceFile, from: string, ectx: EdgeContext, sink: EdgeSink): void;
}
