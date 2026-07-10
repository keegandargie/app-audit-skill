# Report markup contract (content.html)

`content.html` holds only the `<section>` blocks — `build-report.mjs` wraps it in the template
(`assets/report-template.html`), which supplies the page shell, styles, auto-built TOC, progress
bar, and the comment/triage widgets. The template JS injects a triage+comment widget into every
`.find[data-cid]` and a notes box into every `section[data-cid]` — never hand-write comment UI.

## IDs — the comment keys (get these right)

- Every `<section>` gets `data-cid="s1"`, `"s2"`, … (`"s0"` for an urgent band). Stable, unique.
- Every finding card gets `data-cid="s1-f1"`, `"s1-f2"`, … These keys are how the user's answers in
  `comments.json` map back to findings — also store the same ids on each finding in `findings.json`
  (add a `cid` field when consolidating) so harvest is a join, not guesswork.
- "Also in this theme" rows that need answers should be promoted to compact `.find` cards instead —
  only `.find[data-cid]` elements get widgets and count toward progress.

## Section skeleton

```html
<section data-cid="s1">                     <!-- add class="urgent-band" for the urgent section -->
  <div class="sechead"><span class="secnum">01</span><h2>Theme title</h2><span class="seccount">7 findings</span></div>
  <p class="secsum">One-line summary of the theme.</p>
  <div class="find" data-cid="s1-f1"> … </div>
  <div class="also"> … non-answerable context only … </div>
</section>
```

## Finding card

```html
<div class="find" data-cid="s1-f1">          <!-- class="find urgent" for the headline regression -->
  <div class="chips">
    <span class="chip hi">High</span>        <!-- hi | md | lo -->
    <span class="chip eff">Effort S</span>
    <span class="chip cat">ux-gap</span>
  </div>
  <h3>Title stating the defect from the user's side</h3>
  <p class="where">/route · src/path/file.tsx:123</p>
  <p>1–3 sentences: what happens today, why it matters. Concrete.</p>
  <!-- evidence and/or current→after blocks here -->
</div>
```

## Evidence figure (screenshots)

```html
<figure class="shot">
  <div class="imgwrap"><img src="{{IMG:shot-name}}" alt="…">
    <div class="pin" style="left:31%;top:2%;width:8.5%;height:4.5%"><span class="tag">1</span></div>
  </div>
  <figcaption><b>Live screenshot</b> — what to look at; reference pins as <b>1 ·</b> …</figcaption>
</figure>
```
`{{IMG:name}}` resolves to `shots/name.jpeg` (or a data URI with `--inline`). Pin coordinates are
percentages of the image box — read the screenshot first and estimate from what you see.

## Current → After fix — REQUIRED on every finding card

```html
<div class="ba">
  <div class="panel cur"><div class="phead">Current</div><div class="pbody"> … </div></div>
  <div class="panel aft"><div class="phead">After fix</div><div class="pbody"> … </div></div>
</div>
```
Every `.find` card ships one of these (or an equivalent screenshot-anchored exhibit) — a card
that is only prose is not done. Panel bodies take mock UI, flow diagrams, `<ul>` bullets, or
`<pre>` code — pick per finding:
screenshots prove *current*; mocks show *after*; flows explain multi-step behavior; code diffs suit
one-liner fixes.

**Mock UI** (dialogs, rows, pills, fields, toasts):
```html
<div class="mock">
  <div class="mtitle">Dialog title</div><div class="mtext">Body copy.</div>
  <div class="mnote warn">Callout (warn | bad | good).</div>
  <div class="mbtnrow"><span class="mbtn">Cancel</span><span class="mbtn primary">Confirm</span></div>
</div>
<div class="mock">
  <div class="mrow"><div class="rl"><b>Row title</b><span>subtitle</span></div><span class="pill red">Needs attention</span></div>
</div>
<div class="mfield"><label>Amount</label><div class="inp err">&nbsp;</div><div class="ferr">Inline error</div></div>
<div class="toast"><span class="dot ok"></span>Saved</div>
```
Pills: `green | amber | red | grey`. Buttons: `mbtn`, `mbtn primary`, `mbtn danger`.

**Flow diagram**:
```html
<div class="flow">
  <span class="flabel">Optional row label</span>
  <span class="fbox">Step</span><span class="farr">→</span>
  <span class="fbox bad">Failure outcome</span>
  <span class="fbox good">Fixed outcome</span>
  <span class="fbox dim">de-emphasized</span>
</div>
```

**Code diff**: `<pre><code>` with `<span class="del">`, `<span class="add">`, `<span class="cmt">`.

## Non-answerable context ("also" list)

```html
<div class="also">
  <div class="alabel">Also in this theme</div>
  <div class="arow"><span class="adot md"></span><span><b>Title</b> <span class="d">— one-liner.</span></span><span class="e">S</span></div>
</div>
```
Use sparingly (see IDs note above): anything the user should *decide on* belongs in a `.find`.

## meta.json

```json
{
  "title": "MMC UX Audit — Jul 10",
  "eyebrow": "Make More Creative · internal review · July 10, 2026",
  "lede": "One-paragraph framing of scope and how to read the page.",
  "stats": [
    { "value": "85", "label": "findings" },
    { "value": "28", "label": "high", "tone": "hi" },
    { "value": "41", "label": "medium", "tone": "md" },
    { "value": "16", "label": "low", "tone": "lo" }
  ]
}
```

> **Design identity:** [DESIGN.md](DESIGN.md) defines the report's visual system (moss = interaction, slate = companion, oxide/ochre = severity). Compose patches and new content from the classes here — never inline styles (except `.pin` coordinates) or new colors.
