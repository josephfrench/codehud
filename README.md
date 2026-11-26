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
packages/crawler   turns a repo into a SystemMap: adapters per framework / ORM / infra tool, TS compiler API imports
packages/cli       the `codehud` npm package: up, crawl, mcp, install claude, status, link, demo
packages/acp-spike Agent Client Protocol client spike (permission requests -> HUD questions)
examples/          sample system maps
docs/              design brief, research notes, roadmap
templates/         CLAUDE.md snippet and Claude Code hooks for repos that adopt codehud
```

## Install in a repo (npm)

```sh
npx -y codehud install claude          # .mcp.json, hooks pack, CLAUDE.md section, crawl -> .codehud/system.json
npx -y codehud up --map .codehud/system.json
```

Open the printed `http://127.0.0.1:4777/#t=…` link, start Claude Code in the repo, and the agent's
`hud_focus` / `hud_ask` calls land on the map. `npx -y codehud demo` shows the flow on a sample system
first. Full steps, what gets written where, and uninstall: `SETUP.md`. (Not published yet; until then,
`pnpm cli …` from a clone does the same.)

## Quick start from a clone

```sh
pnpm install
pnpm build                 # builds the HUD into packages/hud/dist
pnpm start                 # prints http://127.0.0.1:4777/#t=<token>; the HUD waits for a system to be loaded
```

Open the printed URL. The `#t=` fragment signs the browser in once and is then stripped. With nothing
loaded the HUD shows how to load a system; `/demo` runs the whole thing on a sample system with a scripted
agent, entirely in the browser (no server state, no agent), and links to the sample's JSON so you can see
the format a crawler emits. Hot reload for UI work: `pnpm dev` (server on 4777, Vite on 5173 proxying
`/api` with the token injected).

Crawl a repo and load it:

```sh
pnpm crawl C:/path/to/repo --out C:/path/to/repo/.codehud/system.json
pnpm start --map C:/path/to/repo/.codehud/system.json
```

A running server also takes a map from the agent (`hud_load_map`) or from `PUT /api/map`. `POST /api/reset`
(or the two-click **reset** button in the top bar) clears sessions, questions and history and re-reads the map
file; `pnpm demo` resets first, so every run starts from the sample as shipped. To drive the
HUD from a real (simulated) agent process instead of the in-browser demo: `pnpm start:sample` then
`pnpm demo` in a second terminal.

### Crawler coverage

`pnpm crawl <repo>` reads a repository and never runs it (enforced in code, tested with a booby-trapped
fixture). Adapters detect themselves from manifests and files:

- Web: Astro, Next (app + pages), SvelteKit, Remix / React Router v7, react-router SPAs, TanStack Router, Vue + Nuxt, Angular
- Servers: Express, Hono, Fastify, Koa, NestJS (controllers, guards, Bull queues, events, cron)
- Persistence: Drizzle, Prisma, Mongoose, TypeORM, Sequelize, DynamoDB, Supabase, Django ORM, SQLAlchemy
- Infrastructure: wrangler, Terraform, AWS CDK, serverless.yml, SAM / CloudFormation, vercel.json, Netlify, docker-compose
- Python: FastAPI, Flask, Django, Celery; dependencies from requirements / pyproject

Imports come from the TypeScript compiler API (parse only, tsconfig paths honoured). Lanes come from route
vocabulary, or one per workspace package. Corrections live in `.codehud/map.overrides.json`
(`--write-overlay-template`) and are re-applied on every crawl. `--watch --push` keeps the HUD live.
Not covered yet: Go, Java, C#. Any stack can still be mapped by hand or by the agent (`hud_load_map`).

### Hooking up Claude Code

```sh
claude mcp add codehud -- node C:/path/to/codehud/packages/mcp/src/index.ts
node templates/hooks/install.mjs C:/path/to/repo      # or: codehud install claude
```

The installer wires three hooks and appends `templates/CLAUDE.md.snippet` to the repo's `CLAUDE.md`:
presence (the blue dot follows every file the agent touches), `AskUserQuestion` → the HUD when a tab is
open (the answer flows back as `updatedInput`), and a SessionStart note telling the model codehud is live.
`--global`, `--uninstall`, `--dry-run`, `--json`.

If `hud_ask` finds no browser it opens the HUD once, then falls back to a terminal form dialog (MCP
elicitation), then to plain text; the question stays pending so `hud_await` can still pick it up.
Questions expire after 30 min (`--question-ttl`); per-session rate limits return 429.

Remote: `pnpm start --allow-remote mybox.tail1234.ts.net --operator-token <secret>` then
`tailscale serve --bg 4777`; browsers sign in with the operator token. Default stays loopback-only.
`CODEHUD_HOME` relocates `server.json`.

MCP tools: `hud_get_map`, `hud_find_nodes`, `hud_focus`, `hud_note`, `hud_ask`, `hud_await`, `hud_load_map`.
`hud_ask` waits up to 100 s per call (Claude Code backgrounds longer MCP calls) and returns a question id
the agent can `hud_await` on; the bridge sends MCP progress notifications while waiting and cancels the
question if the agent cancels the call.

## Using the HUD

Three views, switched from the top bar or with `m` (map) and `d` (docs):

- **Focus** (default) is a third-person scene of the part of the system the agent is in: the focal
  resources stand centre stage on a 3D floor as animated sprites, callers behind, callees in front, a
  fainter second ring further out, and connection beams on the floor. The agent is a character at the
  bottom with a dialogue box. When it asks something, each option previews the path it would take on the
  stage; confirm to send.
- **Map** is the whole system at the current level, as the original layer × lane grid or, with `g`, the
  same layout on the 3D floor. Right-click or triple-click opens a node's children; the location bar
  (top-left, in both views) shows the view, the path into the system and the zoom, with **fit**.
- **Docs** is the project's files under the map root with markdown preview and code view.

| Input | Action |
| --- | --- |
| click · double-click · triple/right-click | centre the camera · specifics card · focus it (focus view) or open it (map) |
| drag · right-drag · wheel | pan · orbit · zoom |
| `W` `A` `S` `D` · `Q` `E` · `R` `F` · `0` | steer · orbit · tilt · reset the camera |
| `Tab` / `↵` / `X` | target the next resource / its specifics / focus it |
| `1`…`9`, then `↵` | preview an answer's path, then confirm |
| `←` `→` `↑` `↓` | map: siblings or lanes, up a level, open the selected node |
| `Esc` | close the card, clear the preview, or go up a level |
| `c` `l` `h` `i` `t` `b` `?` `/` | collapse the dialogue, log, history, import edges, theme, ground, help, search |
| `Shift+F` | back to the agent (or stop following) |

Amber means something needs you. Blue is where the agent is. Layout is deterministic: the same map at
the same level always looks the same.

- A new question never steals focus: the node and the top bar go amber and a quiet toast appears; the
  view only moves when this window is focused, when you come back to it, or after 20 s unanswered.
- Zoomed into a node, the outside nodes its children talk to are laid out too, as ghost cards in their own
  rows and lanes with the real paths drawn to them, so a level is a slice of the whole system, never an
  island. Click a ghost to go there. Inside a cell, nodes sit in call order.
- `h` opens History: decisions, questions, notes and map loads, filterable, each linked to its nodes.
  `✓n` on a node answers "why is this here?" on hover.
- Several agents at once: each session has its own colour; click a session in the top bar to follow only
  that one. Pending counts group by session.
- Maps may declare any layer set in any order; `examples/service-mesh.system.json` shows a non-web one.
  Layers without a known colour get a palette slot or their own `color`.
- Edges are routes, and they light up for a reason: the agent's trace, a question, or the card under the
  pointer. Lit routes are bright, directional and labelled; everything else stays faint. A route leaves a
  card, follows the gutter between rows, crosses a row along a lane gutter, and goes round cards in its way.
- While **following**, the view goes where the agent goes. Any pan, zoom or click of yours stops that,
  says so once, and the top-bar button becomes **↩ back to agent** (or **back to question**).
- `b` turns on the ground: every layer (row) is a kind of terrain, named under the row label, with the same
  key on the grid and the 3D floor and a legend bottom-left. In focus view each plate names its layer.
- `/demo` is the in-browser tour; `/assets` shows every resource sprite in its four states.

## Security posture

Loopback bind with an exact Host allowlist (`localhost` and `[::1]` redirect to `127.0.0.1`); random per-run
bearer token in `~/.codehud/server.json` for local clients; the browser receives the token in the URL
fragment and exchanges it for a separate session cookie (`HttpOnly`, `SameSite=Strict`);
cookie-authenticated requests must present an exact-match `Origin`; JSON content type required on writes;
no CORS headers; every `/api/*` route except `/api/health` requires auth, GETs and SSE included; per-session
token buckets; questions expire; SSE replay is bounded; CSP on the page; markdown from the agent is
sanitised with DOMPurify; tool results are framed as untrusted data. Remote mode is opt-in and needs an
operator token. The crawler only reads and parses files and never executes repo code, enforced by a
runtime guard. Details and the remaining backlog: `docs/research/security.md`.

## Status

2026-11-25: the first roadmap is done (see `docs/roadmap.md` for what landed and what is next). Tests:
`pnpm test` (server 20, bridge 6, crawler 31). The research behind the design is in `docs/research/`
(crawling, interface patterns, terminal-to-browser connection, security, ACP) and the concepting prompt is
in `docs/design-brief.md`. The npm package is built and proven from a tarball but not published yet.
