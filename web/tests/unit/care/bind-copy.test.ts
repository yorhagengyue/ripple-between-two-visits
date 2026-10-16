/**
 * The words of binding by account (line bind; lib/care/bind-copy.ts): the owner's sentences as he wrote them, an English
 * beside every one, the same blanks in both, and each refusal of POST /api/family/bind said in words for the side that
 * asked. A changed sentence shows here.
 */
import { describe, expect, it } from "vitest";
import { bc, bindRefusal, type BindKey } from "@/lib/care/bind-copy";
import { boundWhen } from "@/components/his-family/BoundCard";

const KEYS: BindKey[] = [
  "herTitle",
  "herBody",
  "herField",
  "herCalls",
  "callsDad",
  "callsMum",
  "callsName",
  "bind",
  "herNoAccount",
  "herEmpty",
  "herSelf",
  "notFound",
  "bothFamily",
  "bothElder",
  "tooMany",
  "tooManySoon",
  "failed",
  "locked",
  "lockedFact",
  "hisTitle",
  "hisBody",
  "hisField",
  "hisEmpty",
  "hisSelf",
  "hisInvite",
  "boundTitle",
  "boundSomeone",
  "boundWho",
  "boundWhoEmail",
  "boundSees",
  "boundNot",
  "boundOk",
  "boundRemove",
  "boundState",
  "historyBound",
  "herRemoved",
  "bindAnother",
  "bindMore",
  "bindBack",
  "strangerRemoved",
];

describe("the words of binding by account", () => {
  it("the owner's sentences, word for word", () => {
    const zh = (k: BindKey, vars?: Record<string, string>) => bc("zh-Hans", k, vars);
    // her form
    expect(zh("herTitle")).toBe("填长辈的账号");
    // the owner's decision of 2026-10-14: what she sees at once is named as the kinds themselves (it named counts:
    // 「这周吃药的天数、量了几次血压、有几个问题要问医生」), here and on his card below
    expect(zh("herBody")).toBe("填他注册 Ripple 时用的账号。填好就绑定，你马上能看到：每日服药情况、血压读数、待问医生的问题；两次提醒均未回应时会通知你。他那边会收到一条通知，随时可以解除。");
    expect(zh("herField")).toBe("长辈的账号");
    expect(zh("herCalls")).toBe("你怎么称呼他");
    expect([zh("callsDad"), zh("callsMum"), zh("callsName")]).toEqual(["爸爸", "妈妈", "用他的名字"]);
    expect(zh("bind")).toBe("绑定");
    expect(zh("herNoAccount")).toBe("他还没有账号？先在他的手机上帮他注册，再回来填。");
    expect(zh("notFound")).toBe("没有找到这个账号。看看有没有打错。");
    expect(zh("bothFamily")).toBe("这个账号也是子女的账号，绑定不了。");
    expect(zh("tooMany", { time: "22:35" })).toBe("试的次数太多了，请在 22:35 以后再试。");
    expect(zh("locked")).toBe("等他在自己的手机上点了「知道了」，你就可以给他录提醒。");
    // his field
    expect(zh("hisTitle")).toBe("填家人的账号");
    expect(zh("hisBody")).toBe("填她注册 Ripple 时用的账号。填好就绑定，她马上能看到下面四项；就诊录音和你的笔记要你自己打开。");
    expect(zh("hisField")).toBe("家人的账号");
    expect(zh("bothElder")).toBe("这个账号也是长辈的账号，绑定不了。");
    expect(zh("hisInvite")).toBe("她还没有账号？发一个邀请链接给她。");
    // his card: the body of the brief, split at its full stops and not a word changed
    expect(zh("boundTitle", { name: "Wei Ling" })).toBe("Wei Ling 绑定了你的账号");
    expect(`${zh("boundWho", { login: "weiling88", when: "10月11日 21:15" })}${zh("boundSees")}${zh("boundNot")}`).toBe(
      "账号 weiling88，10月11日 21:15。她现在能看到：每日服药情况（药物名称、服药时间、未服药的原因）、血压读数、待问医生的问题；两次提醒均未回应时会通知她。就诊录音和你的笔记她看不到。",
    );
    expect(bc("en", "boundSees")).toBe(
      "She can now see: your medicine each day (which medicine, when, and the reason when you did not take it), your blood pressure readings, and the questions you want to ask your doctor; and she is told when two reminders get no reply.",
    );
    expect(bc("en", "herBody")).toContain("you can see at once: his medicine each day, his blood pressure readings, and the questions he wants to ask his doctor; and you are told when two reminders get no reply.");
    // no sentence of the binding still says a count
    for (const k of KEYS) expect(`${zh(k)}${bc("en", k)}`, k).not.toMatch(/天数|几次|有几个|how many|the days he|the days you/);
    expect([zh("boundOk"), zh("boundRemove")]).toEqual(["知道了", "不认识这个人，解除"]);
    // round two (the integrator's wording)
    expect(zh("herRemoved")).toBe("他已经解除了和你的绑定。想再绑定，请他在自己的手机上填你的账号。");
    expect(bc("en", "herRemoved")).toBe("He has removed the link with you. To link again, ask him to enter your account on his own phone.");
    expect([zh("bindAnother"), zh("bindMore")]).toEqual(["绑定另一位长辈", "再绑定一位长辈"]);
    expect(zh("strangerRemoved")).toBe("这个人自己绑定了你的账号，你已经解除。");
  });

  it("every sentence has its English, with the same blanks, and none is left with a hole", () => {
    const blanks = (s: string) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();
    for (const k of KEYS) {
      const zh = bc("zh-Hans", k);
      const en = bc("en", k);
      expect(zh.trim(), k).not.toBe("");
      expect(en.trim(), k).not.toBe("");
      expect(en, k).not.toBe(zh);
      expect(blanks(en), k).toEqual(blanks(zh));
      // no question mark in a title or a label: only the two lines that are a question to the reader
      if (!["herNoAccount", "hisInvite"].includes(k)) expect(`${zh}${en}`, k).not.toMatch(/[?？]/);
    }
    expect(bc("en", "boundTitle", { name: "Wei Ling" })).toBe("Wei Ling linked to your account");
    expect(bc("en", "tooMany", { time: "22:35" })).toBe("Too many tries. Please try again after 22:35.");
  });

  it("each refusal in words, for the side that asked", () => {
    expect(bindRefusal("zh-Hans", "family", "account_not_found")).toBe("没有找到这个账号。看看有没有打错。");
    expect(bindRefusal("zh-Hans", "patient", "account_not_found")).toBe("没有找到这个账号。看看有没有打错。");
    expect(bindRefusal("zh-Hans", "family", "bind_wrong_kind")).toBe("这个账号也是子女的账号，绑定不了。");
    expect(bindRefusal("zh-Hans", "patient", "bind_wrong_kind")).toBe("这个账号也是长辈的账号，绑定不了。");
    expect(bindRefusal("zh-Hans", "family", "bind_self")).toBe("这是你自己的账号。这里填长辈的账号。");
    expect(bindRefusal("zh-Hans", "patient", "bind_self")).toBe("这是你自己的账号。这里填家人的账号。");
    expect(bindRefusal("zh-Hans", "family", "too_many", "22:35")).toBe("试的次数太多了，请在 22:35 以后再试。");
    expect(bindRefusal("zh-Hans", "family", "too_many")).toBe("试的次数太多了，请过一会儿再试。");
    // he removed her before: only her side is ever told so
    expect(bindRefusal("zh-Hans", "family", "bind_removed")).toBe("他已经解除了和你的绑定。想再绑定，请他在自己的手机上填你的账号。");
    expect(bindRefusal("zh-Hans", "patient", "bind_removed")).toBe("没绑成，再试一次。");
    // anything else (the server could not be reached, a link that was just made by another tap): try again
    for (const other of [undefined, "", "link_exists", "store_unavailable", "not_signed_in"]) expect(bindRefusal("zh-Hans", "patient", other), String(other)).toBe("没绑成，再试一次。");
    expect(bindRefusal("en", "family", "bind_wrong_kind")).toBe("That account is a family member's account too. It cannot be linked.");
  });

  it("when she bound it, as his card writes it: the date and the time in his time zone", () => {
    expect(boundWhen("2026-10-11T13:15:00.000Z", "Asia/Singapore", "zh-Hans")).toBe("10月11日 21:15");
    expect(boundWhen("2026-10-11T13:15:00.000Z", "Asia/Singapore", "en")).toBe("11 Oct 21:15");
    expect(boundWhen("2026-10-11T16:05:00.000Z", "Asia/Singapore", "zh-Hans")).toBe("10月12日 0:05");
    expect(boundWhen(null, "Asia/Singapore", "zh-Hans")).toBe("");
  });
});
