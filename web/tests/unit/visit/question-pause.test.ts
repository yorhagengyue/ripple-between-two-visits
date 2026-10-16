/**
 * Task card M2 做-4: the "Before you go" question list shows when the doctor invites questions or closes,
 * or when the conversation pauses (8 s without speech between two sentences), or when the visit ends.
 * The invite ("anything else", v3-u09), the closing cue (v1-u10) and the end are covered in
 * replay-extract.test.ts; this file covers the pause.
 */
import { getMemoryStore } from "@/lib/store/memory";
import { describe, expect, it } from "vitest";
import { questionListAnchor, type QLine } from "@/lib/visit/questions";
import { processChunk, startVisit } from "@/lib/visit/pipeline";
import { newSession } from "./helpers";

const line = (id: string, start: number, end: number, text: string, role: QLine["role"] = "doctor"): QLine => ({
  id,
  text,
  role,
  t_start_ms: start,
  t_end_ms: end,
});

describe("question list after a pause in the conversation", () => {
  it("questionListAnchor: a gap of 8 s or more anchors the list on the line before it; 7.999 s does not", () => {
    const base = [
      line("a", 0, 3000, "So Mr Tan, how has your blood pressure been at home?"),
      line("b", 3500, 6000, "Quite okay lah. Around 130, I think.", "patient"),
    ];
    expect(questionListAnchor(base, false)).toBe(-1);
    expect(questionListAnchor([...base, line("c", 6000 + 7999, 16000, "Okay.")], false)).toBe(-1);
    expect(questionListAnchor([...base, line("c", 6000 + 8000, 16000, "Okay.")], false)).toBe(1);
    // the first pause counts, wherever it is
    expect(questionListAnchor([base[0], line("x", 11000, 12000, "Hmm."), ...base.slice(1).map((l) => ({ ...l, t_start_ms: l.t_start_ms + 9000, t_end_ms: l.t_end_ms + 9000 }))], false)).toBe(0);
    // an invitation to ask still wins over a later pause
    const invite = [line("i", 0, 2000, "Anything else you want to ask?"), line("j", 2500, 4000, "No."), line("k", 13000, 14000, "Okay.")];
    expect(questionListAnchor(invite, false)).toBe(0);
    // no pause and not ended: no list; ended: after the last line
    expect(questionListAnchor(base, true)).toBe(1);
  });

  it("through the pipeline: realtime chunks with an 8 s pause bring up the list after the line before the pause", async () => {
    // D42: the v3 visit, recording; his open questions from before are waiting
    const s = await newSession({ story_day: 42 });
    await startVisit(getMemoryStore(), s, { mode: "record", consent: { given: true } });
    const first = await processChunk(getMemoryStore(), s, "v3", [
      { t_start_ms: 0, t_end_ms: 3000, speaker_cluster: 0, text: "So Mr Tan, how has your blood pressure been at home?" },
      { t_start_ms: 3500, t_end_ms: 6000, speaker_cluster: 1, text: "Quite okay lah. Around 130, I think." },
    ]);
    expect(first.view.qlist).toBeNull();
    // the next sentence starts 7.9 s after the last one ended: still no list
    const close = await processChunk(getMemoryStore(), s, "v3", [{ t_start_ms: 13900, t_end_ms: 15000, speaker_cluster: 0, text: "Okay." }]);
    expect(close.view.qlist).toBeNull();
    // 8 s or more of silence before the next sentence: the list shows after the line before that pause
    const after = await processChunk(getMemoryStore(), s, "v3", [{ t_start_ms: 23000, t_end_ms: 25000, speaker_cluster: 0, text: "Let me see your arm." }]);
    expect(after.view.qlist).not.toBeNull();
    expect(after.view.qlist!.anchor).toBe(close.utterances[0].id);
    expect(after.view.qlist!.items.length).toBeGreaterThan(0);
    expect(after.view.counts.q).toBe(after.view.qlist!.items.length);
    // Ripple only asks: every list item is his own question or a Ripple question, none is answered yet
    expect(after.view.qlist!.items.every((q) => q.state === "not_asked")).toBe(true);
  });
});
