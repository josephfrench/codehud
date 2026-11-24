# Interface patterns for the codehud HUD

Research notes, November 2026. Opinionated; written for the proof of concept. The thesis this serves: the HUD
holds the *shape of the system* for the human so the terminal only has to carry the current decision, and the
ten seconds around `hud_ask` are the product (see `docs/design-brief.md`).

## 1. Prior art: what to steal, what to avoid

**C4 / Structurizr.** Steal the discipline of *one abstraction level per view* and the double-click-to-descend,
`b`-to-go-back, `n`-for-a-navigator-of-adjacent-diagrams model
([Structurizr viewer docs](https://docs.structurizr.com/server/diagrams/viewer)). Steal the step-through
animation of dynamic views (`.` / `,`) for replaying an agent's trail. Avoid the fact that each C4 level is a
*separate diagram*: nothing persists spatially between levels, so you re-read instead of recognise. Our
layer x lane grid must stay fixed across zoom levels. Also note Simon Brown's advice that context + container
are enough for most teams ([c4model.com](https://c4model.com/diagrams)); our default depth should be two,
with component-level nodes only where the crawler finds real structure.

**IcePanel.** Steal: a single model rendered at three zoom levels, tags as cross-cutting filters, and
"flows" as first-class overlays ([icepanel.io/blog](https://icepanel.io/blog/2025-11-14-icepanel-vs-structurizr),
[Thoughtworks Radar](https://www.thoughtworks.com/en-sg/radar/platforms/icepanel)). Avoid: it is a drawing
tool first, so layout is hand-placed and drifts as the diagram is edited.

**CodeSee** (acquired by GitKraken, shut down Feb 2024; [CB Insights](https://www.cbinsights.com/company/codesee)).
Its "map of how a PR affects the rest of the codebase" is exactly the overlay we want for an agent's diff.
The lesson from its failure: a file-dependency graph with no semantic layering is a hairball nobody returns
to; the map has to be *about* the system (pages, routes, tables), not about imports.

**Sourcetrail.** The team tried to render the whole codebase, found it overwhelming, and switched to a
one-symbol-and-its-direct-neighbours graph tightly coupled to a code view with bidirectional hover highlighting
and WASD/HJKL keyboard focus ([cppstories review](https://www.cppstories.com/2017/10/sourcetrail/),
[Sourcetrail changelog](https://www.softpedia.com/progChangelog/COATI-Changelog-253758.html)). Steal the
hover coupling between graph and detail panel and the keyboard focus model. Avoid the lack of a stable
overview: every click re-laid out the graph.

**Windsurf/Devin Codemaps and the academic CodeMap.** Cognition's Codemaps (Nov 2025) are LLM-generated
hierarchical maps with "trace guides" and click-to-jump, framed as "turns your brain ON, not OFF" and
"to understand is to be accountable" ([cognition.com/blog/codemaps](https://cognition.com/blog/codemaps)).
That framing is our pitch too. The CodeMap study (15 developers) found global -> local -> detailed maps cut
time spent reading LLM responses by 79% versus ChatGPT ([arXiv 2504.04553](https://arxiv.org/html/2504.04553v3)).
Steal: natural-language edge labels, predefined starter questions. Avoid: maps as per-task snapshots; ours
is persistent and the agent's focus moves over it.

**Nx graph / Backstage catalog graph.** Nx's focus mode (node plus ancestors/descendants), proximity slider,
"affected" highlighting and composite-node focus are the right primitives for a dependency overlay
([nx.dev explore-graph](https://nx.dev/docs/features/explore-graph)). Backstage's graph is only as good as
declared YAML relations and defaults to a restrictive relation set
([Roadie](https://dev.to/roadie/easier-relationship-mapping-in-the-backstage-catalog-e97)); the lesson is that
edges must come from a crawler, never from humans filling in metadata.

**Figma/Miro canvas.** Steal the muscle memory: space-drag pan, ctrl-scroll zoom at cursor, `shift+1` fit,
`shift+2` zoom to selection, arrow keys pan when nothing is selected
([Figma help](https://help.figma.com/hc/en-us/articles/360040328653)). Avoid the infinite canvas itself: a
HUD has a finite, gridded world.

**ZUIs: Pad++, Jazz, Prezi.** Bederson's Pad++ established semantic zoom and level-of-detail rendering
([CHI '94 paper](https://www.cs.umd.edu/projects/hcil/jazz/learn/papers/chi-94-pad.pdf)). Jul and Furnas named
the failure mode, "desert fog": a view with no navigational cues, fixed by "critical zones" and "residue"
that stay visible at every scale ([UIST '98, via UBC slides](https://www.cs.ubc.ca/~tmm/courses/533-09/slides/nav.pdf)).
Prezi shows what happens when zoom is unconstrained: motion sickness and disorientation
([LSE Impact blog](https://blogs.lse.ac.uk/impactofsocialsciences/2013/06/07/prezi-in-the-academic-environment)).
Rule: zoom only between discrete semantic levels, never free-scale; no rotation; the layer/lane grid is the
residue that never disappears.

**Game HUDs.** Eve Online's 2026 HUD rework states the goal is not more information but making the space
"easier to read, understand, and interact with", with per-task saved layouts
([EVE: HUD, Sweat and Tears](https://www.eveonline.com/news/view/hud-sweat-and-tears)). RTS minimaps work
because pings combine a spatial marker with a sound, and attention is treated as the scarce resource
([Game Developer on minimaps](https://www.gamedeveloper.com/disciplines/-where-should-we-place-the-mini-map-)).
Deus Ex HR justifies the HUD diegetically: it is what the character sees
([Killscreen](https://www.killscreen.com/deus-ex-human-revolution-truly-transhuman.md)). For us: the HUD is
what the *supervisor* sees; the agent is a unit on the map with a position and a state, not a chat partner.

**ATC / flight displays.** FAA human-factors work uses colour for three jobs only: attention, identification,
segmentation; flashing beats colour for capture but must be acknowledgeable; the display "must never lead to
confusion" and alerts must not add workload via nuisance signals
([FAA AM90-03](https://www.faa.gov/sites/faa.gov/files/data_research/research/med_humanfacs/oamtechreports/AM90-03.pdf),
[NASA free-flight display](https://ntrs.nasa.gov/api/citations/20030053044/downloads/20030053044.pdf)). Steal
this colour budget literally.

**Bret Victor, Seeing Spaces.** Seeing inside, across time, across possibilities
([Dynamicland archive](https://dynamicland.org/archive/2014/Seeing_Spaces)). The HUD does "inside" (the map),
should do "across time" (agent trail, decision history), and the question card is where "across possibilities"
lives (options side by side).

**Linear / Graphite keyboard models.** Linear: command menu as universal entry, commands prioritised by
current context, shortcuts shown inline so the palette teaches them
([Linear changelog](https://linear.app/changelog/2019-12-18-new-command-menu)). Graphite: single-letter `S`
for stack navigator, `F` for file tree, focus mode that hides the tray
([Graphite docs](https://graphite.com/docs/review-pull-requests)). Steal both.

**2025-2026 agent surfaces, and why the ask moment is bad everywhere.** Cursor 2.0 / 3 put agents in a
sidebar list with status dots and later a separate Agents Window
([InfoQ on Cursor 3](https://infoq.com/news/2026/04/cursor-3-agent-first-interface/));
Devin Desktop uses a Kanban by status (blocked / ready for review) plus OS notifications
([Devin docs](https://docs.devin.ai/desktop/agent-command-center)); Warp has a status sidebar, a "Blocked"
state and a notification mailbox ([Warp docs](https://docs.warp.dev/agents/capabilities/agent-notifications/));
Claude Code desktop (Apr 2026) lists sessions with attention dots, and users file issues asking the dot to
distinguish "blocked on permission" from "finished" and asking the window to stop stealing focus
([claude.com blog](https://claude.com/blog/claude-code-desktop-redesign),
[issue 67568](https://claudeissues.com/issue/67568-feature-desktop-distinguish-blocked-on-permission-from-finished-awaiting-reply-i),
[issue 94460](https://claudeissues.com/issue/94460-feature-request-option-to-prevent-the-app-window-from-stealing-focus-when-a-sess)).
Conductor is a list of worktrees with a diff per workspace ([docs.conductor.build](https://docs.conductor.build/)).
Onlook and v0 put an agent next to a rendered UI on a canvas, which is spatial for the *output* but not for
the *system* ([onlook.com](https://www.onlook.com/)). The question widgets themselves (Claude Code
`AskUserQuestion`, Warp agent questions) are good: numbered options, recommended option, multi-select,
"Other", prev/next between up to four questions
([Agent SDK user-input](https://code.claude.com/docs/en/agent-sdk/user-input),
[Warp agent questions](https://docs.warp.dev/agents/local-agents/interacting-with-agents/agent-questions/)).

What is bad is everything around them: (a) the question arrives as text at the bottom of a scrolling
transcript with no spatial anchor, so the human reconstructs "where in the system is this?" from prose;
(b) context is either absent or the whole transcript; (c) the signal that a decision is pending is a dot
whose meaning is overloaded; (d) the only escalation is stealing OS focus. tldraw's "agents on canvas" talk
is the one counterexample that shows agents *positioned* in the workspace, and even there agents never ask
mid-task ([AI Engineer Europe 2026](https://www.ai.engineer/talks/sPUjIBH5Cwg-agents-on-canvas-in-tldraw)).
GitHub's own framing is that chat is the wrong UI once you know the task
([github.blog](https://github.blog/ai-and-ml/github-copilot/when-chat-is-the-wrong-ui/)). The gap is a
question anchored to a place on a stable map. That is the whole product.

## 2. Zoom, focus+context, stability, motion, edges, scale

- **Semantic over geometric zoom.** Geometric zoom scales pixels; semantic zoom changes representation
  per level. Use three discrete levels (system / node / children) with representation changing at each
  (silhouette -> card -> card with children and local edges). Interpolate geometrically only *during*
  the transition so the eye can track, then snap to the semantic rendering.
- **Focus+context, not overview+detail, as the primary mechanism.** Furnas's DOI = a priori importance
  minus distance from focus ([Furnas 1986](https://cspages.ucalgary.ca/~saul/581/exer.eps/4furnas86.pdf));
  Card and Nation's DOI trees apply it as logical filtering plus animated layout
  ([Heer and Card, DOI trees](https://homes.cs.washington.edu/~jheer/files/2004-DOITree-AVI.pdf)). For us:
  the focused node's cell expands; sibling cells compress to labelled stubs; the rest of the grid stays as
  thin bands. The DOI inputs are: distance in the hierarchy, edges to the focus, agent presence, pending
  questions. A minimap is secondary and only needed when the grid is compressed past legibility (1024px).
- **Spatial stability.** Deterministic layout per (map, level): sort children by a stable key (declared
  order, then id), never by size or degree. Misue et al.'s mental-map preservation, and the later finding that
  stability helps localisation tasks specifically ([Archambault and Purchase](https://pubmed.ncbi.nlm.nih.gov/20498503/)),
  is the relevant evidence: our task is precisely "find the thing again".
- **Animated transitions that explain.** Heer and Robertson showed animation significantly improves graphical
  perception and gave the congruence/apprehension principles: stage complex transitions, keep each stage
  a valid picture, slow-in/slow-out, avoid occlusion, no semantically empty motion
  ([paper](https://vis.berkeley.edu/papers/animated_transitions/2007-AnimatedTransitions-InfoVis.pdf)).
  Zoom-in should be staged: (1) siblings compress and dim, (2) focus cell grows, (3) children fade in and
  edges re-route. 250-400ms total; instant with reduced-motion.
- **Edge lifting and bundling.** The schema already says edges between hidden descendants lift to the nearest
  visible ancestor. Render lifted edges with a count badge and a thicker stroke; when the user hovers a
  lifted edge, show which descendants it aggregates. Holten's hierarchical edge bundling routes edges along
  the hierarchy with a tunable strength ([Holten 2006](https://research.tue.nl/en/publications/hierarchical-edge-bundles-visualization-of-adjacency-relations-in/));
  we get most of the benefit cheaply by routing edges through layer-band gutters (orthogonal, bundled per
  (fromCell, toCell) pair) rather than true spline bundling.
- **50-500 nodes.** Shneiderman: overview first, zoom and filter, details on demand
  ([The Eyes Have It](https://webspace.science.uu.nl/~telea001/uploads/VACourse/Shneiderman96.pdf)). At system
  level show only roots (cap ~40 visible cards; collapse overflow into "+12" stubs per cell). Hide `imports`
  and `depends` edges by default; show `calls/reads/writes/emits/renders` only for the focused node and its
  neighbours. Lanes with no roots collapse to a strip. Nothing animates when the agent is idle.

## 3. Cognitive load for a supervisor

- **Working memory is ~4 chunks, not 7.** Cowan's reconsideration puts the limit around four
  ([Cowan 2001](https://pubmed.ncbi.nlm.nih.gov/11515286/)). The design brief's "~7 primary things" is the
  ceiling; the question card should fit in four: the question, the place, the options, the recommended one.
- **Progressive disclosure.** Nielsen: show the most important options first, specialised ones on request
  ([NN/g](https://nngroup.com/articles/progressive-disclosure/)). Every detail in the HUD is one click or one
  key deeper, never in the default frame.
- **Fitts's law on the answer buttons.** Big targets, close to where the eye already is
  ([NN/g Fitts](https://nngroup.com/articles/fitts-law)). The options render *inside* the card that is already
  under the human's gaze, with the recommended option first and pre-focused so `Enter` answers. Keys `1-9` make
  distance zero.
- **Pre-attentive channels, budgeted.** Ware's categories: colour, form, motion, position
  ([summary](https://uxdesign.cc/preattentive-attributes-of-visual-perception-and-their-application-to-data-visualizations-7b0fb50e1375)).
  Spend them like ATC does: *motion* (slow pulse) is reserved for "agent is here"; *one hue* is reserved for
  "needs me"; everything else is greyscale plus the layer tint. Conjunctions are not pre-attentive, so never
  encode a state as "blue AND dashed".
- **Interruption design.** McFarlane's taxonomy: immediate, negotiated, mediated, scheduled; negotiated
  performed best overall, immediate only won on timeliness
  ([McFarlane 2002](https://interruptions.net/literature/McFarlane-HCI02_1.pdf)). Bailey et al. found
  interruptions land best at coarse task breakpoints
  ([Adamczyk and Bailey](https://hci.rwth-aachen.de/materials/conferences/CHI2004/1p271.pdf)). So: a new
  question is *negotiated* by default (badge on the node, count in the header, soft sound); it becomes
  *immediate* (auto-zoom plus card takes keyboard focus) only when the HUD window is already focused, or when
  the human has not acted on a badge for N seconds and the agent is fully blocked. Never steal OS focus.
- **Notification fatigue.** Clinical alarm research: 80-99% of alarms are non-actionable and the fix is raising
  the information value per alarm, not just reducing count
  ([AHRQ PSNet](https://psnet.ahrq.gov/perspective/reducing-safety-hazards-monitor-alert-and-alarm-fatigue)).
  Only `hud_ask` may alert; `hud_focus` never does. One alert per question; no re-alerting.
- **The ten-second answer.** Latency-to-understanding = time to locate (zoom brings it to you) + time to
  read (four chunks) + time to act (one key). Measure it: log ms from question-shown to answer-sent per
  question, and track the fraction answered without expanding context.

## 4. The question card

Structure, top to bottom: **where** (breadcrumb of the anchored node, auto-filled from focus), **question**
(one sentence), **context** (two lines max, written by the agent), **options** (2-4, numbered, one marked
recommended, each with a one-line consequence), **free text** ("Other", always present), **expander**.

Expansion levels, each a single keypress (`space` or `>`): summary (default) -> **reasoning** (agent's
why, bullets) -> **files and diff** (the `FileRef`s on the anchored nodes, a diff if the bridge supplies one)
-> **transcript** (the agent's recent turns, read-only). The map stays visible beside the card at every
level; at level 3 the card becomes a side panel rather than covering the map.

Trade-offs: render options as a tiny matrix when the agent supplies `pros`/`cons`/`risk` per option; two or
three columns, never prose paragraphs. When the agent tags options with affected node ids, hovering an option
previews its blast radius on the map, and the option touching the fewest nodes gets a quiet "smallest change"
marker.

Clarifying back: the free-text field with a `?` prefix (or an "ask back" button) sends a clarification instead
of an answer; the agent's reply appends to the same card. The question stays pending.

History: an answered question becomes a small pinned marker on its node (a decision chip) with the chosen
option and timestamp; the node's detail panel lists all decisions; `g d` opens a chronological decision log
that can jump to each node. This is "seeing across time" and it is what makes the map a record, not a toy.

## 5. Navigation model

- **Descend / ascend:** click or `Enter` on a node descends; click a breadcrumb or `Esc` ascends one level;
  `Shift+Esc` to system level. `b` returns to the previous view (Structurizr's back).
- **Siblings and lanes:** `Left/Right` moves between siblings in the same cell, `Alt+Left/Right` between
  adjacent lanes, `Alt+Up/Down` between layers, keeping the same depth. Trackpad: two-finger horizontal swipe =
  siblings; pinch snaps between the three levels (never continuous).
- **Keyboard map (vim-flavoured, Linear-taught):** `hjkl`/arrows move focus; `Enter` in, `Esc` out; `1-9`
  answer; `space` expand card; `/` or `Cmd+K` jump; `f` follow-agent toggle; `?` shows the cheat sheet;
  `e` cycle edge kinds; `m` minimap; `g d` decision log.
- **Search / jump:** `Cmd+K` over `MapIndex.search` with "pending questions" and recent nodes grouped at the
  top; selecting a result zooms with the standard staged transition.
- **Follow vs free roam.** Two explicit modes with a visible pill. *Follow* tracks `hud_focus` events and
  auto-zooms on `hud_ask`. Any manual navigation drops to *free roam*; while free roaming, agent presence is
  still drawn, and a `hud_ask` shows a badge plus a toast "agent needs you in Billing > invoices.create
  (press f)". Pressing `f` re-follows with the staged zoom from wherever you are. Re-following never jumps
  instantly; it always animates so the human knows how they got there.
- **Minimap:** a 1:N copy of the layer x lane grid with the viewport rectangle, agent dot and question
  pips; shown only when zoomed in or below 1200px wide. Clicking it is a jump, not a drag.

## 6. Visual language (principles)

- **Layer bands:** full-width horizontal bands, labelled in the left gutter, each with a faint tint from
  `Layer.color`; the tint is the only colour on the idle map.
- **Lane columns:** labelled headers at the top; collapsed lanes become a narrow strip with a rotated label.
- **Node card anatomy:** kind glyph, label, one-line summary, child count, edge count stubs on the four
  sides, decision chips, pending badge. Per kind: page/component = rounded rectangle; route = pill with method;
  service/module = rectangle; table/store = flat cylinder; queue/event = chevron; external = dashed border.
  Shape distinguishes kind so colour stays free for state.
- **Edges per kind:** `calls` solid with arrow; `reads` thin dotted into the store; `writes` solid into the
  store; `emits`/`listens` dashed with a dot at the source; `renders`/`navigates` hairline; `guards` short
  bracket on the route. Lifted edges thicker with a count.
- **Agent presence:** a soft glow on the current node plus a fading trail (last 5 foci) drawn as a thin path;
  the only animated thing on the map. Multiple agents = different glyph, same hue family.
- **Pending question badge:** the single reserved accent hue; a count on the node, on each ancestor
  breadcrumb, and in the header. Answered = chip in neutral.
- **Dark/light:** design tokens on `:root`; both themes keep the same hue budget; the layer tints are
  low-chroma in both.

## 7. Prioritised POC backlog

1. **Stable layer x lane grid with deterministic child ordering.** Without recognition-not-reading, nothing
   else matters.
2. **Three semantic levels with staged, interruptible zoom animation.** Descend/ascend/back is the core loop;
   motion is how the human keeps their place.
3. **`hud_ask` -> auto-zoom plus anchored question card with 1-9 answers and `Other`.** The product moment;
   ship it before any polish elsewhere.
4. **Follow / free-roam modes with the `f` hand-off and toast.** Prevents the HUD from yanking the human around
   and prevents missed questions.
5. **Edge lifting with counts and per-kind styles, imports hidden by default.** Keeps 50-500 nodes legible.
6. **Agent presence glow plus trail from `hud_focus`.** Makes the idle state informative and makes "where" free.
7. **Progressive expansion of the card (reasoning -> files/diff -> transcript) with the map still visible.**
   Turns ten-second answers into deep dives without a context switch.
8. **Decision chips pinned to nodes and a decision log.** Converts the map into a record and supports
   "why did we do it this way" later.
9. **Cmd+K jump and the `?` cheat sheet.** Keyboard-first discoverability, Linear-style.
10. **Latency-to-answer instrumentation.** Measure time-to-answer and expansion rate per question so the
    ten-second goal is a number, not a slogan.
