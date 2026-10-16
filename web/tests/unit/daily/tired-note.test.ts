/**
 * 「我今天好累」 (task M4 item 4, literal requirement): stored as a note; the reply has 「服用了吗」 only while
 * today's dose has no answer yet; it never explains (no 因为, 副作用, because, side effect).
 */
import { describe, expect, it } from "vitest";
import { POST as askRoute } from "@/app/api/ask/route";
import { POST as dosesRoute } from "@/app/api/doses/route";
import { renderText } from "@/lib/safety/render";
import { TEMPLATES } from "@/lib/safety/templates";
import type { AskResult } from "@/lib/safety/types";
import { cueNoReply } from "@/lib/session/ops";
import { getMemoryStore } from "@/lib/store/memory";
import { CAUSE_WORDS, postReq, sessionAt } from "./helpers";

async function say(sessionId: string, text: string, locale: "zh-Hans" | "en" = "zh-Hans"): Promise<AskResult> {
  const res = await askRoute(postReq("/api/ask", sessionId, { text, locale, role: "patient" }));
  expect(res.status).toBe(200);
  return (await res.json()) as AskResult;
}

function noCause(result: AskResult) {
  for (const loc of ["zh-Hans", "en"] as const) {
    const out = renderText(result, loc).toLowerCase();
    for (const w of CAUSE_WORDS) expect(out, `${loc}: ${w}`).not.toContain(w.toLowerCase());
  }
}

describe("我今天好累", () => {
  it("today's dose already answered (seed D29: taken): a note, 已记录, no check-in question", async () => {
    const s = await sessionAt(29, "20:15");
    const result = await say(s.id, "我今天好累");
    expect(result.route).toBe("log_only");
    const out = renderText(result, "zh-Hans");
    expect(out).toContain("已记录");
    expect(out).not.toContain("服用了吗");
    noCause(result);
    const notes = await getMemoryStore().listNotes(s.id, { fromDay: 29, toDay: 29 });
    expect(notes.map((n) => n.text)).toContain("我今天好累");
    expect(notes.find((n) => n.text === "我今天好累")).toMatchObject({ source: "typed", app_reply: "logged only" });
  });

  it("no answer yet today (D42: nothing recorded): the note and 「今天的药服用了吗？」", async () => {
    const s = await sessionAt(42, "08:00");
    const result = await say(s.id, "我今天好累");
    expect(result.route).toBe("log_only");
    expect(renderText(result, "zh-Hans")).toContain("服用了吗");
    noCause(result);
    expect((await getMemoryStore().listNotes(s.id, { fromDay: 42, toDay: 42 })).map((n) => n.text)).toContain("我今天好累");

    // he answers (没吃 is an answer too): the next time, no check-in question
    const res = await dosesRoute(postReq("/api/doses", s.id, { medication_id: "med-amlodipine", slot: "morning", state: "missed", reason: "forgot", reason_text: "忘了" }));
    expect(res.status).toBe(200);
    const again = await say(s.id, "我今天好累");
    expect(renderText(again, "zh-Hans")).not.toContain("服用了吗");
    noCause(again);
  });

  it("an unconfirmed dose (等下, or no reply) is not an answer: the check-in question is asked", async () => {
    const s = await sessionAt(43);
    await cueNoReply(getMemoryStore(), s);
    expect((await getMemoryStore().listDoses(s.id, { fromDay: 43, toDay: 43 }))[0]).toMatchObject({ state: "unconfirmed", reason: "no_reply" });
    expect(renderText(await say(s.id, "我今天好累"), "zh-Hans")).toContain("服用了吗");
  });

  it("in English: the same rule, the same fixed check-in words", async () => {
    const answered = await sessionAt(29, "20:15");
    const r1 = await say(answered.id, "I'm so tired today", "en");
    expect(r1.route).toBe("log_only");
    expect(renderText(r1, "en")).not.toContain("Have you taken today's tablet?");
    noCause(r1);
    const open = await sessionAt(42, "08:00");
    const r2 = await say(open.id, "I'm so tired today", "en");
    expect(renderText(r2, "en")).toContain("Have you taken today's tablet?");
    noCause(r2);
  });

  it("before any medicine is due (D5) there is nothing to check: only the note", async () => {
    const s = await sessionAt(5);
    const result = await say(s.id, "我今天好累");
    // a plain note gets 「已记录。」 and nothing after it (owner 10-14: the 995 line under every note came too early)
    expect(renderText(result, "zh-Hans")).toBe("已记录。");
    expect(renderText(result, "zh-Hans")).not.toContain(TEMPLATES.safety_line.zh);
    expect(renderText(result, "zh-Hans")).not.toContain("服用了吗");
  });

  it("D20 (seed: that morning's dose taken): only the note, in Chinese and in English alike", async () => {
    const s = await sessionAt(20);
    const zh = await say(s.id, "我今天好累");
    expect(renderText(zh, "zh-Hans")).not.toContain("服用了吗");
    noCause(zh);
    const en = await say(s.id, "I'm so tired today", "en");
    expect(renderText(en, "en")).not.toContain("Have you taken today's tablet?");
    noCause(en);
  });
});
