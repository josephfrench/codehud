# Roadmap

Consolidated from the four research notes in `docs/research/` after the first proof of concept.
Ordered by what most improves the ten-second-answer moment.

## Now (POC hardening)

1. **Interruption policy.** Pending question = badge + header count + soft tone by default; auto-zoom only
   when the HUD window already has focus or the agent has waited more than N seconds. Never steal OS focus.
   (`interface-patterns.md` §3, §7)
2. **Staged zoom transition.** Siblings compress and dim, focus grows, children and edges fade in, 250-400 ms.
   Today it is a plain viewBox tween. (`interface-patterns.md` §2)
3. **Edges to the outside while zoomed in.** Show stubs at the container boundary for edges that leave the
   current level, with a count and a hover list, so a nested view is not an island.
4. **Hooks pack.** Ship `templates/hooks/presence.mjs` plus a `PreToolUse` hook on `AskUserQuestion` that
   redirects plain-text questions into the HUD, and a `SessionStart` hook that injects "codehud is live"
   only when the server is up. (`connection.md` §1, §6)
5. **No-browser fallback.** If no SSE client is connected when `hud_ask` is called, open the URL once, wait
   ~10 s, then fall back to MCP form elicitation, then to a plain-text result. (`connection.md` §4)
6. **Security backlog, must-have tier.** Per-session `hud_ask` token bucket, question expiry, SSE event ids +
   replay, `localhost` → `127.0.0.1` redirect, crawler hard rule enforced in code (never import repo code).
   (`security.md` §7)

## Next

7. **Crawler v1.** TypeScript compiler API import graph instead of regex; lane clustering by route prefix +
   import locality; stable ids; incremental re-crawl on `FileChanged`. An AI-assisted pass writes summaries
   and proposes lanes; the deterministic pass owns ids and edges. (`crawling.md`)
8. **Decision log.** Answered questions pinned to nodes as chips (done) plus a filterable timeline and
   "why is this here?" on hover.
9. **Option blast radius.** Hovering an answer option previews which nodes it would touch.
10. **Minimap + search polish.** Minimap when zoomed in or narrow; `/` search ranks by recency of agent focus.
11. **Multiple agents.** Per-session colours, routing of answers to the right waiting tool call (works today
    by question id), session picker.

## Later

12. **ACP driver spike.** Speak Agent Client Protocol as a client so Gemini CLI / OpenCode / Cursor agents can
    be driven from the browser; keep the sidecar model as the default. (`connection.md` §2)
13. **Remote mode.** Explicit `--allow-remote` with an operator token; `tailscale serve` recipe.
14. **Beyond web apps.** Layer vocabularies for services/monorepos/systems code; user-defined layer sets.
