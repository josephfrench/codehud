/**
 * Python (stretch): regex import graph over `.py` files, FastAPI / Flask / Django routes, Django
 * and SQLAlchemy models, Celery tasks, and PyPI dependencies as externals. No native parsers.
 */
import { baseOf, dirOf, firstDocSentence, stripExt } from '../fs.ts';
import { laneHintFromPath } from '../lanes.ts';
import type { Adapter, CrawlContext, Draft, ImportRecord, ScanOutput, SourceFile } from '../types.ts';
import { fileRef, tidyRoute } from './drafts.ts';

const PY_EXTERNALS: [RegExp, string, string, string[]][] = [
  [/^stripe$/, 'stripe', 'Stripe', ['payments']],
  [/^(boto3|botocore|aioboto3|aiobotocore)$/, 'aws', 'AWS', ['cloud']],
  [/^google-cloud-/, 'gcp', 'Google Cloud', ['cloud']],
  [/^azure-/, 'azure', 'Azure', ['cloud']],
  [/^openai$/, 'openai', 'OpenAI', ['ai']],
  [/^anthropic$/, 'anthropic', 'Anthropic', ['ai']],
  [/^google-generativeai$/, 'google-ai', 'Google AI', ['ai']],
  [/^sendgrid$/, 'sendgrid', 'SendGrid', ['email']],
  [/^twilio$/, 'twilio', 'Twilio', ['sms']],
  [/^(resend)$/, 'resend', 'Resend', ['email']],
  [/^slack[-_]sdk$/, 'slack', 'Slack', ['messaging']],
  [/^pygithub$/i, 'github', 'GitHub', ['devtools']],
  [/^sentry[-_]sdk$/, 'sentry', 'Sentry', ['observability']],
  [/^posthog$/, 'posthog', 'PostHog', ['analytics']],
  [/^supabase$/, 'supabase', 'Supabase', ['baas']],
  [/^firebase[-_]admin$/, 'firebase', 'Firebase', ['baas']],
  [/^(pinecone|pinecone-client)$/, 'pinecone', 'Pinecone', ['vector']],
  [/^algoliasearch$/, 'algolia', 'Algolia', ['search']],
  [/^(hubspot-api-client)$/, 'hubspot', 'HubSpot', ['crm']],
  [/^simple-salesforce$/, 'salesforce', 'Salesforce', ['crm']],
  [/^(auth0-python)$/, 'auth0', 'Auth0', ['auth']],
  [/^(mapbox)$/, 'mapbox', 'Mapbox', ['maps']],
];
const PY_STORES: [RegExp, string, string, 'store' | 'cache' | 'queue', string[]][] = [
  [/^(psycopg2|psycopg2-binary|psycopg|asyncpg|pg8000)$/, 'store:postgres', 'Postgres', 'store', ['postgres']],
  [/^(pymysql|mysqlclient|mysql-connector-python|aiomysql)$/, 'store:mysql', 'MySQL', 'store', ['mysql']],
  [/^(pymongo|motor|mongoengine|beanie)$/, 'store:mongodb', 'MongoDB', 'store', ['mongodb']],
  [/^(redis|aioredis|hiredis|redis-py)$/, 'cache:redis', 'Redis', 'cache', ['redis']],
  [/^(celery)$/, 'queue:celery', 'Celery broker', 'queue', ['celery']],
  [/^(pika|aio-pika|kombu)$/, 'queue:rabbitmq', 'RabbitMQ', 'queue', ['rabbitmq']],
  [/^(kafka-python|confluent-kafka|aiokafka)$/, 'queue:kafka', 'Kafka', 'queue', ['kafka']],
  [/^(elasticsearch|opensearch-py)$/, 'store:search', 'Search index', 'store', ['search']],
];

export function pyDeps(ctx: CrawlContext): Set<string> {
  const deps = new Set<string>();
  const norm = (s: string) => s.trim().toLowerCase().replace(/_/g, '-');
  for (const f of ctx.files) {
    if (/^requirements(-[\w]+)?\.txt$/.test(f.base) || f.base === 'Pipfile' || f.base === 'pyproject.toml' || f.base === 'setup.py' || f.base === 'setup.cfg') {
      const text = ctx.textOf(f.rel);
      if (f.base.endsWith('.txt')) for (const line of text.split('\n')) { const m = /^\s*([A-Za-z0-9][\w.-]*)/.exec(line); if (m && !line.trim().startsWith('-')) deps.add(norm(m[1]!)); }
      else if (f.base === 'pyproject.toml') {
        for (const m of text.matchAll(/^\s*["']([A-Za-z0-9][\w.-]*)(?:\[[^\]]*\])?\s*[><=!~;"']/gm)) deps.add(norm(m[1]!));
        for (const m of text.matchAll(/^\s*([A-Za-z0-9][\w.-]*)\s*=\s*(?:["'^~>=<]|\{)/gm)) if (!/^(python|name|version|description|authors|readme|license|requires-python|build-backend|requires)$/.test(m[1]!)) deps.add(norm(m[1]!));
      } else if (f.base === 'Pipfile') for (const m of text.matchAll(/^\s*([A-Za-z0-9][\w.-]*)\s*=/gm)) deps.add(norm(m[1]!));
      else for (const m of text.matchAll(/["']([A-Za-z0-9][\w.-]*)(?:\[[^\]]*\])?\s*[><=!~]/g)) deps.add(norm(m[1]!));
    }
  }
  return deps;
}

/** Resolve `a.b.c` / `.x` / `..x` to a repo file. */
function resolvePy(module: string, level: number, from: SourceFile, ctx: CrawlContext, roots: string[]): string | undefined {
  const tryPath = (base: string): string | undefined => {
    const p = base.replace(/\/+$/, '');
    if (ctx.fileSet.has(`${p}.py`)) return `${p}.py`;
    if (ctx.fileSet.has(`${p}/__init__.py`)) return `${p}/__init__.py`;
    return undefined;
  };
  const parts = module ? module.split('.') : [];
  if (level > 0) {
    let dir = dirOf(from.rel);
    for (let i = 1; i < level; i++) dir = dirOf(dir);
    const hit = tryPath([dir, ...parts].filter(Boolean).join('/'));
    if (hit) return hit;
    // `from . import x` → x may be a module
    return undefined;
  }
  for (const r of roots) {
    const hit = tryPath([r, ...parts].filter(Boolean).join('/'));
    if (hit) return hit;
    if (parts.length > 1) { const hit2 = tryPath([r, ...parts.slice(0, -1)].filter(Boolean).join('/')); if (hit2) return hit2; }
  }
  return undefined;
}

function pyRoots(ctx: CrawlContext): string[] {
  const roots = new Set<string>(['']);
  for (const d of ['src', 'app', 'backend', 'server', 'api']) if (ctx.dirs.has(d)) roots.add(d);
  for (const f of ctx.files) if (f.base === 'manage.py' || f.base === 'pyproject.toml') roots.add(dirOf(f.rel));
  for (const f of ctx.files) if (f.base === '__init__.py') { const parent = dirOf(dirOf(f.rel)); roots.add(parent); }
  return [...roots];
}

const IMPORT_RE = /^[ \t]*(?:from[ \t]+(\.*)([\w.]*)[ \t]+import[ \t]+(\(?[^\n#]+)|import[ \t]+([\w.]+(?:[ \t]*,[ \t]*[\w.]+)*))/gm;

function pyImports(file: SourceFile, ctx: CrawlContext): ImportRecord[] {
  const roots = (ctx.scratch.get('python.roots') as string[] | undefined) ?? pyRoots(ctx);
  const out: ImportRecord[] = [];
  const seen = new Map<string, ImportRecord>();
  const push = (spec: string, names: string[], file2: string | undefined) => {
    const ex = seen.get(spec);
    if (ex) { for (const n of names) if (!ex.names.includes(n)) ex.names.push(n); return; }
    const rec: ImportRecord = { spec, names };
    if (file2) rec.file = file2;
    else if (!spec.startsWith('.')) rec.pkg = spec.split('.')[0]!.toLowerCase().replace(/_/g, '-');
    seen.set(spec, rec);
    out.push(rec);
  };
  for (const m of file.text.matchAll(IMPORT_RE)) {
    if (m[4]) {
      for (const mod of m[4].split(',').map((s) => s.trim().split(/\s+as\s+/)[0]!)) push(mod, [], resolvePy(mod, 0, file, ctx, roots));
      continue;
    }
    const dots = m[1]!.length;
    const mod = m[2] ?? '';
    const names = m[3]!.replace(/[()]/g, '').split(',').map((s) => s.trim().split(/\s+as\s+/)[0]!).filter((s) => s && s !== '*');
    const spec = '.'.repeat(dots) + mod;
    let resolved = resolvePy(mod, dots, file, ctx, roots);
    if (!resolved && names.length) {
      // `from pkg import module` where module is a file
      for (const n of names) { const r = resolvePy(mod ? `${mod}.${n}` : n, dots, file, ctx, roots); if (r) { resolved = r; break; } }
    }
    push(spec, names, resolved);
  }
  return out;
}

const FASTAPI_RE = /@(\w+)\.(get|post|put|patch|delete|options|head|api_route|websocket)\(\s*(['"])([^'"]*)\3/g;
const FLASK_RE = /@(\w+)\.route\(\s*(['"])([^'"]*)\2([^)]*)\)/g;
const DJANGO_PATH_RE = /\b(?:re_)?path\(\s*r?(['"])([^'"]*)\1\s*,\s*([\w.]+)/g;

function pyRoutes(file: SourceFile, owner: Draft): Draft[] {
  const out: Draft[] = [];
  const seen = new Set<string>();
  const text = file.text;
  const push = (method: string, path: string, handler?: string) => {
    const routePath = tidyRoute(path.replace(/\{(\w+)(?::[^}]*)?\}/g, '[$1]').split('/'));
    const key = `${method} ${routePath}`;
    if (seen.has(key)) return;
    seen.add(key);
    out.push({ id: `route:${file.rel}#${key}`, label: key, kind: 'route', layer: 'api', parent: owner.id, summary: handler ? `${handler}()` : key, files: [fileRef(file.rel)], meta: { method, path: routePath, handler }, routePath, laneHint: laneHintFromPath(routePath), ownedFiles: [] });
  };
  const prefix = /(?:APIRouter|Blueprint)\([^)]*?(?:prefix|url_prefix)\s*=\s*['"]([^'"]*)['"]/.exec(text)?.[1] ?? '';
  for (const m of text.matchAll(FASTAPI_RE)) {
    const handler = /^\s*(?:async\s+)?def\s+(\w+)/m.exec(text.slice(m.index! + m[0].length, m.index! + m[0].length + 300))?.[1];
    push(m[2] === 'api_route' ? 'ANY' : m[2] === 'websocket' ? 'WS' : m[2]!.toUpperCase(), prefix + m[4]!, handler);
  }
  for (const m of text.matchAll(FLASK_RE)) {
    const methods = /methods\s*=\s*\[([^\]]*)\]/.exec(m[4]!)?.[1]?.replace(/['"\s]/g, '').split(',').filter(Boolean) ?? ['GET'];
    const handler = /^\s*(?:async\s+)?def\s+(\w+)/m.exec(text.slice(m.index! + m[0].length, m.index! + m[0].length + 300))?.[1];
    push(methods.length === 1 ? methods[0]!.toUpperCase() : methods.map((x) => x.toUpperCase()).join(','), prefix + m[3]!, handler);
  }
  for (const m of text.matchAll(/@(\w+)\.(get|post|put|patch|delete)\(\s*(['"])([^'"]*)\3/g)) if (!FASTAPI_RE.test(m[0])) push(m[2]!.toUpperCase(), prefix + m[4]!);
  if (/(^|\/)urls\.py$/.test(file.rel)) for (const m of text.matchAll(DJANGO_PATH_RE)) if (!/include\(/.test(m[0])) push('ANY', '/' + m[2]!.replace(/\^|\$/g, ''), m[3]);
  return out.slice(0, 40);
}

function pyLayer(file: SourceFile, text: string): { kind: Draft['kind']; layer: string } {
  const base = stripExt(baseOf(file.rel));
  if (/^(views|api|routes|routers|endpoints|handlers|controllers|urls)$/.test(base) || /(^|\/)(views|api|routes|routers|endpoints|handlers|controllers)\//.test(file.rel) || /@\w+\.(get|post|route)\(/.test(text)) return { kind: 'module', layer: 'api' };
  if (/^(tasks|jobs|workers|celery)$/.test(base) || /@(shared_task|\w+\.task|celery\.task|app\.task)\b/.test(text)) return { kind: 'job', layer: 'domain' };
  if (/^(models|schemas|serializers|forms|entities)$/.test(base)) return { kind: 'module', layer: 'domain' };
  if (/^(services|service|domain|core|usecases|repositories|repository)$/.test(base) || /(^|\/)(services|domain|core|usecases|repositories)\//.test(file.rel)) return { kind: 'service', layer: 'domain' };
  if (/^(middleware|middlewares|auth|permissions|dependencies|deps)$/.test(base) || /(^|\/)middleware\//.test(file.rel)) return { kind: 'middleware', layer: 'edge' };
  if (/^(main|app|application|server|wsgi|asgi)$/.test(base)) return { kind: 'module', layer: 'api' };
  return { kind: 'module', layer: 'domain' };
}

export const python: Adapter = {
  id: 'python',
  priority: 80,
  codeExts: ['py'],
  detect: (ctx) => ctx.files.some((f) => f.ext === 'py') && (ctx.hasFile(/(^|\/)(pyproject\.toml|requirements(-\w+)?\.txt|Pipfile|setup\.py|manage\.py)$/) || ctx.files.filter((f) => f.ext === 'py').length >= 3),
  prepare(ctx) {
    ctx.scratch.set('python.roots', pyRoots(ctx));
    ctx.frameworks.add('python');
    const deps = pyDeps(ctx);
    if (deps.has('fastapi')) ctx.frameworks.add('fastapi');
    if (deps.has('flask')) ctx.frameworks.add('flask');
    if (deps.has('django')) ctx.frameworks.add('django');
    ctx.scratch.set('python.deps', deps);
  },
  imports(file, ctx) {
    if (file.ext !== 'py') return undefined;
    return pyImports(file, ctx);
  },
  classify(file, ctx) {
    if (file.ext !== 'py') return undefined;
    const rel = file.rel;
    if (/(^|\/)(manage|wsgi|asgi|settings|conftest|setup)\.py$/.test(rel) || /(^|\/)settings\//.test(rel)) return { kind: 'config' };
    if (/(^|\/)(tests?|test_[\w]+\.py|[\w]+_test\.py)/.test(rel)) return { kind: 'test' };
    if (/(^|\/)(migrations|__pycache__|\.venv|venv|alembic\/versions)\//.test(rel) || /(^|\/)__init__\.py$/.test(rel) && file.text.trim().length < 40) return { kind: 'skip' };
    const text = file.text;
    const base = stripExt(baseOf(rel));
    const { kind, layer } = pyLayer(file, text);
    const roots = ctx.scratch.get('python.roots') as string[];
    const root = roots.filter((r) => r && rel.startsWith(r + '/')).sort((a, b) => b.length - a.length)[0] ?? '';
    const within = root ? rel.slice(root.length + 1) : rel;
    const dirSegs = dirOf(within).split('/').filter(Boolean);
    const groupSegs = dirSegs.slice(0, 2);
    const dir = (root ? root + '/' : '') + (groupSegs.length ? groupSegs.join('/') + '/' : '');
    const label = base === '__init__' ? (groupSegs[groupSegs.length - 1] ?? 'package') : groupSegs.length ? `${groupSegs[groupSegs.length - 1]}/${base}` : base;
    const draft: Draft = {
      id: `${kind}:${rel}`,
      label,
      kind,
      layer,
      summary: firstPyDoc(text),
      files: [fileRef(rel)],
      tags: ['python'],
      group: { id: `module:${dir || 'root/'}`, label: groupSegs.join('/') || baseOf(root) || 'root', kind: kind === 'job' ? 'job' : kind === 'middleware' ? 'middleware' : 'module', layer, laneHint: laneHintFromPath(groupSegs.join('/')), dir: dir || undefined, summaryNoun: 'modules', min: ctx.opts.dirGroupMin },
      laneHint: laneHintFromPath(groupSegs.join('/')),
      ownedFiles: [rel],
    };
    const routes = pyRoutes(file, draft);
    if (routes.length) {
      draft.layer = 'api';
      draft.kind = 'module';
      draft.id = `module:${rel}`;
      for (const r of routes) r.parent = draft.id;
      draft.group = undefined;
      draft.summary ??= `${routes.length} routes`;
      draft.tags = ['python', 'router'];
      return { kind: 'node', draft, extra: routes };
    }
    return { kind: 'node', draft };
  },
  scan(ctx, out) {
    const deps = (ctx.scratch.get('python.deps') as Set<string> | undefined) ?? pyDeps(ctx);
    for (const [re, id, label, tags] of PY_EXTERNALS) {
      const hit = [...deps].filter((d) => re.test(d));
      if (!hit.length || out.drafts.some((d) => d.id === `external:${id}`)) continue;
      out.drafts.push({ id: `external:${id}`, label, kind: 'external', layer: 'external', summary: `pypi: ${hit.join(', ')}`, tags, meta: { packages: hit }, ownedFiles: [] });
    }
    for (const [re, id, label, kind, tags] of PY_STORES) {
      const hit = [...deps].filter((d) => re.test(d));
      if (!hit.length || out.drafts.some((d) => d.id === id)) continue;
      out.drafts.push({ id, label, kind, layer: kind === 'queue' ? 'domain' : 'persistence', summary: `pypi: ${hit.join(', ')}`, tags: ['python', ...tags], meta: { packages: hit }, ownedFiles: [] });
    }
    // Django / SQLAlchemy models
    for (const f of ctx.sources) {
      if (f.ext !== 'py') continue;
      const text = f.text;
      for (const m of text.matchAll(/^class\s+(\w+)\((?:models\.Model|[\w.]*Model)\)\s*:/gm)) {
        const body = text.slice(m.index! + m[0].length, m.index! + m[0].length + 4000).split(/\n(?=class\s)/)[0]!;
        const cols = [...body.matchAll(/^\s{4}(\w+)\s*=\s*models\.(\w+)\(/gm)].map((c) => ({ name: c[1]!, type: c[2]! }));
        const store = ensurePyStore(out, 'store:django', 'Database (Django ORM)', ['django']);
        const tbl = /db_table\s*=\s*['"](\w+)['"]/.exec(body)?.[1] ?? m[1]!;
        const id = `table:${tbl}`;
        if (out.drafts.some((d) => d.id === id)) continue;
        const line = text.slice(0, m.index!).split('\n').length;
        out.drafts.push({ id, label: tbl, kind: 'table', layer: 'persistence', parent: store, summary: `${cols.length} fields: ${cols.slice(0, 6).map((c) => c.name).join(', ')}${cols.length > 6 ? ', …' : ''}`, files: [{ path: f.rel, lines: [line, line + body.split('\n').length], role: 'schema' }], tags: ['django'], meta: { columns: cols, orm: 'django', model: m[1] }, ownedFiles: [] });
        out.idents.set(m[1]!, { id, via: 'python' });
      }
      for (const m of text.matchAll(/^class\s+(\w+)\((?:Base|db\.Model|DeclarativeBase|SQLModel|[\w.]*Base)[^)]*\)\s*:\s*\n([\s\S]*?)(?=^class\s|(?![\s\S]))/gm)) {
        const body = m[2]!;
        const tbl = /__tablename__\s*=\s*['"](\w+)['"]/.exec(body)?.[1];
        if (!tbl && !/table\s*=\s*True/.test(m[0])) continue;
        const cols = [...body.matchAll(/^\s{4}(\w+)\s*(?::\s*Mapped\[([^\]]+)\])?\s*=\s*(?:mapped_column|Column|db\.Column|Field)\(\s*([\w.]*)/gm)].map((c) => ({ name: c[1]!, type: (c[2] ?? c[3] ?? 'column').replace(/^(db|sa|sqlalchemy)\./, '') }));
        const store = ensurePyStore(out, 'store:sqlalchemy', 'Database (SQLAlchemy)', ['sqlalchemy']);
        const id = `table:${tbl ?? m[1]}`;
        if (out.drafts.some((d) => d.id === id)) continue;
        const line = text.slice(0, m.index!).split('\n').length;
        out.drafts.push({ id, label: tbl ?? m[1]!, kind: 'table', layer: 'persistence', parent: store, summary: `${cols.length} columns: ${cols.slice(0, 6).map((c) => c.name).join(', ')}${cols.length > 6 ? ', …' : ''}`, files: [{ path: f.rel, lines: [line, line + body.split('\n').length], role: 'schema' }], tags: ['sqlalchemy'], meta: { columns: cols, orm: 'sqlalchemy', model: m[1] }, ownedFiles: [] });
        out.idents.set(m[1]!, { id, via: 'python' });
      }
    }
  },
  edges(file, from, ectx, sink) {
    if (file.ext !== 'py') return;
    const text = file.text;
    const idents = new Map([...ectx.scan.idents].filter(([, v]) => v.via === 'python').map(([k, v]) => [k, v.id]));
    const used = new Set<string>();
    for (const imp of ectx.importsOf.get(file.rel) ?? []) for (const n of imp.names) if (idents.has(n)) used.add(n);
    for (const ident of used) {
      const id = idents.get(ident)!;
      if (ectx.nodes.get(id)?.files?.[0]?.path === file.rel) continue;
      const kinds = new Set<'reads' | 'writes' | 'depends'>();
      const esc = ident.replace(/\$/g, '\\$');
      if (new RegExp(`\\b${esc}\\.objects\\.(filter|get|all|exclude|first|last|count|exists|values|aggregate|annotate|order_by)\\(|select\\(\\s*${esc}\\b|session\\.query\\(\\s*${esc}\\b|\\.query\\(\\s*${esc}\\b`).test(text)) kinds.add('reads');
      if (new RegExp(`\\b${esc}\\.objects\\.(create|update_or_create|get_or_create|bulk_create|bulk_update|update|delete)\\(|\\b${esc}\\([^)]*\\)\\.save\\(|session\\.add\\(\\s*${esc}\\(|\\.add\\(\\s*${esc}\\(|insert\\(\\s*${esc}\\b|update\\(\\s*${esc}\\b|delete\\(\\s*${esc}\\b`).test(text)) kinds.add('writes');
      if (new RegExp(`\\b${esc}\\(`).test(text) && /\.(save|commit)\(/.test(text)) kinds.add('writes');
      if (!kinds.size) kinds.add('depends');
      for (const k of kinds) sink.add(from, id, k, k === 'depends' ? 'low' : 'high', 'python-orm', k === 'depends' ? 'references' : undefined);
    }
    // celery
    if (/@(shared_task|\w+\.task|celery\.task|app\.task)\b/.test(text) && ectx.nodes.has('queue:celery')) sink.add(from, 'queue:celery', 'listens', 'high', 'celery');
    if (/\.(delay|apply_async)\(/.test(text) && ectx.nodes.has('queue:celery')) sink.add(from, 'queue:celery', 'emits', 'high', 'celery');
    // externals by import
    for (const imp of ectx.importsOf.get(file.rel) ?? []) {
      if (!imp.pkg) continue;
      for (const [re, id] of PY_EXTERNALS) if (re.test(imp.pkg) && ectx.nodes.has(`external:${id}`)) sink.add(from, `external:${id}`, 'calls', 'high', 'dep', imp.pkg);
      for (const [re, id] of PY_STORES) if (re.test(imp.pkg) && ectx.nodes.has(id)) sink.add(from, id, id.startsWith('queue') ? 'emits' : 'calls', 'medium', 'dep', imp.pkg);
    }
    // httpx / requests to internal routes
    for (const m of text.matchAll(/\b(?:requests|httpx|client|session)\.(get|post|put|patch|delete)\(\s*f?['"](\/[^'"]*)['"]/g)) {
      const segs = m[2]!.replace(/\{[^}]*\}/g, '*').split('/').filter(Boolean);
      const hit = ectx.routes.find((r) => r.kind === 'route' && r.segments.length === segs.length && r.segments.every((s, i) => s === segs[i] || /^\[/.test(s) || segs[i] === '*'));
      if (hit) sink.add(from, hit.nodeId, 'calls', 'medium', 'http', `${m[1]!.toUpperCase()} ${m[2]}`);
    }
  },
};

function ensurePyStore(out: ScanOutput, id: string, label: string, tags: string[]): string {
  if (!out.drafts.some((d) => d.id === id)) out.drafts.push({ id, label, kind: 'store', layer: 'persistence', summary: label, tags: ['python', ...tags], meta: { orm: tags[0] }, ownedFiles: [] });
  return id;
}

function firstPyDoc(text: string): string | undefined {
  const m = /^\s*(?:"""|''')([\s\S]*?)(?:"""|''')/.exec(text) ?? /^(?:[ \t]*#.*\n)*/.exec(text);
  const body = m?.[1] ?? m?.[0]?.replace(/^\s*#\s?/gm, '');
  if (!body?.trim()) return firstDocSentence(text);
  const clean = body.replace(/\s+/g, ' ').trim();
  const s = clean.split(/(?<=\.)\s/)[0] ?? clean;
  return s.length > 140 ? s.slice(0, 137) + '…' : s;
}
