# ACP driver spike: driving agents from the HUD through the Agent Client Protocol

Roadmap item 12. Question: should codehud speak the [Agent Client Protocol](https://agentclientprotocol.com) (ACP,
Zed's editor-to-agent protocol) as a *client*, so that agents other than Claude Code can be followed and asked from
the browser without a per-agent MCP bridge and hooks pack? Sources: the v1 protocol pages (overview, prompt turn,
tool calls, elicitation, session setup), the agents and clients registries, and the TypeScript SDK
`@agentclientprotocol/sdk` 2.12.0 (`dist/v1/stable`). Spike code: `packages/acp-spike`.

## 1. What ACP gives us

ACP is JSON-RPC 2.0 over stdio (the client spawns the agent as a subprocess; HTTP and WebSocket transports exist as
experimental SDK entry points). The client is the editor; the agent is the coding agent. The flow is:

1. `initialize` (protocol version + capability exchange; the client advertises `fs`, `terminal`, `elicitation`),
   optional `authenticate`.
2. `session/new { cwd, mcpServers }` → `sessionId`; `session/load`, `session/list`, `session/resume` where supported.
3. `session/prompt { sessionId, prompt: ContentBlock[] }` runs one **prompt turn**. During the turn the agent streams
   `session/update` notifications: `agent_message_chunk`, `agent_thought_chunk`, `plan`, `tool_call`,
   `tool_call_update`, mode/config changes, usage. The turn ends with `{ stopReason }`; `session/cancel` interrupts.
4. Inside a turn the agent may call **client** methods: `session/request_permission { toolCall, options[] }`
   (options have `optionId`, `name`, `kind` ∈ allow_once | allow_always | reject_once | reject_always; the reply is
   `{ outcome: { outcome: "selected", optionId } | { outcome: "cancelled" } }`), `fs/read_text_file`,
   `fs/write_text_file`, `terminal/*`, and since v1 `elicitation/create` (form or URL mode, same shape as MCP
   elicitation).
5. Tool calls carry `kind` (read, edit, delete, move, search, execute, think, fetch, switch_mode, other), `title`,
   `status`, `content` (text, diffs, terminals) and **`locations: [{ path, line? }]`**, which the spec explicitly
   describes as "following the agent": clients use them to show which files the agent is reading or modifying.

That is the whole surface codehud needs: `locations` is presence, `request_permission` is a question with a finite
option set, `elicitation/create` is a free-form question, and `agent_message_chunk` is the activity feed. Nothing
in ACP is Claude-specific, and the registry lists ~50 agents that speak it today, including Gemini CLI, Codex CLI (via
the `codex-acp` adapter), Claude Agent (via Zed's `claude-agent-acp` adapter over the Agent SDK), Cursor, GitHub
Copilot CLI, Goose, OpenCode, Kiro, Junie, Cline, OpenHands, Qwen Code, Kimi CLI and Mistral Vibe.

## 2. Mapping onto codehud

| ACP message | codehud server call | Notes |
|---|---|---|
| `session/new` response | `POST /api/sessions { id: sessionId, label, cwd }` | one HUD session per ACP session; colour assigned by the server |
| `session/update tool_call` / `tool_call_update` with `locations` | `POST /api/focus { files: locations[].path, source: "hook", zoom: false, note: title }` | presence without the model doing anything; `kind: edit` could zoom, `read` should not |
| `session/update agent_message_chunk` (coalesced per turn) | `POST /api/notes` | throttle to one note per paragraph |
| `session/update plan` | `POST /api/notes` (or a future `/api/plan`) | the HUD has no plan surface yet |
| `session/request_permission` | `POST /api/questions { question: title, context: kind + paths + diff, options: options.map(o => ({ id: o.optionId, label: o.name })), files: locations }` then long-poll | reply `{ outcome: "selected", optionId }`; a cancelled/expired HUD question → `{ outcome: "cancelled" }` |
| `elicitation/create` (form) | `POST /api/questions` with the schema's enum as options, free text otherwise | reply `{ action: "accept", content }` |
| HUD free-text reply to a permission question | not expressible in ACP | the permission reply is option-only; free text can only be prepended to the *next* `session/prompt` |
| HUD "ask the agent" (future) | `session/prompt` | this is the inversion: with ACP the browser can *drive* the agent, not just watch it |

Differences from the MCP bridge that matter:

- **Direction.** With MCP, the agent calls us when it chooses to (`hud_ask`); with ACP, *we* own the agent process and
  see every tool call and permission request whether the model remembers the HUD or not. Presence becomes complete
  and free; questions become "every permission prompt", which is more than `hud_ask` and needs the interruption policy
  from `interface-patterns.md` (soft badge by default, zoom only when the HUD has focus).
- **Terminal.** An ACP client replaces the agent's own TUI: the prompt box moves into the browser (or a thin
  `acpx`-style CLI). That is a different product shape from "a HUD beside the terminal". The pragmatic middle ground is a
  **sidecar ACP client** that forwards everything to the HUD and relays the user's prompts from a minimal terminal
  REPL, which keeps the agent's own session semantics but loses its native UI (slash commands are advertised over
  ACP, so most of it survives).
- **Claude Code.** Claude Code itself is not an ACP agent; Zed's adapter wraps the *Agent SDK*, which means permission
  modes, hooks and CLAUDE.md behave as in the SDK, not as in the interactive CLI. For Claude Code the MCP bridge plus
  hooks pack stays the right integration; ACP is how we reach everyone else.

## 3. The spike (`packages/acp-spike`)

`node packages/acp-spike/src/index.ts` connects an in-process **stub agent** to a codehud ACP client built with the
SDK's `client()` / `agent()` apps (no transport needed: `client().connectWith(agentApp, …)`). The stub performs one
turn: it reports a `tool_call` with a `locations` entry (→ HUD presence on the webhook route), then calls
`session/request_permission` with allow/reject options (→ a HUD question with those two options, long-polled until the
human answers, expiry mapped to `cancelled`). With `--agent "<command>"` the same client spawns a real ACP agent over
stdio instead (`ndJsonStream` on the child's stdin/stdout) and sends one prompt; this path is untested here because no
ACP agent is installed on this machine, and the session's `cwd` must be a real directory for most agents.

What the spike proved: the SDK's typed handlers make the client ~80 lines; `locations` arrive before the permission
request, so the HUD is already at the right place when the question lands; the permission reply shape is strict
(option id only), so free-text HUD answers need the "prepend to next prompt" trick.

## 4. Plan

1. **Keep the sidecar model as default.** MCP bridge + hooks for Claude Code; nothing changes for the current users.
2. **`packages/acp` (v0.1, after the HUD settles):** promote the spike into `codehud acp <agent command>`, a stdio
   client that spawns the agent, forwards `locations` → focus, `request_permission` / `elicitation` → questions,
   `agent_message_chunk` → notes, and reads prompts from stdin. Validate against Gemini CLI (`gemini --acp`) and the
   Codex adapter, which are the two most common non-Claude agents in the registry.
3. **Interruption policy first.** Every permission prompt becoming a HUD question is loud; ship the soft-badge policy
   (roadmap item 1) before turning the ACP client on by default, and let `kind: allow_always` answers be remembered per
   session so repeat prompts auto-resolve.
4. **Browser prompt box (optional, later).** Once the ACP client exists, a prompt box in the HUD is a `session/prompt`
   call away. That is the point where the browser stops being a HUD beside the terminal and becomes the client; decide
   then, not now.
5. **Do not build an ACP *agent*.** codehud is not a coding agent; exposing it as an MCP server to ACP agents (ACP
   sessions accept `mcpServers`) already gives them `hud_ask` / `hud_focus` if a user prefers the pull model.
