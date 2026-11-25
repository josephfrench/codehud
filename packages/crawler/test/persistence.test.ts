import assert from 'node:assert/strict';
import { test } from 'node:test';
import { crawlFixture, edge, node } from './helpers.ts';

test('mongoose: models become tables under a MongoDB store; find/create usage becomes reads/writes', async () => {
  const { map, adapters } = await crawlFixture('compose-app');
  assert.ok(adapters.includes('mongoose'));
  const user = node(map, 'table:User');
  assert.equal(user.parent, 'store:mongodb');
  assert.deepEqual((user.meta?.columns as { name: string }[]).map((c) => c.name), ['email', 'name', 'createdAt']);
  edge(map, 'reads', 'module:src/index.ts', 'table:User');
  edge(map, 'writes', 'module:src/index.ts', 'table:User');
  edge(map, 'reads', 'module:src/index.ts', 'table:Order');
  // express routes inside the module
  node(map, 'route:src/index.ts#POST /users');
  assert.match(node(map, 'module:src/models/user.ts').summary ?? '', /1 table: User/);
});

test('sequelize: define() models, dialect from the connection, findAll/create usage', async () => {
  const { map, adapters } = await crawlFixture('sequelize-app');
  assert.ok(adapters.includes('sequelize'));
  const t = node(map, 'table:customers');
  assert.equal(t.parent, 'store:sequelize:postgres');
  edge(map, 'reads', 'module:src/server.ts', 'table:customers');
  edge(map, 'writes', 'module:src/server.ts', 'table:customers');
  node(map, 'route:src/server.ts#GET /customers');
});

test('supabase: migrations declare tables with columns, client.from() usage reads/writes, storage buckets', async () => {
  const { map, adapters } = await crawlFixture('supabase-app');
  assert.ok(adapters.includes('supabase') && adapters.includes('sveltekit'));
  const posts = node(map, 'table:posts');
  assert.equal(posts.parent, 'store:supabase');
  assert.deepEqual((posts.meta?.columns as { name: string; type: string }[]).map((c) => `${c.name}:${c.type}`), ['id:bigint', 'author:uuid', 'body:text']);
  assert.equal(posts.files?.[0]?.role, 'schema');
  // +page.server.ts is attached to its page, so the page is what reads
  edge(map, 'reads', 'page:src/routes/+page.svelte', 'table:posts');
  edge(map, 'writes', 'page:src/routes/profile/+page.svelte', 'table:profiles');
  edge(map, 'writes', 'page:src/routes/profile/+page.svelte', 'store:supabase:bucket:avatars');
  edge(map, 'calls', 'module:src/lib/db.ts', 'external:supabase');
});

test('dynamodb from code: TableName literals and env references', async () => {
  const { map } = await crawlFixture('cdk-app');
  // process.env.TABLE_NAME in lambda/create.ts resolved to the CDK table through envRefs
  edge(map, 'writes', 'infra:cdk:OrdersStack/CreateOrder', 'infra:cdk:OrdersStack/OrdersTable');
  assert.ok(!map.nodes.some((n) => n.id === 'table:dynamodb:$TABLE_NAME'), 'env-named placeholder table must not appear when infra resolves the variable');
});
