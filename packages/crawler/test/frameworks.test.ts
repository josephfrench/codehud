import assert from 'node:assert/strict';
import { test } from 'node:test';
import { crawlFixture, edge, laneOf, noNode, node } from './helpers.ts';

test('angular: suffixes name kinds, Routes arrays name pages (lazy children prefixed), guards sit at the edge', async () => {
  const { map, adapters } = await crawlFixture('angular-app');
  assert.ok(adapters.includes('angular'));
  const orders = node(map, 'page:src/app/orders/orders.component.ts');
  assert.equal(orders.kind, 'page');
  assert.equal(orders.meta?.path, '/orders');
  assert.equal(node(map, 'page:src/app/orders/order-detail.component.ts').meta?.path, '/orders/[id]');
  assert.equal(node(map, 'page:src/app/auth/login.component.ts').meta?.path, '/login');
  assert.equal(node(map, 'component:src/app/app.component.ts').kind, 'component');
  assert.equal(node(map, 'service:src/app/orders/orders.service.ts').kind, 'service');
  assert.equal(node(map, 'middleware:src/app/auth/auth.guard.ts').layer, 'edge');
  assert.equal(node(map, 'store:src/app/orders/orders.store.ts').kind, 'store');
  assert.equal(node(map, 'component:src/app/shared/money.pipe.ts').kind, 'component');
  edge(map, 'imports', 'page:src/app/orders/orders.component.ts', 'service:src/app/orders/orders.service.ts');
  // tsconfig paths alias (@app/*) resolved through the TypeScript compiler API
  edge(map, 'renders', 'page:src/app/orders/order-detail.component.ts', 'component:src/app/shared/money.pipe.ts');
  assert.equal(laneOf(map, 'page:src/app/orders/orders.component.ts'), 'orders');
  // spec files are tests, not components
  noNode(map, 'component:src/app/orders/orders.component.spec.ts');
});

test('nuxt: pages dir, server/api with method suffixes, middleware, composables, pinia stores, $fetch edges', async () => {
  const { map } = await crawlFixture('nuxt-app');
  assert.equal(node(map, 'page:pages/orders/[id].vue').meta?.path, '/orders/[id]');
  const get = node(map, 'route:server/api/orders/index.get.ts');
  assert.equal(get.meta?.method, 'GET');
  assert.equal(get.meta?.path, '/api/orders');
  assert.equal(node(map, 'route:server/api/orders/[id].post.ts').meta?.method, 'POST');
  assert.equal(node(map, 'middleware:middleware/auth.global.ts').layer, 'edge');
  assert.equal(node(map, 'middleware:server/middleware/auth.ts').layer, 'edge');
  assert.equal(node(map, 'store:stores/cart.ts').kind, 'store');
  assert.equal(node(map, 'module:composables/useOrders.ts').layer, 'client');
  edge(map, 'calls', 'module:composables/useOrders.ts', 'route:server/api/orders/index.get.ts');
  edge(map, 'calls', 'page:pages/orders/[id].vue', 'route:server/api/orders/[id].post.ts');
  edge(map, 'calls', 'route:server/api/orders/[id].post.ts', 'external:stripe');
  edge(map, 'navigates', 'page:pages/index.vue', 'page:pages/orders/[id].vue');
  assert.equal(laneOf(map, 'route:server/api/orders/index.get.ts'), 'orders');
});

test('react-router SPA: createBrowserRouter maps components to pages, layouts stay components, vercel api/ + crons', async () => {
  const { map, adapters } = await crawlFixture('react-spa');
  assert.ok(adapters.includes('react-router') && adapters.includes('vercel'));
  assert.equal(node(map, 'page:src/pages/Home.tsx').meta?.path, '/');
  assert.equal(node(map, 'page:src/pages/Orders.tsx').meta?.path, '/orders');
  assert.equal(node(map, 'page:src/pages/OrderDetail.tsx').meta?.path, '/orders/[id]');
  // the element with children is a layout, not a page
  noNode(map, 'page:src/components/Layout.tsx');
  assert.equal(node(map, 'component:src/components/Layout.tsx').kind, 'component');
  assert.equal(node(map, 'route:api/orders.ts').meta?.path, '/api/orders');
  edge(map, 'calls', 'page:src/pages/Orders.tsx', 'route:api/orders.ts');
  edge(map, 'calls', 'job:vercel-cron:/api/digest', 'route:api/digest.ts');
  node(map, 'external:proxy:legacy.example.com');
  edge(map, 'renders', 'page:src/pages/Orders.tsx', 'component:src/components/Button.tsx');
});

test('tanstack router: file routes, $params, pathless _segments, __root is the shell', async () => {
  const { map } = await crawlFixture('tanstack-app');
  assert.equal(node(map, 'page:src/routes/index.tsx').meta?.path, '/');
  assert.equal(node(map, 'page:src/routes/posts.$postId.tsx').meta?.path, '/posts/[postId]');
  assert.equal(node(map, 'page:src/routes/_auth/settings.tsx').meta?.path, '/settings');
  assert.equal(node(map, 'component:src/routes/__root.tsx').kind, 'component');
});

test('nest: controller decorators become routes, providers services, guards edge, bull + events + cron', async () => {
  const { map, adapters } = await crawlFixture('nest-api');
  assert.ok(adapters.includes('nest') && adapters.includes('typeorm'));
  const ctl = node(map, 'module:src/orders/orders.controller.ts');
  assert.equal(ctl.layer, 'api');
  assert.equal(node(map, 'route:src/orders/orders.controller.ts#GET /orders/[id]').parent, ctl.id);
  node(map, 'route:src/orders/orders.controller.ts#POST /orders');
  assert.equal(node(map, 'service:src/orders/orders.service.ts').layer, 'domain');
  assert.equal(node(map, 'middleware:src/auth/jwt.guard.ts').layer, 'edge');
  assert.equal(node(map, 'job:src/billing/billing.processor.ts').kind, 'job');
  assert.deepEqual(node(map, 'job:src/billing/nightly.job.ts').meta?.schedule, ['EVERY_DAY_AT_MIDNIGHT']);
  edge(map, 'emits', 'service:src/orders/orders.service.ts', 'queue:bull:billing');
  edge(map, 'listens', 'job:src/billing/billing.processor.ts', 'queue:bull:billing');
  edge(map, 'emits', 'service:src/orders/orders.service.ts', 'event:order.created');
  edge(map, 'listens', 'service:src/billing/billing.listener.ts', 'event:order.created');
  edge(map, 'calls', 'job:src/billing/billing.processor.ts', 'external:sendgrid');
  // typeorm entity -> table under the data source, with reads / writes from the repository usage
  const table = node(map, 'table:orders');
  assert.equal(table.parent, 'store:typeorm:postgres');
  assert.deepEqual((table.meta?.columns as { name: string }[]).map((c) => c.name), ['id', 'customerId', 'totalCents', 'createdAt']);
  edge(map, 'reads', 'service:src/orders/orders.service.ts', 'table:orders');
  edge(map, 'writes', 'service:src/orders/orders.service.ts', 'table:orders');
  assert.deepEqual(map.lanes.map((l) => l.id).sort(), ['billing', 'orders']);
});
