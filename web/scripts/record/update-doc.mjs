#!/usr/bin/env node
/**
 * Update one journey in the progress vault's 主文档.md after a recording.
 *
 *   node scripts/record/update-doc.mjs --doc <主文档.md> --journey 07 --status 走得通 \
 *     --video recordings/07-ask/2026-10-10-1.mp4 [--issues "……"] [--now "……"] [--dry-run]
 *
 * Touches only:
 *   - the journey's section (### 07 ...): its 状态 line, its 录屏 line (an Obsidian embed ![[...]] that plays in
 *     Obsidian, plus a normal markdown link for GitHub) and, with --issues, its 已知问题 line ("" -> —);
 *   - the journey's row in the 一览 table: the 状态 and 最新录屏 cells (a markdown link);
 *   - with --now, the 现在做到哪 line at the top.
 * Every other byte stays as it was (line endings included). Prints { doc, journey, changed: [{ line, before, after }] }.
 *
 * Statuses (规则.md): 没开始 / 在做 / 走得通 / 有问题. 走得通 needs a recording (given here or already on the 录屏 line):
 * only a journey whose recording script passed every check is 走得通. --video is the path relative to the doc's
 * folder (the mp4 should already be there; a missing file is a warning). --dry-run prints the changes, writes nothing.
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

const STATUSES = ["没开始", "在做", "走得通", "有问题"];
const NONE = "—";

function die(msg) {
  process.stderr.write(`update-doc: ${msg}\n`);
  process.exit(2);
}

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith("--")) die(`unexpected argument ${a}`);
    const eq = a.indexOf("=");
    if (eq > 0) out[a.slice(2, eq)] = a.slice(eq + 1);
    else if (a === "--dry-run" || a === "--help") out[a.slice(2)] = true;
    else {
      if (i + 1 >= argv.length) die(`${a} needs a value`);
      out[a.slice(2)] = argv[++i];
    }
  }
  return out;
}

const args = parseArgs(process.argv.slice(2));
if (args.help) {
  process.stderr.write('usage: node scripts/record/update-doc.mjs --doc <主文档.md> --journey 07 [--status 走得通] [--video recordings/07-ask/2026-10-10-1.mp4] [--issues "..."] [--now "..."] [--dry-run]\n');
  process.exit(0);
}
if (!args.doc) die("--doc is required");
if (!args.journey) die("--journey is required");
const id = String(args.journey).padStart(2, "0");
if (!/^\d{2}$/.test(id)) die(`--journey must be a number like 07, got ${args.journey}`);
if (args.status !== undefined && !STATUSES.includes(args.status)) die(`--status must be one of ${STATUSES.join(" / ")}, got ${args.status}`);
if ([args.status, args.video, args.issues, args.now].every((v) => v === undefined)) die("nothing to change: give --status, --video, --issues or --now");

let video = null;
if (args.video !== undefined) {
  video = String(args.video).replace(/\\/g, "/").replace(/^\.\//, "");
  if (!video || path.isAbsolute(video) || /^[a-z]:/i.test(video) || video.startsWith("/")) die(`--video must be relative to the doc's folder (recordings/<编号>-<短名>/<file>.mp4), got ${args.video}`);
  if (/[[\]|]/.test(video)) die(`--video may not contain [ ] or |: ${video}`);
}
const oneLine = (s) =>
  String(s)
    .split(/\r?\n/)
    .map((x) => x.trim())
    .filter(Boolean)
    .join("；");
const issues = args.issues === undefined ? undefined : oneLine(args.issues) || NONE;
const now = args.now === undefined ? undefined : oneLine(args.now);
if (now === "") die("--now is empty");

const docPath = path.resolve(args.doc);
const raw = readFileSync(docPath);
let text = raw.toString("utf8");
const bom = text.startsWith("﻿");
if (bom) text = text.slice(1);
// split on \n only: a \r (CRLF file) stays at the end of its line and is put back on any line we rewrite
const lines = text.split("\n");
const body = (l) => (l.endsWith("\r") ? l.slice(0, -1) : l);
const eol = (l) => (l.endsWith("\r") ? "\r" : "");
const changed = [];
function set(i, next) {
  const before = lines[i];
  const after = next + eol(before);
  if (after === before) return;
  lines[i] = after;
  changed.push({ line: i + 1, before: body(before), after: next });
}

const encodeLink = (p) => encodeURI(p).replace(/\(/g, "%28").replace(/\)/g, "%29");
const base = video ? path.posix.basename(video) : null;

// --- the journey's section: ### <id> ... up to the next heading or rule
const head = lines.findIndex((l) => new RegExp(`^###\\s+${id}(\\s|$)`).test(body(l)));
if (head < 0) die(`no section "### ${id} ..." in ${docPath}`);
let end = lines.length;
for (let i = head + 1; i < lines.length; i++) {
  if (/^(#{1,6}\s|---\s*$)/.test(body(lines[i]))) {
    end = i;
    break;
  }
}
const field = (label) => {
  for (let i = head + 1; i < end; i++) {
    const m = new RegExp(`^${label}([：:])\\s*(.*)$`).exec(body(lines[i]));
    if (m) return { i, sep: m[1], value: m[2] };
  }
  return null;
};
const statusLine = field("状态");
const videoLine = field("录屏");
const issuesLine = field("已知问题");
if (!statusLine) die(`section ${id} has no 状态 line`);
if (!videoLine) die(`section ${id} has no 录屏 line`);
if (issues !== undefined && !issuesLine) die(`section ${id} has no 已知问题 line`);
const hasVideo = !!video || (videoLine.value.trim() !== "" && videoLine.value.trim() !== NONE);
if (args.status === "走得通" && !hasVideo) die(`journey ${id}: 走得通 needs a recording (--video); only a journey whose recording passed is 走得通`);

if (args.status !== undefined) set(statusLine.i, `状态${statusLine.sep}${args.status}`);
if (video) set(videoLine.i, `录屏${videoLine.sep}![[${video}]] [${base}](${encodeLink(video)})`);
if (issues !== undefined) set(issuesLine.i, `已知问题${issuesLine.sep}${issues}`);

// --- the 一览 table row: | <id> | 路 | 状态 | 最新录屏 |
const cells = (l) => body(l).split("|");
const headerAt = lines.findIndex((l) => /^\|.*编号.*\|.*状态.*\|/.test(body(l)));
if (headerAt < 0) die("no 一览 table (header row with 编号 and 状态)");
const names = cells(lines[headerAt]).map((c) => c.trim());
const statusCol = names.indexOf("状态");
const videoCol = names.indexOf("最新录屏");
if (statusCol < 0 || videoCol < 0) die("the 一览 table needs 状态 and 最新录屏 columns");
let row = -1;
for (let i = headerAt + 1; i < lines.length && body(lines[i]).startsWith("|"); i++) {
  if (cells(lines[i])[1]?.trim() === id) {
    row = i;
    break;
  }
}
if (row < 0) die(`no row for ${id} in the 一览 table`);
const parts = cells(lines[row]);
const cell = (k, value) => {
  const old = parts[k];
  const lead = /^\s*/.exec(old)[0] || " ";
  const trail = /\s*$/.exec(old)[0] || " ";
  parts[k] = `${lead}${value}${trail}`;
};
if (args.status !== undefined) cell(statusCol, args.status);
if (video) cell(videoCol, `[${base.replace(/\.mp4$/i, "")}](${encodeLink(video)})`);
set(row, parts.join("|"));

// --- 现在做到哪
if (now !== undefined) {
  const at = lines.findIndex((l) => /^\*\*现在做到哪\*\*[：:]/.test(body(l)));
  if (at < 0) die("no **现在做到哪** line");
  const sep = /^\*\*现在做到哪\*\*([：:])/.exec(body(lines[at]))[1];
  set(at, `**现在做到哪**${sep}${now}`);
}

const warnings = [];
if (video && !existsSync(path.join(path.dirname(docPath), ...video.split("/")))) warnings.push(`${video} is not in ${path.dirname(docPath)} yet: copy the mp4 there before pushing`);
if (!args["dry-run"] && changed.length) writeFileSync(docPath, (bom ? "﻿" : "") + lines.join("\n"));
for (const w of warnings) process.stderr.write(`update-doc: warning: ${w}\n`);
process.stdout.write(`${JSON.stringify({ doc: docPath.replace(/\\/g, "/"), journey: id, written: !args["dry-run"] && changed.length > 0, changed, warnings }, null, 1)}\n`);
