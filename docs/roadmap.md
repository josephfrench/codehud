# Roadmap

Consolidated from the four research notes in `docs/research/` after the first proof of concept, then
worked through on 2026-11-25. The first fourteen items are done; what remains is listed under "Next" and
"Later" with the caveats each track reported.

## Done (2026-11-25)

1. **Interruption policy.** A new question never steals focus: amber badge, top-bar count, quiet toast.
   The view only moves when the window has focus, when it regains focus, or after 20 s unanswered
   (`INTERRUPT_AFTER_MS` in `packages/hud/src/lib/state.svelte.ts`).
2. **Staged zoom transition.** Grid: siblings compress and dim, the focus card grows, children and edges
   fade in (≈400 ms). 3D map: camera move, then sprites fade in. `prefers-reduced-motion` disables both.
3. **Edges to the outside while zoomed in.** First as stubs at the boundary; replaced on 2026-11-25 by ghost
   cards: the outside neighbours laid out in their own rows and lanes with real paths (`ghostsFor` in
   `packages/hud/src/lib/layout.ts`).
4. **Hooks pack.** `templates/hooks/`: presence (PostToolUse), `AskUserQuestion` → HUD (PreToolUse, answer
   returned as `updatedInput`), SessionStart context only when the server is up, and `install.mjs` that merges
   them idempotently. `codehud install claude` copies the pack into the project and runs the installer.
5. **No-browser fallback.** `hud_ask` ladder: browser → open the HUD once and wait 10 s → MCP form
   elicitation when the client supports it → plain text with the options and the question id.
6. **Security must-haves.** Per-session token buckets (429 + Retry-After), question expiry (30 min default,
   `--question-ttl`), SSE event ids with Last-Event-ID replay, `localhost`/`[::1]` → `127.0.0.1` redirect,
   crawler execution guard enforced in code with a booby-trapped fixture test. `CODEHUD_HOME` relocates
   `server.json`.
7. **Crawler v1.** Adapter architecture, TypeScript compiler API import graph (parse only, tsconfig paths),
   `.codehud/map.overrides.json` overlay re-applied on every crawl, package lanes for repos without routes,
   `--watch --push`, and adapters for Angular, Vue/Nuxt, react-router, TanStack Router, NestJS, Mongoose,
   TypeORM, Sequelize, DynamoDB, Supabase, Terraform, AWS CDK, serverless.yml, SAM/CloudFormation,
   vercel.json, Netlify, docker-compose, Python (FastAPI, Flask, Django, Celery). 31 tests on 16 fixtures.
8. **Decision log.** History drawer (`h`): decisions, questions, notes, map loads, filterable, linked to
   nodes; `✓n` on a node answers "why is this here?" on hover.
9. **Option blast radius.** Each answer option previews the nodes it would touch; confirm to send.
10. **Minimap + search polish.** Search ranks by pending questions and recent agent focus; the minimap also
    appears in the grid when zoomed in or when the layout is wider than the viewport.
11. **Multiple agents.** Server-assigned session colours, coloured markers everywhere, a session picker in
    the top bar that limits follow mode, pending counts grouped by session.
12. **ACP driver spike.** `docs/research/acp.md` plus `packages/acp-spike`: an ACP client that turns
    `session/request_permission` into a HUD question and file locations into focus, verified against a stub
    agent in process.
13. **Remote mode.** `--allow-remote host --operator-token …` (refuses to start without the token), Tailscale
    serve recipe in `connection.md`, threat notes in `security.md`.
14. **User-defined layer sets.** The HUD renders whatever `map.layers` declares, in order, with palette
    colours for unknown ids; `examples/service-mesh.system.json` proves a non-web layer set.
15. **Packaging.** `codehud` npm package (`packages/cli`): `up`, `crawl`, `mcp`, `install claude`,
    `uninstall claude`, `status`, `link`, `demo`. Bundled with esbuild, HUD included, proven from a tarball.
    `SETUP.md` for agents and humans, `RELEASING.md`, CI workflow. Not yet published.
16. **Routes and ground.** Map edges are routes: out of the card, along the gutter between rows, across a
    row along a lane gutter, round any card in the way (`packages/hud/src/lib/route.ts`, grid and 3D floor).
    They light up for a reason (agent trace, question, pointer) with direction and labels; the rest stays
    faint. `b` turns on the ground: one terrain per layer with the same key in every view and a legend;
    lanes are fenced districts. Cells order their nodes by call order. Focusing a container shows the
    edges of its children.
    The demo pushes an updated map after the answer (new `stripe_events` table, KV edges, or the
    timestamp column) so the picture follows the decision. `POST /api/reset` (top-bar **reset**, two
    clicks) wipes sessions, questions and history and reloads the map; `pnpm demo` resets on start.

## Next

- **Publish.** `npm publish` of `codehud` with provenance (steps in `RELEASING.md`); CI has not run on
  GitHub yet, so the first push will tell.
- **Crawler.** Go, Java and C# (tree-sitter or per-language regex passes); CDK cross-file construct references;
  React Router nested `route()` children; Terraform module internals; `guards` edges from middleware
  matchers; an agent-run pass that writes the overlay (summaries, lane ratification) so the crawl output
  improves without hand edits.
- **HUD.** Render `expired` questions distinctly; the dialogue
  should not fall back to another session's question when the followed session has none; verify the
  hidden-tab branch of the interruption policy under automation.
- **Server / bridge.** Bind remote sessions to `Tailscale-User-Login`; ACL hardening of `server.json` on
  Windows (`icacls`) and `0600` elsewhere; env overrides for the HUD dist and server entry so the CLI build
  no longer rewrites source text.
- **ACP.** Run the spike against a real ACP agent over stdio (the `--agent` path is written but unverified).

## Later

- Layer vocabularies and lane heuristics for systems code and large monorepos.
- Multiple HUD windows per map (one per agent) and a shared decision log across sessions.
- Replace the regex Python pass with a parser once a non-native option is available.
