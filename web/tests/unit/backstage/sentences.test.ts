/**
 * M8 backstage: every event type published anywhere in web/lib and web/app (found by scanning the publish calls),
 * every type in lib/bus.ts's lists and every type in spec section 6 has its own sentence renderer (no generic
 * fallback for a known type, and no renderer that hands back the publisher's `say`). Blocks (layer and why),
 * who-said-it changes and scripted fallback are highlighted. The M5/M6/M7 events (the understanding checklist's
 * question, his switches for Wei Ling, her reminder recording, the director's reminder) are in the scan and render
 * from their own data. A new event type without a renderer fails here. Layer 3 names the checker model it ran with
 * (Hy4 preview on the judge link: the main model's vendor, a different model), never a second checker.
 */
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { NextRequest } from "next/server";
import { describe, expect, it } from "vitest";
import { POST as grantsPost } from "@/app/api/family/grants/route";
import { PATCH as medPatch } from "@/app/api/meds/[id]/route";
import { checkerName, HUNYUAN_CHECKER_NAME, REASON_WORDS, reasonWords, renderEvent, RENDERERS } from "@/components/backstage/sentences";
import { EXTRA_EVENT_TYPES, getBus, SPEC_EVENT_TYPES, type BusEvent } from "@/lib/bus";
import { answerUnderstanding } from "@/lib/explain/understanding";
import { evidenceFor, getPatientText } from "@/lib/kb/load";
import { createDecidingChecker, createMockLlm, HUNYUAN_CHECKER_MODEL, type LlmClient } from "@/lib/llm";
import { ask } from "@/lib/safety/pipeline";
import { cueReminder } from "@/lib/session/ops";
import { getMemoryStore } from "@/lib/store/memory";
import { runAsk } from "../safety/helpers";

const WEB = process.cwd();

function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const p = path.join(dir, name);
    if (statSync(p).isDirectory()) out.push(...sourceFiles(p));
    else if (/\.(ts|tsx|mts)$/.test(name) && !/\.test\.tsx?$/.test(name)) out.push(p);
  }
  return out;
}

/**
 * Every event type literal in a publish call: publish(...), publish<T>(...), pub(...), busPublish(...) and any
 * other function whose name ends in "publish" / "Publish" / is "pub", with the type as the second argument.
 */
export function publishedTypes(): Map<string, string[]> {
  const found = new Map<string, string[]>();
  const call = /\b(?:\w*[pP]ublish|pub)\s*(?:<[^>()]*>)?\s*\(\s*[^,()]+(?:\([^()]*\))?\s*,\s*["'`]([a-z_][a-z0-9_]*(?:\.[a-z0-9_]+)*)["'`]/g;
  for (const root of ["lib", "app"]) {
    for (const file of sourceFiles(path.join(WEB, root))) {
      const text = readFileSync(file, "utf8");
      for (const m of text.matchAll(call)) {
        const rel = path.relative(WEB, file).split(path.sep).join("/");
        found.set(m[1], [...(found.get(m[1]) ?? []), rel]);
      }
    }
  }
  return found;
}

/** Event types named in docs/plan/spec.md section 6 (backticked dotted names and scripted_fallback). */
function specSection6Types(): string[] | null {
  const file = path.join(WEB, "..", "docs", "plan", "spec.md");
  if (!existsSync(file)) return null; // docs/plan lives only in the main checkout, not in git
  const spec = readFileSync(file, "utf8");
  const start = spec.indexOf("## 6.");
  const end = spec.indexOf("## 7.", start);
  const section = spec.slice(start, end);
  const types = new Set<string>();
  for (const line of section.split("\n")) {
    if (!/^(事件类型|施工中加的事件)/.test(line)) continue;
    // event names have a dot, except scripted_fallback; other backticked words on these lines are field names
    for (const m of line.matchAll(/`([a-z_][a-z0-9_]*(?:\.[a-z0-9_]+)*)`/g)) if (m[1].includes(".") || m[1] === "scripted_fallback") types.add(m[1]);
  }
  return [...types];
}

describe("every published event type has its own sentence", () => {
  it("the scan finds the publish calls (sanity: the main flows are there, M5/M6/M7 included)", () => {
    const types = publishedTypes();
    for (const t of [
      "ask.received",
      "ask.blocked",
      "verify.layer1",
      "dose.logged",
      "clock.changed",
      "scripted_fallback",
      "utterance.role",
      "asr.partial",
      "question.created",
      "med.changed",
      // M6: his switches, her reminder recording; the director's reminder cue
      "family_grant.changed",
      "reminder.clip_added",
      "director.cue",
    ]) {
      expect(types.has(t), `${t} not found by the scan`).toBe(true);
    }
    // M5: the understanding checklist's "not sure" publishes question.created from its own module
    expect(types.get("question.created")).toContain("lib/explain/understanding.ts");
    expect(types.get("family_grant.changed")).toContain("lib/family/grants.ts");
    expect(types.get("reminder.clip_added")).toContain("app/api/reminders/route.ts");
  });

  it("each type published in web/lib and web/app has a renderer", () => {
    const missing = [...publishedTypes()].filter(([t]) => !RENDERERS[t]).map(([t, files]) => `${t} (${[...new Set(files)].join(", ")})`);
    expect(missing).toEqual([]);
  });

  it("each type in lib/bus.ts's lists and in spec section 6 has a renderer", () => {
    const spec = specSection6Types();
    if (spec) {
      expect(spec.length).toBeGreaterThanOrEqual(20);
      expect(spec).toContain("asr.fallback");
    }
    const all = new Set<string>([...SPEC_EVENT_TYPES, ...EXTRA_EVENT_TYPES, ...(spec ?? [])]);
    expect([...all].filter((t) => !RENDERERS[t])).toEqual([]);
  });

  it("a renderer never falls back to the generic line for its own type, even with empty data", () => {
    for (const type of Object.keys(RENDERERS)) {
      for (const data of [{}, null]) {
        const e: BusEvent = { id: 1, type: type as BusEvent["type"], session_id: "s", at: "2026-10-09T08:00:00.000Z", say: "SAY-FALLBACK", data };
        const line = renderEvent(e);
        expect(line.known, type).toBe(true);
        expect(line.sentence.length, type).toBeGreaterThan(0);
        // its own sentence, written from the event's data: never the publisher's `say` (nor a renderer that threw)
        expect(line.sentence, type).not.toContain("SAY-FALLBACK");
      }
    }
    const unknown = renderEvent({ id: 2, type: "made.up" as BusEvent["type"], session_id: "s", at: "", say: "Something happened", data: null });
    expect(unknown).toMatchObject({ known: false, sentence: "Something happened" });
  });
});

describe("highlights", () => {
  const ev = (type: string, data: unknown): BusEvent => ({ id: 1, type: type as BusEvent["type"], session_id: "s", at: "2026-10-09T08:00:00.000Z", say: "say", data });

  it("a blocked sentence shows the layer and why; a refused request says it was not answered", () => {
    const line = renderEvent(
      ev("ask.blocked", { sentence: { en: "You can take an extra tablet when your reading is high." }, layer: 2, reasons: ["directive_not_verbatim", "judgement_word"], replacedBy: "refer_doctor" }),
    );
    expect(line).toMatchObject({ tone: "blocked", badge: "Blocked · layer 2" });
    expect(line.sentence).toContain("layer 2");
    expect(line.sentence).toContain("You can take an extra tablet");
    expect(line.why).toEqual(reasonWords(["directive_not_verbatim", "judgement_word"]));
    expect(line.why!.join(" ")).toContain("instruction in Ripple's own words");
    const refused = renderEvent(ev("ask.blocked", { request: "今天 150/95，我能不能多吃一粒？", stage: "route", layer: null, reasons: ["rule:dose_change"], replacedBy: "refer_doctor", questionId: "q-extra-tablet" }));
    expect(refused).toMatchObject({ tone: "blocked", badge: "Blocked · the request" });
    expect(refused.sentence).toContain("Not answered");
    expect(refused.sentence).toContain("asks to change the dose");
  });

  it("who-said-it changes and scripted fallback stand out", () => {
    const role = renderEvent(ev("utterance.role", { visit_id: "v2", changes: [{ id: "v2-u06", role: "doctor", state: "confirmed" }] }));
    expect(role).toMatchObject({ tone: "role", badge: "Who said it" });
    expect(role.sentence).toBe("Who said it at the second visit: 1 sentence is the doctor's (confirmed).");
    expect(role.sentence).not.toContain("v2-u06");
    const many = renderEvent(
      ev("utterance.role", {
        visit_id: "v3",
        changes: [
          { id: "v3-u01", role: "doctor", state: "inferred" },
          { id: "v3-u02", role: "patient", state: "confirmed" },
          { id: "v3-u06", role: "doctor", state: "inferred" },
        ],
      }),
    );
    expect(many.sentence).toBe("Who said it at the third visit: 2 sentences are the doctor's (Ripple's guess), 1 sentence is Mr Tan's (confirmed).");
    const fb = renderEvent(ev("scripted_fallback", { visit_id: "v1", utterance_id: "v1-u02", heard: "Shore, know prob lame.", script: "Sure, no problem." }));
    expect(fb).toMatchObject({ tone: "fallback", badge: "Scripted fallback" });
    expect(fb.sentence).toContain("Sure, no problem.");
  });

  it("the understanding checklist's question reads with the item's own words", () => {
    const line = renderEvent(
      ev("question.created", {
        question: { for: "doctor", text: "Amlodipine：没感觉要不要吃？" },
        understanding: { med_id: "med-amlodipine", item: "feel_fine", label: "Whether to take it when I feel fine", answer: "unsure" },
      }),
    );
    expect(line.sentence).toBe("Understanding check: he is not sure about “Whether to take it when I feel fine”, so “Amlodipine：没感觉要不要吃？” is on his questions for the doctor.");
  });

  it("the hero question's real events all render, with the refused request highlighted", async () => {
    const store = getMemoryStore();
    const s = await store.createSession({ story_day: 29, story_time: "20:15", ttl_hours: 1 });
    const events: BusEvent[] = [];
    await ask(
      { sessionId: s.id, text: "今天 150/95，我能不能多吃一粒？", locale: "zh-Hans" },
      {
        store,
        llm: createMockLlm(),
        checker: null,
        checkerReason: "test",
        costGuard: null,
        publish: (sid, type, say, data) => void events.push({ id: events.length + 1, type, session_id: sid, at: new Date().toISOString(), say, data }),
      },
    );
    const lines = events.map(renderEvent);
    expect(lines.every((l) => l.known)).toBe(true);
    expect(events.map((e) => e.type)).toEqual(expect.arrayContaining(["ask.received", "ask.route", "verify.layer1", "verify.layer2", "verify.layer3", "ask.blocked", "ask.answered"]));
    const blocked = lines[events.findIndex((e) => e.type === "ask.blocked")];
    expect(blocked.tone).toBe("blocked");
    expect(lines[events.findIndex((e) => e.type === "verify.layer3")].sentence).toContain("not needed");
  });
});

/**
 * Layer 3 in plain words (10-10; Hunyuan since 10-16): the checker is hy4-preview next to the main model hy3, the same vendor
 * and a different model (10-09), so no backstage line calls it a second, independent or other vendor's checker.
 */
describe("layer 3 names the checker model as what it is", () => {
  const ev = (type: string, data: unknown): BusEvent => ({ id: 1, type: type as BusEvent["type"], session_id: "s", at: "2026-10-10T08:00:00.000Z", say: "say", data });
  const ran = [
    { ran: true, needed: true, pass: true, reasons: [] },
    { ran: true, needed: true, pass: false, reasons: ["checker_not_supported"] },
  ];
  const NOT_ANOTHER_CHECKER = /second|independent|vendor|cross-model/i;

  it("the Hunyuan checker is “the checker model (Hy4 preview)”, lib/llm's default checker model", () => {
    expect(HUNYUAN_CHECKER_NAME.toLowerCase().replace(/ /g, "-")).toBe(HUNYUAN_CHECKER_MODEL);
    const line = renderEvent(ev("verify.layer3", { checker: "hunyuan", sentences: ran }));
    expect(line).toMatchObject({
      sentence: "Layer 3, the checker model (Hy4 preview): 1 of 2 sentences passed, 1 stopped.",
      tone: "blocked",
      badge: "Stopped at layer 3, the checker model (Hy4 preview)",
      why: ["the checker model said its source does not support it"],
    });
    // the other two layers' badges read as before
    const l1 = renderEvent(ev("verify.layer1", { sentences: [{ ran: true, pass: false, reasons: ["unknown_source"] }] }));
    expect(l1.badge).toBe("Stopped at layer 1, sources, numbers and names");
  });

  it("replayed, offline, another provider's or no checker: each named from the event, none as a second checker", () => {
    expect(checkerName("replay:hunyuan")).toBe("the checker model (Hy4 preview, replayed)");
    expect(checkerName("mock")).toBe("the checker model (offline stand-in)");
    expect(checkerName("anthropic")).toBe("the checker model (anthropic)");
    expect(checkerName(null)).toBe("the checker model");
    const none = renderEvent(ev("verify.layer3", { checker: null, sentences: [{ ran: true, needed: true, pass: false, reasons: ["no_checker"] }] }));
    expect(none).toMatchObject({ sentence: "Layer 3, the checker model: 0 of 1 sentences passed, 1 stopped.", why: ["it needs the checker model and none is configured"] });
    const words = reasonWords(["no_checker", "checker_not_supported", "checker_error"]);
    expect(words).toEqual(["it needs the checker model and none is configured", "the checker model said its source does not support it", "the checker model failed or timed out"]);
    const lines = [...Object.values(REASON_WORDS), ...["hunyuan", "replay:hunyuan", "mock", null].map((c) => renderEvent(ev("verify.layer3", { checker: c, sentences: ran })))].map((x) =>
      typeof x === "string" ? x : `${x.sentence} ${x.badge ?? ""} ${(x.why ?? []).join(" ")}`,
    );
    for (const text of lines) expect(text).not.toMatch(NOT_ANOTHER_CHECKER);
  });

  it("the real layer-3 event names the checker it ran with (the pipeline's `checker` field)", async () => {
    const store = getMemoryStore();
    const s = await store.createSession({ story_day: 29, story_time: "20:15", ttl_hours: 1 });
    const events: BusEvent[] = [];
    await ask(
      { sessionId: s.id, text: "今天 150/95，我能不能多吃一粒？", locale: "zh-Hans" },
      {
        store,
        llm: createMockLlm(),
        // a stand-in named like the Hunyuan checker client (lib/llm names a client by its CHECKER_PROVIDER)
        checker: createDecidingChecker(() => false, "hunyuan"),
        checkerReason: null,
        costGuard: null,
        publish: (sid, type, say, data) => void events.push({ id: events.length + 1, type, session_id: sid, at: new Date().toISOString(), say, data }),
      },
    );
    const layer3 = events.find((e) => e.type === "verify.layer3")!;
    expect((layer3.data as { checker: unknown }).checker).toBe("hunyuan");
    expect(renderEvent(layer3).sentence).toBe("Layer 3, the checker model (Hy4 preview): not needed, every sentence is a quote, a leaflet line or a template.");
    // the publisher's own `say` (raw JSON, logs) says the same: the checker model, not a cross-model check (10-10)
    expect(layer3.say).toBe("Layer 3 (checker model): not needed, every sentence is a quote, a leaflet line or a template");
  });

  it("the layer-3 event's `say` names the checker model when it runs and when none is configured, never cross-model", async () => {
    const ev = evidenceFor(getPatientText("amlodipine.purpose")!)!;
    const paraphrase = { speechAct: "restate" as const, sourceId: "hh-amlodipine:amlodipine.purpose", span: ev.en, slots: {}, en: "Amlodipine is a blood pressure medicine.", attribution: "leaflet" };
    const say = async (checker: LlmClient | null) =>
      (await runAsk({ text: "What is amlodipine for?", locale: "en", day: 29 }, { inject: () => [paraphrase], checker })).events.find((e) => e.type === "verify.layer3")!.say;
    const none = await say(null);
    const ran = await say(createDecidingChecker(() => true, "hunyuan"));
    // with no checker the paraphrase is stopped at layer 3 and the referral template that replaces it is checked too
    expect(none).toBe("Layer 3 (checker model): 2/3 passed (no checker configured: borderline sentences blocked)");
    expect(ran).toBe("Layer 3 (checker model): 2/2 passed");
    for (const text of [none, ran]) expect(text).not.toMatch(NOT_ANOTHER_CHECKER);
  });
});

describe("M3/M5/M6 events render from their own data", () => {
  const ev = (type: string, data: unknown, say = "SAY-FALLBACK"): BusEvent => ({ id: 1, type: type as BusEvent["type"], session_id: "s", at: "2026-10-09T08:00:00.000Z", say, data });

  it("real events from the flows: the understanding checklist, his switches, a new box, the director's reminder", async () => {
    const store = getMemoryStore();
    const s = await store.createSession({ story_day: 29, story_time: "08:30", ttl_hours: 1 });
    const json = (method: "POST" | "PATCH", p: string, body: unknown) =>
      new NextRequest(`http://localhost${p}?session=${s.id}`, { method, headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
    await answerUnderstanding({ sessionId: s.id, medId: "med-amlodipine", item: "feel_fine", answer: "unsure", locale: "en" }, { store });
    // only his phone (a device with a patient row) changes the switches (lib/family/role.ts denyNonPatient, 10-09 B1)
    const his = await store.addMember(s.id, { role: "patient" });
    const grantReq = new NextRequest(`http://localhost/api/family/grants?session=${s.id}`, { method: "POST", headers: { "content-type": "application/json", cookie: `rp_session=${s.id}; rp_member=${his.id}` }, body: JSON.stringify({ items: { notes: true, bp_summary: false } }) });
    expect((await grantsPost(grantReq)).status).toBe(200);
    expect((await medPatch(json("PATCH", "/api/meds/med-amlodipine", { action: "relabel" }), { params: Promise.resolve({ id: "med-amlodipine" }) })).status).toBe(200);
    await cueReminder(getMemoryStore(), (await store.getSession(s.id))!);

    const events = getBus().recent(s.id);
    expect(events.map((e) => e.type)).toEqual(expect.arrayContaining(["question.created", "family_grant.changed", "med.changed", "director.cue"]));
    for (const e of events) {
      const line = renderEvent(e);
      expect(line.known, e.type).toBe(true);
      expect(line.sentence, e.type).not.toBe(e.say);
    }
    const sentence = (type: string) => renderEvent(events.find((e) => e.type === type)!).sentence;
    const unsure = (await store.listQuestions(s.id)).find((q) => q.origin === "understanding_check")!;
    expect(sentence("question.created")).toBe(`Understanding check: he is not sure about “Whether to take it when I feel fine”, so “${unsure.text}” is on his questions for the doctor.`);
    const grants = sentence("family_grant.changed");
    expect(grants.startsWith("Mr Tan changed what Wei Ling may see: ")).toBe(true);
    expect(grants).toContain("notes on");
    expect(grants).toContain("bp summary off");
    expect(sentence("med.changed")).toBe("Amlodipine 5 mg: a new box, so its label is to be photographed again.");
    expect(sentence("director.cue")).toBe("Director: the reminder pops up now on every patient phone, with Wei Ling's reminder.");
  });

  it("med.changed by kind: the medicine by name (never its row id); a label read shows only the printed name and the match", () => {
    const amlo = { id: "med-amlodipine", drug_id: "amlodipine", origin: "prescription", label: { text: "AMLODIPINE 5MG TABLET\nTake ONE tablet every MORNING", strength: "5 mg", directions: "Take ONE tablet every MORNING" }, pharmacist_answer: null };
    const box = { id: "med-relative-box", drug_id: null, origin: "relative", label: { text: "(Chinese-only label)" }, pharmacist_answer: { visit_id: "p1", text: "The label is only in Chinese and I can't confirm what's inside." } };
    const cases: [unknown, string][] = [
      [{ kind: "label.read_failed", code: "vision_unavailable" }, "A label photo could not be read (vision unavailable); his medicine list did not change."],
      [
        { kind: "label.read", provider: "mock", fields: { drug_text: "AMLODIPINE 5MG TABLET", drug_id: "amlodipine", match: "exact", strength: "5 mg", directions: "Take ONE tablet every MORNING" } },
        "Label photo read: “AMLODIPINE 5MG TABLET” matches Amlodipine (exact match); waiting for him to confirm.",
      ],
      [{ kind: "label.read", provider: "mock", fields: { drug_text: "某某药", drug_id: null, match: null } }, "Label photo read: “某某药” is not a medicine Ripple can identify; waiting for him to confirm."],
      [{ kind: "label.confirmed", med: amlo, outcome: "label_confirmed", created: false }, "He confirmed the label: Amlodipine 5 mg is updated in his medicine list."],
      [{ kind: "label.confirmed", med: { ...box, pharmacist_answer: null }, outcome: "unidentified", created: true }, "He confirmed the label photo: Ripple cannot identify this medicine, so it is saved as unidentified."],
      [{ kind: "label.relabel", med: amlo }, "Amlodipine 5 mg: a new box, so its label is to be photographed again."],
      [{ kind: "answer.linked", med: box }, "The pharmacist's answer from the pharmacy visit is saved with the relative's box (not identified)."],
      [{ kind: "answer.linked", med: amlo }, "An answer from a visit is linked to the question about Amlodipine 5 mg."],
    ];
    for (const [data, want] of cases) {
      const line = renderEvent(ev("med.changed", data));
      expect(line.sentence).toBe(want);
      expect(line.sentence).not.toContain("med-");
      expect(line.sentence).not.toContain("Take ONE tablet");
    }
  });

  it("visit.changed: replay or recording started, the status in words, the crew key unlock", () => {
    const s = (data: unknown) => renderEvent(ev("visit.changed", data)).sentence;
    expect(s({ visit: { id: "v1", day: 0, status: "recording" }, mode: "replay" })).toBe("The first visit (Day 0): replay started.");
    expect(s({ visit: { id: "v2", day: 8, status: "recording" }, mode: "live" })).toBe("The second visit (Day 8): recording started.");
    expect(s({ visit: { id: "v1", status: "transcribing" }, job_id: "job-1" })).toBe("The first visit: making the full transcript.");
    expect(s({ visit: { id: "v1", status: "review" } })).toBe("The first visit: the full record is ready, waiting for his check.");
    expect(s({ visit: { id: "v3", status: "confirmed" } })).toBe("The third visit: he confirmed the record.");
    expect(s({ visit: { id: "a1b2c3", status: "confirmed" } })).toBe("The visit: he confirmed the record.");
    expect(s({ visit_id: "v1", fallback_unlocked: true })).toBe("The first visit: the film crew signed in, so the scripted fallback can be switched on in this filming session.");
  });

  // C2 track F (only add): the example account's sample visit (real-app 4.6: 后台事件写「sample recording」)
  it("visit.changed of the example account's sample visit says sample recording, at its start, when its record is ready and when he confirmed it", () => {
    const s = (data: unknown) => renderEvent(ev("visit.changed", data)).sentence;
    expect(s({ visit: { id: "v3", day: 42, status: "recording" }, mode: "replay", sample: true })).toBe("Sample recording: the example's visit is being replayed, not his own visit.");
    expect(s({ visit: { id: "v3", status: "review" }, sample: true })).toBe("Sample recording: the full record is ready, waiting for his check.");
    expect(s({ visit: { id: "v3", status: "confirmed" }, sample: true })).toBe("Sample recording: he confirmed the record.");
  });

  it("her reminder recording and a question without its text still read as their own sentences", () => {
    expect(renderEvent(ev("reminder.clip_added", { clip: { id: "c1", by: "wei-ling", text: "爸，药记得吃哦。" } }, "Wei Ling recorded a reminder")).sentence).toBe(
      "Wei Ling recorded a reminder for her father.",
    );
    expect(renderEvent(ev("question.created", { question: { for: "pharmacist" } })).sentence).toBe("Added a question for the pharmacist.");
    expect(renderEvent(ev("question.updated", { question: { for: "doctor" }, reused: true })).sentence).toBe("Already on today's questions for the doctor.");
  });
});

/**
 * C2 track E (real-status "导演台和评委页"): judges read the backstage on /demo, so a sentence carries no program name or
 * code (rule:…, verify.layer3, an utterance id such as v3-u06, a visit id), no filming words ("Hero shot", "v3
 * direction", "rehearsal") and the right plural. The codes stay in the raw data.
 */
describe("judges read plain words", () => {
  const ev = (type: string, data: unknown): BusEvent => ({ id: 1, type: type as BusEvent["type"], session_id: "s", at: "2026-10-10T12:15:00.000Z", say: "say", data });
  const CODES = /\brule:|verify\.layer|\bv\d-u\d+|\bvisit (v\d|p\d)\b|Hero shot|direction\)|rehearsal|_/;

  it("what a message was sorted as, and by whom, in words", () => {
    expect(renderEvent(ev("ask.route", { route: "refuse_route", reason: "rule:dose_change" })).sentence).toBe(
      "Sorted as a request that is not Ripple's to answer, by a fixed rule (it asks to change the dose).",
    );
    expect(renderEvent(ev("ask.route", { route: "explain", reason: "model:hunyuan" })).sentence).toBe("Sorted as a question Ripple can answer from its sources, by the main model.");
    expect(renderEvent(ev("ask.route", { route: "emergency", reason: "rule:emergency; raised from log_only by crisis words, no crisis screen (offline)" })).sentence).toBe(
      "Sorted as an emergency, raised by its crisis words (no crisis check ran).",
    );
    expect(renderEvent(ev("ask.route", { route: "emergency", reason: "model_crisis:hunyuan:emergency; raised from explain by the crisis screen" })).sentence).toBe(
      "Sorted as an emergency, raised by the crisis check.",
    );
    expect(renderEvent(ev("ask.route", { route: "emergency", reason: "rule:emergency; crisis screen unavailable (timeout), rules only" })).sentence).toBe(
      "Sorted as an emergency, by a fixed rule; rules only: the crisis check could not run.",
    );
    expect(renderEvent(ev("ask.route", { route: "log_only", reason: "rule:statement; cost guard requests_per_hour reached, rules only" })).sentence).toBe(
      "Sorted as something to note, not a question, by a fixed rule; rules only: the question limit was reached.",
    );
    expect(renderEvent(ev("ask.answered", { route: "explain", sentences: [{}], latencyMs: 812 })).sentence).toBe(
      "Answered (a question Ripple can answer from its sources) with 1 sourced sentence in 812 ms.",
    );
    expect(renderEvent(ev("ask.answered", { route: "refuse_route", sentences: [{}, {}, {}], latencyMs: 1234 })).sentence).toBe(
      "Answered (a request that is not Ripple's to answer) with 3 sourced sentences in 1.2 s.",
    );
  });

  it("a scene by its plain title, never the director's stage direction", () => {
    const hero = renderEvent(ev("clock.changed", { session: { story_day: 29, story_time: "20:15" }, beat: { id: "d29-hero", title: "Hero shot: 150/95 in the evening" } })).sentence;
    expect(hero).toBe("Story clock moved to Day 29 20:15: Evening: 150/95, can he take one more tablet?");
    expect(hero).not.toContain("Hero shot");
    const v3 = renderEvent(ev("clock.changed", { session: { story_day: 42, story_time: "09:30" }, beat: { id: "d42-visit", title: "Third visit (v3 direction)" } })).sentence;
    expect(v3).toBe("Story clock moved to Day 42 09:30: Third visit: the follow-up.");
    expect(renderEvent(ev("clock.changed", { session: { story_day: 12, story_time: null }, beat: null })).sentence).toBe("Story clock moved to Day 12.");
  });

  it("the director's cues: scenes, replays, a no-reply with nothing left to mark", () => {
    expect(renderEvent(ev("director.cue", { cue: "show", path: "/p/visit", why: "scene", beat: "d42-visit" })).sentence).toBe(
      "Director: the phones open the page of this scene (Third visit: the follow-up).",
    );
    expect(renderEvent(ev("director.cue", { cue: "show", path: "/p/visit?replay=v3", why: "replay", beat: null })).sentence).toBe("Director: the phones open the visit and play it.");
    expect(renderEvent(ev("director.cue", { cue: "replay_stopped", visits: ["v3"], why: "clock" })).sentence).toBe("The visit replay stopped (the story clock moved).");
    expect(renderEvent(ev("director.cue", { cue: "replay_stopped", visits: ["v3"], why: "director" })).sentence).toBe("The visit replay stopped (the director stopped it).");
    expect(renderEvent(ev("director.cue", { cue: "no_reply", marked: [] })).sentence).toBe("Director: no reply simulated, but every tablet of that time was already recorded.");
    expect(renderEvent(ev("director.cue", { cue: "no_reply", marked: ["med-amlodipine"] })).sentence).toBe("Director: no reply simulated, 1 tablet recorded as not confirmed.");
  });

  it("no code, program name or filming word in the sentences of a visit and a question", () => {
    const events = [
      ev("asr.partial", { visit_id: "v3", utterance: { id: "v3-u06", text: "Your pressure is better." } }),
      ev("asr.final", { visit_id: "v3", utterances: [{ id: "v3-u06", role: "doctor", role_state: "inferred", text: "Your pressure is better." }] }),
      ev("utterance.role", { visit_id: "v3", changes: [{ id: "v3-u06", role: "doctor", state: "confirmed" }] }),
      ev("card.created", { visit_id: "v3", card: { kind: "chk", check: "bp" } }),
      ev("visit.changed", { visit: { id: "v3", day: 42, status: "recording" }, mode: "replay" }),
      ev("ask.route", { route: "refuse_route", reason: "rule:dose_change" }),
      ev("verify.layer1", { sentences: [{ ran: true, pass: true, reasons: [] }] }),
      ev("session.member_joined", { member: { role: "patient" } }),
      ev("session.reset", {}),
      ev("session.filming_mode", { session: { filming_mode: true } }),
      ev("asr.fallback", { visit_id: "v3", reason: "unauthorized", during: "live", replay: "v3" }),
    ];
    for (const e of events) {
      const line = renderEvent(e);
      expect(line.sentence, e.type).not.toMatch(CODES);
      expect(`${line.badge ?? ""} ${(line.why ?? []).join(" ")}`, e.type).not.toMatch(CODES);
    }
    expect(renderEvent(events[3]).sentence).toBe("New check card (blood pressure) on the visit screen.");
    expect(renderEvent(events[7]).sentence).toBe("Mr Tan's phone joined.");
    expect(renderEvent(events[10]).sentence).not.toContain("web/.env");
  });
});
