# app-audit — design identity

The audit report's own visual system. It is NOT the host app's design system — the report is a
**surveyor's field report**: a long reading-and-deciding document. Mood: *graphite ink, one
measured moss green, decisions as stamps.* Companion agents patching cards MUST stay inside this
system — reuse the classes in `report-markup.md`, never invent colors or inline styles (the only
sanctioned inline styles are `.pin` coordinates).

## Palette (OKLCH — these exact tokens live in the template)

| role | light | dark | use |
|---|---|---|---|
| `--bg` | `oklch(1 0 0)` | `oklch(0.135 0 0)` | page. Pure — mood lives in ink+moss, not surface tint |
| `--surface` | `oklch(0.972 0.004 130)` | `oklch(0.185 0.006 130)` | widget zone, code, mocks |
| `--ink` | `oklch(0.22 0.015 130)` | `oklch(0.93 0.004 130)` | body text (≥7:1 on bg) |
| `--muted` | `oklch(0.46 0.02 130)` | `oklch(0.68 0.012 130)` | secondary text (≥4.5:1) |
| `--line` | `oklch(0.90 0.006 130)` | `oklch(0.27 0.006 130)` | hairlines |
| `--moss` (primary) | `oklch(0.50 0.135 132)` | `oklch(0.74 0.13 132)` | ALL interaction: buttons, links, focus, selection, progress, answered stamp. Text on moss fill: white in light theme, near-black in dark |
| `--slate` (accent) | `oklch(0.30 0.04 255)` | `oklch(0.78 0.05 255)` | the COMPANION's identity only — chat chrome, agent bubbles, model chip. Never for user actions |
| severity `--hi` | `oklch(0.50 0.19 25)` | `oklch(0.72 0.16 25)` | oxide red — high impact, urgent, "current" |
| severity `--md` | `oklch(0.53 0.115 78)` | `oklch(0.76 0.11 80)` | ochre — medium impact, warnings |
| severity `--lo` | = muted | = muted | low impact |

Severity is data, moss is interaction, slate is the agent. Never cross those roles: a button is
never oxide unless it destroys something; the companion never speaks in moss.

## Type

- **Sans** `system-ui, "Segoe UI", sans-serif` — headings, UI controls, labels, chat. Scale 1.125:
  h1 27/650, h2 20/650, h3 16.5/620, ui 13.5, small 12.5.
- **Serif** `Charter, "Bitstream Charter", Cambria, Georgia, serif` — finding prose only
  (`.find > p`, `.secsum`, `figcaption`, panel body text). 15.5px/1.65. This is the report voice.
- **Mono** `"Cascadia Code", ui-monospace, Consolas, monospace` — `.where`, code, effort marks,
  counts. 12px.
- No webfonts, no display faces. `text-wrap: balance` on headings.

## Structure vocabulary

- **Findings are ledger entries, not cards**: hairline top rule, generous whitespace, no box,
  no shadow. Header row = severity dot + impact word + effort mono + title. Answered state = a
  moss `✓ answered` stamp in the entry header, not a border color.
- **Exhibits** (screenshots, current/after panels, mocks, flows, code) ARE boxed — 1px line,
  8px radius. The document is flat; evidence is framed.
- **Current/After** panel heads: normal-case 12px semibold with a severity dot (oxide/moss).
  Never uppercase-tracked.
- **Decision strip** (injected widget): one segmented control (6 segments), selected = moss fill;
  note field + Save beneath; Discuss toggle on the right. Compact — it repeats 60+ times.
- **Companion chat**: slate hairline frame; agent bubbles slate-tinted with 11px model tag; user
  bubbles moss-tinted right-aligned; header strip slate text on surface.
- No numbered section eyebrows, no uppercase tracked labels, no side-stripe borders, no gradient
  text, no big-number stat tiles. Stats render as one quiet mono ledger line.

## Motion

150–200ms, ease-out (cubic-bezier(0.22,1,0.36,1)). Only state: segment select, chat expand,
stamp scale-in (180ms), progress fill width. Full `prefers-reduced-motion` fallbacks. Nothing
animates on page load.

## Subject-app fidelity — the one rule that overrides this identity

Exhibits depict the AUDITED app; the report chrome is ours. When the audited project has its own
design system (a DESIGN.md, tokens file, or committed brand colors), mock UI inside exhibits
follows **their** system, not this one: set `meta.json` → `"app": { "accent": "…", "accentInk": "…" }`
from their tokens (the template exposes it as `--app-accent`, and `.mbtn.primary` picks it up
automatically), and write mock copy/labels/structure to mirror their real chrome so mocks sit
believably next to live screenshots. Everything AROUND the exhibits — entries, decision strip,
chat, severity — stays on this identity. When the project has no design system, mocks default
to moss.

## Structure notes

- The urgent band is the only filled section header (oxide tint) — urgency is a different class
  of thing, not just "more high". Regular severity words render in ink; only the dot is colored.
- The progress rail shows the current theme name + its progress while scrolling (sticky context).
- Theme control: Auto → Light → Dark cycle in the rail, persisted per browser (`aa-theme`).

## For companion patches (aa-patch)

1. Read `report-markup.md` for the class contract; compose ONLY from those classes.
2. Severity semantics: `.chip.hi/.md/.lo`, `.pill.red/.amber/.green/.grey`, `.mnote bad/warn/good`,
   `.fbox bad/good/dim` — pick by meaning, not by which color "looks nice".
3. Keep `<img>` tags byte-identical. No `<style>`, no `<script>`, no inline `style=` except `.pin`.
4. Prose stays in `<p>` (it sets itself in serif); UI copy in mocks stays short and sans.
