# codehud

A heads-up display for the system you are building with an AI coding agent.

## Thesis

IDEs were built for humans to write code in. With an agent writing most of the code, the IDE is the wrong
surface: you do not need a text editor front and centre, you need to *see the system* the agent is changing.
A chat window is only as good as the agent's terse output, and scrolling through markdown and mermaid
diagrams is tedious. codehud is a single browser-based surface that sits beside the terminal agent:

- **The HUD** renders a *system map*: horizontal **layers** (client, edge, API, domain, persistence, external),
  vertical **swim lanes** (features / bounded contexts), nested **nodes** and the **edges** between them.
  Zoom in to a node to see its children; zoom out by clicking a parent; swipe between siblings.
- **Crawlers** scan a codebase and emit the system map as JSON (`@codehud/schema`). The HUD is generic;
  the crawler is where the per-stack smarts live. A map can also be hand-written or produced by an agent.
- **The bridge** (an MCP server) lets the terminal agent drive the HUD. When the agent needs a human decision
  it calls `hud_ask`: the HUD zooms to the part of the system in question, highlights it, shows the question
  with enough context (and a "show me more" expansion), and the answer flows back to the agent.

## Layout

```
packages/schema    the SystemMap types + validation + the HTTP/SSE protocol  (contract for everything else)
packages/server    local HTTP server: serves the HUD, holds the map, routes focus/questions over SSE
packages/hud       the browser UI (Vite + Svelte 5 + SVG)
packages/mcp       MCP stdio server the agent talks to; forwards to the local server
packages/crawler   turns a repo into a SystemMap (web-app heuristics first)
examples/          sample system maps
docs/              design brief, research notes, roadmap
templates/         CLAUDE.md snippet and Claude Code hooks for repos that adopt codehud
```

## Quick start

```sh
pnpm install
pnpm build                 # builds the HUD into packages/hud/dist
pnpm start                 # prints http://127.0.0.1:4777/#t=<token>  (loads examples/sample-webapp.system.json)
pnpm demo                  # in another terminal: simulates an agent focusing + asking a question
```

Open the printed URL. The `#t=` fragment signs the browser in once and is then stripped. Hot reload for UI
work: `pnpm dev` (server on 4777, Vite on 5173 proxying `/api` with the token injected).

Crawl a repo and load it:

```sh
pnpm crawl C:/path/to/repo --out C:/path/to/repo/codehud/system.json
pnpm start --map C:/path/to/repo/codehud/system.json
```

### Hooking up Claude Code

```sh
claude mcp add codehud -- node C:/path/to/codehud/packages/mcp/src/index.ts
```

Then add `templates/CLAUDE.md.snippet` to the repo's `CLAUDE.md` so the agent prefers `hud_ask` over
plain-text questions and calls `hud_focus` as it moves through the system. For passive presence (the blue
dot follows every file the agent reads or edits, without the model doing anything), register
`templates/hooks/presence.mjs` as a `PostToolUse` hook; the file header shows the settings snippet.

MCP tools: `hud_get_map`, `hud_find_nodes`, `hud_focus`, `hud_note`, `hud_ask`, `hud_await`, `hud_load_map`.
`hud_ask` waits up to 100 s per call (Claude Code backgrounds longer MCP calls) and returns a question id
the agent can `hud_await` on; the bridge sends MCP progress notifications while waiting and cancels the
question if the agent cancels the call.

## Using the HUD

| Key | Action |
| --- | --- |
| `↵` / double-click | open the selected node (its children) |
| `Esc` / `↑` | deselect, then zoom out to the parent |
| `←` `→` | swipe between sibling nodes, or between swim lanes at the top level |
| `1`…`9` | answer the pending question with that option |
| `f` | toggle follow-the-agent / free roam |
| `/` | jump to a node by name |
| `i` `a` `t` `?` | toggle import edges, activity trail, theme, help |

Amber means something needs you. Blue is where the agent is. A dashed amber border means a child inside
needs you. Edges between hidden children are lifted to their visible parents with a count. Layout is
deterministic: the same map at the same zoom level always looks the same.

## Security posture (proof of concept)

Loopback bind with an exact Host allowlist; random per-run bearer token in `~/.codehud/server.json` for
local clients; the browser receives the token in the URL fragment and exchanges it for a separate session
cookie (`HttpOnly`, `SameSite=Strict`); cookie-authenticated requests must present an exact-match `Origin`;
JSON content type required on writes; no CORS headers; every `/api/*` route except `/api/health` requires
auth, GETs and SSE included; CSP on the page; markdown from the agent is sanitised with DOMPurify; tool
results are framed as untrusted data. The crawler only reads and parses files and never executes repo
code. Details and the remaining backlog: `docs/research/security.md`.

## Status

Proof of concept, 2026-11-24. Works end to end with the sample map and the demo script. `docs/roadmap.md`
lists what comes next; the research behind it is in `docs/research/` (crawling, interface patterns,
terminal-to-browser connection, security) and the concepting prompt is in `docs/design-brief.md`.
