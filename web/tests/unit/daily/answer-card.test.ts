/**
 * One answer of /api/ask as the ask screen draws it (components/daily/AnswerCard.tsx; the timeline design's 07, 09 and
 * 10): a line whose nodes say where each entry comes from, in the order lib/safety gave, with the hooks the journeys
 * read. Rendered on the server from real answers of the pipeline (the offline model), so nothing here words a sentence.
 * Also: the screen before he asked anything, on an example account (22-2) and on his own.
 */
import { createElement, type ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { AnswerCard } from "@/components/daily/AnswerCard";
import { AskSection } from "@/components/today/AskSection";
import { EXAMPLE_ASKS } from "@/components/today/ExampleBanner";
import { createMockLlm } from "@/lib/llm";
import { ask } from "@/lib/safety/pipeline";
import { TEMPLATES } from "@/lib/safety/templates";
import { storedAnswer } from "@/lib/safety/turns";
import { getMemoryStore } from "@/lib/store/memory";

const store = getMemoryStore();
const html = (el: ReactElement) => renderToStaticMarkup(el);
const text = (s: string) => s.replace(/<[^>]+>/g, "");

async function answerTo(question: string, locale: "zh-Hans" | "en" = "zh-Hans") {
  const s = await store.createSession({ story_day: 29, story_time: "20:15", ttl_hours: 1 });
  const r = await ask({ sessionId: s.id, text: question, locale, role: "patient" }, { store, llm: createMockLlm(), checker: null, checkerReason: "test", publish: () => {}, costGuard: null });
  return storedAnswer(r);
}

/** The entries of the line, in order: each one's node and, where it is a part of the answer, its kind. */
function entries(out: string): string[] {
  return [...out.matchAll(/<div class="rpu-tl-item"[^>]*data-node="([a-z]+)"[^>]*>/g)].map((m) => {
    const kind = /data-kind="([a-z]+)"/.exec(m[0])?.[1];
    return kind ? `${m[1]}:${kind}` : m[1];
  });
}

describe("AnswerCard: an answer as one line", () => {
  it("the hero question: his words first (the turn's heading), then the doctor's words, the label, Ripple's referral, and the tick that says it is on his list", async () => {
    const question = "今天 150/95，我能不能多吃一粒？";
    const out = html(createElement(AnswerCard, { question, answer: await answerTo(question), locale: "zh-Hans" }));
    expect(out).toMatch(/^<div data-testid="ask-answer" data-complete="true" data-route="refuse_route"><section class="rpu-stack" data-testid="ask-turn" data-route="refuse_route" data-latest="true">/);
    expect(entries(out)).toEqual(["me", "doc:quote", "rip:ripple", "lab:label", "ok"]);
    // his own words: the plain face, as the heading; never a quote
    expect(out).toContain(`<h1 class="rpu-bubble" data-rp="bubble" data-rp-role="say">${question}</h1>`);
    expect(out).toContain('<span class="rpu-tl-who" data-node="me">你问</span>');
    // the doctor's own words: who and when on the head line, the serif quote, the play pill, the stand-in tag
    const quote = /<div class="rpu-tl-item"[^>]*data-kind="quote".*?(?=<div class="rpu-tl-item")/.exec(out)?.[0] ?? "";
    expect(quote).toContain('data-testid="answer-line"');
    expect(quote).toContain('data-source="visit:v2:R4"');
    expect(quote).toMatch(/<p class="rpu-tl-head" data-rp="source-tag" data-kind="doctor"><span class="rpu-tl-who" data-node="doc">医生说<\/span><span> · 9月1日 · 0:43<\/span><\/p>/);
    expect(quote).toMatch(/<blockquote class="rpu rpu-said"[^>]*data-source-ref="v2-u08"[^>]*>“<span data-testid="answer-text">Please don&#x27;t change the dose yourself\./);
    // (the clip's address also names the test's own session)
    expect(quote).toMatch(/<button[^>]*data-rp="play-pill"[^>]*data-testid="answer-clip"[^>]*data-src="\/api\/visits\/v2\/clip\?u=v2-u08[^"]*"[^>]*data-playing="false"/);
    expect(quote).toContain("代录音");
    // the label: what it says, and as printed
    expect(out).toContain("药品标签");
    expect(out).toContain("Take ONE tablet every MORNING");
    // Ripple's fixed sentence, word for word, in its bubble
    expect(out).toContain(`<p class="rpu-bubble" data-rp="bubble" data-node="rip" data-rp-role="say" lang="zh-Hans"><span data-testid="answer-text">${TEMPLATES.refer_doctor.zh}</span></p>`);
    // where his question went
    expect(out).toMatch(/<div class="rpu-tl-item"[^>]*data-node="ok"[^>]*data-testid="ask-question-added"[^>]*data-question="[^"]+"/);
    expect(out).toContain('href="/p/questions"');
    for (const w of ["可以多吃", "没关系", "加一粒吧", "吃两粒"]) expect(text(out)).not.toContain(w);
  });

  it("an earlier answer opened from its row does not say the question again", async () => {
    const question = "今天 150/95，我能不能多吃一粒？";
    const out = html(createElement(AnswerCard, { question, answer: await answerTo(question), locale: "zh-Hans", latest: false, showQuestion: false }));
    expect(out).toMatch(/^<section class="rpu-stack" data-testid="ask-turn" data-route="refuse_route" data-latest="false">/);
    expect(out).not.toContain("<h1");
    expect(entries(out)).toEqual(["doc:quote", "rip:ripple", "lab:label", "ok"]);
  });

  it("an emergency (09): his words, then the red card by itself with 「Ripple」 and one call button, then the doctor's warning line on the line under it", async () => {
    // (10-14, the owner's decision: chest pain alone is kept for his doctor, 995 if it gets bad, on one line with no card:
    // tests/unit/safety/symptom-signal.test.ts; the card stays for what is happening badly now, such as not getting air)
    const question = "我胸口好痛，喘不上气";
    const out = html(createElement(AnswerCard, { question, answer: await answerTo(question), locale: "zh-Hans" }));
    // two stretches of the line with the card between them
    const order = [...out.matchAll(/data-rp="(timeline|emergency)"/g)].map((m) => m[1]);
    expect(order).toEqual(["timeline", "emergency", "timeline"]);
    expect(out).toMatch(/<div data-testid="answer-line" data-kind="emergency" data-source="[^"]+"><section class="rpu rpu-emergency" data-rp="emergency"/);
    expect(out).toContain('<p class="rpu-emergency-who" data-rp="emergency-who">Ripple</p>');
    expect(out).toContain(`<h2 class="rpu-emergency-title"><span data-testid="answer-text">${TEMPLATES.emergency_995.zh}</span></h2>`);
    expect((out.match(/href="tel:995"/g) ?? []).length).toBe(1);
    expect(entries(out)).toEqual(["me", "doc:quote"]);
    // no other number anywhere near an emergency
    for (const n of ["1767", "1771", "9151", "1800-3535-800"]) expect(out).not.toContain(n);
  });

  it("self-harm (10): his words and the four fixed sentences on one line, each in Ripple's bubble with its numbers as buttons; only 995 is red", async () => {
    const question = "我觉得活着没什么意思，只会拖累孩子";
    const out = html(createElement(AnswerCard, { question, answer: await answerTo(question), locale: "zh-Hans" }));
    // one line: his entry, then the group that is the part
    expect((out.match(/data-rp="timeline"/g) ?? []).length).toBe(1);
    expect(out).toMatch(/<div class="rpu-tl-group" data-rp="tl-group" data-testid="answer-line" data-kind="hotlines" data-source="[^"]+">/);
    // (the harness, 10-16: right after the helplines the ladder's follow-up question, FollowUpQuestion's entry, then the
    // ladder's "I'm here ..." and "tell your doctor", Ripple's own lines with no number)
    expect(entries(out)).toEqual(["me", "rip", "rip", "rip", "rip", "rip", "rip:ripple", "rip:ripple"]);
    expect(out.indexOf('data-testid="ask-followup"')).toBeGreaterThan(out.lastIndexOf('class="rpu-hotline"'));
    expect(out.indexOf('data-testid="ask-followup"')).toBeLessThan(out.indexOf('data-kind="ripple"'));
    expect((out.match(/class="rpu-hotline"/g) ?? []).length).toBe(4);
    const calls = [...out.matchAll(/<a class="rpu-act" href="([^"]+)" data-variant="([a-z]+)"(?: data-urgent="true")? data-rp="call">/g)].map((m) => [m[1], m[2]]);
    expect(calls).toEqual([
      ["tel:995", "danger"],
      ["tel:1767", "primary"],
      ["https://wa.me/6591511767", "secondary"],
      ["tel:1771", "primary"],
      ["tel:18003535800", "primary"],
    ]);
    expect(out).toContain("WhatsApp 发文字");
    expect(text(out)).not.toContain("已记录");
    expect(out).not.toContain("rpu-emergency");
  });

  it("how he feels (07-2d) and chit-chat (07-2g) are drawn by the day's record's own answer, with this screen's hooks", async () => {
    const tired = html(createElement(AnswerCard, { question: "最近很累，没有力气", answer: await answerTo("最近很累，没有力气"), locale: "zh-Hans" }));
    expect(tired).toContain('data-route="log_only"');
    expect(tired).toMatch(/<div class="fe04-part" data-testid="answer-line" data-kind="ripple" data-source="tpl:noted">/);
    expect(tired).not.toContain("chat-part");
    expect(tired).not.toContain("ask-question-added");

    const weather = await answerTo("今天天气怎么样？");
    const offer = html(createElement(AnswerCard, { question: "今天天气怎么样？", answer: weather, locale: "zh-Hans" }));
    expect(offer).toContain('data-route="cant_help"');
    expect(offer).toMatch(/<div class="fe04-part" data-testid="answer-line" data-kind="ripple" data-source="tpl:cant_help">/);
    expect(offer).toMatch(/<div class="fe04-under" data-testid="ask-note-offer" data-noted="false">/);
    expect(offer).toMatch(/<button[^>]*data-testid="ask-write-down"[^>]*>记录下来<\/button>/);
    expect(offer).toMatch(/<button[^>]*data-testid="ask-write-skip"[^>]*>不用<\/button>/);
    expect(offer).not.toContain("ask-written");
    // already written down today: Ripple's own entry says so, and nothing is offered again
    const noted = html(createElement(AnswerCard, { question: "今天天气怎么样？", answer: weather, locale: "zh-Hans", noted: true }));
    expect(noted).toMatch(/<div class="fe04-under" data-testid="ask-note-offer" data-noted="true"><\/div>/);
    expect(noted).toContain('<p class="rpu-bubble" data-rp="bubble" data-node="rip" data-rp-role="say" data-testid="ask-written">已记录。</p>');
    expect(noted).not.toContain("ask-write-down");
  });
});

describe("the ask screen before he asked anything", () => {
  const screen = (props: { example?: boolean; voice?: boolean; aiOff?: boolean }) => html(createElement(AskSection, { locale: "zh-Hans", mode: "screen", ...props }));

  it("his own account: one sentence as the heading, and the dock with the field and 「问这句」 held at the foot", () => {
    const out = screen({});
    expect(out).toMatch(/^<div class="rpu-askscreen" data-rp="ask-screen" data-testid="ask-section" data-mode="screen" data-turns="0">/);
    expect(out).toContain('<h1 class="rpu-text" data-variant="lede" data-testid="ask-start" style="margin:0">想问什么，打字问。</h1>');
    expect(out).not.toContain("example-ask");
    expect(out).toMatch(/<div class="rpu rpu-dock rpu-askdock" data-rp="dock" data-bar="true" data-pinned="true">/);
    expect(out).toMatch(/<input[^>]*data-testid="ask-input"/);
    expect(out).toMatch(/<button type="submit" class="rpu-btn" data-variant="primary" data-testid="ask-send"><span>问这句<\/span><\/button>/);
    // nothing of the general states while nothing stands in the way
    for (const hook of ["ask-offline", "ask-no-ai", "ask-mic", "ask-asking", "ask-pending", "ask-error", "ask-earlier"]) expect(out).not.toContain(hook);
  });

  it("an example account (22-2): 「可以这样问」, marked 示例, and the example's three sentences as rows that only fill the field", () => {
    const out = screen({ example: true });
    expect(out).toMatch(/<section class="rpu rpu-list" data-rp="example-asks" data-testid="ask-start"><h1 class="rpu-text" data-variant="strong" data-size="large"[^>]*>可以这样问 <span[^>]*data-rp="tag"[^>]*>示例<\/span><\/h1>/);
    const rows = [...out.matchAll(/<button[^>]*data-action="example-ask" data-text="([^"]+)"/g)].map((m) => m[1]);
    expect(rows).toEqual([...EXAMPLE_ASKS["zh-Hans"]]);
    expect(rows).toEqual(["今天 150/95，我能不能多吃一粒？", "我今天好累", "胸口痛"]);
  });

  it("without his consent to AI processing: the design's one sentence in a grey box at the top, with the way to where he changes it", () => {
    const out = screen({ aiOff: true });
    expect(out).toMatch(/<div class="rpu rpu-box" data-rp="box" data-variant="grey"><p class="rpu-box-t"><span role="note" data-testid="ask-no-ai">你没有同意用 AI，这里只能帮你记下来、转给医生。<\/span><\/p>/);
    expect(out).toMatch(/<a[^>]*data-testid="ask-no-ai-change"[^>]*href="\/p\/me\/ai"|<a[^>]*href="\/p\/me\/ai"[^>]*data-testid="ask-no-ai-change"/);
    expect(out.indexOf("ask-no-ai")).toBeLessThan(out.indexOf("ask-start"));
  });
});
