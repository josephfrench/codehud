# Security: threat model and requirements for the local server + agent bridge

Scope: the POC architecture (loopback Node server on 127.0.0.1:4777 serving the HUD, holding the map, taking JSON calls from the MCP bridge, streaming SSE to browsers, relaying human answers to the agent). The checklist in §7 is the actionable output.

## 1. Threat model

**Assets.** (a) Source-code structure: paths, layers, edges, summaries, possibly snippets. (b) The *answer channel*: whoever can POST an answer steers the agent, which believes the human said it. (c) The *question channel*: whoever can post questions can social-engineer or exhaust the human. (d) The agent's context window, which the map and the answers both flow into.

**Attackers.**

| Attacker | Reach | Wants |
|---|---|---|
| Malicious web page in the same browser | Blind cross-origin requests; DNS rebinding; another `localhost:<port>` page (the crawled repo's own dev server) is *same-site* with the HUD | Read the map; post an answer or question |
| Another OS user on a shared machine | Full TCP access to loopback; cannot read the owner's files | Read the map; answer as the owner |
| Malicious dependency in the crawled repo | Code in the tree; runs only if the crawler executes anything | RCE; poison the map |
| Compromised / prompt-injected agent | Legitimate bearer token | Fabricate "the human approved X": leading questions, flooding, XSS in question markdown to self-answer |
| The map (`hud_get_map` results) | Strings from file names, comments, READMEs, committed `.codehud/*.json` | Indirect prompt injection |
| The human answer | Free text relayed verbatim | A pasted blob can carry injection or blow the context |

The agent already holds the "lethal trifecta" of private data, untrusted content and the ability to act ([Willison](https://simonwillison.net/2025/Jun/16/the-lethal-trifecta/)). codehud adds a second untrusted-content path (the map) and a new high-trust channel (human answers); the answer channel must be the hardest thing in the system to forge.

## 2. Local-server classics

- **DNS rebinding.** `attacker.com` resolves to 127.0.0.1 after a short TTL; the page then makes *same-origin* requests with `Host: attacker.com`. Used against the Node inspector in 2018 ([CVE-2018-7160](https://bluec0re.blogspot.ca/2018/03/cve-2018-7160-pwning-nodejs-developers.html)) and in the chain against Anthropic's MCP Inspector ([CVE-2025-49596](https://www.oligo.security/blog/critical-rce-vulnerability-in-anthropic-mcp-inspector-cve-2025-49596), CVSS 9.4; fix 0.14.1 added a session token + Origin validation). The MCP spec says servers MUST validate `Origin` and SHOULD bind 127.0.0.1 ([spec 2025-06-18](https://modelcontextprotocol.io/specification/2025-06-18/basic/transports)); the official SDKs shipped without that default until late 2025 ([GHSA-w48q-cv73-mx4w](https://github.com/modelcontextprotocol/typescript-sdk/security/advisories/GHSA-w48q-cv73-mx4w)). A Host allowlist defeats it because the rebound request carries the attacker's hostname.
- **0.0.0.0-day.** Pages reached loopback services via `0.0.0.0`, bypassing Chrome's then-PNA checks; fixed in Chromium 128, Windows unaffected ([Oligo](https://oligo.security/blog/0-0-0-0-day-exploiting-localhost-apis-from-the-browser)). The Host allowlist catches this too.
- **CSRF against localhost.** A cross-origin `POST` with `Content-Type: text/plain`, `multipart/form-data` or `application/x-www-form-urlencoded` is a "simple request": no preflight, response unreadable, server-side effect happens ([MDN CORS](https://developer.mozilla.org/en-US/docs/Web/HTTP/Guides/CORS)). `fetch('http://127.0.0.1:4777/api/questions/1/answer',{method:'POST',body:'{"text":"yes"}'})` is exactly that. Requiring `Content-Type: application/json` forces a preflight, which fails when the server emits no CORS headers.
- **SSE cross-origin.** `EventSource` is a potential-CORS fetch (mode `cors`, credentials `same-origin` unless `withCredentials`) ([HTML spec](https://html.spec.whatwg.org/multipage/server-sent-events.html)). Verified: the request *reaches* the server, but without `Access-Control-Allow-Origin` the response is a network error and nothing is readable. So `GET /api/events` is safe cross-origin only while the server never emits CORS headers. Caveats: with `withCredentials=true` another `127.0.0.1:<port>` page *does* attach the `SameSite=Strict` cookie (site ignores port, §3), so no-CORS is the only thing protecting the body; and each attempt still costs a connection and a `hello` frame containing the whole map, so reject foreign `Origin` before writing and cap clients.
- **WebSocket** has no same-origin policy. Claude Code's VS Code extension bound an unauthenticated WebSocket MCP server to localhost; any page could enumerate ports and call its file-reading tools ([CVE-2025-52882](https://securitylabs.datadoghq.com/articles/claude-mcp-cve-2025-52882/), CVSS 8.8; fix: a token in a lock file supplied by the CLI, the pattern `server.json` copies). codehud uses SSE; if WebSocket is ever added, Origin validation on the upgrade is mandatory.
- **Browser-side mitigations (2026).** Chrome's Local Network Access prompt shipped in Chrome 142 (flag since 138), gates public->local and public/local->loopback, is auto-denied from insecure `http://` pages, and is being extended to WebSockets ([Chrome blog](https://developer.chrome.com/blog/local-network-access), [guide](https://developer.chrome.com/docs/modern-web-guidance/guides/security/local-network-access)). Firefox shipped `network.lna.*` in 147 and is enabling prompts by default ([Mozilla](https://support.mozilla.org/en-US/kb/control-personal-device-local-network-permissions-firefox)). Defence in depth only: users click through prompts, Safari is unclear, and **a page already in loopback space (any other localhost port) gets no prompt at all**.
- **Local-tool CVEs, 2025.** Cursor CurXecute/MCPoison ([CVE-2025-54135/54136](https://www.tenable.com/blog/faq-cve-2025-54135-cve-2025-54136-vulnerabilities-in-cursor-curxecute-mcpoison)): an injected agent edited `mcp.json` and a new server ran unconfirmed. mcp-remote ([CVE-2025-6514](https://jfrog.com/blog/2025-6514-critical-mcp-remote-rce-vulnerability/)): a server-supplied `authorization_endpoint` reached a shell via `open()`. VS Code Live Server ([CVE-2025-65717](https://socradar.io/blog/vs-code-extension-cves-rce)): unauthenticated localhost file server + malicious page = exfiltration. Lessons: untrusted strings never reach `spawn`/`open`/config-that-executes; anything on loopback authenticates; files inside a repo are attacker-controlled.

## 3. Evaluation of the planned controls

**Bind to loopback.** Correct. Bind the literal `127.0.0.1` (not `localhost`, which may resolve to `::1`). Loopback is shared by every user on the machine: a reachability control, not an auth control.

**Token in `~/.codehud/server.json`, Bearer on non-GET.** Good pattern (Claude Code's fix). Changes: 256-bit from `crypto.randomBytes`, `timingSafeEqual` compare, new token per start, delete the file on exit, bridge treats a stale `pid` as "gone". **Extend auth (Bearer or cookie) to GET `/api/*` too.** `GET /api/map` and the SSE `hello` frame dump the entire map; unauthenticated GET lets any local user or process read the codebase structure and snippets. Static assets stay public; never inline map data into the HTML.

**Cookie set when the HUD page is served.** The weakest planned control. If `GET /` hands out the cookie, *serving the page is authentication*: another local user runs `curl -i http://127.0.0.1:4777/` and holds a session. Instead, exchange an out-of-band token: the CLI prints/opens `http://127.0.0.1:4777/#t=<token>`; page JS reads the fragment, `POST /api/session`, receives the cookie, then `history.replaceState` to strip it. Fragments never hit the wire, logs or `Referer`, unlike Jupyter's and MCP Inspector's `?token=` query parameter ([Jupyter](https://jupyter-server.readthedocs.io/en/latest/operators/security.html), [Inspector](https://raw.githubusercontent.com/modelcontextprotocol/inspector/main/README.md)). Offer "paste token" as fallback. Make the cookie value a *separate* random session id, not the bearer token, so a HUD XSS cannot steal the agent credential; `HttpOnly; SameSite=Strict; Path=/`.

**SameSite=Strict + Host/Origin + no CORS: enough?** No. "Cookies do not provide isolation by port" ([RFC 6265 §8.5](https://datatracker.ietf.org/doc/html/rfc6265)) and "site" ignores the port ([MDN](https://developer.mozilla.org/en-US/docs/Glossary/Site)), so a page on `127.0.0.1:5173` is same-site with `127.0.0.1:4777`: its `<form method=POST>` and credentialed fetches carry the Strict cookie. The crawled repo's own dev server is such a page, and a malicious repo controls what it serves. So for **every cookie-authenticated request**: `Origin` must equal the HUD origin exactly (scheme+host+port; reject when absent), `Content-Type: application/json` (415 otherwise), plus a custom header (`X-Codehud-Request: 1`) that forces a preflight. Bearer requests (bridge, no `Origin`) skip the Origin rule but still pass the Host check. Cookie *integrity* is also weak (§8.6): another local port can overwrite it, so always validate the value. Canonicalise on `127.0.0.1` and redirect `localhost` to it; they are different cookie hosts.

**Host check.** Exact allowlist `127.0.0.1:4777`, `localhost:4777`, `[::1]:4777`; reject missing Host and absolute-form targets; apply before routing, static files included.

**CSP.** `default-src 'self'; script-src 'self'; connect-src 'self'; img-src 'self' data:; style-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'`, plus `nosniff` and `Referrer-Policy: no-referrer`. Svelte emits external CSS, so `'unsafe-inline'` is avoidable. CSP matters because the agent's `context`/`moreContext` markdown is attacker-reachable: an injected agent writing `<img onerror>` into a question is an attempt to click "approve" as the human. Sanitise markdown (DOMPurify, no raw HTML) *and* keep the CSP.

**Size and rate limits.** Node has no body limit. Cap bodies at 64 KB for focus/ask/answer (larger, separate cap for any map upload); set `requestTimeout`/`headersTimeout`; cap SSE clients (~16) and pending questions per session (~1, with expiry); token-bucket `hud_ask` (~6/min/session). The threat is an injected or looping agent flooding the human into click-through fatigue, which is how a fabricated approval really happens.

**SSE auth.** `EventSource` cannot set headers; same-origin it sends the cookie, which suffices once GET is authenticated. Reject foreign/absent `Origin` on `/api/events` *before* writing `hello`.

**Port file on Windows.** `mode: 0o600` is a near no-op: Node's `fs.chmod` on Windows only toggles the read-only bit ([Node fs docs](https://nodejs.org/api/fs.html#file-modes)). Protection comes from inheritance: a fresh profile root is `SYSTEM:(F)`, `Administrators:(F)`, `<user>:(F)` and nothing else (verified with `icacls %USERPROFILE%` on Windows 11), so `~/.codehud/server.json` is already unreadable by other standard users. Optionally `icacls server.json /inheritance:r /grant:r "<user>:(R,W)"`. Local Administrators can read it on any OS; accept that.

**Rotation / multi-user.** Per-start rotation is adequate for the POC; `codehud rotate` later. On shared machines auth-on-every-route is the protection; per-user `server.json` already avoids two users fighting over one file, but not over port 4777 (fall back to a free port and record it).

## 4. Prompt-injection surface

The map is built from untrusted repo content and becomes tool-result text, the canonical indirect-injection vector ([OWASP LLM01](https://genai.owasp.org/llmrisk/llm01-prompt-injection/), [Invariant Labs](https://invariantlabs.ai/blog/mcp-security-notification), [CyberArk](https://www.cyberark.com/resources/threat-research-blog/poison-everywhere-no-output-from-your-mcp-server-is-safe)). The agent already reads the repo, so the marginal risk is concentration: a README one-liner is diluted, a map summary that aggregates it is not. Recommendations: schema-enforce per-field caps (label 80 chars, summary 400, note 200); strip control, zero-width, bidi-override and ANSI sequences; no file contents in the map, only `FileRef` + line ranges (the agent reads files with its own tools and guardrails); cap `hud_get_map` results (~8 KB, paginate by node); wrap results as `<system_map source="crawler" trust="untrusted">` with a one-line preamble that contents are data, not instructions; treat a committed `.codehud/*.json` map as untrusted, same as crawler output.

Human answers: plain text, verbatim, wrapped as `<human_answer question_id=... option=...>` so the agent can tell the chosen option from free text; cap at 4 KB; no file attachments in the POC (a new upload/XSS/traversal surface that tempts the agent to treat pasted content as intent). If ever added, attach *paths within the map root*, never content. Any route that resolves `FocusRequest.files` or `FileRef` must `realpath` under the map root with no symlink escape.

## 5. Exposure beyond localhost

Everything above assumes no attacker on the network path. Over Tailscale or a remote dev box: the Host allowlist must include the configured hostname, cookies need `Secure` and HTTPS (LNA also requires a secure context), and the fragment token becomes a cross-machine shared secret. Rules: default stays loopback-only; a non-loopback bind requires an explicit `--allow-remote` flag *and* an operator-set token or real auth, else refuse to start. With Tailscale, keep binding loopback and front it with `tailscale serve`, trusting `Tailscale-User-Login` only because Serve strips client-supplied copies and only when direct access is impossible ([Tailscale Serve](https://tailscale.com/docs/features/tailscale-serve)); never Funnel.

## 6. Supply chain and code execution in the crawler

Hard rule: **the crawler never executes repo code.** No `import()`/`require()` of repo files, no `eval`, no `package.json` scripts, no `npm install`/`pnpm build`, no loading `babel.config.js`, `eslint.config.js`, `vite.config.ts` or any config-as-code (they execute on load), no `open()`/`spawn` with repo-derived strings. The crawler may: walk the tree without following symlinks out of root; read text files under a size cap (1 MB each, total cap); parse with the TypeScript compiler API / `@babel/parser` / tree-sitter (parsers, not loaders); read `package.json`, `tsconfig.json` and lockfiles as JSON only (never resolve `main`/`exports` by loading); match paths with bounded regexes (hostile inputs can trigger ReDoS); emit JSON. codehud's own install: `--frozen-lockfile` with `ignore-scripts=true`.

## 7. Prioritised checklist

**Must have now (POC)**
- Bind literal 127.0.0.1; Host allowlist with port; reject missing Host — DNS rebinding, 0.0.0.0.
- Auth on every `/api/*` route including GET and `/api/events` — map leak to local users/processes.
- Token via URL fragment -> `POST /api/session` -> HttpOnly cookie; no cookie on page load — free sessions for any local client.
- Cookie value separate from bearer token — HUD XSS stealing the agent credential.
- Cookie requests: exact Origin, `Content-Type: application/json`, custom header; else 403/415 — same-site CSRF from other localhost ports, simple-request CSRF.
- No CORS headers, ever — cross-origin reads of SSE/GET.
- Strict CSP + sanitised markdown for agent-supplied text — injected agent self-answering via XSS.
- Body caps, SSE client cap, request timeouts — local DoS.
- Pending-question cap and `hud_ask` rate limit with expiry — flooding the human into click-through approvals.
- Crawler never executes repo code (enforced in review and tests) — RCE from a malicious repo.
- Data framing of tool results and answers; per-field caps; strip control chars — indirect prompt injection.
- 256-bit token, timing-safe compare, rotate per start, delete on exit — guessing, stale credentials.

**Before sharing publicly**
- Redirect `localhost` -> `127.0.0.1`; `[::1]` in allowlist — cookie-host mismatch, IPv6 bypass.
- `icacls` hardening of `server.json` on Windows; `0600` on POSIX — other local users.
- `--allow-remote` gate with operator token; refuse other non-loopback binds — accidental LAN exposure.
- `realpath` containment under map root for any file-resolving route — traversal.
- Crawler symlink/size/regex-time caps; `ignore-scripts` in install docs — hostile repos, ReDoS.
- Lockfile pinning and dependency audit of codehud itself — supply chain.

**Later**
- `codehud rotate`; per-session bridge tokens; audit log of questions/answers — "did the human really say that".
- Peer-process verification (owning PID/UID of the loopback socket) — stronger multi-user isolation.
- Signed/hashed maps so a committed map can be marked trusted — map poisoning.
- Real auth (OIDC/Tailscale identity) if remote mode is used seriously — exposure beyond localhost.
