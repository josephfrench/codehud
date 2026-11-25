/**
 * AWS CDK (TypeScript): `new Table(this, 'Orders', {...})` constructs become nodes; `grant*()`
 * calls, event sources, subscriptions, API integrations and `environment: { X: t.tableName }`
 * become edges; `entry:` / `Code.fromAsset()` link functions to the handler files they deploy.
 */
import type { EdgeKind } from '../../../schema/src/index.ts';
import { dirOf } from '../fs.ts';
import { resolveSpecifier } from '../imports.ts';
import { laneHintFromPath } from '../lanes.ts';
import type { Adapter, Draft, ScanOutput, SourceFile } from '../types.ts';
import { cdkKind } from './infra-kinds.ts';
import { matchBrace } from './route-tables.ts';

const NEW_RE = /(?:(?:const|let|var)\s+([\w$]+)\s*=\s*|this\.([\w$]+)\s*=\s*)?new\s+(?:\w+\.)?([A-Z]\w*)\(\s*(?:this|scope|stack)\s*,\s*(['"`])([\w.-]+)\4\s*(,\s*\{)?/g;

function normalise(parts: string[]): string {
  const out: string[] = [];
  for (const p of parts) { if (!p || p === '.') continue; if (p === '..') out.pop(); else out.push(p); }
  return out.join('/');
}

export const cdk: Adapter = {
  id: 'cdk',
  detect: (ctx) => ctx.hasDep('aws-cdk-lib') || ctx.hasFile(/(^|\/)cdk\.json$/),
  scan(ctx, out) {
    const vars = new Map<string, Draft>(); // per-file identifier -> node
    const add = (from: string, to: string, kind: EdgeKind, label?: string) => {
      if (from === to) return;
      const id = `${kind}:${from}->${to}`;
      if (!out.edges.some((e) => e.id === id)) out.edges.push({ id, from, to, kind, label, confidence: 'medium', meta: { via: 'cdk' } });
    };
    const stackFiles = ctx.sources.filter((s) => /from\s+['"]aws-cdk-lib|require\(\s*['"]aws-cdk-lib/.test(s.text));
    for (const file of stackFiles) {
      vars.clear();
      const text = file.text;
      const stackName = /class\s+(\w+)\s+extends\s+(?:cdk\.)?(?:Stack|NestedStack)\b/.exec(text)?.[1];
      for (const m of text.matchAll(NEW_RE)) {
        const ident = m[1] ?? m[2];
        const cls = m[3]!;
        const cid = m[5]!;
        const k = cdkKind(cls);
        if (!k || k.skip) continue;
        let props = '';
        if (m[6]) {
          const open = m.index! + m[0].lastIndexOf('{');
          props = text.slice(open + 1, matchBrace(text, open, '{', '}') - 1);
        }
        const id = `infra:cdk:${stackName ? stackName + '/' : ''}${cid}`;
        const line = text.slice(0, m.index!).split('\n').length;
        const d: Draft = {
          id,
          label: /\b(tableName|bucketName|queueName|topicName|functionName|restApiName|apiName|serviceName|ruleName|stateMachineName|clusterName|userPoolName)\s*:\s*['"`]([\w.-]+)['"`]/.exec(props)?.[2] ?? cid,
          kind: k.kind,
          layer: k.layer,
          summary: `${k.label} (${cls})`,
          files: [{ path: file.rel, lines: [line, line], role: 'config' }],
          tags: ['cdk', ...k.tags],
          meta: { construct: cls, stack: stackName },
          ownedFiles: [],
        };
        if (k.kind === 'table') {
          const pk = /partitionKey\s*:\s*\{[^}]*name\s*:\s*['"`](\w+)['"`][^}]*type\s*:\s*\w+\.(\w+)/.exec(props);
          const sk = /sortKey\s*:\s*\{[^}]*name\s*:\s*['"`](\w+)['"`][^}]*type\s*:\s*\w+\.(\w+)/.exec(props);
          const cols = [pk, sk].filter((x): x is RegExpExecArray => !!x).map((x) => ({ name: x[1]!, type: x[2]!.toLowerCase() }));
          d.meta = { ...d.meta, columns: cols, hashKey: pk?.[1], rangeKey: sk?.[1] };
          if (pk) d.summary = `DynamoDB table, key ${pk[1]}${sk ? ' + ' + sk[1] : ''}`;
          const store = 'store:dynamodb';
          if (!out.drafts.some((x) => x.id === store)) out.drafts.push({ id: store, label: 'DynamoDB', kind: 'store', layer: 'persistence', summary: 'AWS DynamoDB', tags: ['aws', 'dynamodb'], meta: { type: 'dynamodb' }, ownedFiles: [] });
          d.parent = store;
        }
        if (k.kind === 'function') {
          const entry = /\bentry\s*:\s*(?:path\.join\([^)]*?,\s*)?['"`]([^'"`]+)['"`]/.exec(props)?.[1];
          const handler = /\bhandler\s*:\s*['"`]([\w./-]+)['"`]/.exec(props)?.[1];
          const asset = /Code\.fromAsset\(\s*(?:path\.join\([^)]*?,\s*)?['"`]([^'"`]+)['"`]/.exec(props)?.[1];
          const runtime = /Runtime\.(\w+)/.exec(props)?.[1];
          d.meta = { ...d.meta, entry, handler, runtime };
          d.summary = `Lambda${runtime ? ' · ' + runtime : ''}${handler ? ' · ' + handler : entry ? ' · ' + entry : ''}`;
          const owned: string[] = [];
          if (entry) {
            const rel = entry.startsWith('.') ? normalise([...dirOf(file.rel).split('/'), ...entry.split('/')]) : normalise(entry.split('/'));
            const hit = resolveSpecifier('./' + rel.split('/').pop()!, { ...file, rel: rel } as SourceFile, ctx.fileSet) ?? (ctx.fileSet.has(rel) ? rel : undefined);
            if (hit) owned.push(hit);
          } else if (asset && handler) {
            const base = handler.split('.')[0]!;
            const dir = asset.startsWith('.') ? normalise([...dirOf(file.rel).split('/'), ...asset.split('/')]) : normalise(asset.split('/'));
            for (const ext of ['ts', 'js', 'mjs', 'py']) { const rel = `${dir}/${base}.${ext}`; if (ctx.fileSet.has(rel)) { owned.push(rel); break; } }
          }
          for (const rel of owned) (out.handlers.get(rel) ?? out.handlers.set(rel, []).get(rel)!).push(d.id);
        }
        if (k.kind === 'event') {
          const sched = /Schedule\.(?:rate|cron|expression)\(([^)]*)\)/.exec(props)?.[0];
          if (sched) { d.kind = 'job'; d.summary = `schedule ${sched.replace(/\s+/g, ' ')}`; d.meta = { ...d.meta, schedule: sched }; }
        }
        const envBlock = /\benvironment\s*:\s*\{/.exec(props);
        if (envBlock) {
          const open = props.indexOf('{', envBlock.index);
          const body = props.slice(open + 1, matchBrace(props, open, '{', '}') - 1);
          for (const e of body.matchAll(/([A-Z][A-Z0-9_]*)\s*:\s*(?:this\.)?([\w$]+)\.(tableName|bucketName|queueUrl|queueName|topicArn|functionName|streamName|clusterArn|secretArn|parameterName|url|apiEndpoint|userPoolId)/g)) {
            const target = vars.get(e[2]!);
            if (!target) continue;
            out.envRefs.set(e[1]!, target.id);
            add(d.id, target.id, target.kind === 'queue' ? 'emits' : 'depends', `env ${e[1]}`);
          }
        }
        out.drafts.push(d);
        out.resources.set(cid, d.id);
        if (ident) vars.set(ident, d);
      }
      // grants, event sources, subscriptions, integrations, targets
      const ref = (name: string | undefined) => (name ? vars.get(name.replace(/^this\./, '')) : undefined);
      for (const m of text.matchAll(/\b(?:this\.)?([\w$]+)\.grant(ReadWriteData|ReadData|WriteData|FullAccess|Read|Write|ReadWrite|Put|Delete|SendMessages|ConsumeMessages|Publish|Invoke|StartExecution|Read|Write)\(\s*(?:this\.)?([\w$]+)/g)) {
        const target = ref(m[1]);
        const grantee = ref(m[3]);
        if (!target || !grantee) continue;
        const g = m[2]!;
        const kinds: EdgeKind[] = /Consume/.test(g) ? ['listens'] : /Send|Publish/.test(g) ? ['emits'] : /Invoke|StartExecution/.test(g) ? ['calls'] : /ReadWrite|FullAccess/.test(g) ? ['reads', 'writes'] : /Read/.test(g) ? ['reads'] : ['writes'];
        for (const k of kinds) add(grantee.id, target.id, k, `grant${g}`);
      }
      for (const m of text.matchAll(/\b(?:this\.)?([\w$]+)\.addEventSource\(\s*new\s+(?:\w+\.)?(\w+EventSource)\(\s*(?:this\.)?([\w$]+)/g)) {
        const fn = ref(m[1]);
        const src = ref(m[3]);
        if (fn && src) add(fn.id, src.id, 'listens', m[2]);
      }
      for (const m of text.matchAll(/\b(?:this\.)?([\w$]+)\.addSubscription\(\s*new\s+(?:\w+\.)?(?:LambdaSubscription|SqsSubscription)\(\s*(?:this\.)?([\w$]+)/g)) {
        const topic = ref(m[1]);
        const sub = ref(m[2]);
        if (topic && sub) add(sub.id, topic.id, 'listens', 'subscription');
      }
      for (const m of text.matchAll(/\b(?:this\.)?([\w$]+)\.addTarget\(\s*new\s+(?:\w+\.)?(?:LambdaFunction|SqsQueue|SfnStateMachine|SnsTopic)\(\s*(?:this\.)?([\w$]+)/g)) {
        const rule = ref(m[1]);
        const target = ref(m[2]);
        if (rule && target) add(target.id, rule.id, 'listens', 'event target');
      }
      // REST: api.root.addResource('orders').addMethod('GET', new LambdaIntegration(fn))
      for (const m of text.matchAll(/\b(?:this\.)?([\w$]+)(?:\.root)?((?:\.addResource\(\s*['"`][^'"`]+['"`]\s*\))*)\.addMethod\(\s*['"`](\w+)['"`]\s*,\s*new\s+(?:\w+\.)?LambdaIntegration\(\s*(?:this\.)?([\w$]+)/g)) {
        const api = ref(m[1]);
        const fn = ref(m[4]);
        if (!api) continue;
        const path = '/' + [...m[2]!.matchAll(/addResource\(\s*['"`]([^'"`]+)['"`]/g)].map((x) => x[1]!.replace(/^\{(\w+)\}$/, '[$1]')).join('/');
        const id = `${api.id}#${m[3]} ${path}`;
        if (!out.drafts.some((d) => d.id === id)) out.drafts.push({ id, label: `${m[3]} ${path}`, kind: 'route', layer: 'api', parent: api.id, summary: `${m[3]} ${path}`, files: api.files, tags: ['cdk', 'aws'], meta: { method: m[3], path }, routePath: path, laneHint: laneHintFromPath(path), ownedFiles: [] });
        if (fn) add(id, fn.id, 'calls', 'integration');
      }
      // HTTP API: api.addRoutes({ path: '/x', methods: [HttpMethod.GET], integration: new HttpLambdaIntegration('x', fn) })
      for (const m of text.matchAll(/\b(?:this\.)?([\w$]+)\.addRoutes\(\s*\{([\s\S]*?)\}\s*\)/g)) {
        const api = ref(m[1]);
        if (!api) continue;
        const path = /\bpath\s*:\s*['"`]([^'"`]+)['"`]/.exec(m[2]!)?.[1];
        const methods = [...m[2]!.matchAll(/HttpMethod\.(\w+)/g)].map((x) => x[1]!);
        const fn = ref(/Integration\(\s*['"`][^'"`]*['"`]\s*,\s*(?:this\.)?([\w$]+)/.exec(m[2]!)?.[1]);
        if (!path) continue;
        const label = `${methods.join(',') || 'ANY'} ${path.replace(/\{(\w+)\}/g, '[$1]')}`;
        const id = `${api.id}#${label}`;
        if (!out.drafts.some((d) => d.id === id)) out.drafts.push({ id, label, kind: 'route', layer: 'api', parent: api.id, summary: label, files: api.files, tags: ['cdk', 'aws'], meta: { method: methods, path }, routePath: path.replace(/\{(\w+)\}/g, '[$1]'), laneHint: laneHintFromPath(path), ownedFiles: [] });
        if (fn) add(id, fn.id, 'calls', 'integration');
      }
      // LambdaRestApi({ handler: fn }) / proxy
      for (const m of text.matchAll(/new\s+(?:\w+\.)?LambdaRestApi\(\s*(?:this|scope)\s*,\s*['"`]([\w.-]+)['"`]\s*,\s*\{[^}]*\bhandler\s*:\s*(?:this\.)?([\w$]+)/g)) {
        const api = out.drafts.find((d) => d.id.endsWith('/' + m[1]) || d.id === `infra:cdk:${m[1]}`);
        const fn = ref(m[2]);
        if (api && fn) add(api.id, fn.id, 'calls', 'proxy');
      }
    }
  },
};

export type { ScanOutput };
