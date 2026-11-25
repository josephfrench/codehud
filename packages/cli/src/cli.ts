#!/usr/bin/env node
/**
 * `codehud` — one command for the whole thing.
 *
 *   codehud up [--map file] [--port n] [--open] [--detach]   start the local server and print the sign-in link
 *   codehud demo [--port n]                                   start the server and print the /demo URL
 *   codehud mcp                                               run the MCP stdio bridge (what Claude Code launches)
 *   codehud crawl <dir> [--out file] [--watch] [--load] ...   turn a repo into a system map
 *   codehud install claude [--project dir|--global] [--no-crawl] [--no-hooks]
 *   codehud uninstall claude [--project dir|--global]
 *   codehud status · codehud link · codehud --help
 *
 * Runs from the repo (node packages/cli/src/cli.ts) and from the published bundle (dist/cli.js):
 * sibling entry points are resolved either way.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import type { ServerInfo } from '../../schema/src/protocol.ts';
import type { CrawlOptions } from '../../crawler/src/index.ts';

const here = path.dirname(fileURLToPath(import.meta.url));
const bundled = fs.existsSync(path.join(here, 'server.js'));
const ENTRY = {
  server: bundled ? path.join(here, 'server.js') : path.resolve(here, '../../server/src/index.ts'),
  mcp: bundled ? path.join(here, 'mcp.js') : path.resolve(here, '../../mcp/src/index.ts'),
  crawler: bundled ? path.join(here, 'crawler.js') : path.resolve(here, '../../crawler/src/index.ts'),
  templates: bundled ? path.resolve(here, '../templates') : path.resolve(here, '../../../templates'),
};
const INFO_FILE = path.join(os.homedir(), '.codehud', 'server.json');
const MAP_REL = '.codehud/system.json';
/** The hooks pack is copied into <hooksDir>/codehud/ so the project has no dependency on where codehud is installed. */
const HOOKS_SUBDIR = 'codehud';
const SNIPPET_MARK = '## codehud (system HUD)';

// ---------------------------------------------------------------------------
// args
// ---------------------------------------------------------------------------
type Flags = Record<string, string | boolean>;
function parse(argv: string[]): { pos: string[]; flags: Flags } {
  const pos: string[] = [];
  const flags: Flags = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (a === '--') { pos.push(...argv.slice(i + 1)); break; }
    if (!a.startsWith('--')) { pos.push(a); continue; }
    const eq = a.indexOf('=');
    if (eq > 0) { flags[a.slice(2, eq)] = a.slice(eq + 1); continue; }
    const key = a.slice(2);
    const next = argv[i + 1];
    if (next !== undefined && !next.startsWith('--')) { flags[key] = next; i++; } else flags[key] = true;
  }
  return { pos, flags };
}
const str = (v: string | boolean | undefined) => (typeof v === 'string' ? v : undefined);
const fail = (msg: string): never => { console.error(`codehud: ${msg}`); process.exit(1); };
const posix = (p: string) => p.replace(/\\/g, '/');

const HELP = `codehud — a HUD for the system your coding agent is changing

  codehud up [--map <system.json>] [--port 4777] [--open] [--detach]
      Start the local server (127.0.0.1 only) and print the one-time sign-in link.
  codehud demo [--port 4777]
      Start the server and print the URL of the in-browser demo.
  codehud mcp
      Run the MCP stdio bridge. This is the command Claude Code launches.
  codehud crawl <repo> [--out <file>] [--watch] [--load] [--name x] [--max-children 12] [--max-lanes 8] [--no-tests] [--no-low-confidence] [--quiet]
      Crawl a JS/TS web-app repo into a SystemMap. --watch re-crawls on change; --load pushes it to a running server.
  codehud install claude [--project <dir> | --global] [--no-crawl] [--no-hooks]
      Register the MCP server, add the presence hook, append the CLAUDE.md snippet, crawl into ${MAP_REL}.
  codehud uninstall claude [--project <dir> | --global]
      Reverse the above (the map file is kept).
  codehud status        Is the server up, what is loaded, how many browsers are connected.
  codehud link          Print the current sign-in link.
`;

// ---------------------------------------------------------------------------
// server helpers
// ---------------------------------------------------------------------------
function readInfo(): ServerInfo | null {
  try { return JSON.parse(fs.readFileSync(INFO_FILE, 'utf8')); } catch { return null; }
}
async function health(i: ServerInfo): Promise<{ ok: boolean; map: string | null; pid: number; browsers: number } | null> {
  try {
    const r = await fetch(`${i.url}/api/health`, { signal: AbortSignal.timeout(1500) });
    return r.ok ? await r.json() : null;
  } catch { return null; }
}
async function liveInfo(): Promise<ServerInfo | null> {
  const i = readInfo();
  return i && (await health(i)) ? i : null;
}
function serverArgs(flags: Flags): string[] {
  const out: string[] = [];
  const map = str(flags.map);
  if (map) out.push('--map', path.resolve(map));
  const port = str(flags.port);
  if (port) out.push('--port', port);
  if (flags.open === true) out.push('--open');
  return out;
}
/** Spawn the server; resolve once it is healthy. Foreground keeps its stdio; detached frees the terminal. */
async function startServer(flags: Flags, detach: boolean): Promise<ServerInfo> {
  const child = spawn(process.execPath, [ENTRY.server, ...serverArgs(flags)], detach
    ? { detached: true, stdio: 'ignore', windowsHide: true }
    : { stdio: 'inherit' });
  if (detach) child.unref();
  else child.on('exit', (code) => process.exit(code ?? 0));
  for (let n = 0; n < 60; n++) {
    await new Promise((r) => setTimeout(r, 250));
    const cur = readInfo();
    if (cur && cur.pid === child.pid && (await health(cur))) return cur;
    if (child.exitCode !== null) fail('server exited during start-up');
  }
  return fail('server did not become healthy within 15 s');
}
const signInLink = (i: ServerInfo) => `${i.url}/#t=${i.token}`;

// ---------------------------------------------------------------------------
// commands
// ---------------------------------------------------------------------------
async function cmdUp(flags: Flags) {
  const running = await liveInfo();
  if (running && !str(flags.port)) {
    console.log(`codehud is already running (pid ${running.pid}); open ${signInLink(running)}`);
    return;
  }
  const info = await startServer(flags, flags.detach === true);
  if (flags.detach === true) console.log(`codehud ▸ open ${signInLink(info)}`);
  // foreground: the server prints its own banner and keeps running until Ctrl-C
  if (flags.detach !== true) await new Promise(() => { /* wait for the child to exit */ });
}

async function cmdDemo(flags: Flags) {
  const info = (await liveInfo()) ?? (await startServer({ port: flags.port ?? false }, false));
  console.log(`codehud ▸ demo at ${info.url}/demo   (sign-in for the live HUD: ${signInLink(info)})`);
  await new Promise(() => { /* keep the foreground server alive */ });
}

async function cmdMcp() {
  await import(pathToFileURL(ENTRY.mcp).href);
}

async function cmdLink() {
  const i = readInfo();
  if (!i) return fail(`no server has been started yet (no ${INFO_FILE}); run \`codehud up\``);
  if (!(await health(i))) return fail(`the last server (pid ${i.pid}) is not responding; run \`codehud up\``);
  console.log(signInLink(i));
}

async function cmdStatus() {
  const i = readInfo();
  if (!i) { console.log('server: never started (no ~/.codehud/server.json)'); return; }
  const h = await health(i);
  if (!h) { console.log(`server: down (last pid ${i.pid}, ${i.url}, started ${i.startedAt})`); process.exitCode = 1; return; }
  console.log(`server:   up at ${i.url} (pid ${h.pid}, started ${i.startedAt})`);
  console.log(`map:      ${h.map ?? 'none loaded'}`);
  console.log(`browsers: ${h.browsers} connected`);
  console.log(`link:     ${signInLink(i)}`);
}

// ----- crawl -------------------------------------------------------------------
async function loadCrawler() {
  return (await import(pathToFileURL(ENTRY.crawler).href)) as typeof import('../../crawler/src/index.ts');
}
function crawlOptions(flags: Flags): CrawlOptions {
  const o: CrawlOptions = {};
  if (str(flags.name)) o.name = str(flags.name);
  if (str(flags['max-children'])) o.maxChildren = Number(flags['max-children']);
  if (str(flags['max-lanes'])) o.maxLanes = Number(flags['max-lanes']);
  if (flags['no-tests'] === true) o.includeTests = false;
  if (flags['no-low-confidence'] === true) o.lowConfidenceEdges = false;
  return o;
}
async function crawlOnce(root: string, out: string | undefined, flags: Flags, { crawl }: Awaited<ReturnType<typeof loadCrawler>>) {
  const map = await crawl(root, crawlOptions(flags));
  const json = JSON.stringify(map, null, 2) + '\n';
  if (flags.quiet !== true) {
    const top = map.nodes.filter((n) => !n.parent).length;
    console.error(`${map.name}: ${map.nodes.length} nodes (${top} top-level), ${map.edges.length} edges, ${map.lanes.length} lanes${map.lanes.length ? ` (${map.lanes.map((l) => l.id).join(', ')})` : ''}`);
  }
  if (out) {
    fs.mkdirSync(path.dirname(out), { recursive: true });
    fs.writeFileSync(out, json);
    if (flags.quiet !== true) console.error(`wrote ${out}`);
  } else process.stdout.write(json);
  return map;
}
async function pushToServer(out: string, quiet: boolean) {
  const i = await liveInfo();
  if (!i) { if (!quiet) console.error('no running server to load it into (start one with `codehud up`)'); return false; }
  const r = await fetch(`${i.url}/api/map/load`, {
    method: 'POST',
    headers: { authorization: `Bearer ${i.token}`, 'content-type': 'application/json' },
    body: JSON.stringify({ path: out }),
  });
  if (!quiet) console.error(r.ok ? `loaded into the HUD at ${i.url}` : `server refused the map: ${r.status} ${await r.text()}`);
  return r.ok;
}
async function cmdCrawl(pos: string[], flags: Flags) {
  const root = pos[0] ? path.resolve(pos[0]) : fail('usage: codehud crawl <repo> [--out file] [--watch] [--load]');
  if (!fs.existsSync(root)) return fail(`${root} does not exist`);
  const watch = flags.watch === true;
  const out = str(flags.out) ? path.resolve(str(flags.out)!) : watch || flags.load === true ? path.join(root, MAP_REL) : undefined;
  const crawler = await loadCrawler();
  const quiet = flags.quiet === true;
  await crawlOnce(root, out, flags, crawler);
  if (out && (flags.load === true || watch)) await pushToServer(out, quiet);
  if (!watch) return;

  const IGNORE = /(^|[\\/])(node_modules|\.git|dist|build|\.next|\.svelte-kit|\.astro|\.turbo|\.cache|coverage|\.wrangler|\.vite|\.codehud)([\\/]|$)/;
  let timer: NodeJS.Timeout | null = null;
  let busy = false;
  let dirty = false;
  const run = async () => {
    if (busy) { dirty = true; return; }
    busy = true;
    try { await crawlOnce(root, out, flags, crawler); await pushToServer(out!, true); }
    catch (e: any) { console.error(`crawl failed: ${e.message}`); }
    finally { busy = false; if (dirty) { dirty = false; void run(); } }
  };
  console.error(`watching ${root} (Ctrl-C to stop)`);
  fs.watch(root, { recursive: true }, (_ev, file) => {
    if (!file || IGNORE.test(String(file))) return;
    if (timer) clearTimeout(timer);
    timer = setTimeout(run, 600);
  });
  await new Promise(() => { /* run until killed */ });
}

// ----- install / uninstall ------------------------------------------------------
interface Target { project: string | null; home: string; settingsFile: string; hooksDir: string; claudeMd: string | null; mcpFile: string | null }
function target(flags: Flags): Target {
  const home = os.homedir();
  if (flags.global === true) {
    return { project: null, home, settingsFile: path.join(home, '.claude', 'settings.json'), hooksDir: path.join(home, '.claude', 'hooks'), claudeMd: null, mcpFile: null };
  }
  const project = path.resolve(str(flags.project) ?? process.cwd());
  if (!fs.existsSync(project)) fail(`${project} does not exist`);
  return { project, home, settingsFile: path.join(project, '.claude', 'settings.json'), hooksDir: path.join(project, '.claude', 'hooks'), claudeMd: path.join(project, 'CLAUDE.md'), mcpFile: path.join(project, '.mcp.json') };
}
function readJson(file: string): any {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return undefined; }
}
function writeJson(file: string, data: unknown) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(data, null, 2) + '\n');
}
function haveClaude(): boolean {
  const r = spawnSync(process.platform === 'win32' ? 'where' : 'which', ['claude'], { stdio: 'ignore' });
  return r.status === 0;
}
/** How Claude Code should launch the bridge: this very CLI when running from a clone, `npx -y codehud mcp` when installed. */
function mcpLaunch(): { command: string; args: string[] } {
  if (!bundled) return { command: 'node', args: [posix(path.resolve(here, 'cli.ts')), 'mcp'] };
  const npx = ['-y', 'codehud', 'mcp'];
  // Claude Code on Windows needs the cmd wrapper for npx-based servers.
  return process.platform === 'win32' ? { command: 'cmd', args: ['/c', 'npx', ...npx] } : { command: 'npx', args: npx };
}

async function cmdInstall(pos: string[], flags: Flags) {
  if (pos[0] !== 'claude') return fail('only `codehud install claude` is supported right now');
  const t = target(flags);
  const done: string[] = [];
  const launch = mcpLaunch();

  // 1. MCP registration
  if (t.mcpFile) {
    const cur = readJson(t.mcpFile) ?? {};
    cur.mcpServers = { ...(cur.mcpServers ?? {}), codehud: { command: launch.command, args: launch.args } };
    writeJson(t.mcpFile, cur);
    done.push(`MCP server "codehud" → ${t.mcpFile} (project scope; Claude Code asks once to trust it)`);
  } else if (haveClaude()) {
    const r = spawnSync('claude', ['mcp', 'remove', '--scope', 'user', 'codehud'], { stdio: 'ignore', shell: process.platform === 'win32' });
    void r;
    const add = spawnSync('claude', ['mcp', 'add', '--scope', 'user', 'codehud', '--', launch.command, ...launch.args], { stdio: 'inherit', shell: process.platform === 'win32' });
    if (add.status === 0) done.push('MCP server "codehud" → user scope via `claude mcp add --scope user`');
    else fail('`claude mcp add` failed; run it by hand: claude mcp add --scope user codehud -- ' + [launch.command, ...launch.args].join(' '));
  } else {
    fail('`claude` is not on PATH, so the user-scope MCP registration cannot be done here. Run: claude mcp add --scope user codehud -- ' + [launch.command, ...launch.args].join(' '));
  }

  // 2. hooks pack (presence, AskUserQuestion -> HUD, SessionStart note), copied then installed by its own installer
  if (flags['no-hooks'] !== true) {
    const r = runHooksInstaller(t, false);
    done.push(`hooks pack → ${r.dir}; ${r.changes.join('; ') || 'already installed'} (${t.settingsFile})`);
  }

  // 3. CLAUDE.md snippet (project scope only)
  if (t.claudeMd) {
    const snippet = fs.readFileSync(path.join(ENTRY.templates, 'CLAUDE.md.snippet'), 'utf8').replaceAll('codehud/system.json', MAP_REL);
    const cur = fs.existsSync(t.claudeMd) ? fs.readFileSync(t.claudeMd, 'utf8') : '';
    if (cur.includes(SNIPPET_MARK)) done.push(`CLAUDE.md already has the codehud section (left as is)`);
    else {
      fs.writeFileSync(t.claudeMd, (cur ? cur.replace(/\s*$/, '\n\n') : '') + snippet.replace(/\s*$/, '\n'));
      done.push(`codehud section → ${t.claudeMd}`);
    }
  }

  // 4. crawl
  if (t.project && flags['no-crawl'] !== true) {
    const out = path.join(t.project, MAP_REL);
    try {
      const crawler = await loadCrawler();
      await crawlOnce(t.project, out, { quiet: true }, crawler);
      done.push(`system map → ${out}`);
    } catch (e: any) {
      done.push(`crawl failed (${e.message}); write ${out} by hand or let the agent author it, then \`codehud up --map ${out}\``);
    }
  }

  console.log('codehud installed for Claude Code:');
  for (const d of done) console.log(`  - ${d}`);
  console.log(`\nNext: \`codehud up${t.project ? ` --map ${posix(path.join(t.project, MAP_REL))}` : ''}\`, open the printed link, start Claude Code${t.project ? ` in ${t.project}` : ''}.`);
  if (!haveClaude()) console.log('(`claude` was not found on PATH; the files above are still correct once it is installed.)');
}

/** Copy templates/hooks into the target and run its install.mjs (idempotent; --json). CLAUDE.md is handled by the CLI itself. */
function runHooksInstaller(t: Target, uninstall: boolean): { dir: string; changes: string[] } {
  const src = path.join(ENTRY.templates, 'hooks');
  if (!fs.existsSync(path.join(src, 'install.mjs'))) fail(`hooks pack missing at ${src}`);
  const dir = path.join(t.hooksDir, HOOKS_SUBDIR);
  if (!uninstall) {
    fs.mkdirSync(dir, { recursive: true });
    for (const f of fs.readdirSync(src)) if (f.endsWith('.mjs')) fs.copyFileSync(path.join(src, f), path.join(dir, f));
  }
  const args = [path.join(dir, 'install.mjs'), ...(t.project ? [t.project] : ['--global']), '--no-claude-md', '--json', ...(uninstall ? ['--uninstall'] : [])];
  const r = spawnSync(process.execPath, args, { encoding: 'utf8' });
  if (r.status !== 0) fail(`hooks installer failed: ${(r.stderr || r.stdout || '').trim()}`);
  let changes: string[] = [];
  try { changes = JSON.parse(r.stdout).changes ?? []; } catch { changes = [r.stdout.trim()]; }
  return { dir, changes };
}

async function cmdUninstall(pos: string[], flags: Flags) {
  if (pos[0] !== 'claude') return fail('only `codehud uninstall claude` is supported right now');
  const t = target(flags);
  const done: string[] = [];
  if (t.mcpFile) {
    const cur = readJson(t.mcpFile);
    if (cur?.mcpServers?.codehud) { delete cur.mcpServers.codehud; writeJson(t.mcpFile, cur); done.push(`removed "codehud" from ${t.mcpFile}`); }
  } else if (haveClaude()) {
    const r = spawnSync('claude', ['mcp', 'remove', '--scope', 'user', 'codehud'], { stdio: 'inherit', shell: process.platform === 'win32' });
    if (r.status === 0) done.push('removed the user-scope MCP registration');
  }
  const hooksDir = path.join(t.hooksDir, HOOKS_SUBDIR);
  if (fs.existsSync(path.join(hooksDir, 'install.mjs'))) {
    const r = runHooksInstaller(t, true);
    if (r.changes.length) done.push(`hooks: ${r.changes.join('; ')} (${t.settingsFile})`);
    fs.rmSync(hooksDir, { recursive: true, force: true });
    done.push(`deleted ${hooksDir}`);
  }
  if (t.claudeMd && fs.existsSync(t.claudeMd)) {
    const cur = fs.readFileSync(t.claudeMd, 'utf8');
    const i = cur.indexOf(SNIPPET_MARK);
    if (i >= 0) {
      const rest = cur.slice(i + SNIPPET_MARK.length);
      const next = rest.search(/\n## /);
      const cut = cur.slice(0, i).replace(/\s*$/, '\n') + (next >= 0 ? rest.slice(next + 1) : '');
      fs.writeFileSync(t.claudeMd, cut);
      done.push(`removed the codehud section from ${t.claudeMd}`);
    }
  }
  if (t.project) done.push(`kept ${path.join(t.project, MAP_REL)} (delete it yourself if you want)`);
  console.log(done.length ? 'codehud removed from Claude Code:\n' + done.map((d) => `  - ${d}`).join('\n') : 'nothing to remove');
}

// ---------------------------------------------------------------------------
const { pos, flags } = parse(process.argv.slice(2));
const [cmd, ...rest] = pos;
try {
  if (!cmd || flags.help === true || cmd === 'help') console.log(HELP);
  else if (cmd === 'up' || cmd === 'start') await cmdUp(flags);
  else if (cmd === 'demo') await cmdDemo(flags);
  else if (cmd === 'mcp') await cmdMcp();
  else if (cmd === 'crawl') await cmdCrawl(rest, flags);
  else if (cmd === 'install') await cmdInstall(rest, flags);
  else if (cmd === 'uninstall') await cmdUninstall(rest, flags);
  else if (cmd === 'status') await cmdStatus();
  else if (cmd === 'link') await cmdLink();
  else if (cmd === 'version' || flags.version === true) console.log(readJson(path.resolve(here, bundled ? '../package.json' : '../package.json'))?.version ?? 'dev');
  else fail(`unknown command "${cmd}"\n\n${HELP}`);
} catch (e: any) {
  fail(e?.message ?? String(e));
}
