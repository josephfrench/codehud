/** Builds the CrawlContext: packages, files, sources, and the import graph. */
import { resolve } from 'node:path';
import { discoverPackages, mergedFrameworks, packageFor } from './framework.ts';
import { CODE_EXTS, dirOf, posix, readText, walk } from './fs.ts';
import { scanImportsBest } from './imports-ts.ts';
import type { Adapter, CrawlContext, CrawlOptions, ImportRecord, ResolvedOptions, SourceFile } from './types.ts';

export const TEXT_EXTS = new Set([...CODE_EXTS, 'md', 'mdx', 'json', 'jsonc', 'toml', 'yaml', 'yml', 'prisma', 'tf', 'tfvars', 'sql', 'py', 'env', 'html', 'txt', 'cfg', 'ini', 'graphql', 'gql', 'proto']);

export function resolveOptions(opts: CrawlOptions): ResolvedOptions {
  return {
    name: opts.name,
    maxChildren: opts.maxChildren ?? 12,
    maxLanes: opts.maxLanes ?? 8,
    dirGroupMin: opts.dirGroupMin ?? 2,
    routeGroupMin: opts.routeGroupMin ?? 3,
    includeTests: opts.includeTests ?? true,
    lowConfidenceEdges: opts.lowConfidenceEdges ?? true,
    ignore: opts.ignore ?? [],
    typescript: opts.typescript ?? true,
    overlay: opts.overlay ?? true,
    adapters: opts.adapters,
  };
}

/** Files + packages; no import graph yet (adapters decide which extensions are code first). */
export function buildContext(root: string, options: CrawlOptions, extraCodeExts: Set<string>): CrawlContext {
  const opts = resolveOptions(options);
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
  const codeExts = new Set([...CODE_EXTS, ...extraCodeExts]);
  const sources: SourceFile[] = [];
  const others: SourceFile[] = [];
  const textCache = new Map<string, string>();
  const byRel = new Map(files.map((f) => [f.rel, f]));
  const textOf = (rel: string) => {
    const hit = textCache.get(rel);
    if (hit !== undefined) return hit;
    const f = byRel.get(rel);
    const t = f ? readText(f.abs) : '';
    textCache.set(rel, t);
    return t;
  };
  for (const f of files) {
    if (!TEXT_EXTS.has(f.ext) && f.base !== 'Dockerfile' && f.base !== 'Procfile' && f.base !== 'Pipfile') continue;
    const pkg = packageFor(f.rel, packages);
    if (codeExts.has(f.ext)) { const text = textOf(f.rel); sources.push({ ...f, text, pkg }); }
    else others.push({ ...f, text: '', pkg });
  }
  const deps = new Set<string>();
  for (const p of packages) for (const d of Object.keys(p.deps)) deps.add(d);
  const ctx: CrawlContext = {
    root: rootAbs,
    opts,
    packages,
    frameworks,
    files,
    fileSet,
    dirs,
    sources,
    others,
    textOf,
    deps,
    hasDep: (name) => (typeof name === 'string' ? deps.has(name) : [...deps].some((d) => name.test(d))),
    hasFile: (pattern) => files.some((f) => pattern.test(f.rel)),
    importsOf: new Map(),
    exportsOf: new Map(),
    fanIn: new Map(),
    importedPkgs: new Set(),
    tsImports: false,
    scratch: new Map(),
  };
  return ctx;
}

/** Import graph: adapter-provided for other languages, TS compiler API (or regex) for JS/TS. */
export function buildImportGraph(ctx: CrawlContext, adapters: Adapter[]): void {
  let tsUsed = false;
  for (const s of ctx.sources) {
    let recs: ImportRecord[] | undefined;
    for (const a of adapters) {
      recs = a.imports?.(s, ctx);
      if (recs) break;
    }
    if (!recs) {
      const r = scanImportsBest(s, ctx.fileSet, ctx.root, ctx.opts.typescript);
      recs = r.imports;
      if (r.ts) { tsUsed = true; if (r.exports.length) ctx.exportsOf.set(s.rel, r.exports); }
    }
    ctx.importsOf.set(s.rel, recs);
    for (const r of recs) {
      if (r.file) ctx.fanIn.set(r.file, (ctx.fanIn.get(r.file) ?? 0) + 1);
      if (r.pkg) ctx.importedPkgs.add(r.pkg);
    }
  }
  ctx.tsImports = tsUsed;
}
