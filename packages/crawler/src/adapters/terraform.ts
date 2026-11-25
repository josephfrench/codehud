/**
 * Terraform: `resource "type" "name" { ... }` blocks become nodes by resource type; references
 * between blocks (`aws_dynamodb_table.orders.arn`) become edges; `environment { variables = { X =
 * aws_dynamodb_table.orders.name } }` registers env refs so code reading `process.env.X` lands on
 * the right table; event source mappings, subscriptions and API integrations become edges.
 */
import type { EdgeKind } from '../../../schema/src/index.ts';
import { baseOf, dirOf, stripExt } from '../fs.ts';
import { laneHintFromPath } from '../lanes.ts';
import type { Adapter, CrawlContext, Draft, ScanOutput } from '../types.ts';
import { tfKind } from './infra-kinds.ts';
import { matchBrace } from './route-tables.ts';

interface Block { type: string; name: string; body: string; file: string; line: number; addr: string }

/** Parse resource/module/data blocks out of HCL (string-aware brace matching). */
export function parseHcl(text: string, file: string): Block[] {
  const out: Block[] = [];
  const re = /^\s*(resource|data|module)\s+"([\w-]+)"(?:\s+"([\w-]+)")?\s*\{/gm;
  for (const m of text.matchAll(re)) {
    const open = m.index! + m[0].length - 1;
    const close = matchBrace(text, open, '{', '}');
    const kind = m[1]!;
    const type = kind === 'module' ? 'module' : m[2]!;
    const name = kind === 'module' ? m[2]! : m[3] ?? '';
    const line = text.slice(0, m.index!).split('\n').length;
    out.push({ type, name, body: text.slice(open + 1, close - 1), file, line, addr: kind === 'resource' ? `${type}.${name}` : kind === 'data' ? `data.${type}.${name}` : `module.${name}` });
  }
  return out;
}

function attr(body: string, key: string): string | undefined {
  const m = new RegExp(`(^|\\n)\\s*${key}\\s*=\\s*(?:"([^"\\n]*)"|([^\\n]+))`).exec(body);
  const v = m?.[2] ?? m?.[3]?.trim();
  return v?.replace(/\$\{([^}]+)\}/g, '$1');
}

/** `environment { variables = { KEY = expr } }` → KEY -> referenced resource address (first resource ref). */
function envVars(body: string): Map<string, string> {
  const out = new Map<string, string>();
  const idx = body.search(/\bvariables\s*=\s*\{/);
  if (idx < 0) return out;
  const open = body.indexOf('{', idx);
  const close = matchBrace(body, open, '{', '}');
  for (const m of body.slice(open + 1, close - 1).matchAll(/([A-Z][A-Z0-9_]*)\s*=\s*([^\n]+)/g)) {
    const ref = /\b((?:aws|google|azurerm|cloudflare|upstash|mongodbatlas)_\w+\.[\w-]+)/.exec(m[2]!)?.[1];
    if (ref) out.set(m[1]!, ref);
  }
  return out;
}

export const terraform: Adapter = {
  id: 'terraform',
  detect: (ctx) => ctx.hasFile(/\.tf$/),
  scan(ctx, out) {
    const blocks: Block[] = [];
    for (const f of ctx.files) if (f.ext === 'tf') blocks.push(...parseHcl(ctx.textOf(f.rel), f.rel));
    const nodeByAddr = new Map<string, Draft>();
    const functions: Draft[] = [];
    const sourceFiles = new Set(ctx.sources.map((s) => s.rel));

    for (const b of blocks) {
      if (b.addr.startsWith('data.')) continue;
      if (b.type === 'module') {
        const src = attr(b.body, 'source') ?? '';
        const d: Draft = { id: `infra:tf:module.${b.name}`, label: b.name, kind: 'module', layer: 'domain', summary: `Terraform module ${src}`, files: [{ path: b.file, lines: [b.line, b.line], role: 'config' }], tags: ['terraform', 'module'], meta: { source: src }, ownedFiles: [] };
        if (src.startsWith('.')) {
          const dir = dirOf(b.file) ? `${dirOf(b.file)}/${src}` : src;
          const norm = dir.split('/').reduce<string[]>((acc, s) => { if (s === '..') acc.pop(); else if (s && s !== '.') acc.push(s); return acc; }, []).join('/');
          if (ctx.dirs.has(norm)) d.files!.push({ path: norm + '/', role: 'source' });
        }
        out.drafts.push(d);
        nodeByAddr.set(b.addr, d);
        out.resources.set(b.addr, d.id);
        continue;
      }
      const k = tfKind(b.type);
      if (!k) continue;
      // plumbing resources never become nodes; their references become edges below
      if (/^aws_(lambda_event_source_mapping|sns_topic_subscription|apigatewayv2_integration|cloudwatch_event_target|s3_bucket_notification|lambda_permission|iam_|security_group|vpc|subnet|route_table|cloudwatch_log_group|apigatewayv2_stage|api_gateway_(deployment|stage|integration)|lambda_function_event_invoke_config|sqs_queue_policy|s3_bucket_(policy|versioning|public_access_block|server_side_encryption_configuration|lifecycle_configuration|cors_configuration|ownership_controls|acl))/.test(b.type)) continue;
      const label = attr(b.body, 'name') ?? attr(b.body, 'bucket') ?? attr(b.body, 'function_name') ?? attr(b.body, 'identifier') ?? attr(b.body, 'route_key') ?? attr(b.body, 'path_part') ?? b.name;
      const d: Draft = {
        id: `infra:tf:${b.addr}`,
        label: label.replace(/^var\./, '$'),
        kind: k.kind,
        layer: k.layer,
        summary: `${k.label} (${b.type})`,
        files: [{ path: b.file, lines: [b.line, b.line + b.body.split('\n').length], role: 'config' }],
        tags: ['terraform', ...k.tags],
        meta: { type: b.type, address: b.addr },
        ownedFiles: [],
      };
      if (k.kind === 'table') {
        const hash = attr(b.body, 'hash_key');
        const range = attr(b.body, 'range_key');
        const cols = [...b.body.matchAll(/attribute\s*\{\s*name\s*=\s*"(\w+)"\s*type\s*=\s*"(\w+)"/g)].map((m) => ({ name: m[1]!, type: m[2] === 'S' ? 'string' : m[2] === 'N' ? 'number' : 'binary' }));
        d.meta = { ...d.meta, hashKey: hash, rangeKey: range, columns: cols };
        d.summary = `${k.label}${hash ? `, key ${hash}${range ? ' + ' + range : ''}` : ''}`;
        if (b.type === 'aws_dynamodb_table') {
          const store = 'store:dynamodb';
          if (!out.drafts.some((x) => x.id === store)) out.drafts.push({ id: store, label: 'DynamoDB', kind: 'store', layer: 'persistence', summary: 'AWS DynamoDB', tags: ['aws', 'dynamodb'], meta: { type: 'dynamodb' }, ownedFiles: [] });
          d.parent = store;
        }
      }
      if (k.kind === 'function') {
        const handler = attr(b.body, 'handler');
        const runtime = attr(b.body, 'runtime');
        const schedule = attr(b.body, 'schedule_expression');
        d.meta = { ...d.meta, handler, runtime, schedule };
        d.summary = `${k.label}${runtime ? ` · ${runtime}` : ''}${handler ? ` · ${handler}` : ''}`;
        if (handler) {
          const base = handler.split('.')[0]!.split('/').pop()!;
          const candidates = [...sourceFiles].filter((f) => stripExt(baseOf(f)) === base && !/\.(test|spec)\./.test(f));
          if (candidates.length === 1) (out.handlers.get(candidates[0]!) ?? out.handlers.set(candidates[0]!, []).get(candidates[0]!)!).push(d.id);
        }
        functions.push(d);
      }
      if (k.kind === 'event') {
        const schedule = attr(b.body, 'schedule_expression');
        if (schedule) { d.kind = 'job'; d.summary = `schedule ${schedule}`; d.meta = { ...d.meta, schedule }; }
      }
      if (k.kind === 'route' && /^aws_apigatewayv2_route$/.test(b.type)) {
        const api = /api_id\s*=\s*(aws_apigatewayv2_api\.[\w-]+)/.exec(b.body)?.[1];
        if (api) d.parent = `infra:tf:${api}`;
        d.label = attr(b.body, 'route_key') ?? d.label;
        const [method, routePath] = d.label.includes(' ') ? d.label.split(' ') : ['ANY', d.label];
        d.meta = { ...d.meta, path: routePath, method };
        if (routePath?.startsWith('/')) { d.routePath = routePath.replace(/\{(\w+)\+?\}/g, '[$1]'); d.laneHint = laneHintFromPath(d.routePath); }
      }
      out.drafts.push(d);
      nodeByAddr.set(b.addr, d);
      out.resources.set(b.addr, d.id);
    }
    if (functions.length >= 3) {
      const gid = 'infra:tf:functions';
      out.drafts.push({ id: gid, label: 'Lambda functions', kind: 'function', layer: 'domain', summary: `${functions.length} functions`, tags: ['terraform', 'aws', 'lambda'], ownedFiles: [] });
      for (const f of functions) f.parent = gid;
    }
    // parents that were only set by address need to exist
    for (const d of out.drafts) if (d.parent && d.parent.startsWith('infra:tf:') && !out.drafts.some((x) => x.id === d.parent)) delete d.parent;

    // edges from references
    const refRe = /\b((?:aws|google|azurerm|cloudflare|upstash|mongodbatlas|kubernetes|helm|vercel)_\w+)\.([\w-]+)\b/g;
    const add = (from: string, to: string, kind: EdgeKind, label?: string) => {
      if (from === to) return;
      const id = `${kind}:${from}->${to}`;
      if (out.edges.some((e) => e.id === id)) return;
      out.edges.push({ id, from, to, kind, label, confidence: 'medium', meta: { via: 'terraform' } });
    };
    for (const b of blocks) {
      if (b.addr.startsWith('data.')) continue;
      const self = nodeByAddr.get(b.addr);
      const refs = new Set<string>();
      for (const m of b.body.matchAll(refRe)) refs.add(`${m[1]}.${m[2]}`);
      // plumbing resources: connect what they reference to each other
      if (!self) {
        const targets = [...refs].map((r) => nodeByAddr.get(r)).filter((x): x is Draft => !!x);
        const fn = targets.find((t) => t.kind === 'function' || t.kind === 'app');
        const other = targets.filter((t) => t !== fn);
        if (b.type === 'aws_lambda_event_source_mapping' && fn) for (const o of other) add(fn.id, o.id, 'listens', 'event source');
        else if ((b.type === 'aws_sns_topic_subscription' || b.type === 'aws_cloudwatch_event_target' || b.type === 'aws_s3_bucket_notification') && fn) for (const o of other) add(fn.id, o.id, 'listens', b.type.replace(/^aws_/, ''));
        else if ((b.type === 'aws_apigatewayv2_integration' || b.type === 'aws_api_gateway_integration') && fn) for (const o of other) add(o.id, fn.id, 'calls', 'integration');
        continue;
      }
      const env = envVars(b.body);
      for (const [name, addr] of env) {
        const target = nodeByAddr.get(addr);
        if (!target) continue;
        out.envRefs.set(name, target.id);
        add(self.id, target.id, target.kind === 'queue' ? 'emits' : 'depends', `env ${name}`);
      }
      for (const r of refs) {
        const target = nodeByAddr.get(r);
        if (!target || target === self) continue;
        if ([...env.values()].includes(r)) continue;
        const kind: EdgeKind = self.kind === 'route' && (target.kind === 'function' || target.kind === 'app') ? 'calls' : 'depends';
        add(self.id, target.id, kind);
      }
    }
  },
};

export type { CrawlContext, ScanOutput };
