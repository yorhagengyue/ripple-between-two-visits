/**
 * Label photos with the live main model (overnight plan item 2): the three sample photos in fixtures/labels go
 * through the real M3 flow (upload -> readLabel -> confirmLabel) in a memory session, and every field is compared
 * with <name>.expected.json. The relative's Chinese-only box must end in the fixed unknown-medicine sentence and
 * one question for the pharmacist, with its printed dosing nowhere in the output; the self-bought ibuprofen's card
 * must not mention what its expected.json lists under card_must_not_include (blood pressure, 血压, amlodipine).
 *
 * --degraded <dir> also reads every PNG in <dir> (photos you degraded yourself: rotated, blurred, cropped, blank;
 * named aml_* / ibu_* / rel_* / anything else) and reports, per photo, whether it was refused as unreadable and
 * whether any field offered for confirmation is WRONG (a field left empty is fine; a wrong one is the failure).
 *
 *   LLM_PROVIDER=deepseek [LLM_RECORD=1] node --env-file=.env node_modules/tsx/dist/cli.mjs scripts/llm/labels.ts \
 *     [--out <file>] [--degraded <dir>]
 *
 * Prints field names, pass / fail and token counts; the raw label text stays inside the run (it is fictional demo
 * packaging, written to --out only when asked).
 */
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { createLocalBlobStore } from "@/lib/blob";
import { getSpendLedger, llmStatus } from "@/lib/llm";
import { buildMedCardView, cardText } from "@/lib/meds/card";
import { MedsError } from "@/lib/meds/errors";
import { confirmLabel, readLabel, requiredConfirmations, type MedsDeps } from "@/lib/meds/write";
import { normalizeForCompare } from "@/lib/safety/text";
import { UNKNOWN_MED_SENTENCE } from "@/lib/safety/templates";
import { getMemoryStore } from "@/lib/store/memory";

const ROOT = path.resolve(__dirname, "..", "..");
const NAMES = ["amlodipine", "ibuprofen", "relative_box"] as const;
const FIELDS = ["drug_text", "drug_id", "strength", "directions", "slots", "dispensed", "clinic"] as const;
const ORIGIN = { amlodipine: "prescription", ibuprofen: "self_bought", relative_box: "relative" } as const;
const DAY = 12;

function argValue(name: string): string | undefined {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

const expected = (name: string) => JSON.parse(readFileSync(path.join(ROOT, "fixtures", "labels", `${name}.expected.json`), "utf8")) as Record<string, unknown>;

/** Which sample a degraded photo was made from (by its file name). */
function sampleOf(file: string): (typeof NAMES)[number] | null {
  if (/^aml/i.test(file)) return "amlodipine";
  if (/^ibu/i.test(file)) return "ibuprofen";
  if (/^rel/i.test(file)) return "relative_box";
  return null;
}

async function main() {
  const status = llmStatus();
  console.log("config:", JSON.stringify({ main: status.main, model: status.model, recording: status.recording }));
  if (status.main === "mock") console.warn("note: LLM_PROVIDER is mock, so the photos are read from the vision cassettes, not a model");
  const blobDir = mkdtempSync(path.join(tmpdir(), "ripple-labels-"));
  const spentBefore = getSpendLedger().spentUsd();
  const results: Record<string, unknown>[] = [];
  const degradedRows: Record<string, unknown>[] = [];
  try {
    const store = getMemoryStore();
    const blob = createLocalBlobStore({ dir: blobDir });
    const depsFor = (): MedsDeps => ({ store, blob, publish: () => {}, vision: { env: process.env }, ask: { publish: () => {}, costGuard: null } });
    for (const name of NAMES) {
      const session = await store.createSession({ story_day: DAY, ttl_hours: 1 });
      const deps = depsFor();
      const p = `${session.id}/labels/${name}.png`;
      await blob.putObject("labels", p, new Uint8Array(readFileSync(path.join(ROOT, "fixtures", "labels", `${name}.png`))), "image/png");
      const want = expected(name);
      const t0 = Date.now();
      const read = await readLabel({ sessionId: session.id, path: p }, deps);
      const readMs = Date.now() - t0;
      const fields: Record<string, { got: unknown; want: unknown; pass: boolean }> = {};
      for (const f of FIELDS) {
        if (!(f in want)) continue;
        const got = read.fields[f] ?? null;
        fields[f] = { got, want: want[f], pass: JSON.stringify(got) === JSON.stringify(want[f]) };
      }
      const res = await confirmLabel(
        { sessionId: session.id, readToken: read.read_token, origin: ORIGIN[name], confirmed: requiredConfirmations(read.fields), locale: "zh-Hans" },
        deps,
      );
      const everything = JSON.stringify({ read, res, safety: await store.listSafetyEvents(session.id) });
      const extra: Record<string, boolean> = { status: res.med.status === want.expected_status_after_confirm, noWarnings: (read.warnings ?? []).length === 0 };
      if (name === "relative_box") {
        extra.unknownSentence = res.answer?.fixedText === UNKNOWN_MED_SENTENCE && res.answer?.route === "unknown_med";
        extra.pharmacistQuestion = res.questions.length === 1 && res.questions[0].for === "pharmacist";
        extra.dosingNotRelayed = !((want.must_not_relay as string[]) ?? []).some((b) => everything.includes(b)) && !everything.includes("六粒");
      }
      const banned = (want.card_must_not_include as string[] | undefined) ?? [];
      if (banned.length) {
        const card = ["en", "zh-Hans"].map(async (locale) => cardText(await buildMedCardView(store, session.id, res.med, { day: DAY, locale: locale as "en" | "zh-Hans" })));
        const text = (await Promise.all(card)).join("\n").toLowerCase();
        extra.cardMustNotInclude = banned.every((b) => !text.includes(b.toLowerCase()));
      }
      const pass = Object.values(fields).every((f) => f.pass) && Object.values(extra).every(Boolean);
      results.push({ name, provider: read.provider, readMs, fields, warnings: read.warnings ?? [], checks: extra, pass });
      console.log(
        `${name}: ${pass ? "PASS" : "FAIL"} (${read.provider}, ${readMs} ms) ` +
          Object.entries(fields)
            .map(([k, v]) => `${k}=${v.pass ? "ok" : "MISS"}`)
            .join(" ") +
          " " +
          Object.entries(extra)
            .map(([k, v]) => `${k}=${v ? "ok" : "MISS"}`)
            .join(" "),
      );
      for (const [k, v] of Object.entries(fields)) if (!v.pass) console.log(`  ${k}: got ${JSON.stringify(v.got)} want ${JSON.stringify(v.want)}`);
      if (read.warnings?.length) console.log(`  warnings: ${read.warnings.join(", ")}`);
      await store.deleteSession(session.id);
    }

    const degraded = argValue("--degraded");
    if (degraded) {
      if (!existsSync(degraded)) throw new Error("--degraded folder not found");
      for (const file of readdirSync(degraded).filter((f) => f.toLowerCase().endsWith(".png")).sort()) {
        const session = await store.createSession({ story_day: DAY, ttl_hours: 1 });
        const p = `${session.id}/labels/${file}`;
        await blob.putObject("labels", p, new Uint8Array(readFileSync(path.join(degraded, file))), "image/png");
        const sample = sampleOf(file);
        const want = sample ? expected(sample) : {};
        const t0 = Date.now();
        let row: Record<string, unknown>;
        try {
          const read = await readLabel({ sessionId: session.id, path: p }, depsFor());
          // a field offered for confirmation must be right; an empty one is fine
          // the same words count as right whatever the case and spacing (layer 1 compares them the same way)
          const same = (a: unknown, b: unknown) => (typeof a === "string" && typeof b === "string" ? normalizeForCompare(a) === normalizeForCompare(b) : JSON.stringify(a) === JSON.stringify(b));
          const wrong = FIELDS.filter((f) => read.fields[f] !== null && f in want && !same(read.fields[f], want[f]));
          const offeredWithoutSample = sample ? [] : FIELDS.filter((f) => read.fields[f] !== null);
          row = {
            file,
            sample,
            refused: null,
            offered: FIELDS.filter((f) => read.fields[f] !== null),
            wrong: [...wrong, ...offeredWithoutSample],
            wrongValues: Object.fromEntries([...wrong, ...offeredWithoutSample].map((f) => [f, { got: read.fields[f], want: want[f] ?? null }])),
            warnings: read.warnings ?? [],
            ms: Date.now() - t0,
          };
        } catch (e) {
          if (!(e instanceof MedsError)) throw e;
          row = { file, sample, refused: (e.detail?.code as string) ?? e.code, offered: [], wrong: [], warnings: [], ms: Date.now() - t0 };
        }
        degradedRows.push(row);
        const wrong = row.wrong as string[];
        console.log(`degraded ${file}: ${row.refused ? `refused (${row.refused})` : `offered ${(row.offered as string[]).join(",") || "nothing"}`}${wrong.length ? `  WRONG: ${JSON.stringify(row.wrongValues)}` : ""}${(row.warnings as string[]).length ? `  warnings: ${(row.warnings as string[]).join(",")}` : ""}`);
        await store.deleteSession(session.id);
      }
    }
  } finally {
    rmSync(blobDir, { recursive: true, force: true });
  }
  const spent = getSpendLedger().spentUsd() - spentBefore;
  const summary = {
    at: new Date().toISOString(),
    main: status.main,
    model: status.model,
    passed: results.filter((r) => r.pass).length,
    of: results.length,
    degraded: degradedRows.length ? { photos: degradedRows.length, refused: degradedRows.filter((r) => r.refused).length, withWrongField: degradedRows.filter((r) => (r.wrong as string[]).length).length, rows: degradedRows } : null,
    usd: Math.round(spent * 1e6) / 1e6,
    results,
  };
  console.log(
    `labels: ${summary.passed}/${summary.of} pass` +
      (summary.degraded ? `; degraded ${summary.degraded.photos}: ${summary.degraded.refused} refused, ${summary.degraded.withWrongField} with a wrong field offered` : "") +
      `; spend US$${summary.usd.toFixed(5)}`,
  );
  const out = argValue("--out");
  if (out) writeFileSync(out, JSON.stringify(summary, null, 2) + "\n", "utf8");
  if (summary.passed !== summary.of) process.exitCode = 1;
}

// run only as a script, not when a test imports FLIPS or the helpers
if (/[\\/]scripts[\\/]llm[\\/]labels\.[cm]?[jt]s$/.test(process.argv[1] ?? "")) {
  main().catch((e) => {
    console.error("labels run failed:", (e as Error).name, (e as { code?: string }).code ?? "", (e as Error).message.slice(0, 200));
    process.exit(1);
  });
}
