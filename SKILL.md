---
name: app-audit
description: Runs a typed multi-agent audit of an app (UX, security posture, performance, code health, a11y, data integrity, error resilience, journeys, docs drift, test gaps), consolidates the findings, and builds a LOCAL annotated report — screenshots, current-vs-after examples, and a per-finding comment/triage UI served on a local port whose answers persist to comments.json for the next session to harvest. Each finding also gets an isolated companion chat (headless claude session) that can discuss the finding, rewrite the card live, and record the user's triage answer. Use when the user wants the app reviewed or audited for improvement opportunities ("audit the app", "run an app audit", "review the app for X", "find opportunities and let me comment/annotate/triage them"), or wants to answer/annotate a previous audit report. NOT for reviewing a single diff or PR.
---

# App Audit

Pipeline: pick types → fan out finder agents → capture screenshot evidence → author the report →
serve it locally with comment capture + companion chats → harvest the user's answers.

All paths below are relative to this skill's base directory unless rooted. Runs live in
**`<repo-root>/.reviews/<yyyy-mm-dd>-<slug>/`**. Ensure `.reviews/` is in the project's
`.gitignore` before the first run (reports embed real data and screenshots) — add it if missing.
One run dir per audit:

```
.reviews/2026-07-10-ux/
  findings.json    raw consolidated findings (with cid keys)
  spec.json        screenshot capture spec
  shots/*.jpeg     captured evidence
  meta.json        report header data (+ optional subject-app design tokens)
  content.html     authored sections
  report.html      built page (build-report.mjs output)
  comments.json    the user's answers (written by the server)
  chats/           per-card companion threads
  patches.json     agent-authored live card updates
```

## 1. Scope the run

Read [references/review-types.md](references/review-types.md). If the invocation names types or
an ask ("audit billing for data integrity"), map it to types/dimensions and proceed. If bare,
offer the bundles (full-ux / pre-launch / health) plus the à-la-carte type list — one question,
then go. Create the run dir.

## 1.5 Reconcile prior runs (cross-audit memory)

Before surveying ground any prior run covered, build the cross-run ledger:

```
node <skill-base>/scripts/prior-ledger.mjs <repo-root>/.reviews
```

It joins every prior finding to the user's decision on it. The decisions are commitments —
honor them in the new run:

- **fix-now / batch / spec** — queued for fixing. Add a dedicated `verify-prior` dimension to
  the workflow that checks each against current code: **fixed** → list in a compact, non-answerable
  "Resolved since last audit" strip (wins deserve visibility); **still open** → resurface as a
  card with provenance and the prior decision quoted.
- **later** — re-verify; if still present, carry forward as a normal answerable card with
  provenance. The user re-decides — "later" may have arrived.
- **skip** — respect it. Never resurface as a new finding; re-verify cheaply and list
  skipped-and-still-present items in a one-line-each appendix (so nothing silently vanishes).
  Promote back to a card ONLY if the situation materially changed (worse, or new blast radius) —
  and say why.
- **unanswered / discuss** — carry forward with provenance and any companion-thread context.

Feed the finder preamble a digest of ledger titles+files with: "these are already known — do
not re-report them as new findings; the verify-prior dimension owns their status." Carried
cards keep a `carriedFrom: { run, cid }` field in findings.json so decisions chain across runs,
and render a provenance line (see the markup reference).

## 2. Run the finder workflow

Assemble a shared **preamble** for every finder: a one-paragraph description of the audited app
and its user roles, the repo root path, the READ-ONLY rules (no edits, no dev servers, no
migrations, no db writes), required context reads (the project's pattern/design/architecture
docs, local agent-instruction files), what counts as a finding for this run's goal, "be
concrete: route + file:line or it isn't a finding", and "6–14 findings, quality over quantity,
rank impact honestly".

**Leverage existing architecture.** Every finder's brief includes: before recommending a fix,
search the codebase for an existing pattern/primitive that already solves this class of problem
and NAME it in the recommendation (with a file ref) — the schema's `leverage` field carries it.
Reuse beats invention; a recommendation that quietly rebuilds something the repo already has is
a defect in the audit. When nothing fits, say "none — new architecture needed" and identify
which adjacent pattern should be generalized to support the broader picture. Report cards and
companion chats surface the leverage line so the person deciding sees the reuse path, not just
the problem.

Build `dimensions` from the type library (adapt briefs to the ask; give each a distinct `key`),
then invoke the Workflow tool:

```
Workflow({ scriptPath: "<skill-base>/scripts/workflow.js",
           args: { preamble, dimensions, maxGapFill: 3 } })
```

Finders default to a mid-tier model; leave the critic on the session model. If the Workflow tool
is unavailable in the harness, dispatch each dimension as a parallel subagent (Agent/Task tool)
with the same preamble + brief and collect structured findings manually. On completion, assign
stable `cid`s (`s1-f1` scheme, see the markup reference) and write `findings.json` to the run dir.

## 3. Capture evidence

For findings a screenshot proves (finders suggest targets in their `evidence` field): write
`spec.json` (format documented at the top of [scripts/capture.mjs](scripts/capture.mjs) — the
app's local dev URL, test-account credentials, one entry per shot) and run:

```
node <skill-base>/scripts/capture.mjs <run-dir>
```

Standalone headless Chromium — never the user's browser, never a shared Playwright MCP instance
(it locks). Read each captured image to verify it shows what the finding claims **before** citing
it; retries are cheap (URL params beat click choreography). Wrong evidence is worse than a
diagram — when a shot won't cooperate after a couple of tries, use a flow diagram or mock
instead. Code-only types (data-integrity, test-gaps, docs-drift) usually skip this step entirely.

## 4. Author the report

Read [references/report-markup.md](references/report-markup.md) — it is the full markup contract.
Write `meta.json` + `content.html`: group findings into themed sections, lead with the worst
finding, give every decidable item a `.find[data-cid]` card (the template injects the comment
widget from that attribute), pick evidence per finding (screenshot with pins / current→after
mock / flow diagram / code diff). Synthesis quality is the value — dedupe across finders, merge
overlapping findings, don't ship 85 raw cards when 30 well-grouped ones read better.

**Every card gets a Current → After exhibit — no text-only cards, ever.** Even compact cards
carry at least a two-panel `ba` block (minimal mock, two-row flow, or a short code diff);
prose alone is not a finding card. Ground each exhibit in the actual code (read the cited
files first) — a mock that misquotes the app's real copy is worse than none. When authoring
at volume, fan the exhibit-writing out to parallel agents per section.

**Subject-app fidelity:** if the audited project has a design system (DESIGN.md / tokens),
mocks depicting its UI follow THEIR system — set `meta.json` `"app": { "accent", "accentInk" }`
from their tokens and mirror their real chrome in mock copy/structure (see the skill's
[references/DESIGN.md](references/DESIGN.md)). The report chrome itself always keeps the skill's
own identity.

Build, then verify — Read `report.html` and check every `{{IMG:…}}` resolved (exit code 2 =
missing shots):

```
node <skill-base>/scripts/build-report.mjs <run-dir>        # add --inline for a single shareable file
```

## 5. Serve + hand off

```
node <skill-base>/scripts/serve-report.mjs <run-dir>        # run in background
```

Picks a free port in 4610–4640, binds 127.0.0.1, and prints `AA_URL=…`. Smoke-test before
handing over: GET `/` returns the report, GET `/api/comments` returns JSON. Give the user the
URL and tell them: triage buttons + comment box under every finding, notes box per section,
general notes at the end; answers autosave to `comments.json`; the progress bar tracks coverage,
shows the current theme while scrolling, and "Next unanswered" jumps to what's left; the Theme
button cycles Auto/Light/Dark.

**Discuss = the companion.** Every card has a Discuss thread: the server brokers it to an
isolated headless `claude -p` session (per-card `--resume`, model dropdown pinned to full model
ids, cwd = repo root, read-only tools) that brainstorms with the user, can **rewrite the card
live** via an ```` ```aa-patch ```` block (stored in `patches.json`, restorable), and **saves
the user's triage answer itself** via an ```` ```aa-answer ```` block once their position is
clear — writing `comments.json` with `via: "chat"` and updating the widget in place. Requires
the `claude` CLI on PATH; each thread persists to `chats/<cid>.json`. Main-session context is
never touched.

**Pre-answer mode (make the call, the user reviews).** When the user asks for a first pass
("make the calls and I'll review", "pre-answer these", "you decide, I'll confirm"): author
`suggestions.json` in the run dir — `{ "<cid>": { decision, text, model, ts } }` — for the
targeted cards (default: unanswered only; NEVER overwrite entries in `comments.json`). Calibrate
decisions to the user's prior choices (the ledger shows their style) and write each `text` as
actionable direction naming the leverage path. The report renders these as slate "Claude's call —
review" proposals: pre-filled decision + note, NOT counted as answered until the user saves
(confirming converts it to their answer). At harvest, a suggestion the user never confirmed is
a proposal, not a decision — surface unconfirmed ones separately.

Leave the server running — the user reviews on their own schedule, possibly across sessions.

## Resuming a run (fresh session)

Everything lives in the run dir — a new session needs zero context beyond it. When the user asks
to continue/reopen an audit ("pick the audit back up", "reopen the report", "harvest my answers"):

1. Find the run: `ls <repo-root>/.reviews/` (newest dir, or the one the user names). `comments.json`
   tells you how far triage got; `findings.json` + `content.html` are the full substance.
2. Restart the server (it dies with the session that started it; nothing else does):
   `node <skill-base>/scripts/serve-report.mjs <run-dir>` — hand back the printed URL. Answers,
   companion threads, and card patches all rehydrate from disk; the progress bar picks up where
   it left off.
3. Companion threads resume too: the broker `--resume`s each card's stored CLI session, and falls
   back to a transcript recap automatically if a session id has expired.
4. If the user is done answering, skip the server and go straight to Harvest below.

## 6. Harvest (when the user says they're done — or a later session resumes)

Read `comments.json` and join to `findings.json` by cid (`sec:*` keys are section-level notes,
`_general` the global box; `via: "chat"` entries were distilled by the card's companion).
Skim `chats/*.json` for threads with substance beyond their saved answer, and `patches.json`
for cards whose content evolved — the patched card, not the original finding, is the agreed
shape. Summarize decisions by bucket — fix-now / batch / spec / later / skip / discuss —
surface every `discuss` item plus contradictions (e.g. "skip" on a security finding) back to
the user, then feed the buckets into the project's normal planning flow: fix-now items straight
to work, spec items into proper design/spec work. Then stop the server.

## Rules

- **Local only.** Never publish audit findings to an external service or hosted artifact — file
  paths, schema details, and security posture stay on the user's machine. `--inline` exists for
  sharing a single file by hand.
- Finders are read-only; the audit changes nothing. Fixes are separate, normal-workflow work.
- Security-boundary findings route through the project's own security review process (tests at
  the enforcement layer, independent adversarial review) — an audit finding is never a license
  to hot-fix the boundary.
- `.reviews/` must stay gitignored; reports embed real data and screenshots.
- Old runs are cheap context: check for a prior `.reviews/*/comments.json` with unharvested
  answers before starting a new run on the same ground.
