/** Astro: `src/pages/**` (.astro/.md = page, .ts/.js or api/ = endpoint). Also claims `src/pages` for Vite SPAs. */
import { stripExt } from '../fs.ts';
import type { Adapter } from '../types.ts';
import { pageDraft, pageGroup, routeDraft, routeGroup, srcRootOf, tidyRoute } from './drafts.ts';
import { middlewareFile, preClassify } from './generic.ts';

export const astro: Adapter = {
  id: 'astro',
  priority: 50,
  // src/pages is a convention shared by Astro and plain Vite apps
  detect: (ctx) => ctx.frameworks.has('astro') || ctx.hasFile(/(^|\/)src\/pages\//),
  classify(file, ctx) {
    const pre = preClassify(file);
    if (pre) return pre;
    const mw = middlewareFile(file);
    if (mw) return mw;
    const srcRoot = srcRootOf(file);
    const within = file.rel.slice(srcRoot.length);
    if (!within.startsWith('pages/') || !(srcRoot.endsWith('src/') || ctx.frameworks.has('astro'))) return undefined;
    if (ctx.frameworks.has('next') && !ctx.frameworks.has('astro')) return undefined; // Next's pages router owns src/pages
    const noExt = stripExt(within);
    const sub = noExt.slice('pages/'.length);
    const segs = sub.split('/');
    if (segs.some((s) => s.startsWith('_'))) return { kind: 'skip' };
    const routePath = tidyRoute(segs);
    const isEndpoint = sub.startsWith('api/') || /^(ts|js|mts|mjs)$/.test(file.ext);
    const pagesDir = `${srcRoot}pages/`;
    const fw = ctx.frameworks.has('astro') ? 'astro' : file.pkg.frameworks.find((f) => f !== 'unknown' && f !== 'vite') ?? 'vite';
    if (isEndpoint) return { kind: 'node', draft: routeDraft(file.rel, routePath, file.text, fw, routeGroup(routePath, pagesDir, ctx.opts.routeGroupMin)) };
    if (/^(md|mdx)$/.test(file.ext) && !ctx.frameworks.has('astro')) return { kind: 'skip' };
    return { kind: 'node', draft: pageDraft(file.rel, routePath, file.text, fw, pageGroup(routePath, pagesDir, ctx.opts.routeGroupMin)) };
  },
};
