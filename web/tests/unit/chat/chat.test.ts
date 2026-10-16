/**
 * Track K, journey 04 (M13; e2e-chains 5.1, 5.3): his conversation kept day by day from track S's rows (every sentence
 * goes through the safety layer, chit-chat to S's cant_help route), the doctor's line under a note about the same symptom
 * (only added to the list when he taps), and Today's chat slot.
 */
import { randomUUID } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { getAuthProvider } from "@/lib/auth";
import { createAccountWithSpace } from "@/lib/auth/dev-accounts";
import { relatedDoctorLine } from "@/lib/chat/related";
import { confirmedClinicianLines } from "@/lib/chat/said";
import { chatDay, chatToday } from "@/lib/chat/view";
import { addQuestionFor } from "@/lib/profile/questions";
import { ask } from "@/lib/safety";
import { detectLang } from "@/lib/safety/text";
import { recordAskTurn } from "@/lib/safety/turns";
import { getMemoryStore } from "@/lib/store/memory";
import type { SessionRow } from "@/lib/store/types";
import { scopedStore, type ScopedStore } from "@/lib/subject";

const store = getMemoryStore();
const ANKLE_NOTE = "今天在大巴窑中心走了一圈，脚踝有点肿。";
const ANKLE_LINE = "Some people get ankle swelling with this one. If you notice it, tell me.";

async function account(space: "example" | "blank") {
  const a = await createAccountWithSpace(store, getAuthProvider(), { login: `kc${randomUUID().slice(0, 10)}`, password: "a long test password", space });
  const own = scopedStore(store, a.scope!, "self", { userId: a.userId, maskSessionId: true });
  const scope = (await own.getSession(a.scope!.id))!;
  return { own, scope };
}

/** What POST /api/ask does with one sentence: the safety layer answers, track S keeps the turn. */
async function say(own: ScopedStore, scope: SessionRow, text: string) {
  const result = await ask({ sessionId: scope.id, text, locale: "zh-Hans", role: "patient" }, { store: own, aiAllowed: true });
  await recordAskTurn(own, scope.id, { day: scope.story_day, text, lang: detectLang(text), result });
  return result;
}

describe("track K writes no chat row and routes nothing around the safety layer", () => {
  it("no file of track K's chat calls addChatMessage, and the day's record posts nothing of its own (asking is done on the ask screen)", () => {
    for (const dir of [path.join("lib", "chat"), path.join("app", "api", "chat"), path.join("components", "chat")]) {
      const abs = path.join(process.cwd(), dir);
      const files = readdirSync(abs, { recursive: true }).map(String).filter((f) => /\.tsx?$/.test(f));
      for (const f of files) expect(readFileSync(path.join(abs, f), "utf8"), `${dir}/${f}`).not.toMatch(/addChatMessage\(/);
    }
    const screen = readFileSync(path.join(process.cwd(), "components", "chat", "ChatScreen.tsx"), "utf8");
    // owner's tidy of 10-13: the day's record has no field any more, so it sends no sentence anywhere
    expect(screen).not.toContain('postJson("/api/ask"');
    expect(screen).not.toContain("/api/chat/say");
  });
});

describe("the doctor's line under a note about the same symptom", () => {
  it("the example account: Dr Lim's ankle line under the ankle note; nothing for another symptom or no body part", async () => {
    const { own, scope } = await account("example");
    const lines = await confirmedClinicianLines(own, scope, { roles: ["doctor"] });
    expect(relatedDoctorLine(ANKLE_NOTE, lines)).toMatchObject({ visitId: "v2", utteranceId: "v2-u07", text: ANKLE_LINE, role: "doctor", tStartMs: 37236 });
    expect(relatedDoctorLine("My ankles are a bit swollen today.", lines)?.utteranceId).toBe("v2-u07");
    expect(relatedDoctorLine("今天脸有点肿。", lines)).toBeNull();
    expect(relatedDoctorLine("有点肿。", lines)).toBeNull();
    expect(relatedDoctorLine("今天有点头晕。", lines)).toBeNull();
    expect(relatedDoctorLine("我今天好累。", lines)).toBeNull();
  });

  it("a blank account has no doctor's lines at all", async () => {
    const { own, scope } = await account("blank");
    expect(relatedDoctorLine(ANKLE_NOTE, await confirmedClinicianLines(own, scope))).toBeNull();
  });
});

describe("the conversation, day by day", () => {
  it("「我今天好累。」, the ankle note and the weather: kept in order by track S, each answered its own way", async () => {
    const { own, scope } = await account("example");
    expect((await say(own, scope, "我今天好累。")).route).toBe("log_only");
    expect((await say(own, scope, ANKLE_NOTE)).route).toBe("log_only");
    const before = (await own.listQuestions(scope.id)).length;
    expect((await say(own, scope, "今天会下雨吗？")).route).toBe("cant_help");

    const day = await chatDay(own, scope, scope.story_day, "zh-Hans");
    expect(day.isToday).toBe(true);
    expect(day.turns.map((t) => [t.answer?.route, t.text])).toEqual([
      ["log_only", "我今天好累。"],
      ["log_only", ANKLE_NOTE],
      ["cant_help", "今天会下雨吗？"],
    ]);
    const [t1, t2, t3] = day.turns;
    expect(t1.answer?.sentences.map((s) => s.zh)).toContain("已记录。");
    expect(t1.checkIn).toBe(true); // today's medicine has no answer yet on the example's day 42
    expect(t1.related).toBeNull();
    expect(t2.related).toMatchObject({ utteranceId: "v2-u07", text: ANKLE_LINE, at: "0:37" });
    expect(t2.added).toBeNull();
    expect(t3.answer?.sentences.map((s) => s.zh)).toEqual(["这件事我帮不上忙，需要记录下来吗？"]);
    expect(t3.noted).toBe(false);
    // chit-chat adds no question
    expect((await own.listQuestions(scope.id)).length).toBe(before);

    // 「记下来」: his words as today's note (POST /api/notes does exactly this); the turn then reads noted
    await own.addNote(scope.id, { day: scope.story_day, text: "今天会下雨吗？", source: "typed" });
    expect((await chatDay(own, scope, scope.story_day, "zh-Hans")).turns[2].noted).toBe(true);
  });

  it("「加进问题单」 under the ankle note: his own words on the list (origin chat), shown as added; once", async () => {
    const { own, scope } = await account("example");
    await say(own, scope, ANKLE_NOTE);
    const before = await own.listQuestions(scope.id);
    const r = await addQuestionFor(own, scope, { for: "doctor", origin: "chat", text: ANKLE_NOTE });
    expect(r.outcome).toBe("created");
    expect(r.question).toMatchObject({ for: "doctor", origin: "chat", text: ANKLE_NOTE, status: "open" });
    const again = await addQuestionFor(own, scope, { for: "doctor", origin: "chat", text: ANKLE_NOTE });
    expect(again.outcome).toBe("merged");
    expect((await own.listQuestions(scope.id)).length).toBe(before.length + 1);
    const day = await chatDay(own, scope, scope.story_day, "zh-Hans");
    expect(day.turns[0].added).toEqual({ questionId: r.question.id });
  });

  it("Today's chat slot: null before he ever talked; then today's count and the first line of the last reply", async () => {
    const { own, scope } = await account("blank");
    expect(await chatToday(own, scope, "zh-Hans")).toBeNull();
    await say(own, scope, "今天会下雨吗？");
    expect(await chatToday(own, scope, "zh-Hans")).toEqual({ count: 1, last: { text: "今天会下雨吗？", reply: "这件事我帮不上忙，需要记录下来吗？" }, earlierDays: 0 });
  });
});
