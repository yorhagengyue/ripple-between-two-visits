/**
 * Visit item extraction with the live main model (overnight plan item 2): the v1 and v2 transcripts
 * (fixtures/visits/*.utterances.json) go through the whole-visit labelling call (lib/visit/model-extract.ts), with
 * roles inferred from the words as finalizeVisit does. Three passes per visit:
 *
 *   model        the model's checked labels alone, with the session's required lines R1-R4 given (production prompt)
 *   blind        the model's checked labels alone, without the required lines: does it still find the target,
 *                the warning line, the purpose line and the dose rule as the right types, at the right sentence?
 *   asr          the required lines reworded the way a transcript can differ (a word added or changed), so the
 *                rules' same-words match misses them; rules alone vs rules + model
 *   flips        (round 2) the required lines with their meaning changed ("..., then you may add a tablet",
 *                "unless your readings are high", "and" for "or", "until you feel fine" ...): whatever the model labels,
 *                no R line may be accepted on the changed sentence
 *
 * For every R line: found or not, and the time point of the sentence it was found on against the script's
 * (expected within 3 s). Labels the checks dropped are listed with the reason.
 *
 *   LLM_PROVIDER=deepseek [LLM_RECORD=1] node --env-file=.env node_modules/tsx/dist/cli.mjs scripts/llm/visit-extract.ts [--out <file>]
 */
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { createMainLlm, getSpendLedger, llmStatus } from "@/lib/llm";
import type { RequiredLineId, VisitItemRow } from "@/lib/store/types";
import { getMemoryStore } from "@/lib/store/memory";
import { extractItems, type ExtractContext, type ExtractLine, type ItemDraft } from "@/lib/visit/extract";
import { extractWithModel, mergeDrafts } from "@/lib/visit/model-extract";
import { inferRoles } from "@/lib/visit/roles";

const ROOT = path.resolve(__dirname, "..", "..");
const TOLERANCE_MS = 3000;

interface Fixture {
  utterances: { id: string; t_start_ms: number; t_end_ms: number; speaker_cluster: number | null; lang: string; text: string }[];
}
interface Expected {
  answers: { id: string; true_role: string; required_line: string | null }[];
}

/** What each required line is, for the blind pass (type and, where it has one, variant). */
const BLIND_TYPE: Record<RequiredLineId, { type: string; variant?: string }> = {
  R1: { type: "target" },
  R2: { type: "threshold" },
  R3: { type: "purpose" },
  R4: { type: "instruction", variant: "dose_rule" },
};

/** Transcript-style variations of the required lines (a word added or changed; numbers and meaning kept). */
const ASR_VARIANT: Record<string, string> = {
  "v1-u08": "At home, we want it to be below 135 over 85.",
  "v1-u09": "If your reading at home is above 180 on top, or you get chest pain, weakness on one side or your speech becomes slurred, go to A and E or call 995.",
  "v2-u06":
    "This tablet works quietly. You won't feel it, and you don't feel the high pressure either, but over the years high pressure damages your heart, your brain and the kidneys. So you take it every day, even when you feel fine.",
  "v2-u08": "Please don't change the dose by yourself. If your readings are high, write them down and tell me at the next visit.",
};

/** Meaning-changed versions of the required lines (the round-2 safety check's live and offline finds). */
export const FLIPS: { visit: "v1" | "v2"; line: string; text: string }[] = [
  { visit: "v2", line: "v2-u08", text: "Please don't change the dose yourself. If your readings are high, write them down and tell me at your next visit, then you may add a tablet." },
  { visit: "v2", line: "v2-u08", text: "Please don't change the dose yourself unless your readings are high, then write them down and tell me at your next visit." },
  { visit: "v2", line: "v2-u08", text: "Please don't change the dose yourself. If your readings are high, write them down and tell me at your next visit. Otherwise you can adjust it." },
  { visit: "v2", line: "v2-u08", text: "Please change the dose yourself. If your readings are not high, write them down and tell me at your next visit." },
  { visit: "v1", line: "v1-u09", text: "If your reading at home is above 180 on top, and you get chest pain, weakness on one side, and your speech becomes slurred, go to A&E or call 995." },
  { visit: "v1", line: "v1-u09", text: "If your reading at home is above 180 on top, or you get chest pain, weakness on one side, or your speech becomes slurred, rest first, then go to A&E or call 995." },
  {
    visit: "v2",
    line: "v2-u06",
    text: "This tablet works quietly. You won't feel it, and you don't feel the high pressure either, but over the years high pressure damages the heart, the brain and the kidneys. So you take it only when you feel unwell.",
  },
  {
    visit: "v2",
    line: "v2-u06",
    text: "This tablet works quietly. You won't feel it, and you don't feel the high pressure either, but over the years high pressure damages the heart, the brain and the kidneys. So you take it every day, until you feel fine.",
  },
];

function argValue(name: string): string | undefined {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

const read = <T>(file: string): T => JSON.parse(readFileSync(path.join(ROOT, "fixtures", "visits", file), "utf8")) as T;

function scoreRequired(drafts: ItemDraft[], lines: ExtractLine[], expected: Expected, script: Fixture) {
  const out: Record<string, unknown>[] = [];
  for (const a of expected.answers.filter((x) => x.required_line)) {
    const r = a.required_line as RequiredLineId;
    const want = script.utterances.find((u) => u.id === a.id)!;
    const item = drafts.find((d) => d.required_line === r);
    const line = item ? lines.find((l) => l.id === item.utterance_ids[0]) : undefined;
    const deltaMs = line ? Math.abs(line.t_start_ms - want.t_start_ms) : null;
    out.push({ required_line: r, found: !!item, utterance: line?.id ?? null, t_start_ms: line?.t_start_ms ?? null, expected_ms: want.t_start_ms, deltaMs, withinTolerance: deltaMs !== null && deltaMs <= TOLERANCE_MS, by: item ? ((item.slots.extracted_by as string) ?? "rules") : null });
  }
  return out;
}

function scoreBlind(drafts: ItemDraft[], lines: ExtractLine[], expected: Expected, script: Fixture) {
  const out: Record<string, unknown>[] = [];
  for (const a of expected.answers.filter((x) => x.required_line)) {
    const r = a.required_line as RequiredLineId;
    const want = BLIND_TYPE[r];
    const hit = drafts.find((d) => d.utterance_ids[0] === a.id && d.type === want.type && (!want.variant || d.slots.variant === want.variant));
    const line = lines.find((l) => l.id === a.id)!;
    const scriptLine = script.utterances.find((u) => u.id === a.id)!;
    out.push({ required_line: r, as: want, found: !!hit, slots: hit?.slots ?? null, deltaMs: hit ? Math.abs(line.t_start_ms - scriptLine.t_start_ms) : null });
  }
  return out;
}

async function main() {
  const status = llmStatus();
  console.log("config:", JSON.stringify({ main: status.main, model: status.model, recording: status.recording }));
  const llm = createMainLlm();
  const store = getMemoryStore();
  const session = await store.createSession({ story_day: 43, ttl_hours: 1 });
  const required = (await store.listVisitItems(session.id, { required_only: true })) as VisitItemRow[];
  const visits = await store.listVisits(session.id);
  const spentBefore = getSpendLedger().spentUsd();
  const report: Record<string, unknown> = {};
  let allOk = true;

  for (const visitId of ["v1", "v2"]) {
    const script = read<Fixture>(`${visitId}.utterances.json`);
    const expected = read<Expected>(`${visitId}.expected.json`);
    const visit = visits.find((v) => v.id === visitId)!;
    const roles = inferRoles(
      script.utterances.map((u) => ({ id: u.id, speaker_cluster: u.speaker_cluster, text: u.text })),
      { visitKind: visit.kind, requiredLines: required.map((r) => ({ text: r.text, speaker: r.speaker })) },
    );
    const lines: ExtractLine[] = script.utterances.map((u) => ({ id: u.id, text: u.text, role: roles.byLine.get(u.id)!.role, t_start_ms: u.t_start_ms, t_end_ms: u.t_end_ms }));
    const roleAccuracy = expected.answers.filter((a) => roles.byLine.get(a.id)?.role === a.true_role).length / expected.answers.length;
    const ctx: ExtractContext = { visit: { id: visit.id, day: visit.day, kind: visit.kind }, requiredLines: required, priorPrescriptions: [] };

    const model = await extractWithModel(llm, lines, 0, ctx);
    const blind = await extractWithModel(llm, lines, 0, { ...ctx, requiredLines: [] });
    const asrLines = lines.map((l) => (ASR_VARIANT[l.id] ? { ...l, text: ASR_VARIANT[l.id] } : l));
    const asrRules = extractItems(asrLines, 0, ctx);
    const asrModel = await extractWithModel(llm, asrLines, 0, ctx);
    const asrMerged = asrModel.error ? { drafts: asrRules, added: [] } : mergeDrafts(asrRules, asrModel.drafts);

    const res = {
      roleAccuracy,
      model: { error: model.error, latencyMs: model.latencyMs, tokens: model.tokens, items: model.drafts.length, rejected: model.rejected, required: scoreRequired(model.drafts, lines, expected, script) },
      blind: { error: blind.error, latencyMs: blind.latencyMs, items: blind.drafts.length, rejected: blind.rejected, lines: scoreBlind(blind.drafts, lines, expected, script) },
      asr: {
        rulesOnly: scoreRequired(asrRules, asrLines, expected, script),
        rulesPlusModel: scoreRequired(asrMerged.drafts, asrLines, expected, script),
        modelAdded: asrMerged.added.map((d) => ({ id: d.id, type: d.type, required_line: d.required_line })),
        error: asrModel.error,
      },
      modelItems: model.drafts.map((d) => ({ id: d.id, type: d.type, variant: d.slots.variant ?? null, required_line: d.required_line })),
    };
    // meaning-changed required lines: no R line may be accepted on the changed sentence, whatever the model says
    const flips = [];
    for (const f of FLIPS.filter((x) => x.visit === visitId)) {
      const flipLines = lines.map((l) => (l.id === f.line ? { ...l, text: f.text } : l));
      const r = await extractWithModel(llm, flipLines, 0, ctx);
      const accepted = r.drafts.filter((d) => d.required_line && d.utterance_ids.includes(f.line));
      const modelSaidR = r.rejected.filter((x) => x.label.utterance_id === f.line && x.reason === "required_line_mismatch").length > 0;
      flips.push({ line: f.line, text: f.text, error: r.error, modelLabelledItR: modelSaidR || accepted.length > 0, acceptedAsR: accepted.map((d) => d.required_line) });
    }
    (res as Record<string, unknown>).flips = flips;
    report[visitId] = res;
    const ok = (rows: Record<string, unknown>[]) => rows.every((r) => r.found && (r.withinTolerance ?? true));
    const flipsOk = flips.every((f) => f.acceptedAsR.length === 0 && !f.error);
    const visitOk = !model.error && ok(res.model.required) && ok(res.asr.rulesPlusModel) && flipsOk;
    allOk &&= visitOk;
    const fmt = (rows: Record<string, unknown>[]) => rows.map((r) => `${r.required_line}:${r.found ? `${r.utterance ?? ""}${r.deltaMs !== null ? ` Δ${r.deltaMs}ms` : ""}` : "MISSING"}`).join(" ");
    console.log(`${visitId}: roles ${(roleAccuracy * 100).toFixed(0)}% | model ${model.error ?? "ok"} ${model.latencyMs} ms, ${model.drafts.length} items, ${model.rejected.length} dropped`);
    console.log(`  model (R lines given): ${fmt(res.model.required)}`);
    console.log(`  blind (no R lines):    ${res.blind.lines.map((r) => `${r.required_line}:${r.found ? "ok" : "MISSING"}`).join(" ")}`);
    console.log(`  asr variant, rules:    ${fmt(res.asr.rulesOnly)}`);
    console.log(`  asr variant, +model:   ${fmt(res.asr.rulesPlusModel)}`);
    for (const r of model.rejected) console.log(`  dropped: ${r.label.utterance_id} ${r.label.type} (${r.reason})`);
    for (const f of flips) console.log(`  flip ${f.line}: model labelled it R ${f.modelLabelledItR ? "yes" : "no"}, accepted as R ${f.acceptedAsR.length ? f.acceptedAsR.join(",") : "none"}${f.error ? ` (${f.error})` : ""}: ${f.text.slice(0, 70)}`);
  }
  await store.deleteSession(session.id);
  const spent = getSpendLedger().spentUsd() - spentBefore;
  const summary = { at: new Date().toISOString(), main: status.main, model: status.model, pass: allOk, usd: Math.round(spent * 1e6) / 1e6, visits: report };
  console.log(`visit extraction: ${allOk ? "PASS" : "FAIL"}; spend US$${summary.usd.toFixed(5)}`);
  const out = argValue("--out");
  if (out) writeFileSync(out, JSON.stringify(summary, null, 2) + "\n", "utf8");
  if (!allOk) process.exitCode = 1;
}

// run only as a script, not when a test imports FLIPS or the helpers
if (/[\\/]scripts[\\/]llm[\\/]visit-extract\.[cm]?[jt]s$/.test(process.argv[1] ?? "")) {
  main().catch((e) => {
    console.error("visit extraction run failed:", (e as Error).name, (e as Error).message.slice(0, 200));
    process.exit(1);
  });
}
