/**
 * NestJS: controllers declare routes with decorators, providers are services, guards /
 * interceptors / pipes / filters / middleware sit at the edge, `@Cron` and Bull processors are
 * jobs, `@OnEvent` / `EventEmitter.emit` are events, gateways and resolvers are endpoints.
 */
import { baseOf, dirOf, firstDocSentence, stripExt } from '../fs.ts';
import { laneHintFromPath } from '../lanes.ts';
import type { Adapter, Draft, GroupKey, SourceFile } from '../types.ts';
import { fileRef, simpleDraft, srcRootOf, tidyRoute, withExports } from './drafts.ts';
import { preClassify } from './generic.ts';
import { matchBrace } from './route-tables.ts';

const SUFFIX_RE = /\.(controller|service|module|guard|interceptor|pipe|filter|middleware|gateway|resolver|processor|consumer|listener|subscriber|repository|entity|dto|schema|strategy|decorator|constants?|interface|enum|types?|config|provider|factory|job|cron|scheduler|task)\.ts$/;
const METHOD_DECORATOR_RE = /@(Get|Post|Put|Patch|Delete|Options|Head|All)\(\s*(?:(['"`])([^'"`]*)\2)?\s*\)/g;

function feature(file: SourceFile): { dir: string; label: string; hint: string | undefined } {
  const srcRoot = srcRootOf(file);
  const within = file.rel.slice(srcRoot.length);
  const segs = dirOf(within).split('/').filter(Boolean);
  const feat = segs.slice(0, 2);
  const dir = srcRoot + (feat.length ? feat.join('/') + '/' : '');
  return { dir, label: feat.join('/') || 'app', hint: laneHintFromPath(feat.join('/')) };
}
function group(file: SourceFile, kind: GroupKey['kind'], layer: string, noun: string, min: number): GroupKey {
  const f = feature(file);
  return { id: `${kind === 'module' ? 'module' : kind + 's'}:${f.dir}`, label: f.label, kind, layer, laneHint: f.hint, dir: f.dir, summaryNoun: noun, min };
}

export function controllerRoutes(file: SourceFile, owner: Draft): Draft[] {
  const text = file.text;
  const ctl = /@Controller\(\s*(?:(['"`])([^'"`]*)\1|\{[^}]*\bpath\s*:\s*(['"`])([^'"`]*)\3)?/.exec(text);
  if (!ctl) return [];
  const prefix = (ctl[2] ?? ctl[4] ?? '').replace(/^\/|\/$/g, '');
  const version = /@Controller\(\s*\{[^}]*\bversion\s*:\s*['"`](\w+)/.exec(text)?.[1];
  const out: Draft[] = [];
  const seen = new Set<string>();
  for (const m of text.matchAll(METHOD_DECORATOR_RE)) {
    const method = m[1]!.toUpperCase();
    const sub = (m[3] ?? '').replace(/^\//, '');
    const segs = [...(version ? [`v${version}`] : []), ...prefix.split('/'), ...sub.split('/')];
    const routePath = tidyRoute(segs);
    const key = `${method} ${routePath}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const handler = /^\s*(?:async\s+)?(\w+)\s*\(/m.exec(text.slice(m.index! + m[0].length, m.index! + m[0].length + 400).replace(/@\w+\([^)]*\)\s*/g, ''))?.[1];
    out.push({
      id: `route:${file.rel}#${key}`,
      label: key,
      kind: 'route',
      layer: 'api',
      parent: owner.id,
      summary: handler ? `${handler}()` : key,
      files: [fileRef(file.rel)],
      meta: { method, path: routePath, handler },
      routePath,
      laneHint: laneHintFromPath(routePath),
      ownedFiles: [],
    });
    if (out.length >= 30) break;
  }
  return out;
}

export const nest: Adapter = {
  id: 'nest',
  priority: 72,
  detect: (ctx) => ctx.frameworks.has('nest'),
  classify(file, ctx) {
    const pre = preClassify(file);
    if (pre) return pre;
    if (file.ext !== 'ts') return undefined;
    const text = file.text;
    const m = SUFFIX_RE.exec(file.rel);
    const kind = m?.[1];
    const base = stripExt(baseOf(file.rel));
    const name = base.replace(/\.[\w-]+$/, '');
    const f = feature(file);

    if (kind === 'controller' || /@Controller\(/.test(text)) {
      const d: Draft = {
        id: `module:${file.rel}`,
        label: `${name} controller`,
        kind: 'module',
        layer: 'api',
        summary: firstDocSentence(text),
        files: [fileRef(file.rel)],
        tags: ['nest', 'controller'],
        laneHint: f.hint,
        ownedFiles: [file.rel],
      };
      const routes = controllerRoutes(file, d);
      d.summary ??= routes.length ? `${routes.length} routes` : 'Controller';
      if (!routes.length) d.group = group(file, 'module', 'api', 'controllers', ctx.opts.dirGroupMin);
      return { kind: 'node', draft: d, extra: routes };
    }
    if (kind === 'gateway' || /@WebSocketGateway\(/.test(text)) {
      const events = [...text.matchAll(/@SubscribeMessage\(\s*(['"`])([^'"`]+)\1/g)].map((x) => x[2]!);
      return { kind: 'node', draft: simpleDraft(file, 'route', 'api', `${name} gateway`, firstDocSentence(text) ?? (events.length ? `ws: ${events.slice(0, 5).join(', ')}` : 'WebSocket gateway'), undefined, { tags: ['nest', 'websocket'], meta: { protocol: 'ws', messages: events } }) };
    }
    if (kind === 'resolver' || /@Resolver\(/.test(text)) {
      const ops = [...text.matchAll(/@(Query|Mutation|Subscription)\(/g)].length;
      return { kind: 'node', draft: simpleDraft(file, 'route', 'api', `${name} resolver`, firstDocSentence(text) ?? `GraphQL resolver (${ops} operations)`, undefined, { tags: ['nest', 'graphql'], meta: { protocol: 'graphql' } }) };
    }
    if (kind === 'guard' || kind === 'interceptor' || kind === 'pipe' || kind === 'filter' || kind === 'middleware' || kind === 'strategy' || /@Injectable\(\)[\s\S]{0,200}implements\s+(CanActivate|NestInterceptor|PipeTransform|ExceptionFilter|NestMiddleware)/.test(text)) {
      return { kind: 'node', draft: simpleDraft(file, 'middleware', 'edge', `${name} ${kind ?? 'middleware'}`, firstDocSentence(text) ?? `Nest ${kind ?? 'middleware'}`, group(file, 'middleware', 'edge', 'request pipeline', ctx.opts.dirGroupMin), { tags: ['nest', kind ?? 'middleware'] }) };
    }
    if (kind === 'processor' || kind === 'consumer' || /@Processor\(/.test(text)) {
      const q = /@Processor\(\s*(['"`])([^'"`]+)\1/.exec(text)?.[2];
      return { kind: 'node', draft: simpleDraft(file, 'job', 'domain', `${name} processor`, firstDocSentence(text) ?? (q ? `Consumes queue ${q}` : 'Queue processor'), group(file, 'job', 'domain', 'workers', ctx.opts.dirGroupMin), { tags: ['nest', 'bull'], meta: { queue: q } }) };
    }
    if (kind === 'job' || kind === 'cron' || kind === 'scheduler' || kind === 'task' || /@(Cron|Interval|Timeout)\(/.test(text)) {
      const crons = [...text.matchAll(/@Cron\(\s*(?:CronExpression\.(\w+)|(['"`])([^'"`]+)\2)/g)].map((x) => x[1] ?? x[3]!);
      return { kind: 'node', draft: simpleDraft(file, 'job', 'domain', name, firstDocSentence(text) ?? (crons.length ? `cron: ${crons.join(', ')}` : 'Scheduled job'), group(file, 'job', 'domain', 'jobs', ctx.opts.dirGroupMin), { tags: ['nest', 'schedule'], meta: { schedule: crons } }) };
    }
    if (kind === 'listener' || kind === 'subscriber' || /@OnEvent\(/.test(text)) {
      const evs = [...text.matchAll(/@OnEvent\(\s*(['"`])([^'"`]+)\1/g)].map((x) => x[2]!);
      return { kind: 'node', draft: simpleDraft(file, 'service', 'domain', name, firstDocSentence(text) ?? `Listens: ${evs.slice(0, 4).join(', ')}`, group(file, 'service', 'domain', 'services', ctx.opts.dirGroupMin), { tags: ['nest', 'events'], meta: { listens: evs } }) };
    }
    if (kind === 'service' || kind === 'repository' || kind === 'provider' || kind === 'factory' || /@Injectable\(/.test(text)) {
      const d = simpleDraft(file, 'service', 'domain', name + (kind === 'repository' ? ' repository' : ''), firstDocSentence(text) ?? 'Injectable service', group(file, 'service', 'domain', 'services', ctx.opts.dirGroupMin), { tags: ['nest'] });
      return { kind: 'node', draft: withExports(d, ctx) };
    }
    if (kind === 'module' || /@Module\(/.test(text)) {
      const body = /@Module\(\s*\{/.exec(text);
      let imports: string[] = [];
      if (body) {
        const open = text.indexOf('{', body.index!);
        const close = matchBrace(text, open, '{', '}');
        const inner = text.slice(open, close);
        imports = (/imports\s*:\s*\[([^\]]*)\]/.exec(inner)?.[1] ?? '').split(',').map((s) => s.trim().split(/[.(]/)[0]!).filter(Boolean);
      }
      return { kind: 'node', draft: simpleDraft(file, 'module', 'domain', `${name} module`, firstDocSentence(text) ?? (imports.length ? `imports ${imports.slice(0, 5).join(', ')}` : 'Nest module'), group(file, 'module', 'domain', 'modules', ctx.opts.dirGroupMin), { tags: ['nest', 'module'], meta: { imports } }) };
    }
    if (kind === 'entity' || kind === 'schema') return undefined; // typeorm / mongoose adapters own these via scan; file becomes a module node too
    if (kind === 'dto' || kind === 'interface' || kind === 'enum' || kind === 'types' || kind === 'type' || kind === 'constants' || kind === 'constant' || kind === 'decorator' || kind === 'config') {
      const d = simpleDraft(file, 'module', 'domain', base, firstDocSentence(text) ?? `${kind} definitions`, group(file, 'module', 'domain', 'modules', ctx.opts.dirGroupMin), { tags: ['nest'] });
      return { kind: 'node', draft: withExports(d, ctx) };
    }
    if (base === 'main') return { kind: 'node', draft: simpleDraft(file, 'config', 'api', 'bootstrap', firstDocSentence(text) ?? 'NestFactory bootstrap', undefined, { tags: ['nest'] }) };
    return undefined;
  },
  edges(file, from, ectx, sink) {
    const text = file.text;
    // events: emit / listen
    for (const m of text.matchAll(/\.emit(?:Async)?\(\s*(['"`])([\w.:-]+)\1/g)) {
      const id = `event:${m[2]}`;
      if (ectx.nodes.has(id)) sink.add(from, id, 'emits', 'medium', 'nest-events');
    }
    for (const m of text.matchAll(/@OnEvent\(\s*(['"`])([\w.:*-]+)\1/g)) {
      const id = `event:${m[2]}`;
      if (ectx.nodes.has(id)) sink.add(from, id, 'listens', 'high', 'nest-events');
    }
    // bull queues
    for (const m of text.matchAll(/@InjectQueue\(\s*(['"`])([\w-]+)\1/g)) {
      const id = `queue:bull:${m[2]}`;
      if (ectx.nodes.has(id)) sink.add(from, id, 'emits', 'high', 'bull');
    }
    for (const m of text.matchAll(/@Processor\(\s*(['"`])([\w-]+)\1/g)) {
      const id = `queue:bull:${m[2]}`;
      if (ectx.nodes.has(id)) sink.add(from, id, 'listens', 'high', 'bull');
    }
    // DI: constructor(private readonly x: XService) -> imports already cover it via the import graph
  },
  scan(ctx, out) {
    // event and queue names used anywhere become nodes so edges have somewhere to land
    const events = new Map<string, Set<string>>();
    const queues = new Map<string, Set<string>>();
    for (const s of ctx.sources) {
      for (const m of s.text.matchAll(/@OnEvent\(\s*(['"`])([\w.:-]+)\1/g)) (events.get(m[2]!) ?? events.set(m[2]!, new Set()).get(m[2]!)!).add(s.rel);
      for (const m of s.text.matchAll(/\b(?:eventEmitter|emitter|events|this\.\w*[eE]mitter)\.emit(?:Async)?\(\s*(['"`])([\w.:-]+)\1/g)) (events.get(m[2]!) ?? events.set(m[2]!, new Set()).get(m[2]!)!).add(s.rel);
      for (const m of s.text.matchAll(/@(?:InjectQueue|Processor)\(\s*(['"`])([\w-]+)\1/g)) (queues.get(m[2]!) ?? queues.set(m[2]!, new Set()).get(m[2]!)!).add(s.rel);
      for (const m of s.text.matchAll(/registerQueue\(\s*\{\s*name\s*:\s*(['"`])([\w-]+)\1/g)) (queues.get(m[2]!) ?? queues.set(m[2]!, new Set()).get(m[2]!)!).add(s.rel);
    }
    for (const [name, files] of [...events].sort()) {
      out.drafts.push({ id: `event:${name}`, label: name, kind: 'event', layer: 'domain', summary: `Domain event (${files.size} files)`, tags: ['nest', 'event'], meta: { name }, ownedFiles: [] });
    }
    for (const [name, files] of [...queues].sort()) {
      out.drafts.push({ id: `queue:bull:${name}`, label: `${name} queue`, kind: 'queue', layer: 'domain', summary: `Bull queue (${files.size} files)`, tags: ['nest', 'bull'], meta: { name }, ownedFiles: [] });
    }
  },
};
