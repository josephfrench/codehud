#!/usr/bin/env node
/**
 * Claude Code PostToolUse hook: passive agent presence for codehud.
 * Reads the hook payload on stdin, extracts the file path the agent just
 * touched, and posts a non-zooming focus to the local codehud server so the
 * HUD shows "the agent is here" without the model having to call hud_focus.
 *
 * settings.json:
 * {
 *   "hooks": {
 *     "PostToolUse": [{
 *       "matcher": "Edit|Write|MultiEdit|Read|NotebookEdit",
 *       "hooks": [{ "type": "command", "command": "node C:/path/to/codehud/templates/hooks/presence.mjs", "async": true, "timeout": 5 }]
 *     }]
 *   }
 * }
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

let raw = '';
for await (const chunk of process.stdin) raw += chunk;
let payload;
try { payload = JSON.parse(raw); } catch { process.exit(0); }

const file = payload?.tool_input?.file_path ?? payload?.tool_input?.notebook_path;
if (!file) process.exit(0);

let info;
try { info = JSON.parse(fs.readFileSync(path.join(os.homedir(), '.codehud', 'server.json'), 'utf8')); } catch { process.exit(0); }

const verb = /read/i.test(payload.tool_name ?? '') ? 'reading' : 'editing';
try {
  await fetch(`${info.url}/api/focus`, {
    method: 'POST',
    headers: { authorization: `Bearer ${info.token}`, 'content-type': 'application/json' },
    body: JSON.stringify({
      files: [file],
      source: 'hook',
      zoom: false,
      session: payload.session_id,
      note: `${verb} ${path.basename(file)}`,
    }),
    signal: AbortSignal.timeout(2000),
  });
} catch { /* server down; stay silent */ }
