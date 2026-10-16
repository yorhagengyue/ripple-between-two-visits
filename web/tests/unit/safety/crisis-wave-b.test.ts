/**
 * Crisis rules and the fixed safety line (10-09 wave B; round-3 safety check problem 3). With no crisis screen (the
 * spend cap, a DeepSeek error, the offline mock that web/.env defaults to) only the rules decide, and the check found
 * "左手没力", "我左边手脚没力", "My dad just told me he doesn't want to live anymore" and "Saya rasa nak mati je" answered
 * "Noted.", and "half my face cannot move one, mouth also senget" answered as a dose question with no 995.
 *
 * Now: rules for one-sided stroke signs, third-person reports, and a small set of Malay, Tamil, Cantonese and Hokkien
 * phrases, each from a cited source (classify.ts comments; web/PROGRESS.md lists the sources); a crisis family reports
 * about someone else gets "if they might hurt themselves"; and a note no crisis screen looked at carried the fixed
 * safety line (995 / A&E, referral B4-01).
 *
 * 10-14 (the owner's decision: the emergency sentence came too early under a plain note): a note carries the fixed safety
 * line only when its own words come near a crisis (classify.ts crisisCue), whether or not a crisis screen ran; a plain
 * note is "Noted." (and the check-in question when it applies) and nothing else. The last block pins that.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it, vi } from "vitest";
import { createCompatClient, createMockLlm } from "@/lib/llm";
import { SpendLedger } from "@/lib/llm/spend";
import { LlmError, type ChatOpts, type LlmClient } from "@/lib/llm/types";
import { classifyRules, crisisCue, emergencyCue, isThirdPersonReport } from "@/lib/safety/classify";
import { ask } from "@/lib/safety/pipeline";
import { renderText } from "@/lib/safety/render";
import { emergencyReferralFor, TEMPLATES } from "@/lib/safety/templates";
import { getMemoryStore } from "@/lib/store/memory";

const CTX = { doctorThresholdSystolic: 180, meds: [] };
const route = (t: string) => classifyRules(t, CTX)?.route ?? null;
const signals = (t: string) => classifyRules(t, CTX)?.signals ?? [];

/** [input, route, signal] — the round-3 check's misses first, then each language's cited phrases. */
const CRISIS: [string, "emergency" | "self_harm", string][] = [
  // the round-3 check's misses
  ["左手没力", "emergency", "stroke"],
  ["我左边手脚没力", "emergency", "stroke"],
  ["半边脸动不了", "emergency", "stroke"],
  ["half my face cannot move one, mouth also senget", "emergency", "stroke"],
  ["my arm is weak suddenly", "emergency", "stroke"],
  ["My dad just told me he doesn't want to live anymore", "self_harm", "self_harm"],
  ["爸爸说不想活", "self_harm", "self_harm"],
  ["Saya rasa nak mati je, tak nak hidup lagi", "self_harm", "self_harm"],
  ["Dada saya sakit sangat dan susah nak bernafas", "emergency", "chest"],
  ["நான் சாக விரும்புகிறேன்", "self_harm", "self_harm"],
  ["我唔想再生存落去，啲藥一次過食晒佢", "self_harm", "self_harm"],
  ["我无想欲活落去矣", "self_harm", "self_harm"],
  // English one-sided weakness and a crooked mouth
  ["Since this morning I can't lift my right arm and my mouth feels crooked", "emergency", "stroke"],
  ["my left leg suddenly no strength", "emergency", "stroke"],
  ["my mother says she wants to die", "self_harm", "self_harm"],
  ["he keeps saying he will kill himself", "self_harm", "self_harm"],
  // Malay (Changi General Hospital stroke leaflet; Kamus Dewan)
  ["Muka saya senget sebelah", "emergency", "stroke"],
  ["Sebelah badan saya lemah sejak pagi", "emergency", "stroke"],
  ["Percakapan dia kurang jelas", "emergency", "stroke"],
  ["Ayah saya kena angin ahmar", "emergency", "stroke"],
  ["Saya sesak nafas", "emergency", "breathing"],
  ["Saya nak bunuh diri", "self_harm", "self_harm"],
  // Tamil (HealthHub F.A.S.T. in Tamil; Tamil Lexicon)
  ["எனக்கு நெஞ்சு வலி", "emergency", "chest"],
  ["அப்பாவுக்கு பக்கவாதம் போல இருக்கு", "emergency", "stroke"],
  ["அவருடைய முகம் சரிந்து கோணுகிறது", "emergency", "stroke"],
  ["எனக்கு தற்கொலை எண்ணம் வருகிறது", "self_harm", "self_harm"],
  // Cantonese and traditional characters (words.hk; SBHK; Taiwan MOHW 臨微不亂)
  ["我想自殺", "self_harm", "self_harm"],
  ["我唔想活", "self_harm", "self_harm"],
  ["佢好似中風", "emergency", "stroke"],
  ["嘴角歪斜，單側手腳無力", "emergency", "stroke"],
  ["我呼吸困難", "emergency", "breathing"],
  // Hokkien (Taiwan MOE dictionary)
  ["我想欲死", "self_harm", "self_harm"],
  ["我雄雄感覺跤痠手軟，四肢無力", "emergency", "stroke"],
];

/** Near misses that must not become a crisis. */
const BENIGN: string[] = [
  "我右膝盖没力，手术后一直这样",
  "My left knee hurts when I climb stairs",
  "I have chest pain and my left arm feels heavy", // a crisis, but the heart-attack row, not stroke (checked below)
  "我的腹肚疼甲欲死",
  "啲藥食晒，要再攞",
  "I finished all my tablets, need to collect more",
  "My chest of drawers is too heavy to move.",
  "He walked to the market with his walking stick",
];

describe("the wave-B crisis rules", () => {
  it.each(CRISIS)("%s -> %s (%s)", (text, want, signal) => {
    expect(route(text)).toBe(want);
    expect(signals(text)).toContain(signal);
  });

  it("near misses stay what they were", () => {
    for (const t of BENIGN.filter((x) => !x.includes("chest pain"))) expect(["emergency", "self_harm"], t).not.toContain(route(t));
    // a heavy left arm with chest pain is a heart attack sign (B1-01), not the stroke row
    const heart = classifyRules("I have chest pain and my left arm feels heavy", CTX)!;
    expect(heart.route).toBe("emergency");
    expect(emergencyReferralFor(heart.signals)).toBe("B1-01");
  });
});

describe("a crisis reported about someone else", () => {
  it.each([
    ["My dad just told me he doesn't want to live anymore", true],
    ["爸爸说不想活", true],
    ["我爸爸说他想死", true],
    ["my mother says she wants to die", true],
    ["I don't want to live anymore", false],
    ["我不想活了", false],
    ["My dad is worried because I want to die", false],
    ["我想死，爸爸不知道", false],
  ] as const)("%s: about someone else = %s", (text, other) => {
    expect(isThirdPersonReport(text)).toBe(other);
    expect(signals(text).includes("third_person")).toBe(other);
  });

  it("the answer says 'if they might hurt themselves', with the same helplines; his own words still get 'you'", async () => {
    const store = getMemoryStore();
    const s = await store.createSession({ story_day: 30, ttl_hours: 1 });
    const other = await ask({ sessionId: s.id, text: "My dad just told me he doesn't want to live anymore", role: "family" }, { store, llm: createMockLlm(), checker: null, checkerReason: "test", publish: () => {}, costGuard: null });
    expect(other.route).toBe("self_harm");
    expect(other.sentences.map((x) => x.templateId)).toEqual(["self_harm_995_other", "self_harm_sos", "self_harm_mindline"]);
    expect(renderText(other, "en")).toContain(TEMPLATES.self_harm_995_other.en);
    expect(renderText(other, "en")).not.toContain(TEMPLATES.self_harm_995.en);
    expect(other.blocked).toEqual([]);
    const zh = await ask({ sessionId: s.id, text: "爸爸说不想活", role: "family" }, { store, llm: createMockLlm(), checker: null, checkerReason: "test", publish: () => {}, costGuard: null });
    expect(zh.sentences.map((x) => x.templateId)).toEqual(["self_harm_995_other", "self_harm_sos", "self_harm_mindline", "self_harm_care_corner"]);
    expect(renderText(zh, "zh-Hans")).toContain(TEMPLATES.self_harm_995_other.zh);
    const own = await ask({ sessionId: s.id, text: "I don't want to live anymore", role: "patient" }, { store, llm: createMockLlm(), checker: null, checkerReason: "test", publish: () => {}, costGuard: null });
    expect(own.sentences[0].templateId).toBe("self_harm_995");
  });
});

// ---------------------------------------------------------------- the safety line on notes

/** A fake live model: answers the crisis screen as told (or throws), composes nothing. */
function screening(answer: string | Error): LlmClient {
  return {
    provider: "fake-live",
    model: "fake",
    async chat(opts: ChatOpts) {
      const task = (JSON.parse(opts.user) as { task: string }).task;
      if (task === "crisis") {
        if (answer instanceof Error) throw answer;
        return { content: answer, tokens: 3 };
      }
      return { content: JSON.stringify({ sentences: [] }), tokens: 1 };
    },
  };
}

async function note(text: string, llm: LlmClient, locale: "en" | "zh-Hans" = "en") {
  const store = getMemoryStore();
  const s = await store.createSession({ story_day: 29, story_time: "20:15", ttl_hours: 1 });
  const res = await ask({ sessionId: s.id, text, role: "patient", locale }, { store, llm, checker: null, checkerReason: "test", publish: () => {}, costGuard: null });
  const output = res.events[0].output as { safetyLine: { reason: string; cue?: boolean } | null };
  return { res, output, en: renderText(res, "en"), zh: renderText(res, "zh-Hans") };
}

/** A plain note: no crisis cue word in it. */
const NOTE = "Everything feels heavy today";
/** A note with a crisis cue word of its own ("weak") that no rule reads as a crisis. */
const CUE_NOTE = "I feel weak today";

describe("the fixed safety line on a note: only with a crisis cue word of its own (10-14)", () => {
  const tmpDirs: string[] = [];
  afterAll(() => {
    for (const d of tmpDirs) rmSync(d, { recursive: true, force: true });
  });

  it("the two notes: one plain, one with a cue word that is not an emergency by the rules", () => {
    expect(crisisCue(NOTE)).toBe(false);
    expect(crisisCue(CUE_NOTE)).toBe(true);
    expect(emergencyCue(CUE_NOTE)).toEqual([]);
    for (const t of [NOTE, CUE_NOTE]) expect(route(t)).toBe("log_only");
  });

  it("offline (mock), a plain note: Noted. and nothing else, in both languages", async () => {
    const { res, output, en, zh } = await note(NOTE, createMockLlm());
    expect(res.route).toBe("log_only");
    expect(res.sentences.map((x) => x.templateId)).toEqual(["noted"]);
    expect(en).toBe(TEMPLATES.noted.en);
    expect(zh).toBe(TEMPLATES.noted.zh);
    expect(en).not.toContain("995");
    expect(res.blocked).toEqual([]);
    expect(output.safetyLine).toBeNull();
  });

  it("offline (mock), a note with a cue word: Noted., then the safety line, in both languages; it passes every check and cites B4-01", async () => {
    const { res, output, en, zh } = await note(CUE_NOTE, createMockLlm());
    expect(res.route).toBe("log_only");
    expect(res.sentences.map((x) => x.templateId)).toEqual(["noted", "safety_line"]);
    expect(en).toContain(TEMPLATES.safety_line.en);
    expect(zh).toContain(TEMPLATES.safety_line.zh);
    expect(res.sentences[1].cite?.referralId).toBe("B4-01");
    expect(res.blocked).toEqual([]);
    expect(output.safetyLine).toEqual({ reason: "offline", cue: true });
  });

  it("the screen answered none: a plain note is just the note; a note with a cue word keeps the line (reason screen_none)", async () => {
    const { res, output } = await note(NOTE, screening('{"crisis":"none"}'));
    expect(res.route).toBe("log_only");
    expect(res.sentences.map((x) => x.templateId)).toEqual(["noted"]);
    expect(output.safetyLine).toBeNull();
    const cue = await note(CUE_NOTE, screening('{"crisis":"none"}'));
    expect(cue.res.sentences.map((x) => x.templateId)).toEqual(["noted", "safety_line"]);
    expect(cue.output.safetyLine).toEqual({ reason: "screen_none", cue: true });
  });

  for (const [answer, reason] of [
    [new LlmError("budget", "model spend cap reached", 402), "budget"],
    [new LlmError("timeout", "deepseek timed out", 504), "timeout"],
    [new Error("socket hang up"), "error"],
    ['{"crisis":"maybe"}', "invalid_answer"],
    // a reply that is not JSON at all is an error of the screen call
    ["not json", "error"],
  ] as const) {
    it(`the screen was unavailable (${reason}): a plain note is still only the note; a note with a cue word carries the line and says why`, async () => {
      const plain = await note(NOTE, screening(answer));
      expect(plain.res.route).toBe("log_only");
      expect(plain.res.sentences.map((x) => x.templateId)).toEqual(["noted"]);
      expect(plain.en).not.toContain("995");
      expect(plain.output.safetyLine).toBeNull();
      const { res, output, en } = await note(CUE_NOTE, screening(answer));
      expect(res.route).toBe("log_only");
      expect(en).toContain(TEMPLATES.safety_line.en);
      expect(output.safetyLine).toEqual({ reason, cue: true });
    });
  }

  it("a spend ledger that cannot be written stops the screen before any request: a plain note is only the note, one with a cue word carries the line", async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "ripple-ledger-dir-"));
    tmpDirs.push(dir);
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const sent = { n: 0 };
    const ledger = new SpendLedger({ file: dir, capUsd: 5, windowMs: 86_400_000 });
    const live = createCompatClient(
      { name: "deepseek", vendor: "deepseek", baseUrl: "https://api.deepseek.com", apiKey: "sk-test", model: "deepseek-flash", maxTokensField: "max_tokens", jsonMode: true, timeoutMs: 1000, maxAttempts: 1, ledger },
      async () => {
        sent.n++;
        return new Response("{}", { status: 200 });
      },
    );
    const plain = await note(NOTE, live);
    expect(sent.n).toBe(0);
    expect(plain.res.route).toBe("log_only");
    expect(plain.res.sentences.map((x) => x.templateId)).toEqual(["noted"]);
    expect(plain.output.safetyLine).toBeNull();
    const { res, output, en } = await note(CUE_NOTE, live);
    expect(sent.n).toBe(0);
    expect(res.route).toBe("log_only");
    expect(output.safetyLine).toEqual({ reason: "ledger_unavailable", cue: true });
    expect(en).toContain(TEMPLATES.safety_line.en);
    vi.restoreAllMocks();
  });

  it("the check-in question follows a plain note when today's dose has no answer, and nothing after it; with a cue word the safety line comes last", async () => {
    const store = getMemoryStore();
    const s = await store.createSession({ story_day: 42, story_time: "08:00", ttl_hours: 1 });
    const deps = { store, llm: createMockLlm(), checker: null, checkerReason: "test", publish: () => {}, costGuard: null };
    const res = await ask({ sessionId: s.id, text: "我今天好累", role: "patient" }, deps);
    expect(res.sentences.map((x) => x.templateId)).toEqual(["noted", "check_in_dose"]);
    const cue = await ask({ sessionId: s.id, text: "I'm at the market and feel weak today", role: "patient" }, deps);
    expect(cue.sentences.map((x) => x.templateId)).toEqual(["noted", "check_in_dose", "safety_line"]);
  });
});
