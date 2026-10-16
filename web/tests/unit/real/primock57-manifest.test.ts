/**
 * fixtures/real/primock57.manifest.json and fixtures/real/PRIMOCK57-ATTRIBUTION.md (item 4 of the overnight loop):
 * the committed manifest is well-formed and pinned to one commit, every source URL points at that commit, the
 * licence is CC BY 4.0, the mixing never clipped, the totals add up, no audio sits in the repository, and the
 * attribution names title, creator, source, licence and the changes for exactly the consultations in the manifest.
 *
 * The downloaded files live in web/.data/real/primock57 (gitignored). When that folder exists, every file is checked
 * against the manifest (size + sha256) and the derived files are read back; on a fresh clone without it those checks
 * are skipped (run `node scripts/data/fetch_primock57.mjs` in web/ to get the files).
 */
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import {
  ATTRIBUTION_REL,
  CHANGES,
  CREDIT,
  DEFAULT_IDS,
  LICENCE,
  LOCAL_ROOT_REL,
  MANIFEST_REL,
  MEDIA_BASE,
  RAW_BASE,
  REPO_URL,
  parseWav,
  verifyLocal,
} from "@/scripts/data/fetch_primock57.mjs";

const WEB = process.cwd();
const MANIFEST_PATH = path.join(WEB, ...MANIFEST_REL.split("/"));
const ATTRIBUTION_PATH = path.join(WEB, ...ATTRIBUTION_REL.split("/"));
const LOCAL_ROOT = path.join(WEB, ...LOCAL_ROOT_REL.split("/"));

const HEX40 = /^[0-9a-f]{40}$/;
const HEX64 = /^[0-9a-f]{64}$/;
const ROLES = ["audio_doctor", "audio_patient", "transcript_doctor", "transcript_patient", "note", "audio_mixed", "utterances"] as const;

const AudioSchema = z
  .object({
    sample_rate: z.literal(16000),
    channels: z.number().int().min(1).max(2),
    bits_per_sample: z.literal(16),
    duration_s: z.number().positive(),
    channel_used: z.number().int().min(0).max(1).optional(),
  })
  .strict();

const FileSchema = z
  .object({
    role: z.enum(ROLES),
    path: z.string().regex(/^(audio|transcripts|notes|mixed)\/[a-z0-9_]+(\.wav|\.TextGrid|\.json|\.utterances\.json)$/),
    bytes: z.number().int().positive(),
    sha256: z.string().regex(HEX64),
    derived: z.literal(true).optional(),
    derived_from: z.array(z.enum(ROLES)).min(1).optional(),
    source: z
      .object({
        path: z.string().min(1),
        url: z.string().startsWith("https://"),
        lfs_oid: z.string().regex(/^sha256:[0-9a-f]{64}$/).optional(),
        git_blob_sha1: z.string().regex(HEX40).optional(),
      })
      .strict()
      .optional(),
    audio: AudioSchema.optional(),
  })
  .strict();

const ConsultationSchema = z
  .object({
    id: z.string().regex(/^day[1-5]_consultation(0[1-9]|1[0-5])$/),
    day: z.number().int().min(1).max(5),
    consultation: z.number().int().min(1).max(15),
    presenting_complaint: z.string().min(1).max(160),
    why_selected: z.string().min(1),
    duration_s: z.number().positive(),
    mix: z
      .object({
        gain: z.number().positive().max(1),
        peak_in: z.number().int().nonnegative(),
        peak_out: z.number().int().nonnegative().max(32767),
        clipped_samples: z.literal(0),
        padded_samples: z.object({ doctor: z.number().int().nonnegative(), patient: z.number().int().nonnegative() }).strict(),
      })
      .strict(),
    utterances: z.object({ doctor: z.number().int().positive(), patient: z.number().int().positive() }).strict(),
    files: z.array(FileSchema).length(ROLES.length),
  })
  .strict();

const ManifestSchema = z
  .object({
    schema: z.literal("ripple/real-dataset-manifest@1"),
    dataset: z
      .object({
        name: z.literal("PriMock57"),
        title: z.literal("PriMock57: A Dataset Of Primary Care Mock Consultations"),
        creator: z.literal("Babylon Health"),
        authors: z.array(z.string().min(1)).min(1),
        year: z.literal(2022),
        venue: z.string().min(1),
        paper: z.literal("https://arxiv.org/abs/2204.00333"),
        related_paper: z.literal("https://arxiv.org/abs/2204.00447"),
        repository: z.literal("https://github.com/babylonhealth/primock57"),
        nature: z.string().regex(/Not real patient data\./),
        ref: z.string().min(1),
        commit: z.string().regex(HEX40),
      })
      .strict(),
    licence: z
      .object({
        id: z.literal("CC-BY-4.0"),
        name: z.literal("Creative Commons Attribution 4.0 International"),
        url: z.literal("https://creativecommons.org/licenses/by/4.0/"),
        legalcode: z.literal("https://creativecommons.org/licenses/by/4.0/legalcode"),
        dataset_licence_file: z.string(),
      })
      .strict(),
    credit: z
      .object({
        short_citation: z.literal("Papadopoulos Korfiatis et al., 2022"),
        source_url: z.literal("https://github.com/babylonhealth/primock57"),
        licence_name: z.literal("CC BY 4.0"),
        licence_url: z.literal("https://creativecommons.org/licenses/by/4.0/"),
        en: z.string().min(1).max(400),
        zh: z.string().min(1).max(400),
      })
      .strict(),
    attribution_file: z.literal(ATTRIBUTION_REL),
    generator: z.literal("scripts/data/fetch_primock57.mjs"),
    local_root: z.literal(LOCAL_ROOT_REL),
    audio_in_repo: z.literal(false),
    retrieved_on: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    changes: z.array(z.string().min(1)).min(1),
    consultations: z.array(ConsultationSchema).min(1),
    totals: z
      .object({
        consultations: z.number().int(),
        files: z.number().int(),
        source_files: z.number().int(),
        source_bytes: z.number().int(),
        source_audio_bytes: z.number().int(),
        derived_files: z.number().int(),
        derived_bytes: z.number().int(),
        bytes_on_disk: z.number().int(),
      })
      .strict(),
  })
  .strict();

type Manifest = z.infer<typeof ManifestSchema>;

function loadManifest(): Manifest {
  // UTF-8 without BOM: JSON.parse would choke on a BOM anyway, but say so plainly
  const raw = readFileSync(MANIFEST_PATH);
  expect(raw[0] === 0xef && raw[1] === 0xbb && raw[2] === 0xbf, "manifest starts with a BOM").toBe(false);
  return ManifestSchema.parse(JSON.parse(raw.toString("utf8")));
}

describe("fixtures/real/primock57.manifest.json", () => {
  it("is well-formed: schema, CC BY 4.0, pinned commit, five consultations on five different days", () => {
    const m = loadManifest();
    expect(m.licence.url).toBe(LICENCE.url);
    expect(m.licence.dataset_licence_file).toBe(`${REPO_URL}/blob/${m.dataset.commit}/LICENSE.md`);
    expect(m.changes).toEqual([...CHANGES]);
    expect(m.consultations.map((c) => c.id)).toEqual([...DEFAULT_IDS]);
    expect(m.consultations).toHaveLength(5);
    expect(new Set(m.consultations.map((c) => c.day)).size).toBe(5);
    expect(new Set(m.consultations.map((c) => c.id)).size).toBe(5);
    for (const c of m.consultations) {
      const [, day, num] = /^day(\d)_consultation(\d\d)$/.exec(c.id)!;
      expect(c.day, c.id).toBe(Number(day));
      expect(c.consultation, c.id).toBe(Number(num));
    }
  });

  it("lists, per consultation, the two channels, two transcripts, the note and the two derived files, with sources pinned to the commit", () => {
    const m = loadManifest();
    const commit = m.dataset.commit;
    const paths = new Set<string>();
    for (const c of m.consultations) {
      expect(c.files.map((f) => f.role).sort(), c.id).toEqual([...ROLES].sort());
      const byRole = Object.fromEntries(c.files.map((f) => [f.role, f]));
      for (const f of c.files) {
        expect(f.path.includes(c.id), `${f.path} belongs to ${c.id}`).toBe(true);
        expect(paths.has(f.path), `${f.path} listed twice`).toBe(false);
        paths.add(f.path);
        expect(path.posix.normalize(f.path)).toBe(f.path);
        expect(f.path.includes("..") || f.path.includes("\\") || path.isAbsolute(f.path)).toBe(false);
        if (f.derived) {
          expect(f.source, `${f.path} is derived, no source`).toBeUndefined();
          expect(f.derived_from?.length, f.path).toBeGreaterThan(0);
          for (const r of f.derived_from ?? []) expect(byRole[r], `${f.path} derived from ${r}`).toBeDefined();
        } else {
          expect(f.source, `${f.path} has a source`).toBeDefined();
          expect(f.derived_from).toBeUndefined();
          expect(f.source!.path).toBe(f.path); // same layout as the repository
        }
      }
      for (const who of ["doctor", "patient"] as const) {
        const a = byRole[`audio_${who}`];
        expect(a.path).toBe(`audio/${c.id}_${who}.wav`);
        expect(a.source!.url).toBe(`${MEDIA_BASE}/${commit}/audio/${c.id}_${who}.wav`);
        expect(a.source!.url.startsWith("https://media.githubusercontent.com/media/babylonhealth/primock57/")).toBe(true);
        expect(a.source!.lfs_oid).toBe(`sha256:${a.sha256}`);
        expect(a.audio).toBeDefined();
        expect(a.bytes).toBeGreaterThan(1_000_000); // real recordings, ~10-21 MB each
        expect(a.bytes).toBeLessThan(100 * 1024 * 1024);
        const t = byRole[`transcript_${who}`];
        expect(t.path).toBe(`transcripts/${c.id}_${who}.TextGrid`);
        expect(t.source!.url).toBe(`${RAW_BASE}/${commit}/transcripts/${c.id}_${who}.TextGrid`);
        expect(t.source!.git_blob_sha1).toMatch(HEX40);
      }
      expect(byRole.note.path).toBe(`notes/${c.id}.json`);
      expect(byRole.note.source!.url).toBe(`${RAW_BASE}/${commit}/notes/${c.id}.json`);
      expect(byRole.audio_mixed.path).toBe(`mixed/${c.id}.wav`);
      expect(byRole.audio_mixed.derived_from).toEqual(["audio_doctor", "audio_patient"]);
      expect(byRole.utterances.path).toBe(`transcripts/${c.id}.utterances.json`);
      expect(byRole.utterances.derived_from).toEqual(["transcript_doctor", "transcript_patient"]);
    }
  });

  it("records a mono 16 kHz mix that is as long as the longer channel and never clipped", () => {
    const m = loadManifest();
    for (const c of m.consultations) {
      const byRole = Object.fromEntries(c.files.map((f) => [f.role, f]));
      const mixed = byRole.audio_mixed;
      expect(mixed.audio).toEqual({ sample_rate: 16000, channels: 1, bits_per_sample: 16, duration_s: c.duration_s });
      const longest = Math.max(byRole.audio_doctor.audio!.duration_s, byRole.audio_patient.audio!.duration_s);
      expect(c.duration_s, c.id).toBe(longest);
      expect(mixed.bytes, c.id).toBe(44 + 2 * Math.round(c.duration_s * 16000));
      expect(c.mix.clipped_samples).toBe(0);
      expect(Math.min(c.mix.padded_samples.doctor, c.mix.padded_samples.patient), "the longer channel is not padded").toBe(0);
      if (c.mix.peak_in <= 32767) {
        expect(c.mix.gain, c.id).toBe(1);
        expect(c.mix.peak_out).toBe(c.mix.peak_in);
      } else {
        expect(c.mix.gain, c.id).toBeCloseTo(32767 / c.mix.peak_in, 12);
        expect(c.mix.peak_out).toBe(32767);
      }
    }
  });

  it("has totals that add up", () => {
    const m = loadManifest();
    const all = m.consultations.flatMap((c) => c.files);
    const source = all.filter((f) => !f.derived);
    const derived = all.filter((f) => f.derived);
    const sum = (fs: { bytes: number }[]) => fs.reduce((s, f) => s + f.bytes, 0);
    expect(m.totals).toEqual({
      consultations: m.consultations.length,
      files: all.length,
      source_files: source.length,
      source_bytes: sum(source),
      source_audio_bytes: sum(source.filter((f) => f.role === "audio_doctor" || f.role === "audio_patient")),
      derived_files: derived.length,
      derived_bytes: sum(derived),
      bytes_on_disk: sum(all),
    });
    expect(m.totals.source_audio_bytes).toBeGreaterThan(100 * 1024 * 1024); // ten real channel WAVs
  });

  it("keeps the audio out of the repository: no audio or large file under fixtures/real, and .data is gitignored", () => {
    const dir = path.dirname(MANIFEST_PATH);
    const names = readdirSync(dir, { recursive: true, encoding: "utf8" }).sort();
    expect(names).toEqual(expect.arrayContaining([path.basename(ATTRIBUTION_PATH), path.basename(MANIFEST_PATH)]));
    for (const n of names) {
      const st = statSync(path.join(dir, n));
      if (st.isDirectory()) continue;
      expect(n, "no audio in the repository").not.toMatch(/\.(wav|mp3|m4a|flac|ogg|opus|webm|aac)$/i);
      expect(st.size, n).toBeLessThan(256 * 1024);
    }
    const ignore = readFileSync(path.join(WEB, ".gitignore"), "utf8").split(/\r?\n/).map((l) => l.trim());
    expect(ignore.some((l) => l === "/.data/" || l === ".data/" || l === "/.data"), "web/.gitignore ignores .data").toBe(true);
    expect(LOCAL_ROOT_REL.startsWith(".data/")).toBe(true);
  });
});

describe("fixtures/real/PRIMOCK57-ATTRIBUTION.md", () => {
  it("exists and gives title, creator, source, licence and changes (CC BY 4.0 attribution)", () => {
    expect(existsSync(ATTRIBUTION_PATH)).toBe(true);
    const md = readFileSync(ATTRIBUTION_PATH, "utf8");
    expect(md.charCodeAt(0), "no BOM").not.toBe(0xfeff);
    const m = loadManifest();
    for (const needle of [
      m.dataset.title,
      "Babylon Health",
      "Papadopoulos Korfiatis",
      "2022",
      REPO_URL,
      m.dataset.commit,
      m.dataset.paper,
      LICENCE.url,
      "CC BY 4.0",
      "Creative Commons Attribution 4.0 International",
      m.licence.dataset_licence_file,
      "## Changes we made",
      "Channel mixing",
      "Not real patient data.",
      "No endorsement",
      "web/.data/real/primock57/",
      "scripts/data/fetch_primock57.mjs",
    ]) {
      expect(md.includes(needle), `attribution mentions ${needle}`).toBe(true);
    }
    expect(md).toContain(`retrieved ${m.retrieved_on}`);
    expect(md).toMatch(/[一-鿿]/); // the Chinese note survived the round trip
  });

  it("credit line for screens: the same text in the script, the manifest and the attribution, with both links (CC BY 4.0 3(a)(1))", () => {
    const m = loadManifest();
    expect(m.credit).toEqual({ ...CREDIT });
    expect(Object.isFrozen(CREDIT)).toBe(true);
    for (const [lang, line] of [["en", CREDIT.en], ["zh", CREDIT.zh]] as const) {
      for (const needle of ["PriMock57", "Babylon Health", "Papadopoulos Korfiatis", "2022", CREDIT.licence_name, m.dataset.repository, LICENCE.url]) {
        expect(line.includes(needle), `${lang} credit names ${needle}`).toBe(true);
      }
      expect(line, `${lang} credit is one line`).not.toMatch(/[\r\n]/);
    }
    expect(CREDIT.en).toMatch(/not a real patient/);
    expect(CREDIT.en).toMatch(/channels mixed into one track/);
    expect(CREDIT.zh).toMatch(/不是真病人/);
    expect(CREDIT.zh).toMatch(/混成一条/);
    expect(CREDIT.source_url).toBe(REPO_URL);
    expect(CREDIT.licence_url).toBe(LICENCE.url);
    expect(CREDIT.en.includes(CREDIT.short_citation)).toBe(true);

    const md = readFileSync(ATTRIBUTION_PATH, "utf8");
    const section = md.split(/^## /m).find((s) => s.startsWith("Credit line for screens"));
    expect(section, "attribution has a 'Credit line for screens' section").toBeDefined();
    const quoted = section!.split(/\r?\n/).filter((l) => l.startsWith("> ")).map((l) => l.slice(2));
    expect(quoted).toEqual([CREDIT.en, CREDIT.zh]);
  });

  it("uses the first author's full surname: never the loose short form 'Korfiatis et al.' / 'Korfiatis 等'", () => {
    const loose = /(?<!Papadopoulos )Korfiatis (et al|等)/;
    const md = readFileSync(ATTRIBUTION_PATH, "utf8");
    expect(md).not.toMatch(loose);
    expect(readFileSync(MANIFEST_PATH, "utf8")).not.toMatch(loose);
    expect(JSON.stringify(CREDIT)).not.toMatch(loose);
    expect(md).toMatch(/Papadopoulos Korfiatis et al\., 2022/);
    expect(md).toMatch(/Papadopoulos Korfiatis 等，2022/);
    // the probe itself catches the loose form and lets the full one through
    expect("(Korfiatis et al., 2022)").toMatch(loose);
    expect("Korfiatis 等，2022").toMatch(loose);
    expect("(Papadopoulos Korfiatis et al., 2022)").not.toMatch(loose);
  });

  it("says why the source URLs name a commit rather than main", () => {
    const md = readFileSync(ATTRIBUTION_PATH, "utf8");
    const m = loadManifest();
    expect(m.dataset.ref).toBe("main");
    expect(md).toContain("resolves the branch `main` to the commit above");
    expect(md).toContain(`${MEDIA_BASE}/<commit>/audio/<file>`);
    for (const f of m.consultations.flatMap((c) => c.files).filter((f) => f.source)) {
      expect(f.source!.url, f.path).toContain(`/${m.dataset.commit}/`);
      expect(f.source!.url, f.path).not.toContain("/main/");
    }
  });

  it("names exactly the consultations in the manifest, each with its day and mix gain", () => {
    const md = readFileSync(ATTRIBUTION_PATH, "utf8");
    const m = loadManifest();
    const named = new Set(md.match(/day[1-5]_consultation\d\d/g) ?? []);
    expect([...named].sort()).toEqual(m.consultations.map((c) => c.id).sort());
    for (const c of m.consultations) {
      const row = md.split("\n").find((l) => l.startsWith(`| \`${c.id}\``));
      expect(row, `table row for ${c.id}`).toBeDefined();
      const cells = row!.split("|").map((s) => s.trim());
      expect(cells[2]).toBe(String(c.day));
      expect(cells[3]).toBe(c.presenting_complaint);
      expect(cells[5]).toBe(c.mix.gain === 1 ? "1" : c.mix.gain.toFixed(6));
    }
  });
});

const haveLocal = existsSync(LOCAL_ROOT);

describe(`downloaded files in ${LOCAL_ROOT_REL} (skipped when the folder is absent; run node scripts/data/fetch_primock57.mjs)`, () => {
  it.skipIf(!haveLocal)("match the manifest byte for byte (size and sha256)", async () => {
    const m = loadManifest();
    const r = await verifyLocal(m, WEB);
    expect(r.problems).toEqual([]);
    expect(r.files).toBe(m.totals.files);
    expect(r.bytes).toBe(m.totals.bytes_on_disk);
  }, 120_000);

  it.skipIf(!haveLocal)("read back: channel and mixed WAV headers, utterance lists in the fixtures/visits shape", () => {
    const m = loadManifest();
    const visitKeys = Object.keys(
      (JSON.parse(readFileSync(path.join(WEB, "fixtures", "visits", "v1.utterances.json"), "utf8")) as { utterances: Record<string, unknown>[] })
        .utterances[0],
    );
    for (const c of m.consultations) {
      const byRole = Object.fromEntries(c.files.map((f) => [f.role, f]));
      for (const role of ["audio_doctor", "audio_patient", "audio_mixed"] as const) {
        const f = byRole[role];
        const head = readFileSync(path.join(LOCAL_ROOT, f.path));
        const info = parseWav(head);
        expect(info.sampleRate, f.path).toBe(16000);
        expect(info.bitsPerSample).toBe(16);
        expect(info.channels).toBe(f.audio!.channels);
        expect(Number(info.durationS.toFixed(3))).toBe(f.audio!.duration_s);
      }
      const utt = JSON.parse(readFileSync(path.join(LOCAL_ROOT, byRole.utterances.path), "utf8")) as {
        meta: { consultation: string; commit: string; licence: string; attribution: string };
        utterances: { id: string; t_start_ms: number; t_end_ms: number; speaker_cluster: number; speaker: string; text: string; text_raw: string }[];
      };
      expect(utt.meta).toMatchObject({ consultation: c.id, commit: m.dataset.commit, licence: "CC-BY-4.0", attribution: ATTRIBUTION_REL });
      expect(utt.utterances.filter((u) => u.speaker === "doctor")).toHaveLength(c.utterances.doctor);
      expect(utt.utterances.filter((u) => u.speaker === "patient")).toHaveLength(c.utterances.patient);
      let prev = -1;
      utt.utterances.forEach((u, i) => {
        for (const k of visitKeys) expect(u, `${u.id} has ${k}`).toHaveProperty(k);
        expect(u.id).toBe(`${c.id}-u${String(i + 1).padStart(3, "0")}`);
        expect(u.t_start_ms).toBeGreaterThanOrEqual(prev);
        expect(u.t_end_ms).toBeGreaterThanOrEqual(u.t_start_ms);
        expect(u.t_end_ms).toBeLessThanOrEqual(Math.round(c.duration_s * 1000) + 1000);
        expect(u.speaker_cluster).toBe(u.speaker === "doctor" ? 0 : 1);
        expect(u.text.length).toBeGreaterThan(0);
        expect(u.text).not.toMatch(/<\/?[A-Z_]+\/?>/);
        expect(u.text_raw.length).toBeGreaterThanOrEqual(u.text.length);
        prev = u.t_start_ms;
      });
    }
  });
});
