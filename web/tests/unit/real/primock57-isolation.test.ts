/**
 * Item 4, acceptance 4: the PriMock57 recordings appear only in the "try it with a real recording" demo and are not
 * mixed into Mr Tan's story.
 *
 * Mr Tan's story is the seeded timeline (fixtures/timeline.seed.json through lib/story), its four visits and their
 * replay lines (fixtures/visits, read through lib/asr/fixtures), the stand-in clips, the label images, the knowledge
 * base the safety layer quotes from (kb/), the daily check-ins (lib/daily), the eval cases (eval/seed.jsonl) and the
 * dialogue script (docs/plan/visits-script.md, when present). None of them may name the dataset, point at the local
 * audio folder, use a consultation id, carry a dataset file (same sha256) or share an 8-word run of words with a
 * PriMock57 utterance. The demo's own code is free to use the dataset; the LLM cassettes are shared by every request
 * and are not story data, so they are not scanned.
 *
 * The same holds for what pages are built from (app/, components/, lib/, public/): outside an explicit allowlist
 * (the demo and its credit line, from part 2) no source file names the dataset, carries a dataset file or shares an
 * 8-word run with an utterance. That is a source-level check; the rendered-page e2e comes with the demo.
 *
 * The word-run checks need the downloaded transcripts in web/.data/real/primock57 and are skipped without them
 * (run `node scripts/data/fetch_primock57.mjs` in web/); everything else runs on a fresh clone.
 */
import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { fixtureUtterances } from "@/lib/asr/fixtures";
import { buildSeedTables, loadTemplate } from "@/lib/story/seed";
import { LOCAL_ROOT_REL, MANIFEST_REL } from "@/scripts/data/fetch_primock57.mjs";

// These tests hash and scan every served file: give them room when several builds share the machine (they timed out at 5 s).
vi.setConfig({ testTimeout: 30_000 });

const WEB = process.cwd();
const MANIFEST = JSON.parse(readFileSync(path.join(WEB, ...MANIFEST_REL.split("/")), "utf8")) as {
  consultations: { id: string; files: { role: string; path: string; sha256: string }[] }[];
};
const LOCAL_ROOT = path.join(WEB, ...LOCAL_ROOT_REL.split("/"));

/** Story surfaces, relative to web/ (a directory is walked; a missing optional path is skipped). */
const STORY_PATHS = [
  "fixtures/timeline.seed.json",
  "fixtures/visits",
  "fixtures/labels",
  "kb",
  "lib/story",
  "lib/daily",
  "eval/seed.jsonl",
];
const OPTIONAL_STORY_PATHS = ["../docs/plan/visits-script.md"];

/** Names, paths and ids that only the dataset tooling and the demo should use. */
const MARKERS: { name: string; re: RegExp }[] = [
  { name: "dataset name", re: /primock/i },
  { name: "dataset creator", re: /babylon\s*health|babylonhealth/i },
  { name: "local audio folder", re: /\.data[\\/]+real/i },
  { name: "consultation id", re: /day[1-5]_consultation\d{2}/i },
];

const TEXT_EXT = /\.(json|jsonl|md|txt|ts|tsx|mjs|js|py|csv|ya?ml)$/i;

function walk(abs: string): string[] {
  const st = statSync(abs);
  if (!st.isDirectory()) return [abs];
  return readdirSync(abs).flatMap((name) => walk(path.join(abs, name)));
}

function storyFiles(): string[] {
  const out: string[] = [];
  for (const rel of STORY_PATHS) {
    const abs = path.join(WEB, ...rel.split("/"));
    expect(existsSync(abs), `story path ${rel} is missing; update this test if the story moved`).toBe(true);
    out.push(...walk(abs));
  }
  for (const rel of OPTIONAL_STORY_PATHS) {
    const abs = path.resolve(WEB, rel);
    if (existsSync(abs)) out.push(...walk(abs));
  }
  return out;
}

function markerHits(label: string, text: string): string[] {
  const hits: string[] = [];
  text.split(/\r?\n/).forEach((line, i) => {
    for (const m of MARKERS) if (m.re.test(line)) hits.push(`${label}:${i + 1}: ${m.name}: ${line.trim().slice(0, 120)}`);
  });
  return hits;
}

/** Lower-case words (letters, digits, apostrophes). */
function words(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[‘’ʼ]/g, "'")
    .replace(/[^\p{L}\p{N}']+/gu, " ")
    .split(" ")
    .map((w) => w.replace(/^'+|'+$/g, ""))
    .filter(Boolean);
}

const RUN = 8;
function runsOf(text: string): string[] {
  const w = words(text);
  const out: string[] = [];
  for (let i = 0; i + RUN <= w.length; i++) out.push(w.slice(i, i + RUN).join(" "));
  return out;
}

/** Every string inside a JSON value. */
function strings(v: unknown, out: string[] = []): string[] {
  if (typeof v === "string") out.push(v);
  else if (Array.isArray(v)) for (const x of v) strings(x, out);
  else if (v && typeof v === "object") for (const x of Object.values(v)) strings(x, out);
  return out;
}

const NOW = "2026-10-09T00:00:00.000Z";
const seededVisits = () => buildSeedTables("isolation-check", NOW).visits;

describe("PriMock57 stays out of Mr Tan's story (item 4, acceptance 4)", () => {
  it("no story file names the dataset, its creator, the local audio folder or a consultation id", () => {
    const files = storyFiles().filter((f) => TEXT_EXT.test(f));
    expect(files.length).toBeGreaterThan(10);
    const hits = files.flatMap((f) => markerHits(path.relative(WEB, f).replace(/\\/g, "/"), readFileSync(f, "utf8")));
    expect(hits).toEqual([]);
  });

  it("no story file is a dataset file (sha256 against every file in the manifest, audio and derived)", () => {
    const datasetHashes = new Set(MANIFEST.consultations.flatMap((c) => c.files.map((f) => f.sha256)));
    expect(datasetHashes.size).toBeGreaterThanOrEqual(MANIFEST.consultations.length * 7);
    const same = storyFiles()
      .filter((f) => datasetHashes.has(createHash("sha256").update(readFileSync(f)).digest("hex")))
      .map((f) => path.relative(WEB, f));
    expect(same).toEqual([]);
  });

  it("the seeded story has only its own four visits, and every replay line and seeded row is free of dataset markers", () => {
    const visits = seededVisits();
    expect(visits.map((v) => v.id).sort()).toEqual(["p1", "v1", "v2", "v3"]);
    const datasetIds = new Set(MANIFEST.consultations.map((c) => c.id));
    const hits: string[] = [];
    for (const v of visits) {
      expect(datasetIds.has(v.id)).toBe(false);
      const lines = fixtureUtterances(v.id);
      expect(lines, `visit ${v.id} has no replay file`).not.toBeNull();
      for (const u of lines ?? []) hits.push(...markerHits(`${v.id}/${u.id}`, `${u.id}\n${u.text}`));
    }
    const tables = buildSeedTables("isolation-check", NOW);
    hits.push(...markerHits("seed tables", JSON.stringify(tables, null, 1)));
    hits.push(...markerHits("template", JSON.stringify(loadTemplate(), null, 1)));
    expect(hits).toEqual([]);
  });

  it("the checks catch a planted mention and a planted sentence", () => {
    expect(markerHits("x", 'audio: ".data/real/primock57/mixed/day3_consultation08.wav"').length).toBeGreaterThanOrEqual(3);
    expect(markerHits("x", "Source: PriMock57 (Babylon Health)").length).toBe(2);
    expect(markerHits("x", "Take one tablet of amlodipine every morning.")).toEqual([]);
    const a = new Set(runsOf("Okay so what I'd like you to do is take the inhaler twice a day, please."));
    const b = runsOf("Doctor: so what I'd like you to do is take the inhaler twice a day");
    expect(b.some((r) => a.has(r))).toBe(true);
    expect(runsOf("Take one tablet every morning").length).toBe(0); // fewer than 8 words: no run
  });
});

const uttFiles = MANIFEST.consultations.flatMap((c) => c.files.filter((f) => f.role === "utterances").map((f) => path.join(LOCAL_ROOT, ...f.path.split("/"))));
const haveTranscripts = uttFiles.length > 0 && uttFiles.every((f) => existsSync(f));

describe(`no PriMock57 sentence in the story (needs ${LOCAL_ROOT_REL}; skipped when absent)`, () => {
  it.skipIf(!haveTranscripts)("no story text shares an 8-word run with any PriMock57 utterance", () => {
    const dataset = new Set<string>();
    let utterances = 0;
    for (const f of uttFiles) {
      const json = JSON.parse(readFileSync(f, "utf8")) as { utterances: { text: string }[] };
      for (const u of json.utterances) {
        utterances++;
        for (const r of runsOf(u.text)) dataset.add(r);
      }
    }
    expect(utterances).toBeGreaterThan(100);
    expect(dataset.size).toBeGreaterThan(1000);

    const texts: { label: string; text: string }[] = [];
    for (const f of storyFiles().filter((x) => TEXT_EXT.test(x))) {
      const rel = path.relative(WEB, f).replace(/\\/g, "/");
      const raw = readFileSync(f, "utf8");
      if (/\.json$/i.test(f)) {
        for (const s of strings(JSON.parse(raw))) texts.push({ label: rel, text: s });
      } else if (/\.jsonl$/i.test(f)) {
        raw.split(/\r?\n/).filter((l) => l.trim()).forEach((l, i) => {
          for (const s of strings(JSON.parse(l))) texts.push({ label: `${rel}:${i + 1}`, text: s });
        });
      } else {
        raw.split(/\r?\n/).forEach((l, i) => texts.push({ label: `${rel}:${i + 1}`, text: l }));
      }
    }
    for (const v of seededVisits()) for (const u of fixtureUtterances(v.id) ?? []) texts.push({ label: `replay ${v.id}/${u.id}`, text: u.text });
    for (const s of strings(buildSeedTables("isolation-check", NOW))) texts.push({ label: "seed tables", text: s });
    expect(texts.length).toBeGreaterThan(200);

    const shared = texts.flatMap(({ label, text }) => runsOf(text).filter((r) => dataset.has(r)).map((r) => `${label}: "${r}"`));
    expect(shared).toEqual([]);
  });
});

// ---------------------------------------------------------------------------------------------------------------
// What pages are built from. Acceptance 4 also says the recordings appear only in the demo, so nothing a page is
// rendered or served from may carry the dataset outside the demo and its credit line. This is the source-level
// check: route and component code, the lib modules they render from, and public/ (served byte for byte). It does not
// load a page; the rendered-page check is an e2e that comes with the demo (part 2).
//
// Part 2 adds to SERVED_ALLOW, each with a reason: the demo's route and modules, and the two places that show
// the credit line (/how through lib/how/trust.ts, and the crew page). Nothing else should need an entry.

const SERVED_PATHS = ["app", "components", "lib", "public"];
/** web/-relative file, or a folder ending in "/", that may name the dataset. */
const SERVED_ALLOW: Record<string, string> = {
  "lib/asr/wer.ts": "doc comment names PriMock57 as the later WER target; no dataset content",
  // B3, part 2: the demo itself. Its page shows only Whisper's transcript of the chosen recording and the credit line;
  // nothing here is rendered into Mr Tan's pages (the e2e e2e/real-demo.spec.ts opens them after a run and checks).
  "lib/asr/real-demo.ts": "the real-recording demo's module: reads the chosen consultation from the local audio folder per the committed manifest; no dataset text in the source",
  "app/api/real/": "the demo's API (GET credit and consultations, POST a run, GET / DELETE a run): names the dataset in doc comments and its fetch script in an error",
  "app/backstage/real/": "the demo page (/backstage/real, linked from /how): names the dataset in its doc comment and the fetch command; the credit line comes from the manifest",
  "lib/how/real-recording.ts": "the /how entry for the demo: imports the credit line from the manifest (its path names the dataset); no other dataset content",
};
const SERVED_TEXT_EXT = /\.(json|jsonl|md|txt|ts|tsx|mts|cts|mjs|cjs|js|jsx|css|html|svg|xml|csv|ya?ml|webmanifest)$/i;

function servedFiles(): { abs: string; rel: string }[] {
  return SERVED_PATHS.flatMap((dir) => {
    const abs = path.join(WEB, dir);
    return existsSync(abs) ? walk(abs) : [];
  }).map((abs) => ({ abs, rel: path.relative(WEB, abs).replace(/\\/g, "/") }));
}

function allowed(rel: string): boolean {
  return Object.keys(SERVED_ALLOW).some((a) => (a.endsWith("/") ? rel.startsWith(a) : rel === a));
}

/** Texts to scan: every string of a JSON file, otherwise each line and the whole file (a sentence split over lines). */
function textsOf(rel: string, raw: string): { label: string; text: string }[] {
  if (/\.json$/i.test(rel)) {
    try {
      return strings(JSON.parse(raw)).map((s) => ({ label: rel, text: s }));
    } catch {
      /* not strict JSON (e.g. tsconfig-style comments): scan as text */
    }
  }
  return [...raw.split(/\r?\n/).map((l, i) => ({ label: `${rel}:${i + 1}`, text: l })), { label: rel, text: raw }];
}

describe("PriMock57 stays off every page outside the demo (item 4, acceptance 4, source level)", () => {
  it("the allowlist is explicit: every entry exists under a served folder and gives a reason", () => {
    for (const [entry, reason] of Object.entries(SERVED_ALLOW)) {
      expect(SERVED_PATHS.some((d) => entry.startsWith(`${d}/`)), `${entry} is under ${SERVED_PATHS.join(", ")}`).toBe(true);
      expect(existsSync(path.join(WEB, ...entry.split("/").filter(Boolean))), `${entry} exists; drop stale entries`).toBe(true);
      expect(reason.length, `${entry} has a reason`).toBeGreaterThan(10);
    }
  });

  it("no route, component, lib module or public file names the dataset, its creator, the local audio folder or a consultation id", () => {
    const files = servedFiles().filter((f) => SERVED_TEXT_EXT.test(f.rel));
    expect(files.length).toBeGreaterThan(100);
    const hits = files.filter((f) => !allowed(f.rel)).flatMap((f) => markerHits(f.rel, readFileSync(f.abs, "utf8")));
    expect(hits).toEqual([]);
  });

  it("no served file is a dataset file, allowlisted or not (sha256 against every file in the manifest)", () => {
    const datasetHashes = new Set(MANIFEST.consultations.flatMap((c) => c.files.map((f) => f.sha256)));
    const same = servedFiles()
      .filter((f) => datasetHashes.has(createHash("sha256").update(readFileSync(f.abs)).digest("hex")))
      .map((f) => f.rel);
    expect(same).toEqual([]);
  });

  it("the helpers: the allowlist only opens what it names, and a sentence split over source lines is still seen", () => {
    expect(allowed("lib/asr/wer.ts")).toBe(true);
    expect(allowed("lib/asr/wer.test.ts")).toBe(false);
    expect(allowed("lib/asr/wer.tsx")).toBe(false);
    expect(allowed("app/p/today/page.tsx")).toBe(false);
    const planted = new Set(runsOf("Okay so what I'd like you to do is take the inhaler twice a day, please."));
    const split = textsOf("components/x.tsx", "const s =\n  \"so what I'd like you to do\" +\n  \" is take the inhaler twice a day\";");
    expect(split.some(({ text }) => runsOf(text).some((r) => planted.has(r)))).toBe(true);
    expect(textsOf("lib/x.json", '{"a":["one","two"],"b":{"c":"three"}}').map((t) => t.text)).toEqual(["one", "two", "three"]);
    expect(textsOf("lib/x.json", "{ // not strict JSON\n}").length).toBe(3); // two lines + whole file
  });
});

describe(`no PriMock57 sentence on any page outside the demo (needs ${LOCAL_ROOT_REL}; skipped when absent)`, () => {
  it.skipIf(!haveTranscripts)("no served text outside the allowlist shares an 8-word run with any PriMock57 utterance", () => {
    const dataset = new Set<string>();
    for (const f of uttFiles) {
      const json = JSON.parse(readFileSync(f, "utf8")) as { utterances: { text: string }[] };
      for (const u of json.utterances) for (const r of runsOf(u.text)) dataset.add(r);
    }
    expect(dataset.size).toBeGreaterThan(1000);
    const files = servedFiles().filter((f) => SERVED_TEXT_EXT.test(f.rel) && !allowed(f.rel));
    expect(files.length).toBeGreaterThan(100);
    const shared = new Set<string>();
    for (const f of files) {
      for (const { label, text } of textsOf(f.rel, readFileSync(f.abs, "utf8"))) {
        for (const r of runsOf(text)) if (dataset.has(r)) shared.add(`${label}: "${r}"`);
      }
    }
    expect([...shared]).toEqual([]);
  }, 30_000); // scans every served file; give it room when several builds share the machine
});
