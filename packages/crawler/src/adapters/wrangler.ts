/** Cloudflare Workers: wrangler bindings (D1, KV, R2, queues, DOs, Vectorize) and `env.X` usage. */
import type { EdgeKind } from '../../../schema/src/index.ts';
import { parseJsonc } from '../fs.ts';
import type { Adapter, RepoFile, ScanOutput } from '../types.ts';

interface WranglerConfig {
  name?: string;
  d1_databases?: { binding?: string; database_name?: string }[];
  kv_namespaces?: { binding?: string }[];
  r2_buckets?: { binding?: string; bucket_name?: string }[];
  queues?: { producers?: { binding?: string; queue?: string }[]; consumers?: { queue?: string }[] };
  durable_objects?: { bindings?: { name?: string; class_name?: string }[] };
  vectorize?: { binding?: string; index_name?: string }[];
  hyperdrive?: { binding?: string }[];
  triggers?: { crons?: string[] };
}

/** Minimal TOML reader for wrangler.toml arrays-of-tables. Good enough for bindings. */
export function parseWranglerToml(text: string): WranglerConfig {
  const cfg: WranglerConfig = {};
  let current: Record<string, string> | null = null;
  let section = '';
  const push = () => {
    if (!current) return;
    const c = current;
    if (section === 'd1_databases') (cfg.d1_databases ??= []).push({ binding: c.binding, database_name: c.database_name });
    else if (section === 'kv_namespaces') (cfg.kv_namespaces ??= []).push({ binding: c.binding });
    else if (section === 'r2_buckets') (cfg.r2_buckets ??= []).push({ binding: c.binding, bucket_name: c.bucket_name });
    else if (section === 'queues.producers') ((cfg.queues ??= {}).producers ??= []).push({ binding: c.binding, queue: c.queue });
    else if (section === 'queues.consumers') ((cfg.queues ??= {}).consumers ??= []).push({ queue: c.queue });
    else if (section === 'durable_objects.bindings') ((cfg.durable_objects ??= {}).bindings ??= []).push({ name: c.name, class_name: c.class_name });
    else if (section === 'vectorize') (cfg.vectorize ??= []).push({ binding: c.binding, index_name: c.index_name });
    current = null;
  };
  for (const raw of text.split('\n')) {
    const line = raw.replace(/#.*$/, '').trim();
    if (!line) continue;
    const arr = /^\[\[([\w.]+)\]\]$/.exec(line);
    if (arr) { push(); section = arr[1]!.replace(/^env\.\w+\./, ''); current = {}; continue; }
    const tbl = /^\[([\w.]+)\]$/.exec(line);
    if (tbl) { push(); section = tbl[1]!.replace(/^env\.\w+\./, ''); current = section === 'triggers' ? {} : null; continue; }
    const kv = /^(\w+)\s*=\s*"([^"]*)"/.exec(line);
    if (kv && current) current[kv[1]!] = kv[2]!;
    else if (kv && !section && kv[1] === 'name') cfg.name = kv[2];
    const crons = /^crons\s*=\s*\[([^\]]*)\]/.exec(line);
    if (crons && section === 'triggers') cfg.triggers = { crons: [...crons[1]!.matchAll(/"([^"]+)"/g)].map((m) => m[1]!) };
  }
  push();
  return cfg;
}

function wranglerStores(file: RepoFile, text: string, out: ScanOutput): void {
  const cfg = file.ext === 'toml' ? parseWranglerToml(text) : parseJsonc<WranglerConfig>(text);
  if (!cfg) return;
  const configRef = { path: file.rel, role: 'config' };
  const add = (id: string, label: string, binding: string | undefined, type: string, kind: 'store' | 'queue' | 'cache', extra: Record<string, unknown> = {}) => {
    if (out.drafts.some((d) => d.id === id)) return;
    out.drafts.push({
      id,
      label,
      kind,
      layer: 'persistence',
      summary: binding ? `${type.toUpperCase()} binding ${binding}` : type.toUpperCase(),
      files: [configRef],
      tags: ['cloudflare', type],
      meta: { binding, type, ...extra },
      ownedFiles: [],
    });
    if (binding) out.bindings.set(binding, { id, type });
    out.resources.set(id, id);
  };
  for (const d of cfg.d1_databases ?? []) add(`store:d1:${d.database_name ?? d.binding}`, `D1 ${d.database_name ?? d.binding}`, d.binding, 'd1', 'store');
  for (const k of cfg.kv_namespaces ?? []) if (k.binding) add(`store:kv:${k.binding}`, `KV ${k.binding}`, k.binding, 'kv', 'store');
  for (const r of cfg.r2_buckets ?? []) add(`store:r2:${r.bucket_name ?? r.binding}`, `R2 ${r.bucket_name ?? r.binding}`, r.binding, 'r2', 'store');
  for (const q of cfg.queues?.producers ?? []) add(`queue:${q.queue ?? q.binding}`, `Queue ${q.queue ?? q.binding}`, q.binding, 'queue', 'queue');
  for (const q of cfg.queues?.consumers ?? []) if (q.queue) add(`queue:${q.queue}`, `Queue ${q.queue}`, undefined, 'queue', 'queue');
  for (const o of cfg.durable_objects?.bindings ?? []) add(`store:do:${o.class_name ?? o.name}`, `DO ${o.class_name ?? o.name}`, o.name, 'durable-object', 'store');
  for (const v of cfg.vectorize ?? []) add(`store:vectorize:${v.index_name ?? v.binding}`, `Vectorize ${v.index_name ?? v.binding}`, v.binding, 'vectorize', 'store');
  for (const h of cfg.hyperdrive ?? []) if (h.binding) add(`store:hyperdrive:${h.binding}`, `Hyperdrive ${h.binding}`, h.binding, 'hyperdrive', 'store');
  if (cfg.triggers?.crons?.length) {
    out.drafts.push({
      id: `job:cron:${file.rel}`,
      label: 'scheduled worker',
      kind: 'job',
      layer: 'domain',
      summary: `cron: ${cfg.triggers.crons.join(', ')}`,
      files: [configRef],
      tags: ['cloudflare', 'cron'],
      meta: { schedule: cfg.triggers.crons },
      ownedFiles: [],
    });
  }
}

const ENV_BINDING_RE = /\benv\.([A-Z][A-Z0-9_]{1,40})\b/g;

export const wrangler: Adapter = {
  id: 'wrangler',
  detect: (ctx) => ctx.hasFile(/(^|\/)wrangler\.(jsonc?|toml)$/),
  scan(ctx, out) {
    for (const f of ctx.files) if (/^wrangler\.(jsonc?|toml)$/.test(f.base)) wranglerStores(f, ctx.textOf(f.rel), out);
  },
  edges(file, from, ectx, sink) {
    const bindings = ectx.scan.bindings;
    if (!bindings.size) return;
    const text = file.text;
    for (const m of text.matchAll(ENV_BINDING_RE)) {
      const b = bindings.get(m[1]!);
      if (!b) continue;
      let kind: EdgeKind = 'calls';
      if (b.type === 'kv' || b.type === 'r2') {
        const uses = text.slice(m.index!, m.index! + 80);
        kind = /\.(put|delete)\(/.test(uses) ? 'writes' : /\.(get|list|head|getWithMetadata)\(/.test(uses) ? 'reads' : 'calls';
      } else if (b.type === 'queue') kind = 'emits';
      sink.add(from, b.id, kind, 'medium', 'binding', `binding ${m[1]}`);
    }
  },
};
