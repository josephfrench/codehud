# Connecting a terminal agent to the HUD

Research notes for the agent <-> server <-> browser connection, checked against current docs on 2026-11-24.
Baseline under test: the protocol in `packages/schema/src/protocol.ts` (local HTTP on 127.0.0.1:4777, SSE at
`GET /api/events`, MCP stdio bridge, `~/.codehud/server.json` for discovery).

## 1. Claude Code specifics

**Registering the bridge.** `claude mcp add codehud -- node <path>/packages/mcp/src/index.ts` writes a `local`-scope
entry to `~/.claude.json` (default scope, this project only). `--scope project` writes `.mcp.json` in the repo root
(shared via git, needs per-user approval; `claude mcp reset-project-choices` to redo), `--scope user` applies to every
project. The `--` is required so the bridge's own flags are not parsed by Claude. Precedence is local > project > user >
plugin, whole entry wins, no field merging. `.mcp.json` supports `${VAR}` / `${VAR:-default}` and a per-server
`"timeout"` (ms). ([mcp](https://code.claude.com/docs/en/mcp))

**Timeouts, and what happens when `hud_ask` blocks for 10+ minutes.** The wall-clock limit `MCP_TOOL_TIMEOUT` defaults
to 100,000,000 ms (about 28 h); the per-server `timeout` overrides it. The real constraints are two others
([env-vars](https://code.claude.com/docs/en/env-vars), [mcp](https://code.claude.com/docs/en/mcp)):

- `CLAUDE_CODE_MCP_AUTO_BACKGROUND_MS` (default 120000): "An MCP tool call in the main conversation that is still running
  after two minutes moves to a background task instead of blocking the session." Claude keeps going; the result arrives
  later as a task notification. Subagent calls are exempt. `0` disables it (set in `settings.json` `env`).
- `CLAUDE_CODE_MCP_TOOL_IDLE_TIMEOUT`: a call with no response and no progress notification for 30 min (stdio) aborts.
  Progress notifications reset the idle clock but never extend the wall clock.

So "`hud_ask` blocks until the human answers" is not safe as designed. Make `hud_ask` wait at most ~100 s, then return
`{status:"pending", questionId}` and have the agent call `hud_await(questionId)` (also bounded) in a loop; emit
`notifications/progress` every ~20 s while waiting; and document `CLAUDE_CODE_MCP_AUTO_BACKGROUND_MS=0` as an opt-in
for people who want a true block. Handle cancellation (Esc) via the tool handler's `extra.signal` and mark the question
`cancelled` so the HUD dims it. Results over 50,000 chars are spilled to a file (`MAX_MCP_OUTPUT_TOKENS` default
25,000 tokens; `_meta["anthropic/maxResultSizeChars"]` raises it per tool), relevant for `hud_get_map`.

**Elicitation.** Claude Code declares `elicitation: {form: {}, url: {}}` to stdio servers (v2.1.287+). Form mode renders a
terminal dialog; URL mode asks to open a link; `claude -p`/SDK runs cancel elicitations; `Elicitation`/`ElicitationResult`
hooks can auto-answer (`{"hookSpecificOutput":{"hookEventName":"Elicitation","action":"accept","content":{...}}}`).
([mcp#elicitation](https://code.claude.com/docs/en/mcp), [hooks#elicitation](https://code.claude.com/docs/en/hooks))
Elicitation is something the *server* raises during a tool call, not something the model chooses, and it renders in the
terminal, so it cannot replace `hud_ask`. It is, however, the right **fallback**: if no browser is connected, `hud_ask`
raises a form elicitation (question + options as an enum) so the human answers in the terminal and the agent is never
stuck; if that is declined/cancelled (headless), return a plain result telling the agent to use `AskUserQuestion`.

**Hooks.** Events include `SessionStart`, `UserPromptSubmit`, `PreToolUse`, `PermissionRequest`, `PostToolUse`,
`PostToolUseFailure`, `Notification`, `Stop`, `SubagentStop`, `FileChanged`, `CwdChanged`, `Elicitation`, `SessionEnd`.
Handlers are `command`, `http`, `mcp_tool`, `prompt`, `agent`. Common stdin fields: `session_id`, `transcript_path`,
`cwd`, `permission_mode`, `hook_event_name`. Matchers: plain `Edit|Write` lists or an unanchored JS regex; MCP tools are
`mcp__<server>__<tool>`. Exit 0 + JSON on stdout is the decision; exit 2 blocks (stderr shown to Claude); default
`command` timeout is 600 s (30 s on `UserPromptSubmit`); `"async": true` runs a command hook without blocking.
([hooks](https://code.claude.com/docs/en/hooks))

**Can a PreToolUse hook on `AskUserQuestion` redirect to the HUD? Yes.** The docs state that `AskUserQuestion` "require[s]
user interaction" and that a PreToolUse hook satisfies it by "reading the tool's input from stdin, collecting the answer
through its own UI, and returning `permissionDecision: "allow"` with `updatedInput` that holds the answer", echoing the
original `questions` array plus an `answers` object keyed by question text (added in v2.1.85,
[release](https://newreleases.io/project/github/anthropics/claude-code/release/v2.1.85)). `"allow"` alone is not
enough; no output falls through to the normal terminal prompt. `permissionDecision: "defer"` is `-p`-only. Input shape
(`questions[].{question, header, options[].{label, description}, multiSelect}`) is documented on the SDK page
([user-input](https://code.claude.com/docs/en/agent-sdk/user-input)). Caveat: the hook has no node/file context, and
its own `timeout` bounds how long the human has (set e.g. 3600). This gives coverage even when the model forgets
`hud_ask`; `hud_ask` remains the rich path.

**Presence without `hud_focus`.** `PostToolUse` with matcher `Edit|Write|Read|MultiEdit|NotebookEdit` carries
`tool_input.file_path` (absolute), plus `tool_response.filePath`. `FileChanged` fires for any writer including Bash, and
Bash results carry `tool_response.bashEditDiff` (v2.1.269+). Use `"async": true` so presence never slows the agent.
The `http` hook type can POST the JSON straight to `http://127.0.0.1:4777/api/hooks/claude` with
`"headers": {"Authorization": "Bearer $CODEHUD_TOKEN"}, "allowedEnvVars": ["CODEHUD_TOKEN"]`, but a tiny `command`
hook that reads `server.json` is more robust when the port moves.

**Session identity and cwd.** Hook JSON has `session_id` and `cwd`. `CLAUDE_CODE_SESSION_ID` is set in Bash, hook and
stdio MCP subprocesses ("An MCP server subprocess retains the ID it was spawned with"; hooks update on `/clear`), and
`CLAUDE_PROJECT_DIR` is set in the MCP server's environment. The bridge should register its session from those two
variables, and the server joins hook presence to MCP questions on `session_id`, falling back to cwd. A `SessionStart`
hook can POST registration and return `hookSpecificOutput.additionalContext` ("codehud is live at ...; prefer `hud_ask`")
only when the server is actually running, which beats a static CLAUDE.md line. Keep the CLAUDE.md snippet too: it is
the documented way to give standing instructions. `--session-id <uuid>` and `--name` exist for scripted launches.

**Other surfaces.** `--permission-prompt-tool mcp__codehud__hud_permission` routes permission prompts to an MCP tool in
`-p` mode only (returns `{behavior: allow|deny}`); `--permission-prompts none` denies them
([cli-reference](https://code.claude.com/docs/en/cli-reference)). The status line receives `session_id`, `cwd`,
`workspace.project_dir`, `model`; it is re-run on events (300 ms debounce) and optionally on `refreshInterval`, so read a
cheap `~/.codehud/state.json` rather than calling HTTP ([statusline](https://code.claude.com/docs/en/statusline)).
`AskUserQuestion` is unavailable inside subagents.

## 2. Other agents

| Agent | MCP client | Hooks | ACP | Notes |
|---|---|---|---|---|
| Codex CLI | `config.toml` / `codex mcp add`, stdio + HTTP | `hooks.json` (`~/.codex`, `.codex` if trusted): PreToolUse/PostToolUse with `session_id`, `cwd`, `tool_name`, `tool_input`, `tool_response`; MCP names `mcp__server__tool`; `mcp_tool` handler; hash-based trust via `/hooks` ([docs](https://learn.chatgpt.com/docs/hooks), [mcp](https://developers.openai.com/codex/mcp)) | via Zed's `codex-acp` adapter | Same hook payload family as Claude; a shared hook script covers both |
| Gemini CLI | `settings.json` | `BeforeTool`/`AfterTool` with `tool_name`, `tool_input`, `tool_response`; regex matchers; MCP tools named `mcp_<server>_<tool>` in the reference (verify) ([reference](https://geminicli.com/docs/hooks/reference/)) | native `gemini --acp`; client may inject an MCP server at initialize ([acp-mode](https://geminicli.com/docs/cli/acp-mode/)) | Elicitation support not documented |
| OpenCode | `opencode.json` | plugins | native `opencode acp`; uses `elicitation/create` form mode toward ACP clients ([docs](https://opencode.ai/docs/cli/acp/)) | |
| Cursor CLI | `.cursor/mcp.json` (team MCP not in ACP) | `.cursor/hooks.json`: `preToolUse`, `postToolUse`, `afterFileEdit` (`file_path`, `edits`), `beforeMCPExecution`; forum reports of user-level hooks not firing in CLI ([hooks](https://cursor.com/docs/hooks)) | native `agent acp`; blocking `cursor/ask_question` extension (currently never offered, per forum) ([acp](https://cursor.com/docs/cli/acp)) | |
| Aider | no native client confirmed; PR [#3672](https://github.com/Aider-AI/aider/pull/3672) open | none | none | Presence only via `FileChanged`-style watching or git |

**Sidecar vs ACP client.** As an ACP client codehud would spawn the agent, send `session/prompt`, render
`session/update` chunks, answer `session/request_permission` (`allow_once|allow_always|reject_once|reject_always`) and
elicitations, and get a free presence stream: `tool_call_update` carries `kind` (`read`, `edit`, `execute`, ...),
`status`, `locations: [{path, line}]` and diff content ([tool-calls](https://agentclientprotocol.com/protocol/v2/tool-calls.md)).
That is attractive, but it makes the browser the chat UI (prompt box, streaming, terminals, permissions), which is the
IDE-chat surface the thesis rejects, and for Claude Code it runs the SDK adapter rather than the interactive CLI, losing
slash commands, plan mode UI and the user's terminal habits. The ACP clients page shows ~250 clients already doing that
job ([clients](https://agentclientprotocol.com/get-started/clients.md)).

Recommendation: **sidecar-first**. MCP + hooks give the two things we need (questions in, presence in) for Claude Code
and Codex today, Gemini/Cursor via hooks with small payload adapters. Keep the server's ingress model agent-agnostic
(`session`, `presence`, `question`, `answer`) so a later `codehud acp <agent-cmd>` driver can feed the same events from
ACP `tool_call_update.locations` and `request_permission`. Spike it after the POC, not before.

## 3. Transport

**Server -> browser: keep SSE.** One-way push, native auto-reconnect, `id:` + `Last-Event-ID` replay, debuggable with
curl. Two caveats: browsers cap HTTP/1.1 SSE connections at 6 per origin ("Won't fix" in Chrome and Firefox,
[MDN](https://developer.mozilla.org/en-US/docs/Web/API/EventSource)), and SSE cannot carry answers. Mitigate the first
with a `BroadcastChannel` leader-election (one tab owns the EventSource, rebroadcasts to others) or simply accept it for
a POC; carry answers over `POST /api/questions/:id/answer`. Give every event a monotonic `id`, keep a ring buffer of the
last ~500 events, and on reconnect replay from `Last-Event-ID` or, if that id has fallen out of the buffer, send a fresh
`hello` snapshot. Send `: ping` comments every 20 s (keeps proxies alive, lets the browser detect a dead server). Move to
WebSocket only if the HUD grows bidirectional traffic (drag-to-reparent nodes, live cursors).

**Bridge -> server awaiting an answer: long-poll.** `GET /api/questions/:id?wait=90` returns 200 with the answer or 204
on timeout; stateless, trivially retried by `hud_await`, no SSE parsing in the bridge. The bridge also `POST
/api/sessions` on start and `POST /api/sessions/:id/heartbeat` every 15 s with `status`.

**Multiple tabs and multiple sessions.** Tabs are fan-out; every tab receives every event and the one that answers wins
(the server rejects a second answer with 409 and broadcasts `answer`). Sessions are identified by
`CLAUDE_CODE_SESSION_ID` (or Codex `session_id`), labelled `basename(cwd) + short id` plus the agent name, with a colour
assigned deterministically from a palette by hash of the session id. Questions carry `session`; the HUD shows the label
and colour on the question card and on presence highlights. Routing back is by `questionId` only: the server stores
the answer regardless of whether a long-poll is currently waiting, so a bridge that was cancelled or restarted gets it
on the next `hud_await`.

## 4. Discovery and lifecycle

Prior art for "find the local server":

- Chrome writes `DevToolsActivePort` in the user-data dir: line 1 port, line 2 the `/devtools/browser/<uuid>` path;
  `--remote-debugging-port=0` picks an ephemeral port and clients read it back
  ([CDP docs](https://developer.chrome.com/devtools/docs/debugger-protocol), [bug example](https://bugzilla.mozilla.org/show_bug.cgi?id=1706581)).
- Jupyter writes `jpserver-<pid>.json` to the runtime dir with `url`, `port`, `token`, `pid`, `root_dir`, `sock`, ...;
  `list_running_servers` reads each file, skips JSON still being written, yields it only if `check_pid(info["pid"])`
  and unlinks stale ones ([serverapp.py](https://sources.debian.org/data/main/j/jupyter-server/2.15.0-1/jupyter_server/serverapp.py)).
- Claude Code IDE plugins write `~/.claude/ide/<port>.lock` with `pid`, `workspaceFolders`, `ideName`, `transport`,
  `authToken`, and set `CLAUDE_CODE_SSE_PORT` in the terminal so the CLI knows which lock to use
  ([claudecode.nvim PROTOCOL](https://raw.githubusercontent.com/coder/claudecode.nvim/main/PROTOCOL.md)).
- VS Code hands the CLI an env var (`VSCODE_IPC_HOOK_CLI`) pointing at a socket, not a file.
- Vite's `server.port` defaults to 5173 and silently increments when busy unless `strictPort`
  ([vite](https://vite.dev/config/server-options.html)), so never assume 4777 is yours; read the file.

For codehud: keep `~/.codehud/server.json` (`port, host, token, pid, startedAt`, add `version` and `url`), write it with
temp-file + rename and mode 0600, and treat it as a hint: a reader validates `pid` is alive and `GET /api/health` with
the token succeeds, otherwise deletes it. Bind 4777, fall back to an ephemeral port if busy. Auto-start from the bridge:
take `~/.codehud/server.lock` with `O_EXCL`, spawn `codehud serve` detached (`detached: true`, `stdio: 'ignore'`,
`windowsHide`, `unref()`), poll for `server.json` up to 5 s. When no browser is connected and a question arrives: open
the URL once (`start ""` / `open` / `xdg-open`, rate-limited), wait up to ~10 s for an SSE client, then fall back to the
elicitation path from section 1, then to plain text. The server tracks `browsers` (connected SSE clients) and exposes it
in `hello`/`session` events; sessions go `stale` after 45 s without heartbeat and are removed on `SessionEnd` or when
the pid dies.

## 5. Remote scenarios (brief)

Run the server where the agent runs, because `server.json`, hooks and the bridge all live on that filesystem. Reach it
from the browser with a plain local forward: SSH `-L 4777:127.0.0.1:4777`, VS Code Remote/Dev Containers port forwarding
(`forwardPorts: [4777]`; auto-detected listeners are offered too,
[docs](https://code.visualstudio.com/docs/devcontainers/containers#_forwarding-or-publishing-a-port)), WSL2's default
localhost forwarding (Windows browser -> `http://localhost:4777` in WSL works out of the box). `open` will fail without a
display, so print the URL and keep polling for a browser. Over a tailnet, `tailscale serve --bg 4777` fronts the
loopback server with HTTPS without changing the bind address ([tailscale serve](https://tailscale.com/kb/1312/serve));
the token stays mandatory, delivered as `#token=` in the URL fragment and kept in `sessionStorage`.

## 6. Recommended POC design and backlog

Ingress is three doors into one server model: the MCP bridge (questions, focus, map), hooks (presence, session
registration, `AskUserQuestion` interception) and, later, an ACP driver. Egress is SSE to browsers plus long-poll to
bridges.

```text
Claude Code            codehud MCP bridge           codehud server (127.0.0.1:4777)        Browser tab(s)
   |  tools/call hud_ask      |                               |                                 |
   |------------------------->| read ~/.codehud/server.json   |                                 |
   |                          | (stale? spawn `codehud serve`)|                                 |
   |                          | POST /api/questions ---------->| resolve files->nodes            |
   |                          |     {question, context,       | status=pending, assign colour   |
   |                          |      files, options, session} | SSE id:42 event:question ------->| zoom + highlight,
   |                          |<-- 201 {id:"q_8f2"}           | (0 browsers? open URL / elicit) | show card
   |                          | GET /api/questions/q_8f2?wait=90                                |
   |  notifications/progress  |------------------------------>| (hangs)                         |
   |<- - - - - - - - - - - - -|                               |                                 |
   |                          |                               |<-- POST /api/questions/q_8f2/answer {optionId, text}
   |                          |<-- 200 {answer}               | SSE id:43 event:answer --------->| card -> answered
   |<-- tool result {answer}  |                               |                                 |
   |   (or after 100 s: {status:"pending", id} -> model calls hud_await(id) -> same long-poll) |
```

Exact `PostToolUse` JSON for an `Edit` (common fields and `tool_input` are documented; `tool_response` for `Edit` is
only partly documented, so map on `tool_input.file_path` and treat `tool_response.filePath` as a bonus):

```json
{
  "session_id": "5b1d1e2c-7f0a-4c1e-9c2a-1d2e3f4a5b6c",
  "transcript_path": "C:/Users/me/.claude/projects/C--Users-me-app/5b1d1e2c....jsonl",
  "cwd": "C:/Users/me/app",
  "permission_mode": "default",
  "hook_event_name": "PostToolUse",
  "tool_name": "Edit",
  "tool_input": {
    "file_path": "C:/Users/me/app/src/routes/checkout.ts",
    "old_string": "const total = 0",
    "new_string": "const total = cart.total()",
    "replace_all": false
  },
  "tool_response": { "filePath": "C:/Users/me/app/src/routes/checkout.ts", "...": "unstable" },
  "tool_use_id": "toolu_01ABC123..."
}
```

Mapping: `relative(mapRoot, tool_input.file_path)` -> `FileRef` -> node via the crawler's file index; emit
`focus { files, session, note: "edited", zoom: false }` tagged `source: "hook"` so the HUD highlights without yanking the
viewport.

Protocol corrections implied above: give `ServerEvent` an `id` and a `presence`/`source` distinction on `focus`; let the
bridge, not the model, fill `session`/`agent`; add `browsers` to `hello` and `session`; store absolute paths plus the
map root so hook paths resolve; add `version`/`url` to `ServerInfo`; make `hud_ask` return a `pending` shape.

**Backlog (first eight):**

1. Server: `server.json` atomic write + pid/health validation; SSE with ids, ring buffer, `Last-Event-ID`, `: ping`.
2. Bridge: discovery, auto-start with lock, session registration from `CLAUDE_CODE_SESSION_ID`/`CLAUDE_PROJECT_DIR`, heartbeat.
3. `hud_ask`/`hud_await` with the 100 s bound, progress notifications, `extra.signal` cancellation; validate against
   auto-backgrounding at 120 s in a real session.
4. Hooks pack: `PostToolUse` (`Edit|Write|Read|MultiEdit|NotebookEdit`, async) + `SessionStart` registration with
   conditional `additionalContext`; verify the `Edit` `tool_response` shape and update the mapping.
5. `PreToolUse` on `AskUserQuestion` -> HUD card -> `allow` + `updatedInput{questions, answers}`; confirm the terminal
   prompt is skipped in interactive mode and that a 1 h hook `timeout` holds.
6. Fallback chain when no browser: open URL -> form elicitation -> plain-text result; test decline/cancel paths.
7. Multi-session UI: labels, colours, per-session filter, 409 on double answers, orphaned questions on session death.
8. Codex adapter for the same hooks script (payload is near-identical), then an ACP-client spike (`gemini --acp`) that
   maps `tool_call_update.locations` to presence, to decide whether ACP earns a place in v2.
