export const meta = {
  name: 'app-audit',
  description: 'Typed multi-agent app audit: parallel dimension finders, completeness critic, gap-fill wave',
  phases: [
    { title: 'Survey', detail: 'one finder per dimension', model: 'sonnet' },
    { title: 'Critique', detail: 'completeness critic finds missed dimensions' },
    { title: 'Gap-fill', detail: 'finders for missed dimensions', model: 'sonnet' },
  ],
}

// args contract (all assembled by the invoking agent — see SKILL.md):
//   preamble    : string — shared context + rules prepended to every finder prompt
//   dimensions  : [{ key, prompt, model?, effort? }] — one finder each
//   maxGapFill  : number, default 3 — cap on critic-spawned extra finders
//   skipCritic  : boolean, default false
if (!args || !Array.isArray(args.dimensions) || args.dimensions.length === 0) {
  throw new Error('args.dimensions required: [{ key, prompt }]')
}
const PREAMBLE = args.preamble || ''
const MAX_GAP = typeof args.maxGapFill === 'number' ? args.maxGapFill : 3

const FINDINGS_SCHEMA = {
  type: 'object',
  required: ['area', 'findings'],
  properties: {
    area: { type: 'string' },
    findings: {
      type: 'array',
      items: {
        type: 'object',
        required: ['title', 'category', 'impact', 'effort', 'description', 'recommendation'],
        properties: {
          title: { type: 'string', description: 'Short, specific finding title' },
          category: { type: 'string', description: 'kebab-case type, e.g. ux-gap, security, perf, consistency, refactor, a11y, error-handling, data-integrity, polish' },
          impact: { type: 'string', enum: ['high', 'medium', 'low'] },
          effort: { type: 'string', enum: ['S', 'M', 'L'], description: 'S=hours, M=a day-ish slice, L=multi-slice' },
          description: { type: 'string', description: 'What happens today and why it is a problem. Concrete.' },
          recommendation: { type: 'string', description: 'What to change, concretely' },
          files: { type: 'array', items: { type: 'string' }, description: 'Repo-relative paths with line refs where useful' },
          evidence: { type: 'string', description: 'Optional: route + what a screenshot should capture to prove this finding live' },
        },
      },
    },
  },
}

// ---------- Phase 1: Survey ----------
phase('Survey')
const surveyResults = await parallel(
  args.dimensions.map((d) => () =>
    agent(`${PREAMBLE}\n\n${d.prompt}`, {
      label: `survey:${d.key}`,
      phase: 'Survey',
      model: d.model || 'sonnet',
      effort: d.effort,
      schema: FINDINGS_SCHEMA,
    })
  )
)
const collected = surveyResults.filter(Boolean)
const allFindings = collected.flatMap((r) => r.findings.map((f) => ({ ...f, area: r.area })))
log(`Survey complete: ${allFindings.length} findings across ${collected.length}/${args.dimensions.length} dimensions`)

// ---------- Phase 2: Critique ----------
let gapFindings = []
if (!args.skipCritic) {
  phase('Critique')
  const digest = collected
    .map((r) => `## ${r.area}\n${r.findings.map((f) => `- [${f.impact}/${f.category}] ${f.title}`).join('\n')}`)
    .join('\n\n')

  const CRITIC_SCHEMA = {
    type: 'object',
    required: ['missedDimensions'],
    properties: {
      missedDimensions: {
        type: 'array',
        maxItems: MAX_GAP,
        items: {
          type: 'object',
          required: ['key', 'prompt'],
          properties: {
            key: { type: 'string', description: 'short-kebab-key' },
            prompt: { type: 'string', description: 'Complete self-contained finder prompt for this missed dimension' },
          },
        },
      },
    },
  }

  const critique = await agent(
    `${PREAMBLE}\n\nYOU ARE THE COMPLETENESS CRITIC. A panel just audited this codebase. Their finding titles by dimension:\n\n${digest}\n\nIdentify up to ${MAX_GAP} IMPORTANT dimensions or end-to-end journeys that got NO meaningful coverage above and would plausibly yield high-impact findings for this audit's stated goal. Spot-check the codebase to confirm a candidate is real and under-covered before including it. For each, write a COMPLETE self-contained finder prompt (the finder sees only the shared preamble plus your prompt — include which routes/files to inspect and what to evaluate). If coverage is genuinely complete, return an empty array — do not invent filler.`,
    { label: 'completeness-critic', phase: 'Critique', schema: CRITIC_SCHEMA }
  )

  // ---------- Phase 3: Gap-fill ----------
  const missed = (critique && critique.missedDimensions) || []
  if (missed.length) {
    phase('Gap-fill')
    log(`Critic found ${missed.length} missed dimension(s): ${missed.map((m) => m.key).join(', ')}`)
    const gapResults = await parallel(
      missed.map((m) => () =>
        agent(
          `${PREAMBLE}\n\nYOUR DIMENSION (assigned by completeness critic): ${m.key}\n\n${m.prompt}\n\nReturn 4-10 findings. Do not repeat these already-reported findings:\n${digest}`,
          { label: `gapfill:${m.key}`, phase: 'Gap-fill', model: 'sonnet', schema: FINDINGS_SCHEMA }
        )
      )
    )
    gapFindings = gapResults.filter(Boolean).flatMap((r) => r.findings.map((f) => ({ ...f, area: r.area })))
    log(`Gap-fill added ${gapFindings.length} findings`)
  } else {
    log('Critic: coverage complete, no gap-fill needed')
  }
}

const final = [...allFindings, ...gapFindings]
const counts = { high: 0, medium: 0, low: 0 }
for (const f of final) counts[f.impact] = (counts[f.impact] || 0) + 1
log(`Done: ${final.length} findings (${counts.high} high, ${counts.medium} medium, ${counts.low} low)`)
return { totalFindings: final.length, counts, findings: final }
