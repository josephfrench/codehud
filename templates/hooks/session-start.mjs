#!/usr/bin/env node
/**
 * Claude Code SessionStart hook: when (and only when) the codehud server is up, register this session
 * and tell the model that the HUD is live, so it prefers hud_ask / hud_focus from the first turn.
 * When the server is down the hook prints nothing and costs ~1.5 s at most.
 *
 * settings.json (templates/hooks/install.mjs writes this):
 *   "SessionStart": [{ "hooks": [{ "type": "command", "command": "node <codehud>/templates/hooks/session-start.mjs", "timeout": 10 }] }]
 */
import path from 'node:path';
import { api, emit, health, readInfo, readPayload } from './_common.mjs';

async function main() {
  const payload = await readPayload();
  const info = readInfo();
  const h = await health(info);
  if (!h) return;

  const cwd = payload?.cwd ?? process.cwd();
  try {
    await api(info, 'POST', '/api/sessions', { id: payload?.session_id ?? `cc-${process.pid}`, label: path.basename(cwd), cwd, status: 'idle' });
  } catch { /* registration is best effort */ }

  const where = h.map ? `showing the "${h.map}" system map` : 'with no system map loaded yet (crawl the repo and call hud_load_map)';
  const tabs = h.browsers > 0 ? `${h.browsers} browser tab${h.browsers === 1 ? '' : 's'} connected` : 'no browser tab connected yet';
  emit({
    hookSpecificOutput: {
      hookEventName: 'SessionStart',
      additionalContext: `codehud is live at ${info.url} (${where}; ${tabs}). The human watches the HUD while you work: call hud_get_map once, hud_focus whenever you move to another part of the system, and hud_ask instead of plain-text questions about the system.`,
    },
  });
}
await main();
