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
docs/              design brief + research notes
templates/         CLAUDE.md / agent instruction snippets for repos that adopt codehud
```

## Quick start

```sh
pnpm install
pnpm build                 # builds the HUD into packages/hud/dist
pnpm start                 # http://127.0.0.1:4777  (loads examples/sample-webapp.system.json)
pnpm demo                  # in another terminal: simulates an agent focusing + asking a question
```

Development with hot reload: `pnpm dev` (server on 4777, Vite on 5173 proxying `/api`).

### Hooking up Claude Code

```sh
claude mcp add codehud -- node C:/path/to/codehud/packages/mcp/src/index.ts
```

Then add the snippet in `templates/CLAUDE.md.snippet` to the repo's `CLAUDE.md` so the agent prefers
`hud_ask` over plain text questions and calls `hud_focus` as it moves through the system.

## Status

Proof of concept. See `docs/` for the design brief and research notes on crawling, interaction patterns,
the terminal-to-browser connection, and security.
