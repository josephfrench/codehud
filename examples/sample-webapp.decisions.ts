/**
 * What the demo agent changes in the sample system after each answer. Both demos (scripts/demo.ts
 * against a server, /demo in the browser) push this updated map once the question is answered, so
 * the picture reflects the decision instead of the system as it was before it.
 */
import type { SystemMap } from '../packages/schema/src/index.ts';

export interface Decision { map: SystemMap; text: string; focus: string[] }

export function applyDecision(map: SystemMap, optionId: string | undefined): Decision {
  const next: SystemMap = structuredClone(map);
  if (optionId === 'kv') {
    next.edges.push(
      { from: 'function:handle-webhook', to: 'store:kv', kind: 'reads', label: 'seen event id?' },
      { from: 'function:handle-webhook', to: 'store:kv', kind: 'writes', label: 'event id, 24h TTL' },
    );
    return { map: next, text: 'Map updated: handleWebhook() now checks and records event ids in Rate-limit KV', focus: ['store:kv', 'function:handle-webhook'] };
  }
  if (optionId === 'ts') {
    const t = next.nodes.find((n) => n.id === 'table:subscriptions');
    const cols = t?.meta?.columns;
    if (Array.isArray(cols)) cols.push({ name: 'last_event_at', type: 'integer ts' });
    next.edges.push({ from: 'function:sync-subscription', to: 'table:subscriptions', kind: 'reads', label: 'last_event_at' });
    return { map: next, text: 'Map updated: subscriptions gains last_event_at; syncSubscription() reads it before writing', focus: ['table:subscriptions', 'function:sync-subscription'] };
  }
  // default: the D1 table
  next.nodes.push({
    id: 'table:stripe-events', label: 'stripe_events', kind: 'table', layer: 'persistence', lane: 'billing', parent: 'store:d1',
    summary: 'Processed Stripe event ids (insert-or-ignore guard)',
    files: [{ path: 'drizzle/schema.ts', lines: [110, 116] }],
    meta: { columns: [{ name: 'id', type: 'text pk' }, { name: 'type', type: 'text' }, { name: 'received_at', type: 'integer ts' }] },
  });
  const d1 = next.nodes.find((n) => n.id === 'store:d1');
  if (d1) d1.summary = 'SQLite via Drizzle — 9 tables';
  next.edges.push({ from: 'function:handle-webhook', to: 'table:stripe-events', kind: 'writes', label: 'insert or ignore' });
  return { map: next, text: 'Map updated: new table stripe_events under Primary DB (D1); handleWebhook() writes it before anything else', focus: ['table:stripe-events', 'function:handle-webhook'] };
}
