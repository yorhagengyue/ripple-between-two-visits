/**
 * The real-recording demo (plan item 4, acceptance 4.3): lib/asr/real-demo.ts and its API, offline, on small made-up
 * inputs: hand-built channel samples, annotated speaker turns and Whisper segments with word times. No dataset text is
 * used and the recordings are never read (the API tests only look at whether the files are there). What it pins, from
 * the wave B verifiers' defects (B3 whisper findings):
 *   - who said each word comes from the dataset's annotations and the speaker's own microphone, word by word: a short
 *     patient interjection stays out of a Doctor line, and a segment without word times is "?" as soon as the other
 *     speaker has any of its time;
 *   - a card is the doctor's whole sentence, never a piece of a Whisper segment;
 *   - questions and taking details are held, not turned into Instruction cards; a card about one medicine names it;
 *   - the speaker check withholds a card whose time holds the patient talking alone (or that is not verbatim, or not
 *     the doctor's), and the shown cards are checked again here against the annotations, independently;
 *   - one run at a time: the slot is taken atomically (reserveDemo) and given back by releaseDemo;
 *   - the dataset credit and the consultation id pattern.
 */
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { NextRequest } from "next/server";
import { afterEach, describe, expect, it } from "vitest";
import { GET as demoGET, POST as demoPOST } from "@/app/api/real/route";
import { DELETE as runDELETE, GET as runGET } from "@/app/api/real/[id]/route";
import {
  aloneMs,
  attributeWords,
  cancelDemo,
  cardsFromDrafts,
  checkCards,
  CONSULTATION_ID,
  DEMO_CREDIT,
  DEMO_DATASET,
  demoConsultations,
  DemoDataError,
  demoFromTranscript,
  forgetDemoProbe,
  getDemo,
  launchDemo,
  linesFromWords,
  MAX_LINE_WORDS,
  namesMedicine,
  notANote,
  OVERLAP_SHARE,
  patientAloneInside,
  pcm16,
  publicJob,
  releaseDemo,
  reserveDemo,
  runningDemo,
  sentenceSpan,
  SPEAKER_SHARE,
  speakerCheck,
  speakerTurns,
  transcriptOf,
  TURN_BETWEEN_MS,
  WORD_TIME_SLACK_MS,
  wordsFromSegments,
  type DemoJob,
  type DemoLine,
  type DemoState,
  type HeardWord,
  type SpeakerTurn,
} from "@/lib/asr/real-demo";
import type { WhisperSegment } from "@/lib/asr/whisper";
import { REAL_RECORDING } from "@/lib/how/real-recording";
import { DEV_ONLY_CREW_KEY } from "@/lib/visit/crew";
import type { ItemDraft } from "@/lib/visit/extract";

const WEB = path.resolve(__dirname, "..", "..", "..");
const MANIFEST = JSON.parse(readFileSync(path.join(WEB, "fixtures", "real", "primock57.manifest.json"), "utf8"));
/** where fetch_primock57.mjs puts the recordings (only their presence is looked at here) */
const DATA_DIR = path.join(WEB, ...String(MANIFEST.local_root).split("/"));

const saved = { ...process.env };
afterEach(() => {
  process.env = { ...saved };
  forgetDemoProbe();
});

// ------------------------------------------------------------------ made-up consultations

/** One sample per millisecond: sample i is at i ms. */
const SR = 1000;

interface Channels {
  doctor: Int16Array;
  patient: Int16Array;
  sampleRate: number;
}

/** The doctor's and the patient's channel files of a made-up consultation, `ms` long, silent. */
function channels(ms: number): Channels {
  return { doctor: new Int16Array(ms), patient: new Int16Array(ms), sampleRate: SR };
}

/** `who` talks from..to: loud on their own microphone, a faint leak on the other one's. */
function talk(ch: Channels, who: SpeakerTurn["speaker"], from: number, to: number): void {
  const own = who === "doctor" ? ch.doctor : ch.patient;
  const other = who === "doctor" ? ch.patient : ch.doctor;
  for (let i = from; i < to; i++) {
    own[i] = 8000;
    other[i] = Math.max(other[i], 800);
  }
}

const turn = (speaker: SpeakerTurn["speaker"], t_start_ms: number, t_end_ms: number): SpeakerTurn => ({ t_start_ms, t_end_ms, speaker });

type Timed = [token: string, start_ms: number, end_ms: number];

/** The words of `text` one after another from `from`, `each` ms per word, written the way Whisper writes them (a leading space). */
function timed(text: string, from: number, each = 250): Timed[] {
  return text.split(" ").map((w, i): Timed => [` ${w}`, from + i * each, from + (i + 1) * each]);
}

/** A Whisper segment with its word times. */
function seg(words: Timed[], lang = "en"): WhisperSegment {
  return {
    start_ms: words[0][1],
    end_ms: words[words.length - 1][2],
    text: words.map((w) => w[0]).join("").trim(),
    lang,
    words: words.map(([word, start_ms, end_ms]) => ({ word, start_ms, end_ms, prob: 0.9 })),
  };
}

/** Whisper's segments -> who said each word -> lines (what demoFromTranscript does first). */
function heard(segments: WhisperSegment[], ch: Channels, turns: SpeakerTurn[]): DemoLine[] {
  const words = attributeWords(wordsFromSegments(segments), ch.doctor, ch.patient, ch.sampleRate, turns);
  return linesFromWords("t", words, ch.doctor, ch.patient, ch.sampleRate, turns);
}

/** A line by hand. `continues`: the same speaker went straight on from the line before. */
function line(id: string, speaker: DemoLine["speaker"], text: string, t: number, continues = false, end = t + 1000): DemoLine {
  return { id, t_start_ms: t, t_end_ms: end, text, lang: "en", speaker, doctor_share: null, turns: { doctor: 0, patient: 0 }, words: text.split(/\s+/).filter(Boolean).length, continues };
}

const draft = (id: string, type: ItemDraft["type"], on: string, slots: Record<string, unknown> = {}): ItemDraft => ({
  id,
  type,
  text: "not used: a card quotes the line",
  utterance_ids: [on],
  slots,
  required_line: null,
  speaker: "doctor",
});

/**
 * Milliseconds inside [from + slack, to - slack) in which the annotations have the patient talking and the doctor not,
 * counted one by one: the check the demo's own speakerCheck makes, done again here without its code.
 */
function patientAloneMsByHand(turns: SpeakerTurn[], from: number, to: number): number {
  const on = (who: SpeakerTurn["speaker"], t: number) => turns.some((u) => u.speaker === who && u.t_start_ms <= t && t < u.t_end_ms);
  let n = 0;
  for (let t = from + WORD_TIME_SLACK_MS; t < to - WORD_TIME_SLACK_MS; t++) if (on("patient", t) && !on("doctor", t)) n++;
  return n;
}

/** A mono (or stereo) 16-bit PCM WAV. */
function wav(samples: number[], channelCount = 1, rate = 16000): Uint8Array {
  const data = samples.length * 2;
  const b = new Uint8Array(44 + data);
  const v = new DataView(b.buffer);
  const tag = (o: number, s: string) => [...s].forEach((c, i) => (b[o + i] = c.charCodeAt(0)));
  tag(0, "RIFF");
  v.setUint32(4, 36 + data, true);
  tag(8, "WAVE");
  tag(12, "fmt ");
  v.setUint32(16, 16, true);
  v.setUint16(20, 1, true);
  v.setUint16(22, channelCount, true);
  v.setUint32(24, rate, true);
  v.setUint32(28, rate * channelCount * 2, true);
  v.setUint16(32, channelCount * 2, true);
  v.setUint16(34, 16, true);
  tag(36, "data");
  v.setUint32(40, data, true);
  samples.forEach((s, i) => v.setInt16(44 + i * 2, s, true));
  return b;
}

// ------------------------------------------------------------------ the credit, the ids

describe("the credit line and the consultation ids", () => {
  it("the demo and /how show the manifest's credit, word for word, with both links", () => {
    expect(DEMO_CREDIT).toEqual(MANIFEST.credit);
    expect(DEMO_DATASET).toMatchObject({ name: MANIFEST.dataset.name, commit: MANIFEST.dataset.commit, licence: MANIFEST.licence });
    expect(REAL_RECORDING.credit).toMatchObject({ en: MANIFEST.credit.en, zh: MANIFEST.credit.zh, sourceUrl: MANIFEST.credit.source_url, licenceUrl: MANIFEST.credit.licence_url });
    for (const t of [DEMO_CREDIT.en, DEMO_CREDIT.zh]) {
      expect(t).toContain("https://github.com/babylonhealth/primock57");
      expect(t).toContain("https://creativecommons.org/licenses/by/4.0/");
    }
    expect(REAL_RECORDING.href).toBe("/backstage/real");
  });

  it("a consultation id is dayN_consultationMM (days 1-5, 01-15), nothing around it", () => {
    for (const c of MANIFEST.consultations as { id: string }[]) expect(c.id).toMatch(CONSULTATION_ID);
    for (const ok of ["day1_consultation01", "day5_consultation15", "day3_consultation01"]) expect(ok).toMatch(CONSULTATION_ID);
    for (const bad of [
      "../../etc",
      "day0_consultation01",
      "day6_consultation01",
      "day3_consultation00",
      "day3_consultation16",
      "day3_consultation8",
      "day3_consultation008",
      "Day3_consultation08",
      " day3_consultation08",
      "day3_consultation08\n",
      "day3_consultation08/../../x",
      "",
    ])
      expect(bad).not.toMatch(CONSULTATION_ID);
  });
});

// ------------------------------------------------------------------ who said each word

describe("who said each word: the dataset's annotations and the speaker's own microphone", () => {
  it("a short patient interjection stays out of the doctor's line, word by word", () => {
    // the patient's "yeah sure" and the doctor going straight on: Whisper wrote them as one segment, without a full stop
    const ch = channels(3400);
    talk(ch, "patient", 0, 300);
    talk(ch, "doctor", 400, 3150);
    const turns = [turn("patient", 0, 320), turn("doctor", 380, 3200)];
    const segment = seg([...timed("yeah sure", 0, 150), ...timed("and if you need more take two puffs every four hours", 400)]);

    const lines = heard([segment], ch, turns);
    expect(lines.map((l) => [l.speaker, l.text])).toEqual([
      ["patient", "yeah sure"],
      ["doctor", "and if you need more take two puffs every four hours"],
    ]);
    expect(lines[1]).toMatchObject({ id: "t-l002", t_start_ms: 400, t_end_ms: 3150, words: 11, continues: false, turns: { doctor: 1, patient: 0 } });
    expect(lines[1].doctor_share).toBeGreaterThan(0.95);

    // the same segment without word times (one block): the annotations give the patient a tenth of it, so it is "?",
    // although the annotations and the doctor's microphone are mostly the doctor's (what a line-level rule let through)
    const block = heard([{ ...segment, words: undefined }], ch, turns);
    expect(block).toHaveLength(1);
    expect(block[0]).toMatchObject({ speaker: "unknown", text: "yeah sure and if you need more take two puffs every four hours" });
    expect(block[0].turns.patient).toBeGreaterThan(0);
    expect(block[0].turns.doctor).toBeGreaterThan(0.8);
    expect(block[0].doctor_share).toBeGreaterThan(SPEAKER_SHARE);
    // and a "?" line never makes a card
    expect(cardsFromDrafts(block, [draft("b-instruction", "instruction", block[0].id)])).toEqual({ cards: [], held: [] });
  });

  it("the microphone must not contradict the annotations; in crosstalk it decides only when clear; nobody annotated is ?", () => {
    const ch = channels(3500);
    const sound = (from: number, to: number, doctor: number, patient: number) => {
      for (let i = from; i < to; i++) {
        ch.doctor[i] = doctor;
        ch.patient[i] = patient;
      }
    };
    sound(0, 400, 800, 8000); // annotated as the doctor, but the patient's microphone hears it
    sound(500, 900, 8000, 800); // both annotated (crosstalk), the doctor's microphone clearly
    sound(1000, 1400, 5000, 5000); // both annotated, both microphones alike
    sound(1500, 1900, 800, 8000); // both annotated, the patient's microphone clearly
    sound(2000, 2400, 8000, 0); // nobody annotated
    // 2500-2900: annotated as the doctor, silent on both channels
    sound(3000, 3400, 8000, 800); // annotated as the patient, but the doctor's microphone hears it
    const turns = [turn("doctor", 0, 400), turn("doctor", 500, 1900), turn("patient", 500, 1900), turn("doctor", 2500, 2900), turn("patient", 3000, 3400)];
    const words: HeardWord[] = [0, 500, 1000, 1500, 2000, 2500, 3000].map((t, i) => ({ start_ms: t, end_ms: t + 400, token: ` w${i}`, lang: "en", seg: 0, block: false }));

    const got = attributeWords(words, ch.doctor, ch.patient, SR, turns);
    expect(got.map((w) => w.speaker)).toEqual(["unknown", "doctor", "unknown", "patient", "unknown", "doctor", "unknown"]);
    expect(got[1].doctor_share).toBeGreaterThanOrEqual(OVERLAP_SHARE);
    expect(got[2].doctor_share).toBe(0.5);
    expect(got[5].doctor_share).toBeNull(); // silence: the annotation alone, nothing contradicts it
  });

  it("the other person's turn between two words ends the line, even when Whisper did not write it down", () => {
    const ch = channels(2400);
    talk(ch, "doctor", 0, 900);
    talk(ch, "patient", 950, 1250);
    talk(ch, "doctor", 1300, 2200);
    const segment = seg([...timed("take two puffs", 0, 300), ...timed("every four hours.", 1300, 300)]);

    const turns = [turn("doctor", 0, 920), turn("patient", 950, 1250), turn("doctor", 1280, 2300)];
    expect(heard([segment], ch, turns).map((l) => [l.speaker, l.text, l.continues])).toEqual([
      ["doctor", "take two puffs", false],
      ["doctor", "every four hours.", false],
    ]);
    // the patient talking alone for less than TURN_BETWEEN_MS does not end it
    const short = [turn("doctor", 0, 920), turn("patient", 1000, 1000 + TURN_BETWEEN_MS - 50), turn("doctor", 1280, 2300)];
    expect(heard([segment], ch, short).map((l) => l.text)).toEqual(["take two puffs every four hours."]);
  });

  it("words in time order; a segment without word times, or whose words do not spell its text, is one block, never re-spelled", () => {
    const w = (word: string, start_ms: number, end_ms: number) => ({ word, start_ms, end_ms, prob: 0.9 });
    const segments: WhisperSegment[] = [
      { start_ms: 5000, end_ms: 6000, text: " Second one.", lang: "en", words: [w(" Second", 5000, 5400), w(" ", 5400, 5400), w(" one.", 5400, 6000)] },
      { start_ms: 1000, end_ms: 2000, text: "First.", lang: "en" },
      { start_ms: 3000, end_ms: 3500, text: "  ", lang: "en" },
      { start_ms: 7000, end_ms: 8000, text: " Take 2 a day.", lang: "en", words: [w(" Take", 7000, 7200), w(" two", 7200, 7500), w(" a", 7500, 7700), w(" day.", 7700, 8000)] },
    ];
    expect(wordsFromSegments(segments).map((x) => [x.token, x.seg, x.block, x.start_ms, x.end_ms])).toEqual([
      ["First.", 0, true, 1000, 2000],
      [" Second", 1, false, 5000, 5400],
      [" one.", 1, false, 5400, 6000],
      [" Take 2 a day.", 2, true, 7000, 8000],
    ]);
    expect(transcriptOf(segments)).toBe("First. Second one. Take 2 a day.");
  });

  it("the channel files are read as mono 16-bit PCM only", () => {
    const got = pcm16(wav([1, -2, 32767, -32768]));
    expect(Array.from(got.samples)).toEqual([1, -2, 32767, -32768]);
    expect(got.sampleRate).toBe(16000);
    expect(() => pcm16(wav([1, 2], 2))).toThrow(DemoDataError);
  });

  it("the turn times are read from the utterances file without its words", () => {
    const bytes = Buffer.from(JSON.stringify({ utterances: [{ t_start_ms: 1, t_end_ms: 2, speaker: "doctor", text: "secret" }, { t_start_ms: 3, t_end_ms: 2, speaker: "patient" }, { t_start_ms: 4, t_end_ms: 5, speaker: "nurse" }] }));
    expect(speakerTurns(bytes)).toEqual([{ t_start_ms: 1, t_end_ms: 2, speaker: "doctor" }]);
    expect(() => speakerTurns(Buffer.from("nope"))).toThrow(/not JSON/);
  });
});

// ------------------------------------------------------------------ whole sentences

describe("a card is the doctor's whole sentence, never a piece of a segment", () => {
  it("a sentence Whisper cut into two segments is one line, and its card quotes all of it", () => {
    const ch = channels(3400);
    talk(ch, "doctor", 0, 3250);
    const lines = heard([seg(timed("if the wheezing gets worse you need to", 0)), seg(timed("call us back straight away.", 2000))], ch, [turn("doctor", 0, 3300)]);
    expect(lines.map((l) => l.text)).toEqual(["if the wheezing gets worse you need to call us back straight away."]);
    const { cards } = cardsFromDrafts(lines, [draft("w", "instruction", lines[0].id)]);
    expect(cards.map((c) => c.quote)).toEqual(["if the wheezing gets worse you need to call us back straight away."]);
  });

  it("Whisper's full stop ends a line inside a segment; each card quotes its own sentence", () => {
    const ch = channels(2600);
    talk(ch, "doctor", 0, 2500);
    const lines = heard([seg(timed("Come back in two weeks. Take the tablets with food.", 0))], ch, [turn("doctor", 0, 2600)]);
    expect(lines.map((l) => [l.text, l.continues])).toEqual([
      ["Come back in two weeks.", false],
      ["Take the tablets with food.", true],
    ]);
    const { cards } = cardsFromDrafts(lines, [draft("f", "follow_up", lines[0].id), draft("i", "instruction", lines[1].id)]);
    expect(cards.map((c) => [c.id, c.quote, c.line_ids])).toEqual([
      ["f", "Come back in two weeks.", ["t-l001"]],
      ["i", "Take the tablets with food.", ["t-l002"]],
    ]);
  });

  it("a long run without a full stop is cut at Whisper's segment boundaries, and the card puts the run back together", () => {
    const parts = [
      "so for the next few days I want you to rest at home and drink plenty", // 16 words
      "of water and keep taking the paracetamol for the fever every six hours or so", // 15
      "and if the fever is not better by the weekend then you need to call us back", // 17
    ];
    let t = 0;
    const segments = parts.map((p) => {
      const words = timed(p, t);
      t = words[words.length - 1][2];
      return seg(words);
    });
    const ch = channels(t + 100);
    talk(ch, "doctor", 0, t);
    const lines = heard(segments, ch, [turn("doctor", 0, t + 50)]);
    expect(lines.map((l) => [l.words, l.continues])).toEqual([
      [31, false],
      [17, true],
    ]);
    expect(lines.every((l) => l.words <= MAX_LINE_WORDS)).toBe(true);

    const { cards } = cardsFromDrafts(lines, [draft("x", "instruction", lines[1].id)]);
    expect(cards).toHaveLength(1);
    expect(cards[0]).toMatchObject({ quote: parts.join(" "), line_id: "t-l002", line_ids: ["t-l001", "t-l002"], t_start_ms: 0, t_end_ms: t });
  });

  it("the sentence reaches back and on through the doctor's own lines, never past the patient's line, a pause or a turn", () => {
    const lines = [
      line("a", "doctor", "If the wheezing gets worse you need to", 0),
      line("b", "doctor", "call us back straight away", 1000, true), // Whisper wrote no full stop
      line("c", "patient", "Okay.", 2000),
      line("d", "doctor", "And keep the inhaler with you", 3000),
      line("e", "doctor", "at all times.", 4000), // continues false: a pause or the patient's turn came in between
    ];
    expect([0, 1, 2, 3, 4].map((i) => sentenceSpan(lines, i))).toEqual([
      [0, 1],
      [0, 1],
      [2, 2],
      [3, 3],
      [4, 4],
    ]);
    const { cards } = cardsFromDrafts(lines, [draft("b-instruction", "instruction", "b"), draft("e-instruction", "instruction", "e")]);
    expect(cards.map((c) => [c.quote, c.line_id, c.line_ids, c.t_start_ms, c.t_end_ms])).toEqual([
      ["If the wheezing gets worse you need to call us back straight away", "b", ["a", "b"], 0, 2000],
      ["at all times.", "e", ["e"], 4000, 5000],
    ]);
  });
});

// ------------------------------------------------------------------ held, not carded

describe("questions and taking details are held, not carded", () => {
  it("a question by its mark or its word order, and admin talk, are not notes", () => {
    expect(notANote("Do you get any chest pain?")).toBe("question");
    expect(notANote("would you tell me the names of the tablets please")).toBe("question"); // no question mark
    expect(notANote("can I just check your name please")).toBe("question");
    expect(notANote("or are you short of breath when you rest")).toBe("question");
    expect(notANote("Okay, and your email address for me, please.")).toBe("admin");
    expect(notANote("And your date of birth for me.")).toBe("admin");
    expect(notANote("If the pain gets worse you need to call us straight away.")).toBeNull();
    expect(notANote("Come back in two weeks for a blood test.")).toBeNull();
  });

  it("cards come only from the doctor's notes: a question or admin talk is held with why, judged on the whole sentence", () => {
    const lines = [
      line("q", "doctor", "can I just check your name please", 0),
      line("m1", "doctor", "Okay and your email address", 1000), // no full stop: the sentence goes on ...
      line("m2", "doctor", "for me please.", 2000, true), // ... and this piece alone is not admin talk
      line("i", "doctor", "If the pain gets worse you need to call us straight away.", 3000, true),
      line("p", "patient", "Should I come back next week?", 4000),
      line("u", "unknown", "Come back in a week.", 5000),
    ];
    expect(notANote(lines[2].text)).toBeNull();
    const { cards, held } = cardsFromDrafts(lines, [
      draft("q-instruction", "instruction", "q"),
      draft("m2-instruction", "instruction", "m2"),
      draft("i-instruction", "instruction", "i"),
      draft("i-watch", "instruction", "i", { variant: "watch", extracted_by: "model" }), // a second label on one sentence
      draft("p-question", "question", "p"), // not a doctor's-note type
      draft("p-instruction", "instruction", "p"), // not the doctor's line
      draft("u-follow_up", "follow_up", "u"), // nobody knows who said it
      draft("i-consent", "consent", "i"),
    ]);
    expect(cards.map((c) => [c.id, c.type, c.variant, c.quote, c.by])).toEqual([["i-instruction", "instruction", "instruction", "If the pain gets worse you need to call us straight away.", "rules"]]);
    expect(held).toEqual([
      { draft_id: "q-instruction", line_id: "q", why: "question" },
      { draft_id: "m2-instruction", line_id: "m2", why: "admin" },
      { draft_id: "i-watch", line_id: "i", why: "same_sentence" },
    ]);
  });
});

// ------------------------------------------------------------------ medicine cards name the medicine

describe("a card about one medicine names it", () => {
  it("a medicine name: one the app's list knows, a brand, or a generic name by its ending", () => {
    expect(namesMedicine("I'll start you on ibuprofen.")).toBe(true);
    expect(namesMedicine("Two puffs of the Ventolin.")).toBe(true);
    expect(namesMedicine("We'll increase the furosemide.")).toBe(true);
    expect(namesMedicine("Take the salbutamol when you need it.")).toBe(true);
    expect(namesMedicine("Take two puffs of the blue inhaler.")).toBe(false);
    expect(namesMedicine("That's 400 milligrams two times a day.")).toBe(false);
  });

  it("without the name the doctor's sentence just before is quoted with it, when it names it and is not a question; else it is held", () => {
    const lines = [
      line("n", "doctor", "I'll give you ibuprofen for the elbow.", 0),
      line("d", "doctor", "That's 400 milligrams two times a day.", 1000, true),
      line("p", "patient", "Okay.", 2000),
      line("e", "doctor", "Take one twice a day with food.", 3000), // after the patient's line
      line("r", "doctor", "Don't change the dose yourself.", 4000, true), // the sentence before names nothing
      line("f", "doctor", "Come back in two weeks.", 5000, true),
      line("k", "doctor", "Are you still taking the ibuprofen?", 6000),
      line("t", "doctor", "Take it with food.", 7000, true), // the sentence before names it, but it is a question
    ];
    const { cards, held } = cardsFromDrafts(lines, [
      draft("d-how", "instruction", "d", { variant: "how_to_take" }),
      draft("e-how", "instruction", "e", { variant: "how_to_take" }),
      draft("r-rule", "instruction", "r", { variant: "dose_rule" }),
      draft("e-med", "medication", "e", { extracted_by: "model" }),
      draft("f-follow_up", "follow_up", "f", { extracted_by: "model" }), // not about a medicine: no name needed
      draft("t-how", "instruction", "t", { variant: "how_to_take" }),
    ]);
    expect(cards.map((c) => [c.id, c.variant, c.quote, c.line_id, c.line_ids, c.t_start_ms, c.t_end_ms, c.by])).toEqual([
      ["d-how", "how_to_take", "I'll give you ibuprofen for the elbow. That's 400 milligrams two times a day.", "d", ["n", "d"], 0, 2000, "rules"],
      ["f-follow_up", "follow_up", "Come back in two weeks.", "f", ["f"], 5000, 6000, "model"],
    ]);
    expect(held).toEqual([
      { draft_id: "e-how", line_id: "e", why: "no_medicine_name" },
      { draft_id: "r-rule", line_id: "r", why: "no_medicine_name" },
      { draft_id: "e-med", line_id: "e", why: "no_medicine_name" },
      { draft_id: "t-how", line_id: "t", why: "no_medicine_name" },
    ]);
  });

  it("when the naming sentence already has its card, the dose sentence is not shown on its own (one card per sentence)", () => {
    const lines = [line("n", "doctor", "I'll start you on ibuprofen 400 milligrams.", 0), line("d", "doctor", "Take it twice a day with food.", 1000, true)];
    const { cards, held } = cardsFromDrafts(lines, [draft("n-med", "medication", "n", { variant: "new_med", drug: "ibuprofen" }), draft("d-how", "instruction", "d", { variant: "how_to_take" })]);
    expect(cards.map((c) => [c.id, c.quote])).toEqual([["n-med", "I'll start you on ibuprofen 400 milligrams."]]);
    expect(held).toEqual([{ draft_id: "d-how", line_id: "d", why: "same_sentence" }]);
  });
});

// ------------------------------------------------------------------ the speaker check and the safety step

describe("the speaker check: against the dataset's annotations and Whisper's own transcript", () => {
  // the patient says "yeah sure" (0-0.7 s), the doctor goes on (0.75-3.3 s), the patient answers (3.3-3.8 s)
  const turns = [turn("patient", 0, 700), turn("doctor", 750, 3300), turn("patient", 3300, 3800)];
  const heardText = "yeah sure and if you need more take two puffs every four hours";
  const transcript = transcriptOf([{ start_ms: 0, end_ms: 3550, text: heardText }]);
  const lines = [
    line("p", "patient", "yeah sure", 0, false, 650),
    line("d", "doctor", "and if you need more take two puffs every four hours", 800, false, 3550),
    // what a line-level attribution used to make of it: the patient's words on a line labelled Doctor
    line("x", "doctor", heardText, 0, false, 3550),
  ];

  it("flags a quote with the patient's words in it, a quote that is not Whisper's, a line that is not the doctor's", () => {
    // the doctor's own words: clean, although the last word runs 250 ms into the patient's answer (Whisper's word times)
    expect(speakerCheck({ quote: lines[1].text, line_ids: ["d"], t_start_ms: 800, t_end_ms: 3550 }, lines, turns, transcript)).toEqual([]);
    // the patient's "yeah sure" on a line labelled Doctor: the annotations have the patient alone inside the card's time
    expect(speakerCheck({ quote: heardText, line_ids: ["x"], t_start_ms: 0, t_end_ms: 3550 }, lines, turns, transcript)).toEqual(["patient_time"]);
    expect(speakerCheck({ quote: heardText, line_ids: ["p", "d"], t_start_ms: 0, t_end_ms: 3550 }, lines, turns, transcript)).toEqual(["patient_time", "not_doctor"]);
    expect(speakerCheck({ quote: "and if you need more take four puffs every two hours", line_ids: ["d"], t_start_ms: 800, t_end_ms: 3550 }, lines, turns, transcript)).toEqual(["not_verbatim"]);
    // running on 400 ms into the patient's answer is past the slack
    expect(speakerCheck({ quote: lines[1].text, line_ids: ["d"], t_start_ms: 800, t_end_ms: 3700 }, lines, turns, transcript)).toEqual(["patient_time"]);
  });

  it("the patient's time inside a card: alone only (crosstalk is the microphone's call), the ends' slack left out", () => {
    expect(patientAloneInside(turns, 0, 3550)).toBe(400); // 300-700: the "yeah sure" past the slack
    expect(patientAloneInside(turns, 800, 3550)).toBe(0);
    expect(patientAloneInside(turns, 3400, 3600)).toBe(1); // a card shorter than the slack: its middle decides
    expect(patientAloneInside(turns, 1000, 1200)).toBe(0);
    const crosstalk = [turn("doctor", 0, 1000), turn("patient", 500, 700)];
    expect(aloneMs(crosstalk, "patient", 0, 1000)).toBe(0);
    expect(aloneMs(crosstalk, "doctor", 0, 1000)).toBe(800);
  });

  it("checkCards withholds a card the speaker check flags, and one the safety layers do not pass; held labels are counted", async () => {
    const all = [...turns, turn("doctor", 4950, 7100)];
    const ls = [lines[2], line("y", "doctor", "Come back in two weeks for a blood test.", 5000, false, 7000)];
    const text = transcriptOf(ls.map((l) => ({ start_ms: l.t_start_ms, end_ms: l.t_end_ms, text: l.text })));
    const { cards, held } = cardsFromDrafts(ls, [draft("x-instruction", "instruction", "x"), draft("y-follow_up", "follow_up", "y"), draft("y-test", "test", "y")]);
    expect(cards.map((c) => c.id)).toEqual(["x-instruction", "y-follow_up"]);
    const tampered = { ...cards[1], id: "tampered", quote: "Come back in two weeks for a blood test and double the dose." };

    const { shown, report } = await checkCards([...cards, tampered], ls, all, text, held);
    expect(shown.map((c) => c.id)).toEqual(["y-follow_up"]);
    expect(report).toMatchObject({ checked: 3, passed: 1, never_cross: 0, held: { question: 0, admin: 0, no_medicine_name: 0, same_sentence: 1 } });
    const blocked = new Map(report.blocked.map((b) => [b.card_id, b]));
    expect(blocked.get("x-instruction")).toEqual({ card_id: "x-instruction", line_id: "x", layer: "speaker", reasons: ["patient_time"] });
    // the edited quote never reaches the speaker check: the safety layers stop it first
    expect(blocked.get("tampered")?.layer).not.toBe("speaker");
    expect(blocked.get("tampered")?.reasons.length).toBeGreaterThan(0);
    // never_cross is counted on what is shown, which already passed the same check: 0 by construction; the real
    // guard is the "speaker" block above (and the e2e checks the shown cards again from the dataset's file)
  });
});

// ------------------------------------------------------------------ everything after Whisper, together

describe("everything after Whisper on a made-up consultation (rules only)", () => {
  // the doctor asks for the name and the email, the patient's "yeah sure" runs into the doctor's next words in one
  // Whisper segment, a dose sentence names its medicine only in the sentence before, and one names nothing
  const D1 = timed("can I just check your name please", 0); // 0-1750
  const P1 = timed("yes it's Sam", 2000); // 2000-2750
  const D2 = timed("and your email address for me please", 3000); // 3000-4750
  const P2 = timed("yeah sure", 5000); // 5000-5500
  const D3 = timed("come back in two weeks for a blood test.", 5600); // 5600-7850
  const D4 = timed("The ibuprofen is for the elbow. If you forget a dose take it when you remember.", 8000); // 8000-12000
  const P3 = timed("okay thank you", 12500); // 12500-13250
  const D5 = timed("Don't change the dose yourself.", 13500); // 13500-14750
  const segments = [seg(D1), seg(P1), seg(D2), seg([...P2, ...D3]), seg(D4), seg(P3), seg(D5)];
  const turns = [
    turn("doctor", 0, 1800),
    turn("patient", 1950, 2800),
    turn("doctor", 2950, 4800),
    turn("patient", 4950, 5520),
    turn("doctor", 5580, 12050),
    turn("patient", 12450, 13300),
    turn("doctor", 13450, 14800),
  ];
  const ch = channels(15000);
  talk(ch, "doctor", 0, 1750);
  talk(ch, "patient", 2000, 2750);
  talk(ch, "doctor", 3000, 4750);
  talk(ch, "patient", 5000, 5500);
  talk(ch, "doctor", 5600, 12000);
  talk(ch, "patient", 12500, 13250);
  talk(ch, "doctor", 13500, 14750);

  it("lines by speaker and sentence, the doctor's notes as whole sentences, the rest held with why, and nothing of the patient's shown", async () => {
    const states: DemoState[] = [];
    const out = await demoFromTranscript({ id: "t" }, segments, ch, turns, { llm: null, env: {}, onState: (s) => states.push(s) });
    expect(out).not.toBeNull();
    const r = out!;
    expect(states).toEqual(["extracting", "checking"]);
    expect(r.lines.map((l) => [l.speaker, l.text, l.continues])).toEqual([
      ["doctor", "can I just check your name please", false],
      ["patient", "yes it's Sam", false],
      ["doctor", "and your email address for me please", false],
      ["patient", "yeah sure", false],
      ["doctor", "come back in two weeks for a blood test.", false],
      ["doctor", "The ibuprofen is for the elbow.", true],
      ["doctor", "If you forget a dose take it when you remember.", true],
      ["patient", "okay thank you", false],
      ["doctor", "Don't change the dose yourself.", false],
    ]);
    expect(r.speakers).toMatchObject({ doctor: 6, patient: 3, unknown: 0 });
    expect(r).toMatchObject({ words: 52, blocks: 0 });
    expect(r.extraction).toMatchObject({ source: "rules", provider: null, added: 0, error: null });

    expect(r.cards.map((c) => [c.variant, c.quote, c.line_ids])).toEqual([
      ["follow_up", "come back in two weeks for a blood test.", ["t-l005"]],
      ["missed_dose", "The ibuprofen is for the elbow. If you forget a dose take it when you remember.", ["t-l006", "t-l007"]],
    ]);
    expect(r.safety).toMatchObject({ checked: 2, passed: 2, blocked: [], never_cross: 0, held: { question: 1, admin: 1, no_medicine_name: 1, same_sentence: 1 } });

    // checked again here, without the demo's own check: every shown card is a run of Whisper's transcript, on the
    // doctor's lines only, with no stretch in its time where the annotations have the patient talking alone
    const squashed = transcriptOf(segments).replace(/\s+/g, "");
    const byId = new Map(r.lines.map((l) => [l.id, l]));
    for (const c of r.cards) {
      expect(squashed).toContain(c.quote.replace(/\s+/g, ""));
      expect(c.line_ids.map((id) => byId.get(id)?.speaker)).toEqual(c.line_ids.map(() => "doctor"));
      expect(patientAloneMsByHand(turns, c.t_start_ms, c.t_end_ms)).toBe(0);
      expect(c.quote).not.toMatch(/yeah|sure|Sam|thank/);
    }
  });
});

// ------------------------------------------------------------------ one run at a time

describe("one run at a time: the slot is taken atomically", () => {
  const reserved: DemoJob[] = [];
  afterEach(() => {
    for (const j of reserved.splice(0)) releaseDemo(j);
  });

  it("reserveDemo takes the slot at once; a second reserve while it is held is refused; releaseDemo gives it back, leaving no trace", () => {
    expect(runningDemo()).toBeNull();
    const first = reserveDemo("day3_consultation08", "crew:a");
    if (!("job" in first)) throw new Error("the slot was not free");
    reserved.push(first.job);
    expect(first.job).toMatchObject({ consultation: "day3_consultation08", owner: "crew:a", state: "starting", progress: null, finished_at: null, error: null, result: null });
    expect(first.job.id).toMatch(/^real-[0-9a-f-]{36}$/);
    expect(runningDemo()?.id).toBe(first.job.id);
    // what the API shows of it: no owner, no AbortController
    expect(Object.keys(publicJob(first.job)).sort()).toEqual(["consultation", "error", "finished_at", "job_id", "progress", "result", "started_at", "state"]);

    // a second caller in the same tick: refused, told which run holds the slot, nothing registered for it
    const second = reserveDemo("day1_consultation06", "crew:b");
    expect("busy" in second && second.busy.id).toBe(first.job.id);
    expect(runningDemo()?.id).toBe(first.job.id);

    releaseDemo(first.job);
    expect(runningDemo()).toBeNull();
    expect(getDemo(first.job.id)).toBeNull();
    expect(first.job.finished_at).not.toBeNull();

    const third = reserveDemo("day1_consultation06", "crew:b");
    if (!("job" in third)) throw new Error("the slot was not given back");
    reserved.push(third.job);
    expect(third.job.id).not.toBe(first.job.id);
  });

  it("a launched run that cannot start ends at once and frees the slot; releasing it then changes nothing", () => {
    const slot = reserveDemo("day3_consultation08", "crew:a");
    if (!("job" in slot)) throw new Error("the slot was not free");
    reserved.push(slot.job);
    // no recordings where it looks: the run fails before Whisper is asked, and nothing is read
    const job = launchDemo(slot.job, { env: { RP_REAL_DATA_DIR: path.join(os.tmpdir(), `ripple-no-recordings-${randomUUID()}`) }, llm: null });
    expect(job).toMatchObject({ state: "failed", error: "data_missing", result: null });
    expect(job.finished_at).not.toBeNull();
    expect(runningDemo()).toBeNull();
    releaseDemo(job); // only a slot that never ran is given back
    expect(getDemo(job.id)).toBe(job); // the failed run stays for its status
    expect(cancelDemo(job)).toBe(false);
  });
});

// ------------------------------------------------------------------ the API

const crewReq = (method: string, url: string, body?: unknown, crew = true) =>
  new NextRequest(`http://localhost:3200${url}`, {
    method,
    headers: { "content-type": "application/json", ...(crew ? { "x-ripple-crew-key": DEV_ONLY_CREW_KEY } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
const params = (id: string) => ({ params: Promise.resolve({ id }) });

/** a consultation whose files are on this machine (sizes only; nothing is read), or null on a fresh clone */
const AVAILABLE = demoConsultations({ RP_REAL_DATA_DIR: DATA_DIR }).find((c) => c.available)?.id ?? null;

/** a Whisper service that does not answer: nothing listens on port 9 */
function noWhisper(): void {
  process.env.RP_REAL_DATA_DIR = DATA_DIR;
  process.env.WHISPER_URL = "http://127.0.0.1:9";
  process.env.WHISPER_TOKEN = "z".repeat(40);
  process.env.WHISPER_HEALTH_TIMEOUT_MS = "200";
}

describe("API: who may run it, and what is refused", () => {
  it("GET is the crew's (404 to anyone else, real-app 5.2): credit, the five consultations, whether Whisper is usable, never its address or token", async () => {
    noWhisper();
    const outsider = await demoGET(crewReq("GET", "/api/real", undefined, false));
    expect(outsider.status).toBe(404);
    expect(await outsider.json()).toEqual({ error: "not_found" });
    const body = await (await demoGET(crewReq("GET", "/api/real"))).json();
    expect(body.credit).toEqual(MANIFEST.credit);
    expect(body.consultations.map((c: { id: string }) => c.id)).toEqual(MANIFEST.consultations.map((c: { id: string }) => c.id));
    expect(body.access).toMatchObject({ allowed: true, via: "crew" });
    expect(body.whisper.usable).toBe(false);
    const text = JSON.stringify(body);
    expect(text).not.toContain("127.0.0.1");
    expect(text).not.toContain("zzzz");
  });

  it("POST: 404 without the crew, 400 a bad id or one not of the five; a run's status is crew only, unknown ids 404", async () => {
    noWhisper();
    const no = await demoPOST(crewReq("POST", "/api/real", { consultation: "day3_consultation08" }, false));
    expect(no.status).toBe(404);
    expect((await no.json()).error).toBe("not_found");
    expect((await demoPOST(crewReq("POST", "/api/real", { consultation: "../../etc" }))).status).toBe(400);
    expect((await demoPOST(crewReq("POST", "/api/real", { consultation: "day3_consultation01" }))).status).toBe(400); // the pattern, not one of the five
    expect(runningDemo()).toBeNull();
    expect((await runGET(crewReq("GET", "/api/real/x", undefined, false), params("x"))).status).toBe(404);
    expect((await runGET(crewReq("GET", "/api/real/x"), params("x"))).status).toBe(404);
    expect((await runDELETE(crewReq("DELETE", "/api/real/x", undefined, false), params("x"))).status).toBe(404);
    expect((await runDELETE(crewReq("DELETE", `/api/real/real-${randomUUID()}`), params(`real-${randomUUID()}`))).status).toBe(404);
  });

  it.skipIf(!AVAILABLE)("POST: 503 when Whisper does not answer, and the slot it took is given back", async () => {
    noWhisper();
    const res = await demoPOST(crewReq("POST", "/api/real", { consultation: AVAILABLE }));
    expect(res.status).toBe(503);
    const b = await res.json();
    expect(b.error).toBe("whisper_unavailable");
    expect(b.reason).toMatch(/^(unreachable|timeout)$/);
    expect(runningDemo()).toBeNull();
  });

  it.skipIf(!AVAILABLE)("two POSTs at the same moment: one takes the slot, the other is told busy (the GPU is booked once)", async () => {
    noWhisper();
    const [a, b] = await Promise.all([demoPOST(crewReq("POST", "/api/real", { consultation: AVAILABLE })), demoPOST(crewReq("POST", "/api/real", { consultation: AVAILABLE }))]);
    const answers = new Map<number, { error?: string; job_id?: string; reason?: string }>([
      [a.status, await a.json()],
      [b.status, await b.json()],
    ]);
    expect([...answers.keys()].sort()).toEqual([429, 503]);
    expect(answers.get(429)).toMatchObject({ error: "busy" });
    expect(answers.get(503)).toMatchObject({ error: "whisper_unavailable" });
    // the slot the first one held was given back when Whisper did not answer, without a trace
    expect(runningDemo()).toBeNull();
    expect(getDemo(answers.get(429)!.job_id!)).toBeNull();
  });
});
