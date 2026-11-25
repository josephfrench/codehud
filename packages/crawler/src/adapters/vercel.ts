/**
 * Vercel and Netlify: `vercel.json` crons become jobs that call the matching route, an `api/`
 * directory outside a page framework becomes serverless routes, `netlify/functions/*` become
 * routes, `netlify.toml` scheduled functions become jobs.
 */
import { baseOf, dirOf, stripExt } from '../fs.ts';
import type { Adapter, Draft } from '../types.ts';
import { pkgPrefixOf, routeDraft, routeGroup, tidyRoute } from './drafts.ts';
import { preClassify } from './generic.ts';

export const vercel: Adapter = {
  id: 'vercel',
  priority: 20,
  detect: (ctx) => ctx.hasFile(/(^|\/)vercel\.json$/) || ctx.hasDep('@vercel/node') || ctx.hasFile(/(^|\/)netlify\.toml$/) || ctx.hasFile(/(^|\/)netlify\/functions\//),
  classify(file, ctx) {
    const pre = preClassify(file);
    if (pre) return pre;
    const prefix = pkgPrefixOf(file);
    const withinPkg = file.rel.slice(prefix.length);
    // Vercel serverless functions: <pkg>/api/**/*.(ts|js) when no page framework owns an api dir
    if (/^api\//.test(withinPkg) && /^(ts|js|mjs|cjs|py|go|rb)$/.test(file.ext) && !/(^|\/)_/.test(withinPkg)) {
      const sub = stripExt(withinPkg.slice('api/'.length));
      const routePath = tidyRoute(['api', ...sub.split('/')]);
      const d = routeDraft(file.rel, routePath, file.text, 'vercel', routeGroup(routePath, `${prefix}api/`, ctx.opts.routeGroupMin));
      d.tags = ['vercel', 'serverless'];
      return { kind: 'node', draft: d };
    }
    if (/^netlify\/(functions|edge-functions)\//.test(withinPkg) && /^(ts|js|mjs|cjs)$/.test(file.ext)) {
      const kind = withinPkg.split('/')[1]!;
      const name = stripExt(baseOf(file.rel)) === 'index' ? baseOf(dirOf(file.rel)) : stripExt(baseOf(file.rel));
      const routePath = kind === 'functions' ? `/.netlify/functions/${name}` : `/${name}`;
      const d = routeDraft(file.rel, routePath, file.text, 'netlify', routeGroup(routePath, `${prefix}netlify/${kind}/`, ctx.opts.routeGroupMin), []);
      d.label = kind === 'functions' ? `fn ${name}` : `edge ${name}`;
      d.tags = ['netlify', kind];
      if (kind === 'edge-functions') { d.kind = 'middleware'; d.layer = 'edge'; d.id = `middleware:${file.rel}`; }
      return { kind: 'node', draft: d };
    }
    return undefined;
  },
  scan(ctx, out) {
    for (const f of ctx.files) {
      if (f.base === 'vercel.json') {
        let cfg: { crons?: { path: string; schedule: string }[]; rewrites?: { source: string; destination: string }[]; functions?: Record<string, unknown>; regions?: string[] } | undefined;
        try { cfg = JSON.parse(ctx.textOf(f.rel)); } catch { continue; }
        if (!cfg) continue;
        for (const cron of cfg.crons ?? []) {
          const d: Draft = { id: `job:vercel-cron:${cron.path}`, label: `cron ${cron.path}`, kind: 'job', layer: 'domain', summary: `${cron.schedule} → ${cron.path}`, files: [{ path: f.rel, role: 'config' }], tags: ['vercel', 'cron'], meta: { schedule: cron.schedule, path: cron.path }, routePath: cron.path, ownedFiles: [] };
          out.drafts.push(d);
        }
        for (const rw of cfg.rewrites ?? []) {
          const host = /^https?:\/\/([^/]+)/.exec(rw.destination)?.[1];
          if (!host) continue;
          const id = `external:proxy:${host}`;
          if (!out.drafts.some((d) => d.id === id)) out.drafts.push({ id, label: host, kind: 'external', layer: 'external', summary: `Proxied via vercel.json rewrite ${rw.source}`, files: [{ path: f.rel, role: 'config' }], tags: ['vercel', 'rewrite'], meta: { source: rw.source, destination: rw.destination }, ownedFiles: [] });
        }
      }
      if (f.base === 'netlify.toml') {
        const text = ctx.textOf(f.rel);
        for (const m of text.matchAll(/\[functions\."?([\w-]+)"?\][^[]*?schedule\s*=\s*"([^"]+)"/g)) {
          out.drafts.push({ id: `job:netlify-cron:${m[1]}`, label: `scheduled ${m[1]}`, kind: 'job', layer: 'domain', summary: m[2]!, files: [{ path: f.rel, role: 'config' }], tags: ['netlify', 'cron'], meta: { schedule: m[2], function: m[1] }, ownedFiles: [] });
        }
      }
    }
  },
  edges(file, from, ectx, sink) {
    void file; void from; void ectx; void sink;
  },
};

/** Cron jobs call the route whose path they hit; resolved once routes exist (called by the orchestrator). */
export function vercelCronEdges(out: { drafts: Draft[] }, routes: { nodeId: string; segments: string[] }[], sink: { add(from: string, to: string, kind: 'calls', c: 'high', via: string, label?: string): void }): void {
  for (const d of out.drafts) {
    if (!d.id.startsWith('job:vercel-cron:') && !d.id.startsWith('job:netlify-cron:')) continue;
    const path = d.id.startsWith('job:netlify-cron:') ? `/.netlify/functions/${d.meta?.function}` : String(d.meta?.path ?? '');
    const segs = path.split('/').filter(Boolean);
    const hit = routes.find((r) => r.segments.length === segs.length && r.segments.every((s, i) => s === segs[i] || /^\[/.test(s)));
    if (hit) sink.add(d.id, hit.nodeId, 'calls', 'high', 'cron', d.meta?.schedule ? String(d.meta.schedule) : undefined);
  }
}
