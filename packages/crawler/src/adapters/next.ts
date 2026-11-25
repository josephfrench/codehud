/** Next.js: app router (`app/**\/page|route|layout`) and pages router (`pages/**`, `pages/api/**`). */
import { baseOf, dirOf, stripExt } from '../fs.ts';
import type { Adapter } from '../types.ts';
import { componentDraft, pageDraft, pageGroup, pkgPrefixOf, routeDraft, routeGroup, tidyRoute } from './drafts.ts';
import { middlewareFile, preClassify } from './generic.ts';

export const next: Adapter = {
  id: 'next',
  priority: 60,
  detect: (ctx) => ctx.frameworks.has('next') || ctx.hasFile(/(^|\/)app\/(page|layout)\.(tsx|jsx|ts|js)$/),
  classify(file, ctx) {
    const pre = preClassify(file);
    if (pre) return pre;
    const mw = middlewareFile(file);
    if (mw) return mw;
    const pkgPrefix = pkgPrefixOf(file);
    const withinPkg = file.rel.slice(pkgPrefix.length);

    const appMatch = /^((?:src\/)?app\/)(.*)$/.exec(withinPkg);
    if (appMatch && /^(tsx|jsx|ts|js|mdx)$/.test(file.ext) && !ctx.frameworks.has('nuxt') && !ctx.frameworks.has('remix')) {
      const appDir = pkgPrefix + appMatch[1]!;
      const sub = appMatch[2]!;
      const base = stripExt(baseOf(sub));
      const dirSegs = dirOf(sub).split('/');
      if (base === 'route') {
        const routePath = tidyRoute(dirSegs);
        return { kind: 'node', draft: routeDraft(file.rel, routePath, file.text, 'next', routeGroup(routePath, appDir, ctx.opts.routeGroupMin)) };
      }
      if (base === 'page') {
        const routePath = tidyRoute(dirSegs);
        return { kind: 'node', draft: pageDraft(file.rel, routePath, file.text, 'next', pageGroup(routePath, appDir, ctx.opts.routeGroupMin)) };
      }
      if (/^(layout|loading|error|not-found|template|default|global-error)$/.test(base)) {
        const draft = componentDraft(file, appDir, appDir, ctx.opts.dirGroupMin);
        draft.group = { id: `components:${appDir}`, label: 'app shell', kind: 'component', layer: 'client', dir: appDir, summaryNoun: 'layouts', min: ctx.opts.dirGroupMin };
        draft.label = `${dirSegs.filter(Boolean).pop() ?? 'root'} ${base}`;
        return { kind: 'node', draft };
      }
    }

    if (ctx.frameworks.has('next') && /^(src\/)?pages\//.test(withinPkg) && /^(tsx|jsx|ts|js|mdx|md)$/.test(file.ext)) {
      const sub = stripExt(withinPkg.replace(/^(src\/)?pages\//, ''));
      if (/^_(app|document|error)$/.test(sub)) return { kind: 'skip' };
      const routePath = tidyRoute(sub.split('/'));
      const pagesDir = pkgPrefix + (withinPkg.startsWith('src/') ? 'src/pages/' : 'pages/');
      if (sub.startsWith('api/')) return { kind: 'node', draft: routeDraft(file.rel, routePath, file.text, 'next', routeGroup(routePath, pagesDir, ctx.opts.routeGroupMin)) };
      return { kind: 'node', draft: pageDraft(file.rel, routePath, file.text, 'next', pageGroup(routePath, pagesDir, ctx.opts.routeGroupMin)) };
    }
    return undefined;
  },
};
