/**
 * Fixed sentences (web-app.md 6.3 "固定的话"). Every text here is written by hand; nothing is assembled from
 * referrals.json rows, so B4-05 and B4-06 numbers can never leak in. The referral rows are only the cited
 * evidence that makes the numbers legal for layer 1.
 *
 * Rules for anyone editing:
 * - The unknown-medicine sentence is fixed by the plan, character for character.
 * - Emergency: 995 only. Self-harm: 995, SOS 1767, SOS CareText 9151 1767, mindline 1771; the Mandarin UI
 *   adds Care Corner 1800-3535-800. Check the numbers on the official sites before launch.
 * - No judgement words (正常, 很好, 危险, normal, dangerous), no 加药/减药, no medication verbs at the start
 *   of a sentence, no time words (night, 晚上) that the cited row does not contain.
 * - zh texts are drafts (status "draft") until a Mandarin reader reviews them.
 */
import { NO_AI_SENTENCE } from "./no-ai";
import type { FollowUpOption, PathwayId } from "./risk/types";
import type { Locale } from "./types";

export const UNKNOWN_MED_SENTENCE = "I'm not able to identify that medication, please check with your pharmacist.";

export interface Template {
  id: string;
  en: string;
  zh: string;
  /** referrals.json row whose contact text makes the numbers legal (crisis templates) */
  referralId?: string;
  speechAct: "referral" | "question" | "logistics" | "restate";
  zhStatus: "draft" | "reviewed";
}

const T = (t: Template) => t;

export const TEMPLATES = {
  unknown_med: T({
    id: "unknown_med",
    en: UNKNOWN_MED_SENTENCE,
    zh: "我认不出这个药，请拿去问药剂师。",
    speechAct: "referral",
    zhStatus: "draft",
  }),
  refer_doctor: T({
    id: "refer_doctor",
    en: "Questions about changing your medicine are for your doctor. I've added this one to the question list for your next visit.",
    // owner 10-14: the sentences without 995 in professional words (就诊, 服药, 加入); the 995 ones are left as they are
    zh: "调整用药的问题请询问医生。我已把这个问题加入下次就诊的问题单。",
    speechAct: "referral",
    zhStatus: "draft",
  }),
  refer_pharmacist: T({
    id: "refer_pharmacist",
    en: "Your doctor's words, your label and the leaflet don't answer this, so please ask your pharmacist. I've added it to the question list.",
    zh: "医生的话、药袋和单张都没有回答这个问题，请询问药剂师。我已把它加入问题单。",
    speechAct: "referral",
    zhStatus: "draft",
  }),
  refuse_injection: T({
    id: "refuse_injection",
    en: "I can only repeat what your doctor, your medicine label or the leaflet said. I can't give doses or recommend medicines. I've added this to the question list for your doctor.",
    zh: "我只能转述医生、药袋和单张说过的话，不能给剂量，也不能推荐药物。我已把这个问题加入给医生的问题单。",
    speechAct: "referral",
    zhStatus: "draft",
  }),
  uncertain_no_source: T({
    id: "uncertain_no_source",
    en: "Your doctor's words, your label and the leaflet don't give a clear answer to this, so I won't guess. I've added it to the question list.",
    zh: "医生的话、药袋和单张里都没有清楚的答案，我不猜测。我已把它加入问题单。",
    speechAct: "referral",
    zhStatus: "draft",
  }),
  uncertain_conflict: T({
    id: "uncertain_conflict",
    en: "These sources don't say the same thing, so I won't pick one. I've added it to the question list for your pharmacist.",
    zh: "这几个来源说的不一样，我不替你选。我已把它加入给药剂师的问题单。",
    speechAct: "referral",
    zhStatus: "draft",
  }),
  emergency_995: T({
    id: "emergency_995",
    en: "Call 995 now for an ambulance, even if you are not sure.",
    zh: "现在就打 995 叫救护车，不确定也要打。",
    referralId: "B1-01",
    speechAct: "referral",
    zhStatus: "draft",
  }),
  emergency_overdose: T({
    id: "emergency_overdose",
    en: "If you took more of a medicine than your label says, get medical help straight away: call 995 or go to the nearest A&E.",
    zh: "如果药吃得比药袋上写的多，要马上求医：打 995，或者去最近的急诊。",
    referralId: "B1-12",
    speechAct: "referral",
    zhStatus: "draft",
  }),
  // fix round 3 (10-10): an overdose family report about another adult ("My wife took 10 of her BP pills just now",
  // 「我老婆刚才一下子吃了十粒降压药」) is about them, not "you"; a child who swallowed tablets keeps "Call 995 now" (B1-12)
  emergency_overdose_other: T({
    id: "emergency_overdose_other",
    en: "If they took more of a medicine than the label says, get them medical help straight away: call 995 or take them to the nearest A&E.",
    zh: "如果对方吃的药比药袋上写的多，要马上帮对方求医：打 995，或者送对方去最近的急诊。",
    referralId: "B1-12",
    speechAct: "referral",
    zhStatus: "draft",
  }),
  // 10-14 (the owner's decision): he says he took one extra tablet, or today's dose twice, and names no symptom
  // (classify.ts rule:extra_dose_taken). Not the emergency route: his doctor's words about the dose and his label come
  // first, then this sentence, and his words go on the doctor's list. The owner's wording, both languages
  extra_dose_taken: T({
    id: "extra_dose_taken",
    en: "Taking more than your label says is a question for your pharmacist or doctor: ask today. If you feel very unwell, call 995 or go to the nearest A&E.",
    zh: "多吃了药的事要问药剂师或医生，今天就问。要是很不舒服，打 995，或者去最近的急诊。",
    referralId: "B1-12",
    speechAct: "referral",
    zhStatus: "draft",
  }),
  // 10-14 (the owner's decision: 「胸口痛就必须打 995」 was too absolute): chest pain, a stroke sign (one-sided weakness, slurred
  // speech ...) or a reading above his doctor's own warning line, his own and with no sign that it is happening badly now
  // (classify.ts signalFamily), is recorded for his doctor (SIGNAL_RECORDED below, with the date and time), his doctor's
  // warning line is quoted when his visits gave one, and then one of these: 995 when it gets bad, in words that fit the
  // kind of sign. Each cites the B1 row of its kind for the 995. Drawn as Ripple's line with the 打 995 button
  // (components/daily/answer-parts.ts), as extra_dose_taken is
  signal_995_chest: T({
    id: "signal_995_chest",
    en: "If the pain is bad or does not go away, or you break into a cold sweat or cannot catch your breath, call 995 straight away or go to the nearest A&E.",
    zh: "要是痛得厉害、一直不好、出冷汗或喘不上气，请马上打 995，或者去最近的急诊。",
    referralId: "B1-01",
    speechAct: "referral",
    zhStatus: "draft",
  }),
  signal_995_stroke: T({
    id: "signal_995_stroke",
    // a sign of a stroke is never "wait and see": row B1-03 says 995 even when the signs pass (TIA). Kept for the doctor
    // as the other signals are, but this line is not conditional (owner 10-14: "a solution that cannot go wrong")
    en: "Weakness on one side, a drooping face or slurred speech: call 995 now, even if it has passed.",
    zh: "一边身体没力、脸歪或说话不清，就算已经好了，也请马上打 995。",
    referralId: "B1-03",
    speechAct: "referral",
    zhStatus: "draft",
  }),
  // (a reading above the doctor's warning line and no other sign: here, on the blood pressure page and in an answer)
  signal_995_unwell: T({
    id: "signal_995_unwell",
    en: "If you feel very unwell, call 995 straight away or go to the nearest A&E.",
    zh: "要是很不舒服，请马上打 995，或者去最近的急诊。",
    referralId: "B1-01",
    speechAct: "referral",
    zhStatus: "draft",
  }),
  self_harm_995: T({
    id: "self_harm_995",
    en: "If you might hurt yourself or you are in danger now, call 995 or go to the nearest A&E.",
    zh: "如果你觉得可能会伤害自己，或者现在就不安全，请打 995，或者去最近的急诊。",
    referralId: "B4-01",
    speechAct: "referral",
    zhStatus: "draft",
  }),
  // wave B (10-09): a crisis reported about someone else ("My dad just told me he doesn't want to live anymore")
  self_harm_995_other: T({
    id: "self_harm_995_other",
    en: "If they might hurt themselves or they are in danger now, call 995 or go to the nearest A&E.",
    zh: "如果对方可能会伤害自己，或者现在就不安全，请打 995，或者去最近的急诊。",
    referralId: "B4-01",
    speechAct: "referral",
    zhStatus: "draft",
  }),
  self_harm_sos: T({
    id: "self_harm_sos",
    en: "You can talk to someone any time: call SOS at 1767 (24 hours), or text SOS CareText on WhatsApp at 9151 1767.",
    zh: "随时可以找人说话：打 SOS 1767（24 小时），或者用 WhatsApp 发文字给 SOS CareText 9151 1767（只收英文文字）。",
    referralId: "B4-02",
    speechAct: "referral",
    zhStatus: "draft",
  }),
  self_harm_mindline: T({
    id: "self_harm_mindline",
    en: "You can also call national mindline 1771, round the clock.",
    zh: "也可以打全国心理热线 mindline 1771，全天都有人接。",
    referralId: "B4-03",
    speechAct: "referral",
    zhStatus: "draft",
  }),
  self_harm_care_corner: T({
    id: "self_harm_care_corner",
    en: "In Mandarin: Care Corner counselling hotline 1800-3535-800, 10 am to 10 pm daily, closed on public holidays.",
    zh: "华语辅导热线：Care Corner 1800-3535-800，每天 10am 到 10pm，公共假期休息。",
    referralId: "B4-04",
    speechAct: "referral",
    zhStatus: "draft",
  }),
  noted: T({ id: "noted", en: "Noted.", zh: "已记录。", speechAct: "logistics", zhStatus: "draft" }),
  // wave B (10-09): added to an answer whose words come near a crisis (classify.ts crisisCue), so a crisis the rules did
  // not recognise still shows 995. 10-14 (the owner's decision): no longer under a plain note just because no crisis screen
  // looked at it; a note gets it only when its own words carry one of those cue words (pipeline.ts)
  safety_line: T({
    id: "safety_line",
    en: "If you suddenly feel very unwell, or you might hurt yourself, call 995 or go to the nearest A&E.",
    zh: "如果突然很不舒服，或者觉得可能会伤害自己，请打 995，或者去最近的急诊。",
    referralId: "B4-01",
    speechAct: "referral",
    zhStatus: "draft",
  }),
  check_in_dose: T({
    id: "check_in_dose",
    en: "Have you taken today's tablet?",
    zh: "今天的药服用了吗？",
    speechAct: "question",
    zhStatus: "draft",
  }),
  grant_recordings_off: T({
    id: "grant_recordings_off",
    en: "Sharing of visit recordings is off. Only Mr Tan can turn it on.",
    zh: "就诊录音的分享目前已关闭，只有陈先生本人能打开。",
    speechAct: "logistics",
    zhStatus: "draft",
  }),
  grant_recordings_on: T({
    id: "grant_recordings_on",
    en: "Mr Tan has turned on sharing of visit recordings. They are under Visits.",
    zh: "陈先生已打开就诊录音的分享，可在「就诊」中查看。",
    speechAct: "logistics",
    zhStatus: "draft",
  }),
  // C2 track S (round 2; real-app 3.10, 6.16): the same two answers on an account, said to him, with no name in them.
  // Who can see the recordings is his own record (pipeline.ts log:family: each link's relation and the name he gave),
  // shown under the second one.
  grant_recordings_off_self: T({
    id: "grant_recordings_off_self",
    en: "Your visit recordings are not shared with family right now. Only you can turn that on, under Me, in What my family can see.",
    zh: "就诊录音目前没有分享给家人。只有你本人能打开，在「我」里的「家人能看到什么」。",
    speechAct: "logistics",
    zhStatus: "draft",
  }),
  grant_recordings_on_self: T({
    id: "grant_recordings_on_self",
    en: "You have turned on sharing of your visit recordings.",
    zh: "你已打开就诊录音的分享。",
    speechAct: "logistics",
    zhStatus: "draft",
  }),
  refill: T({
    id: "refill",
    en: "When your medicine is running low, contact the clinic that gave it to you.",
    zh: "药物快用完时，可以联系给你配药的诊所。",
    speechAct: "logistics",
    zhStatus: "draft",
  }),
  no_record: T({
    id: "no_record",
    en: "I don't have that in your records yet.",
    zh: "你的记录里还没有这一项。",
    speechAct: "logistics",
    zhStatus: "draft",
  }),
  // C2 track S (architecture review: 再问一遍医生已经回答过的问题 → 直接给医生的回答，不再新建问题): after the doctor's or the
  // pharmacist's own recorded answer, instead of "I've added it to the question list"
  answered_before_doctor: T({
    id: "answered_before_doctor",
    en: "This is what your doctor said about this at your visit. If it is still not clear, you can add it to the question list for your next visit.",
    zh: "这是医生就诊时对这件事说的话。如果仍不清楚，可以把它加入下次就诊的问题单。",
    speechAct: "referral",
    zhStatus: "draft",
  }),
  answered_before_pharmacist: T({
    id: "answered_before_pharmacist",
    en: "This is what your pharmacist said about this. If it is still not clear, you can add it to the question list.",
    zh: "这是药剂师对这件事说的话。如果仍不清楚，可以把它加入问题单。",
    speechAct: "referral",
    zhStatus: "draft",
  }),
  // C2 track S (real-app 12: 回答里已经有医生直接回答过的原话时，不再接「没有回答」的转介模板): the clinician's own answer to
  // this question is in the answer, so instead of "nothing answers this" (the question is still added for the next visit)
  said_and_added_doctor: T({
    id: "said_and_added_doctor",
    en: "These are your doctor's own words from your visit. I've also put this question on the list for your next visit, so you can ask again.",
    zh: "这是医生就诊时的原话。我也把这个问题加入了下次就诊的问题单，你可以再次询问。",
    speechAct: "referral",
    zhStatus: "draft",
  }),
  said_and_added_pharmacist: T({
    id: "said_and_added_pharmacist",
    en: "These are the pharmacist's own words. I've also put this question on the list, so you can ask again.",
    zh: "这是药剂师的原话。我也把这个问题加入了问题单，你可以再次询问。",
    speechAct: "referral",
    zhStatus: "draft",
  }),
  // C2 track S (real-app 12: 问副作用时，医生说过的对应原话也进候选，并加进问题单): a side effect he describes goes on the
  // doctor's list, after what the doctor and the leaflet said about it
  side_effect_noted: T({
    id: "side_effect_noted",
    en: "I've added this to the question list for your next visit, so your doctor hears about it.",
    zh: "我已把这件事加入下次就诊的问题单，以便告知医生。",
    speechAct: "referral",
    zhStatus: "draft",
  }),
  // C2 track S (journey 13, routed from track K): what to eat or drink with a long-term condition (kidney disease,
  // diabetes, heart failure, pregnancy ...; special-diet.ts): the doctor's or a dietitian's, and on his doctor's list
  refer_diet: T({
    id: "refer_diet",
    en: "This one is for your doctor or a dietitian. I've added it to the question list for your next visit.",
    zh: "这个问题请询问医生或营养师。我已把这个问题加入下次就诊的问题单。",
    speechAct: "referral",
    zhStatus: "draft",
  }),
  // C2 track S (routed from track K's chat): chit-chat Ripple has nothing for (the weather, the lottery, the news, a match,
  // a joke; route cant_help): no model call, no question; the 问一句 screen offers 「记下来」 under it
  cant_help: T({
    id: "cant_help",
    en: "I can't help with this one. Shall I write it down?",
    zh: "这件事我帮不上忙，需要记录下来吗？",
    speechAct: "question",
    zhStatus: "draft",
  }),
  // 10-14 (the coordinator's wording, both languages): a question about Ripple itself, what it is, what it is for, what it
  // can do, who it is (classify.ts rule:about_ripple, route logistics): no model call, no question on any list. Owner 10-15:
  // Ripple now answers everyday health questions in its own words (general.ts), so the sentence says so, and what it never does
  about_ripple: T({
    id: "about_ripple",
    en: "I'm Ripple. I keep your doctor's own words from your visits, show you what your medicine labels and leaflets say, answer everyday health questions in plain words, and write down the questions to ask your doctor or pharmacist. I never change your medicines, and I don't replace your doctor.",
    zh: "我是 Ripple：我帮你记下就诊时医生说的原话，把药品标签和单张上写的告诉你，用平常话回答一般的健康问题，也帮你记下要问医生或药剂师的问题。我不会替你改药，也不能代替医生。",
    speechAct: "logistics",
    zhStatus: "draft",
  }),
  // C2 track S (real-app 2.10): no consent to AI processing, and the rules found nothing to relay. The first sentence is
  // the design's own, the one the ask screen says too (no-ai.ts NO_AI_SENTENCE); then where his question went
  no_ai_consent: T({
    id: "no_ai_consent",
    en: `${NO_AI_SENTENCE.en} I've added it to the question list.`,
    zh: `${NO_AI_SENTENCE.zh}我已把它加入问题单。`,
    speechAct: "referral",
    zhStatus: "draft",
  }),

  // ---- the guided harness (2026-10-16; lib/safety/risk, kb/pathways.json). Each line is shown when a decision-table row
  // names it in `show`. Written for an older reader: short, one idea per sentence, no medical words. Every row that shows
  // one of these is "pending_clinician" until a pharmacist or doctor signs it (kb/pathways.json).

  // breathing trouble that may be happening now, shown above the follow-up question (995 before any question). B1-02
  // (SCDF: breathlessness, lips turning blue or grey) makes the 995 legal
  signal_995_breathing: T({
    id: "signal_995_breathing",
    en: "If you cannot catch your breath even when resting, or your lips or face turn blue or grey, call 995 straight away or go to the nearest A&E.",
    zh: "要是坐着休息也喘不上气，或者嘴唇、脸色发紫发灰，请马上打 995，或者去最近的急诊。",
    referralId: "B1-02",
    speechAct: "referral",
    zhStatus: "draft",
  }),
  // a medicine that looks different from before (level 2). The words follow ISMP's advice to consumers (check with the
  // pharmacist before taking it: consumermedsafety.org "Top 10 reasons to suspect a pharmacy error"); referrals.json B3-05 is
  // the pharmacist row. Never "stop taking it" as Ripple's own instruction
  looks_different_pharmacist: T({
    id: "looks_different_pharmacist",
    en: "Please check with your pharmacist before you take them.",
    zh: "吃之前，请先问一下药剂师。",
    speechAct: "referral",
    zhStatus: "draft",
  }),
  added_for_pharmacist: T({
    id: "added_for_pharmacist",
    en: "I've added this to your questions for the pharmacist.",
    zh: "我已把这件事加入给药剂师的问题单。",
    speechAct: "referral",
    zhStatus: "draft",
  }),
  // a possible side effect with no red flag (level 3): the safety net under his doctor's words and the leaflet's line. B1-05
  // (a severe allergic reaction: swelling of the face, lips or throat, trouble breathing) makes the 995 legal
  side_effect_995: T({
    id: "side_effect_995",
    en: "If you faint, cannot catch your breath, get chest pain, or your face, lips or throat swell, call 995 straight away or go to the nearest A&E.",
    zh: "要是晕倒、喘不上气、胸口痛，或者脸、嘴唇、喉咙肿起来，请马上打 995，或者去最近的急诊。",
    referralId: "B1-05",
    speechAct: "referral",
    zhStatus: "draft",
  }),
  // he has already stopped a blood pressure medicine (or one nobody can tell) for days (level 2, pending a clinician: decided
  // on the careful side). referrals.json B3-02 (stopping a medicine: doctor or pharmacist first); signal_995_unwell follows it
  stopped_ask_today: T({
    id: "stopped_ask_today",
    en: "Since you have already stopped it, please ask your doctor today.",
    zh: "药已经停了的话，请今天就问医生。",
    speechAct: "referral",
    zhStatus: "draft",
  }),
  // he fainted or passed out and has come round (level 2, pending a clinician: round 2, 10-16). referrals.json B2-07 (felt
  // faint, or fainted and came round: checked by a doctor soon to find out why); signal_995_unwell follows it
  fainted_see_doctor: T({
    id: "fainted_see_doctor",
    en: "Since you fainted, please get checked by a doctor today to find out why, even if you feel fine now.",
    zh: "晕倒过的话，就算现在觉得没事，也请今天去看医生，查一查原因。",
    referralId: "B2-07",
    speechAct: "referral",
    zhStatus: "draft",
  }),
  // the self-harm ladder (the research report: Judd et al.'s clinical baseline: name the risk, ask directly, give concrete
  // resources, encourage contact with the people close to him, keep inviting him to talk). The helpline lines above stay as
  // they are; these come after them
  self_harm_here: T({
    id: "self_harm_here",
    en: "I'm here. You can keep telling me how you feel.",
    zh: "我在这里，你可以继续跟我说说你的感受。",
    speechAct: "logistics",
    zhStatus: "draft",
  }),
  // only when his family is told (lib/care/told.ts: an account with at least one active care link; the pipeline checks)
  self_harm_family_told: T({
    id: "self_harm_family_told",
    en: "I've let your family know, so they can check on you.",
    zh: "我已经告诉了你的家人，让他们来看看你。",
    speechAct: "logistics",
    zhStatus: "draft",
  }),
  self_harm_doctor: T({
    id: "self_harm_doctor",
    en: "You can also tell your doctor how you have been feeling.",
    zh: "你也可以把最近的感受告诉医生。",
    speechAct: "logistics",
    zhStatus: "draft",
  }),
  // immediate danger on the ladder (thoughts with a plan, the means and within a day, or he says so): 995 first, without a
  // condition. B1-15 (a person at immediate risk of harming themselves: 995 or the nearest A&E)
  self_harm_danger_995: T({
    id: "self_harm_danger_995",
    en: "Please call 995 now, or go to the nearest A&E.",
    zh: "请现在就打 995，或者去最近的急诊。",
    referralId: "B1-15",
    speechAct: "referral",
    zhStatus: "draft",
  }),
} as const satisfies Record<string, Template>;

export type TemplateId = keyof typeof TEMPLATES;

export const ALL_TEMPLATES: Template[] = Object.values(TEMPLATES);

/** The conditional 995 sentence for each kind of sign recorded for his doctor (classify.ts SignalFamily). */
export const SIGNAL_995: Record<"chest" | "stroke" | "reading", TemplateId> = {
  chest: "signal_995_chest",
  stroke: "signal_995_stroke",
  reading: "signal_995_unwell",
};

/**
 * 10-14 (the owner's decision): said first when his words are kept for his doctor (a sign of SIGNAL_995's kinds), with the
 * date and time they were kept, his own clock (lib/daily/signals.ts signalMoment). A sentence with a date and a time cannot
 * be one of TEMPLATES (a template's words are fixed: verify.ts compares them character for character, and every number
 * in a template must be in the row it cites), so this one is not: the pipeline fills it and shows it as a line of his
 * own record (a "log" source whose words are exactly these, pipeline.ts), and it passes the same three checks.
 * `templateId` on that sentence is this id, so the screen draws it as Ripple's own line.
 */
export const SIGNAL_RECORDED = {
  id: "signal_recorded",
  en: "I've noted what you told me ({when}). It goes on the list of things to tell your doctor next time.",
  zh: "你说的已记下（{when}），会放进下次要告诉医生的情况里。",
} as const;

/** SIGNAL_RECORDED in one language, with its date and time ("14 Oct, 4:20 pm" / 「10月14日 16:20」). */
export function signalRecordedText(locale: Locale, when: string): string {
  return (locale === "zh-Hans" ? SIGNAL_RECORDED.zh : SIGNAL_RECORDED.en).replace("{when}", when);
}

export function templateText(id: TemplateId, locale: Locale): string {
  return locale === "zh-Hans" ? TEMPLATES[id].zh : TEMPLATES[id].en;
}

/**
 * Self-harm template ids for a UI language (Care Corner only in the Mandarin UI). `aboutSomeoneElse`: family reporting
 * someone else's crisis gets "if they might hurt themselves" first; the helplines are the same.
 */
export function selfHarmTemplateIds(locale: Locale, aboutSomeoneElse = false): TemplateId[] {
  const ids: TemplateId[] = [aboutSomeoneElse ? "self_harm_995_other" : "self_harm_995", "self_harm_sos", "self_harm_mindline"];
  if (locale === "zh-Hans") ids.push("self_harm_care_corner");
  return ids;
}

/**
 * The guided harness's follow-up questions (2026-10-16; lib/safety/risk/types.ts FollowUp, kb/pathways.json `ask`). Each is
 * one fixed question with its buttons, in both languages, written for an older reader: short, plain, one idea per line, no
 * medical words. Rules for anyone editing:
 * - the option ids are stable (the reply names them, the decision table maps them to facts in risk/pathways.ts); change
 *   the words, never the ids;
 * - every option list ends with "Not sure" / 「不确定」, or for the self-harm questions "I'd rather not say" / 「不想说」, and
 *   that answer counts as the more dangerous side (risk/pathways.ts applyReply);
 * - at most five buttons (the contract: two to five), so a list of signs is grouped two to a button where the task named
 *   more ("Chest pain, or short of breath");
 * - an option's words come back as his words in the conversation (the reply's `text`): no amount, no dose, no medicine
 *   advice in them;
 * - a question whose buttons are his medicines (`medicines`) gets one button per medicine of his on the day, by name,
 *   before "Not sure" (risk/pathways.ts buildFollowUp).
 * The questions are not Sentences: they never go through the three checks (they say nothing about a medicine), and the
 * screen draws them under the answer's lines, below 995 and the helplines.
 */
export interface FollowUpTemplate {
  id: string;
  pathway: PathwayId;
  en: string;
  zh: string;
  /** the fixed buttons (for a medicines question: the ones after his medicines) */
  options: FollowUpOption[];
  /** more than one may be chosen (a short list of signs, or of medicines) */
  multi?: boolean;
  /** the buttons are his medicines, then `options` */
  medicines?: boolean;
  zhStatus: "draft" | "reviewed";
}

const NOT_SURE: FollowUpOption = { id: "unsure", en: "Not sure", zh: "不确定", tone: "neutral" };
const RATHER_NOT: FollowUpOption = { id: "rather_not", en: "I'd rather not say", zh: "不想说", tone: "neutral" };
const NONE_OF_THESE: FollowUpOption = { id: "none", en: "None of these", zh: "都没有", tone: "calm" };
const F = (f: FollowUpTemplate) => f;

export const FOLLOW_UPS = {
  // ---- chest pain or pressure (red flags first: is it still there, how long, what comes with it)
  chest_now: F({
    id: "chest_now",
    pathway: "chest",
    en: "Is the chest pain or pressure still there now?",
    zh: "胸口现在还痛或者还闷吗？",
    options: [{ id: "yes", en: "Yes", zh: "还在", tone: "danger" }, { id: "gone", en: "No, it's gone", zh: "没有了，已经好了", tone: "calm" }, NOT_SURE],
    zhStatus: "draft",
  }),
  chest_long: F({
    id: "chest_long",
    pathway: "chest",
    en: "How long has it lasted so far?",
    zh: "到现在有多久了？",
    options: [
      { id: "under5", en: "Under 5 minutes", zh: "不到 5 分钟", tone: "calm" },
      { id: "over5", en: "5 minutes or more", zh: "5 分钟或更久", tone: "danger" },
      { id: "comes_goes", en: "It comes and goes", zh: "一阵一阵的", tone: "danger" },
      NOT_SURE,
    ],
    zhStatus: "draft",
  }),
  chest_with: F({
    id: "chest_with",
    pathway: "chest",
    en: "Do you have any of these with it?",
    zh: "同时有没有下面这些情况？",
    options: [
      { id: "sweat", en: "Sweating", zh: "出冷汗", tone: "danger" },
      { id: "breathless", en: "Short of breath", zh: "喘不上气", tone: "danger" },
      { id: "spreading", en: "Pain spreading to arm, jaw or back", zh: "痛到手臂、下巴或背", tone: "danger" },
      NONE_OF_THESE,
      NOT_SURE,
    ],
    multi: true,
    zhStatus: "draft",
  }),
  // ---- breathing trouble
  breathing_rest: F({
    id: "breathing_rest",
    pathway: "breathing",
    en: "Are you short of breath right now, even while resting?",
    zh: "现在坐着休息也喘不上气吗？",
    options: [{ id: "yes", en: "Yes", zh: "是", tone: "danger" }, { id: "no", en: "No", zh: "不是", tone: "calm" }, NOT_SURE],
    zhStatus: "draft",
  }),
  breathing_blue: F({
    id: "breathing_blue",
    pathway: "breathing",
    en: "Are your lips or face turning blue or grey?",
    zh: "嘴唇或脸色有没有发紫、发灰？",
    options: [{ id: "yes", en: "Yes", zh: "有", tone: "danger" }, { id: "no", en: "No", zh: "没有", tone: "calm" }, NOT_SURE],
    zhStatus: "draft",
  }),
  // ---- a reading above his doctor's line: a sign with it?
  reading_redflags: F({
    id: "reading_redflags",
    pathway: "reading_high",
    en: "With this reading, do you have any of these now?",
    zh: "量到这个血压，现在有没有下面这些情况？",
    options: [
      { id: "headache_vision", en: "Worst headache ever, or blurred vision", zh: "从没这么痛过的头痛，或看不清楚", tone: "danger" },
      { id: "chest_breath", en: "Chest pain, or short of breath", zh: "胸口痛，或喘不上气", tone: "danger" },
      { id: "weak_confused", en: "Weak on one side, or confused", zh: "一边身体没力，或糊涂", tone: "danger" },
      NONE_OF_THESE,
      NOT_SURE,
    ],
    multi: true,
    zhStatus: "draft",
  }),
  // ---- more of a medicine than the label (webPOISONCONTROL's order: who, a sign now, how much, which ones)
  extra_who: F({
    id: "extra_who",
    pathway: "extra_dose",
    en: "Who took the extra medicine?",
    zh: "多吃药的是谁？",
    options: [
      { id: "me", en: "Me", zh: "我自己", tone: "neutral" },
      { id: "child", en: "A child", zh: "小孩", tone: "danger" },
      { id: "other", en: "Someone else", zh: "别人", tone: "neutral" },
      NOT_SURE,
    ],
    zhStatus: "draft",
  }),
  extra_symptoms: F({
    id: "extra_symptoms",
    pathway: "extra_dose",
    en: "Do you have any of these now?",
    zh: "现在有没有下面这些情况？",
    options: [
      { id: "dizzy_faint", en: "Very dizzy, or about to faint", zh: "很晕，或快要晕倒", tone: "danger" },
      { id: "heart_chest", en: "Very slow heartbeat, or chest pain", zh: "心跳很慢，或胸口痛", tone: "danger" },
      { id: "vomit_sleepy", en: "Vomiting, or unusually sleepy", zh: "呕吐，或特别想睡", tone: "danger" },
      NONE_OF_THESE,
      NOT_SURE,
    ],
    multi: true,
    zhStatus: "draft",
  }),
  extra_amount: F({
    id: "extra_amount",
    pathway: "extra_dose",
    en: "How many extra were taken?",
    zh: "多吃了几粒？",
    options: [{ id: "one", en: "One", zh: "一粒", tone: "neutral" }, { id: "more", en: "Two or more", zh: "两粒或更多", tone: "danger" }, NOT_SURE],
    zhStatus: "draft",
  }),
  extra_which: F({
    id: "extra_which",
    pathway: "extra_dose",
    en: "Which medicine was it?",
    zh: "是哪一种药？",
    options: [NOT_SURE],
    multi: true,
    medicines: true,
    zhStatus: "draft",
  }),
  // ---- (round 2, 10-16) taken on purpose? Last, and only when his words do not already say it was a mistake ("by mistake",
  // 不小心): the contract's intent question (webPOISONCONTROL asks it too). "On purpose" or "I'd rather not say" is 995 now
  // and the self-harm ladder's "thoughts"
  extra_purpose: F({
    id: "extra_purpose",
    pathway: "extra_dose",
    en: "Was it by mistake, or did you take them on purpose?",
    zh: "是不小心多吃的，还是故意多吃的？",
    options: [{ id: "mistake", en: "By mistake", zh: "不小心的", tone: "calm" }, { id: "purpose", en: "On purpose", zh: "故意的", tone: "danger" }, RATHER_NOT],
    zhStatus: "draft",
  }),
  // ---- a missed dose: which medicine (then the leaflet's own line for it)
  missed_which: F({
    id: "missed_which",
    pathway: "missed_dose",
    en: "Which medicine did you miss?",
    zh: "漏吃的是哪一种药？",
    options: [NOT_SURE],
    medicines: true,
    zhStatus: "draft",
  }),
  // ---- a medicine that looks different
  looks_which: F({
    id: "looks_which",
    pathway: "looks_different",
    en: "Which medicine looks different?",
    zh: "哪一种药看起来不一样？",
    options: [NOT_SURE],
    medicines: true,
    zhStatus: "draft",
  }),
  // ---- a possible side effect (red flags first)
  side_redflags: F({
    id: "side_redflags",
    pathway: "side_effect",
    en: "Since then, have you had any of these?",
    zh: "这之后有没有出现下面这些情况？",
    options: [
      { id: "swelling", en: "Face, lips or throat swelling", zh: "脸、嘴唇或喉咙肿", tone: "danger" },
      { id: "chest_breath", en: "Chest pain, or short of breath", zh: "胸口痛，或喘不上气", tone: "danger" },
      { id: "faint_weak", en: "Fainted, or weak on one side", zh: "晕倒过，或一边身体没力", tone: "danger" },
      NONE_OF_THESE,
      NOT_SURE,
    ],
    multi: true,
    zhStatus: "draft",
  }),
  side_which: F({
    id: "side_which",
    pathway: "side_effect",
    en: "Which medicine do you think it is from?",
    zh: "你觉得是哪一种药引起的？",
    options: [NOT_SURE],
    medicines: true,
    zhStatus: "draft",
  }),
  side_since: F({
    id: "side_since",
    pathway: "side_effect",
    en: "Since when has it been like this?",
    zh: "从什么时候开始这样的？",
    options: [
      { id: "since_start", en: "Since it started", zh: "刚开始吃就有", tone: "neutral" },
      { id: "since_change", en: "Since a dose change", zh: "换了剂量以后", tone: "neutral" },
      NOT_SURE,
    ],
    zhStatus: "draft",
  }),
  // ---- stopping or changing a medicine (his idea or someone else's)
  stop_already: F({
    id: "stop_already",
    pathway: "stop_change",
    en: "Have you already stopped it?",
    zh: "这个药你已经停了吗？",
    options: [{ id: "yes", en: "Yes", zh: "已经停了", tone: "neutral" }, { id: "not_yet", en: "Not yet", zh: "还没有", tone: "calm" }, NOT_SURE],
    zhStatus: "draft",
  }),
  stop_since: F({
    id: "stop_since",
    pathway: "stop_change",
    en: "When did you stop?",
    zh: "什么时候停的？",
    options: [
      { id: "today", en: "Today", zh: "今天", tone: "neutral" },
      { id: "days", en: "A few days ago", zh: "几天前", tone: "neutral" },
      { id: "longer", en: "Longer ago", zh: "更早以前", tone: "neutral" },
      NOT_SURE,
    ],
    zhStatus: "draft",
  }),
  // ---- the self-harm ladder: ask directly (accepted practice; the research report, Judd et al.)
  self_harm_confirm: F({
    id: "self_harm_confirm",
    pathway: "self_harm_check",
    en: "It sounds like things are very hard right now. Are you having thoughts of ending your life or hurting yourself?",
    zh: "听起来你现在很难受。你有没有想过结束自己的生命，或者伤害自己？",
    options: [{ id: "yes", en: "Yes", zh: "有", tone: "danger" }, { id: "no", en: "No", zh: "没有", tone: "calm" }, RATHER_NOT],
    zhStatus: "draft",
  }),
  self_harm_danger: F({
    id: "self_harm_danger",
    pathway: "self_harm_check",
    en: "Are you thinking of doing it soon, or do you have something ready to do it with?",
    zh: "你是不是打算很快就这样做，或者已经准备好了东西？",
    options: [{ id: "yes", en: "Yes", zh: "是", tone: "danger" }, { id: "no", en: "No", zh: "不是", tone: "calm" }, RATHER_NOT],
    zhStatus: "draft",
  }),
} as const satisfies Record<string, FollowUpTemplate>;

export type FollowUpTemplateId = keyof typeof FOLLOW_UPS;

export const ALL_FOLLOW_UPS: FollowUpTemplate[] = Object.values(FOLLOW_UPS);

/** Which B1 row backs the emergency template for the symptoms found (default B1-01). */
export function emergencyReferralFor(signals: string[]): string {
  if (signals.includes("overdose")) return "B1-12";
  if (signals.includes("stroke")) return "B1-03";
  if (signals.includes("allergy")) return "B1-05";
  if (signals.includes("breathing")) return "B1-02";
  if (signals.includes("high_bp_symptom")) return "B1-10";
  if (signals.includes("collapse")) return "B1-04";
  if (signals.includes("confusion")) return "B1-09";
  if (signals.includes("bleeding")) return "B1-07";
  return "B1-01";
}
