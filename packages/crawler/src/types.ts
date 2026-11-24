// TODO: switch to `import type { ... } from '@codehud/schema'` once the workspace is installed.
import type { NodeKind, SysNode, SysEdge } from '../../schema/src/index.ts';

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
}

export type ResolvedOptions = Required<Omit<CrawlOptions, 'name'>> & { name?: string };

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
