# Setting up codehud

Step-by-step, for a human or a coding agent. Pick path A (published package) or path B (clone). Both
end with the same three things: a local server on `127.0.0.1`, an MCP server named `codehud` registered
with Claude Code, and a system map at `.codehud/system.json` in the repo you work on.

Prerequisite: Node 22.18 or newer (`node --version`). Nothing else. The crawler never executes repo code.

## A. From npm (`npx`)

Run these inside the repo you are going to work on (the "project").

```sh
npx -y codehud install claude            # writes the four things listed under "What gets written"
npx -y codehud up --map .codehud/system.json
```

`up` prints `http://127.0.0.1:4777/#t=<token>`. Open it in a browser. Then start Claude Code in the
project; it reads `.mcp.json`, asks once to trust the `codehud` server, and the agent has the `hud_*` tools.

Flags: `--project <dir>` to target another directory, `--global` to register the MCP server and hook at
user scope instead (`~/.claude/settings.json`, `claude mcp add --scope user`; requires `claude` on PATH),
`--no-crawl`, `--no-hooks`.

## B. From a clone

```sh
git clone https://github.com/josephfrench/codehud
cd codehud
pnpm install
pnpm build                                            # builds the HUD into packages/hud/dist
node packages/cli/src/cli.ts install claude --project C:/path/to/project
node packages/cli/src/cli.ts up --map C:/path/to/project/.codehud/system.json
```

From a clone, `install claude` registers the MCP server as `node <clone>/packages/cli/src/cli.ts mcp`
instead of `npx -y codehud mcp`, so the clone must stay where it is. `pnpm cli -- <command>` is the same
as `node packages/cli/src/cli.ts <command>`.

## What gets written

| Where | What | By |
| --- | --- | --- |
| `<project>/.mcp.json` | `mcpServers.codehud` → `npx -y codehud mcp` (Windows: `cmd /c npx …`) | `install claude` |
| `<project>/.claude/hooks/codehud-presence.mjs` | copy of the presence hook (no dependency on where codehud lives) | `install claude` |
| `<project>/.claude/settings.json` | one `PostToolUse` group (`Edit\|Write\|MultiEdit\|Read\|NotebookEdit`) running that hook, async, 5 s timeout | `install claude` |
| `<project>/CLAUDE.md` | a `## codehud (system HUD)` section telling the agent when to call `hud_focus` / `hud_ask` | `install claude` |
| `<project>/.codehud/system.json` | the crawled system map (commit it, or ignore it and re-crawl) | `install claude`, `crawl` |
| `~/.codehud/server.json` | `{ url, port, host, token, pid, startedAt }` for the running server, mode 0600 | `up`, `demo` |

Re-running `install claude` is safe: it rewrites the same entries rather than adding duplicates.

## How the token travels

The server generates a random bearer token per run. It is delivered in exactly two places: the URL
fragment of the printed link (`#t=…`, consumed by the page once, then stripped from the address bar and
exchanged for an `HttpOnly`, `SameSite=Strict` cookie) and `~/.codehud/server.json` (read by the MCP
bridge, the hook and the CLI). It is never put in a query string, a log line, a header the page can read,
or the system map. If the link is lost: `codehud link`. If the server restarts, the old token and all
browser sessions are invalid; reopen the new link.

## Verify

```sh
codehud status        # server up, which map, how many browsers connected
```

In the browser: the top bar shows the map name and a green dot. In Claude Code: `/mcp` lists `codehud`
as connected; ask the agent to call `hud_focus` on any file and the blue marker moves. Edit a file with
the agent and the marker follows without any tool call (that is the hook). `codehud demo` runs the whole
flow on a sample system if you want to see it before wiring up a real repo.

## Keep the map fresh

```sh
codehud crawl . --watch --load      # re-crawls on file changes and pushes to the running server
```

Or let the agent call `hud_load_map` after it changes the shape of the system (the CLAUDE.md section asks
it to). The map is also accepted at `PUT /api/map` with the bearer token.

## Uninstall

```sh
codehud uninstall claude [--project <dir> | --global]
```

Removes the MCP entry, the hook and its settings group, and the CLAUDE.md section. It keeps
`.codehud/system.json`; delete that and `~/.codehud/` by hand. Nothing is installed anywhere else.

## Troubleshooting

- **Port in use:** `codehud up --port 4790`. Every client reads the port from `~/.codehud/server.json`.
- **"That token was not accepted":** the server restarted. `codehud link`.
- **Agent has no `hud_*` tools:** Claude Code was started before `.mcp.json` existed, or the trust prompt
  was declined. Restart it in the project; `claude mcp list` should show `codehud`.
- **No map after `install`:** the crawler only knows JS/TS web apps (Astro, Next, SvelteKit, Remix,
  Express/Hono/Fastify, Drizzle/Prisma, wrangler). For anything else, have the agent write
  `.codehud/system.json` in the schema (`packages/schema/src/index.ts`) and run `codehud up --map` on it.
- **Windows and `npx` in `.mcp.json`:** the entry uses `cmd /c npx -y codehud mcp`; that is deliberate.
