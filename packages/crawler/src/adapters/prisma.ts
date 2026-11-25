/** Prisma: `schema.prisma` models are tables; `db.model.findMany/create/...` are edges. */
import type { EdgeKind } from '../../../schema/src/index.ts';
import { lineOfIndex } from '../fs.ts';
import type { Adapter, RepoFile, ScanOutput } from '../types.ts';

const PRISMA_RE = /\b(?:prisma|db|client|tx|ctx\.db|ctx\.prisma)\.(\w+)\.(findMany|findFirst|findUnique|findUniqueOrThrow|findFirstOrThrow|count|aggregate|groupBy|create|createMany|createManyAndReturn|update|updateMany|upsert|delete|deleteMany)\(/g;

function prismaModels(file: RepoFile, text: string, out: ScanOutput): void {
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
      .map((l) => { const c = /^\s*(\w+)\s+(\S+)/.exec(l); return c && !c[1]!.startsWith('@') ? { name: c[1]!, type: c[2]! } : undefined; })
      .filter((c): c is { name: string; type: string } => !!c);
    const id = `table:${model}`;
    if (out.drafts.some((d) => d.id === id)) continue;
    const start = lineOfIndex(text, m.index!);
    out.drafts.push({
      id,
      label: model,
      kind: 'table',
      layer: 'persistence',
      parent: storeId,
      summary: `${columns.length} fields: ${columns.slice(0, 6).map((c) => c.name).join(', ')}${columns.length > 6 ? ', …' : ''}`,
      files: [{ path: file.rel, lines: [start, start + m[0].split('\n').length - 1], role: 'schema' }],
      tags: ['prisma'],
      meta: { columns, orm: 'prisma' },
      ownedFiles: [],
    });
    out.prismaModels.set(model[0]!.toLowerCase() + model.slice(1), id);
  }
}

export const prisma: Adapter = {
  id: 'prisma',
  detect: (ctx) => ctx.hasFile(/\.prisma$/),
  scan(ctx, out) {
    for (const f of ctx.files) if (f.ext === 'prisma') prismaModels(f, ctx.textOf(f.rel), out);
  },
  edges(file, from, ectx, sink) {
    if (!ectx.scan.prismaModels.size) return;
    for (const m of file.text.matchAll(PRISMA_RE)) {
      const id = ectx.scan.prismaModels.get(m[1]!);
      if (!id) continue;
      const kind: EdgeKind = /^(find|count|aggregate|groupBy)/.test(m[2]!) ? 'reads' : 'writes';
      sink.add(from, id, kind, 'high', 'prisma');
    }
  },
};
