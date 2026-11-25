/**
 * Serverless Framework (`serverless.yml`), AWS SAM and plain CloudFormation templates. Functions,
 * their HTTP / queue / schedule / stream events, declared resources, environment references and
 * SAM policy templates (DynamoDBCrudPolicy etc.) all become nodes and edges.
 */
import type { EdgeKind } from '../../../schema/src/index.ts';
import { baseOf, stripExt } from '../fs.ts';
import type { Adapter, CrawlContext, Draft, ScanOutput } from '../types.ts';
import { isMap, parseYaml, refsIn, type Yaml } from '../yaml.ts';
import { laneHintFromPath } from '../lanes.ts';
import { cfnKind } from './infra-kinds.ts';
import { tidyRoute } from './drafts.ts';

const str = (v: Yaml | undefined): string | undefined => (typeof v === 'string' ? v : typeof v === 'number' ? String(v) : undefined);
const get = (v: Yaml | undefined, k: string): Yaml | undefined => (isMap(v) ? v[k] : undefined);

function ensureDynamo(out: ScanOutput): string {
  const store = 'store:dynamodb';
  if (!out.drafts.some((x) => x.id === store)) out.drafts.push({ id: store, label: 'DynamoDB', kind: 'store', layer: 'persistence', summary: 'AWS DynamoDB', tags: ['aws', 'dynamodb'], meta: { type: 'dynamodb' }, ownedFiles: [] });
  return store;
}

/** Find the source file for `handler: src/handlers/orders.create` or `app.handler` + CodeUri. */
function handlerFile(handler: string | undefined, codeUri: string | undefined, baseDir: string, ctx: CrawlContext): string | undefined {
  if (!handler) return undefined;
  const parts = handler.split('.');
  if (parts.length < 2) return undefined;
  const modulePath = parts.slice(0, -1).join('.');
  const dirs = [[baseDir, codeUri ?? ''].filter(Boolean).join('/').replace(/\/+$/, ''), baseDir, ''].map((d) => d.replace(/^\.\//, ''));
  for (const d of dirs) {
    for (const ext of ['ts', 'js', 'mjs', 'cjs', 'py', 'go']) {
      const rel = [d, `${modulePath}.${ext}`].filter(Boolean).join('/').replace(/\/\.\//g, '/');
      if (ctx.fileSet.has(rel)) return rel;
      const idx = [d, modulePath, `index.${ext}`].filter(Boolean).join('/');
      if (ctx.fileSet.has(idx)) return idx;
    }
  }
  // last resort: unique basename match
  const base = baseOf(modulePath);
  const hits = ctx.sources.filter((s) => stripExt(s.base) === base && !/\.(test|spec)\./.test(s.rel));
  return hits.length === 1 ? hits[0]!.rel : undefined;
}

interface Ctx { file: string; out: ScanOutput; ctx: CrawlContext; byLogical: Map<string, Draft> }

function resourceNode(c: Ctx, logicalId: string, type: string, props: Yaml | undefined, line: number): Draft | undefined {
  const k = cfnKind(type);
  if (!k || k.skip) return undefined;
  const nameKeys = ['TableName', 'BucketName', 'QueueName', 'TopicName', 'FunctionName', 'Name', 'StateMachineName', 'DBInstanceIdentifier', 'ServiceName', 'UserPoolName', 'StageName'];
  let label = logicalId;
  for (const nk of nameKeys) { const v = str(get(props, nk)); if (v && !/^\$\{|^!/.test(v)) { label = v; break; } }
  const d: Draft = {
    id: `infra:cfn:${logicalId}`,
    label,
    kind: k.kind,
    layer: k.layer,
    summary: `${k.label} (${type.replace(/^AWS::/, '')})`,
    files: [{ path: c.file, lines: [line, line], role: 'config' }],
    tags: ['cloudformation', ...k.tags],
    meta: { type, logicalId },
    ownedFiles: [],
  };
  if (k.kind === 'table') {
    const attrs = get(props, 'AttributeDefinitions');
    const cols = Array.isArray(attrs) ? attrs.map((a) => ({ name: str(get(a, 'AttributeName')) ?? '?', type: str(get(a, 'AttributeType')) === 'N' ? 'number' : 'string' })) : [];
    const pk = str(get(get(props, 'PrimaryKey'), 'Name'));
    if (pk) cols.push({ name: pk, type: (str(get(get(props, 'PrimaryKey'), 'Type')) ?? 'string').toLowerCase() });
    d.meta = { ...d.meta, columns: cols };
    d.parent = ensureDynamo(c.out);
  }
  if (k.kind === 'event') {
    const sched = str(get(props, 'ScheduleExpression'));
    if (sched) { d.kind = 'job'; d.summary = `schedule ${sched}`; d.meta = { ...d.meta, schedule: sched }; }
  }
  c.out.drafts.push(d);
  c.byLogical.set(logicalId, d);
  c.out.resources.set(logicalId, d.id);
  return d;
}

function addEdge(out: ScanOutput, from: string, to: string, kind: EdgeKind, label?: string, confidence: 'low' | 'medium' | 'high' = 'medium'): void {
  if (from === to) return;
  const id = `${kind}:${from}->${to}`;
  if (!out.edges.some((e) => e.id === id)) out.edges.push({ id, from, to, kind, label, confidence, meta: { via: 'serverless' } });
}

/** `env: { X: !Ref Y }` → the function depends on Y (queues: emits). Code scanning later refines tables to reads / writes. */
function envEdges(c: Ctx, fn: Draft, env: Yaml | undefined, shared = false): void {
  if (!isMap(env)) return;
  for (const [name, v] of Object.entries(env)) {
    for (const ref of refsIn(v)) {
      const t = c.byLogical.get(ref);
      if (!t) continue;
      c.out.envRefs.set(name, t.id);
      addEdge(c.out, fn.id, t.id, t.kind === 'queue' ? 'emits' : 'depends', `env ${name}`, shared ? 'low' : 'medium');
    }
  }
}

/** One function's `events` (serverless) or `Events` (SAM) list → route nodes + edges. */
function functionEvents(c: Ctx, fn: Draft, events: Yaml | undefined, apiParentFor: (name?: string) => string | undefined): void {
  const list: { type: string; props: Yaml }[] = [];
  if (Array.isArray(events)) for (const e of events) if (isMap(e)) for (const [type, props] of Object.entries(e)) list.push({ type, props });
  if (isMap(events)) for (const e of Object.values(events)) if (isMap(e) && typeof e.Type === 'string') list.push({ type: e.Type, props: e.Properties ?? null });
  for (const { type, props } of list) {
    const t = type.toLowerCase();
    if (t === 'http' || t === 'httpapi' || t === 'api' || t === 'alb') {
      let method: string | undefined;
      let path: string | undefined;
      if (typeof props === 'string') { const m = /^(\w+)\s+(\S+)$/.exec(props.trim()); method = m?.[1]; path = m?.[2]; if (!m) path = props; }
      else { method = str(get(props, 'method')) ?? str(get(props, 'Method')); path = str(get(props, 'path')) ?? str(get(props, 'Path')); }
      if (!path) continue;
      method = (method ?? 'ANY').toUpperCase();
      if (method === '*') method = 'ANY';
      const routePath = tidyRoute(path.replace(/\{(\w+)\+?\}/g, '[$1]').split('/'));
      const apiRef = refsIn(get(props, 'RestApiId') ?? get(props, 'ApiId') ?? null);
      const parent = apiParentFor([...apiRef][0]);
      const id = `route:${c.file}#${method} ${routePath}`;
      if (!c.out.drafts.some((d) => d.id === id)) {
        c.out.drafts.push({ id, label: `${method} ${routePath}`, kind: 'route', layer: 'api', parent, summary: `${method} ${routePath} → ${fn.label}`, files: fn.files, tags: ['aws', t === 'alb' ? 'alb' : 'apigateway'], meta: { method, path: routePath }, routePath, laneHint: laneHintFromPath(routePath), ownedFiles: [] });
      }
      addEdge(c.out, id, fn.id, 'calls', 'integration');
    } else if (t === 'sqs' || t === 'sns' || t === 'stream' || t === 'dynamodb' || t === 'kinesis' || t === 's3' || t === 'msk' || t === 'kafka' || t === 'eventbridge' || t === 'cloudwatchevent' || t === 'iot' || t === 'cognitouserpool' || t === 'activemq' || t === 'rabbitmq') {
      const refs = typeof props === 'string' ? new Set<string>() : refsIn(props);
      let linked = false;
      for (const r of refs) { const target = c.byLogical.get(r); if (target) { addEdge(c.out, fn.id, target.id, 'listens', t); linked = true; } }
      if (!linked) {
        const name = typeof props === 'string' ? props : str(get(props, 'arn')) ?? str(get(props, 'topicName')) ?? str(get(props, 'bucket')) ?? str(get(props, 'Bucket')) ?? str(get(props, 'Queue')) ?? str(get(props, 'Topic')) ?? str(get(props, 'Stream')) ?? str(get(props, 'EventBusName')) ?? str(get(props, 'eventBus'));
        const short = name?.split(':').pop()?.split('/').pop();
        if (!short || /\$\{|^!|^arn:aws:.*\*/.test(short)) { if (t === 'eventbridge' || t === 'cloudwatchevent') { const sched = str(get(props, 'schedule')) ?? str(get(props, 'Schedule')); if (sched) { fn.meta = { ...fn.meta, schedule: sched }; fn.tags = [...(fn.tags ?? []), 'scheduled']; } } continue; }
        const kind = t === 's3' ? 'store' : t === 'eventbridge' || t === 'cloudwatchevent' ? 'event' : 'queue';
        const id = `infra:ext:${kind}:${short}`;
        if (!c.out.drafts.some((d) => d.id === id)) c.out.drafts.push({ id, label: short, kind, layer: kind === 'store' ? 'persistence' : 'domain', summary: `${t} (external to this stack)`, tags: ['aws', t], meta: { arn: name }, ownedFiles: [] });
        addEdge(c.out, fn.id, id, 'listens', t);
      }
    } else if (t === 'schedule' || t === 'scheduleV2'.toLowerCase()) {
      const expr = typeof props === 'string' ? props : str(get(props, 'rate')) ?? str(get(props, 'Schedule')) ?? str(get(props, 'ScheduleExpression')) ?? str(get(props, 'schedule'));
      fn.meta = { ...fn.meta, schedule: expr };
      fn.tags = [...(fn.tags ?? []), 'scheduled'];
      if (fn.kind === 'function') fn.summary = `${fn.summary} · ${expr ?? 'scheduled'}`;
    } else if (t === 'websocket') {
      const route = typeof props === 'string' ? props : str(get(props, 'route')) ?? str(get(props, 'Route'));
      const id = `route:${c.file}#WS ${route}`;
      if (route && !c.out.drafts.some((d) => d.id === id)) c.out.drafts.push({ id, label: `ws ${route}`, kind: 'route', layer: 'api', summary: `WebSocket route ${route}`, files: fn.files, tags: ['aws', 'websocket'], meta: { protocol: 'ws', route }, ownedFiles: [] });
      if (route) addEdge(c.out, id, fn.id, 'calls', 'integration');
    }
  }
}

function samPolicies(c: Ctx, fn: Draft, policies: Yaml | undefined): void {
  const list = Array.isArray(policies) ? policies : policies ? [policies] : [];
  for (const p of list) {
    if (!isMap(p)) continue;
    for (const [name, props] of Object.entries(p)) {
      const kinds: EdgeKind[] = /Crud|Write|Send|Publish|Put/.test(name) ? (/Crud|ReadWrite/.test(name) ? ['reads', 'writes'] : /Send|Publish/.test(name) ? ['emits'] : ['writes']) : /Read|Get|Poller|Consume|Receive/.test(name) ? (/Poller|Consume|Receive/.test(name) ? ['listens'] : ['reads']) : /Invoke|Execution/.test(name) ? ['calls'] : ['depends'];
      for (const r of refsIn(props)) { const t = c.byLogical.get(r); if (t) for (const k of kinds) addEdge(c.out, fn.id, t.id, k, name); }
    }
  }
}

function functionNode(c: Ctx, logicalId: string, label: string, handler: string | undefined, codeUri: string | undefined, runtime: string | undefined, baseDir: string, line: number, group: string | undefined): Draft {
  const d: Draft = {
    id: `infra:cfn:${logicalId}`,
    label,
    kind: 'function',
    layer: 'domain',
    summary: `Lambda${runtime ? ' · ' + runtime : ''}${handler ? ' · ' + handler : ''}`,
    files: [{ path: c.file, lines: [line, line], role: 'config' }],
    tags: ['aws', 'lambda'],
    meta: { handler, runtime, codeUri, logicalId },
    parent: group,
    ownedFiles: [],
  };
  const file = handlerFile(handler, codeUri, baseDir, c.ctx);
  if (file) (c.out.handlers.get(file) ?? c.out.handlers.set(file, []).get(file)!).push(d.id);
  c.out.drafts.push(d);
  c.byLogical.set(logicalId, d);
  c.out.resources.set(logicalId, d.id);
  return d;
}

function lineOfKey(text: string, key: string): number {
  const i = text.search(new RegExp(`^\\s*${key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*:`, 'm'));
  return i < 0 ? 1 : text.slice(0, i).split('\n').length;
}

function crawlServerless(file: string, text: string, out: ScanOutput, ctx: CrawlContext): void {
  const doc = parseYaml(text);
  if (!isMap(doc) || !isMap(doc.functions)) return;
  const c: Ctx = { file, out, ctx, byLogical: new Map() };
  const baseDir = file.includes('/') ? file.slice(0, file.lastIndexOf('/')) : '';
  const service = str(doc.service) ?? str(get(doc.service, 'name')) ?? 'service';
  const providerEnv = get(doc.provider, 'environment');
  const runtime = str(get(doc.provider, 'runtime'));
  // declared resources first so refs resolve
  const resources = get(doc.resources, 'Resources');
  if (isMap(resources)) for (const [id, r] of Object.entries(resources)) { const type = str(get(r, 'Type')); if (type) resourceNode(c, id, type, get(r, 'Properties'), lineOfKey(text, id)); }
  const fnEntries = Object.entries(doc.functions).filter(([, f]) => isMap(f));
  const group = fnEntries.length >= 3 ? `infra:cfn:${service}:functions` : undefined;
  if (group) out.drafts.push({ id: group, label: `${service} functions`, kind: 'function', layer: 'domain', summary: `${fnEntries.length} Lambda functions`, files: [{ path: file, role: 'config' }], tags: ['serverless', 'aws', 'lambda'], ownedFiles: [] });
  const fns: [Draft, Yaml][] = [];
  for (const [name, f] of fnEntries) {
    const fn = functionNode(c, name, name, str(get(f, 'handler')), undefined, str(get(f, 'runtime')) ?? runtime, baseDir, lineOfKey(text, name), group);
    fn.tags = ['serverless', 'aws', 'lambda'];
    fns.push([fn, f]);
  }
  const apiParent = () => undefined;
  for (const [fn, f] of fns) {
    envEdges(c, fn, providerEnv, true);
    envEdges(c, fn, get(f, 'environment'));
    functionEvents(c, fn, get(f, 'events'), apiParent);
  }
  // provider-level iam statements referencing resources: depends
  const stmts = get(get(doc.provider, 'iam'), 'role');
  for (const r of refsIn(get(stmts, 'statements') ?? get(doc.provider, 'iamRoleStatements') ?? null)) {
    const t = c.byLogical.get(r);
    if (t) for (const [fn] of fns) addEdge(out, fn.id, t.id, 'depends', 'iam');
  }
}

function crawlCfn(file: string, text: string, out: ScanOutput, ctx: CrawlContext): void {
  const doc = parseYaml(text);
  if (!isMap(doc) || !isMap(doc.Resources)) return;
  const c: Ctx = { file, out, ctx, byLogical: new Map() };
  const baseDir = file.includes('/') ? file.slice(0, file.lastIndexOf('/')) : '';
  const globals = get(get(doc.Globals, 'Function'), 'Environment');
  const globalCodeUri = str(get(get(doc.Globals, 'Function'), 'CodeUri'));
  const globalRuntime = str(get(get(doc.Globals, 'Function'), 'Runtime'));
  const entries = Object.entries(doc.Resources).filter(([, r]) => isMap(r) && typeof r.Type === 'string') as [string, { [k: string]: Yaml }][];
  const fnEntries = entries.filter(([, r]) => /^AWS::(Serverless|Lambda)::Function$/.test(r.Type as string));
  const stackName = stripExt(baseOf(file)) === 'template' ? (baseDir.split('/').pop() || 'stack') : stripExt(baseOf(file));
  const group = fnEntries.length >= 3 ? `infra:cfn:${stackName}:functions` : undefined;
  if (group) out.drafts.push({ id: group, label: `${stackName} functions`, kind: 'function', layer: 'domain', summary: `${fnEntries.length} Lambda functions`, files: [{ path: file, role: 'config' }], tags: ['cloudformation', 'aws', 'lambda'], ownedFiles: [] });
  for (const [id, r] of entries) {
    const type = r.Type as string;
    if (/^AWS::(Serverless|Lambda)::Function$/.test(type)) continue;
    resourceNode(c, id, type, r.Properties, lineOfKey(text, id));
  }
  const fns: [Draft, Yaml][] = [];
  for (const [id, r] of fnEntries) {
    const p = r.Properties;
    const handler = str(get(p, 'Handler'));
    const codeUri = str(get(p, 'CodeUri')) ?? str(get(get(p, 'Code'), 'S3Key')) ?? globalCodeUri;
    const fn = functionNode(c, id, str(get(p, 'FunctionName')) ?? id, handler, codeUri, str(get(p, 'Runtime')) ?? globalRuntime, baseDir, lineOfKey(text, id), group);
    fn.tags = [(r.Type as string).startsWith('AWS::Serverless') ? 'sam' : 'cloudformation', 'aws', 'lambda'];
    fns.push([fn, p ?? null]);
  }
  const apiParent = (name?: string) => (name ? c.byLogical.get(name)?.id : undefined);
  for (const [fn, p] of fns) {
    envEdges(c, fn, get(globals, 'Variables'), true);
    envEdges(c, fn, get(get(p, 'Environment'), 'Variables'));
    functionEvents(c, fn, get(p, 'Events'), apiParent);
    samPolicies(c, fn, get(p, 'Policies'));
  }
  // plumbing resources that wire things together
  for (const [, r] of entries) {
    const type = r.Type as string;
    const refs = [...refsIn(r.Properties ?? null)].map((x) => c.byLogical.get(x)).filter((x): x is Draft => !!x);
    const fn = refs.find((x) => x.kind === 'function');
    if (!fn) continue;
    if (type === 'AWS::Lambda::EventSourceMapping' || type === 'AWS::SNS::Subscription') for (const o of refs) if (o !== fn) addEdge(out, fn.id, o.id, 'listens', type.split('::').pop());
    if (type === 'AWS::Events::Rule') for (const o of refs) if (o !== fn) addEdge(out, fn.id, o.id, 'listens', 'rule');
    if (type === 'AWS::ApiGatewayV2::Integration' || type === 'AWS::ApiGateway::Method') for (const o of refs) if (o !== fn && o.kind === 'route') addEdge(out, o.id, fn.id, 'calls', 'integration');
  }
}

export const serverless: Adapter = {
  id: 'serverless',
  detect: (ctx) => ctx.hasFile(/(^|\/)serverless\.ya?ml$/) || ctx.hasFile(/(^|\/)(template|sam-template|cloudformation|stack)[\w.-]*\.ya?ml$/) || ctx.files.some((f) => /\.(ya?ml|json)$/.test(f.rel) && /^(template|cfn|stack)/.test(f.base) && /AWSTemplateFormatVersion|Transform:\s*['"]?AWS::Serverless/.test(ctx.textOf(f.rel))),
  scan(ctx, out) {
    for (const f of ctx.files) {
      if (/(^|\/)serverless\.ya?ml$/.test(f.rel)) crawlServerless(f.rel, ctx.textOf(f.rel), out, ctx);
      else if (/\.ya?ml$/.test(f.rel) && !/(^|\/)(\.github|node_modules|docker-compose|compose)/.test(f.rel)) {
        const text = ctx.textOf(f.rel);
        if (/^\s*(AWSTemplateFormatVersion|Transform\s*:\s*['"]?AWS::Serverless)/m.test(text) && /^Resources\s*:/m.test(text)) crawlCfn(f.rel, text, out, ctx);
      } else if (f.ext === 'json' && /^(template|cfn|stack)/.test(f.base)) {
        try {
          const doc = JSON.parse(ctx.textOf(f.rel));
          if (doc && typeof doc === 'object' && (doc.AWSTemplateFormatVersion || doc.Transform) && doc.Resources) crawlCfn(f.rel, ctx.textOf(f.rel), out, ctx);
        } catch { /* not a template */ }
      }
    }
  },
};
