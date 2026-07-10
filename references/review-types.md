# Review-type library

Each type defines finder dimensions for `scripts/workflow.js`. Compose the final prompt per
dimension as: shared preamble (SKILL.md §2) + the dimension brief below, adapted to the run's
focus. Dimensions are starting points — drop ones that don't fit the ask, add ones the user
names. Every finder is READ-ONLY (no edits, no dev servers, no migrations, no db writes).

## Bundles (offer these when the invocation doesn't name types)

- **full-ux** — `ux` (all 11 dimensions). The broad "improve user experience" sweep.
- **pre-launch** — `security-posture` + `data-integrity` + `error-resilience` + `test-gaps`.
- **health** — `code-health` + `performance` + `docs-drift`.
- Or any à-la-carte combination; 4–12 total dimensions is the sweet spot per run.

---

## ux — user experience (11 dimensions)

The broad user-experience sweep. Dimensions (adapt the surface names to the audited app's roles):

1. **primary-role-section** — walk every surface the app's primary external users see: landing,
   core approval/consumption flows, findability, comprehension, jargon leaks, dead ends.
2. **power-user-workspace** — the internal/power user's daily driver: context switching, the core
   object flow, editor/inspector reachability, wasted clicks, state lost on navigation, bulk-work pain.
3. **admin-section** — account/org management step counts, integration connect/failure feedback,
   debugging surfaces, places an admin must guess, surfaces that silently fail.
4. **navigation-ia** — orientation (where am I: scope/section/entity), context preservation on
   switches, parallel-structure consistency, deep-linkability, back-button behavior, state dumped on nav.
5. **loading-perf** — loading-state coverage vs pages that fetch, skeleton fidelity against the
   project's loading conventions (if documented), sequential-await waterfalls, per-row queries,
   client-bundle creep. Rank by how slow it FEELS.
6. **mutations-feedback** — every write: thrown-vs-returned errors (production error masking),
   silent saves, missing pending/disabled states, optimistic coverage inconsistency, confirms on
   wrong actions, late validation.
7. **empty-error-states** — first-run/zero-data guidance, error/not-found boundary coverage,
   unconfigured-subsystem notices, overflow/long-content, edge rows.
8. **consistency-twins** — diff every twin surface pair (role A vs role B views of the same
   entity, panel vs page, glance vs full): same fields, actions, labels, formatting? Which twin
   wins; share or sync?
9. **a11y-responsive** — see `a11y` type below; run as one dimension inside ux.
10. **realtime-staleness** — live vs stale surface map, user cost of staleness (acting on stale
    state, decide-races), autosave feedback, polling hacks.
11. **component-health** — see `code-health`; scoped to UX payoff (twin drift, safe-to-polish).

## security-posture — app-layer & configuration security review

NOT a pentest and NOT the enforcement boundary itself (tests at that layer own it — e.g. RLS
policies tested in the database). Read-only posture review of the application layer:

1. **action-authz** — every server action/endpoint: auth/role check present and correct before
   any write? Input validated? Client-supplied ids scoped to the caller's tenant?
2. **dead-privileged-surface** — exported actions/RPCs with zero UI callers but live grants;
   over-wide policies relative to the UI's actual needs; admin bypasses leaking into non-admin paths.
3. **secret-handling** — secrets in client bundles, logged secrets, env vars read client-side,
   integration tokens surfaced to the wrong role.
4. **outbound-effects** — every real-world side effect (email/social sends, payments, publishes):
   what arms it, idempotency, and what a compromised or confused client-side caller could trigger.

Safety: findings that touch the enforcement boundary (policies, privileged functions, grants)
are *routed*, not fixed here — they go through the project's security review process with tests
at the enforcement layer, and sensitive fixes get independent adversarial verification.

## performance — perceived + actual speed

1. **route-waterfalls** — sequential awaits in page/query code, missing parallelization, per-row
   fetch patterns, redundant reads across a page's sections.
2. **unbounded-reads** — queries with no limit on monotonically-growing tables, full-table scans
   to find one row, signed-URL fan-outs, payloads that grow with account age.
3. **loading-ux** — loading-state coverage + skeleton fidelity; the click-to-first-paint feel per route.
4. **client-bundle** — client-component creep, heavy deps on light pages, unmemoized hot lists.

## code-health — refactors that pay rent

1. **fat-components** — largest files, hook/module-extraction discipline vs the project's own
   documented doctrine, state towers, mixed concerns that make polish risky.
2. **duplication-drift** — copy-paste twins kept in sync by hand, re-implemented primitives that
   already exist in the shared UI layer, N independent versions of one state machine or tone system.
3. **dead-code** — orphaned exports/components/routes still shipped; stale placeholders
   contradicting shipped features.
4. **pattern-violations** — deviations from the project's documented patterns (pattern docs,
   local agent-instruction files, where present) that will confuse the next builder.

## a11y — accessibility & responsive

1. **keyboard** — every drag/hover/context-menu interaction: keyboard path exists? Focus trapped
   and restored on close (esp. custom non-library panels)? Documented fallbacks actually work?
2. **semantics** — icon-only buttons without labels, placeholder-as-label, color-only signals,
   heading structure.
3. **visual** — focus-ring coverage vs the design system's promise, contrast in both themes,
   reduced-motion honored.
4. **responsive** — core flows at narrow widths; the one flow each role would do from a phone.

## data-integrity — writes that strand or destroy state

1. **cascade-audit** — every FK's on-delete action vs the table's stated purpose (audit tables
   that cascade away, cascades that eat user content silently, set-nulls that orphan meaning).
2. **soft-vs-hard-delete** — which user content gets archive+undo vs one-click permanent delete;
   confirms that don't disclose blast radius; usage checks that exist but aren't consulted.
3. **write-path-races** — multi-step writes that can strand rows on failure (precondition after
   durable write), idempotency of retryable effects, timezone/day-boundary math.

## error-resilience — failure UX

1. **throw-vs-return** — server actions throwing user-actionable failures (masked in production)
   instead of returning error data; availability preflights missing before durable writes.
2. **failure-surfaces** — terminal states with no retry affordance, swallowed errors (logged
   only), generic toasts hiding actionable causes.
3. **boundaries** — error/not-found boundary coverage; what a crash actually renders per shell.

## journeys — end-to-end role walkthroughs

One dimension per journey; the finder *traces the full path through code*, listing every screen,
email, and state change, flagging gaps/dead-ends/wrong copy at each step. Typical journeys:
- new customer: invite → sign-up → confirm → first login → first core action
- power user's monday: open app → triage across contexts → move work → hand off
- admin: create account → add members → connect integrations → first invoice
- a rejection loop: submit → request changes → revise → resubmit → approve → fulfill

## docs-drift — the context system vs reality

1. **agent-doc-audit** — every local agent-instruction/pattern doc claim vs current code (stale
   behavior descriptions are how regressions hide).
2. **spec-drift** — recent specs vs what actually shipped.

## test-gaps — enforcement-boundary coverage

1. **policy-coverage** — diff every enforcement-layer rule (e.g. RLS policies, privileged
   functions, grants) against the test suite: which lack a both-directions test (allow AND
   deny)? Read-only inventory; fixes route through the project's security process. Adapt this
   type to the project's stack — the shape (rule inventory vs test inventory) is the constant.
