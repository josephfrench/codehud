# codehud

A heads-up display for the system you are building with an AI coding agent. One command runs the local
server, the browser HUD, the MCP bridge your agent talks to, and the crawler that turns a repo into a
system map.

```sh
npx -y codehud install claude      # in the repo you work on: MCP server, presence hook, CLAUDE.md section, crawl
npx -y codehud up --map .codehud/system.json
```

Open the printed `http://127.0.0.1:4777/#t=…` link, then start Claude Code in that repo. The agent's
`hud_focus` calls light up where it is; `hud_ask` lands its questions on the map and your answer flows back.

- `codehud demo` runs the whole thing on a sample system, no agent needed.
- `codehud crawl <repo> --watch --load` keeps the map fresh while you work.
- `codehud status`, `codehud link`, `codehud uninstall claude`.

Node 22.18 or newer. Binds to 127.0.0.1 only; the sign-in token is delivered in the URL fragment and in
`~/.codehud/server.json`, never in a query string. Source, design notes and the schema:
<https://github.com/josephfrench/codehud>.
