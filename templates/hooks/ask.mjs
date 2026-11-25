#!/usr/bin/env node
/**
 * Claude Code PreToolUse hook on AskUserQuestion: route the model's plain multiple-choice questions
 * into the codehud HUD when a HUD tab is open, and hand the human's answer back to Claude Code.
 *
 * Contract (code.claude.com/docs/en/hooks, "Tools that require user interaction"): the hook reads the
 * tool input from stdin, collects the answer in its own UI, and returns
 *   { hookSpecificOutput: { hookEventName: "PreToolUse", permissionDecision: "allow",
 *       updatedInput: { questions: <original>, answers: { "<question text>": "<option label>" } } } }
 * "allow" alone is not enough; no output at all falls through to the normal terminal prompt, which is
 * exactly what we want when the server is down or no browser is connected.
 *
 * Trade-offs:
 * - The hook blocks the tool call while the human thinks, so its `timeout` must be generous (install.mjs
 *   sets 3600 s; the default 600 s would cancel the hook and fall back to the terminal prompt, silently).
 *   CODEHUD_ASK_HOOK_WAIT_S (default 3300) keeps our own wait inside that budget; when it runs out the
 *   HUD question is cancelled and the terminal prompt appears.
 * - `AskUserQuestion` input has no node/file context, so the HUD shows the question at the agent's last
 *   focus. hud_ask stays the rich path; this hook is the safety net for when the model forgets it.
 * - Multi-select questions are presented as single options plus free text; a free-text reply that lists
 *   several labels separated by commas is passed through as-is (Claude Code joins multi-select with commas).
 *
 * settings.json (templates/hooks/install.mjs writes this):
 *   "PreToolUse": [{ "matcher": "AskUserQuestion",
 *     "hooks": [{ "type": "command", "command": "node <codehud>/templates/hooks/ask.mjs", "timeout": 3600 }] }]
 */
import { api, emit, health, readInfo, readPayload } from './_common.mjs';

async function main() {
  const payload = await readPayload();
  const questions = payload?.tool_input?.questions;
  if (!Array.isArray(questions) || !questions.length) return;

  const info = readInfo();
  const h = await health(info);
  if (!h || !(h.browsers > 0)) return; // no HUD: let the terminal prompt happen

  const WAIT_S = Number(process.env.CODEHUD_ASK_HOOK_WAIT_S ?? 3300);
  const deadline = Date.now() + WAIT_S * 1000;
  const session = payload.session_id;
  const answers = {};

  try {
    for (const q of questions) {
      const options = (q.options ?? []).map((o, i) => ({ id: `o${i + 1}`, label: String(o.label ?? '').slice(0, 80), description: o.description ? String(o.description).slice(0, 300) : undefined }));
      const created = await api(info, 'POST', '/api/questions', {
        question: String(q.question ?? '').slice(0, 1000),
        context: [q.header ? `**${q.header}**` : '', q.multiSelect ? '_Pick one, or type several labels separated by commas._' : ''].filter(Boolean).join('  '),
        options,
        session,
        agent: 'claude-code',
        ttlSeconds: WAIT_S,
      });
      let cur = created;
      while (cur.status === 'pending' && Date.now() < deadline) {
        const wait = Math.min(25_000, Math.max(1000, deadline - Date.now()));
        cur = await api(info, 'GET', `/api/questions/${created.id}?wait=${wait}`, undefined, wait + 5000);
      }
      if (cur.status !== 'answered') {
        // Timed out / cancelled / expired in the HUD: cancel what is left and let the terminal prompt take over.
        try { await api(info, 'POST', `/api/questions/${created.id}/cancel`, {}); } catch { /* ignore */ }
        return;
      }
      const opt = options.find((o) => o.id === cur.answer?.optionId);
      const free = (cur.answer?.text ?? '').trim();
      // Prefer the option label (what Claude Code expects); append free text when both were given.
      answers[q.question] = opt ? (free && free !== opt.label ? `${opt.label} — ${free}` : opt.label) : free;
    }
  } catch {
    return; // any server hiccup: fall back to the terminal prompt rather than block the agent
  }

  emit({
    hookSpecificOutput: {
      hookEventName: 'PreToolUse',
      permissionDecision: 'allow',
      updatedInput: { ...payload.tool_input, questions, answers },
    },
  });
}
await main();
