/**
 * His family screens in the timeline draft's layout (front-end line fe-fam): what the layout must not change, and the
 * small pieces it added, rendered on the server (no DOM).
 *
 *   - the sentences the back end and the tests pin are still said word for word, also where the layout now cuts one
 *     in two (the line about her phone, the reason he is asked 「是她吗？」);
 *   - every key added for the layout exists in both languages and fills its blanks;
 *   - the invitation's three steps say where it stands by the node's shape and by words: a tick for what is done, the
 *     accent dot for now, the grey ring for what comes next; never by a colour on the words;
 *   - a tap that did not work is read out at once (role="alert").
 */
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { Failed, InviteSteps, isStepState, Lead, type StepState } from "@/components/his-family/pieces";
import { herPushParts, herPushWords } from "@/components/push/HerPushLine";
import { linkStateWords, switchSees, switchTitle } from "@/lib/care/copy";
import { hc } from "@/lib/care/her-copy";
import { sharedItems } from "@/lib/care/her-view";
import { pc, type HisKey } from "@/lib/care/his-copy";
import { NO_GRANTS } from "@/lib/family/types";
import type { FamilyGrantItems } from "@/lib/store/types";

const LANGS = ["zh-Hans", "en"] as const;
const KEYS: (keyof FamilyGrantItems)[] = ["dose_summary", "bp_summary", "questions_count", "no_reply_alert", "visit_transcripts", "notes"];

describe("his family copy under the new layout", () => {
  it("keeps the pinned sentences word for word", () => {
    expect(pc("zh-Hans", "confirmAsk", { name: "Wei Ling" })).toBe("Wei Ling 接受了邀请，是她吗？");
    expect(pc("zh-Hans", "confirmWhy")).toBe("邀请链接可能被别人先打开。你点「是她」以前，她什么都看不到。");
    expect(pc("zh-Hans", "madeBody")).toContain("7 天内有效，只能用一次");
    expect(pc("zh-Hans", "stoppedBody", { name: "Wei Ling" })).toContain("Wei Ling 现在看不到你的任何记录");
    expect(pc("zh-Hans", "confirmSelf", { name: "陈先生" })).toBe("请陈先生本人点。");
    expect(linkStateWords("revoked", "zh-Hans")).toBe("已停止分享");
  });

  // The owner's decision of 2026-10-14: the same six switches, and each one shows its kind in full while it is on. The
  // first three are named for their kind and say the whole of it (they were 「每天吃药了没有 / 只有吃了、没吃、没回，没有
  // 原因」, 「这周量了几次血压 / 只有次数，没有读数」, 「有几个问题要问医生 / 只有个数，没有内容」); the other three are as before.
  it("the six switches: a title and the line under it that says what she sees, the owner's words of 10-14", () => {
    const rows = (lang: "zh-Hans" | "en") => KEYS.map((k) => [switchTitle(k, lang), switchSees(k, lang)]);
    // (the owner, 10-14 as well: professional words, not spoken ones, on his screens too: the first three titles and
    // lines are hers word for word, 我 where hers says 他)
    expect(rows("zh-Hans")).toEqual([
      ["每日服药情况", "药物名称、服药时间、未服药的原因"],
      ["血压", "每次的读数和时间"],
      ["待问医生的问题", "问题的原文，和下次就诊的日期"],
      ["两次提醒未回应时通知她", "她的手机收到一条通知，不写药名"],
      ["就诊录音和逐字稿", "她能看医生的原话，听原声"],
      ["我本人写的笔记", "她看得到你写的原文"],
    ]);
    expect(rows("en").slice(0, 3)).toEqual([
      ["Medicine each day", "Which medicine, when, and the reason when one was not taken"],
      ["Blood pressure", "Each reading and its time"],
      ["Questions for the doctor", "The questions' own words, and the date of the next visit"],
    ]);
    // her list of what he lets her see says the same six, in the same words for the first three
    expect(sharedItems({ ...NO_GRANTS, dose_summary: true }, "zh-Hans", null).map((i) => [i.title, i.detail, i.shared])).toEqual([
      ["每日服药情况", "药物名称、服药时间、未服药的原因", true],
      ["血压", "每次的读数和时间", false],
      ["待问医生的问题", "问题的原文，和下次就诊的日期", false],
      ["两次提醒未回应时通知你", "一条通知，和未回应的记录", false],
      ["就诊录音和逐字稿", "就诊记录中医生的原话，可听原声", false],
      ["他本人写的笔记", "他的笔记原文", false],
    ]);
    expect(sharedItems(NO_GRANTS, "en", null).slice(0, 3).map((i) => [i.title, i.detail])).toEqual([
      ["Medicine each day", "which medicine, when, and the reason when one was not taken"],
      ["Blood pressure", "each reading and its time"],
      ["Questions for the doctor", "the questions' own words, and the date of the next visit"],
    ]);
    // nothing on either screen still says "only how many" or "never"
    for (const lang of LANGS) {
      const all = [...rows(lang).flat(), ...sharedItems(NO_GRANTS, lang, null).flatMap((i) => [String(i.title), String(i.detail)]), hc(lang, "notSeen"), hc(lang, "weekSub")].join("\n");
      expect(all, lang).not.toMatch(/只有|没有读数|没有内容|不含原因|没有原因|几次|有几个|[Oo]nly|never|[Hh]ow many/);
    }
    expect(hc("zh-Hans", "notSeen")).toBe("他的笔记和就诊录音，需本人开启后才会向你显示。");
  });

  it("the box that says why he is asked holds the same sentence, cut at its full stop", () => {
    expect(pc("zh-Hans", "confirmWhyBody") + pc("zh-Hans", "confirmWhyTitle")).toBe(pc("zh-Hans", "confirmWhy"));
    expect(`${pc("en", "confirmWhyBody")} ${pc("en", "confirmWhyTitle")}`).toBe(pc("en", "confirmWhy"));
  });

  it("the line about her phone is the same sentence in two lines", () => {
    expect(herPushWords("Wei Ling", "zh-Hans")).toBe("Wei Ling 还没打开通知，现在收不到。她在自己的手机上打开以后才会收到。");
    expect(herPushWords("Wei Ling", "en")).toBe("Wei Ling has not turned on notifications yet, so this cannot reach her. It will once she turns them on on her phone.");
    for (const lang of LANGS) {
      const parts = herPushParts("Wei Ling", lang);
      expect(parts).toHaveLength(2);
      expect(parts.join(lang === "zh-Hans" ? "" : " ")).toBe(herPushWords("Wei Ling", lang));
    }
  });

  it("every key added for the layout is worded in both languages and fills its blanks", () => {
    const added: [HisKey, Record<string, string>][] = [
      ["familyTitle", {}],
      ["endedTitle", {}],
      ["confirmTitle", {}],
      ["confirmMeta", {}],
      ["confirmWhyTitle", {}],
      ["confirmWhyBody", {}],
      ["inviteLead", {}],
      ["inviteNote", {}],
      ["whoNameNeeded", {}],
      ["linkBoxTitle", {}],
      ["stepsTitle", {}],
      ["stepSent", {}],
      ["stepWaiting", {}],
      ["stepAccepted", {}],
      ["stepAcceptedDone", {}],
      ["stepConfirmed", {}],
      ["stepUntil", { date: "10月19日" }],
      ["stepSentOn", { date: "10月12日" }],
      ["toConfirm", {}],
      ["toSwitches", { name: "Wei Ling" }],
      ["waitingOnce", {}],
      ["openInvites", {}],
      ["lookedAt", { what: "你的吃药情况" }],
      ["lastLook", { name: "Wei Ling", when: "今天 9:02" }],
      ["accessNote", {}],
      ["historyYou", {}],
    ];
    for (const [key, vars] of added) {
      const zh = pc("zh-Hans", key, vars);
      const en = pc("en", key, vars);
      expect(zh, key).not.toBe("");
      expect(en, key).not.toBe("");
      expect(en, key).not.toBe(zh);
      expect(zh, key).not.toMatch(/\{\w+\}/);
      expect(en, key).not.toMatch(/\{\w+\}/);
    }
    // the one question a screen asks him is the header of 「是她吗？」; no other new title is a question
    expect(added.map(([k]) => k).filter((k) => /[?？]/.test(pc("zh-Hans", k, { name: "x", date: "x", what: "x", when: "x" })))).toEqual(["confirmTitle"]);
  });

  it("the history of the switches names them in his own words, as the card he changes them on does", () => {
    expect(pc("zh-Hans", "historyOff", { what: switchTitle("notes", "zh-Hans") })).toBe("关掉了「我本人写的笔记」");
    expect(pc("zh-Hans", "historyOn", { what: switchTitle("no_reply_alert", "zh-Hans") })).toBe("打开了「两次提醒未回应时通知她」");
  });
});

describe("the pieces of his family screens", () => {
  const nodes = (html: string) => [...html.matchAll(/class="rpu-tl-item"[^>]*data-node="(\w+)"/g)].map((m) => m[1]);

  it("the invitation's steps: tick, now, next, by state", () => {
    const steps = (state: StepState) => renderToStaticMarkup(createElement(InviteSteps, { locale: "zh-Hans", state, sent: "10月12日", until: "10月19日" }));
    const invited = steps("invited");
    expect(nodes(invited)).toEqual(["ok", "now", "next"]);
    expect(invited).toContain("已发出");
    expect(invited).toContain("等她接受");
    expect(invited).toContain("10月19日 以前有效");
    expect(invited).toContain('data-state="invited"');

    const accepted = steps("accepted");
    expect(nodes(accepted)).toEqual(["ok", "now", "next"]);
    expect(accepted).toContain("她已接受，等你确认");
    // the link is used up once she accepted: no date it works until
    expect(accepted).not.toContain("以前有效");

    const active = steps("active");
    expect(nodes(active)).toEqual(["ok", "ok", "ok"]);
    expect(active).toContain("已确认");
    // where it stands is the node's shape and the words: no entry is faded and no word takes a colour of its own
    for (const html of [invited, accepted, active]) {
      expect(html).not.toContain("data-dim");
      expect(html).not.toMatch(/style="[^"]*color/);
    }
  });

  it("only an invitation that is still on its way has steps", () => {
    expect(["invited", "accepted", "active"].every((s) => isStepState(s))).toBe(true);
    expect(["declined", "expired", "revoked", "left", "", null, undefined].some((s) => isStepState(s))).toBe(false);
  });

  it("a tap that did not work is read out at once, in the red-bordered box", () => {
    const html = renderToStaticMarkup(createElement(Failed, null, pc("zh-Hans", "failed")));
    expect(html).toContain('role="alert"');
    expect(html).toContain('data-variant="red"');
    expect(html).toContain("没改成，再试一次。");
  });

  it("the opening sentence of a screen is a paragraph of its own", () => {
    const html = renderToStaticMarkup(createElement(Lead, null, pc("zh-Hans", "none")));
    expect(html).toMatch(/^<p class="rpu rph-lead"/);
    expect(html).toContain("还没有邀请家人。");
  });
});
