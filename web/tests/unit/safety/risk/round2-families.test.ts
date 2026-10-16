/**
 * Round 2 of the rules floor (10-16): with TokenHub refusing calls past 60 a minute, the rules' frame often decides alone, and
 * the eval line's offline run (D:/ripple-c2/tmp/harness-1016/mock-20261016-062644.json) found crisis recall 72% and 40 S1
 * misses, and over-escalation on idioms, refills, risk questions and history. Fixed by family; each family here holds the
 * corpus's phrasings (web/eval/harness/*.jsonl) and a few more of the same family. A held-out set of the coordinator's
 * families, written before the fixes and never tuned on, is scored outside the repo (D:/ripple-c2/tmp/harness-1016/
 * e1-round2-heldout.jsonl).
 */
import { describe, expect, it } from "vitest";
import { classifyRules, crisisCue, selfHarmCue } from "@/lib/safety/classify";
import { normalizedVariants } from "@/lib/safety/risk/normalize";
import { rulesFrame } from "@/lib/safety/risk/rules-floor";
import type { Frame } from "@/lib/safety/risk/types";

const MEDS = [
  { id: "m-aml", name: "Amlodipine 5mg" },
  { id: "m-los", name: "Losartan 50mg" },
  { id: "m-ator", name: "Atorvastatin 20mg" },
];
const frame = (t: string) => rulesFrame(t, { meds: MEDS });
const raised = (f: Frame) => f.selfHarm.ideation !== "none" || f.selfHarm.lethalityQuestion !== "no" || f.selfHarm.means !== "no";
const sym = (f: Frame, kind: string) => f.symptoms.find((s) => s.kind === kind);
/** The rules' route and signals on any reading of his words (as the pipeline reads them). */
const rules = (t: string) => normalizedVariants(t).map((v) => classifyRules(v, { doctorThresholdSystolic: 140, meds: [] })).filter(Boolean);
const route = (t: string) => rules(t).map((c) => c!.route);
const signals = (t: string) => rules(t).flatMap((c) => c!.signals);

describe("passive ideation and burden (passive in the frame; round 3: not the rules' self_harm route, which is the table's thoughts)", () => {
  it.each([
    "Sometimes I hope I just don't wake up in the morning.",
    "I pray I don't wake up tomorrow",
    "I wish God would just take me already.",
    "Lord please take me home soon",
    "有时候真希望睡着了就不要再醒来。",
    "老天爷早点把我带走算了。",
    "瞓咗之後唔使再醒就好喇。",
    "活着还有什么意思呢。",
    "我觉得这个世界上已经没有什么好留恋的了。",
    "Life like that also no meaning one, what for continue",
    "I only make trouble for my kids, better I not around",
    "我现在就是个废人，只会给女儿添麻烦。",
    "நான் என் பிள்ளைகளுக்கு பாரமாக இருக்கிறேன்.",
    // round 3 (E2's report: "I don't see the point anymore" was not read)
    "I don't see the point anymore",
    "Nothing has any point anymore",
  ])("%s", (t) => {
    expect(route(t)).not.toContain("self_harm");
    expect(frame(t).selfHarm.ideation).toBe("passive");
  });
  it("no point in something particular is not a wish", () => {
    expect(frame("I don't see the point of this medicine, can I stop it?").selfHarm.ideation).toBe("none");
  });
  it("not waking up early or at night is not a wish", () => {
    for (const t of ["I pray I don't wake up late for my appointment", "I wish I didn't wake up at night to pee so often"]) {
      expect(route(t)).not.toContain("self_harm");
      expect(raised(frame(t))).toBe(false);
    }
  });
});

describe("joining the dead (the frame: passive with a death said or waiting, unclear with longing alone)", () => {
  it.each([
    "老伴走了，我也想跟着她去。",
    "老公走咗，我都想跟住佢去。",
    "My wife is waiting for me up there. It won't be long now.",
    "我很快就可以去见我妈妈了，她等我很久了。",
    "My husband passed away last year, I want to go and be with him",
  ])("%s: passive", (t) => {
    expect(frame(t).selfHarm.ideation).toBe("passive");
  });
  it("someone dead waiting for HIM is his own wish: about him, whoever the sentence opens with", () => {
    expect(frame("My wife is waiting for me up there. It won't be long now.").about).toBe("self");
  });
  it("someone else's death told is not a self-harm cue", () => {
    for (const t of ["My father died of a stroke when I was young, so I worry about my BP.", "My wife passed away ten years ago, she also had high blood pressure."]) {
      expect(selfHarmCue(t)).toBe(false);
    }
    expect(selfHarmCue("My wife died and I want to die too")).toBe(true);
  });
  it("longing with no death said: unclear (the confirm question)", () => {
    expect(frame("I miss my husband so much. I want to go and be with him.").selfHarm.ideation).toBe("unclear");
  });
  it.each(["Today is my late husband's birthday, I cooked his favourite dish.", "I want to go and be with my daughter in Perth for Christmas", "I'm going to visit my mother's grave on Sunday"])(
    "%s: none, no cue",
    (t) => {
      expect(raised(frame(t))).toBe(false);
      expect(selfHarmCue(t)).toBe(false);
    },
  );
});

describe("stockpiling (means yes) and refills (means no)", () => {
  it.each(["我把药都存起来了，一直没有吃。", "My father told me he has been hiding his sleeping pills instead of taking them.", "我啲藥收埋晒，一直冇食"])("%s: means yes", (t) => {
    expect(frame(t).selfHarm.means).toBe("yes");
  });
  it.each([
    "I counted my pills, there are ten left. When should I get a refill?",
    "我数了一下药，还剩一个礼拜的，要去拿药了。",
    "I'm going overseas for two weeks, will I have enough medicine?",
    "Do I have enough tablets to last until my next appointment?",
  ])("%s: means no", (t) => {
    expect(frame(t).selfHarm.means).toBe("no");
    expect(raised(frame(t))).toBe(false);
  });
});

describe("lethality (yes, or unclear with an amount)", () => {
  it.each(["降压药一次吃多少会出人命？", "Kalau makan banyak ubat darah tinggi sekali gus, boleh mati tak?", "What's the most losartan someone can take before it becomes dangerous?"])(
    "%s: yes",
    (t) => expect(frame(t).selfHarm.lethalityQuestion).toBe("yes"),
  );
  it.each(["这个药最多能吃多少？吃太多会怎么样？", "What happens if someone takes too many of these?"])("%s: unclear at least", (t) => {
    expect(["yes", "unclear"]).toContain(frame(t).selfHarm.lethalityQuestion);
  });
});

describe("typos and spacing", () => {
  it.each(["dont want to liv anymor", "想 自 杀", "我 不 想 活 了", "i wan go die lor", "எனக்கு வாழ விருப்பமில்லை."])("%s: the self-harm rules, ideation active", (t) => {
    expect(route(t)).toContain("self_harm");
    expect(frame(t).selfHarm.ideation).toBe("active");
  });
});

describe("danger said outright: plan and soon yes", () => {
  it.each([
    "I'm going to end it tonight. I've made up my mind.",
    "I have everything ready and I'm going to do it today. Goodbye.",
    "我今晚就要了结自己，已经准备好了。",
    "我已经决定今天晚上结束自己的生命。",
    "Tonight I going to end everything already, dun try to stop me",
  ])("%s", (t) => {
    const f = frame(t);
    expect(f.selfHarm).toMatchObject({ plan: "yes", soon: "yes" });
    expect(f.selfHarm.ideation).not.toBe("none");
    expect(route(t)).toContain("self_harm");
  });
  it("everything ready with the pills: means yes too", () => {
    expect(frame("I have everything ready and I'm going to do it today. Goodbye.").selfHarm.means).toBe("yes");
  });
});

describe("emergencies happening now", () => {
  it.each([
    ["我而家心口好痛，好似有嘢壓住，出晒冷汗。", "chest"],
    ["Dada saya sakit sangat sekarang, macam kena tekan.", "chest"],
    ["My wife is gasping for air and can't finish a sentence.", "breathing"],
    ["我爸爸呼吸很急，一句话都说不完整。", "breathing"],
    ["Sitting down also cannot catch my breath, very scary", "breathing"],
    ["血压两百多，胸口也在痛。", "chest"],
  ])("%s: %s, severe (the red flag)", (t, kind) => {
    const s = sym(frame(t), kind);
    expect(s?.severe).toBe("yes");
    expect(s?.now).not.toBe("no");
  });
  it.each(["BP 200 over 120 just now, my vision is blurry and I feel like vomiting.", "刚量血压 210/120，头痛得要裂开，还看不清东西。"])(
    "%s: the rules' high_bp_symptom",
    (t) => expect(signals(t)).toContain("high_bp_symptom"),
  );
  it("a chest pain beside a reading between 180 and 200 stays the owner's 10-14 decision (kept for his doctor); in the 200s it is severe", () => {
    expect(signals("今天 185/112，胸口很痛")).not.toContain("high_bp_symptom");
    expect(sym(frame("今天 185/112，胸口很痛"), "chest")?.severe).not.toBe("yes");
    expect(sym(frame("血压两百多，胸口也在痛。"), "chest")?.severe).toBe("yes");
  });
  it.each(["我老婆刚才吃了很多降压药，现在叫她反应很慢。", "我刚才糊里糊涂把药吃了好几次，现在心跳很慢，头很晕。"])("%s: an overdose with a change in how they are", (t) => {
    expect(signals(t)).toContain("overdose");
    const f = frame(t);
    expect(f.amount.relation).not.toBe("none");
    expect(f.symptoms.length).toBeGreaterThan(0);
  });
  it.each([
    "I found my grandson with my pill box open, I think he ate some.",
    "My grandson eat my BP pill just now, he only 4 years old",
    "Cucu saya telan ubat darah tinggi saya tadi, dia baru tiga tahun.",
  ])("%s: a child, an event", (t) => {
    expect(signals(t)).toContain("child");
    const f = frame(t);
    expect(f.about).toBe("child");
    expect(f.acts).toContain("event");
  });
  it("collapse: 倒在地上，怎么叫都不醒", () => {
    expect(signals("我爸爸倒在地上，怎么叫都不醒。")).toContain("collapse");
    expect(sym(frame("我爸爸倒在地上，怎么叫都不醒。"), "consciousness")).toBeTruthy();
  });
  it("allergy in Cantonese: 塊面腫晒、喉嚨好緊", () => {
    expect(signals("食完新藥之後塊面腫晒，喉嚨好緊。")).toContain("allergy");
  });
  it.each([
    "This morning my left hand went numb and my speech was funny for ten minutes, but it's fine now.",
    "刚才半边脸麻了几分钟，现在好了。",
    "An hour ago I couldn't find my words for a while, now I'm okay.",
    "啱先半邊面麻咗幾分鐘，而家冇事喇。",
  ])("%s: a stroke sign that passed (now no)", (t) => {
    expect(signals(t)).toContain("stroke");
    expect(sym(frame(t), "stroke")?.now).toBe("no");
  });
  it("a past breathless night that got better is not now, and not severe by its own words", () => {
    const s = sym(frame("昨晚睡觉的时候喘不过气，醒来就好了。"), "breathing");
    expect(s?.now).toBe("no");
    expect(s?.severe).not.toBe("yes");
  });
  it("past and over in more words: no more, ok already, dah okay, 而家冇事", () => {
    for (const t of ["I had some chest tightness climbing the stairs yesterday, now no more.", "Yesterday chest pain a while only, then ok already", "Semalam dada saya sakit sekejap, sekarang dah okay."]) {
      expect(sym(frame(t), "chest")?.now).toBe("no");
    }
    expect(sym(frame("My chest pain is not better now"), "chest")?.now).toBe("yes");
  });
});

describe("medicine facts", () => {
  it("a different shape, the medicine named: looksDifferent yes", () => {
    expect(frame("The new box of amlodipine has a different shape from before.").looksDifferent).toBe("yes");
  });
  it.each([
    ["Since I started the new pill I've had a dry cough.", "other"],
    ["换药以后晚上睡不好。", "other"],
    ["புதிய மருந்து சாப்பிட ஆரம்பித்ததிலிருந்து தலை சுற்றுகிறது.", "dizziness"],
  ])("%s: a %s symptom now, a medicine of his", (t, kind) => {
    const f = frame(t);
    expect(sym(f, kind)?.now).toBe("yes");
  });
  it("Malay: dah berhenti makan ubat: stopped", () => {
    expect(frame("Saya dah berhenti makan ubat darah tinggi minggu lepas.").stopOrChange).toBe("done");
  });
  it.each(["我今朝唔小心食多咗一粒血壓藥。", "我今天早上不小心多吃了一粒降压药。"])("%s: one extra, an event, which BP medicine unspecified", (t) => {
    const f = frame(t);
    expect(f.amount.relation).toBe("extra_one");
    expect(f.acts).toContain("event");
    // two BP medicines on his list and 降压药 / 血壓藥 names neither: unspecified, never both (both read as "several medicines": 995)
    expect(f.medicines.map((m) => m.ref)).toEqual(["unspecified"]);
  });
  it("a plural class word is all of them", () => {
    expect(frame("Can I take Panadol with my BP pills?").medicines.map((m) => m.ref)).toEqual(expect.arrayContaining(["m-aml", "m-los"]));
  });
  it("Singlish 'eat two extra': extra_more", () => {
    expect(frame("Just now I eat two extra BP pill by accident").amount.relation).toBe("extra_more");
  });
});

describe("over-escalation removed", () => {
  it.each(["这个电视剧无聊死了。", "Wah today so hot, die liao", "今日攰到死。", "熱到死，唔想出街。", "等车等到死", "I'm bored to death at home"])("%s: no cue, nothing raised", (t) => {
    expect(selfHarmCue(t)).toBe(false);
    expect(crisisCue(t)).toBe(false);
    expect(raised(frame(t))).toBe(false);
  });
  it.each(["I want to die liao", "我想死", "我真係想死"])("%s: still the self-harm cue", (t) => expect(selfHarmCue(t)).toBe(true));
  it.each([
    "What are the signs of a stroke I should watch out for?",
    "血压高会不会中风？",
    "中风之前会有什么征兆？",
    "Can amlodipine prevent a heart attack?",
    "My father died of a stroke when I was young, so I worry about my BP.",
    "我老豆好多年前中風走咗，所以我好緊張個血壓。",
    "I had a heart attack in 2015 and they put in a stent.",
    "Last time I got heart attack, now ok already, doctor say must take medicine",
  ])("%s: no emergency, no symptom now", (t) => {
    expect(route(t)).not.toContain("emergency");
    expect(frame(t).symptoms.filter((s) => s.now !== "no")).toEqual([]);
  });
  it.each(["I think I'm having a stroke", "Help, my husband is having a heart attack", "我是不是中风了？", "Suddenly I think it's a stroke, my face is drooping"])(
    "%s: still an emergency",
    (t) => expect(route(t)).toContain("emergency"),
  );
});

/** Round 3 (10-16, E2's report on round 2), by family. */
describe("round 3: breathlessness that is mild, exertional or passed is a symptom asked about, not the 995 route", () => {
  it.each([
    "I feel a bit short of breath.",
    "我有点喘。",
    "A bit breathless climbing stairs these days",
    "Last night I woke up breathless, but I'm okay this morning.",
    "昨晚睡觉的时候喘不过气，醒来就好了。",
  ])("%s: no emergency route, a breathing symptom in the frame, not severe", (t) => {
    expect(route(t)).not.toContain("emergency");
    const s = sym(frame(t), "breathing");
    expect(s).toBeTruthy();
    expect(s?.severe).not.toBe("yes");
  });
  it.each([
    "Sitting down also cannot catch my breath, very scary",
    "My wife is gasping for air and can't finish a sentence.",
    "I'm a bit breathless and my lips are turning blue",
    "我有点喘，坐着都喘不过气",
  ])("%s: still the breathing emergency", (t) => {
    expect(signals(t)).toContain("breathing");
    expect(sym(frame(t), "breathing")?.severe).toBe("yes");
  });
  it("passed: now no", () => {
    expect(sym(frame("Last night I woke up breathless, but I'm okay this morning."), "breathing")?.now).toBe("no");
  });
});

describe("round 3: an uncertain repeat dose is an extra dose of unknown amount, not an overdose", () => {
  it.each(["我不记得今天有没有吃过药，好像又吃了一次。", "I don't remember if I took my morning pill, I might have taken it again"])("%s", (t) => {
    expect(signals(t)).not.toContain("overdose");
    const f = frame(t);
    expect(f.amount.relation).toBe("unknown");
    expect(f.acts).toContain("event");
  });
});

describe("round 3: a time alone is soon, never plan", () => {
  it.each(["I want to die tonight", "今天特别想死"])("%s: soon yes, plan unclear", (t) => {
    const f = frame(t);
    expect(f.selfHarm.soon).toBe("yes");
    expect(f.selfHarm.plan).toBe("unclear");
  });
  it("a decision with the time is a plan", () => {
    expect(frame("I've decided, I'm going to end it tonight").selfHarm.plan).toBe("yes");
  });
});

describe("round 3: stopping suggested by something he read, asked about", () => {
  it("My son read online that I should stop amlodipine. Should I?", () => {
    expect(frame("My son read online that I should stop amlodipine. Should I?").stopOrChange).toBe("suggested_by_other");
  });
});

describe("round 3: words not read before", () => {
  it("头晕得站不稳: dizziness, severe", () => {
    expect(sym(frame("换了新药以后心跳很慢，头晕得站不稳。"), "dizziness")?.severe).toBe("yes");
  });
  it("活得好累: distress", () => {
    const f = frame("最近活得好累");
    expect(f.distress).toBe("yes");
    expect(f.selfHarm.ideation).toBe("none");
  });
  it("took more than I should have: an extra amount unknown, an event", () => {
    const f = frame("I took more of my pills than I should have");
    expect(f.amount.relation).toBe("unknown");
    expect(f.acts).toContain("event");
  });
});
