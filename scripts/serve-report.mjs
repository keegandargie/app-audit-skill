#!/usr/bin/env node
// Serves an app-audit run directory locally, persists reviewer comments, and
// brokers per-finding "mini chat" threads to isolated headless `claude -p`
// sessions (each card = its own CLI session with read-only repo tools; the
// main audit conversation's context is never touched).
//   node serve-report.mjs <run-dir> [--port N]
// Routes:
//   GET  /                → report.html
//   GET  /api/comments    → comments.json ({} if absent)
//   POST /api/comments    → upsert { id, decision, text } keyed by id, atomic write
//   GET  /api/chat/<cid>  → thread from chats/<cid>.json
//   POST /api/chat/<cid>  → { message, model?, context? } → runs one agent turn, returns { reply }
//   GET  /<path>          → static file from the run dir (shots/, etc.)
// Prints AA_URL=http://localhost:<port> on stdout when listening. Binds 127.0.0.1 only.

import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const skillDir = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const REF = (f) => path.join(skillDir, "references", f);

const args = process.argv.slice(2);
const runDir = path.resolve(args[0] || ".");
const portFlag = args.indexOf("--port");
const fixedPort = portFlag !== -1 ? Number(args[portFlag + 1]) : null;

if (!fs.existsSync(runDir) || !fs.statSync(runDir).isDirectory()) {
  console.error(`run dir not found: ${runDir}`);
  process.exit(1);
}
const commentsPath = path.join(runDir, "comments.json");

const MIME = {
  ".html": "text/html; charset=utf-8", ".json": "application/json",
  ".jpeg": "image/jpeg", ".jpg": "image/jpeg", ".png": "image/png",
  ".svg": "image/svg+xml", ".css": "text/css", ".js": "text/javascript",
  ".gif": "image/gif", ".webp": "image/webp", ".txt": "text/plain; charset=utf-8",
};

function readComments() {
  try { return JSON.parse(fs.readFileSync(commentsPath, "utf8")); } catch { return {}; }
}
function writeComments(obj) {
  const tmp = commentsPath + ".tmp";
  fs.writeFileSync(tmp, JSON.stringify(obj, null, 2));
  fs.renameSync(tmp, commentsPath);
}

// ---------- mini-chat broker (per-card headless claude sessions) ----------
const chatsDir = path.join(runDir, "chats");
const repoRoot = process.env.AA_REPO_ROOT || path.resolve(runDir, "..", "..");
// Full model ids — aliases drift (repo memory: "sonnet" once resolved to 4.6).
const MODELS = new Set([
  "claude-fable-5", "claude-opus-4-8", "claude-sonnet-5", "claude-haiku-4-5-20251001",
  "sonnet", "opus", "haiku", // still accepted if a client sends an alias
]);
const DEFAULT_MODEL = "claude-sonnet-5";
const busy = new Set();
const patchesPath = path.join(runDir, "patches.json");

function readPatches() {
  try { return JSON.parse(fs.readFileSync(patchesPath, "utf8")); } catch { return {}; }
}
function writePatches(obj) {
  fs.writeFileSync(patchesPath + ".tmp", JSON.stringify(obj, null, 2));
  fs.renameSync(patchesPath + ".tmp", patchesPath);
}

function chatFile(cid) { return path.join(chatsDir, cid.replace(/[^a-zA-Z0-9_:.-]/g, "_") + ".json"); }
function readChat(cid) {
  try { return JSON.parse(fs.readFileSync(chatFile(cid), "utf8")); }
  catch { return { context: null, sessionId: null, messages: [] }; }
}
function writeChat(cid, data) {
  fs.mkdirSync(chatsDir, { recursive: true });
  const p = chatFile(cid);
  fs.writeFileSync(p + ".tmp", JSON.stringify(data, null, 2));
  fs.renameSync(p + ".tmp", p);
}

function firstTurnPrompt(context, message, canPatch) {
  const answerRules = [
    "",
    "YOUR REAL JOB — brainstorm-and-answer companion. Each card carries a triage question (fix-now / batch / spec / later / skip / discuss) plus a comment for the engineer who will act on it. Talk the finding through with the user, check the code when it sharpens the answer, and converge on THEIR call — you refine, they decide. When their position is clear, or they tell you to save, record it with exactly one fenced block:",
    "```aa-answer",
    '{"decision": "fix-now|batch|spec|later|skip|discuss", "text": "the distilled answer in the user\'s voice — their call, constraints, and direction for whoever implements it"}',
    "```",
    "Write the text as the user's own note: decision-first, specific, carrying anything they said that changes how the fix should be done. Confirm before saving unless they've stated their decision explicitly. Re-save whenever they change their mind — it overwrites. The card UI updates the moment you save." + (canPatch ? "" : " (This is a notes-only thread: omit \"decision\" or set it null.)"),
  ];
  const patchRules = canPatch ? [
    "",
    "BRAINSTORMING-COMPANION MODE — you can UPDATE THE CARD the user is viewing. When they ask you to change it (revise the after-fix mock, add a variant, correct the recommendation, sketch an alternative), include exactly one fenced block anywhere in your reply:",
    "```aa-patch",
    "<the card's complete replacement inner HTML>",
    "```",
    `Patch rules: the block replaces everything inside the card div (the report injects its own widgets — never include them). Keep the chips/h3/.where structure. Before your first patch, Read BOTH ${REF("report-markup.md")} (the class vocabulary: mocks, flow diagrams, current/after panels, pills) AND ${REF("DESIGN.md")} (the report's design identity — semantic color roles, what each class means; compose only from existing classes, no inline style= except .pin coordinates). Mock UI inside exhibits depicts the AUDITED app, not the report: when the audited project has its own design system (DESIGN.md/tokens in the repo), mirror its real chrome, copy, and conventions in mocks — primary buttons already inherit the app's accent via --app-accent. Keep any <img> tags exactly as they are. No <script>, no <style>. Outside the block, reply briefly with what you changed. Patch only when asked, or when showing a concrete alternative beats describing it. Each turn also carries the card's CURRENT html so you always edit the latest state.`,
  ] : [];
  return [
    "You are discussing ONE finding from a local app-audit report with the project lead, inside a small chat widget on that finding's card. Your working directory is the repo the finding is about.",
    "Ground rules: be concise — chat replies, not essays. Use your read-only tools (Read/Grep/Glob) to check the actual code before asserting anything about it. When proposing a fix or alternative, FIRST look for an existing pattern/primitive in this repo that already solves the problem class and name it (file ref) — reuse beats invention; only propose new architecture when nothing fits, and say so explicitly. Do NOT edit repo files; this thread is for talking a finding through.",
    ...answerRules,
    ...patchRules,
    "",
    "FINDING (from the report card):",
    '"""',
    (context || "(no card context provided)").slice(0, 6000),
    '"""',
    "",
    "USER: " + message,
  ].join("\n");
}

function withCardHtml(message, cardHtml) {
  if (!cardHtml) return message;
  return message + "\n\n[CARD HTML RIGHT NOW — patch against this]\n```html\n" + cardHtml.slice(0, 16000) + "\n```";
}

const DECISIONS = new Set(["fix-now", "batch", "spec", "later", "skip", "discuss"]);
function extractAnswer(text) {
  const m = text.match(/```aa-answer\s*\n([\s\S]*?)```/);
  if (!m) return { text, answer: null };
  const stripped = (text.slice(0, m.index) + text.slice(m.index + m[0].length)).trim();
  try {
    const a = JSON.parse(m[1]);
    const decision = DECISIONS.has(a.decision) ? a.decision : null;
    const note = typeof a.text === "string" ? a.text.trim() : "";
    if (!decision && !note) return { text: stripped, answer: null };
    return { text: stripped || "(answer recorded)", answer: { decision, text: note } };
  } catch { return { text: stripped, answer: null }; }
}

function extractPatch(text) {
  const m = text.match(/```aa-patch\s*\n([\s\S]*?)```/);
  if (!m) return { reply: text, patch: null };
  const html = m[1].trim();
  const reply = (text.slice(0, m.index) + text.slice(m.index + m[0].length)).trim();
  if (/<\s*(script|style)\b/i.test(html)) {
    return { reply: reply + "\n\n(Proposed card update was rejected: script/style tags are not allowed.)", patch: null };
  }
  return { reply: reply || "(card updated)", patch: html };
}

function runClaudeTurn(prompt, model, extraArgs = []) {
  return new Promise((resolve, reject) => {
    const args = ["-p", "--output-format", "json", "--model", model,
      "--allowedTools", "Read,Grep,Glob", "--max-turns", "25", ...extraArgs];
    const child = spawn("claude", args, { cwd: repoRoot, shell: process.platform === "win32", windowsHide: true });
    let out = "", err = "";
    const timer = setTimeout(() => { child.kill(); reject(new Error("agent turn timed out (240s)")); }, 240_000);
    child.stdout.on("data", (d) => (out += d));
    child.stderr.on("data", (d) => (err += d));
    child.on("error", (e) => { clearTimeout(timer); reject(e); });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (!out.trim()) return reject(new Error((err.trim() || `claude exited ${code}`).slice(0, 400)));
      try {
        const j = JSON.parse(out);
        resolve({ text: j.result ?? "", sessionId: j.session_id || null });
      } catch { resolve({ text: out.trim(), sessionId: null }); }
    });
    child.stdin.write(prompt);
    child.stdin.end();
  });
}

async function chatTurn(cid, message, model, context, cardHtml) {
  const chat = readChat(cid);
  if (context && !chat.context) chat.context = context;
  chat.messages.push({ role: "user", text: message, ts: new Date().toISOString() });
  const canPatch = !cid.startsWith("sec:") && cid !== "_general";
  const wrapped = canPatch ? withCardHtml(message, cardHtml) : message;
  let turn;
  if (chat.sessionId) {
    try {
      turn = await runClaudeTurn(wrapped, model, ["--resume", chat.sessionId]);
    } catch {
      // resume expired/broken — start fresh with a recap of the thread
      const recap = chat.messages.slice(0, -1).map((m) => `${m.role.toUpperCase()}: ${m.text}`).join("\n\n");
      turn = await runClaudeTurn(
        firstTurnPrompt(chat.context, wrapped, canPatch) + (recap ? `\n\n(Earlier in this thread:\n${recap})` : ""), model);
    }
  } else {
    turn = await runClaudeTurn(firstTurnPrompt(chat.context, wrapped, canPatch), model);
  }
  if (turn.sessionId) chat.sessionId = turn.sessionId;
  const { reply: afterPatch, patch } = canPatch ? extractPatch(turn.text) : { reply: turn.text, patch: null };
  const { text: reply, answer } = extractAnswer(afterPatch);
  if (patch) {
    const patches = readPatches();
    patches[cid] = {
      html: patch,
      original: patches[cid]?.original ?? cardHtml ?? null,
      model, ts: new Date().toISOString(),
    };
    writePatches(patches);
  }
  let savedAnswer = null;
  if (answer) {
    savedAnswer = { decision: answer.decision, text: answer.text, ts: new Date().toISOString(), via: "chat", model };
    const all = readComments();
    all[cid] = savedAnswer;
    writeComments(all);
  }
  chat.messages.push({ role: "assistant", text: reply, model, patched: !!patch, answered: !!answer, ts: new Date().toISOString() });
  writeChat(cid, chat);
  return { reply, patch, answer: savedAnswer };
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url, "http://localhost");

  if (url.pathname.startsWith("/api/chat/")) {
    const cid = decodeURIComponent(url.pathname.slice("/api/chat/".length));
    if (!cid || cid.includes("/")) { res.writeHead(400); return res.end(); }
    if (req.method === "GET") {
      res.writeHead(200, { "content-type": "application/json" });
      return res.end(JSON.stringify(readChat(cid)));
    }
    if (req.method === "POST") {
      let body = "";
      req.on("data", (c) => { body += c; if (body.length > 1_000_000) req.destroy(); });
      req.on("end", async () => {
        try {
          const { message, model: rawModel, context, cardHtml } = JSON.parse(body);
          if (!message || typeof message !== "string") throw new Error("message required");
          const model = MODELS.has(rawModel) ? rawModel : DEFAULT_MODEL;
          if (busy.has(cid)) {
            res.writeHead(409, { "content-type": "application/json" });
            return res.end(JSON.stringify({ error: "a reply is already in flight for this thread" }));
          }
          busy.add(cid);
          try {
            const out = await chatTurn(cid, message.trim(), model,
              typeof context === "string" ? context : null,
              typeof cardHtml === "string" ? cardHtml : null);
            res.writeHead(200, { "content-type": "application/json" });
            res.end(JSON.stringify(out));
          } finally { busy.delete(cid); }
        } catch (e) {
          res.writeHead(500, { "content-type": "application/json" });
          res.end(JSON.stringify({ error: String(e.message || e).slice(0, 400) }));
        }
      });
      return;
    }
    res.writeHead(405); return res.end();
  }

  if (url.pathname.startsWith("/api/patches")) {
    const cid = decodeURIComponent(url.pathname.slice("/api/patches".length).replace(/^\//, ""));
    if (req.method === "GET" && !cid) {
      res.writeHead(200, { "content-type": "application/json" });
      return res.end(JSON.stringify(readPatches()));
    }
    if (req.method === "DELETE" && cid) {
      const patches = readPatches();
      const entry = patches[cid];
      if (!entry) { res.writeHead(404); return res.end("{}"); }
      delete patches[cid];
      writePatches(patches);
      res.writeHead(200, { "content-type": "application/json" });
      return res.end(JSON.stringify({ original: entry.original }));
    }
    res.writeHead(405); return res.end();
  }

  if (url.pathname === "/api/suggestions" && req.method === "GET") {
    let sugg = {};
    try { sugg = JSON.parse(fs.readFileSync(path.join(runDir, "suggestions.json"), "utf8")); } catch {}
    res.writeHead(200, { "content-type": "application/json" });
    return res.end(JSON.stringify(sugg));
  }

  if (url.pathname === "/api/comments") {
    if (req.method === "GET") {
      res.writeHead(200, { "content-type": "application/json" });
      return res.end(JSON.stringify(readComments()));
    }
    if (req.method === "POST") {
      let body = "";
      req.on("data", (c) => { body += c; if (body.length > 1_000_000) req.destroy(); });
      req.on("end", () => {
        try {
          const { id, decision, text } = JSON.parse(body);
          if (!id || typeof id !== "string") throw new Error("id required");
          const all = readComments();
          all[id] = { decision: decision ?? null, text: text ?? "", ts: new Date().toISOString() };
          writeComments(all);
          res.writeHead(200, { "content-type": "application/json" });
          res.end(JSON.stringify({ ok: true }));
        } catch (e) {
          res.writeHead(400, { "content-type": "application/json" });
          res.end(JSON.stringify({ error: String(e.message || e) }));
        }
      });
      return;
    }
    res.writeHead(405); return res.end();
  }

  // static
  const rel = url.pathname === "/" ? "report.html" : decodeURIComponent(url.pathname.slice(1));
  const file = path.resolve(runDir, rel);
  if (!file.startsWith(runDir)) { res.writeHead(403); return res.end("forbidden"); }
  fs.readFile(file, (err, data) => {
    if (err) { res.writeHead(404); return res.end("not found"); }
    res.writeHead(200, { "content-type": MIME[path.extname(file).toLowerCase()] || "application/octet-stream" });
    res.end(data);
  });
});

function listen(port, maxPort) {
  server.once("error", (err) => {
    if (err.code === "EADDRINUSE" && port < maxPort) listen(port + 1, maxPort);
    else { console.error(err.message); process.exit(1); }
  });
  server.listen(port, "127.0.0.1", () => {
    console.log(`AA_URL=http://localhost:${port}`);
    console.log(`serving ${runDir}`);
    console.log(`comments  → ${commentsPath}`);
    console.log(`chats     → ${chatsDir}\\<cid>.json  (agent cwd: ${repoRoot})`);
  });
}
listen(fixedPort ?? 4610, fixedPort ?? 4640);
