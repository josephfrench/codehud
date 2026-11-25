/**
 * Supabase: tables from `supabase/migrations/*.sql` (`create table`) and from `client.from('x')`
 * usage; `.select()` reads, `.insert/.upsert/.update/.delete()` write; storage buckets from
 * `.storage.from('bucket')`.
 */
import type { EdgeKind } from '../../../schema/src/index.ts';
import type { Adapter, ScanOutput, SourceFile } from '../types.ts';

const FROM_RE = /\b(?:supabase|client|sb|db|admin|serviceClient|supabaseAdmin|supabaseClient|locals\.supabase|ctx\.supabase|this\.\w+)\.from\(\s*(['"`])([\w.]+)\1\s*\)/g;
const STORAGE_RE = /\.storage\.from\(\s*(['"`])([\w.-]+)\1\s*\)/g;
const CREATE_TABLE_RE = /create\s+table\s+(?:if\s+not\s+exists\s+)?(?:"?(?:public|auth|storage)"?\.)?"?(\w+)"?\s*\(([\s\S]*?)\)\s*;/gi;

function ensureStore(out: ScanOutput): string {
  const id = 'store:supabase';
  if (!out.drafts.some((d) => d.id === id)) {
    out.drafts.push({ id, label: 'Postgres (Supabase)', kind: 'store', layer: 'persistence', summary: 'Supabase project database', tags: ['supabase', 'postgres'], meta: { type: 'postgres', provider: 'supabase' }, ownedFiles: [] });
  }
  return id;
}

function ensureTable(out: ScanOutput, name: string, extra: Partial<{ columns: { name: string; type: string }[]; file: string; lines: [number, number] }> = {}): string {
  const id = `table:${name}`;
  const existing = out.drafts.find((d) => d.id === id);
  if (existing) {
    if (extra.columns?.length && !(existing.meta?.columns as unknown[] | undefined)?.length) {
      existing.meta = { ...existing.meta, columns: extra.columns };
      existing.summary = `${extra.columns.length} columns: ${extra.columns.slice(0, 6).map((c) => c.name).join(', ')}${extra.columns.length > 6 ? ', …' : ''}`;
      if (extra.file) existing.files = [{ path: extra.file, lines: extra.lines, role: 'schema' }];
    }
    return id;
  }
  const cols = extra.columns ?? [];
  out.drafts.push({
    id,
    label: name,
    kind: 'table',
    layer: 'persistence',
    parent: ensureStore(out),
    summary: cols.length ? `${cols.length} columns: ${cols.slice(0, 6).map((c) => c.name).join(', ')}${cols.length > 6 ? ', …' : ''}` : `table ${name}`,
    files: extra.file ? [{ path: extra.file, lines: extra.lines, role: 'schema' }] : undefined,
    tags: ['supabase'],
    meta: { columns: cols, provider: 'supabase' },
    ownedFiles: [],
  });
  return id;
}

function sqlColumns(body: string): { name: string; type: string }[] {
  const out: { name: string; type: string }[] = [];
  for (const raw of body.split(/,\s*\n|,(?=\s*"?\w+"?\s+\w)/)) {
    const line = raw.trim();
    const m = /^"?(\w+)"?\s+([\w\[\]()]+(?:\s+(?:with|without)\s+time\s+zone)?)/i.exec(line);
    if (!m || /^(primary|constraint|unique|foreign|check|index)$/i.test(m[1]!)) continue;
    out.push({ name: m[1]!, type: m[2]! });
  }
  return out;
}

export const supabase: Adapter = {
  id: 'supabase',
  detect: (ctx) => ctx.hasDep(/^@supabase\//) || ctx.hasFile(/(^|\/)supabase\/(config\.toml|migrations\/)/),
  scan(ctx, out) {
    for (const f of ctx.files) {
      if (!/(^|\/)supabase\/migrations\/.*\.sql$/.test(f.rel)) continue;
      const text = ctx.textOf(f.rel);
      for (const m of text.matchAll(CREATE_TABLE_RE)) {
        const start = text.slice(0, m.index!).split('\n').length;
        ensureTable(out, m[1]!, { columns: sqlColumns(m[2]!), file: f.rel, lines: [start, start + m[0].split('\n').length - 1] });
      }
    }
    for (const s of ctx.sources) {
      for (const m of s.text.matchAll(FROM_RE)) ensureTable(out, m[2]!);
      for (const m of s.text.matchAll(STORAGE_RE)) {
        const id = `store:supabase:bucket:${m[2]}`;
        if (!out.drafts.some((d) => d.id === id)) out.drafts.push({ id, label: `bucket ${m[2]}`, kind: 'store', layer: 'persistence', summary: 'Supabase Storage bucket', tags: ['supabase', 'storage'], meta: { type: 'bucket', provider: 'supabase' }, ownedFiles: [] });
      }
    }
  },
  edges(file, from, ectx, sink) {
    const text = file.text;
    for (const m of text.matchAll(FROM_RE)) {
      const id = `table:${m[2]}`;
      if (!ectx.nodes.has(id)) continue;
      const chain = text.slice(m.index! + m[0].length, m.index! + m[0].length + 300).split(/;|\n\s*\n/)[0] ?? '';
      const kinds = new Set<EdgeKind>();
      if (/\.(insert|upsert|update|delete)\(/.test(chain)) kinds.add('writes');
      if (/\.select\(/.test(chain) || !kinds.size && /\.(eq|match|order|limit|single|maybeSingle|range)\(/.test(chain)) kinds.add('reads');
      if (!kinds.size) kinds.add('depends');
      for (const k of kinds) sink.add(from, id, k, k === 'depends' ? 'medium' : 'high', 'supabase');
    }
    for (const m of text.matchAll(STORAGE_RE)) {
      const id = `store:supabase:bucket:${m[2]}`;
      if (!ectx.nodes.has(id)) continue;
      const chain = text.slice(m.index! + m[0].length, m.index! + m[0].length + 120);
      sink.add(from, id, /\.(upload|remove|move|copy|update)\(/.test(chain) ? 'writes' : 'reads', 'high', 'supabase');
    }
  },
};

export type { SourceFile };
