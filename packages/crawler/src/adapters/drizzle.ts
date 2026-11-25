/** Drizzle ORM: `sqliteTable/pgTable/mysqlTable` declarations are tables; `.from(t)` / `.insert(t)` are edges. */
import type { EdgeKind } from '../../../schema/src/index.ts';
import { lineOfIndex, matchParen } from '../fs.ts';
import type { Adapter, ScanOutput, SourceFile } from '../types.ts';

const DRIZZLE_TABLE_RE = /export\s+const\s+(\w+)\s*=\s*(sqliteTable|pgTable|mysqlTable|singlestoreTable)\(\s*['"`]([\w.]+)['"`]/g;
const DRIZZLE_COLUMN_RE =
  /\b(\w+)\s*:\s*(?:t\.)?(text|integer|real|blob|numeric|serial|bigserial|smallserial|varchar|char|boolean|timestamp|date|time|json|jsonb|uuid|bigint|smallint|doublePrecision|decimal|interval|inet|cidr|macaddr|point|line|customType|int|tinyint|mediumint|float|double|datetime|year|binary|varbinary|longtext|mediumtext|tinytext|vector|halfvec|sparsevec|bit|geometry)\s*\(/g;

function pickDrizzleStore(dialect: string, out: ScanOutput): string {
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

function drizzleTables(file: SourceFile, out: ScanOutput): void {
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
    const typed: { name: string; type: string }[] = [];
    for (const c of body.matchAll(DRIZZLE_COLUMN_RE)) if (!columns.includes(c[1]!)) { columns.push(c[1]!); typed.push({ name: c[1]!, type: c[2]! }); }
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
      meta: { identifier: ident, dialect, columns: typed, orm: 'drizzle' },
      laneHint: undefined,
      ownedFiles: [],
    });
    out.idents.set(ident, { id, via: 'drizzle' });
  }
}

export const drizzle: Adapter = {
  id: 'drizzle',
  detect: (ctx) => ctx.hasDep('drizzle-orm') || ctx.sources.some((s) => /from\s+['"]drizzle-orm/.test(s.text)),
  scan(ctx, out) {
    for (const f of ctx.sources) drizzleTables(f, out);
  },
  edges(file, from, ectx, sink) {
    const idents = new Map([...ectx.scan.idents].filter(([, v]) => v.via === 'drizzle').map(([k, v]) => [k, v.id]));
    if (!idents.size) return;
    const identRe = new RegExp(`\\b(${[...idents.keys()].map((k) => k.replace(/\$/g, '\\$')).join('|')})\\b`);
    const text = file.text;
    if (!identRe.test(text)) return;
    const touched = new Map<string, Set<EdgeKind>>();
    const mark = (ident: string, kind: EdgeKind) => {
      const id = idents.get(ident);
      if (!id) return;
      (touched.get(id) ?? touched.set(id, new Set()).get(id)!).add(kind);
    };
    for (const m of text.matchAll(/\.(from|leftJoin|innerJoin|rightJoin|fullJoin)\(\s*(\w+)/g)) mark(m[2]!, 'reads');
    for (const m of text.matchAll(/\bquery\.(\w+)\.(?:findFirst|findMany)\b/g)) mark(m[1]!, 'reads');
    for (const m of text.matchAll(/\.(insert|update|delete)\(\s*(\w+)\s*\)/g)) mark(m[2]!, 'writes');
    for (const imp of ectx.importsOf.get(file.rel) ?? []) for (const n of imp.names) if (idents.has(n) && !touched.has(idents.get(n)!)) mark(n, 'depends');
    for (const [id, kinds] of touched) {
      if (ectx.nodes.get(id)?.files?.[0]?.path === file.rel) continue; // the schema file itself
      for (const kind of kinds) sink.add(from, id, kind, kind === 'depends' ? 'low' : 'high', 'drizzle', kind === 'depends' ? 'references' : undefined);
    }
  },
};
