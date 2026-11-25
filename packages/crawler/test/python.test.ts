import assert from 'node:assert/strict';
import { test } from 'node:test';
import { crawlFixture, edge, node } from './helpers.ts';

test('python / fastapi: routers, SQLAlchemy models, celery tasks, pypi externals and stores', async () => {
  const { map, adapters } = await crawlFixture('python-fastapi');
  assert.ok(adapters.includes('python'));
  const router = node(map, 'module:app/routers/orders.py');
  assert.equal(router.layer, 'api');
  node(map, 'route:app/routers/orders.py#GET /orders');
  assert.equal(node(map, 'route:app/routers/orders.py#POST /orders/[order_id]/pay').meta?.handler, 'pay');
  node(map, 'route:app/main.py#GET /health');
  const table = node(map, 'table:orders');
  assert.equal(table.parent, 'store:sqlalchemy');
  assert.deepEqual((table.meta?.columns as { name: string }[]).map((c) => c.name), ['id', 'customer_email', 'total_cents']);
  assert.equal(node(map, 'job:app/tasks.py').kind, 'job');
  node(map, 'external:stripe');
  node(map, 'queue:celery');
  node(map, 'store:postgres');
  node(map, 'cache:redis');
  edge(map, 'reads', router.id, 'table:orders');
  edge(map, 'emits', router.id, 'queue:celery');
  edge(map, 'listens', 'job:app/tasks.py', 'queue:celery');
  edge(map, 'calls', 'service:app/services/billing.py', 'external:stripe');
  edge(map, 'imports', router.id, 'service:app/services/billing.py');
  assert.ok(!map.nodes.some((n) => n.id.includes('test_orders')), 'tests are grouped, not nodes');
  assert.deepEqual(map.lanes.map((l) => l.id), ['orders']);
});

test('python / django: urls.py routes, models with db_table, objects.* reads and writes, requirements externals', async () => {
  const { map } = await crawlFixture('django-app');
  node(map, 'route:shop/urls.py#ANY /products');
  node(map, 'route:shop/urls.py#ANY /orders/[pk]');
  assert.equal(node(map, 'table:Product').parent, 'store:django');
  node(map, 'table:shop_orders');
  edge(map, 'reads', 'module:shop/views.py', 'table:Product');
  edge(map, 'writes', 'module:shop/views.py', 'table:shop_orders');
  node(map, 'external:sendgrid');
  assert.equal(node(map, 'job:shop/tasks.py').kind, 'job');
});
