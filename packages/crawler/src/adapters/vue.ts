/**
 * Vue + Nuxt: Nuxt's directories (`pages/`, `server/api/`, `server/routes/`, `middleware/`,
 * `composables/`, `stores/`, `layouts/`, `plugins/`), vue-router route arrays for plain Vue apps,
 * and Pinia `defineStore` stores.
 */
import { baseOf, dirOf, firstDocSentence, stripExt } from '../fs.ts';
import { laneHintFromPath } from '../lanes.ts';
import type { Adapter, Draft, SourceFile } from '../types.ts';
import { componentDraft, dirGroup, pageDraft, pageGroup, pkgPrefixOf, routeDraft, routeGroup, simpleDraft, srcRootOf, tidyRoute, withExports } from './drafts.ts';
import { preClassify } from './generic.ts';
import { routeArraysIn } from './route-tables.ts';

const METHOD_SUFFIX = /\.(get|post|put|patch|delete|head|options)$/;

/** Nuxt app root: `app/` when it exists (Nuxt 4), else the package root. */
function nuxtRoot(file: SourceFile): string {
  const prefix = pkgPrefixOf(file);
  const within = file.rel.slice(prefix.length);
  return within.startsWith('app/') && !within.startsWith('app/routes/') ? prefix + 'app/' : prefix;
}

export const vue: Adapter = {
  id: 'vue',
  priority: 65,
  detect: (ctx) => ctx.frameworks.has('vue') || ctx.frameworks.has('nuxt') || ctx.hasFile(/\.vue$/),
  prepare(ctx) {
    const pages = new Map<string, string[]>();
    for (const f of ctx.sources) {
      if (!/\b(createRouter|createWebHistory|RouteRecordRaw)\b/.test(f.text) && !/(^|\/)router(\/index)?\.[jt]s$/.test(f.rel)) continue;
      for (const h of routeArraysIn(f, ctx)) if (h.file && !h.layout) (pages.get(h.file) ?? pages.set(h.file, []).get(h.file)!).push(h.path);
    }
    ctx.scratch.set('vue.pages', pages);
  },
  classify(file, ctx) {
    const pre = preClassify(file);
    if (pre) return pre;
    const text = file.text;
    const nuxt = ctx.frameworks.has('nuxt');
    const prefix = pkgPrefixOf(file);
    const withinPkg = file.rel.slice(prefix.length);

    if (nuxt) {
      const appRoot = nuxtRoot(file);
      const within = file.rel.slice(appRoot.length);
      const serverMatch = /^server\/(api|routes|middleware|plugins|utils|tasks)\/(.+)$/.exec(withinPkg);
      if (serverMatch && /^(ts|js|mjs)$/.test(file.ext)) {
        const kind = serverMatch[1]!;
        const sub = stripExt(serverMatch[2]!);
        if (kind === 'api' || kind === 'routes') {
          const method = METHOD_SUFFIX.exec(sub)?.[1]?.toUpperCase();
          const clean = sub.replace(METHOD_SUFFIX, '');
          const routePath = tidyRoute([...(kind === 'api' ? ['api'] : []), ...clean.split('/')]);
          const dir = `${prefix}server/${kind}/`;
          const d = routeDraft(file.rel, routePath, text, 'nuxt', routeGroup(routePath, dir, ctx.opts.routeGroupMin), method ? [method] : []);
          d.summary = firstDocSentence(text) ?? d.label;
          return { kind: 'node', draft: d };
        }
        if (kind === 'middleware') return { kind: 'node', draft: simpleDraft(file, 'middleware', 'edge', `server ${baseOf(sub)}`, firstDocSentence(text) ?? 'Nitro server middleware', dirGroup(`middleware:${prefix}server/middleware/`, 'server middleware', 'middleware', 'edge', `${prefix}server/middleware/`, 'middleware', 2), { tags: ['nuxt'] }) };
        if (kind === 'tasks') return { kind: 'node', draft: simpleDraft(file, 'job', 'domain', baseOf(sub), firstDocSentence(text) ?? 'Nitro task', dirGroup(`jobs:${prefix}server/tasks/`, 'tasks', 'job', 'domain', `${prefix}server/tasks/`, 'tasks', 2), { tags: ['nuxt'] }) };
        const d = simpleDraft(file, 'module', 'domain', `server/${sub}`, firstDocSentence(text), dirGroup(`module:${prefix}server/${kind}/`, `server/${kind}`, 'module', 'domain', `${prefix}server/${kind}/`, 'modules', ctx.opts.dirGroupMin), { tags: ['nuxt'] });
        return { kind: 'node', draft: withExports(d, ctx) };
      }
      if (/^pages\//.test(within) && file.ext === 'vue') {
        const sub = stripExt(within.slice('pages/'.length));
        const routePath = tidyRoute(sub.split('/').map((s) => s.replace(/^\[\.\.\.(\w+)\]$/, '[...$1]')));
        return { kind: 'node', draft: pageDraft(file.rel, routePath, text, 'nuxt', pageGroup(routePath, `${appRoot}pages/`, ctx.opts.routeGroupMin)) };
      }
      if (/^middleware\//.test(within)) {
        return { kind: 'node', draft: simpleDraft(file, 'middleware', 'edge', stripExt(baseOf(file.rel)).replace(/\.global$/, ' (global)'), firstDocSentence(text) ?? 'Route middleware', dirGroup(`middleware:${appRoot}middleware/`, 'route middleware', 'middleware', 'edge', `${appRoot}middleware/`, 'middleware', 2), { tags: ['nuxt'] }) };
      }
      if (/^layouts\//.test(within)) {
        const d = componentDraft(file, `${appRoot}layouts/`, appRoot, ctx.opts.dirGroupMin);
        d.group = dirGroup(`components:${appRoot}layouts/`, 'layouts', 'component', 'client', `${appRoot}layouts/`, 'layouts', ctx.opts.dirGroupMin);
        d.label = `${stripExt(baseOf(file.rel))} layout`;
        return { kind: 'node', draft: d };
      }
      if (/^(composables|utils|plugins)\//.test(within)) {
        const kind = within.split('/')[0]!;
        const d = simpleDraft(file, 'module', 'client', stripExt(baseOf(file.rel)), firstDocSentence(text), dirGroup(`module:${appRoot}${kind}/`, kind, 'module', 'client', `${appRoot}${kind}/`, kind, ctx.opts.dirGroupMin), { tags: ['nuxt'] });
        return { kind: 'node', draft: withExports(d, ctx) };
      }
    }

    // Pinia stores anywhere
    if (/\bdefineStore\(\s*(['"`])([\w-]+)\1/.test(text) || /^(?:.*\/)?stores?\/[^/]+\.[jt]s$/.test(withinPkg)) {
      const name = /\bdefineStore\(\s*(['"`])([\w-]+)\1/.exec(text)?.[2] ?? stripExt(baseOf(file.rel));
      const srcRoot = srcRootOf(file);
      const storesDir = `${dirOf(file.rel)}/`;
      const d: Draft = {
        id: `store:${file.rel}`,
        label: `${name} store`,
        kind: 'store',
        layer: 'client',
        summary: firstDocSentence(text) ?? 'Pinia store',
        files: [{ path: file.rel, role: 'source' }],
        tags: ['pinia'],
        group: dirGroup(`state:${storesDir}`, 'stores', 'store', 'client', storesDir, 'stores', 2),
        laneHint: laneHintFromPath(file.rel.slice(srcRoot.length)),
        ownedFiles: [file.rel],
      };
      return { kind: 'node', draft: d };
    }

    // vue-router pages (views/ or anything a route table points at)
    const routes = (ctx.scratch.get('vue.pages') as Map<string, string[]> | undefined)?.get(file.rel);
    if (routes?.length && file.ext === 'vue') {
      const srcRoot = srcRootOf(file);
      const routePath = [...routes].sort((a, b) => a.length - b.length)[0]!;
      const viewsDir = /^((?:[\w.-]+\/)*?(?:views|pages|screens)\/)/.exec(file.rel.slice(srcRoot.length))?.[1];
      const d = pageDraft(file.rel, routePath, text, 'vue', pageGroup(routePath, srcRoot + (viewsDir ?? ''), ctx.opts.routeGroupMin));
      d.summary = firstDocSentence(text, 'any') ?? d.summary;
      if (routes.length > 1) d.meta = { ...d.meta, routes };
      return { kind: 'node', draft: d };
    }
    if (file.ext === 'vue') {
      const srcRoot = srcRootOf(file);
      const within = file.rel.slice(srcRoot.length);
      const m = /^((?:[\w.-]+\/)*?(?:views|screens)\/)/.exec(within);
      if (m) {
        const d = componentDraft(file, srcRoot + m[1]!, srcRoot, ctx.opts.dirGroupMin);
        d.tags = ['vue', 'view'];
        return { kind: 'node', draft: d };
      }
    }
    return undefined;
  },
};
