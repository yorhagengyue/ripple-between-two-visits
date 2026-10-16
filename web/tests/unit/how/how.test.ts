/**
 * M8 /how: the architecture boxes come from one config (lib/how/stack.ts); the products and models are the 10-16
 * decisions: Tencent Cloud Hunyuan hy3 on TokenHub as the main model (thinking off), hy4-preview as the layer-3 checker
 * from the same vendor (said plainly; the note says the 51-question evaluation has not been run with them, and that is
 * held against web/eval/results), Tencent Cloud speech recognition
 * decided on 10-14 (recorded replays on the judges' link until it is switched to it; the local Whisper service on the
 * filming laptop answers the same screens), Ripple's summary of a visit as Ripple's own notes that are never a source,
 * TRTC TTS as mock until keys exist and the voice is checked
 * (lib/tts/trtc.ts is written to the vendor's pages and has not met the real service), hosting decided but not running (Tencent Cloud Lighthouse + EdgeOne,
 * docs/plan/hosting.md), Supabase for data; never "TRTC speech recognition"; the audio retention says what the code
 * does (no deletion job); AIHGle 2.0 is quoted only with the given strings and citation.
 * The claims about the code are also run against the code: every case /how lists as blocked at layer 3 (not
 * configured, timeout, the answer's deadline, the spend cap, anything but a literal true) is blocked by verify.ts;
 * layer 1's whole sentences (text.ts: punctuation, a leaning neighbour, a bare refusal or condition before it and a
 * limit or correction after it with tone particles stripped, a passage whose refusal is followed by another sentence
 * refused whole), a spoken line or a label shown whole or not at all (verify.ts sourceQuote, wholeSourceBlock: a negated
 * verb with no object, a mark after a refusal, the same speaker's neighbour line via candidates.ts lineContext, a
 * printed label excepted), relevance (verify.ts relevanceReasons: R3, labels and leaflet restatements held to the ask,
 * R1, R2 and R4 exempt) and the plain-label Mandarin template (zh.ts) do what the lines say; with no crisis screen the
 * rules act on symptom words (classify.ts emergencyCue -> the 995 template) and a statement with self-harm words gets
 * the helplines (pipeline.ts applyRulesOnlyCue); a note, or any other answer near crisis words, that no crisis screen
 * looked at gets the fixed safety line (pipeline.ts, referral B4-01), also when the live screen answered none
 * (screen_none), with the helplines after it near self-harm words (selfHarmCue), and every crisis word /how gives as an
 * example is on classify.ts's crisisCue list, which /how calls fixed and not complete; someone else's crisis gets the
 * templates about them and no R2 (classify.ts aboutSomeoneElse); over the per-person question limit a note or crisis
 * words are answered by the rules alone and other questions get 429 (cost-guard.ts, pipeline.ts, app/api/ask); a
 * failing Whisper service puts the replay on screen only for a sample visit with ASR_REPLAY_FALLBACK on and never
 * makes a recorded visit's record from a script (lib/asr/whisper.ts, app/api/asr/chunk); Wei Ling's phone is closed
 * by default with a live stream that carries none of his words and nothing for an event she may not see
 * (lib/family/gate.ts, events.ts); once she has joined, a device with no member row in his session gets nothing but
 * the join (lib/family/identity.ts); a request with no device cookie gets only ANONYMOUS_API; GET /api/session lists
 * no member ids; and the joining code makes a device only what lib/family/join.ts allows.
 * The plan documents are checked against the code in docs-sync.test.ts.
 */
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { NextRequest } from "next/server";
import { describe, expect, it } from "vitest";
import { GET as sessionGET } from "@/app/api/session/route";
import { AIHGLE, ARCHITECTURE_ROWS, STACK, STATUS_TEXT, stackText } from "@/lib/how/stack";
import { OCR_ACCURATE, OCR_BASIC, OCR_REGION } from "@/lib/vision/ocr";
import { replayFallbackAllowed } from "@/lib/asr/whisper";
import type { BusEvent } from "@/lib/bus";
import { createFamilyStream, FAMILY_SESSION_FIELDS, familyEvent } from "@/lib/family/events";
import { ANONYMOUS_API, FAMILY_API, FAMILY_PAGES, familyAccess, familyGate, proxyDirectory } from "@/lib/family/gate";
import { joinRefusal, PATIENT_EXISTS, ROLE_NOT_JOINABLE, type JoinFacts } from "@/lib/family/join";
import { denyNonPatient } from "@/lib/family/role";
import { GRANT_KEYS, NO_GRANTS } from "@/lib/family/types";
import { REAL_RECORDING } from "@/lib/how/real-recording";
import { runtimeStack } from "@/lib/how/runtime";
import { TENCENT_ASR_DEFAULTS } from "@/lib/asr/tencent";
import { LIVE_SUMMARY_EVERY_MS, MAX_POINTS } from "@/lib/visit/ripple-summary";
import { AUDIO, CLINICAL_TEXT, FAMILY, RECORDING_RETENTION_DAYS } from "@/lib/how/trust";
import { AUDIO_KEEP_DAYS } from "@/lib/privacy/rules";
import { evidenceFor, getPatientText } from "@/lib/kb/load";
import { createMockLlm, HUNYUAN_CHECKER_MODEL, HUNYUAN_MAIN_MODEL, LlmError, type ChatResult, type LlmClient } from "@/lib/llm";
import { lineContext } from "@/lib/safety/candidates";
import { classifyRules, crisisCue, emergencyCue, selfHarmCue } from "@/lib/safety/classify";
import { CostGuard, CostLimitError } from "@/lib/safety/cost-guard";
import { OTHER_SUBSTANCE } from "@/lib/safety/substances";
import { ask } from "@/lib/safety/pipeline";
import { renderText } from "@/lib/safety/render";
import { TEMPLATES } from "@/lib/safety/templates";
import type { Candidate, Sentence } from "@/lib/safety/types";
import { ambiguousBoundary, isBareCondition, isBareNegation, matchWholeSentences, sameQuote, sentenceSpans, stripParticles } from "@/lib/safety/text";
import { layer3, provenanceReasons, relevanceReasons, sourceQuote, wholeSourceBlock } from "@/lib/safety/verify";
import type { SessionMemberRow } from "@/lib/store/types";
import { zhFromSlots } from "@/lib/safety/zh";
import { getMemoryStore } from "@/lib/store/memory";
import { TtsError, ttsProviderName } from "@/lib/tts";
import { createTrtcTts } from "@/lib/tts/trtc";

const WEB = process.cwd();
const trustText = () => [...CLINICAL_TEXT, AUDIO, FAMILY].flatMap((z) => [z.title, ...z.lines]).join("\n");
const result = (file: string) => JSON.parse(readFileSync(path.join(WEB, "eval", "results", file), "utf8"));
const src = (...p: string[]) => readFileSync(path.join(WEB, ...p), "utf8");
const serverLine = (start: string) => CLINICAL_TEXT[1].lines.find((l) => l.startsWith(start)) ?? "";

describe("the architecture config", () => {
  it("names each box's product and model as decided (the model on 10-16)", () => {
    expect(HUNYUAN_MAIN_MODEL).toBe("hy3");
    expect(HUNYUAN_CHECKER_MODEL).toBe("hy4-preview");
    expect(STACK.main_model).toMatchObject({ product: "Tencent Cloud Hunyuan", model: HUNYUAN_MAIN_MODEL, status: "in_use" });
    expect(STACK.main_model.note).toContain("thinking mode off");
    expect(STACK.main_model.note).toContain("TokenHub");
    // owner 10-15: Ripple answers everyday questions and words the 995 answers; it never changes his medicines
    expect(STACK.main_model.note).toContain("answers everyday health questions in his language as the owner's policy file says");
    expect(STACK.main_model.note).toContain("It never tells him to change his medicines.");
    expect(STACK.checker).toMatchObject({ product: "Tencent Cloud Hunyuan", model: HUNYUAN_CHECKER_MODEL, status: "in_use" });
    expect(STACK.checker.productZh).toBeUndefined();
    // the owner's decision of 10-14: Tencent Cloud speech recognition (lib/asr/tencent.ts), deployed that evening
    expect(STACK.stt).toMatchObject({ product: "Tencent Cloud speech recognition", status: "in_use" });
    expect(STACK.stt.model).toBe("16k_zh_en (Mandarin and English mixed in one engine), with the names of the medicines Ripple knows as hot words");
    expect(STACK.stt.note).toContain("recorded replays");
    expect(STACK.stt.note).toContain("Not split by speaker");
    expect(STACK.stt.note).toContain("in Singapore");
    expect(STACK.stt.note).toContain("pieces of at most 100 seconds, cut at pauses");
    expect(STACK.stt.note).toContain("the local Whisper service on the filming laptop can answer the same screens");
    // what the note says is the code's: the region, the engine, the piece
    expect(TENCENT_ASR_DEFAULTS).toMatchObject({ region: "ap-singapore", engine: "16k_zh_en", pieceMs: 100_000 });
    expect(STACK.main_model.note).toContain("writes short notes of what was said at a visit (shown as Ripple's and not confirmed, never a source)");
    expect(STACK.tts).toMatchObject({ product: "Tencent TRTC TTS", status: "mock_until_keys" });
    // the owner's decision of 10-16: label photos are read by Tencent Cloud OCR (lib/vision/ocr.ts), no model sees them
    expect(STACK.ocr).toMatchObject({ product: "Tencent Cloud OCR", model: "GeneralAccurateOCR, checked against GeneralBasicOCR", status: "in_use" });
    for (const w of ["in Singapore", "only after Mr Tan agrees to AI processing", "No model sees the photo", "Two engines read it side by side", "when the two name different medicines he is asked for a new photo", "left out for him to fill in", "never the whole text"]) expect(STACK.ocr.note, w).toContain(w);
    expect(STACK.main_model.note).toContain("label photos go to no model: Tencent Cloud OCR reads their words");
    expect(STACK.main_model.note).not.toContain("he types the words of any other label");
    // what the note says is the code's: the region, the two engines
    expect([OCR_REGION, OCR_ACCURATE, OCR_BASIC]).toEqual(["ap-singapore", "GeneralAccurateOCR", "GeneralBasicOCR"]);
    expect(STACK.hosting).toMatchObject({ product: "Tencent Cloud Lighthouse + EdgeOne", status: "planned" });
    expect(STATUS_TEXT.planned).toBe("decided, not running yet");
    expect(STACK.hosting.note).toContain("next start");
    expect(STACK.hosting.note).toContain("Singapore recommended");
    expect(STACK.hosting.note).toContain("not bought yet");
    expect(STACK.database).toMatchObject({ product: "Supabase", status: "in_use" });
    expect(STACK.database.note).toContain("Tokyo (ap-northeast-1)");
    expect(STACK.database.note).toContain("its own production project");
    expect(ARCHITECTURE_ROWS.flat().sort()).toEqual(Object.keys(STACK).sort());
  });

  it("says plainly that the checker is the same vendor as the main model, and weaker for it", () => {
    expect(STACK.checker.note).toContain("same vendor as the main model");
    expect(STACK.checker.note).toContain("less independent than a checker from a second vendor");
    expect(STACK.checker.note).toContain("the sentence is blocked");
    const layer3Line = serverLine("Layer 3:");
    expect(layer3Line).toContain("same vendor as the main model");
    expect(layer3Line).toContain("weaker than one from a second vendor");
    expect(layer3Line).toContain("the sentence is blocked");
    // no box or zone still promises a second vendor or an undecided checker
    expect(`${stackText()}\n${trustText()}`).not.toMatch(/to be decided|待定|another vendor|second checker model/i);
    expect(`${stackText()}\n${trustText()}`).not.toMatch(/OpenAI|gpt-/);
  });

  it("hosting: always-on because of the replay timer and in-process state, not because of the event stream", () => {
    const note = STACK.hosting.note;
    expect(note).toContain("the visit replay is pushed sentence by sentence by a timer inside the server process");
    for (const state of ["voice transcription jobs", "the film crew's unlock of the scripted fallback"]) expect(note).toContain(state);
    // C2 track S (round 2): the ask limits are counted in the store now (lib/safety/cost-guard.ts StoreCostGuard), so
    // they are no longer in-process state, and the note no longer names them
    expect(note).not.toContain("cost guard");
    expect(src("lib", "safety", "cost-guard.ts")).toMatch(/this\.store\.rateHit\(/);
    expect(note).toContain("The live event stream alone would not need it: it can be set to reconnect on a timer");
    expect(note).not.toContain("live event stream and the visit replay need");
    // the code the note describes: the replay waits on setTimeout in-process; the stream can end on BUS_STREAM_MAX_MS
    expect(src("lib", "visit", "replay.ts")).toMatch(/setTimeout\(/);
    expect(src("app", "api", "events", "route.ts")).toContain("process.env.BUS_STREAM_MAX_MS");
  });

  it("read-aloud: a placeholder until TRTC keys exist; the adapter is written and has not met the real service (C2 track T)", async () => {
    expect(STATUS_TEXT[STACK.tts.status]).toBe("mock until keys exist and the TRTC voice is checked");
    expect(STACK.tts.note).toContain("Today a placeholder test voice plays");
    expect(STACK.tts.note).toContain("has never been run against the real service: there are no keys yet");
    expect(STACK.tts.note).toContain("a TRTC application and a Tencent Cloud API key pair, then one sentence checked by ear");
    // C2 track F, round three: no page draws a read-aloud button while the provider cannot speak (lib/tts readAloudOffered)
    expect(STACK.tts.note).toContain("no button is drawn while it cannot speak");
    expect(STACK.tts.note).not.toMatch(/until (TRTC )?keys exist a/i);
    // the code: no application id -> the mock voice; an application without a cloud API key pair -> the trtc provider,
    // chosen and not ready, which answers not_configured (POST /api/tts 503); with the pair it is ready
    expect(ttsProviderName({ TTS_PROVIDER: "trtc" })).toBe("mock");
    expect(ttsProviderName({ TTS_PROVIDER: "trtc", TRTC_SDK_APP_ID: "1", TRTC_SDK_SECRET_KEY: "x" })).toBe("trtc");
    expect(createTrtcTts({ TTS_PROVIDER: "trtc", TRTC_SDK_APP_ID: "1", TRTC_SDK_SECRET_KEY: "x" }).ready).toBe(false);
    expect(createTrtcTts({ TTS_PROVIDER: "trtc", TRTC_SDK_APP_ID: "1", TENCENT_SECRET_ID: "i", TENCENT_SECRET_KEY: "k" }).ready).toBe(true);
    // an explicit environment, never this machine's: with real keys in the shell this line would otherwise speak
    const err = await createTrtcTts({ TTS_PROVIDER: "trtc", TRTC_SDK_APP_ID: "1", TRTC_SDK_SECRET_KEY: "x" })
      .synthesize({ text: "测试", lang: "zh-Hans" })
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(TtsError);
    expect((err as TtsError).code).toBe("not_configured");
    expect(src("app", "api", "tts", "route.ts")).toContain("503 tts_not_configured (trtc chosen and a setting is missing");
  });

  it("never says TRTC does speech recognition", () => {
    const text = `${stackText()}\n${trustText()}`;
    for (const bad of [/TRTC\s*语音识别/, /TRTC[^\n]*speech recognition/i, /TRTC[^\n]*\bASR\b/, /TRTC[^\n]*speech[- ]to[- ]text/i]) expect(text).not.toMatch(bad);
  });

  it("the page takes every product and model name from lib/how/stack.ts (none written in the page itself)", () => {
    const page = readFileSync(path.join(WEB, "app", "how", "page.tsx"), "utf8").replace(/\/\*\*[\s\S]*?\*\//, "");
    for (const name of ["DeepSeek", "deepseek", "Hunyuan", "TokenHub", "OpenAI", "gpt-", "Whisper", "TRTC", "Tencent", "Lighthouse", "Supabase", "EdgeOne", "Vercel", "Next.js"]) {
      expect(page, name).not.toContain(name);
    }
    expect(page).toContain('from "@/lib/how/stack"');
  });
});

describe("every case /how says layer 3 blocks is blocked by lib/safety/verify.ts", () => {
  const ev = evidenceFor(getPatientText("amlodipine.purpose")!)!;
  const SOURCE: Candidate = { sourceId: "hh-amlodipine:amlodipine.purpose", kind: "patient_text", span: ev.en, attribution: "leaflet", topics: ["purpose"], drugs: ["amlodipine"] };
  // a rewording in the model's own words: the only kind of sentence that goes to the checker
  const REWORDED: Sentence = { speechAct: "restate", sourceId: SOURCE.sourceId, span: ev.en, slots: {}, en: "Amlodipine is a blood pressure medicine.", attribution: "leaflet" };
  const checker = (reply: () => Promise<ChatResult>): LlmClient => ({ provider: "hunyuan", model: HUNYUAN_CHECKER_MODEL, chat: reply });
  const fails = (code: ConstructorParameters<typeof LlmError>[0]) => checker(async () => Promise.reject(new LlmError(code, `${code} (test)`)));

  it("the checker note and the Layer 3 line both list the deadline and the spend cap", () => {
    expect(STACK.checker.note).toContain("Not configured, a timeout, the answer's time limit reached, a call refused by the spend cap, or anything but a clear yes: the sentence is blocked.");
    expect(serverLine("Layer 3:")).toContain("is not configured, times out, runs past the answer's time limit, is refused by the spend cap or gives anything but a clear yes, the sentence is blocked");
  });

  it.each([
    ["not configured", null],
    ["a timeout", fails("timeout")],
    ["the answer's time limit", fails("deadline")],
    ["the spend cap", fails("budget")],
    ["the spend ledger unavailable", fails("ledger_unavailable")],
    ["not a literal true", checker(async () => ({ content: '{"supported":"yes"}', tokens: 3 }))],
    ["not JSON", checker(async () => ({ content: "Yes, supported.", tokens: 3 }))],
  ] as const)("%s: blocked", async (_name, client) => {
    const r = await layer3(REWORDED, SOURCE, client, client ? null : "CHECKER_PROVIDER not set");
    expect(r.needed).toBe(true);
    expect(r.pass).toBe(false);
  });

  it("a clear yes passes (control)", async () => {
    const r = await layer3(REWORDED, SOURCE, checker(async () => ({ content: '{"supported": true}', tokens: 3 })), null);
    expect(r).toMatchObject({ needed: true, pass: true });
  });
});

describe("the checker note says what was run with these two models (web/eval/results)", () => {
  it("no 51-question run with hy3 and hy4-preview yet: the note says so; a run written to eval/results fails this until the note gives its numbers", () => {
    const dir = path.join(WEB, "eval", "results");
    const runs = readdirSync(dir)
      .filter((f) => f.endsWith(".json"))
      .map((f) => ({ f, run: result(f) as { meta?: { llm?: { model?: string } } } }))
      .filter((x) => x.run.meta?.llm?.model === HUNYUAN_MAIN_MODEL);
    expect(runs.map((x) => x.f)).toEqual([]);
    expect(STACK.checker.note).toContain("The 51-question evaluation has not been run with these two models yet.");
    // the DeepSeek runs of 10-09 are gone with DeepSeek: the note quotes none of their numbers
    expect(STACK.checker.note).not.toMatch(/run twice|14 written sentences/);
  });
});

describe("the trust boundary says what the code does", () => {
  it("no component writes clinical text; the family view gets only granted sections", () => {
    const t = trustText();
    // owner 10-15: his sources first, then Ripple's own answer under its own line; the 995 wording keeps every number
    expect(t).toContain("his sources first, then Ripple's own answer");
    expect(t).toContain("Mandarin on a quote comes only from templates, reviewed restatements and checked translations");
    expect(t).toContain("以上是 Ripple 的一般健康信息，不是医生的话。");
    expect(t).toContain("never tells him, or lets him, take more or less of his medicine, double, skip, stop, halve or change it on his own");
    expect(t).toContain("nothing is added unless he taps it");
    expect(t).toContain("it must keep 995 and every number of the fixed lines");
    expect(t).not.toContain("I don't give medical advice of my own");
    expect(FAMILY.lines.join(" ")).toContain("leaves that section out of the data altogether");
  });

  it("her whole phone is closed by default and her live stream carries none of his words (lib/family/gate.ts, events.ts)", () => {
    const line = FAMILY.lines.find((l) => l.startsWith("Her phone is closed by default")) ?? "";
    expect(line).toContain("only her page and the joining page and call the few APIs her page needs, each listed with its reason");
    expect(line).toContain("any other API, including one added later, is refused before it runs");
    expect(line).toContain("it never carries his words, and an event it does not know is left out");
    // the story clock reaches her as the session row cut to what /f uses: never the joining code (B1 wrap-up 10-10)
    expect(line).toContain("the story clock (the story day and time, never the joining code)");
    expect([...FAMILY_SESSION_FIELDS].sort()).toEqual(["filming_mode", "id", "story_day", "story_time"]);
    const clock = familyEvent(
      { id: 3, type: "clock.changed", session_id: "s1", at: "2026-10-10T01:00:00.000Z", say: "Clock: Day 41", data: { session: { id: "s1", join_code: "ABC123", story_day: 41, story_time: "20:15", filming_mode: false, template: "mr-tan" }, beat: { label: "He mentions his ankle" } } },
      { ...NO_GRANTS },
    );
    expect(clock.event?.data).toEqual({ session: { id: "s1", story_day: 41, story_time: "20:15", filming_mode: false }, beat: null });
    // pages: only /f and /join; any other, including one added later, sends her back to /f
    expect(FAMILY_PAGES.map((p) => p.route).sort()).toEqual(["/f", "/join"]);
    for (const page of ["/", "/p/today", "/p/brief", "/how", "/backstage", "/a-page-added-later"]) {
      expect(familyAccess("GET", page), page).toEqual({ kind: "redirect", to: "/f" });
    }
    // APIs: every allowed one carries its reason; his data, acting for him and an unlisted route are refused
    for (const rule of FAMILY_API) expect(rule.why.length, `${rule.method} ${rule.route}`).toBeGreaterThan(10);
    expect(familyAccess("GET", "/api/family/view").kind).toBe("allow");
    for (const [method, p] of [
      ["GET", "/api/notes"],
      ["GET", "/api/bp"],
      ["GET", "/api/brief"],
      ["POST", "/api/ask"],
      ["POST", "/api/doses"],
      ["POST", "/api/family/grants"],
      ["GET", "/api/an-api-added-later"],
    ] as const) {
      expect(familyAccess(method, p), `${method} ${p}`).toEqual({ kind: "deny" });
    }
    // the stream: the backstage sentence and his words never reach her, with every switch on or off
    const all = { ...NO_GRANTS };
    for (const k of GRANT_KEYS) all[k] = true;
    const ev = (type: string, data: unknown): BusEvent => ({ id: 7, type: type as BusEvent["type"], session_id: "s1", at: "2026-10-09T12:00:00.000Z", say: "Mr Tan wrote: my ankle hurts", data });
    const note = ev("note.logged", { note: { id: "n1", day: 29, text: "my ankle hurts" } });
    const hinted = familyEvent(note, all);
    expect(hinted.kind).toBe("hint");
    expect(hinted.event).toMatchObject({ say: "", data: {} });
    expect(JSON.stringify(hinted.event)).not.toContain("ankle");
    expect(familyEvent(note, NO_GRANTS)).toEqual({ kind: "dropped", event: null });
    const dose = familyEvent(
      ev("dose.logged", { dose: { id: "d1", medication_id: "med-amlodipine", day: 29, slot: "morning", state: "missed", reason: "own_words", reason_text: "my ankle hurts" }, name: "Amlodipine", by: "patient" }),
      all,
    );
    expect(dose.kind).toBe("trimmed");
    expect(dose.event?.say).toBe("");
    expect(dose.event?.data).toEqual({ dose: { medication_id: "med-amlodipine", day: 29, slot: "morning", state: "missed" } });
    expect(familyEvent(ev("an.event_added_later", { text: "my ankle hurts" }), all)).toEqual({ kind: "dropped", event: null });
    // an event she may not see sends nothing at all, not even its SSE id line (B1 fix 10-10)
    expect(line).toContain("For an event she may not see, nothing at all is sent, not even its number");
    expect(createFamilyStream({ ...NO_GRANTS }).frame(note)).toBe("");
    expect(createFamilyStream({ ...NO_GRANTS }).frame(ev("an.event_added_later", { text: "my ankle hurts" }))).toBe("");
    expect(createFamilyStream(all).frame(note)).toMatch(/^id: 7\n/);
  });

  it("once she has joined, a device with no member row in his session gets only the join; her phone elsewhere gets nothing (lib/family/identity.ts)", async () => {
    const line = FAMILY.lines.find((l) => l.startsWith("Once she has joined")) ?? "";
    expect(line).toContain("her phone with its cookies dropped (a private window) or any new browser can only join with the code, so every other page sends it to the joining page and every API refuses it (403)");
    expect(line).toContain("Her phone naming another session gets nothing there.");
    expect(line).toContain("a call from a device with no member row cannot");
    // B1 wrap-up 10-10: a request with no device cookie gets nothing of his anywhere, and the member ids are never listed
    expect(line).toContain("A request that carries no device cookie at all gets nothing of his in any session");
    expect(line).toContain("The list of a session's members never shows a device's id, which is that device's credential.");
    expect(trustText()).not.toContain("a call that only names the session still counts as Mr Tan's side");
    expect(trustText()).not.toContain("still lets a device join as any role");
    const store = getMemoryStore();
    const dir = proxyDirectory({ STORE: "memory" });
    const his = await store.createSession({ story_day: 41, story_time: "20:15", ttl_hours: 1 });
    const other = await store.createSession({ story_day: 41, ttl_hours: 1 });
    const her = await store.addMember(his.id, { role: "family" });
    const herCookie = `rp_session=${his.id}; rp_member=${her.id}; rp_role=family`;
    const request = (method: string, p: string, cookie?: string, body?: unknown) =>
      new NextRequest(`http://localhost${p}`, { method, headers: { ...(cookie ? { cookie } : {}), ...(body ? { "content-type": "application/json" } : {}) }, body: body ? JSON.stringify(body) : undefined });
    // her phone with its cookies dropped, or forged as his: every API 403 member_required, every page to /join
    for (const cookie of [undefined, `rp_session=${his.id}`, `rp_session=${his.id}; rp_role=patient`]) {
      const api = await familyGate(request("GET", `/api/notes?session=${his.id}`, cookie), dir);
      expect(api?.status, cookie).toBe(403);
      expect(await api?.json()).toMatchObject({ error: "member_required" });
    }
    const page = await familyGate(request("GET", "/p/today", `rp_session=${his.id}`), dir);
    expect(page?.status).toBe(307);
    expect(new URL(page!.headers.get("location")!).pathname).toBe("/join");
    // joining with the code is the one way in
    expect(await familyGate(request("POST", "/api/session/join", `rp_session=${his.id}`, { code: his.join_code, role: "family" }), dir)).toBeNull();
    expect(await familyGate(request("GET", "/join", `rp_session=${his.id}`), dir)).toBeNull();
    // her own phone naming another real session: refused, allow-list included
    const elsewhere = await familyGate(request("GET", `/api/family/view?session=${other.id}`, herCookie), dir);
    expect(elsewhere?.status).toBe(403);
    expect(await elsewhere?.json()).toMatchObject({ error: "patient_only" });
    // only a device with his (or a judge's) row changes the switches; a plain call with no row cannot, even where
    // nobody has joined as family
    const grants = (sessionId: string, cookie?: string) => request("POST", `/api/family/grants?session=${sessionId}`, cookie, { items: { notes: true } });
    expect((await denyNonPatient(grants(other.id), other, store))?.status).toBe(403);
    const him = await store.addMember(his.id, { role: "patient" });
    expect(await denyNonPatient(grants(his.id, `rp_session=${his.id}; rp_member=${him.id}; rp_role=patient`), his, store)).toBeNull();
    await store.deleteSession(his.id);
    await store.deleteSession(other.id);
  });

  it("no device cookie at all: only ANONYMOUS_API, and GET /api/session lists the members without their ids (lib/family/gate.ts, role.ts sessionCaller)", async () => {
    const line = FAMILY.lines.find((l) => l.startsWith("Once she has joined")) ?? "";
    expect(line).toContain(
      "it can join with the code, open a sandbox of its own, read the public dataset page and check health, and, in a session nobody has joined as family, read the session's own row (its story day and joining code, never its members)",
    );
    // the six routes, each with its reason; anything else about a session nobody joined as family: 403 member_required
    expect(ANONYMOUS_API.map((r) => `${r.method} ${r.route}`).sort()).toEqual(
      ["GET /api/asr/health", "GET /api/health", "GET /api/real", "GET /api/session", "POST /api/session", "POST /api/session/join"].sort(),
    );
    const store = getMemoryStore();
    const dir = proxyDirectory({ STORE: "memory" });
    const s = await store.createSession({ story_day: 41, story_time: "20:15", ttl_hours: 1 });
    const him = await store.addMember(s.id, { role: "patient" });
    const request = (method: string, p: string, cookie?: string) => new NextRequest(`http://localhost${p}`, { method, headers: cookie ? { cookie } : {} });
    for (const p of [`/api/notes?session=${s.id}`, `/api/bp?session=${s.id}`, `/api/events?session=${s.id}`, `/api/family/view?session=${s.id}`]) {
      const res = await familyGate(request("GET", p), dir);
      expect(res?.status, p).toBe(403);
      expect(await res?.json(), p).toMatchObject({ error: "member_required" });
    }
    expect(await familyGate(request("GET", `/api/session?session=${s.id}`), dir)).toBeNull();
    // the session row alone for no device; his phone gets the members' roles, never a row id
    const bare = (await (await sessionGET(request("GET", `/api/session?session=${s.id}`))).json()) as { session: { id: string }; members?: unknown };
    expect(bare.session.id).toBe(s.id);
    expect(bare.members).toBeUndefined();
    const res = await sessionGET(request("GET", `/api/session?session=${s.id}`, `rp_session=${s.id}; rp_member=${him.id}; rp_role=patient`));
    const text = await res.text();
    const members = (JSON.parse(text) as { members: Record<string, unknown>[] }).members;
    for (const m of members) expect(Object.keys(m).sort()).toEqual(["created_at", "device_label", "role"]);
    expect(text).not.toContain(him.id);
    await store.deleteSession(s.id);
  });

  it("what the joining code can make a device, as /how says (lib/family/join.ts joinRefusal)", async () => {
    const line = FAMILY.lines.find((l) => l.startsWith("The joining code makes a new device family.")) ?? "";
    expect(line).toContain("It makes a device Mr Tan's phone only while his session has none yet (on the shoot his phone joins first), the director or backstage only with the film crew's key, and a judge never");
    expect(line).toContain("whoever holds the code can join as family");
    expect(line).toContain("in a session nobody has joined as family a device that shows only a session cookie counts as Mr Tan's side");
    expect(line).toContain("Accounts and per-person invites replace the device cookies and the code.");
    const row = (role: SessionMemberRow["role"]): SessionMemberRow => ({ id: `m-${role}`, session_id: "s1", role, device_label: null, created_at: "2026-10-10T00:00:00.000Z" }) as SessionMemberRow;
    const facts = (role: JoinFacts["role"], over: Partial<JoinFacts> = {}): JoinFacts => ({
      role,
      members: [row("judge")],
      ownRow: null,
      deviceIsFamily: false,
      crew: async () => ({ ok: false, status: 403, error: "crew_key_required" }),
      ...over,
    });
    const withCrew = { crew: async () => ({ ok: true, via: "header" }) as const };
    expect(await joinRefusal(facts("family"))).toBeNull();
    expect(await joinRefusal(facts("patient"))).toBeNull();
    expect((await joinRefusal(facts("patient", { members: [row("judge"), row("patient")] })))?.code).toBe(PATIENT_EXISTS);
    for (const role of ["director", "backstage"] as const) {
      expect((await joinRefusal(facts(role)))?.code, role).toBe("crew_key_required");
      expect(await joinRefusal(facts(role, withCrew)), role).toBeNull();
    }
    expect((await joinRefusal(facts("judge", withCrew)))?.code).toBe(ROLE_NOT_JOINABLE);
    // her phone joins as family only
    expect((await joinRefusal(facts("patient", { members: [], deviceIsFamily: true })))?.code).toBe("patient_only");
  });

  it("crisis routing: rules first, the live model's screen can only raise the route, and the limits are said", () => {
    const crisis = serverLine("Emergency and self-harm:");
    expect(crisis).toContain("without waiting for any model, so an emergency always has an answer");
    // owner 10-15: the fixed sentences are worded for what he said, or stand as they are
    expect(crisis).toContain("or the fixed sentences below go out as they are");
    expect(crisis).toContain("The helplines and his doctor's own warning line are always shown as they are.");
    expect(crisis).toContain("can only move it to those templates, never away from them");
    // track S's small talk (cant_help, 10-10) and, since 10-14, a question about Ripple itself (rule:about_ripple): a fixed
    // sentence, no model call and no crisis screen; said as the two exceptions, the second with its words
    expect(crisis).toContain(
      "the two exceptions are small talk Ripple does not take up (the weather, the lottery, news, sports, markets, jokes, songs or stories) and a question about Ripple itself (what it is, what it is for, what it can do, who it is), which get a fixed sentence with no model call and no crisis screen",
    );
    expect(crisis).toContain(`the second is "${TEMPLATES.about_ripple.en}" and puts nothing on his question list`);
    expect(crisis).toContain("the rules decide alone");
  });

  it("a plain note gets \"Noted.\" and nothing after it, as /how says (owner 10-14; lib/safety/pipeline.ts)", async () => {
    const crisis = serverLine("Emergency and self-harm:");
    expect(crisis).toContain("So when no crisis screen vouched for an answer (offline, the spend cap, the per-person question limit, a model error or an unusable answer)");
    expect(crisis).toContain('A plain note gets "Noted." and nothing after it');
    expect(crisis).toContain(`carries the fixed safety line (995 or the nearest A&E, referral ${TEMPLATES.safety_line.referralId}) when his message has a word near a crisis`);
    expect(TEMPLATES.safety_line.en).toContain("995");
    expect(TEMPLATES.safety_line.en).toContain("A&E");
    // offline (the mock web/.env defaults to): no crisis screen ran, and the note still stands alone
    const store = getMemoryStore();
    const s = await store.createSession({ story_day: 29, story_time: "20:15", ttl_hours: 1 });
    const res = await ask({ sessionId: s.id, text: "Everything feels heavy today", role: "patient", locale: "en" }, { store, llm: createMockLlm(), checker: null, checkerReason: "test", publish: () => {}, costGuard: null });
    expect(res.route).toBe("log_only");
    expect(res.sentences.map((x) => x.templateId)).not.toContain("safety_line");
    expect(res.blocked).toEqual([]);
  });

  it("any other answer near crisis words that no crisis screen looked at carries the same line (classify.ts crisisCue)", async () => {
    const crisis = serverLine("Emergency and self-harm:");
    expect(crisis).toContain("Any answer, a note included, carries the fixed safety line");
    expect(crisis).toContain("when his message has a word near a crisis");
    expect(crisis).toContain("so a question phrased in a way no rule knows still shows 995");
    const store = getMemoryStore();
    const s = await store.createSession({ story_day: 30, ttl_hours: 1 });
    const deps = { store, llm: createMockLlm(), checker: null, checkerReason: "test", publish: () => {}, costGuard: null };
    // a question (not a note) with "weak" in it, offline: no rule routes it to a crisis, the safety line still comes
    const near = await ask({ sessionId: s.id, text: "My arm feels a bit weak after the gym, can I take my tablet later?", role: "patient", locale: "en" }, deps);
    expect(["log_only", "emergency", "self_harm"]).not.toContain(near.route);
    expect(near.sentences.find((x) => x.templateId === "safety_line")?.cite?.referralId).toBe(TEMPLATES.safety_line.referralId);
    // control: the same kind of question without crisis words gets no safety line
    const plain = await ask({ sessionId: s.id, text: "What is amlodipine for?", role: "patient", locale: "en" }, deps);
    expect(plain.sentences.map((x) => x.templateId)).not.toContain("safety_line");
    await store.deleteSession(s.id);
  });

  it("the crisis words are named as a short list, and every example /how gives is on it (classify.ts crisisCue)", () => {
    const crisis = serverLine("Emergency and self-harm:");
    // B5 fix 10-09 night: the line said "no strength ... in each language the rules cover", but "no strength" in
    // English and Tamil breathlessness were not cues; /how now gives only words that are on the list and says it is short
    expect(crisis).not.toContain("in each language the rules cover");
    expect(crisis).not.toContain("no strength");
    expect(crisis).toContain("Those words are a fixed list");
    expect(crisis).toContain("not every way of saying it in every language");
    expect(crisis).toContain("a question that neither the rules nor this list catch gets no 995 when no crisis screen ran");
    const examples: [string, string][] = [
      ["dying", "I feel like I am dying"],
      ["weak", "My arm is weak"],
      ["numb", "My face is numb"],
      ["crooked", "My mouth looks crooked"],
      ["the chest", "There is a pain in my chest"],
      ["breathing", "My breathing is hard"],
    ];
    for (const [word, phrase] of examples) {
      expect(crisis, word).toContain(word);
      expect(crisisCue(phrase), phrase).toBe(true);
    }
    expect(crisis).toContain("some in Chinese, Malay and Tamil");
    for (const phrase of ["我胸口痛", "dada saya sakit", "நெஞ்சு வலிக்கிறது"]) expect(crisisCue(phrase), phrase).toBe(true);
    // control: an everyday question of this app is not a cue
    expect(crisisCue("What is amlodipine for?")).toBe(false);
  });

  it("near self-harm words, the safety line brings the helplines after it (pipeline.ts pushSafetyTail, classify.ts selfHarmCue)", async () => {
    const crisis = serverLine("Emergency and self-harm:");
    expect(crisis).toContain("and the helpline templates after it when his words come near self-harm");
    const store = getMemoryStore();
    const s = await store.createSession({ story_day: 30, ttl_hours: 1 });
    const deps = { store, llm: createMockLlm(), checker: null, checkerReason: "test", publish: () => {}, costGuard: null };
    // offline, a question no rule routes to a crisis, with a self-harm word in it
    const text = "I keep saying goodbye to everyone, can I take my tablet later?";
    expect(selfHarmCue(text)).toBe(true);
    const res = await ask({ sessionId: s.id, text, role: "patient", locale: "en" }, deps);
    expect(["log_only", "emergency", "self_harm"]).not.toContain(res.route);
    const ids = res.sentences.map((x) => x.templateId).filter(Boolean);
    const at = ids.indexOf("safety_line");
    expect(at).toBeGreaterThanOrEqual(0);
    expect(ids.slice(at + 1)).toEqual(["self_harm_sos", "self_harm_mindline"]);
    // control: a cue that is not about self-harm gets the safety line alone
    const weak = await ask({ sessionId: s.id, text: "My arm feels a bit weak after the gym, can I take my tablet later?", role: "patient", locale: "en" }, deps);
    const weakIds = weak.sentences.map((x) => x.templateId).filter(Boolean);
    expect(weakIds).toContain("safety_line");
    expect(weakIds).not.toContain("self_harm_sos");
    await store.deleteSession(s.id);
  });

  it("over the per-person question limit: a note or crisis words answered by the rules alone, other questions 429 (cost-guard.ts, pipeline.ts)", async () => {
    const crisis = serverLine("Emergency and self-harm:");
    expect(crisis).toContain("(offline, the spend cap, the per-person question limit, a model error or an unusable answer)");
    expect(crisis).toContain(
      'Over the per-person question limit (questions an hour, model tokens a day), a note and a message with one of those words are still answered, by the rules alone with no model call, in the same way; any other question gets "try again later" (HTTP 429).',
    );
    expect(crisis).toContain("Emergency, self-harm and unknown-medicine answers the rules find are never limited.");
    // the code behind the two limits and the exemption
    const pipeline = src("lib", "safety", "pipeline.ts");
    expect(pipeline).toContain('const CRISIS_ROUTES: Route[] = ["emergency", "self_harm", "unknown_med"];');
    // (the harness, 10-16: a reply to a follow-up question is fixed lines and code, exempt as well)
    expect(pipeline).toContain("guard?.admit(sid, { exempt: !!reply || (!!ruled && CRISIS_ROUTES.includes(ruled.route)) });");
    expect(pipeline).toContain('!(ruled?.route === "log_only" || crisisCue(text))');
    expect(src("lib", "safety", "cost-guard.ts")).toMatch(/requestsPerHour: num\(env\.COST_REQ_PER_HOUR, 60\), tokensPerDay: num\(env\.COST_TOKENS_PER_DAY, 200_000\)/);
    expect(src("app", "api", "ask", "route.ts")).toMatch(/if \(e instanceof CostLimitError\)[\s\S]*?status: 429, headers: \{ "Retry-After"/);
    // run it: one question an hour, already used; a live-looking model that must not be called over the limit
    const store = getMemoryStore();
    const s = await store.createSession({ story_day: 29, ttl_hours: 1 });
    const guard = new CostGuard({ requestsPerHour: 1, tokensPerDay: 1_000_000 });
    guard.admit(s.id);
    let calls = 0;
    const live = { provider: "fake-live", model: "fake", chat: async () => { calls++; return { content: '{"crisis":"none"}', tokens: 1 }; } } as unknown as LlmClient;
    const deps = { store, llm: live, checker: null, checkerReason: "test", publish: () => {}, costGuard: guard };
    const note = await ask({ sessionId: s.id, text: "Everything feels heavy today", role: "patient", locale: "en" }, deps);
    expect(note.route).toBe("log_only");
    expect(note.costLimited?.limit).toBe("requests_per_hour");
    // a plain note over the limit is still only a note (owner 10-14: no 995 line under a note without a crisis word)
    expect(note.sentences.map((x) => x.templateId)).not.toContain("safety_line");
    const near = await ask({ sessionId: s.id, text: "My arm feels a bit weak after the gym, can I take my tablet later?", role: "patient", locale: "en" }, deps);
    expect(near.costLimited).toBeDefined();
    expect(near.sentences.map((x) => x.templateId)).toContain("safety_line");
    expect(calls, "no model call over the limit").toBe(0);
    await expect(ask({ sessionId: s.id, text: "What is amlodipine for?", role: "patient", locale: "en" }, deps)).rejects.toBeInstanceOf(CostLimitError);
    // an emergency the rules find is never limited
    const chest = await ask({ sessionId: s.id, text: "I have chest pain right now", role: "patient", locale: "en" }, deps);
    expect(chest.route).toBe("emergency");
    expect(renderText(chest, "en")).toContain("995");
    expect(chest.costLimited).toBeUndefined();
    await store.deleteSession(s.id);
  });

  it("with no crisis screen the rules act on symptom words and self-harm statements (classify.ts emergencyCue, pipeline.ts applyRulesOnlyCue)", async () => {
    const crisis = serverLine("Emergency and self-harm:");
    expect(crisis).toContain('goes to the emergency route whatever the sentence form: since 16 October a sign the rules read as happening now (heaviness or numbness on one side, for instance) is "call 995 now", and any other sign gets the follow-up question of the guided harness for it, with the safety line; a statement with words of self-harm gets the safety line, the helplines and the question "Are you having thoughts of ending your life or hurting yourself?" instead of "Noted."');
    const store = getMemoryStore();
    const s = await store.createSession({ story_day: 30, story_time: "20:15", ttl_hours: 1 });
    const deps = { store, llm: createMockLlm(), checker: null, checkerReason: "test", publish: () => {}, costGuard: null };
    // the two examples /how gives: no rule knows them (they read as a question to explain), the symptom-word cue does
    for (const example of ["my arm went funny and heavy", "my left leg feels heavy and numb"]) {
      expect(crisis, example).toContain(`"${example}"`);
      const text = `${example[0].toUpperCase()}${example.slice(1)}, can I still take my tablet?`;
      expect(classifyRules(text, { doctorThresholdSystolic: 180, meds: [] })?.route, text).not.toBe("emergency");
      expect(emergencyCue(text), text).not.toEqual([]);
      const res = await ask({ sessionId: s.id, text, role: "patient", locale: "en" }, deps);
      expect(res.route, text).toBe("emergency");
      // (the harness, 10-16: one-sided heaviness or numbness read as happening now is a stroke sign now: 995 first, level 1)
      expect(res.routeReason, text).toBe("harness:stroke-now");
      expect(res.sentences.map((x) => x.templateId), text).toContain("emergency_995");
      expect(res.risk?.level, text).toBe(1);
    }
    // a statement with self-harm words: the helplines, not "Noted."
    const goodbye = "I keep saying goodbye to everyone.";
    expect(classifyRules(goodbye, { doctorThresholdSystolic: 180, meds: [] })?.route).toBe("log_only");
    const sh = await ask({ sessionId: s.id, text: goodbye, role: "patient", locale: "en" }, deps);
    // (the harness, 10-16: cue words alone are "possible": the safety line and the helplines first, then the confirm
    // question; no family notice until he answers)
    expect(sh.risk?.ladder).toBe("possible");
    expect(sh.sentences.map((x) => x.templateId).slice(0, 3)).toEqual(["safety_line", "self_harm_sos", "self_harm_mindline"]);
    expect(sh.followUp?.pathway).toBe("self_harm_check");
    expect(sh.risk?.familyTold ?? false).toBe(false);
    await store.deleteSession(s.id);
  });

  it("a live screen that answers none never takes the safety line away (pipeline.ts, reason screen_none)", async () => {
    const crisis = serverLine("Emergency and self-harm:");
    expect(crisis).toContain('It keeps that line when the live crisis screen answered "none" too: the screen can add a crisis, never take the line away.');
    const store = getMemoryStore();
    const s = await store.createSession({ story_day: 30, ttl_hours: 1 });
    // a live-looking model whose crisis screen answers "none" (and whose other answers are unusable)
    // (the harness, 10-16: the risk screen replaced the crisis screen; it answers with an empty frame, risk/screen.ts)
    const NONE_FRAME = JSON.stringify({
      about: "self",
      acts: ["question"],
      medicines: [],
      amount: { relation: "none", evidence: [] },
      when: "unclear",
      symptoms: [],
      looksDifferent: "no",
      stopOrChange: "none",
      selfHarm: { ideation: "none", plan: "no", means: "no", soon: "no", lethalityQuestion: "no", evidence: [] },
      distress: "no",
    });
    const live = {
      provider: "fake-live",
      model: "fake",
      chat: async (o: { user: string }) => ({ content: (JSON.parse(o.user) as { task: string }).task === "risk_screen" ? NONE_FRAME : '{"crisis":"none"}', tokens: 1 }),
    } as unknown as LlmClient;
    const res = await ask(
      { sessionId: s.id, text: "My arm feels a bit weak after the gym, can I take my tablet later?", role: "patient", locale: "en" },
      { store, llm: live, checker: null, checkerReason: "test", publish: () => {}, costGuard: null },
    );
    expect(["emergency", "self_harm"]).not.toContain(res.route);
    expect(res.sentences.map((x) => x.templateId)).toContain("safety_line");
    expect((res.events[0].output as { safetyLine: { reason: string; cue: boolean } }).safetyLine).toMatchObject({ reason: "screen_none", cue: true });
    await store.deleteSession(s.id);
  });

  it("someone else's crisis gets the templates about them and no R2 (classify.ts aboutSomeoneElse, templates.ts)", async () => {
    const other = CLINICAL_TEXT[1].lines.find((l) => l.startsWith("Someone else's crisis")) ?? "";
    for (const id of ["self_harm_995_other", "emergency_overdose_other", "emergency_995"] as const) expect(other, id).toContain(`"${TEMPLATES[id].en}"`);
    expect(other).toContain("Mr Tan's own doctor's warning line is never added to someone else's emergency.");
    expect(other).toContain("so when in doubt the answer speaks to him");
    const store = getMemoryStore();
    const s = await store.createSession({ story_day: 30, story_time: "20:15", ttl_hours: 1 });
    const deps = { store, llm: createMockLlm(), checker: null, checkerReason: "test", publish: () => {}, costGuard: null };
    const first = async (text: string) => (await ask({ sessionId: s.id, text, role: "family", locale: "en" }, deps)).sentences;
    expect((await first("My wife took 10 of her BP pills just now"))[0]?.templateId).toBe("emergency_overdose_other");
    const child = (await first("My granddaughter chewed some of my pills"))[0];
    expect(child?.templateId).toBe("emergency_995");
    expect(child?.cite?.referralId).toBe("B1-12");
    expect((await first("Dad keeps asking which tablets would make him sleep forever"))[0]?.templateId).toBe("self_harm_995_other");
    // his own stroke signs bring his doctor's R2; someone else's do not
    const hasR2 = (xs: Sentence[]) => xs.some((x) => /:R2$/.test(x.sourceId));
    expect(hasR2(await first("My face suddenly droops on one side, can I still take my pill?"))).toBe(true);
    expect(hasR2(await first("My wife's face suddenly droops on one side, can she take her pill?"))).toBe(false);
    await store.deleteSession(s.id);
  });

  it("layer 1: whole sentences with their own punctuation, never one that leans on its neighbour (lib/safety/text.ts)", () => {
    const l1 = serverLine("Layer 1:");
    expect(l1).toContain("the doctor's words, labels and referrals are relayed whole, never cut or added to");
    expect(l1).toContain('a decimal point or "Dr." does not end a sentence, a question mark never passes for a full stop');
    expect(l1).toContain(`(after "Please don't." or before "Only if needed.") is never shown on its own`);
    // a decimal point and "Dr." do not end a sentence
    expect(sentenceSpans("Take 0.5 tablet daily. Then rest.").map((x) => x.text)).toEqual(["Take 0.5 tablet daily.", "Then rest."]);
    expect(sentenceSpans("Dr. Lim said one tablet.")).toHaveLength(1);
    // a question mark is not a full stop; a missing final mark is allowed
    expect(sameQuote("Can I take it at night?", "Can I take it at night.")).toBe(false);
    expect(sameQuote("Take it at night.", "Take it at night")).toBe(true);
    // a sentence after a dangling negation, or before a qualifier, is not a quote on its own
    const R4 = "Please don't change the dose yourself. If your readings are high, write them down and tell me at your next visit.";
    expect(matchWholeSentences(R4, "Please don't change the dose yourself.")).toBe("Please don't change the dose yourself.");
    expect(matchWholeSentences("Please don't. Change the dose yourself if your readings are high.", "Change the dose yourself if your readings are high.")).toBeNull();
    expect(matchWholeSentences("Take TWO tablets. Only if needed.", "Take TWO tablets.")).toBeNull();
  });

  it("layer 1: a bare refusal or condition before it, a limit or condition after it, and a refusal followed by another sentence, as /how says (text.ts B2 fix round 2)", () => {
    const l1 = serverLine("Layer 1:");
    expect(l1).toContain(
      'A sentence leans on the one before it when that one ends on a negation or is only a refusal or only a condition ("Cannot lah.", "If it gets worse."; tone particles such as lah or 啊 do not count), and on the one after it when that one limits it, is only a condition or takes it back ("Only if needed.", "No more than …", "When it hurts.", "No, one.").',
    );
    // fix round 3: a correction after it ("No, one.") keeps it too
    expect(matchWholeSentences("Take two tablets. No, one.", "Take two tablets.")).toBeNull();
    expect(l1).toContain("A passage in which a refusal is followed by another sentence is not shown at all, not even whole: as written it reads the other way round.");
    // the examples /how gives are what the code calls a bare refusal, a bare condition and a particle
    expect(stripParticles("Cannot lah.")).toBe("Cannot");
    expect(stripParticles("千万不要啊。")).toBe("千万不要");
    expect(isBareNegation("Cannot lah.")).toBe(true);
    for (const c of ["If it gets worse.", "When it hurts."]) expect(isBareCondition(c), c).toBe(true);
    // control: a condition with its own clause is not bare
    expect(isBareCondition("If your readings are high, write them down and tell me at your next visit.")).toBe(false);
    const NEXT = "Take it at night.";
    expect(matchWholeSentences(`Take it in the morning. ${NEXT}`, NEXT)).toBe(NEXT);
    expect(matchWholeSentences(`Cannot lah. ${NEXT}`, NEXT)).toBeNull();
    expect(matchWholeSentences(`If it gets worse. ${NEXT}`, NEXT)).toBeNull();
    expect(matchWholeSentences(`${NEXT} When it hurts.`, NEXT)).toBeNull();
    expect(matchWholeSentences(`${NEXT} No more than once a day.`, NEXT)).toBeNull();
    // a refusal followed by another sentence: not even the whole passage is a quote, and layer 1 names why
    const moved = "Please don't. Change the dose yourself.";
    expect(ambiguousBoundary(moved)).toBe(true);
    expect(matchWholeSentences(moved, moved)).toBeNull();
    expect(matchWholeSentences("Cannot lah. Take two at once.", "Cannot lah. Take two at once.")).toBeNull();
    expect(matchWholeSentences("……但是不要。一次吃两粒。", "……但是不要。一次吃两粒。")).toBeNull();
    const cand: Candidate = { sourceId: "visit:v3:u1", kind: "visit", span: moved, attribution: "doctor" };
    const quoted: Sentence = { speechAct: "restate", sourceId: cand.sourceId, span: moved, slots: {}, en: moved, attribution: "doctor" };
    expect(provenanceReasons(quoted, cand)).toEqual(expect.arrayContaining(["quote_not_verbatim", "ambiguous_sentence_boundary"]));
    // control: R4 as said is still a quote, whole or its first sentence alone
    const R4 = "Please don't change the dose yourself. If your readings are high, write them down and tell me at your next visit.";
    expect(matchWholeSentences(R4, R4)).toBe(R4);
    expect(ambiguousBoundary(R4)).toBe(false);
  });

  it("a spoken line or a label is shown whole or not at all, and not at all across a transcript boundary (verify.ts sourceQuote, wholeSourceBlock)", () => {
    const l1 = serverLine("Layer 1:");
    expect(l1).toContain("A line the doctor, the clinic counter or a pharmacist said, and a label, is shown as the whole line or not at all");
    expect(l1).toContain('("Take two tablets. No, one.", "Take FOUR tablets. Once a WEEK only.")');
    const cut = serverLine("Speech recognition may write a full stop");
    for (const example of ['"Do not take. Two tablets at once."', `"Please don't; change the dose yourself."`, `"Please don't, change …"`, `"Please don't." then "Change the dose yourself."`, "within five seconds", '"Do not crush. Swallow whole." is still shown']) {
      expect(cut, example).toContain(example);
    }
    const line = (span: string, extra: Partial<Candidate> = {}): Candidate => ({ sourceId: "visit:v3:u9", kind: "visit", span, attribution: "doctor", ...extra });
    const label = (span: string): Candidate => ({ sourceId: "label:med-x:directions", kind: "label", span, attribution: "label" });
    // one sentence cited, the whole line shown
    expect(sourceQuote(line("Take two tablets. No, one."), "Take two tablets.")).toBe("Take two tablets. No, one.");
    expect(sourceQuote(label("Take FOUR tablets. Once a WEEK only."), "Take FOUR tablets.")).toBe("Take FOUR tablets. Once a WEEK only.");
    // a boundary inside the line that turns a refusal round: not shown at all, not even whole
    for (const span of ["Do not take. Two tablets at once.", "Please don't; change the dose yourself.", "Please don't, change the dose yourself."]) {
      expect(wholeSourceBlock(line(span)), span).toBe("ambiguous_sentence_boundary");
      expect(sourceQuote(line(span), span), span).toBeNull();
    }
    // the same speaker's line just before leaves it hanging (one sentence split over two transcript lines)
    const transcript: Parameters<typeof lineContext>[0] = [
      { text: "Please don't.", role: "doctor", speaker_cluster: null, t_start_ms: 0, t_end_ms: 900 },
      { text: "Change the dose yourself.", role: "doctor", speaker_cluster: null, t_start_ms: 1200, t_end_ms: 2400 },
    ];
    const hanging = line("Change the dose yourself.", { context: lineContext(transcript, 1) });
    expect(hanging.context).toEqual({ before: "Please don't." });
    expect(wholeSourceBlock(hanging)).toBe("cut_from_context");
    expect(sourceQuote(hanging, "Change the dose yourself.")).toBeNull();
    const quoted: Sentence = { speechAct: "restate", sourceId: hanging.sourceId, span: hanging.span, slots: {}, en: hanging.span, attribution: "doctor" };
    expect(provenanceReasons(quoted, hanging)).toEqual(expect.arrayContaining(["quote_not_verbatim", "cut_from_context"]));
    // more than five seconds apart, or another speaker: not its neighbour
    expect(lineContext([{ ...transcript[0], t_end_ms: 0 }, { ...transcript[1], t_start_ms: 6000 }], 1)).toBeUndefined();
    expect(lineContext([{ ...transcript[0], role: "patient" }, transcript[1]], 1)).toBeUndefined();
    // a label's full stops are printed: shown; the same words spoken are not
    expect(wholeSourceBlock(label("Do not crush. Swallow whole."))).toBeNull();
    expect(sourceQuote(label("Do not crush. Swallow whole."), "Swallow whole.")).toBe("Do not crush. Swallow whole.");
    expect(wholeSourceBlock(line("Do not crush. Swallow whole."))).toBe("ambiguous_sentence_boundary");
  });

  it("layer 1 relevance: a spoken line must be about what he asked; R1, R2 and R4 are exempt, R3 is not (verify.ts relevanceReasons)", () => {
    const rel = CLINICAL_TEXT[1].lines.find((l) => l.startsWith("Layer 1 also checks")) ?? "";
    expect(rel).toContain("a line about a different medicine is not an answer (when he asks about taking medicines together, the line must cover every one of them)");
    expect(rel).toContain("a line about no particular medicine never answers a question about combining, changing or stopping one");
    expect(rel).toContain("answers only a question on the same topic. So a true sentence is never lifted out of its conversation.");
    // B2 fix round 2 (10-09 night): R3 lost its exemption, and labels and leaflet restatements are checked too
    expect(rel).not.toContain("R1-R4");
    expect(rel).toContain("exempt from this check (R1 his target, R2 the warning signs, R4 not changing the dose himself); R3, why he takes the tablet, is held to it like any other spoken line.");
    expect(rel).toContain("A label line or a leaflet restatement is about its own medicine: it never answers a question only about other medicines, and when he asks about taking his medicine with something else, only its lines about combining answer.");
    const line = (extra: Partial<Candidate>): Candidate => ({ sourceId: "visit:v2:u9", kind: "visit", span: "Yes, both together after breakfast is fine.", ...extra });
    // about his two BP medicines: not an answer about the painkiller, nor a combination of one of them with it
    const both = line({ about: ["amlodipine", "losartan"] });
    expect(relevanceReasons(both, { drugs: ["ibuprofen"], topics: ["combination"] })).toContain("source_about_other_medicine");
    expect(relevanceReasons(both, { drugs: ["amlodipine", "ibuprofen"], topics: ["combination"] })).toContain("combination_not_all_medicines");
    expect(relevanceReasons(both, { drugs: ["amlodipine", "losartan"], topics: ["combination"] })).toEqual([]);
    // a line about no known medicine never answers a combination, dose or stopping question
    expect(relevanceReasons(line({ about: [] }), { drugs: ["amlodipine"], topics: ["stopping"] })).toContain("source_medicine_unknown");
    // an answer to his question on one topic does not answer another topic
    expect(relevanceReasons(line({ about: ["amlodipine"], answers: ["food"] }), { drugs: ["amlodipine"], topics: ["side_effects"] })).toContain("answer_to_another_question");
    // R1, R2 and R4 are not held to it; R3 (the purpose line, topic why_take in candidates.ts) is
    const ibuprofenDaily = { drugs: ["ibuprofen"], topics: ["combination"] };
    for (const r of ["R1", "R2", "R4"]) {
      expect(relevanceReasons(line({ about: ["amlodipine"], cite: { requiredLine: r } as Candidate["cite"] }), ibuprofenDaily), r).toEqual([]);
    }
    const r3 = line({ sourceId: "visit:v2:R3", span: "So you take it every day, even when you feel fine.", about: ["amlodipine"], topics: ["why_take"], cite: { requiredLine: "R3" } as Candidate["cite"] });
    expect(relevanceReasons(r3, { drugs: ["ibuprofen"], topics: ["frequency"] })).toContain("source_about_other_medicine");
    expect(relevanceReasons(r3, { drugs: ["amlodipine"], topics: ["frequency"] })).toEqual([]);
    // a label line: about its own medicine only; with something else (a beer), only its combining lines answer
    const label = (topics: string[]): Candidate => ({ sourceId: "label:med-amlodipine:directions", kind: "label", span: "Take ONE tablet every MORNING.", about: ["amlodipine"], topics });
    expect(relevanceReasons(label(["label"]), { drugs: ["ibuprofen"], topics: ["dose"] })).toContain("source_about_other_medicine");
    expect(relevanceReasons(label(["label"]), { drugs: ["amlodipine"], topics: ["dose"] })).toEqual([]);
    expect(relevanceReasons(label(["label"]), { drugs: ["amlodipine", OTHER_SUBSTANCE], topics: ["combination"] })).toContain("not_about_combining");
    expect(relevanceReasons(label(["grapefruit"]), { drugs: ["amlodipine", OTHER_SUBSTANCE], topics: ["combination"] })).toEqual([]);
  });

  it("a label line gets Mandarin only when it is a plain how-to-take line (lib/safety/zh.ts)", () => {
    const zhLine = serverLine("A blocked quote becomes");
    expect(zhLine).toContain("only when it is one plain how-to-take sentence (how many, of what, when, and nothing else)");
    expect(zhLine).toContain("a line with a negation, a limit or a condition, or with more than one sentence, is shown in the label's own words");
    // /how explains the rule without showing a dosing sentence of its own
    expect(zhLine).not.toMatch(/tablet|粒/i);
    expect(zhFromSlots("Take ONE tablet every MORNING", "label")).toBe("药品标签：每天早上服用一片。");
    expect(zhFromSlots("Do not take more than 2 tablets a day", "label")).toBeNull();
    // fix round 3: two sentences would merge into one Mandarin line, so a label of more than one sentence has none
    expect(zhFromSlots("Take ONE tablet every MORNING. Take ONE tablet every NIGHT.", "label")).toBeNull();
  });

  it("a failing speech service: the replay only for a sample visit with ASR_REPLAY_FALLBACK on; a recorded visit's record never a script (lib/asr)", () => {
    const line = AUDIO.lines.find((l) => l.startsWith("Speech recognition:")) ?? "";
    expect(line).toContain("Tencent Cloud's speech recognition in Singapore");
    expect(line).toContain("it keeps a task's result for 24 hours");
    expect(line).toContain("The deployment uses Tencent since the evening of 14 October; the sample visits still play their recorded replays.");
    expect(line).toContain("a sample visit switches to its replay while the replay fallback is on (on unless the server turns it off, and the real app turns it off)");
    expect(line).toContain("and otherwise the live captions stop and the recording goes on");
    expect(line).toContain("it is never the replay's script, unless the screen was already playing that replay");
    expect(line).not.toContain("the visit screen switches to the replay and says so");
    // the code: on unless off; the live route offers the replay only with the flag on and a replay file for the visit
    expect(replayFallbackAllowed({})).toBe(true);
    for (const off of ["off", "0", "false", "no", " OFF "]) expect(replayFallbackAllowed({ ASR_REPLAY_FALLBACK: off }), off).toBe(false);
    const chunk = src("app", "api", "asr", "chunk", "route.ts");
    expect(chunk).toContain("const replay = live.replayFallback ? replayFixtureFor(visit) : null;");
    expect(chunk).toContain('replay ? "switches to the replay" : "keeps recording without live captions"');
    const whisper = src("lib", "asr", "whisper.ts");
    expect(whisper).toContain("A recorded visit never becomes the replay file's script");
    expect(whisper).toContain("the screen showed the replay while recording (preferFixture, only with ASR_REPLAY_FALLBACK on)");
    // the saved recording is made into the record later (the job status says deferred)
    expect(src("app", "api", "asr", "jobs", "[id]", "route.ts")).toContain("deferred = saved && serviceProblem(job.error, job.fallback?.used);");
  });

  it("recordings: on an account, export and delete under Me, 90 days unless always keep; the example leaves files to the sweep; the demo's reset deletes the copy's files (C2)", () => {
    const a = AUDIO.lines.join(" ");
    expect(RECORDING_RETENTION_DAYS).toBe(90);
    expect(AUDIO.summary).toContain("kept 90 days unless he chooses to keep it");
    expect(a).toContain('are deleted 90 days after the visit unless he chooses "always keep" for that visit; the transcript stays');
    expect(a).toContain('Under "Me" he can export everything Ripple keeps about him, or delete his account with everything in it.');
    expect(a).toContain("the sweep that removes such files deletes it");
    expect(a).toContain("a reset deletes every file of that copy");
    expect(a).toContain("48 hours");
    // the retention columns the job reads exist on a visit (C2 F1, migration 0004); the job itself is track H's, and its
    // window is the one this page states (lib/privacy/rules.ts AUDIO_KEEP_DAYS, read by lib/privacy/retention.ts)
    expect(AUDIO_KEEP_DAYS).toBe(RECORDING_RETENTION_DAYS);
    expect(readFileSync(path.join(WEB, "lib", "store", "types.ts"), "utf8")).toMatch(/keep_forever\?: boolean \| null/);
    // the only direct deletion of a scope's files is the demo's reset: the example's buttons leave theirs to the sweep
    const callers: string[] = [];
    const walk = (dir: string) => {
      for (const n of readdirSync(dir)) {
        const p = path.join(dir, n);
        if (statSync(p).isDirectory()) walk(p);
        else if (/\.(ts|tsx)$/.test(n) && /removeSessionBlobs\(/.test(readFileSync(p, "utf8"))) callers.push(path.relative(WEB, p).split(path.sep).join("/"));
      }
    };
    walk(path.join(WEB, "lib"));
    walk(path.join(WEB, "app"));
    expect(callers.sort()).toEqual(["lib/blob/index.ts", "lib/session/ops.ts"]);
    expect(readFileSync(path.join(WEB, "lib", "session", "ops.ts"), "utf8")).toMatch(/export async function resetSession[\s\S]*?removeSessionBlobs\(sessionId\)/);
  });

  it("no file path, address or port anywhere a judge reads on /how (real-status)", () => {
    const zones = [...CLINICAL_TEXT, AUDIO, FAMILY];
    const text = [stackText(), ...zones.flatMap((z) => [z.title, z.summary, ...z.lines]), ...REAL_RECORDING.lines].join("\n");
    for (const bad of [/\bweb\//, /\blib\//, /\.(ts|tsx|json|wav)\b/, /\b127\.0\.0\.1\b/, /localhost/, /:\d{4}\b/, /\bservices\//, /\.data\b/, /ASR_REPLAY_FALLBACK|SPEECH_PROVIDER|STORE=|plan item/]) {
      expect(text, String(bad)).not.toMatch(bad);
    }
    for (const z of zones) expect(z.summary.length, z.id).toBeGreaterThan(30);
  });
});

describe("what this server runs, box by box (lib/how/runtime.ts)", () => {
  it("offline: the stand-ins and the memory store are named as what they are", () => {
    const r = runtimeStack({ NODE_ENV: "development", LLM_PROVIDER: "mock", CHECKER_PROVIDER: "mock", SPEECH_PROVIDER: "mock", TTS_PROVIDER: "mock", STORE: "memory", AUTH_PROVIDER: "memory" });
    expect(r.main_model).toBe("an offline stand-in: no model is called; the rules and the fixed templates answer");
    expect(r.checker).toBe("an offline stand-in");
    expect(r.stt).toBe("recorded replays of the sample visits; a visit recorded here waits for transcription");
    expect(r.tts).toBe("a placeholder test voice");
    expect(r.database).toBe("kept in this server's memory (gone when it restarts); a test sign-in kept in memory");
    expect(r.hosting).toBe("a development server on this machine");
  });

  it("the judge link's configuration: Hunyuan and its checker, Supabase, Whisper; never a key, an address or a port", () => {
    const env = {
      NODE_ENV: "production",
      LLM_PROVIDER: "hunyuan",
      HUNYUAN_API_KEY: "sk-secret-value",
      CHECKER_PROVIDER: "hunyuan",
      SPEECH_PROVIDER: "whisper",
      WHISPER_URL: "http://127.0.0.1:7810",
      STORE: "supabase",
      SUPABASE_URL: "https://example.supabase.co",
      SUPABASE_SERVICE_KEY: "service-secret",
      SUPABASE_ANON_KEY: "anon",
      AUTH_PROVIDER: "supabase",
    };
    const r = runtimeStack(env);
    expect(r.main_model).toBe(`Tencent Cloud Hunyuan ${HUNYUAN_MAIN_MODEL}, called live (TokenHub's Singapore site, resources scheduled globally)`);
    expect(r.checker).toBe(`Tencent Cloud Hunyuan ${HUNYUAN_CHECKER_MODEL} (the same vendor as the main model)`);
    expect(runtimeStack({ ...env, HUNYUAN_BASE_URL: "https://tokenhub.tencentcloudmaas.com/v1" }).main_model).toContain("TokenHub's Guangzhou site, resources scheduled in mainland China");
    expect(r.stt).toBe("local Whisper");
    expect(r.database).toBe("Supabase; sign-in through Supabase Auth");
    expect(r.hosting).toBe("a production build on this machine");
    const all = JSON.stringify(r);
    for (const secret of ["sk-secret", "service-secret", "127.0.0.1", "7810", "example.supabase.co", "tencentcloudmaas"]) expect(all).not.toContain(secret);
    expect(runtimeStack({ ...env, RIPPLE_DEPLOYED: "1" }).hosting).toBe("the real deployment");
  });

  it("no checker configured, and the test transcription stand-in, are said plainly", () => {
    const r = runtimeStack({ NODE_ENV: "development", LLM_PROVIDER: "mock", CHECKER_PROVIDER: "", SPEECH_PROVIDER: "devfake" });
    expect(r.checker).toBe("none configured: a sentence that would need it is blocked");
    expect(r.stt).toBe("a test stand-in (developer tools): a recorded visit gets a test transcript");
  });

  it("Tencent Cloud speech recognition: where and which engine, or that a setting is missing; never a key", () => {
    const keys = { TENCENT_SECRET_ID: "AKIDsecretvalue", TENCENT_SECRET_KEY: "tencent-secret-value" };
    const r = runtimeStack({ NODE_ENV: "production", SPEECH_PROVIDER: "tencent", ...keys });
    expect(r.stt).toBe("Tencent Cloud speech recognition in ap-singapore (16k_zh_en): each finished line while he records, the whole recording at the end");
    expect(JSON.stringify(r)).not.toMatch(/AKIDsecretvalue|tencent-secret-value/);
    expect(runtimeStack({ NODE_ENV: "production", SPEECH_PROVIDER: "tencent" }).stt).toBe(
      "Tencent Cloud speech recognition is chosen but a setting is missing or wrong: a visit recorded here waits for transcription",
    );
  });

  it("who reads label photos: Tencent Cloud OCR on the deployment's settings, else what reads them here; never a key", () => {
    const keys = { TENCENT_SECRET_ID: "AKIDsecretvalue", TENCENT_SECRET_KEY: "tencent-secret-value" };
    const hy = { NODE_ENV: "production", LLM_PROVIDER: "hunyuan", HUNYUAN_API_KEY: "sk-secret-value" };
    const r = runtimeStack({ ...hy, SPEECH_PROVIDER: "tencent", ...keys });
    expect(r.ocr).toBe("Tencent Cloud OCR in ap-singapore: two engines read each label photo, after his yes to AI processing");
    expect(JSON.stringify(r)).not.toMatch(/AKIDsecretvalue|tencent-secret-value|sk-secret/);
    expect(runtimeStack(hy).ocr).toBe("no reader here: the sample labels show their recorded readings, any other label is typed in");
    expect(runtimeStack({ NODE_ENV: "development", LLM_PROVIDER: "mock" }).ocr).toBe("no reader here: the sample labels show their recorded readings, any other label is typed in");
    expect(runtimeStack({ ...hy, ...keys, LLM_VISION_MODEL: "some-vision" }).ocr).toBe("the model reads label photos (not OCR)");
  });
});

describe("Ripple's summary of a visit, as /how says it", () => {
  it("is described with its gates and its guards, as Ripple's own notes that are never a source", () => {
    const summaryLine = serverLine("Ripple's summary of a visit:");
    for (const w of [
      "at most every 15 seconds and only when new lines came",
      "at most four short points of what was said so far, from the transcript's lines and nothing else",
      "A speaker is named only where the transcript names one",
      "gives an instruction in Ripple's own voice",
      "has a number, dose or medicine its lines do not have",
      "shown as Ripple's and not confirmed",
      "never a source for an answer, never a line he confirms, and never sent to his family",
      "Only with his consent to AI processing and the live model",
    ]) {
      expect(summaryLine, w).toContain(w);
    }
    // the numbers the line gives are the code's
    expect([LIVE_SUMMARY_EVERY_MS, MAX_POINTS]).toEqual([15_000, 4]);
  });
});

describe("AIHGle 2.0", () => {
  it("quotes only the three given strings, verbatim from the deep read, with the given citation", () => {
    expect(AIHGLE.citation).toBe("AIHGle 2.0 (MOH & HSA, March 2026), Table 3, p.15");
    expect([...AIHGLE.device]).toEqual([
      "LLMs that use patient data to provide clinical recommendations to clinicians",
      "recommendations for medication combinations and dosage adjustments",
    ]);
    expect([...AIHGLE.nonDevice]).toEqual([
      "LLMs that explain side effects of medication prescribed to patients... The software does not provide medical diagnosis or treatment recommendation",
    ]);
    // the quotes come from our NTU track notes, which live only in the team's working repository (not in this snapshot)
    const notes = path.join(WEB, "..", "docs", "analysis", "ntu-track-deep-read.md");
    if (existsSync(notes)) {
      const source = readFileSync(notes, "utf8");
      for (const q of [...AIHGLE.device, ...AIHGLE.nonDevice]) expect(source).toContain(`"${q}"`);
    }
    // the page quotes nothing else in quotation marks next to the citation
    const page = readFileSync(path.join(WEB, "app", "how", "page.tsx"), "utf8");
    expect(page.match(/&ldquo;/g)?.length).toBe(2); // one per figure, filled from AIHGLE
  });
});
