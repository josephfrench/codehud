/**
 * Document / class-based ORMs: Mongoose models, TypeORM entities, Sequelize models. Each declares
 * tables under one store node and registers the code identifier so usage elsewhere becomes
 * reads / writes edges.
 */
import type { EdgeKind } from '../../../schema/src/index.ts';
import { baseOf, lineOfIndex, matchParen, stripExt } from '../fs.ts';
import type { Adapter, Draft, EdgeContext, EdgeSink, ScanOutput, SourceFile } from '../types.ts';
import { matchBrace } from './route-tables.ts';

function ensureStore(out: ScanOutput, id: string, label: string, summary: string, tags: string[], meta: Record<string, unknown>, file?: string): string {
  if (!out.drafts.some((d) => d.id === id)) {
    out.drafts.push({ id, label, kind: 'store', layer: 'persistence', summary, files: file ? [{ path: file, role: 'config' }] : undefined, tags, meta, ownedFiles: [] });
  }
  return id;
}

/** Keys at depth 1 of an object literal body (`{ a: ..., b: { ... } }`) with a short type guess. */
export function objectKeys(body: string, max = 40): { name: string; type: string }[] {
  const out: { name: string; type: string }[] = [];
  let depth = 0;
  let quote: string | null = null;
  let i = 0;
  const n = body.length;
  while (i < n) {
    const c = body[i]!;
    if (quote) { if (c === '\\') i++; else if (c === quote) quote = null; i++; continue; }
    if (c === '"' || c === "'" || c === '`') { quote = c; i++; continue; }
    if (c === '{' || c === '[' || c === '(') { depth++; i++; continue; }
    if (c === '}' || c === ']' || c === ')') { depth--; i++; continue; }
    if (depth === 1 && /[A-Za-z_$]/.test(c)) {
      const m = /^([A-Za-z_$][\w$]*)\s*:\s*([^,\n{}]*)/.exec(body.slice(i));
      if (m) {
        const raw = m[2]!.trim();
        const type = /^\{/.test(raw) ? 'object' : raw.replace(/^(DataTypes|Sequelize|Schema\.Types|mongoose\.Schema\.Types|Types)\./, '').split(/[.(,]/)[0]!.trim() || 'field';
        if (!/^(type|required|default|unique|index|ref|enum|validate|allowNull|primaryKey|autoIncrement|field|references|onDelete|onUpdate)$/.test(m[1]!) || depth === 1) out.push({ name: m[1]!, type });
        if (out.length >= max) break;
        i += m[1]!.length;
        continue;
      }
    }
    i++;
  }
  return out;
}

function table(out: ScanOutput, id: string, label: string, storeId: string, file: SourceFile, index: number, endIndex: number, columns: { name: string; type: string }[], tags: string[], meta: Record<string, unknown>): Draft | undefined {
  if (out.drafts.some((d) => d.id === id)) return undefined;
  const shown = columns.slice(0, 6).map((c) => c.name).join(', ') + (columns.length > 6 ? ', …' : '');
  const d: Draft = {
    id,
    label,
    kind: 'table',
    layer: 'persistence',
    parent: storeId,
    summary: columns.length ? `${columns.length} fields: ${shown}` : label,
    files: [{ path: file.rel, lines: [lineOfIndex(file.text, index), lineOfIndex(file.text, endIndex)], role: 'schema' }],
    tags,
    meta: { columns, ...meta },
    ownedFiles: [],
  };
  out.drafts.push(d);
  return d;
}

// ---------------------------------------------------------------- mongoose
const MONGOOSE_MODEL_RE = /\b(?:mongoose\.)?model(?:<[^>]*>)?\(\s*(['"`])(\w+)\1\s*,\s*(\w+)/g;

function mongooseScan(file: SourceFile, out: ScanOutput): void {
  const text = file.text;
  if (!/from\s+['"]mongoose['"]|require\(\s*['"]mongoose['"]\s*\)/.test(text)) return;
  const schemas = new Map<string, { name: string; type: string }[]>();
  for (const m of text.matchAll(/(?:const|let|var)\s+(\w+)\s*(?::[^=]+)?=\s*new\s+(?:mongoose\.)?Schema(?:<[^>]*>)?\(\s*\{/g)) {
    const open = text.indexOf('{', m.index! + m[0].length - 1);
    const close = matchBrace(text, open, '{', '}');
    schemas.set(m[1]!, objectKeys(text.slice(open, close)));
  }
  for (const m of text.matchAll(MONGOOSE_MODEL_RE)) {
    const name = m[2]!;
    const schemaVar = m[3]!;
    const storeId = ensureStore(out, 'store:mongodb', 'MongoDB', 'Mongo database (Mongoose models)', ['mongoose', 'mongodb'], { type: 'mongodb', orm: 'mongoose' });
    const id = `table:${name}`;
    const cols = schemas.get(schemaVar) ?? [];
    table(out, id, name, storeId, file, m.index!, m.index! + m[0].length, cols, ['mongoose'], { orm: 'mongoose', collection: name });
    // identifiers: the variable the model is assigned to, and the model name itself
    const assigned = new RegExp(`(?:const|let|var)\\s+(\\w+)\\s*(?::[^=]+)?=\\s*(?:mongoose\\.)?model(?:<[^>]*>)?\\(\\s*['"\`]${name}['"\`]`).exec(text)?.[1];
    for (const ident of new Set([assigned, name, `${name}Model`].filter((x): x is string => !!x))) out.idents.set(ident, { id, via: 'mongoose' });
  }
}

// ---------------------------------------------------------------- typeorm
function typeormScan(file: SourceFile, out: ScanOutput, repoDsType: string | undefined): void {
  const text = file.text;
  if (!/@Entity\(/.test(text) || !/from\s+['"]typeorm['"]/.test(text)) return;
  const dsType = /\btype\s*:\s*['"](postgres|mysql|mariadb|sqlite|better-sqlite3|mssql|oracle|mongodb|cockroachdb)['"]/.exec(text)?.[1] ?? repoDsType;
  for (const m of text.matchAll(/@Entity\(\s*(?:(['"`])(\w+)\1)?[^)]*\)\s*(?:export\s+)?(?:abstract\s+)?class\s+(\w+)/g)) {
    const cls = m[3]!;
    const name = m[2] ?? cls;
    const open = text.indexOf('{', m.index! + m[0].length);
    const close = matchBrace(text, open, '{', '}');
    const body = text.slice(open, close);
    const columns: { name: string; type: string }[] = [];
    for (const c of body.matchAll(/@(Column|PrimaryColumn|PrimaryGeneratedColumn|CreateDateColumn|UpdateDateColumn|DeleteDateColumn|VersionColumn|ObjectIdColumn|OneToOne|OneToMany|ManyToOne|ManyToMany)\([^)]*\)\s*(?:@\w+\([^)]*\)\s*)*(?:readonly\s+)?(\w+)\s*[?!]?\s*:\s*([^;=\n]+)/g)) {
      columns.push({ name: c[2]!, type: c[3]!.trim().replace(/\s+/g, ' ').slice(0, 40) });
    }
    const storeId = ensureStore(out, `store:typeorm${dsType ? ':' + dsType : ''}`, dsType ? `${dsType} (TypeORM)` : 'Database (TypeORM)', 'TypeORM data source', ['typeorm', ...(dsType ? [dsType] : [])], { orm: 'typeorm', type: dsType });
    const id = `table:${name}`;
    table(out, id, name, storeId, file, m.index!, close, columns, ['typeorm'], { orm: 'typeorm', entity: cls });
    out.idents.set(cls, { id, via: 'typeorm' });
  }
}

// ---------------------------------------------------------------- sequelize
function sequelizeScan(file: SourceFile, out: ScanOutput): void {
  const text = file.text;
  if (!/from\s+['"]sequelize(-typescript)?['"]|require\(\s*['"]sequelize['"]\s*\)/.test(text)) return;
  const dialect = /\bdialect\s*:\s*['"](\w+)['"]/.exec(text)?.[1];
  const storeId = () => ensureStore(out, `store:sequelize${dialect ? ':' + dialect : ''}`, dialect ? `${dialect} (Sequelize)` : 'Database (Sequelize)', 'Sequelize connection', ['sequelize', ...(dialect ? [dialect] : [])], { orm: 'sequelize', type: dialect });
  for (const m of text.matchAll(/(?:(?:const|let|var)\s+(\w+)\s*=\s*)?\w+\.define(?:<[^>]*>)?\(\s*(['"`])(\w+)\2\s*,\s*\{/g)) {
    const name = m[3]!;
    const open = text.indexOf('{', m.index! + m[0].length - 1);
    const close = matchBrace(text, open, '{', '}');
    const id = `table:${name}`;
    table(out, id, name, storeId(), file, m.index!, close, objectKeys(text.slice(open, close)), ['sequelize'], { orm: 'sequelize' });
    for (const ident of new Set([m[1], name].filter((x): x is string => !!x))) out.idents.set(ident, { id, via: 'sequelize' });
  }
  for (const m of text.matchAll(/class\s+(\w+)\s+extends\s+Model\b[\s\S]*?\b\1\.init\(\s*\{/g)) {
    const cls = m[1]!;
    const open = text.lastIndexOf('{', m.index! + m[0].length);
    const close = matchBrace(text, open, '{', '}');
    const tableName = /tableName\s*:\s*['"`](\w+)['"`]/.exec(text.slice(close, close + 400))?.[1] ?? cls;
    const id = `table:${tableName}`;
    table(out, id, tableName, storeId(), file, m.index!, close, objectKeys(text.slice(open, close)), ['sequelize'], { orm: 'sequelize', model: cls });
    out.idents.set(cls, { id, via: 'sequelize' });
  }
  // sequelize-typescript decorators
  for (const m of text.matchAll(/@Table\(\s*(?:\{[^}]*tableName\s*:\s*['"`](\w+)['"`][^}]*\})?\s*\)\s*(?:export\s+)?class\s+(\w+)/g)) {
    const cls = m[2]!;
    const name = m[1] ?? cls;
    const open = text.indexOf('{', m.index! + m[0].length);
    const close = matchBrace(text, open, '{', '}');
    const cols = [...text.slice(open, close).matchAll(/@(?:Column|PrimaryKey|ForeignKey|CreatedAt|UpdatedAt)[^\n]*\n\s*(?:declare\s+)?(\w+)\s*[?!]?\s*:\s*([^;\n]+)/g)].map((c) => ({ name: c[1]!, type: c[2]!.trim() }));
    const id = `table:${name}`;
    table(out, id, name, storeId(), file, m.index!, close, cols, ['sequelize'], { orm: 'sequelize', model: cls });
    out.idents.set(cls, { id, via: 'sequelize' });
  }
}

// ---------------------------------------------------------------- shared edge logic
const READ_METHODS = /\.(find|findOne|findById|findAll|findByPk|findAndCountAll|findOneBy|findBy|findOneOrFail|findByIds|count|countDocuments|estimatedDocumentCount|aggregate|distinct|exists|query|createQueryBuilder|sum|average|minimum|maximum|max|min)\s*(?:<[^>]*>)?\(/;
const WRITE_METHODS = /\.(create|insert|insertMany|save|update|updateOne|updateMany|findOneAndUpdate|findByIdAndUpdate|findOneAndDelete|findByIdAndDelete|findOneAndReplace|replaceOne|deleteOne|deleteMany|delete|destroy|remove|softDelete|restore|upsert|bulkCreate|bulkWrite|increment|decrement|clear)\s*(?:<[^>]*>)?\(/;

function identEdges(file: SourceFile, from: string, ectx: EdgeContext, sink: EdgeSink, via: string): void {
  const idents = new Map([...ectx.scan.idents].filter(([, v]) => v.via === via).map(([k, v]) => [k, v.id]));
  if (!idents.size) return;
  const text = file.text;
  const used = new Set<string>();
  for (const imp of ectx.importsOf.get(file.rel) ?? []) for (const n of imp.names) if (idents.has(n)) used.add(n);
  // same-file use without import (models defined and used in one file) does not count: the node owns the file
  for (const ident of used) {
    const id = idents.get(ident)!;
    if (ectx.nodes.get(id)?.files?.[0]?.path === file.rel) continue;
    const esc = ident.replace(/\$/g, '\\$');
    // `Model.method(` or `repo<Model>` / `Repository<Model>` / `getRepository(Model)` / `InjectRepository(Model)` then any method in the file
    const direct = new RegExp(`\\b${esc}(\\.[\\w.]*?)(?=\\s*(?:<[^>]*>)?\\()`, 'g');
    const kinds = new Set<EdgeKind>();
    for (const m of text.matchAll(direct)) {
      const call = m[0] + '(';
      if (READ_METHODS.test(call)) kinds.add('reads');
      else if (WRITE_METHODS.test(call)) kinds.add('writes');
    }
    if (new RegExp(`new\\s+${esc}\\s*\\(`).test(text) && /\.save\(/.test(text)) kinds.add('writes');
    if (new RegExp(`(Repository<${esc}>|getRepository\\(\\s*${esc}\\s*\\)|InjectRepository\\(\\s*${esc}\\s*\\)|getModelToken\\(\\s*${esc}|InjectModel\\(\\s*${esc}|Model<${esc}>)`).test(text)) {
      if (READ_METHODS.test(text)) kinds.add('reads');
      if (WRITE_METHODS.test(text)) kinds.add('writes');
    }
    if (!kinds.size) kinds.add('depends');
    for (const k of kinds) sink.add(from, id, k, k === 'depends' ? 'low' : 'high', via, k === 'depends' ? 'references' : undefined);
  }
}

export const mongoose: Adapter = {
  id: 'mongoose',
  detect: (ctx) => ctx.hasDep('mongoose') || ctx.hasDep('@nestjs/mongoose'),
  scan(ctx, out) { for (const f of ctx.sources) mongooseScan(f, out); },
  edges(file, from, ectx, sink) { identEdges(file, from, ectx, sink, 'mongoose'); },
};

export const typeorm: Adapter = {
  id: 'typeorm',
  detect: (ctx) => ctx.hasDep('typeorm'),
  scan(ctx, out) {
    // the data source type usually lives in app.module / data-source.ts, not next to the entities
    let dsType: string | undefined;
    for (const f of ctx.sources) {
      const m = /(?:TypeOrmModule\.forRoot(?:Async)?\(|new\s+DataSource\(|createConnection\()[\s\S]{0,400}?\btype\s*:\s*['"](postgres|mysql|mariadb|sqlite|better-sqlite3|mssql|oracle|mongodb|cockroachdb)['"]/.exec(f.text);
      if (m) { dsType = m[1]; break; }
    }
    for (const f of ctx.sources) typeormScan(f, out, dsType);
  },
  edges(file, from, ectx, sink) { identEdges(file, from, ectx, sink, 'typeorm'); },
};

export const sequelize: Adapter = {
  id: 'sequelize',
  detect: (ctx) => ctx.hasDep('sequelize') || ctx.hasDep('sequelize-typescript'),
  scan(ctx, out) { for (const f of ctx.sources) sequelizeScan(f, out); },
  edges(file, from, ectx, sink) { identEdges(file, from, ectx, sink, 'sequelize'); },
};

export { baseOf, stripExt, matchParen };
