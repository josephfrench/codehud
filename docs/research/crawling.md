# Crawling: turning a repository into a SystemMap

How do we get from a pile of files to the layers x lanes x nodes x edges that the HUD renders? This note
argues for a layered pipeline, says which parts must be deterministic and which should be AI-assisted, and
records what the v0 crawler (`packages/crawler`) actually does.

## 1. Three sources of truth, in order of trust

**Framework conventions (cheap, precise, shallow).** File-system routing tells you *what a file is* without
reading it: Astro `src/pages/**` (`.astro` = page, `.ts` = endpoint), Next `app/**/page.tsx` and
`app/**/route.ts`, SvelteKit `+page.svelte` / `+server.ts`, Remix flat routes, `middleware.ts` / `proxy.ts`
/ `hooks.server.ts`. Persistence is equally conventional: drizzle `export const x = sqliteTable('x', {...})`,
prisma `model X {}`, `wrangler.jsonc` bindings (`d1_databases`, `kv_namespaces`, `r2_buckets`, `queues`),
`vercel.json`. `package.json` dependencies name the externals (stripe, better-auth, resend, openai...).
Conventions give the *nodes* and their *layer* with high confidence; they say little about *lanes* or
*edges*.

**Static import graph (cheap, precise, noisy).** Relative imports are the one signal every JS/TS repo
has. Regex scanning is enough for v0 (it is what we do); the step up is [ts-morph](https://ts-morph.com/)
or the TypeScript compiler API for real resolution and symbol usage,
[dependency-cruiser](https://github.com/sverweij/dependency-cruiser) / [madge](https://github.com/pahen/madge)
for a ready-made graph with cycle and layering rules, and [tree-sitter](https://tree-sitter.github.io/) for
the same queries across languages. Imports give *edges*, fan-in (which files matter) and *import locality*
(which files belong together). At HUD zoom they are noisy (every page imports the layout) and only useful
once lifted to parents.

**LLM-assisted classification (expensive, fuzzy, the only thing that understands intent).** An agent
reads a cluster and answers: what feature is this, one-line summary, which edges are the real data flow. It
runs *after* the deterministic passes, on their output, with a budget (a summary per top-level node, a lane
proposal per cluster, a review of low-confidence edges), and never decides node ids or positions.

**Recommendation: a four-stage pipeline.** (1) deterministic discovery of nodes/layers from conventions;
(2) deterministic edges from imports, fetch calls, ORM usage and bindings, each tagged with a confidence;
(3) deterministic lane *proposal* and grouping from paths and import locality; (4) an AI pass that
summarises nodes, confirms or renames lanes, prunes edges, and writes the result into a committed overlay
file (`.codehud/map.overrides.json`) that stage 1-3 re-apply on every crawl. Humans edit the overlay too.
The crawl output is then `deterministic(repo) ⊕ overlay`, which is reproducible and reviewable in a PR.

## 2. Layers and lanes

**Layers are easy.** Kind implies layer: pages/components -> client; middleware, config, CDN rules -> edge;
routes, server actions, routers -> api; services/modules/jobs -> domain; tables/stores/queues -> persistence;
third parties -> external. The only judgment calls are "where does a lib module live" (default domain; client
if it is a `.svelte`/`.tsx` or sits under `components|stores|hooks`; api if it declares `app.get(...)` or
starts with `'use server'`) and package role in a monorepo (a Vite+Svelte package is a frontend, so its loose
modules are client).

**Lanes are the hard part**, because a lane is a *bounded context*, which is a human concept. Signals, from
strongest to weakest:

1. **Route prefix.** `/checkout/[token]/pay`, `/api/checkout/[token]/sign` -> `checkout`. URLs are the
   feature vocabulary the team already agreed on. Skip structural segments (`api`, `app`, `webhooks`, `v1`)
   and dynamic ones (`[token]`, `(group)`), take the first noun left.
2. **Directory.** `src/lib/checkout/*`, `src/features/billing/*`. Same noun test; `db`, `utils`, `shared`,
   `components` are structure, not features. The v0 crawler carries a ~150-word stop list for this.
3. **Import locality.** A node with no lane adopts the lane of its neighbours when they *unanimously* agree
   (a Svelte form that only the checkout pages render is checkout; `format.ts` used by two lanes stays
   shared). Count votes against a snapshot so lanes do not chain-react through base layouts; never let
   middleware vote.
4. **Naming.** Table `checkout_session` -> checkout. Weak but free.

Then budget: keep lanes with at least two strong votes, cap at eight, collapse the tail into `other`,
and leave genuinely shared things lane-less (they render in a shared column). On gmt-portal this yields
`checkout, auth, admin, crm, esign`; a human would fold `crm` and `esign` into `checkout` (they are
integration adapters, not contexts), which is exactly the kind of correction the AI/overlay pass should
make. Rule of thumb: the crawler proposes lanes, a human or agent *ratifies* them once, and the ratified
lane map is committed; new nodes are then assigned to existing lanes by the same signals.

## 3. Nesting policy

The HUD is glanceable only if each zoom level shows roughly 7-12 things. Policy:

- **Top level per (layer, lane) cell:** groups, not files. Pages group by first route segment
  (`/checkout/*`), routes by `/api/<first>`, components per `src/components/<sub>`, modules per
  `src/<dir>/<sub>` (two directory levels below `src`). A group forms at 2 members for directories and 3
  for route prefixes; singletons stay top-level. Tables nest under their store.
- **Depth:** three levels is the ceiling (group -> file node -> notable function). v0 stops at two; a
  third level (exported functions, drizzle columns) belongs in the detail panel, not the map.
- **Oversized groups** keep the `maxChildren - 1` highest fan-in members and roll the rest into a single
  `+N more` child that owns the remaining files, so `nodesForFile` still resolves and the agent can focus it.
- **Huge codebases / monorepos:** one map per deployable, plus an index map where each app is a node.
  Trying to put five apps in one layer grid gives twenty lanes and no silhouette. v0 prefixes group
  labels with the package directory; a proper multi-app map needs an `app` dimension or nested maps.

## 4. Edge extraction and confidence

| Signal | Edge | Confidence | Notes |
|---|---|---|---|
| relative `import` resolved to a file | `imports`, or `renders` when a page/component imports a component | high | dedupe, drop self and ancestor/descendant pairs |
| `fetch('/api/x')` / `` fetch(`/api/x/${id}`) `` | `calls` route | high / medium (template) | match against route patterns, most specific wins; method from a nearby `method:` |
| `href="/x"`, `redirect('/x')`, `goto('/x')` | `navigates` page | medium | |
| drizzle `.from(t)`, `db.query.t.find*`, `.insert(t)/.update(t)/.delete(t)` | `reads` / `writes` table | high | a file that does both gets both edges |
| table identifier imported but no operation seen | `depends` | low | |
| prisma `db.model.findMany/create/...` | `reads` / `writes` | high | |
| `env.DB`, `env.KV.get/put` | `calls` / `reads` / `writes` store | medium | binding names from wrangler |
| npm import of a catalogued package | `calls` external | high | |
| `env.CRM_URL` + `env.CRM_API_KEY` | `calls` env-derived external | medium | URL-ish variable creates the node; `*_MODE` toggles do not create edges |
| event emit/listen, queue send/consume | `emits` / `listens` | not in v0 | needs per-library patterns (`queue.send`, `inngest.send`, EventEmitter) |
| middleware `guards` route | `guards` | not in v0 | needs the public-prefix list parsed out of the middleware |

Confidence travels in `edge.meta.confidence` so the HUD can render low-confidence edges faint and the AI
pass can target them for review. Most of the remaining precision is gained by replacing regexes with
type-aware resolution (what does `services(ctx)` return, and which table does `this.db` touch?).

## 5. Incremental re-crawl, caching, stable ids

The HUD's spatial stability depends on ids that survive edits: `page:src/pages/login.astro`,
`route:src/pages/api/checkout/[token]/sign.ts`, `table:checkout_session`, `external:stripe`,
`components:src/components/`. Kind + normalised path is stable under content changes and renames stay
detectable (same kind, new path, mostly the same imports -> emit a `renamedFrom` hint). Group membership
flips (a directory crossing the 2-file threshold) are the main instability; the overlay can pin a group.

A full crawl of a few-hundred-file app takes well under a second, so v0 re-crawls from scratch. Later: a
per-file cache keyed by content hash (imports, fetch literals, ORM touches, env references); on change
re-extract only dirty files, then re-run grouping, edges and lanes, which are pure functions of the cache. AI
summaries cache by the hash of a node's files and refresh lazily when the HUD shows the node.

## 6. Prior art worth stealing from

- **C4 / Structurizr** ([c4model.com](https://c4model.com/), [structurizr.com](https://structurizr.com/)):
  context -> container -> component -> code is our zoom ladder; "model once, many views" is the overlay idea.
- **Backstage software catalog** ([backstage.io](https://backstage.io/docs/features/software-catalog/)):
  `catalog-info.yaml` in the repo, owned by the team, with `dependsOn`/`providesApis` relations. Our overlay
  file should look like this: small, committed, human-edited, machine-merged.
- **Nx project graph** ([nx.dev](https://nx.dev/features/explore-graph)): affected-graph on change is the
  model for incremental re-crawl and for highlighting what the agent's diff touches.
- **dependency-cruiser** ([github](https://github.com/sverweij/dependency-cruiser)): rules over the
  import graph ("client must not import persistence") are a free linting layer once we have the map.
- **Sourcetrail** ([github](https://github.com/CoatiSoftware/Sourcetrail), discontinued): symbol-level graph
  with focus+context; file-level is too coarse to navigate and symbol-level too fine to overview, hence nesting.
- **CodeSee** (acquired by GitKraken in 2024, now [GitKraken Codemaps](https://gitkraken.com/solutions/codemaps);
  [press release](https://gitkraken.com/press/gitkraken-acquires-codesee-launches-devex-platform)): auto
  maps from imports and a per-PR "what changed" map, which is worth copying; one flat level made them unreadable.
- **Windsurf Codemaps** ([docs](https://docs.windsurf.com/windsurf/codemaps)): AI-written hierarchical maps
  linked to code locations; closest to our AI pass, but not spatially stable.
- **Sourcegraph** ([sourcegraph.com](https://sourcegraph.com/)) for precise references when regexes run out;
  **Swimm** ([swimm.io](https://swimm.io/)) for docs anchored to code tokens, the model for summaries that do not rot.
- **Facebook pfff CodeMap** ([wiki](https://github.com/facebook/pfff/wiki/CodeMap)): directory treemap with
  semantic zoom; 2010-era proof that "always the same place" beats pretty layout.

## 7. "AI instructions to apply to any repo"

Ship a skill / `CLAUDE.md` snippet (`templates/`) that walks an agent through: (1) run
`node packages/crawler/src/cli.ts . --out .codehud/map.json`; (2) read the top-level nodes and the
lane list, and for each lane answer "is this a feature a product person would name?" merging or renaming
into `.codehud/map.overrides.json`; (3) for each top-level node with no summary, read its files and write
one line in the form "verb + object" ("Mints and verifies checkout link tokens"); (4) for each
low-confidence edge decide keep/drop; (5) re-run the crawler, which re-applies the overlay, and validate
with `validateSystemMap`. The schema package should also publish a JSON Schema generated from the types so
hand-written or agent-written maps can be validated outside Node. The agent never edits node ids; it edits
labels, lanes, summaries, parents and edges, which is exactly what the overlay format allows.

## 8. The overlay file

`.codehud/map.overrides.json` in the crawled repo is the committed, human- or agent-edited correction layer.
The crawler applies it after the deterministic passes on every run, so the output is always
`deterministic(repo) ⊕ overlay`, and a PR that touches the overlay is reviewable like any other. Start one
with `pnpm crawl <repo> --write-overlay-template`; `--no-overlay` shows the raw crawl.

```jsonc
{
  "version": 1,
  "name": "Acme Portal",                       // optional map name / description
  "lanes": {
    "crm":   { "mergeInto": "checkout" },       // fold a lane into another
    "esign": { "label": "E-sign" },             // relabel
    "admin": { "hide": true }                   // drop the lane; its nodes become lane-less
  },
  "addLanes": [{ "id": "billing", "label": "Billing" }],
  "laneOrder": ["checkout", "auth", "billing"],
  "nodes": {                                    // keys are node ids; a trailing * is a prefix match
    "route:src/pages/api/webhooks/*": { "lane": "billing" },
    "module:src/lib/legacy.ts":      { "hide": true },       // children reparent, edges lift to the parent
    "table:users": { "summary": "One row per human", "tags": ["pii"] },
    "service:src/lib/crm.ts": { "parent": "module:src/lib/checkout/", "kind": "service", "layer": "domain" }
  },
  "addNodes": [{ "id": "external:bank", "label": "Bank API", "kind": "external", "layer": "external" }],
  "addEdges": [{ "from": "service:src/lib/crm.ts", "to": "external:bank", "kind": "calls", "label": "ACH" }],
  "removeEdges": ["imports:a->b", { "from": "a", "to": "b" }]
}
```

Node ids are never edited through the overlay (they are what keeps the map spatially stable); everything
else is. Unknown ids are reported as warnings on stderr, never errors, so a stale overlay degrades gracefully.

## 9. v1 status: adapters and coverage

`packages/crawler` is now a pipeline plus adapters (`src/adapters/*`). Each adapter detects itself from the
manifests and files, may `prepare` cross-file tables (router configs), `classify` files, `scan` the repo for
persistence / infrastructure / externals, and contribute `edges`. The import graph comes from the TypeScript
compiler API (parse-only, `tsconfig` `paths` and `baseUrl` honoured) with the regex scanner as a fallback;
Python has its own import resolver. One runtime dependency: `typescript`.

| Area | Adapters | What becomes nodes / edges |
|---|---|---|
| Web frameworks | astro (`src/pages`), next (app + pages), sveltekit, remix / React Router v7 config, react-router (`createBrowserRouter`, `<Route>`), tanstack-router (file routes), vue + nuxt (pages, `server/api`, middleware, composables, Pinia), angular (suffix conventions, `Routes` arrays incl. `loadChildren`, guards, NgRx / signal stores) | pages, routes, components, middleware, stores; `fetch` / `$fetch` / `HttpClient` / axios → `calls`; `href` → `navigates` |
| Servers | express / hono / fastify / koa routers, nestjs (controllers, providers, guards, Bull processors, `@OnEvent`, `@Cron`, gateways, resolvers) | routes under their module, services, jobs, queues, events |
| Persistence | drizzle, prisma, mongoose, typeorm, sequelize, dynamodb (SDK usage + env refs), supabase (migrations + client usage + storage), Django ORM, SQLAlchemy | tables (with columns) under a store; `reads` / `writes` from usage |
| Infrastructure | wrangler, terraform (`.tf` resources, env refs, event source mappings, API integrations), aws-cdk (constructs, grants, event sources, routes, `entry` files), serverless.yml, SAM / CloudFormation (events, policies, env), vercel.json (crons, rewrites, `api/`), netlify, docker-compose | tables, stores, caches, queues, functions (which absorb their handler files), APIs and routes, edge, externals; declared wiring as edges |
| Externals | ~70 npm packages, PyPI packages, env-var-configured systems (`CRM_URL` + `CRM_API_KEY`) | `external` nodes with `calls` edges from the files that use them |
| Python | FastAPI / Flask / Django routes, Celery tasks, `requirements` / `pyproject` deps | routers with route children, jobs, stores, externals |

Lanes: route and directory vocabulary first; a workspace with no URL vocabulary (codehud itself) gets one
lane per package. `--watch` re-crawls on change and pushes to the running server. Safety: the crawler reads
files and nothing else; `guard.ts` makes any CommonJS load from under the crawl root throw while a crawl is
active, and the test suite crawls a booby-trapped repo (a `main` that writes a sentinel, `postinstall`,
`tsconfig` extending a `.js`) and asserts it never ran.

Still open: `guards` edges from middleware matchers; `fetch` against a variable base URL; symbol-level
nodes; tree-sitter for Go / Java / C#; the AI summarisation pass that writes the overlay.
