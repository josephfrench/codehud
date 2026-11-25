/**
 * /demo — a self-contained tour that runs entirely in the browser: no server, no agent.
 *
 * It loads the sample system (examples/sample-webapp.system.json, the same SystemMap format the
 * crawler emits) and replays the scripted agent session from scripts/demo.ts by feeding the same
 * ServerEvents the real server would send. Answering the question continues the script.
 */
import { MapIndex, type SystemMap } from '../../../schema/src/index.ts';
import type { ActivityItem, Question, QuestionInput, QuestionOption, ServerEvent } from '../../../schema/src/protocol.ts';
import sample from '../../../../examples/sample-webapp.system.json';
import sampleUrl from '../../../../examples/sample-webapp.system.json?url';
import { applyDecision } from '../../../../examples/sample-webapp.decisions.ts';
import { hud } from './state.svelte.ts';

export const DEMO_MAP_URL = sampleUrl;

const SESSION = 'demo-agent';
let run = 0;

function uid() { return Math.random().toString(36).slice(2, 10); }
const now = () => new Date().toISOString();

export function startDemo() {
  const map = sample as unknown as SystemMap;
  let index = new MapIndex(map);
  const myRun = ++run;
  const alive = () => run === myRun;
  const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

  const resolve = (nodes?: string[], files?: (string | { path: string })[]) => {
    const out = new Set<string>();
    for (const id of nodes ?? []) if (index.get(id)) out.add(id);
    for (const f of files ?? []) { const hit = index.nodesForFile(typeof f === 'string' ? f : f.path)[0]; if (hit) out.add(hit.id); }
    return [...out];
  };
  const labels = (ids: string[]) => ids.map((id) => index.get(id)?.label ?? id);
  const emit = (ev: ServerEvent) => { if (alive()) hud.dispatch(ev); };
  const log = (kind: ActivityItem['kind'], text: string, nodes?: string[]) =>
    emit({ type: 'activity', item: { id: uid(), at: now(), kind, text, nodes, session: SESSION } });
  const session = (status: 'idle' | 'working' | 'waiting') =>
    emit({ type: 'session', session: { id: SESSION, label: 'demo agent', cwd: map.root, lastSeen: now(), status } });
  const note = (text: string) => log('note', text);
  const focus = (nodes: string[] | undefined, files: string[] | undefined, text: string) => {
    const resolvedNodes = resolve(nodes, files);
    emit({ type: 'focus', focus: { nodes, files, note: text, session: SESSION, source: 'agent', resolvedNodes } });
    log('focus', `${text} — ${labels(resolvedNodes).join(', ')}`, resolvedNodes);
  };
  const ask = (input: QuestionInput): Promise<Question> => {
    const options: QuestionOption[] | undefined = input.options?.map((o) => ({ ...o, resolvedNodes: resolve(o.nodes, o.files) }));
    const q: Question = { ...input, options, id: uid(), createdAt: now(), status: 'pending', session: SESSION, agent: 'demo', resolvedNodes: resolve(input.nodes, input.files) };
    session('waiting');
    emit({ type: 'question', question: q });
    log('question', q.question, q.resolvedNodes);
    return new Promise((done) => {
      hud.onLocalAnswer = (id, body) => {
        if (id !== q.id) return;
        const opt = q.options?.find((o) => o.id === body.optionId);
        const answered: Question = { ...q, status: 'answered', answer: { text: body.text ?? opt?.label ?? '', optionId: body.optionId, answeredAt: now() } };
        emit({ type: 'answer', question: answered });
        log('answer', opt ? `[${opt.label}]${body.text ? ' ' + body.text : ''}` : answered.answer!.text, q.resolvedNodes);
        hud.onLocalAnswer = null;
        done(answered);
      };
    });
  };

  (async () => {
    hud.demo = true;
    hud.reset();
    emit({ type: 'hello', map, questions: [], sessions: [], activity: [] });
    log('map', `Loaded map "${map.name}" (${map.nodes.length} nodes, ${map.edges.length} edges)`);
    await sleep(600); if (!alive()) return;
    session('working');
    note('Task: make Stripe webhook handling idempotent');
    await sleep(1400); if (!alive()) return;
    focus(undefined, ['src/pages/api/webhooks/stripe.ts'], 'reading the webhook route');
    await sleep(2600); if (!alive()) return;
    focus(['function:handle-webhook', 'function:sync-subscription'], undefined, 'tracing what the handler writes');
    await sleep(2600); if (!alive()) return;
    focus(['table:subscriptions', 'table:invoices'], undefined, 'these rows get upserted twice on retries');
    await sleep(2000); if (!alive()) return;

    const answered = await ask({
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
    if (!alive()) return;

    const chosen = answered.answer?.optionId ?? 'free text';
    session('working');
    note(`Going with: ${chosen}. Writing the migration + guard.`);
    await sleep(1500); if (!alive()) return;
    // the decision changes the system: push the updated map, then work on the new nodes
    const decision = applyDecision(map, answered.answer?.optionId);
    index = new MapIndex(decision.map);
    emit({ type: 'map', map: decision.map });
    log('map', decision.text);
    await sleep(900); if (!alive()) return;
    focus(decision.focus, undefined, 'implementing');
    await sleep(2200); if (!alive()) return;
    note('Done. Tests green.');
    session('idle');
    await sleep(800); if (!alive()) return;
    hud.toast({ text: 'End of the demo. Replay from the top bar, or load your own system at /.', kind: 'info' });
  })();
}
