/**
 * docker-compose: each service is a node. Known images become stores / caches / queues / edge
 * proxies; everything else (and anything with `build:`) is a deployable app. `depends_on` links.
 */
import type { NodeKind } from '../../../schema/src/index.ts';
import type { Adapter, Draft } from '../types.ts';
import { isMap, parseYaml, type Yaml } from '../yaml.ts';

const IMAGE_KIND: [RegExp, NodeKind, string, string[]][] = [
  [/^(postgres|postgresql|pgvector|timescale|timescaledb|supabase\/postgres|bitnami\/postgresql)/, 'store', 'persistence', ['postgres']],
  [/^(mysql|mariadb|percona|bitnami\/mysql)/, 'store', 'persistence', ['mysql']],
  [/^(mongo|mongodb|bitnami\/mongodb)/, 'store', 'persistence', ['mongodb']],
  [/^(amazon\/dynamodb-local|dynamodb)/, 'store', 'persistence', ['dynamodb']],
  [/^(cockroachdb|clickhouse|neo4j|cassandra|scylladb|couchdb|couchbase|influxdb|questdb|surrealdb|arangodb|edgedb|yugabytedb)/, 'store', 'persistence', ['database']],
  [/^(minio|localstack|azurite|fake-gcs-server|gcs-emulator)/, 'store', 'persistence', ['object-storage']],
  [/^(redis|valkey|keydb|memcached|dragonfly|bitnami\/redis)/, 'cache', 'persistence', ['redis']],
  [/^(rabbitmq|kafka|confluentinc\/|redpanda|bitnami\/kafka|nats|activemq|pulsar|eclipse-mosquitto|emqx|zookeeper|elasticmq|softwaremill\/elasticmq)/, 'queue', 'domain', ['messaging']],
  [/^(elasticsearch|opensearch|meilisearch|typesense|getmeili|solr|qdrant|weaviate|chroma|milvus)/, 'store', 'persistence', ['search']],
  [/^(nginx|traefik|caddy|haproxy|envoyproxy|kong|tyk|apache|httpd|cloudflare\/cloudflared)/, 'middleware', 'edge', ['proxy']],
  [/^(mailhog|mailpit|maildev|axllent\/mailpit|stripe\/stripe-mock|stripemock|wiremock|mockserver|prism|hoverfly)/, 'external', 'external', ['mock']],
  [/^(prom\/prometheus|grafana|jaegertracing|otel\/|loki|tempo|datadog|sentry)/, 'external', 'external', ['observability']],
  [/^(keycloak|quay\.io\/keycloak|ory\/|authentik|zitadel)/, 'external', 'external', ['auth']],
  [/^(temporalio|temporal|inngest|hatchet|windmill|n8n|airflow|apache\/airflow|prefecthq)/, 'job', 'domain', ['workflow']],
];

export const compose: Adapter = {
  id: 'compose',
  detect: (ctx) => ctx.hasFile(/(^|\/)(docker-)?compose(\.[\w-]+)?\.ya?ml$/),
  scan(ctx, out) {
    for (const f of ctx.files) {
      if (!/^(?:[^/]+\/)?(?:docker-)?compose(\.[\w-]+)?\.ya?ml$/.test(f.rel)) continue;
      const doc = parseYaml(ctx.textOf(f.rel));
      const services = isMap(doc) ? doc.services : undefined;
      if (!isMap(services)) continue;
      const ids = new Map<string, string>();
      const entries = Object.entries(services).filter(([, s]) => isMap(s)) as [string, { [k: string]: Yaml }][];
      for (const [name, s] of entries) {
        const image = typeof s.image === 'string' ? s.image : '';
        const imageName = image.replace(/^docker\.io\/(library\/)?/, '').replace(/^(ghcr|quay)\.io\//, '').split(':')[0]!.toLowerCase();
        let kind: NodeKind = 'app';
        let layer = 'domain';
        let tags: string[] = ['compose'];
        if (!s.build) for (const [re, k, l, t] of IMAGE_KIND) if (re.test(imageName)) { kind = k; layer = l; tags = ['compose', ...t]; break; }
        const build = typeof s.build === 'string' ? s.build : isMap(s.build) ? String(s.build.context ?? '.') : undefined;
        const ports = Array.isArray(s.ports) ? s.ports.map(String) : [];
        const id = `infra:compose:${name}`;
        const line = ctx.textOf(f.rel).split('\n').findIndex((l) => new RegExp(`^\\s{2}${name}\\s*:`).test(l)) + 1;
        const d: Draft = {
          id,
          label: name,
          kind,
          layer,
          summary: image ? `${image}${ports.length ? ' · ' + ports.join(', ') : ''}` : build ? `built from ${build}${ports.length ? ' · ' + ports.join(', ') : ''}` : 'compose service',
          files: [{ path: f.rel, lines: [line || 1, line || 1], role: 'config' }],
          tags,
          meta: { image: image || undefined, build, ports: ports.length ? ports : undefined },
          ownedFiles: [],
        };
        if (build) {
          const dir = build.replace(/^\.\//, '').replace(/\/$/, '');
          const pkg = ctx.packages.find((p) => p.dir === dir || (dir === '.' && p.dir === ''));
          if (pkg && pkg.dir) d.files!.push({ path: pkg.dir + '/', role: 'source' });
          if (pkg) d.meta = { ...d.meta, package: pkg.name };
        }
        if (kind === 'app' && !build && image) d.layer = 'external', d.kind = 'external';
        out.drafts.push(d);
        ids.set(name, id);
        out.resources.set(`compose:${name}`, id);
      }
      for (const [name, s] of entries) {
        const from = ids.get(name)!;
        const deps = Array.isArray(s.depends_on) ? s.depends_on.map(String) : isMap(s.depends_on) ? Object.keys(s.depends_on) : [];
        for (const dep of deps) {
          const to = ids.get(dep);
          if (!to) continue;
          const target = out.drafts.find((d) => d.id === to)!;
          const kind = target.kind === 'queue' ? 'emits' : target.kind === 'store' || target.kind === 'cache' ? 'writes' : 'calls';
          out.edges.push({ id: `${kind}:${from}->${to}`, from, to, kind, label: 'depends_on', confidence: 'low', meta: { via: 'compose' } });
        }
      }
    }
  },
};
