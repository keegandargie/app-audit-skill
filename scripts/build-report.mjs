#!/usr/bin/env node
// Merges authored report content into the template and resolves image references.
//   node build-report.mjs <run-dir> [--inline]
// Inputs (in run dir):
//   content.html — authored sections (see SKILL.md for markup contract)
//   meta.json    — { title, eyebrow, lede, stats: [{label, value, tone?}] }
//   shots/*.jpeg — screenshots referenced as {{IMG:name}} in content.html
// Output:
//   report.html  — served by serve-report.mjs. Default: <img src="shots/x.jpeg"> (small file).
//   --inline     : embed images as data URIs (single portable file).

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const runDir = path.resolve(process.argv[2] || ".");
const inline = process.argv.includes("--inline");
const skillDir = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const templatePath = path.join(skillDir, "assets", "report-template.html");

const content = fs.readFileSync(path.join(runDir, "content.html"), "utf8");
const meta = JSON.parse(fs.readFileSync(path.join(runDir, "meta.json"), "utf8"));
let html = fs.readFileSync(templatePath, "utf8");

const stats = (meta.stats || [])
  .map((s) => `<span class="stat"><b${s.tone ? ` class="${s.tone}"` : ""}>${s.value}</b> ${s.label}</span>`)
  .join("\n    ");

// Subject-app fidelity: when the audited project has a design system, meta.json
// carries its accent so mock UI inside exhibits renders like THEIR app.
//   "app": { "accent": "#0066EB", "accentInk": "#ffffff" }
const appTokens = meta.app && meta.app.accent
  ? `<style>:root{--app-accent:${meta.app.accent};--app-accent-ink:${meta.app.accentInk || "#ffffff"}}</style>`
  : "";

html = html
  .split("{{TITLE}}").join(meta.title || "App Audit")
  .split("{{EYEBROW}}").join(meta.eyebrow || "")
  .split("{{LEDE}}").join(meta.lede || "")
  .split("{{STATS}}").join(stats)
  .split("{{APP_TOKENS}}").join(appTokens)
  .split("{{CONTENT}}").join(content);

const missing = [];
html = html.replace(/\{\{IMG:([a-zA-Z0-9_-]+)\}\}/g, (_, name) => {
  const rel = `shots/${name}.jpeg`;
  const p = path.join(runDir, rel);
  if (!fs.existsSync(p)) { missing.push(name); return rel; }
  if (!inline) return rel;
  return "data:image/jpeg;base64," + fs.readFileSync(p).toString("base64");
});

const out = path.join(runDir, "report.html");
fs.writeFileSync(out, html);
console.log(`wrote ${out} (${(html.length / 1024).toFixed(0)} KB${inline ? ", images inlined" : ""})`);
if (missing.length) {
  console.error(`WARNING missing screenshots: ${missing.join(", ")}`);
  process.exitCode = 2;
}
