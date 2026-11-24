/**
 * Simulates a coding agent driving the HUD, without an MCP client:
 *   1. registers a session, 2. walks through the checkout flow with focus notes,
 *   3. asks a question about the Stripe webhook and waits for the answer,
 *   4. reacts to the answer.
 *
 * Run `pnpm start` first, open http://127.0.0.1:4777, then `pnpm demo`.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { ServerInfo, Question } from '../packages/schema/src/protocol.ts';

const info: ServerInfo = JSON.parse(fs.readFileSync(path.join(os.homedir(), '.codehud', 'server.json'), 'utf8'));
const base = `http://${info.host}:${info.port}`;
const session = 'demo-' + Math.random().toString(36).slice(2, 6);

async function api<T = any>(method: string, route: string, body?: unknown): Promise<T> {
  const r = await fetch(base + route, {
    method,
    headers: { authorization: `Bearer ${info.token}`, ...(body ? { 'content-type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!r.ok) throw new Error(`${r.status} ${route}: ${await r.text()}`);
  return r.json();
}
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

await api('POST', '/api/sessions', { id: session, label: 'demo agent', cwd: 'C:/example/acme-portal', status: 'working' });
console.log('session', session);

await api('POST', '/api/notes', { text: 'Task: make Stripe webhook handling idempotent', session });
await sleep(1200);
await api('POST', '/api/focus', { files: ['src/pages/api/webhooks/stripe.ts'], note: 'reading the webhook route', session });
await sleep(2500);
await api('POST', '/api/focus', { nodes: ['function:handle-webhook', 'function:sync-subscription'], note: 'tracing what the handler writes', session });
await sleep(2500);
await api('POST', '/api/focus', { nodes: ['table:subscriptions', 'table:invoices'], note: 'these rows get upserted twice on retries', session });
await sleep(2000);

const q: Question = await api('POST', '/api/questions', {
  session,
  agent: 'demo',
  question: 'Where should I record processed Stripe event ids so retried webhooks become no-ops?',
  context: 'Stripe retries webhooks on any non-2xx, and `syncSubscription()` currently upserts **subscriptions** and **invoices** without checking whether the event was already handled. I need a durable record of processed `event.id`s.',
  moreContext: [
    '### What I found',
    '- `handleWebhook()` verifies the signature, then dispatches by `event.type` straight into `syncSubscription()`.',
    '- There is no table keyed by Stripe event id. `invoices.stripe_invoice_id` is unique, but `subscriptions` is upserted by customer id, so a replayed `customer.subscription.updated` after a newer one would **roll the row back**.',
    '- Stripe recommends storing event ids and skipping duplicates: https://docs.stripe.com/webhooks#handle-duplicate-events',
    '',
    '### Options considered',
    '1. **New `stripe_events` table in D1** (`id TEXT PRIMARY KEY, type, received_at`). Insert-or-ignore first; if the insert affected 0 rows, return 200 without processing. Transactional with the upserts. Adds a migration.',
    '2. **KV with TTL** on the existing rate-limit namespace. No migration, but KV is eventually consistent, so two near-simultaneous deliveries could both pass the check.',
    '3. **Compare `event.created` to a `last_event_at` column on `subscriptions`**. Fixes the rollback case but not duplicate invoices, and it is per-row logic that every handler has to remember.',
    '',
    '### Diff sketch for option 1',
    '```ts',
    'export const stripeEvents = sqliteTable("stripe_events", {',
    '  id: text("id").primaryKey(),',
    '  type: text("type").notNull(),',
    '  receivedAt: integer("received_at", { mode: "timestamp" }).notNull(),',
    '});',
    '```',
  ].join('\n'),
  nodes: ['function:handle-webhook', 'table:subscriptions', 'table:invoices', 'store:kv'],
  files: [{ path: 'src/lib/server/billing/webhook.ts' }],
  options: [
    { id: 'd1', label: 'New stripe_events table in D1', description: 'Strongly consistent, transactional with the upserts. Adds a migration.', nodes: ['store:d1', 'function:handle-webhook'], files: ['drizzle/schema.ts'] },
    { id: 'kv', label: 'KV key per event id', description: 'No migration, but eventually consistent.', nodes: ['store:kv', 'function:handle-webhook'] },
    { id: 'ts', label: 'Timestamp check on subscriptions', description: 'Smallest change; does not cover invoices.', nodes: ['table:subscriptions', 'function:sync-subscription'] },
  ],
});
console.log('asked', q.id, '- answer it in the HUD');

let cur = q;
while (cur.status === 'pending') {
  cur = await api('GET', `/api/questions/${q.id}?wait=25000`);
}
console.log('answer:', cur.status, cur.answer);

if (cur.status === 'answered') {
  const chosen = cur.answer?.optionId ?? 'free text';
  await api('POST', '/api/notes', { text: `Going with: ${chosen}. Writing the migration + guard.`, session });
  await sleep(1500);
  const target = chosen === 'kv' ? ['store:kv', 'function:handle-webhook'] : chosen === 'ts' ? ['table:subscriptions', 'function:sync-subscription'] : ['store:d1', 'function:handle-webhook'];
  await api('POST', '/api/focus', { nodes: target, note: 'implementing', session });
  await sleep(2000);
  await api('POST', '/api/notes', { text: 'Done. Tests green.', session });
}
await api('POST', '/api/sessions', { id: session, status: 'idle' });
