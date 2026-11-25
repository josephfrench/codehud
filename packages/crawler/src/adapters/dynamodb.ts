/**
 * DynamoDB from code: `TableName: 'orders'` literals and `TableName: process.env.X` references in
 * files that use the AWS SDK (v2 DocumentClient, v3 lib-dynamodb) or dynamoose / electrodb. Env
 * references resolve to infra-declared tables when serverless / SAM / CDK / Terraform named them.
 */
import type { EdgeKind } from '../../../schema/src/index.ts';
import type { Adapter, ScanOutput, SourceFile } from '../types.ts';

const USES_DDB = /@aws-sdk\/(client-dynamodb|lib-dynamodb)|aws-sdk\/clients\/dynamodb|new\s+(?:AWS\.)?DynamoDB(?:\.DocumentClient)?\(|from\s+['"]dynamoose['"]|from\s+['"]electrodb['"]/;
const TABLE_LITERAL_RE = /\bTableName\s*:\s*(['"`])([\w.-]+)\1/g;
const TABLE_ENV_RE = /\bTableName\s*:\s*(?:process\.env\.|env\.|Resource\.\w+\.|config\.)(\w+)/g;
const DYNAMOOSE_RE = /\bdynamoose\.model(?:<[^>]*>)?\(\s*(['"`])([\w.-]+)\1/g;
const ELECTRO_RE = /\btable\s*:\s*(['"`])([\w.-]+)\1/g;

const WRITE_CMD = /\b(Put|Update|Delete|BatchWrite|TransactWrite)(?:Item)?Command\b|\.(put|update|delete|batchWrite|transactWrite|putItem|updateItem|deleteItem)\(/;
const READ_CMD = /\b(Get|Query|Scan|BatchGet|TransactGet)(?:Item)?Command\b|\.(get|query|scan|batchGet|transactGet|getItem)\(/;

export function ensureDynamoStore(out: ScanOutput): string {
  const id = 'store:dynamodb';
  if (!out.drafts.some((d) => d.id === id)) {
    out.drafts.push({ id, label: 'DynamoDB', kind: 'store', layer: 'persistence', summary: 'AWS DynamoDB', tags: ['aws', 'dynamodb'], meta: { type: 'dynamodb' }, ownedFiles: [] });
  }
  return id;
}

export function ensureDynamoTable(out: ScanOutput, name: string, extra: Record<string, unknown> = {}, file?: string): string {
  const id = `table:dynamodb:${name}`;
  if (!out.drafts.some((d) => d.id === id)) {
    out.drafts.push({
      id,
      label: name,
      kind: 'table',
      layer: 'persistence',
      parent: ensureDynamoStore(out),
      summary: `DynamoDB table ${name}`,
      files: file ? [{ path: file, role: 'config' }] : undefined,
      tags: ['aws', 'dynamodb'],
      meta: { type: 'dynamodb', ...extra },
      ownedFiles: [],
    });
  }
  return id;
}

function tablesIn(file: SourceFile, out: ScanOutput): Map<string, { id: string; index: number }[]> {
  const found = new Map<string, { id: string; index: number }[]>();
  const text = file.text;
  const push = (id: string, index: number) => (found.get(id) ?? found.set(id, []).get(id)!).push({ id, index });
  for (const m of text.matchAll(TABLE_LITERAL_RE)) push(ensureDynamoTable(out, m[2]!, {}, undefined), m.index!);
  for (const m of text.matchAll(TABLE_ENV_RE)) {
    const env = m[1]!;
    const infra = out.envRefs.get(env);
    push(infra ?? ensureDynamoTable(out, `$${env}`, { env }, undefined), m.index!);
  }
  for (const m of text.matchAll(DYNAMOOSE_RE)) push(ensureDynamoTable(out, m[2]!, { orm: 'dynamoose' }, file.rel), m.index!);
  if (/from\s+['"]electrodb['"]/.test(text)) for (const m of text.matchAll(ELECTRO_RE)) push(ensureDynamoTable(out, m[2]!, { orm: 'electrodb' }, file.rel), m.index!);
  return found;
}

export const dynamodb: Adapter = {
  id: 'dynamodb',
  detect: (ctx) => ctx.hasDep(/^@aws-sdk\/(client-dynamodb|lib-dynamodb)$/) || ctx.hasDep('aws-sdk') || ctx.hasDep('dynamoose') || ctx.hasDep('electrodb') || ctx.sources.some((s) => USES_DDB.test(s.text)),
  scan(ctx, out) {
    for (const f of ctx.sources) if (USES_DDB.test(f.text) || /\bTableName\s*:/.test(f.text)) tablesIn(f, out);
  },
  edges(file, from, ectx, sink) {
    const text = file.text;
    if (!USES_DDB.test(text) && !/\bTableName\s*:/.test(text)) return;
    const found = tablesIn(file, ectx.scan);
    for (const [id, uses] of found) {
      if (!ectx.nodes.has(id)) continue;
      const kinds = new Set<EdgeKind>();
      for (const u of uses) {
        const window = text.slice(Math.max(0, u.index - 260), u.index + 40);
        if (WRITE_CMD.test(window)) kinds.add('writes');
        if (READ_CMD.test(window)) kinds.add('reads');
      }
      if (!kinds.size) kinds.add('depends');
      for (const k of kinds) sink.add(from, id, k, k === 'depends' ? 'medium' : 'high', 'dynamodb');
    }
  },
};
