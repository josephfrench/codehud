#!/usr/bin/env node
/**
 * Install (or remove) the codehud hooks pack for Claude Code, idempotently.
 *
 *   node templates/hooks/install.mjs [projectDir] [--global] [--no-claude-md] [--uninstall] [--dry-run] [--json]
 *
 *   projectDir      repo to install into (default: cwd). Writes <projectDir>/.claude/settings.json
 *   --global        write ~/.claude/settings.json instead (hooks only; CLAUDE.md is per project)
 *   --no-claude-md  do not touch CLAUDE.md
 *   --uninstall     remove the codehud hooks (and the CLAUDE.md section) instead
 *   --dry-run       print what would change, write nothing
 *   --json          machine-readable summary on stdout (for the codehud CLI)
 *
 * What it merges into settings.json "hooks":
 *   PostToolUse  Edit|Write|MultiEdit|Read|NotebookEdit  -> presence.mjs       (async, 5 s)   agent presence dot
 *   PreToolUse   AskUserQuestion                          -> ask.mjs            (3600 s)       questions land in the HUD
 *   SessionStart                                          -> session-start.mjs  (10 s)         "codehud is live" context
 * Existing hooks are kept; a codehud entry is recognised by its command path and replaced in place.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const hookPath = (f) => path.resolve(here, f).replace(/\\/g, '/');
const SNIPPET = path.resolve(here, '..', 'CLAUDE.md.snippet');
const MARKER = '## codehud (system HUD)';

const args = process.argv.slice(2);
const flag = (f) => args.includes(f);
const projectDir = path.resolve(args.find((a) => !a.startsWith('--')) ?? process.cwd());
const global = flag('--global');
const dryRun = flag('--dry-run');
const uninstall = flag('--uninstall');
const asJson = flag('--json');
const touchClaudeMd = !flag('--no-claude-md') && !global;

const settingsFile = global ? path.join(os.homedir(), '.claude', 'settings.json') : path.join(projectDir, '.claude', 'settings.json');
const claudeMd = path.join(projectDir, 'CLAUDE.md');

const ENTRIES = [
  { event: 'PostToolUse', matcher: 'Edit|Write|MultiEdit|Read|NotebookEdit', hook: { type: 'command', command: `node ${hookPath('presence.mjs')}`, async: true, timeout: 5 } },
  { event: 'PreToolUse', matcher: 'AskUserQuestion', hook: { type: 'command', command: `node ${hookPath('ask.mjs')}`, timeout: 3600 } },
  { event: 'SessionStart', matcher: undefined, hook: { type: 'command', command: `node ${hookPath('session-start.mjs')}`, timeout: 10 } },
];
const isOurs = (h) => typeof h?.command === 'string' && /templates\/hooks\/(presence|ask|session-start)\.mjs/.test(h.command.replace(/\\/g, '/'));

const changes = [];
let settings = {};
try { settings = JSON.parse(fs.readFileSync(settingsFile, 'utf8')); } catch (e) { if (fs.existsSync(settingsFile)) throw new Error(`${settingsFile} is not valid JSON: ${e.message}`); }
settings.hooks ??= {};

for (const { event, matcher, hook } of ENTRIES) {
  const groups = (settings.hooks[event] ??= []);
  const label = `${event}${matcher ? ` (${matcher})` : ''}: ${path.basename(hook.command.split(' ').pop())}`;
  const group = matcher === undefined ? { hooks: [hook] } : { matcher, hooks: [hook] };
  const same = groups.some((g) => JSON.stringify(g) === JSON.stringify(group));
  if (same && !uninstall) { changes.push(`${label} (already installed)`); continue; }
  // drop every codehud hook for this event first, then (unless uninstalling) add the current one
  let removed = 0;
  for (const g of groups) {
    const before = g.hooks?.length ?? 0;
    g.hooks = (g.hooks ?? []).filter((h) => !isOurs(h));
    removed += before - g.hooks.length;
  }
  settings.hooks[event] = groups.filter((g) => g.hooks.length);
  if (uninstall) { if (removed) changes.push(`${event}: removed ${removed} codehud hook(s)`); }
  else { settings.hooks[event].push(group); changes.push(removed ? `${label} (updated)` : label); }
  if (!settings.hooks[event].length) delete settings.hooks[event];
}
if (!Object.keys(settings.hooks).length) delete settings.hooks;

let mdChange = null;
if (touchClaudeMd) {
  const cur = fs.existsSync(claudeMd) ? fs.readFileSync(claudeMd, 'utf8') : '';
  if (uninstall) {
    const i = cur.indexOf(MARKER);
    if (i >= 0) {
      const rest = cur.slice(i + MARKER.length);
      const next = rest.search(/\n## /);
      mdChange = { file: claudeMd, text: (cur.slice(0, i) + (next >= 0 ? rest.slice(next + 1) : '')).replace(/\n{3,}$/, '\n') };
      changes.push('CLAUDE.md: removed the codehud section');
    }
  } else if (!cur.includes(MARKER)) {
    const snippet = fs.readFileSync(SNIPPET, 'utf8').trimEnd() + '\n';
    mdChange = { file: claudeMd, text: (cur ? cur.trimEnd() + '\n\n' : '') + snippet };
    changes.push(`CLAUDE.md: appended the codehud section${cur ? '' : ' (new file)'}`);
  }
}

if (!dryRun) {
  fs.mkdirSync(path.dirname(settingsFile), { recursive: true });
  fs.writeFileSync(settingsFile, JSON.stringify(settings, null, 2) + '\n');
  if (mdChange) fs.writeFileSync(mdChange.file, mdChange.text);
}

const summary = { settingsFile, claudeMd: touchClaudeMd ? claudeMd : null, dryRun, uninstall, changes };
if (asJson) console.log(JSON.stringify(summary, null, 2));
else {
  console.log(`${dryRun ? 'would write' : 'wrote'} ${settingsFile}`);
  for (const c of changes) console.log(`  - ${c}`);
  if (!changes.length) console.log('  (nothing to change)');
  if (!uninstall) console.log('\nnext: register the MCP bridge once per machine:\n  claude mcp add --scope user codehud -- node ' + hookPath('../../packages/mcp/src/index.ts'));
}
