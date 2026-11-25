/** Draft builders shared by the framework adapters. */
import type { NodeKind } from '../../../schema/src/index.ts';
import { baseOf, dirOf, firstDocSentence, stripExt } from '../fs.ts';
import { laneHintFromPath } from '../lanes.ts';
import type { CrawlContext, Draft, ExportInfo, Framework, GroupKey, SourceFile } from '../types.ts';

const EXPORTED_METHOD_RE = /export\s+(?:const|let|async\s+function|function)\s+(GET|POST|PUT|PATCH|DELETE|OPTIONS|HEAD|ALL)\b/g;
const METHODS_ORDER = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS', 'HEAD', 'ALL'];

export function tidyRoute(segments: string[]): string {
  const kept = segments
    .filter((s) => s && !/^\(.*\)$/.test(s) && !s.startsWith('@'))
    .map((s) => s.replace(/^\$(\w+)$/, '[$1]').replace(/^\$$/, '[...rest]').replace(/^:(\w+)\??$/, '[$1]').replace(/^<(?:\w+:)?(\w+)>$/, '[$1]'));
  if (kept[kept.length - 1] === 'index') kept.pop();
  return '/' + kept.join('/');
}

export function fileRef(rel: string, role = 'source') {
  return { path: rel, role };
}

export function exportedMethods(text: string): string[] {
  const set = new Set<string>();
  for (const m of text.matchAll(EXPORTED_METHOD_RE)) set.add(m[1]!);
  return METHODS_ORDER.filter((m) => set.has(m));
}

/** `src/` root of the file's package (root-relative, trailing slash) or the package dir itself. */
export function srcRootOf(file: SourceFile): string {
  const pkgPrefix = file.pkg.dir ? file.pkg.dir + '/' : '';
  const within = file.rel.slice(pkgPrefix.length);
  if (within.startsWith('src/')) return pkgPrefix + 'src/';
  if (within.startsWith('app/') && !/^app\/(routes|api)\//.test(within) && file.pkg.frameworks.includes('nuxt')) return pkgPrefix + 'app/';
  return pkgPrefix;
}

export function pkgPrefixOf(file: SourceFile): string {
  return file.pkg.dir ? file.pkg.dir + '/' : '';
}

export function pageDraft(rel: string, routePath: string, text: string, fw: Framework | string, group: GroupKey | undefined): Draft {
  const title = /\btitle\s*=\s*["']([^"'\n]{1,80})["']/.exec(text)?.[1] ?? /<title>([^<\n]{1,80})<\/title>/.exec(text)?.[1];
  const summary = title ? `${title}` : `Page ${routePath}`;
  return {
    id: `page:${rel}`,
    label: routePath,
    kind: 'page',
    layer: 'client',
    summary,
    files: [fileRef(rel)],
    tags: [fw],
    meta: { path: routePath, framework: fw },
    routePath,
    laneHint: laneHintFromPath(routePath),
    group,
    ownedFiles: [rel],
  };
}

export function routeDraft(rel: string, routePath: string, text: string, fw: Framework | string, group: GroupKey | undefined, methods = exportedMethods(text)): Draft {
  const label = methods.length ? `${methods.join(', ')} ${routePath}` : routePath;
  return {
    id: `route:${rel}`,
    label,
    kind: 'route',
    layer: 'api',
    summary: firstDocSentence(text, /export\s+(?:const|let|async\s+function|function|default)\s/) ?? label,
    files: [fileRef(rel)],
    tags: [fw],
    meta: { method: methods.length === 1 ? methods[0] : methods, path: routePath, framework: fw },
    routePath,
    laneHint: laneHintFromPath(routePath),
    group,
    ownedFiles: [rel],
  };
}

export function pageGroup(routePath: string, pagesDir: string, min: number): GroupKey | undefined {
  const first = routePath.split('/').filter(Boolean)[0];
  if (!first) return undefined;
  const prefix = `/${first}`;
  return {
    id: `pages:${prefix}`,
    label: `${prefix}/*`,
    kind: 'page',
    layer: 'client',
    laneHint: laneHintFromPath(prefix),
    dir: `${pagesDir}${first}/`,
    summaryNoun: 'pages',
    min,
  };
}

export function routeGroup(routePath: string, apiDir: string, min: number): GroupKey | undefined {
  const segs = routePath.split('/').filter(Boolean);
  const idx = segs[0] === 'api' ? 1 : 0;
  const first = segs[idx];
  if (!first) return undefined;
  const prefix = '/' + segs.slice(0, idx + 1).join('/');
  return {
    id: `routes:${prefix}`,
    label: `${prefix}/*`,
    kind: 'route',
    layer: 'api',
    laneHint: laneHintFromPath(prefix),
    dir: `${apiDir}${segs.slice(0, idx + 1).join('/')}/`,
    summaryNoun: 'routes',
    min,
  };
}

export function componentDraft(file: SourceFile, componentsDir: string, srcRoot: string, min: number): Draft {
  const relToComponents = file.rel.slice(componentsDir.length);
  const sub = relToComponents.includes('/') ? relToComponents.split('/')[0]! : '';
  const dir = sub ? `${componentsDir}${sub}/` : componentsDir;
  const label = dir.slice(srcRoot.length).replace(/\/$/, '') || dir.replace(/\/$/, '');
  const group: GroupKey = {
    id: `components:${dir}`,
    label,
    kind: 'component',
    layer: 'client',
    laneHint: laneHintFromPath(dir.slice(srcRoot.length)),
    dir,
    summaryNoun: 'components',
    min,
  };
  const ext = file.ext;
  const flavour = ext === 'svelte' ? 'Svelte' : ext === 'astro' ? 'Astro' : ext === 'vue' ? 'Vue' : ext === 'tsx' || ext === 'jsx' ? 'React' : 'UI';
  return {
    id: `component:${file.rel}`,
    label: stripExt(baseOf(file.rel)),
    kind: 'component',
    layer: 'client',
    // single-file components indent their script, so accept an indented doc block
    summary: firstDocSentence(file.text, /^(svelte|vue|astro)$/.test(ext) ? 'any' : undefined) ?? `${flavour} component`,
    files: [fileRef(file.rel)],
    group,
    laneHint: group.laneHint,
    ownedFiles: [file.rel],
  };
}

/** Attach `meta.exports` / `meta.signature` from the TS export summary, when the file has one. */
export function withExports(draft: Draft, ctx: CrawlContext): Draft {
  const rel = draft.ownedFiles[0];
  const exps = rel ? ctx.exportsOf.get(rel) : undefined;
  if (!exps?.length) return draft;
  const fns = exps.filter((e) => e.kind === 'function' && e.signature);
  const meta: Record<string, unknown> = { ...draft.meta };
  if (fns.length === 1 && exps.filter((e) => e.kind !== 'type').length === 1) meta.signature = fns[0]!.signature;
  const names = exps.filter((e) => e.kind !== 'type').map((e) => e.name).slice(0, 12);
  if (names.length) meta.exports = names;
  draft.meta = meta;
  return draft;
}

export function moduleDraft(file: SourceFile, srcRoot: string, ctx: CrawlContext): Draft {
  const within = file.rel.slice(srcRoot.length);
  const dirSegs = dirOf(within).split('/').filter(Boolean);
  const groupSegs = dirSegs.slice(0, 2);
  const dir = srcRoot + (groupSegs.length ? groupSegs.join('/') + '/' : '');
  const pathLower = file.rel.toLowerCase();
  const isClientExt = /^(svelte|vue|tsx|jsx)$/.test(file.ext);
  const clientDir = /(^|\/)(components|layouts|ui|stores|hooks|composables|client|islands)\//.test(within);
  const apiDir = /(^|\/)(routes|controllers|handlers|api|actions|functions|endpoints)\//.test(within) && file.pkg.role !== 'frontend';
  const serverAction = /^\s*['"]use server['"]/.test(file.text);
  const edge = /(^|\/)(middleware|middlewares|guards)\//.test(within);
  let layer: string;
  if (edge) layer = 'edge';
  else if (serverAction || apiDir) layer = 'api';
  else if (isClientExt || clientDir || file.pkg.role === 'frontend') layer = 'client';
  else if (file.pkg.role === 'server' && dirSegs.length === 0) layer = 'api'; // the entry of a server package
  else layer = 'domain';
  const service = /(^|\/)(services?|server|domain|core|usecases?|use-cases)\//.test(within) || /^lib\/[^/]+\//.test(within) || /^src\/lib\/[^/]+\//.test(within);
  const kind: NodeKind = layer === 'api' && !serverAction ? 'module' : service ? 'service' : 'module';
  const groupLabel = (dir.replace(/\/$/, '') || 'root').replace(/^src\//, '').replace(/\/src$/, '') || 'src';
  const group: GroupKey = {
    id: `module:${dir || './'}`,
    label: groupLabel,
    kind,
    layer,
    laneHint: laneHintFromPath(within.split('/').slice(0, -1).slice(0, 2).join('/')),
    dir,
    summaryNoun: 'modules',
    min: ctx.opts.dirGroupMin,
  };
  const labelBase = stripExt(baseOf(file.rel));
  const owningDir = groupSegs.length ? groupSegs[groupSegs.length - 1]! : file.pkg.dir.split('/').pop() || dirOf(file.rel).split('/').pop() || '';
  const label = groupSegs.length || /^(index|main|app|server)$/.test(labelBase) ? `${owningDir}/${labelBase}` : labelBase;
  const draft: Draft = {
    id: `${kind}:${file.rel}`,
    label,
    kind,
    layer,
    summary: firstDocSentence(file.text),
    files: [fileRef(file.rel)],
    tags: serverAction ? ['server-actions'] : undefined,
    group,
    laneHint: group.laneHint,
    ownedFiles: [file.rel],
  };
  if (pathLower.includes('/schema') || /(^|\/)schema\.[cm]?[jt]s$/.test(pathLower)) draft.tags = [...(draft.tags ?? []), 'schema'];
  return withExports(draft, ctx);
}

/** A node for a file that a framework convention names directly (guard, store, job...). */
export function simpleDraft(file: SourceFile, kind: NodeKind, layer: string, label: string, summary: string | undefined, group: GroupKey | undefined, extra: Partial<Draft> = {}): Draft {
  return {
    id: `${kind}:${file.rel}`,
    label,
    kind,
    layer,
    summary: summary ?? firstDocSentence(file.text, 'any'),
    files: [fileRef(file.rel)],
    group,
    laneHint: group?.laneHint ?? laneHintFromPath(file.rel.slice(srcRootOf(file).length)),
    ownedFiles: [file.rel],
    ...extra,
  };
}

export function dirGroup(id: string, label: string, kind: NodeKind, layer: string, dir: string, noun: string, min: number, laneHint?: string): GroupKey {
  return { id, label, kind, layer, dir, summaryNoun: noun, min, laneHint };
}

export function exportsSummary(exps: ExportInfo[] | undefined): string | undefined {
  if (!exps?.length) return undefined;
  const names = exps.filter((e) => e.kind !== 'type').map((e) => e.name);
  if (!names.length) return undefined;
  return `exports ${names.slice(0, 5).join(', ')}${names.length > 5 ? `, +${names.length - 5}` : ''}`;
}
