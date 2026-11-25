/** SvelteKit: `src/routes/**` with `+page.svelte`, `+server.ts`, `+page(.server).ts`, `+layout*`. */
import { baseOf, dirOf } from '../fs.ts';
import type { Adapter } from '../types.ts';
import { componentDraft, pageDraft, pageGroup, routeDraft, routeGroup, srcRootOf, tidyRoute } from './drafts.ts';
import { middlewareFile, preClassify } from './generic.ts';

export const sveltekit: Adapter = {
  id: 'sveltekit',
  priority: 60,
  detect: (ctx) => ctx.frameworks.has('sveltekit') || ctx.hasFile(/(^|\/)src\/routes\/.*\+page\.svelte$/),
  classify(file, ctx) {
    const pre = preClassify(file);
    if (pre) return pre;
    const mw = middlewareFile(file);
    if (mw) return mw;
    const srcRoot = srcRootOf(file);
    const within = file.rel.slice(srcRoot.length);
    if (!(within.startsWith('routes/') && srcRoot.endsWith('src/') && /^\+/.test(baseOf(file.rel)))) return undefined;
    const rel = file.rel;
    const routesDir = `${srcRoot}routes/`;
    const dirSegs = dirOf(within.slice('routes/'.length)).split('/');
    const routePath = tidyRoute(dirSegs);
    const base = baseOf(rel);
    if (base.startsWith('+server.')) return { kind: 'node', draft: routeDraft(rel, routePath, file.text, 'sveltekit', routeGroup(routePath, routesDir, ctx.opts.routeGroupMin)) };
    if (base === '+page.svelte') return { kind: 'node', draft: pageDraft(rel, routePath, file.text, 'sveltekit', pageGroup(routePath, routesDir, ctx.opts.routeGroupMin)) };
    if (/^\+page(\.server)?\.[jt]s$/.test(base)) {
      const fallback = routeDraft(rel, routePath, file.text, 'sveltekit', routeGroup(routePath, routesDir, ctx.opts.routeGroupMin));
      fallback.summary = `load/actions for ${routePath}`;
      return { kind: 'attach', toId: `page:${dirOf(rel)}/+page.svelte`, role: base.includes('.server') ? 'loader' : 'universal-loader', fallback };
    }
    if (/^\+layout/.test(base)) {
      const draft = componentDraft(file, routesDir, srcRoot, ctx.opts.dirGroupMin);
      draft.group = { id: `components:${routesDir}`, label: 'layouts', kind: 'component', layer: 'client', dir: routesDir, summaryNoun: 'layouts', min: ctx.opts.dirGroupMin };
      draft.label = `${routePath} layout`;
      return { kind: 'node', draft };
    }
    return { kind: 'skip' };
  },
};
