import { lineOfIndex, matchParen, readJsonc, readText } from './fs.ts';
import type { Draft, RepoFile, SourceFile } from './types.ts';

export interface PersistenceResult {
  drafts: Draft[];
  /** drizzle identifier (export name) -> table node id */
  tableIdents: Map<string, string>;
  /** lowerFirst(prisma model) -> table node id */
  prismaModels: Map<string, string>;
  /** Worker binding name -> store/queue node id, with the kind of resource. */
  bindings: Map<string, { id: string; type: string }>;
}

const DRIZZLE_TABLE_RE = /export\s+const\s+(\w+)\s*=\s*(sqliteTable|pgTable|mysqlTable|singlestoreTable)\(\s*['"`]([\w.]+)['"`]/g;
const DRIZZLE_COLUMN_RE =
  /\b(\w+)\s*:\s*(?:t\.)?(text|integer|real|blob|numeric|serial|bigserial|smallserial|varchar|char|boolean|timestamp|date|time|json|jsonb|uuid|bigint|smallint|doublePrecision|decimal|interval|inet|cidr|macaddr|point|line|customType|int|tinyint|mediumint|float|double|datetime|year|binary|varbinary|longtext|mediumtext|tinytext|vector|halfvec|sparsevec|bit|geometry)\s*\(/g;

interface WranglerConfig {
  name?: string;
  d1_databases?: { binding?: string; database_name?: string }[];
  kv_namespaces?: { binding?: string }[];
  r2_buckets?: { binding?: string; bucket_name?: string }[];
  queues?: { producers?: { binding?: string; queue?: string }[]; consumers?: { queue?: string }[] };
  durable_objects?: { bindings?: { name?: string; class_name?: string }[] };
  vectorize?: { binding?: string; index_name?: string }[];
  hyperdrive?: { binding?: string }[];
}

/** Minimal TOML reader for wrangler.toml arrays-of-tables. Good enough for bindings. */
function parseWranglerToml(text: string): WranglerConfig {
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
    else if (section === 'durable_objects.bindings') ((cfg.durable_objects ??= {}).bindings ??= []).push({ name: c.name, class_name: c.class_name });
    else if (section === 'vectorize') (cfg.vectorize ??= []).push({ binding: c.binding, index_name: c.index_name });
    current = null;
  };
  for (const raw of text.split('\n')) {
    const line = raw.replace(/#.*$/, '').trim();
    if (!line) continue;
    const arr = /^\[\[([\w.]+)\]\]$/.exec(line);
    if (arr) { push(); section = arr[1]!.replace(/^env\.\w+\./, ''); current = {}; continue; }
    if (/^\[[\w.]+\]$/.test(line)) { push(); section = ''; continue; }
    const kv = /^(\w+)\s*=\s*"([^"]*)"/.exec(line);
    if (kv && current) current[kv[1]!] = kv[2]!;
    else if (kv && !section && kv[1] === 'name') cfg.name = kv[2];
  }
  push();
  return cfg;
}

function wranglerStores(file: RepoFile, out: PersistenceResult): void {
  const cfg = file.ext === 'toml' ? parseWranglerToml(readText(file.abs)) : readJsonc<WranglerConfig>(file.abs);
  if (!cfg) return;
  const configRef = { path: file.rel, role: 'config' };
  const add = (id: string, label: string, binding: string | undefined, type: string, kind: 'store' | 'queue', extra: Record<string, unknown> = {}) => {
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
  };
  for (const d of cfg.d1_databases ?? []) add(`store:d1:${d.database_name ?? d.binding}`, `D1 ${d.database_name ?? d.binding}`, d.binding, 'd1', 'store');
  for (const k of cfg.kv_namespaces ?? []) if (k.binding) add(`store:kv:${k.binding}`, `KV ${k.binding}`, k.binding, 'kv', 'store');
  for (const r of cfg.r2_buckets ?? []) add(`store:r2:${r.bucket_name ?? r.binding}`, `R2 ${r.bucket_name ?? r.binding}`, r.binding, 'r2', 'store');
  for (const q of cfg.queues?.producers ?? []) add(`queue:${q.queue ?? q.binding}`, `Queue ${q.queue ?? q.binding}`, q.binding, 'queue', 'queue');
  for (const q of cfg.queues?.consumers ?? []) if (q.queue) add(`queue:${q.queue}`, `Queue ${q.queue}`, undefined, 'queue', 'queue');
  for (const o of cfg.durable_objects?.bindings ?? []) add(`store:do:${o.class_name ?? o.name}`, `DO ${o.class_name ?? o.name}`, o.name, 'durable-object', 'store');
  for (const v of cfg.vectorize ?? []) add(`store:vectorize:${v.index_name ?? v.binding}`, `Vectorize ${v.index_name ?? v.binding}`, v.binding, 'vectorize', 'store');
}

function drizzleTables(file: SourceFile, out: PersistenceResult): void {
  const text = file.text;
  if (!/\b(sqliteTable|pgTable|mysqlTable|singlestoreTable)\(/.test(text)) return;
  // require a real drizzle import so example snippets in docs/scripts do not become tables
  if (!/from\s+['"]drizzle-orm(\/[\w-]+)*['"]/.test(text)) return;
  for (const m of text.matchAll(DRIZZLE_TABLE_RE)) {
    const ident = m[1]!;
    const fn = m[2]!;
    const name = m[3]!;
    const dialect = fn === 'sqliteTable' ? 'sqlite' : fn === 'pgTable' ? 'postgres' : 'mysql';
    const open = text.indexOf('(', m.index! + m[0].indexOf(fn));
    const close = matchParen(text, open);
    const body = text.slice(open, close);
    const columns: string[] = [];
    for (const c of body.matchAll(DRIZZLE_COLUMN_RE)) if (!columns.includes(c[1]!)) columns.push(c[1]!);
    const storeId = pickDrizzleStore(dialect, out);
    let id = `table:${name}`;
    if (out.drafts.some((d) => d.id === id)) id = `table:${name}@${file.rel}`;
    const shown = columns.slice(0, 6).join(', ') + (columns.length > 6 ? ', …' : '');
    out.drafts.push({
      id,
      label: name,
      kind: 'table',
      layer: 'persistence',
      parent: storeId,
      summary: columns.length ? `${columns.length} columns: ${shown}` : `table ${name}`,
      files: [{ path: file.rel, lines: [lineOfIndex(text, m.index!), lineOfIndex(text, close)], role: 'schema' }],
      tags: ['drizzle', dialect],
      meta: { identifier: ident, dialect, columns, orm: 'drizzle' },
      laneHint: undefined,
      ownedFiles: [],
    });
    out.tableIdents.set(ident, id);
  }
}

function pickDrizzleStore(dialect: string, out: PersistenceResult): string {
  const preferred = dialect === 'sqlite' ? ['d1', 'durable-object'] : [];
  for (const type of preferred) {
    const hit = out.drafts.find((d) => d.kind === 'store' && d.meta?.type === type);
    if (hit) return hit.id;
  }
  const id = `store:drizzle:${dialect}`;
  if (!out.drafts.some((d) => d.id === id)) {
    const label = dialect === 'sqlite' ? 'SQLite' : dialect === 'postgres' ? 'Postgres' : 'MySQL';
    out.drafts.push({
      id,
      label: `${label} (Drizzle)`,
      kind: 'store',
      layer: 'persistence',
      summary: `${label} database described by the Drizzle schema`,
      tags: ['drizzle', dialect],
      meta: { type: dialect, orm: 'drizzle' },
      ownedFiles: [],
    });
  }
  return id;
}

function prismaModels(file: RepoFile, out: PersistenceResult): void {
  const text = readText(file.abs);
  const provider = /datasource\s+\w+\s*{[^}]*provider\s*=\s*"(\w+)"/.exec(text)?.[1] ?? 'database';
  const storeId = `store:prisma:${provider}`;
  if (!out.drafts.some((d) => d.id === storeId)) {
    out.drafts.push({
      id: storeId,
      label: `${provider[0]!.toUpperCase()}${provider.slice(1)} (Prisma)`,
      kind: 'store',
      layer: 'persistence',
      summary: `Prisma datasource (${provider})`,
      files: [{ path: file.rel, role: 'schema' }],
      tags: ['prisma', provider],
      meta: { type: provider, orm: 'prisma' },
      ownedFiles: [file.rel],
    });
  }
  for (const m of text.matchAll(/model\s+(\w+)\s*{([^}]*)}/g)) {
    const model = m[1]!;
    const columns = m[2]!
      .split('\n')
      .map((l) => /^\s*(\w+)\s+\w/.exec(l)?.[1])
      .filter((c): c is string => !!c && !c.startsWith('@'));
    const id = `table:${model}`;
    if (out.drafts.some((d) => d.id === id)) continue;
    const start = lineOfIndex(text, m.index!);
    out.drafts.push({
      id,
      label: model,
      kind: 'table',
      layer: 'persistence',
      parent: storeId,
      summary: `${columns.length} fields: ${columns.slice(0, 6).join(', ')}${columns.length > 6 ? ', …' : ''}`,
      files: [{ path: file.rel, lines: [start, start + m[0].split('\n').length - 1], role: 'schema' }],
      tags: ['prisma'],
      meta: { columns, orm: 'prisma' },
      ownedFiles: [],
    });
    out.prismaModels.set(model[0]!.toLowerCase() + model.slice(1), id);
  }
}

export function scanPersistence(allFiles: RepoFile[], sources: SourceFile[]): PersistenceResult {
  const out: PersistenceResult = { drafts: [], tableIdents: new Map(), prismaModels: new Map(), bindings: new Map() };
  for (const f of allFiles) if (/^wrangler\.(jsonc?|toml)$/.test(f.base)) wranglerStores(f, out);
  for (const f of sources) drizzleTables(f, out);
  for (const f of allFiles) if (f.ext === 'prisma') prismaModels(f, out);
  return out;
}
