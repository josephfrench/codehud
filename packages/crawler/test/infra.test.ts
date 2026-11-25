import assert from 'node:assert/strict';
import { test } from 'node:test';
import { crawlFixture, edge, node, noEdge, noNode } from './helpers.ts';

test('serverless.yml: functions, http events as routes, sqs/schedule events, resources, env refs resolve to tables', async () => {
  const { map, adapters } = await crawlFixture('serverless-aws');
  assert.ok(adapters.includes('serverless') && adapters.includes('dynamodb'));
  const table = node(map, 'infra:cfn:OrdersTable');
  assert.equal(table.kind, 'table');
  assert.equal(table.parent, 'store:dynamodb');
  assert.equal(node(map, 'infra:cfn:OrdersQueue').kind, 'queue');
  const create = node(map, 'infra:cfn:createOrder');
  assert.equal(create.kind, 'function');
  // the handler file was absorbed: summary comes from its doc comment, imports attribute to the function
  assert.match(create.summary ?? '', /Creates an order/);
  assert.ok(create.files?.some((f) => f.path === 'src/handlers/orders.ts'));
  noNode(map, 'module:src/handlers/orders.ts');
  edge(map, 'calls', 'route:serverless.yml#POST /orders', 'infra:cfn:createOrder');
  edge(map, 'calls', 'route:serverless.yml#GET /orders/[id]', 'infra:cfn:getOrder');
  edge(map, 'listens', 'infra:cfn:processOrder', 'infra:cfn:OrdersQueue');
  edge(map, 'emits', 'infra:cfn:createOrder', 'infra:cfn:OrdersQueue');
  // code-level DynamoDB commands refine the env dependency into reads / writes
  edge(map, 'writes', 'infra:cfn:createOrder', 'infra:cfn:OrdersTable');
  edge(map, 'writes', 'infra:cfn:processOrder', 'infra:cfn:OrdersTable');
  assert.equal(node(map, 'infra:cfn:nightly').meta?.schedule, 'rate(1 day)');
  // env vars that infrastructure explains must not become env-derived externals
  noNode(map, 'external:env:orders-queue');
  assert.deepEqual(map.lanes.map((l) => l.id), ['orders']);
});

test('SAM template: Serverless::Function events, SimpleTable, policy templates, HttpApi parent', async () => {
  const { map } = await crawlFixture('sam-app');
  assert.equal(node(map, 'infra:cfn:ItemsTable').parent, 'store:dynamodb');
  assert.equal(node(map, 'infra:cfn:ItemsBucket').kind, 'store');
  assert.equal(node(map, 'route:template.yaml#GET /items/[id]').parent, 'infra:cfn:Api');
  edge(map, 'calls', 'route:template.yaml#POST /items', 'infra:cfn:PutItemFunction');
  edge(map, 'reads', 'infra:cfn:GetItemFunction', 'infra:cfn:ItemsTable');
  edge(map, 'writes', 'infra:cfn:PutItemFunction', 'infra:cfn:ItemsTable');
  noEdge(map, 'writes', 'infra:cfn:GetItemFunction', 'infra:cfn:ItemsTable');
  // Globals.CodeUri + Handler resolve to the source file
  assert.match(node(map, 'infra:cfn:GetItemFunction').summary ?? '', /Reads one item/);
});

test('CDK: constructs become nodes; grants, event sources, HTTP routes and env map to edges; entry files absorbed', async () => {
  const { map, adapters } = await crawlFixture('cdk-app');
  assert.ok(adapters.includes('cdk'));
  const table = node(map, 'infra:cdk:OrdersStack/OrdersTable');
  assert.equal(table.kind, 'table');
  assert.deepEqual((table.meta?.columns as { name: string }[]).map((c) => c.name), ['pk', 'sk']);
  assert.equal(node(map, 'infra:cdk:OrdersStack/OrdersQueue').kind, 'queue');
  assert.equal(node(map, 'infra:cdk:OrdersStack/Uploads').kind, 'store');
  const create = node(map, 'infra:cdk:OrdersStack/CreateOrder');
  assert.match(create.summary ?? '', /Writes an order/);
  noNode(map, 'module:lambda/create.ts');
  edge(map, 'reads', create.id, 'infra:cdk:OrdersStack/OrdersTable');
  edge(map, 'writes', create.id, 'infra:cdk:OrdersStack/OrdersTable');
  edge(map, 'emits', create.id, 'infra:cdk:OrdersStack/OrdersQueue');
  edge(map, 'listens', 'infra:cdk:OrdersStack/ProcessOrder', 'infra:cdk:OrdersStack/OrdersQueue');
  edge(map, 'reads', 'infra:cdk:OrdersStack/ProcessOrder', 'infra:cdk:OrdersStack/Uploads');
  const route = node(map, 'infra:cdk:OrdersStack/OrdersApi#POST /orders');
  assert.equal(route.parent, 'infra:cdk:OrdersStack/OrdersApi');
  edge(map, 'calls', route.id, create.id);
});

test('terraform: resources by type, env variables, event source mappings, API integrations, handler files by basename', async () => {
  const { map, adapters } = await crawlFixture('terraform-infra');
  assert.ok(adapters.includes('terraform'));
  const table = node(map, 'infra:tf:aws_dynamodb_table.orders');
  assert.equal(table.kind, 'table');
  assert.equal(table.meta?.hashKey, 'pk');
  assert.equal(node(map, 'infra:tf:aws_sqs_queue.orders').kind, 'queue');
  assert.equal(node(map, 'infra:tf:aws_s3_bucket.uploads').kind, 'store');
  assert.equal(node(map, 'infra:tf:aws_cloudfront_distribution.cdn').layer, 'edge');
  noNode(map, 'infra:tf:aws_iam_role.lambda');
  const create = node(map, 'infra:tf:aws_lambda_function.create_order');
  assert.match(create.summary ?? '', /Creates an order/);
  edge(map, 'writes', create.id, table.id);
  edge(map, 'emits', create.id, 'infra:tf:aws_sqs_queue.orders');
  edge(map, 'listens', 'infra:tf:aws_lambda_function.process_order', 'infra:tf:aws_sqs_queue.orders');
  edge(map, 'calls', 'infra:tf:aws_apigatewayv2_api.http', create.id);
  const route = node(map, 'infra:tf:aws_apigatewayv2_route.create');
  assert.equal(route.parent, 'infra:tf:aws_apigatewayv2_api.http');
  // child -> parent references are not edges
  noEdge(map, 'depends', route.id, 'infra:tf:aws_apigatewayv2_api.http');
});

test('docker-compose: services by image class, depends_on edges, the built service is the app', async () => {
  const { map, adapters } = await crawlFixture('compose-app');
  assert.ok(adapters.includes('compose'));
  assert.equal(node(map, 'infra:compose:mongo').kind, 'store');
  assert.equal(node(map, 'infra:compose:redis').kind, 'cache');
  assert.equal(node(map, 'infra:compose:rabbit').kind, 'queue');
  assert.equal(node(map, 'infra:compose:proxy').layer, 'edge');
  assert.equal(node(map, 'infra:compose:web').kind, 'app');
  edge(map, 'writes', 'infra:compose:web', 'infra:compose:mongo');
  edge(map, 'emits', 'infra:compose:web', 'infra:compose:rabbit');
  edge(map, 'calls', 'infra:compose:proxy', 'infra:compose:web');
});
