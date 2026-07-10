#!/usr/bin/env node
// Builds the cross-run ledger: every finding from every prior run, joined to the
// user's triage decision for it. Consumed by the next audit's reconciliation step.
//   node prior-ledger.mjs <reviews-root> [--json]
// Output: <reviews-root>/prior-ledger.json + a compact digest on stdout.
//
// Ledger entry: { run, cid, title, impact, files, decision, comment, decidedAt, via }
//   decision null = the user never answered that card (unharvested).

import fs from "node:fs";
import path from "node:path";

const root = path.resolve(process.argv[2] || ".reviews");
if (!fs.existsSync(root)) { console.error(`no reviews root at ${root}`); process.exit(1); }

const runs = fs.readdirSync(root)
  .filter((d) => !d.startsWith(".") && fs.existsSync(path.join(root, d, "findings.json")))
  .sort();

const ledger = [];
for (const run of runs) {
  const dir = path.join(root, run);
  let findings, comments = {}, content = "";
  try { findings = JSON.parse(fs.readFileSync(path.join(dir, "findings.json"), "utf8")); } catch { continue; }
  try { comments = JSON.parse(fs.readFileSync(path.join(dir, "comments.json"), "utf8")); } catch {}
  try { content = fs.readFileSync(path.join(dir, "content.html"), "utf8"); } catch {}

  // Prefer the report's cards (they're the deduped, user-facing unit with cids);
  // fall back to raw findings when no content.html exists.
  if (content) {
    const re = /<div class="find( urgent)?" data-cid="([^"]+)">/g;
    const marks = [];
    let m;
    while ((m = re.exec(content))) marks.push({ cid: m[2], start: m.index });
    marks.forEach((mk, i) => {
      const end = i + 1 < marks.length ? marks[i + 1].start : content.length;
      const seg = content.slice(mk.start, end);
      const title = (seg.match(/<h3>([\s\S]*?)<\/h3>/) || [, ""])[1].replace(/<[^>]+>/g, "").trim();
      const where = (seg.match(/<p class="where">([\s\S]*?)<\/p>/) || [, ""])[1].replace(/<[^>]+>/g, "").trim();
      const impact = (seg.match(/class="chip (hi|md|lo)"/) || [, "md"])[1];
      const c = comments[mk.cid] || null;
      ledger.push({
        run, cid: mk.cid, title, impact,
        files: where || null,
        decision: c?.decision ?? null,
        comment: c?.text || null,
        decidedAt: c?.ts || null,
        via: c?.via || (c ? "widget" : null),
      });
    });
  } else {
    const list = Array.isArray(findings) ? findings : findings.findings || [];
    list.forEach((f, i) => {
      const cid = f.cid || `raw-${i}`;
      const c = comments[cid] || null;
      ledger.push({
        run, cid, title: f.title, impact: (f.impact || "medium").slice(0, 2) === "hi" ? "hi" : f.impact === "low" ? "lo" : "md",
        files: (f.files || []).join(" · ") || null,
        decision: c?.decision ?? null, comment: c?.text || null, decidedAt: c?.ts || null, via: c?.via || (c ? "widget" : null),
      });
    });
  }
}

const out = path.join(root, "prior-ledger.json");
fs.writeFileSync(out, JSON.stringify(ledger, null, 1));

const byDecision = {};
for (const e of ledger) {
  const k = e.decision || "unanswered";
  byDecision[k] = (byDecision[k] || 0) + 1;
}
console.log(`wrote ${out} — ${ledger.length} entries across ${runs.length} run(s)`);
console.log("by decision:", JSON.stringify(byDecision));
