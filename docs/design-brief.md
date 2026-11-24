# Design brief: codehud

Paste the prompt below into a design-concepting tool to generate HUD concepts. Context for a human reader
follows the prompt.

## Prompt

```
Design a browser-based "heads-up display" (HUD) for a developer who is building a web application
with an AI coding agent that runs in a terminal. The developer no longer reads or writes most of the
code; the agent does. The HUD replaces the IDE as the developer's primary surface. It sits on a second
monitor or beside the terminal and must be glanceable.

What the HUD shows:
- A system map of the app, laid out as horizontal LAYERS (client, edge, API, domain, persistence,
  external services) crossed by vertical SWIM LANES (features such as auth, billing, projects).
  Nodes (pages, routes, services, tables, third-party APIs) sit in the cells; edges show calls,
  reads/writes, renders, and events between them.
- Semantic zoom: click a node to descend into its children; click a parent breadcrumb to zoom out;
  swipe or arrow between sibling nodes and between adjacent swim lanes without losing your place.
- Live agent presence: where the agent is currently working glows; a compact activity trail shows
  where it has been.
- The core moment: when the agent stops to ask the human a question, the HUD auto-zooms to the
  affected part of the system, highlights the node(s) and edge(s) involved, and presents the question
  with just enough context, a "show me more" expander for deeper context (relevant files, the agent's
  reasoning, the options' trade-offs), one-click answer options, and a free-text reply. The human
  should be able to answer in under ten seconds for routine questions and dig as deep as they want
  for hard ones.

Design constraints:
- Respect the human context window: never more than ~7 primary things visible; progressive disclosure
  everywhere; strong focus+context so the whole-system silhouette stays visible while zoomed in.
- Minimise cognitive load: consistent spatial positions (a node is always in the same place at the
  same zoom level), motion that explains transitions (zooming, lifting edges when collapsing nodes),
  calm defaults with highlights reserved for the agent's attention and pending questions.
- Intuitive without training: breadcrumbs, hover previews, keyboard-first (arrows to swipe siblings,
  enter to descend, esc to ascend, 1-9 to pick an answer).
- Dark, high-contrast, monospace-friendly aesthetic; must also work in light mode. Dense but not noisy.
- Must work on a 1440px-wide window and degrade to a 1024px side panel next to a terminal.

Deliver: (1) the overview screen with a pending question, (2) the zoomed-in screen for one node with
siblings swipeable and the question expanded with "more context" open, (3) the idle state showing live
agent presence and activity trail, (4) a component sheet: node card variants per kind (page, route,
service, table, external), edge styles per kind, the question card in collapsed/expanded/answered
states, breadcrumb/zoom controls, and the activity trail. Explain the interaction model in a short
caption per screen.
```

## Why these constraints

- **Human context window.** The thesis is that the chat transcript and the file tree both overflow
  working memory. The HUD exists to hold the system's shape *for* the human so the terminal only has
  to carry the current decision.
- **Spatial stability.** If nodes move around between renders, the map becomes something to re-read
  instead of something to recognise. Layout must be deterministic per (map, zoom level).
- **The ask moment is the product.** Everything else is scaffolding for the ten seconds when the
  agent needs a decision. Optimise latency-to-understanding there first.
