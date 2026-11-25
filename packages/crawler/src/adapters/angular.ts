/**
 * Angular: file suffixes name the kind (`.component.ts`, `.service.ts`, `.guard.ts`, ...), `Routes`
 * arrays name the pages, NgRx / signal stores are stores, `HttpClient` calls are API edges.
 */
import { baseOf, dirOf, firstDocSentence, stripExt } from '../fs.ts';
import { laneHintFromPath } from '../lanes.ts';
import type { Adapter, Draft, GroupKey, SourceFile } from '../types.ts';
import { pageDraft, pageGroup, simpleDraft, srcRootOf, withExports } from './drafts.ts';
import { preClassify } from './generic.ts';
import { routeArraysIn, type RouteHit } from './route-tables.ts';

const SUFFIX_RE = /\.(component|service|guard|interceptor|resolver|pipe|directive|module|store|reducer|effects|actions|selectors|facade|routes|routing\.module|config|model|models|interface|interfaces|enum|types?|constants?|util|utils|helpers?|validators?|tokens?|mock|mocks)\.ts$/;

function featureDir(file: SourceFile): { dir: string; label: string; hint: string | undefined } {
  const srcRoot = srcRootOf(file);
  const within = file.rel.slice(srcRoot.length).replace(/^app\//, '');
  const segs = dirOf(within).split('/').filter(Boolean);
  const feature = segs.slice(0, 2);
  const appRoot = srcRoot + (file.rel.slice(srcRoot.length).startsWith('app/') ? 'app/' : '');
  const dir = appRoot + (feature.length ? feature.join('/') + '/' : '');
  return { dir, label: feature.join('/') || 'app', hint: laneHintFromPath(feature.join('/')) };
}

function group(file: SourceFile, kind: GroupKey['kind'], layer: string, noun: string, min: number): GroupKey {
  const f = featureDir(file);
  return { id: `${kind}s:${f.dir}`, label: f.label, kind, layer, laneHint: f.hint, dir: f.dir, summaryNoun: noun, min };
}

function selectorOf(text: string): string | undefined {
  return /selector\s*:\s*['"`]([^'"`]+)['"`]/.exec(text)?.[1];
}

export const angular: Adapter = {
  id: 'angular',
  priority: 70,
  detect: (ctx) => ctx.frameworks.has('angular'),
  prepare(ctx) {
    const pages = new Map<string, string[]>();
    const candidates = ctx.sources.filter((f) => /(routes|routing\.module|app\.config|app\.routes|main)\.ts$/.test(f.rel) || /\bRoutes\s*=\s*\[/.test(f.text));
    // pass 1: which route files are reached through loadChildren (they are not roots, their paths are prefixed)
    const children = new Set<string>();
    for (const f of candidates) routeArraysIn(f, ctx, { onChildFile: (file) => children.add(file) });
    // pass 2: parse from the roots only
    for (const f of candidates) {
      if (children.has(f.rel)) continue;
      const hits: RouteHit[] = routeArraysIn(f, ctx);
      for (const h of hits) if (h.file) (pages.get(h.file) ?? pages.set(h.file, []).get(h.file)!).push(h.path);
    }
    ctx.scratch.set('angular.pages', pages);
  },
  classify(file, ctx) {
    const pre = preClassify(file);
    if (pre) return pre;
    if (file.ext !== 'ts') {
      if (file.ext === 'html' || file.ext === 'scss' || file.ext === 'css') return { kind: 'skip' };
      return undefined;
    }
    const m = SUFFIX_RE.exec(file.rel);
    const base = stripExt(baseOf(file.rel));
    const text = file.text;
    const pages = ctx.scratch.get('angular.pages') as Map<string, string[]> | undefined;
    const kind = m?.[1];
    const srcRoot = srcRootOf(file);
    const name = base.replace(/\.(component|service|guard|interceptor|resolver|pipe|directive|module|store|reducer|effects|actions|selectors|facade|routes|routing\.module)$/, '');

    if (kind === 'component' || /@Component\(/.test(text)) {
      const routes = pages?.get(file.rel);
      if (routes?.length) {
        // the most specific path is the page's own; shorter ones are parents / redirects
        const routePath = [...routes].sort((a, b) => b.length - a.length)[0]!;
        const draft = pageDraft(file.rel, routePath, text, 'angular', pageGroup(routePath, featureDir(file).dir, ctx.opts.routeGroupMin));
        draft.summary = firstDocSentence(text) ?? `${name} (${selectorOf(text) ?? 'component'})`;
        draft.meta = { ...draft.meta, selector: selectorOf(text), routes: routes.length > 1 ? routes : undefined };
        return { kind: 'node', draft };
      }
      const draft = simpleDraft(file, 'component', 'client', name, firstDocSentence(text) ?? `<${selectorOf(text) ?? name}>`, group(file, 'component', 'client', 'components', ctx.opts.dirGroupMin), { tags: ['angular'] });
      return { kind: 'node', draft };
    }
    if (kind === 'pipe' || kind === 'directive') {
      return { kind: 'node', draft: simpleDraft(file, 'component', 'client', `${name} ${kind}`, firstDocSentence(text) ?? `Angular ${kind}`, group(file, 'component', 'client', 'components', ctx.opts.dirGroupMin), { tags: ['angular', kind] }) };
    }
    if (kind === 'guard' || kind === 'interceptor' || kind === 'resolver') {
      const d = simpleDraft(file, 'middleware', 'edge', `${name} ${kind}`, firstDocSentence(text) ?? `Angular ${kind}`, group(file, 'middleware', 'edge', 'guards', ctx.opts.dirGroupMin), { tags: ['angular', kind] });
      return { kind: 'node', draft: d };
    }
    if (kind === 'store' || kind === 'reducer' || kind === 'effects' || kind === 'actions' || kind === 'selectors' || kind === 'facade' || /\b(signalStore|createReducer|createFeature|createActionGroup|createEffect)\(/.test(text)) {
      const storeName = /createFeature\(\s*\{\s*name\s*:\s*['"`](\w+)/.exec(text)?.[1] ?? /\bfeatureKey\s*=\s*['"`](\w+)/.exec(text)?.[1] ?? name;
      const d: Draft = {
        id: `store:${file.rel}`,
        label: `${storeName} ${kind ?? 'store'}`,
        kind: 'store',
        layer: 'client',
        summary: firstDocSentence(text) ?? (/signalStore\(/.test(text) ? 'Signal store' : 'NgRx state'),
        files: [{ path: file.rel, role: 'source' }],
        tags: ['angular', /signalStore\(/.test(text) ? 'signals' : 'ngrx'],
        group: { ...group(file, 'store', 'client', 'state slices', ctx.opts.dirGroupMin), id: `state:${featureDir(file).dir}`, label: `${featureDir(file).label} state` },
        laneHint: featureDir(file).hint,
        ownedFiles: [file.rel],
      };
      return { kind: 'node', draft: d };
    }
    if (kind === 'service' || /@Injectable\(/.test(text)) {
      const http = /\bHttpClient\b/.test(text);
      const d = simpleDraft(file, 'service', 'client', name, firstDocSentence(text) ?? (http ? 'Calls the API' : 'Injectable service'), group(file, 'service', 'client', 'services', ctx.opts.dirGroupMin), { tags: ['angular', ...(http ? ['http'] : [])] });
      return { kind: 'node', draft: withExports(d, ctx) };
    }
    if (kind === 'module' || /@NgModule\(/.test(text)) {
      return { kind: 'node', draft: simpleDraft(file, 'module', 'client', `${name} module`, firstDocSentence(text) ?? 'NgModule', group(file, 'module', 'client', 'modules', ctx.opts.dirGroupMin), { tags: ['angular', 'ngmodule'] }) };
    }
    if (kind === 'routes' || kind === 'routing.module' || /^(main|app\.config)$/.test(base)) {
      return { kind: 'node', draft: simpleDraft(file, 'config', 'client', base === 'main' ? 'bootstrap' : `${name} routes`, firstDocSentence(text) ?? (base === 'main' ? 'Application bootstrap' : 'Route table'), group(file, 'config', 'client', 'route tables', 2), { tags: ['angular'] }) };
    }
    if (kind && /^(model|models|interface|interfaces|enum|types?|constants?|util|utils|helpers?|validators?|tokens?|config)$/.test(kind)) {
      const d = simpleDraft(file, 'module', 'client', base, firstDocSentence(text) ?? `${kind} definitions`, group(file, 'module', 'client', 'modules', ctx.opts.dirGroupMin), { tags: ['angular'] });
      return { kind: 'node', draft: withExports(d, ctx) };
    }
    if (kind === 'mock' || kind === 'mocks') return { kind: 'skip' };
    // other .ts under src/app: a client module in its feature group
    if (file.rel.slice(srcRoot.length).startsWith('app/')) {
      const d = simpleDraft(file, 'module', 'client', base, firstDocSentence(text), group(file, 'module', 'client', 'modules', ctx.opts.dirGroupMin), { tags: ['angular'] });
      return { kind: 'node', draft: withExports(d, ctx) };
    }
    return undefined;
  },
};
