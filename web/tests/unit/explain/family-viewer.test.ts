/**
 * The long press on the family side (owner's decision of 2026-10-14: 「长按进入 AI 在家属端也要有」): the same read of one
 * of his records, through her care link, CUT BY HIS SWITCHES, in the family side's words. This file holds the part that
 * must not leak (lib/explain/evidence.ts, app/api/explain, app/api/explain/add):
 *
 *   his own read          is what it was before the family viewer existed: every kind of subject, both languages,
 *                         compared with his-read.golden.json, which was written from the code as it stood before
 *                         (a change of HIS wording is then made on purpose: `vitest -u` on this file)
 *   her read              every line of `checked` and every entry of `sources` is one a switch of his allows:
 *                           a clinician's quoted line only with his visit records shared (and only one he confirmed)
 *                           the label and the dose facts with his medicine
 *                           his readings and the doctor's numbers with his blood pressure
 *                           his questions' words and counts with his questions
 *                         a type whose switch is off is 404, the answer a thing that does not exist gets
 *                         what she may hold is narrower than what he may (a medicine he bought himself, a question he
 *                         set aside, a visit line he did not confirm: null)
 *   her words             about him in the third person, with her word for him; never 「你」; the family side's
 *                         vocabulary (已服药 / 未服药 / 未回应, 血压测量, 就诊), never the elder side's (吃了, 没吃, 看诊)
 *   the model's sentence  his consent and his spend are the gates; the prompt names her as the reader; a sentence that
 *                         speaks to 「你」 is dropped
 *   the routes            POST /api/explain?link= and POST /api/explain/add?link= through the real handlers, on her
 *                         scoped store (a write of his records there throws): nothing of his is written but her look
 *
 * Mr Tan's example account on Tue 13 Oct 2026, 10:00 his time: he did not take his morning medicine and said why; he
 * recorded 147/93 and, five minutes later, 186/101 (above his doctor's 180); one reading he did not take; he wrote a
 * question. Wei Ling follows him through an active link and calls him 「爸爸」.
 */
import { randomUUID } from "node:crypto";
import { NextRequest } from "next/server";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { POST as addPOST } from "@/app/api/explain/add/route";
import { POST as explainPOST } from "@/app/api/explain/route";
import { GET as clipGET } from "@/app/api/family/clip/route";
import { getAuthProvider } from "@/lib/auth";
import { createAccountWithSpace, type TestAccount } from "@/lib/auth/dev-accounts";
import { answerDose } from "@/lib/daily/doses";
import { askAboutText, factWords, holdWords } from "@/lib/explain/copy";
import { buildEvidence, type Evidence } from "@/lib/explain/evidence";
import { HOLD_GRANT, HOLD_TYPES, doseRef, familyMayHold, type HoldLocale, type HoldRead, type HoldSubject } from "@/lib/explain/subjects";
import { SYSTEM_EXPLAIN, SYSTEM_EXPLAIN_FAMILY, explainPayload, guardVerdict, writeVerdict } from "@/lib/explain/verdict";
import { NO_GRANTS } from "@/lib/family/types";
import type { ChatOpts, LlmClient } from "@/lib/llm/types";
import { getMemoryStore } from "@/lib/store/memory";
import type { FamilyGrantItems, SessionRow } from "@/lib/store/types";
import { setTestClock } from "@/lib/time/now";
import { agreedLink } from "../../support/agreed-link";

const store = getMemoryStore();
const SGT = (hhmm: string) => `2026-10-13T${hhmm}:00+08:00`;
const REASON = "去公园了，药没带在身上";
const FOR_DOCTOR = "早上头晕的时候要不要先量血压再吃药";
const DAD = "爸爸";
const ALL: FamilyGrantItems = { dose_summary: true, bp_summary: true, questions_count: true, no_reply_alert: true, visit_transcripts: true, notes: true };
type Grant = keyof FamilyGrantItems;
const without = (...off: Grant[]): FamilyGrantItems => ({ ...ALL, ...Object.fromEntries(off.map((k) => [k, false])) });
const only = (...on: Grant[]): FamilyGrantItems => ({ ...NO_GRANTS, ...Object.fromEntries(on.map((k) => [k, true])) });

let him: TestAccount;
let her: TestAccount;
let linkId = "";
let now = 0;
const ids = { reading: "", high: "", skipped: "", question: "" };

function setClock(hhmm: string): number {
  setTestClock({ at: SGT(hhmm), frozen: true });
  return Date.parse(SGT(hhmm));
}

async function scope(): Promise<SessionRow> {
  const s = await store.getSession(him.userId);
  if (!s) throw new Error("no scope");
  return s;
}

const DOSE_TODAY: HoldSubject = { type: "dose", ref: doseRef("2026-10-13", "morning") };
const MED: HoldSubject = { type: "med", ref: "med-amlodipine" };
const BP_WEEK: HoldSubject = { type: "bp_week", ref: "" };
const NEXT: HoldSubject = { type: "next_visit", ref: "" };
const VISIT: HoldSubject = { type: "visit", ref: "v2" };
const LINE_TARGET: HoldSubject = { type: "visit_line", ref: "v1:item-R1" };
const bpHigh = (): HoldSubject => ({ type: "bp", ref: ids.high });
const bpToday = (): HoldSubject => ({ type: "bp", ref: ids.reading });

/** His own read, as his sheet gets it. */
async function his(subject: HoldSubject, locale: HoldLocale = "zh-Hans"): Promise<Evidence | null> {
  return buildEvidence({ store, scope: await scope(), subject, locale, nowMs: now, aiAllowed: true });
}

/** Her read under these switches. */
async function hers(grants: FamilyGrantItems, subject: HoldSubject, locale: HoldLocale = "zh-Hans", dad = DAD): Promise<Evidence | null> {
  return buildEvidence({ store, scope: await scope(), subject, locale, nowMs: now, aiAllowed: true, viewer: { kind: "family", grants, dad, linkId } });
}

/** Everything of an answer that reaches her screen, as one text. */
const shown = (ev: Evidence) => JSON.stringify({ name: ev.subject.name, verdict: ev.verdict, checked: ev.checked, sources: ev.sources, ask: ev.ask });
const kinds = (ev: Evidence) => ev.sources.map((s) => (s.sourceId.startsWith("visit:") ? "visit" : s.sourceId.startsWith("label:") ? "label" : s.sourceId.startsWith("referral:") || s.origin === "template" ? "template" : "leaflet"));

// ---------------------------------------------------------------- his own read: unchanged

/** Every subject his screens can name on this account, each with a label that does not change between runs. */
async function subjects(): Promise<{ label: string; subject: HoldSubject }[]> {
  const s = await scope();
  const out: { label: string; subject: HoldSubject }[] = [
    { label: "dose today morning", subject: { type: "dose", ref: doseRef("2026-10-13", "morning") } },
    { label: "dose yesterday morning", subject: { type: "dose", ref: doseRef("2026-10-12", "morning") } },
    { label: "dose today evening", subject: { type: "dose", ref: doseRef("2026-10-13", "evening") } },
    { label: "bp today", subject: { type: "bp", ref: ids.reading } },
    { label: "bp above the warning line", subject: { type: "bp", ref: ids.high } },
    { label: "bp not measured", subject: { type: "bp", ref: ids.skipped } },
    { label: "bp week", subject: { type: "bp_week", ref: "" } },
    { label: "bp last week", subject: { type: "bp_week", ref: "2026-10-05" } },
    { label: "next visit", subject: { type: "next_visit", ref: "" } },
  ];
  for (const m of await store.listMeds(s.id)) out.push({ label: `med ${m.id}`, subject: { type: "med", ref: m.id } });
  const seeded = (await store.listBp(s.id, { toDay: s.story_day })).filter((r) => ![ids.reading, ids.high, ids.skipped].includes(r.id));
  seeded.slice(0, 3).forEach((r, i) => out.push({ label: `bp seeded ${i}`, subject: { type: "bp", ref: r.id } }));
  for (const v of await store.listVisits(s.id)) out.push({ label: `visit ${v.id}`, subject: { type: "visit", ref: v.id } });
  for (const i of await store.listVisitItems(s.id)) out.push({ label: `line ${i.visit_id}:${i.id}`, subject: { type: "visit_line", ref: `${i.visit_id}:${i.id}` } });
  (await store.listQuestions(s.id)).forEach((q, i) => out.push({ label: `question ${i} ${q.status} ${q.origin}`, subject: { type: "question", ref: q.id } }));
  return out;
}

/** His read of each subject in both languages, with what differs from run to run taken out (ids made at random). */
async function hisReads(): Promise<string> {
  const s = await scope();
  const out: Record<string, unknown> = {};
  for (const { label, subject } of await subjects()) {
    for (const locale of ["zh-Hans", "en"] as HoldLocale[]) {
      const ev = await buildEvidence({ store, scope: s, subject, locale, nowMs: now, aiAllowed: true });
      if (!ev) {
        out[`${label} | ${locale}`] = null;
        continue;
      }
      const { answerId: _answerId, ...rest } = ev;
      out[`${label} | ${locale}`] = { ...rest, subject: { ...rest.subject, ref: label } };
    }
  }
  return JSON.stringify(out, null, 2).replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/g, "<id>");
}

beforeAll(async () => {
  setClock("07:30");
  const auth = getAuthProvider();
  him = await createAccountWithSpace(store, auth, { login: `h${randomUUID().slice(0, 10)}`, password: "a long test password", space: "example", locale: "zh-Hans" });
  her = await createAccountWithSpace(store, auth, { login: `w${randomUUID().slice(0, 10)}`, password: "a long test password", space: "none", locale: "zh-Hans" });
  const today = (await scope()).story_day;
  ids.reading = (await store.addBp(him.userId, { day: today, slot: "morning", systolic: 147, diastolic: 93, pulse: 61, created_at: new Date(setClock("08:20")).toISOString() })).id;
  ids.high = (await store.addBp(him.userId, { day: today, slot: "morning", systolic: 186, diastolic: 101, created_at: new Date(setClock("08:25")).toISOString() })).id;
  ids.skipped = (await store.addBp(him.userId, { day: today, slot: "evening", state: "unconfirmed" })).id;
  setClock("08:30");
  ids.question = (await store.addQuestion(him.userId, { for: "doctor", origin: "own", text: FOR_DOCTOR, lang: "zh-Hans" })).id;
  now = setClock("08:50");
  await answerDose(store, await scope(), { medication_id: "med-amlodipine", slot: "morning", state: "missed", reason: "own_words", reason_text: REASON }, now);
  now = setClock("10:00");
  // her link, in force, with every switch on (the tests change them as they go)
  const inv = await store.createInvite({ patient_id: him.userId, patient_label: DAD, invite_token_hash: randomUUID(), invite_expires_at: "2099-01-01T00:00:00.000Z" }, ALL);
  if (!inv.ok) throw new Error(inv.code);
  const acc = await store.acceptInvite(inv.link.invite_token_hash!, her.userId, "Wei Ling");
  if (!acc.ok) throw new Error(acc.code);
  const ok = await store.confirmLink(inv.link.id, him.userId, true);
  if (!ok.ok) throw new Error(ok.code);
  linkId = ok.link.id;
  // the two records an invitation he confirmed carries (without them her read is the alert-only form: lib/care/reconsent.ts)
  await agreedLink(store, ok.link);
});

afterAll(() => setTestClock(null));

describe("his own read", () => {
  it("is what it was before the family viewer existed (every kind of subject, both languages)", async () => {
    await expect(await hisReads()).toMatchFileSnapshot("./his-read.golden.json");
  });

  it("is the same with the viewer named as himself, and keeps his own words", async () => {
    const s = await scope();
    for (const subject of [DOSE_TODAY, MED, bpHigh(), VISIT, LINE_TARGET, NEXT]) {
      const plain = await his(subject);
      expect(await buildEvidence({ store, scope: s, subject, locale: "zh-Hans", nowMs: now, aiAllowed: true, viewer: { kind: "self" } })).toEqual(plain);
      expect(plain?.shared).toBeUndefined();
    }
    const dose = (await his(DOSE_TODAY))!;
    expect(dose.checked[0]).toBe(`Amlodipine 5 mg：记录为未服药，原因：${REASON}。`);
    expect(dose.ask).toEqual({ text: "想问问：10月13日 早间药物", for: "doctor" });
    expect((await his(LINE_TARGET))!.verdict).toBe("这是医生 9月1日 就诊时的原话，你确认过。");
    // his sheet's own words, with and without the argument
    expect(holdWords("zh-Hans")).toEqual(holdWords("zh-Hans", { kind: "self" }));
    expect(holdWords("zh-Hans").disclaimer).toBe("来自你的记录和医生的原话，不是医疗建议。");
    expect(askAboutText("en", "Amlodipine 5 mg")).toBe("I want to ask about: Amlodipine 5 mg");
  });
});

// ---------------------------------------------------------------- her read, switch by switch

describe("her read with every switch on", () => {
  it("a dose: the lines and the sources, in her words; the doctor's line plays through her link", async () => {
    const ev = (await hers(ALL, DOSE_TODAY))!;
    expect(ev.subject.name).toBe("10月13日 早间药物");
    expect(ev.checked).toEqual([`Amlodipine 5 mg：未服药，原因：${REASON}。`, "提醒时间：8:45，9:15 再次提醒，9:45 截止。", "最近 7 天（全部药物）：应服 7 次，已服药 5 次，未服药 2 次。"]);
    expect(ev.verdict).toBe(`10月13日早间药物：未服药，原因：${REASON}。`);
    expect(ev.sources.map((s) => s.sourceId)).toEqual(["label:med-amlodipine", "visit:v2:R3"]);
    // the same words and citation he gets; the sound through HER link, never his own clip route
    const quote = ev.sources[1];
    const hisQuote = (await his(DOSE_TODAY))!.sources[1];
    expect(quote.en).toBe(hisQuote.en);
    expect(quote.cite).toMatchObject({ visitId: "v2", date: hisQuote.cite!.date, utteranceId: "v2-u06", roleState: "confirmed" });
    expect(hisQuote.cite!.clipUrl).toBe("/api/visits/v2/clip?u=v2-u06");
    expect(JSON.stringify(ev)).not.toContain("/api/visits/");
    expect(ev.shared?.sort()).toEqual(["dose_summary", "visit_transcripts"]);
    // a dose that needs a question has one on her 「留意」, worded from what happened: the sheet adds no second one
    expect(ev.ask).toBeNull();
  });

  it("a quoted line's sound: her link's own route plays it, or the line carries no sound at all", async () => {
    const quotes = [...(await hers(ALL, DOSE_TODAY))!.sources, ...(await hers(ALL, VISIT))!.sources, ...(await hers(ALL, bpHigh()))!.sources].filter((s) => s.sourceId.startsWith("visit:"));
    expect(quotes.length).toBeGreaterThan(3);
    for (const q of quotes) {
      expect(q.cite?.clipPath, q.sourceId).toBeUndefined();
      const url = q.cite?.clipUrl;
      if (!url) continue;
      expect(url).toBe(`/api/family/clip?link=${encodeURIComponent(linkId)}&visit=${q.cite!.visitId}&u=${q.cite!.utteranceId}`);
      const res = await clipGET(new NextRequest(`http://localhost${url}`, { headers: { cookie: `rp_at=${her.tokens.access_token}` } }));
      expect(res.status, url).toBe(200);
    }
  });

  it("a reading above the doctor's warning line: his doctor's sentence, then 995, then the doctor's number", async () => {
    const ev = (await hers(ALL, bpHigh()))!;
    expect(ev.fixed).toBe(true);
    expect(ev.checked).toEqual([
      "本次血压测量：186/101，记录于 10月13日 8:25。",
      "医生的警示线：收缩压超过 180（9月1日 就诊时所述）。",
      "本周（10月12日至10月18日）血压测量 2 次，平均 167/97。",
      "另有 1 次未测量。",
      "医生给出的数值：低于 135/85（9月1日 就诊时所述）。",
      "其中 2 次不低于医生给出的数值。",
    ]);
    expect(ev.sources.map((s) => s.sourceId)).toEqual(["visit:v1:R2", "referral:B1-01", "visit:v1:R1"]);
    expect(ev.verdict).toBe("本次收缩压为 186，超过医生所说的 180。原话见下方。");
    // the doctor's English words keep their checked Chinese under them (his consent to AI processing is on)
    expect(ev.sources[0].translation?.lang).toBe("zh-Hans");
    expect(ev.sources[0].translation?.text).toBe((await his(bpHigh()))!.sources[0].translation?.text);
  });

  it("a visit, a line of it, a question and the next visit, each about him and never to him", async () => {
    const visit = (await hers(ALL, VISIT))!;
    expect(visit.subject.name).toBe("9月9日 就诊");
    expect(visit.checked).toEqual(["9月9日，Blossom Family Clinic (fictional)。", "已确认的原话：12 句。", "本次就诊所开药物：Amlodipine 5 mg。", `答复了${DAD}的 1 个问题。`]);
    expect((await hers(ALL, LINE_TARGET))!.verdict).toBe(`这是医生 9月1日 就诊时的原话，${DAD}已确认。`);
    const next = (await hers(ALL, NEXT))!;
    expect(next.subject.name).toBe("下次就诊 · 10月13日");
    expect(next.verdict).toBe("下次就诊在 10月13日，就在今天。有 4 个问题待问医生。");
    const q = (await hers(ALL, { type: "question", ref: ids.question }))!;
    expect(q.subject.name).toBe(FOR_DOCTOR);
    expect(q.checked).toEqual(["10月13日 列入问题单，待问医生。", "尚未询问。", "下次就诊：10月13日。"]);
    // a question is a question already: nothing to add
    expect(q.ask).toBeNull();
  });
});

describe("the cut: each line and each source needs its switch", () => {
  it("his visit records off: no clinician's quote anywhere, and no line built from a visit", async () => {
    const off = without("visit_transcripts");
    // a dose: the label stays, the doctor's line goes
    const dose = (await hers(off, DOSE_TODAY))!;
    expect(dose.sources.map((s) => s.sourceId)).toEqual(["label:med-amlodipine"]);
    expect(dose.checked).toEqual((await hers(ALL, DOSE_TODAY))!.checked);
    expect(dose.shared).toEqual(["dose_summary"]);
    // a medicine: that the doctor spoke about it is his visit record's. Not said either way
    const on = (await hers(ALL, MED))!;
    const med = (await hers(off, MED))!;
    expect(on.checked).toContain("医生于 9月9日 谈到该药物。");
    expect(on.sources.map((s) => s.sourceId)).toEqual(["visit:v2:R3", "visit:v2:R4", "label:med-amlodipine", "hh-amlodipine:amlodipine.purpose"]);
    expect(med.checked).toEqual(["医生处方。", "药品标签：9月9日 配药。", "服药时间：早间（依药品标签）。", "最近 7 天：应服 7 次，已服药 5 次，未服药 2 次。"]);
    expect(med.sources.map((s) => s.sourceId)).toEqual(["label:med-amlodipine", "hh-amlodipine:amlodipine.purpose"]);
    // a reading above the warning line: the number and 995 stay (his blood pressure), the doctor's sentences go
    const high = (await hers(off, bpHigh()))!;
    expect(high.sources.map((s) => s.sourceId)).toEqual(["referral:B1-01"]);
    expect(high.checked).toEqual((await hers(ALL, bpHigh()))!.checked);
    expect(high.verdict).toBe("本次收缩压为 186，超过医生所说的 180。");
    // the week, the next visit, an answered question: no quote; the answered question says so without 「原话见下方」
    expect((await hers(off, BP_WEEK))!.sources).toEqual([]);
    expect((await hers(off, NEXT))!.sources).toEqual([]);
    const answered = (await store.listQuestions(him.userId, { status: "answered" })).find((x) => x.origin === "own")!;
    const withWords = (await hers(ALL, { type: "question", ref: answered.id }))!;
    const bare = (await hers(off, { type: "question", ref: answered.id }))!;
    expect(withWords.sources.map((s) => s.sourceId)).toEqual(["visit:v2:v2-u11"]);
    expect(withWords.verdict).toBe("医生已于 9月9日 答复该问题。原话见下方。");
    expect(bare.sources).toEqual([]);
    expect(bare.verdict).toBe("医生已于 9月9日 答复该问题。");
    expect(bare.checked).toEqual(["9月9日 列入问题单，待问医生。", "医生已于 9月9日 答复。"]);
    // by a scan of everything she is sent under this switch: no source from a visit, for any subject she may still hold
    for (const { subject } of await subjects()) {
      if (!familyMayHold(subject.type, off)) continue;
      const ev = await hers(off, subject);
      if (ev) expect(ev.sources.filter((s) => s.sourceId.startsWith("visit:")), `${subject.type} ${subject.ref}`).toEqual([]);
    }
  });

  it("his medicine off: no medicine's name, no label, no leaflet, wherever she looks", async () => {
    const off = without("dose_summary");
    const visit = (await hers(off, VISIT))!;
    expect(visit.checked).toEqual(["9月9日，Blossom Family Clinic (fictional)。", "已确认的原话：12 句。", `答复了${DAD}的 1 个问题。`]);
    expect(visit.meds).toEqual([]);
    for (const { subject } of await subjects()) {
      if (!familyMayHold(subject.type, off)) continue;
      const ev = await hers(off, subject);
      if (!ev) continue;
      expect(kinds(ev).filter((k) => k === "label" || k === "leaflet"), `${subject.type} ${subject.ref}`).toEqual([]);
      expect(JSON.stringify({ name: ev.subject.name, verdict: ev.verdict, checked: ev.checked }), `${subject.type} ${subject.ref}`).not.toMatch(/Amlodipine|Ibuprofen|已服药|未服药|应服/);
    }
  });

  it("his blood pressure off: none of his readings, not the count, not the doctor's number as a line", async () => {
    const off = without("bp_summary");
    // the doctor's target line, held under his visit records: the line itself, and nothing of his readings next to it
    const line = (await hers(off, LINE_TARGET))!;
    const full = (await hers(ALL, LINE_TARGET))!;
    expect(full.checked).toEqual([
      "9月1日 就诊，录音 0:49。",
      `${DAD}已确认这句话。`,
      full.checked[2],
      "这是医生给出的血压数值：低于 135/85。",
      "本周（10月12日至10月18日）血压测量 2 次，平均 167/97。",
      "另有 1 次未测量。",
    ]);
    expect(line.checked).toEqual(full.checked.slice(0, 4));
    for (const { subject } of await subjects()) {
      if (!familyMayHold(subject.type, off)) continue;
      const ev = await hers(off, subject);
      if (!ev) continue;
      const text = JSON.stringify({ name: ev.subject.name, verdict: ev.verdict, checked: ev.checked });
      expect(text, `${subject.type} ${subject.ref}`).not.toMatch(/147\/93|186\/101|167\/97|血压测量|平均|未测量/);
      expect(kinds(ev), `${subject.type} ${subject.ref}`).not.toContain("template");
    }
  });

  it("his questions off: no count of them, no next visit, and nothing to add", async () => {
    const off = without("questions_count");
    // a planned visit held under his visit records: when and where, never how many questions wait
    const planned = (await hers(off, { type: "visit", ref: "v3" }))!;
    expect(planned.checked).toEqual(["就在今天。", "地点：Blossom Family Clinic (fictional)。", "上次就诊：9月13日。"]);
    expect(planned.verdict).toBe("本次就诊就在今天。");
    expect((await hers(ALL, { type: "visit", ref: "v3" }))!.verdict).toBe("本次就诊就在今天。有 4 个问题待问医生。");
    expect((await hers(off, VISIT))!.checked).not.toContain(`答复了${DAD}的 1 个问题。`);
    for (const { subject } of await subjects()) {
      if (!familyMayHold(subject.type, off)) continue;
      const ev = await hers(off, subject);
      if (!ev) continue;
      expect(ev.ask, `${subject.type} ${subject.ref}`).toBeNull();
      expect(JSON.stringify({ verdict: ev.verdict, checked: ev.checked }), `${subject.type} ${subject.ref}`).not.toMatch(/待问|问题单|个问题/);
    }
  });

  it("one switch on alone: only that kind's sources, and the answer says which switches it drew on", async () => {
    const cases: [Grant, HoldSubject, string[]][] = [
      ["dose_summary", DOSE_TODAY, ["label"]],
      ["dose_summary", MED, ["label", "leaflet"]],
      ["bp_summary", bpHigh(), ["template"]],
      ["bp_summary", BP_WEEK, []],
      ["visit_transcripts", VISIT, ["visit", "visit", "visit"]],
      ["questions_count", NEXT, []],
    ];
    for (const [grant, subject, expected] of cases) {
      const ev = (await hers(only(grant), subject))!;
      expect(kinds(ev), `${grant} ${subject.type}`).toEqual(expected);
      expect(ev.shared, `${grant} ${subject.type}`).toEqual([grant]);
      expect(ev.checked.length, `${grant} ${subject.type}`).toBeGreaterThan(0);
    }
    // with nothing on, nothing is left of any subject (the route never gets this far: the type's switch is off)
    for (const subject of [DOSE_TODAY, bpHigh(), VISIT, NEXT]) {
      const ev = (await hers(NO_GRANTS, subject))!;
      expect([ev.checked, ev.sources, ev.ask, ev.shared]).toEqual([[], [], null, []]);
    }
  });

  it("what she may hold is narrower than what he may", async () => {
    // a medicine he bought himself and a relative's box are not his daily medicine
    expect(await his({ type: "med", ref: "med-ibuprofen" })).not.toBeNull();
    expect(await hers(ALL, { type: "med", ref: "med-ibuprofen" })).toBeNull();
    expect(await hers(ALL, { type: "med", ref: "med-relative-box" })).toBeNull();
    expect(await hers(ALL, MED)).not.toBeNull();
    // a question he set aside
    const s = await scope();
    const mine = await store.addQuestion(s.id, { for: "doctor", origin: "own", text: "这个问题我先不问了", lang: "zh-Hans" });
    await store.updateQuestion(s.id, mine.id, { status: "skipped" });
    expect(await his({ type: "question", ref: mine.id })).not.toBeNull();
    expect(await hers(ALL, { type: "question", ref: mine.id })).toBeNull();
    // a question Ripple refused: its words are on his list (hers to see), that Ripple refused it is not said to her
    const refused = (await store.listQuestions(s.id)).find((x) => x.origin === "refused_question")!;
    expect((await his({ type: "question", ref: refused.id }))!.checked).toContain("这是 Ripple 不能回答的问题。");
    expect(JSON.stringify((await hers(ALL, { type: "question", ref: refused.id }))!.checked)).not.toMatch(/Ripple/);
    // a line of a visit he marked 「不是」, and a thing that does not exist
    const item = (await store.listVisitItems(s.id)).find((i) => i.id === "item-R4")!;
    await store.updateVisitItem(s.id, item.id, { slots: { ...(item.slots ?? {}), disputed: true } });
    expect(await his({ type: "visit_line", ref: "v2:item-R4" })).not.toBeNull();
    expect(await hers(ALL, { type: "visit_line", ref: "v2:item-R4" })).toBeNull();
    await store.updateVisitItem(s.id, item.id, { slots: item.slots ?? {} });
    expect(await hers(ALL, { type: "visit", ref: "no-such-visit" })).toBeNull();
    expect(await hers(ALL, { type: "bp", ref: "no-such-reading" })).toBeNull();
  });
});

// ---------------------------------------------------------------- her words

// 「问题单」 is the list's own name on both sides (her 「留意」 says 「加入问题单」), so it is not one of his plain words
const ELDER_WORDS = /吃了|没吃|没回|量了|看诊|看了医生|药袋/;
const TO_HIM_ZH = /[你您]/;
const TO_HIM_EN = /\byou(?:r|rs|rself)?\b/i;

describe("her words", () => {
  it("every answer she can get: about him, never to him, in the family side's vocabulary", async () => {
    let said = "";
    for (const { subject } of await subjects()) {
      for (const locale of ["zh-Hans", "en"] as HoldLocale[]) {
        const ev = await hers(ALL, subject, locale, locale === "en" ? "Dad" : DAD);
        if (!ev) continue;
        // his own words stay his: a question's text and a reason he gave are quoted as he wrote them
        const own = subject.type === "question" ? ev.subject.name : "";
        const text = JSON.stringify({ name: own ? "" : ev.subject.name, verdict: ev.verdict, checked: ev.checked, ask: ev.ask?.text.replace(ev.subject.name, "") }).split(REASON).join("");
        if (locale === "zh-Hans") {
          expect(text, `${subject.type} ${subject.ref}`).not.toMatch(TO_HIM_ZH);
          expect(text, `${subject.type} ${subject.ref}`).not.toMatch(ELDER_WORDS);
          said += text;
        } else {
          expect(text, `${subject.type} ${subject.ref}`).not.toMatch(TO_HIM_EN);
        }
      }
    }
    for (const word of ["已服药", "未服药", "血压测量", "就诊", "待问医生", "已于", "早间", DAD]) expect(said, word).toContain(word);
  });

  it("the whole set of her lines, also the ones this account's records do not reach", () => {
    for (const locale of ["zh-Hans", "en"] as HoldLocale[]) {
      const w = factWords(locale, { kind: "family", dad: locale === "en" ? "Dad" : DAD });
      const lines = [
        w.bpNoneName("2026-10-13", "evening"),
        w.bpReading(147, 93, "2026-10-12", "night", null),
        w.noTarget,
        w.weekNone(false, "2026-10-05", "2026-10-11"),
        w.notBelow(0),
        w.vBpBelow(120, 80, 135, 85),
        w.vBpNoTarget(120, 80),
        w.vWeekNoTarget(true, 3, 130, 82),
        w.vWeekNone(true),
        w.labelChecked,
        w.labelNone,
        w.labelTyped,
        w.labelUnchecked,
        w.medUnknown,
        w.medSlots(["morning", "night"], false),
        w.medNoSlots,
        w.nobodySpoke,
        w.doses7({ due: 0, taken: 0, missed: 0, unconfirmed: 0 }, false),
        w.doses7({ due: 7, taken: 4, missed: 1, unconfirmed: 2 }, true),
        w.vMedSlots("Losartan 50 mg", ["midday"], false),
        w.vMedThin("Losartan 50 mg"),
        w.cellTaken("Losartan 50 mg", "08:52"),
        w.cellLater("Losartan 50 mg"),
        w.cellNoReply("Losartan 50 mg", "09:45"),
        w.cellOpen("Losartan 50 mg"),
        w.vDoseTaken("2026-10-13", "midday", "12:10"),
        w.vDoseOpen("2026-10-13", "evening"),
        w.vDoseNoReply("2026-10-13", "night", "22:30"),
        w.vDoseMixed("2026-10-13", "morning", 3, 1, 1, 1),
        w.visitName("2026-11-03", true),
        w.visitLines(0),
        w.recordingKept,
        w.recordingDeleted,
        w.visitReview,
        w.visitWaiting,
        w.plannedWhen("2026-11-03", 21, true),
        w.questionsWaiting(0),
        w.lastVisit(null),
        w.vVisitEmpty("2026-09-09"),
        w.vVisitPlanned("2026-11-03", 21, true, 0),
        w.vVisitPlannedBare("2026-11-03", 21, true),
        w.pharmacyName("2026-11-03", true),
        w.lineName(null, "2026-09-09"),
        w.lineName("pharmacist", "2026-09-09"),
        w.lineUnconfirmed,
        w.lineDisputed,
        w.lineNoClip,
        w.lineIsWarning(180),
        w.vLineConfirmed("dispenser", "2026-09-09"),
        w.vLineUnconfirmed("2026-09-09"),
        w.questionAdded(null, "pharmacist"),
        w.questionPattern,
        w.questionSkipped,
        w.nextVisit(null, false),
        w.vQuestionOpen("pharmacist", null),
        w.vQuestionSkipped,
        w.nextName(null, false),
        w.vNext("2026-11-03", 21, true, 2),
        w.vNextNone,
        w.quotedBelow,
        w.part("night"),
        w.slotMed("midday"),
        w.who("dispenser"),
      ].join("\n");
      if (locale === "zh-Hans") {
        expect(lines).not.toMatch(TO_HIM_ZH);
        expect(lines).not.toMatch(ELDER_WORDS);
        expect(lines).toContain("未回应");
        expect(lines).toContain("睡前");
        expect(lines).toContain(`${DAD}本人`);
      } else {
        expect(lines).not.toMatch(TO_HIM_EN);
        for (const word of ["Taken", "No response", "blood pressure reading", "clinic visit", "Dad typed the label in himself"]) expect(lines, word).toContain(word);
      }
    }
  });

  it("her word for him is the one her link keeps; the sheet's line and the question are in her register", async () => {
    expect((await hers(ALL, LINE_TARGET, "zh-Hans", "阿公"))!.verdict).toBe("这是医生 9月1日 就诊时的原话，阿公已确认。");
    expect((await hers(ALL, LINE_TARGET, "en", "Dad"))!.verdict).toBe("These are his doctor's own words from the clinic visit on 1 Sep; Dad confirmed them.");
    expect(holdWords("zh-Hans", { kind: "family", dad: DAD }).disclaimer).toBe("根据爸爸同意分享的记录写成，不是医嘱。");
    expect(holdWords("en", { kind: "family", dad: "Dad" }).disclaimer).toBe("Written from the records Dad agreed to share. Not medical advice.");
    expect(askAboutText("zh-Hans", "血压 147/93 · 10月13日", { kind: "family", dad: DAD })).toBe("关于血压 147/93 · 10月13日，想请医生说明。");
    expect(askAboutText("en", "Blood pressure 147/93, 13 Oct", { kind: "family", dad: "Dad" })).toBe("About Blood pressure 147/93, 13 Oct: please explain.");
    // a thing that is the pharmacist's to explain asks the pharmacist (a visit to the pharmacy), in the same frame
    const pharmacy = (await hers(ALL, { type: "visit", ref: "p1" }))!;
    expect(pharmacy.subject.name).toBe("9月13日 药房取药");
    // a visit as such is not something to put on his list for her (the question would only name the visit)
    expect(pharmacy.ask).toBeNull();
    expect((await hers(ALL, { type: "visit", ref: "p1" }, "en", "Dad"))!.subject.name).toBe("Pharmacy visit, 13 Sep");
    for (const locale of ["zh-Hans", "en"] as HoldLocale[]) {
      const w = holdWords(locale, { kind: "family", dad: locale === "en" ? "Dad" : DAD });
      // the coach and 「再问一句」 are his side's: her sheet draws neither, so their words are not read here
      const text = [w.ask, w.sheetTitle, w.close, w.loading, w.failed, w.retry, w.gone, w.checked, w.sources, w.disclaimer, w.add, w.added, w.onList, w.addFailed].join("\n");
      expect(text).not.toMatch(locale === "en" ? TO_HIM_EN : TO_HIM_ZH);
      expect(text).not.toMatch(ELDER_WORDS);
    }
  });
});

// ---------------------------------------------------------------- the model's sentence, for her

function fakeLlm(answer: (opts: ChatOpts) => string): LlmClient & { calls: ChatOpts[] } {
  const calls: ChatOpts[] = [];
  return {
    provider: "deepseek",
    model: "test",
    calls,
    async chat(opts) {
      calls.push(opts);
      return { content: answer(opts), tokens: 10 };
    },
  };
}

describe("the model's sentence on her sheet", () => {
  const viewer = { kind: "family" as const, dad: DAD };

  it("is written for her about him, from the cut evidence only", async () => {
    const ev = (await hers(without("visit_transcripts"), DOSE_TODAY))!;
    const llm = fakeLlm(() => JSON.stringify({ verdict: `${DAD}在 10月13日的早间药物记录为未服药。`, abstain: false }));
    const said = await writeVerdict(ev, { locale: "zh-Hans", aiAllowed: true, llm, viewer });
    expect(said).toEqual({ verdict: `${DAD}在 10月13日的早间药物记录为未服药。`, abstain: false, by: "model" });
    expect(llm.calls).toHaveLength(1);
    expect(llm.calls[0].system).toBe(SYSTEM_EXPLAIN_FAMILY);
    expect(SYSTEM_EXPLAIN_FAMILY).not.toBe(SYSTEM_EXPLAIN);
    const sent = JSON.parse(llm.calls[0].user) as Record<string, unknown>;
    expect(sent).toMatchObject({ task: "explain", locale: "zh-Hans", reader: "family", patient: DAD, subjectType: "dose", facts: ev.checked });
    // the doctor's line was cut for her: the model is not given it either
    expect(JSON.stringify(sent)).not.toContain("works quietly");
    expect((sent.sources as { by: string }[]).map((s) => s.by)).toEqual(["the medicine label says"]);
    // his own payload names no reader
    expect(explainPayload((await his(DOSE_TODAY))!, "zh-Hans")).not.toHaveProperty("reader");
    expect(explainPayload((await his(DOSE_TODAY))!, "zh-Hans")).not.toHaveProperty("patient");
  });

  it("a sentence that speaks to 「你」 is dropped: the one built from the records is shown", async () => {
    const ev = (await hers(ALL, bpToday()))!;
    expect(guardVerdict(`${DAD}这次血压测量为 147/93。`, ev, "zh-Hans", viewer)).toEqual([]);
    expect(guardVerdict("你这次血压测量为 147/93。", ev, "zh-Hans", viewer)).toContain("second_person");
    expect(guardVerdict("Your reading was 147/93.", (await hers(ALL, bpToday(), "en", "Dad"))!, "en", { kind: "family", dad: "Dad" })).toContain("second_person");
    expect(guardVerdict(`这说明${DAD}的身体有变化。`, ev, "zh-Hans", viewer)).toContain("suggests_illness");
    // the same words to him are his own sheet's business, as before
    expect(guardVerdict("你这次记的是 147/93。", (await his(bpToday()))!, "zh-Hans")).not.toContain("second_person");
    const llm = fakeLlm(() => JSON.stringify({ verdict: "你这次血压测量为 147/93。", abstain: false }));
    expect(await writeVerdict({ ...ev, answerId: `${ev.answerId}-x` }, { locale: "zh-Hans", aiAllowed: true, llm, viewer })).toEqual({ verdict: ev.verdict, abstain: ev.abstain, by: "records", why: "guard" });
  });

  it("his consent and his spend are the gates; a fixed thing gets no model's words", async () => {
    const ev = (await hers(ALL, DOSE_TODAY))!;
    const llm = fakeLlm(() => "{}");
    expect((await writeVerdict(ev, { locale: "zh-Hans", aiAllowed: false, llm, viewer })).why).toBe("no_consent");
    expect((await writeVerdict(ev, { locale: "zh-Hans", aiAllowed: true, spendCapped: true, llm, viewer })).why).toBe("spend_cap");
    expect((await writeVerdict((await hers(ALL, bpHigh()))!, { locale: "zh-Hans", aiAllowed: true, llm, viewer })).why).toBe("fixed");
    expect(llm.calls).toEqual([]);
  });
});

// ---------------------------------------------------------------- the routes

function post(handler: (req: NextRequest) => Promise<Response>, path: string, who: TestAccount, body: unknown, link = true): Promise<Response> {
  const url = `http://localhost${path}${link ? `?link=${encodeURIComponent(linkId)}` : ""}`;
  // (rp_lang: these screens are in 华语; English is the default since the owner's 10-15)
  return handler(new NextRequest(url, { method: "POST", headers: { "content-type": "application/json", cookie: `rp_at=${who.tokens.access_token}; rp_lang=zh-Hans` }, body: JSON.stringify(body) }));
}
const read = (who: TestAccount, subject: HoldSubject, link = true) => post(explainPOST, "/api/explain", who, { subject_type: subject.type, subject_ref: subject.ref, locale: "zh-Hans" }, link);
const add = (who: TestAccount, body: unknown, link = true) => post(addPOST, "/api/explain/add", who, body, link);
const grant = (items: Partial<FamilyGrantItems>) => store.setFamilyGrant(him.userId, linkId, items);

/** his records, counted: a read must not change any of them */
async function hisRecords(): Promise<number[]> {
  const id = him.userId;
  return Promise.all([store.listQuestions(id), store.listDoses(id), store.listBp(id), store.listNotes(id), store.listChatMessages(id), store.listSafetyEvents(id), store.listVisitItems(id)]).then((rows) => rows.map((r) => r.length));
}

describe("POST /api/explain?link=", () => {
  it("her read: the same answer shape, her words, her line under the sentence; his records untouched, her look logged", async () => {
    await grant(ALL);
    const before = await hisRecords();
    const res = await read(her, DOSE_TODAY);
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-store");
    const text = await res.text();
    const body = JSON.parse(text) as HoldRead;
    expect(body).toMatchObject({
      subject: { type: "dose", ref: DOSE_TODAY.ref, name: "10月13日 早间药物" },
      verdict: `10月13日早间药物：未服药，原因：${REASON}。`,
      verdictBy: "records",
      verdictWhy: "no_model",
      ask: null,
      note: "根据爸爸同意分享的记录写成，不是医嘱。",
    });
    expect(body.checked).toEqual((await hers(ALL, DOSE_TODAY))!.checked);
    expect(body.sources.map((s) => s.sourceId)).toEqual(["label:med-amlodipine", "visit:v2:R3"]);
    // Ripple's own words on her sheet (the quoted sources are the label's and the doctor's words, as they were said)
    expect(JSON.stringify({ ...body, sources: [] }).split(REASON).join("")).not.toMatch(TO_HIM_ZH);
    expect(JSON.stringify({ ...body, sources: [] })).not.toMatch(ELDER_WORDS);
    expect(text).not.toContain("shared");
    expect(await hisRecords()).toEqual(before);
    // her look, for him: which of his switches the answer drew on
    const looks = (await store.listCareAccessLog(him.userId, {})).filter((r) => r.route === "/api/explain");
    expect(looks).toHaveLength(1);
    expect(looks[0]).toMatchObject({ link_id: linkId, family_user_id: her.userId, family_label: "Wei Ling" });
    expect([...looks[0].items].sort()).toEqual(["dose_summary", "visit_transcripts"]);
    // the same look again within ten minutes is not a second row
    expect((await read(her, DOSE_TODAY)).status).toBe(200);
    expect((await store.listCareAccessLog(him.userId, {})).filter((r) => r.route === "/api/explain")).toHaveLength(1);
  });

  it("a type whose switch is off is 404 not_found, whatever else is on", async () => {
    const cases: [Grant, HoldSubject[]][] = [
      ["dose_summary", [DOSE_TODAY, MED]],
      ["bp_summary", [bpToday(), BP_WEEK]],
      ["visit_transcripts", [VISIT, LINE_TARGET]],
      ["questions_count", [{ type: "question", ref: ids.question }, NEXT]],
    ];
    for (const [off, subjects] of cases) {
      await grant({ ...ALL, [off]: false });
      for (const subject of subjects) {
        const res = await read(her, subject);
        expect(res.status, `${off} off: ${subject.type}`).toBe(404);
        expect(await res.json()).toEqual({ error: "not_found" });
      }
      await grant(ALL);
      for (const subject of subjects) expect((await read(her, subject)).status, `all on: ${subject.type}`).toBe(200);
    }
    // every type has a switch, and a thing that does not exist answers the same 404
    expect(Object.keys(HOLD_GRANT).sort()).toEqual([...HOLD_TYPES].sort());
    const none = await read(her, { type: "bp", ref: "no-such-reading" });
    expect([none.status, await none.json()]).toEqual([404, { error: "not_found" }]);
  });

  it("his questions off: a dose read is still hers, with nothing to add", async () => {
    await grant(without("questions_count"));
    const body = (await (await read(her, DOSE_TODAY)).json()) as HoldRead;
    expect(body.ask).toBeNull();
    expect(body.checked.length).toBeGreaterThan(0);
    await grant(ALL);
  });

  it("his own account: as before, in his words, with no line of hers; her link is not his to use", async () => {
    const res = await read(him, DOSE_TODAY, false);
    expect(res.status).toBe(200);
    const body = (await res.json()) as HoldRead;
    expect(body.checked[0]).toBe(`Amlodipine 5 mg：记录为未服药，原因：${REASON}。`);
    expect(body.ask).toEqual({ text: "想问问：10月13日 早间药物", for: "doctor" });
    expect(body).not.toHaveProperty("note");
    expect(body.sources[1].cite?.clipUrl).toBe("/api/visits/v2/clip?u=v2-u06");
    expect((await read(him, DOSE_TODAY, true)).status).toBe(404);
    // she has no space of her own: without her link there is nothing to read
    expect((await read(her, DOSE_TODAY, false)).status).toBe(404);
  });

  it("his consent to AI processing is the gate on her read too: withdrawn, no model and no translation; her own consent is not asked", async () => {
    // she never agreed to anything about AI (her account has no such record of its own that would matter): the read above
    // said no_model, which is past the consent gate, so the consent that was read was his
    await store.addConsentRecord({ user_id: him.userId, scope_id: him.userId, kind: "ai_processing", decision: "withdrawn", method: "test" });
    const off = (await (await read(her, DOSE_TODAY)).json()) as HoldRead;
    expect(off).toMatchObject({ verdictBy: "records", verdictWhy: "no_consent" });
    expect(off.sources.map((s) => [s.sourceId, s.translation ?? null])).toEqual([["label:med-amlodipine", null], ["visit:v2:R3", null]]);
    await store.addConsentRecord({ user_id: him.userId, scope_id: him.userId, kind: "ai_processing", decision: "granted", method: "test" });
    const on = (await (await read(her, DOSE_TODAY)).json()) as HoldRead;
    expect(on.verdictWhy).toBe("no_model");
    expect(on.sources[1].translation?.lang).toBe("zh-Hans");
  });

  it("a link that is over reads nothing", async () => {
    const other = await store.createInvite({ patient_id: him.userId, patient_label: DAD, invite_token_hash: randomUUID(), invite_expires_at: "2099-01-01T00:00:00.000Z" }, ALL);
    if (!other.ok) throw new Error(other.code);
    const sister = await createAccountWithSpace(store, getAuthProvider(), { login: `s${randomUUID().slice(0, 10)}`, password: "a long test password", space: "none" });
    await store.acceptInvite(other.link.invite_token_hash!, sister.userId, "Mei");
    // accepted, not yet confirmed by him: not in force
    const waiting = await explainPOST(
      new NextRequest(`http://localhost/api/explain?link=${other.link.id}`, { method: "POST", headers: { "content-type": "application/json", cookie: `rp_at=${sister.tokens.access_token}` }, body: JSON.stringify({ subject_type: "dose", subject_ref: DOSE_TODAY.ref }) }),
    );
    expect(waiting.status).toBe(403);
    expect(await waiting.json()).toEqual({ error: "link_not_active" });
  });
});

describe("POST /api/explain/add?link=", () => {
  // a medicine: what her sheet may put a question about (a dose and a reading have theirs on her 「留意」)
  const held = { subject_type: "med", subject_ref: "med-amlodipine" };

  it("403 while he does not share his questions; nothing reaches his list", async () => {
    await grant(without("questions_count"));
    const before = (await store.listQuestions(him.userId)).length;
    const res = await add(her, held);
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: "not_shared" });
    expect((await store.listQuestions(him.userId)).length).toBe(before);
    await grant(ALL);
  });

  it("with his questions shared: the question is written by the server from what she held, in her name, once", async () => {
    const before = await store.listQuestions(him.userId);
    const res = await add(her, held);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ outcome: "created", added: true });
    const after = await store.listQuestions(him.userId);
    expect(after.length).toBe(before.length + 1);
    const q = after.find((x) => !before.some((b) => b.id === x.id))!;
    expect(q).toMatchObject({ status: "open", asked_by_user_id: her.userId });
    expect(q.text).toMatch(/^关于.*Amlodipine.*，想请(医生|药剂师)说明。$/);
    // the same thing again is the same question
    const again = await add(her, held);
    expect(await again.json()).toEqual({ outcome: "merged", added: true });
    expect((await store.listQuestions(him.userId)).length).toBe(after.length);
  });

  it("never her words; never a thing she may not hold; never from his own account", async () => {
    const before = (await store.listQuestions(him.userId)).length;
    const typed = await add(her, { ...held, text: "加倍吃药可以吗" });
    expect(typed.status).toBe(400);
    // a question is on his list already: nothing to add
    expect((await add(her, { subject_type: "question", subject_ref: ids.question })).status).toBe(404);
    await grant(without("dose_summary"));
    const hidden = await add(her, held);
    expect([hidden.status, await hidden.json()]).toEqual([404, { error: "not_found" }]);
    await grant(ALL);
    const mine = await add(him, held, false);
    expect([mine.status, await mine.json()]).toEqual([403, { error: "family_only" }]);
    expect((await store.listQuestions(him.userId)).length).toBe(before);
  });
});
