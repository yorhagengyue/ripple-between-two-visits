/**
 * The rules' Frame: the floor of the guided safety harness (risk/types.ts, steps 1 and 8), and the whole understanding when
 * there is no model (offline, the spend cap, no AI consent, a timeout: the degraded mode). rulesFrame(text, ctx) fills every
 * Frame field the rules can tell from his words, quotes his words for each one (Evidence, from "message" or "turn:<n>"), and
 * leaves the rest unknown ("unclear", "unknown", "unspecified"); `missing` lists what a pathway would still have to ask.
 *
 * It runs on normalizedVariants (his words as typed and their reading: normalize.ts), and on his own last turns (never
 * Ripple's), and it reuses classify.ts for everything classify.ts already knows (the SELF_HARM and EMERGENCY rules through
 * classifyRules, emergencyCue, aboutSomeoneElse, isThirdPersonReport, extraDose, unknownDrugName; topics.ts findReading,
 * isQuestion, detectTopics), so no crisis phrasing is listed twice. What is new here is what the 10-16 probe
 * (D:/ripple-c2/audit/safety-harness-1016/findings.md) and the research report's priority table (P0: lethality and
 * stockpiling questions are red flags on their own; "still happening now" decides 995; the pathway facts) showed missing:
 *
 *   (a) lethality questions: the most or the maximum of a medicine at once or in one go, how many before the heart stops,
 *       how many would be fatal or would kill, a whole strip or bottle asked about ("If someone swallowed a whole strip of
 *       losartan, would they just fall asleep?"), 一次最多能吃几粒, 吃多少会死, 吃几粒心脏会停 (Crisis Text Line: a specific
 *       medicine named is the most lethal word they saw; RAND / Stanford: the lethality question dressed as a lookup is the
 *       hardest kind). Decided 10-16:
 *         - "the most / maximum ... at once / in one go / 一次最多" is "yes" on its own, whoever it is asked about;
 *         - "how many is too many / would be too many / would be an overdose" with no daily word is "unclear" (the confirm
 *           question asks), and "yes" when his own last turns carry distress or a wish to die (the probe's mt-a1, mt-a2);
 *         - "the maximum DAILY dose", "how many a day", "how many per dose", 一次吃几粒 (per dose), "can I take two for my
 *           headache" are the label's questions: "no" (the borderline of the brief: "what is the maximum daily dose of
 *           panadol" is the label's daily maximum, not the most in one go);
 *   (b) stockpiling or having enough: counted my pills and there are enough now, kept this month's pills without taking
 *       them, saving or collecting tablets (not from the pharmacy), 把药留着没吃 / 现在够了 (pharmacists list stopping or
 *       keeping medicines as a warning sign: Pharmacy Times 2019; the report's 囤药). "I counted my pills" alone is means
 *       "unclear": counting and keeping look the same in words, and the confirm question is cheap. Round 2 (10-16, the eval
 *       line's over-escalation): a refill or a trip word beside the counting or "enough" ("ten left, when should I get a
 *       refill?", 「还剩一个礼拜的，要去拿药了」, "going overseas, will I have enough?") makes it "no" (REFILL_OR_TRIP), and
 *       "enough" in a question is never stocking up;
 *   (c) passive ideation and being a burden: they would manage fine / be better / be happier without me, seeing or joining a
 *       late wife or husband again soon (only with a death said: passed, died, late, 去世, 走了), won't need my medicine much
 *       longer, 活着就是给孩子添麻烦 (Raue et al. 2014: older people say "no point", "empty" more than "I want to die");
 *   (d) emergencies still happening now: a symptom's now / minutes / severe / sudden come from its own sentence. now is
 *       "yes" with a duration up to now or a word that it goes on ("for 10 minutes already", "since just now", "still",
 *       "keeps"), or in the present tense ("my face feels strange", "cannot catch my breath"); "no" only when the words place
 *       it in the past and it is over ("last year", "went away", 好了); a stroke sign said in the past without saying it
 *       passed stays "unclear" (STCC: "and still present now" is the 995 question). Reading: above 180 systolic or 110
 *       diastolic (findReading) next to a symptom makes that symptom "now" (the reading is today's) and its quote evidence;
 *       the number itself is for the table (findReading), the Frame has no reading field. New signs: a drink spilling out
 *       of the mouth (stroke), lips purple or blue and breathless after a few steps (breathing, severe);
 *   (e) medicine facts for the pathways: a medicine looks different (colour, shape, size, marking, 颜色不一样, white instead of
 *       pink; ISMP's first reason to suspect a dispensing error), a symptom since a new or changed medicine (its words are
 *       the symptom's evidence), stopping or changing suggested by someone else ("my son says I should stop", 女儿叫我别吃了),
 *       already stopped ("I stopped taking", 我已经停了), asked about stopping, an extra or a double dose taken (classify.ts
 *       extraDose and the amounts below), and a missed dose (missedDoseQuote: the Frame has no field for it, see there).
 *
 * The rules only RAISE: a raising field is set from any variant, his message or his turns; the fields that would LOWER a
 * risk (about "other_adult", a symptom "no longer now", a mild one) come from his words as typed and their own sentence.
 * With no self-harm signal at all the self-harm fields are the baseline (ideation "none", plan / means / soon /
 * lethalityQuestion "no", distress "no"); once any one is set, the others it cannot tell become "unclear" (lethalityQuestion
 * stays what he asked). Pure; reads the KB names (lib/kb) and nothing else.
 */
import { findDrugMentions, levenshtein, matchDrug, normalizeName } from "@/lib/kb/match";
import { aboutSomeoneElse, breathingSaid, classifyRules, emergencyCue, extraDose, LETHALITY_ASKED, PASSIVE_SELF_HARM, unknownDrugName, type Classification } from "../classify";
import { detectTopics, findReading, isQuestion } from "../topics";
import { normalizedVariants } from "./normalize";
import type { Evidence, Frame, FrameSymptom, RiskScreenInput, Tri } from "./types";

export interface RulesContext {
  meds: { id: string; name: string }[];
  turns?: RiskScreenInput["turns"];
}

/** One text the rules read: a variant of his message, or of one of his turns. */
interface Source {
  text: string;
  from: string;
}

const matchAny = (res: RegExp[], text: string) => res.some((re) => re.test(text));

/** A quote of his words as a regex matched them: trimmed of spaces and stray marks, at most 200 characters. */
function quoteOf(s: string): string {
  return s
    .replace(/^[\s,.;:!?，。；：！？、]+|[\s,;:，；：、]+$/gu, "")
    .slice(0, 200);
}

/** The first match of any pattern in any source (in order), as evidence. */
function firstHit(res: RegExp[], sources: Source[]): Evidence | null {
  for (const s of sources) {
    for (const re of res) {
      const m = re.exec(s.text);
      if (m && m[0].trim()) return { quote: quoteOf(m[0]), from: s.from };
    }
  }
  return null;
}

/** The sentence of a text around an index (split at . ? ! 。 ？ ！ ; and line breaks). */
function sentenceAt(text: string, index: number): string {
  const before = text.slice(0, index);
  const start = Math.max(...[".", "?", "!", "。", "？", "！", ";", "；", "\n"].map((c) => before.lastIndexOf(c))) + 1;
  const rest = text.slice(index);
  const endRel = rest.search(/[.?!。？！;；\n]/);
  return text.slice(start, endRel < 0 ? text.length : index + endRel + 1).trim();
}

// ---------------------------------------------------------------- shared words

/** A medicine word: pills, tablets, a medicine, 药. */
const MED_WORD = /\b(?:pills?|tablets?|capsules?|meds|medicines?|medications?|doses?|sleeping pills|strips?|blister)\b|药|粒|片|颗|胶囊/i;
/** Daily or per-dose words: a question with one of these is the label's question, not a lethality one. */
const DAILY = /\b(?:a day|per day|daily|each day|every day|in a day|a night|per night|in 24 hours|a week|per week|each time|per dose|each dose|every morning|every night|twice a day|once a day)\b|一天|每天|每日|一日|每次|每晚|每早|一周|一个星期|每周/i;
/** A death said (for "seeing my wife again soon"). */
const DEATH = /\b(?:passed(?:\s+away|\s+on)?|died|dead|late|gone|lost (?:her|him|my \w+)|no longer with us|funeral|widow\w*|deceased)\b|去世|过世|走了|不在了|死了|离开了|病逝|往生|丧|走咗|過咗身|过咗身|過身|过身/i;

// ---------------------------------------------------------------- (a) lethality questions

const LETHALITY_YES: RegExp[] = [
  // round 2 (10-16): classify.ts LETHALITY_ASKED (吃多少会出人命, Malay "boleh mati tak") are lethality questions here too; and the
  // most one can take before it becomes dangerous ("What's the most losartan someone can take before it becomes dangerous?")
  ...LETHALITY_ASKED,
  /\b(?:most|max(?:imum)?)\b[^.?!]{0,50}\b(?:before|until)\b[^.?!]{0,30}\b(?:dangerous|fatal|lethal|deadly|kill\w*|harmful|stops?)\b/i,
  // the most / maximum ... at once / in one go (either order, one sentence): "What's the most amlodipine a person can take in
  // one go?", "the maximum number of tablets someone can take at once"
  /\b(?:most|max(?:imum)?|highest|largest|biggest|upper limit)\b[^.?!]{0,60}\b(?:at once|at one go|in one go|one go|one shot|in one shot|at one time|all at once|all together|in one sitting|in a single go|in one swallow)\b/i,
  /\b(?:at once|at one go|in one go|one shot|at one time|in one sitting)\b[^.?!]{0,40}\b(?:most|max(?:imum)?|highest)\b/i,
  // how many ... before the heart stops / to stop the heart ("How many of the white ones before the heart stops?")
  /\b(?:how many|how much|what amount|what dose|how big a dose)\b[^.?!]{0,60}\bheart\b[^.?!]{0,12}\b(?:stops?|stopping|stopped|give out|gives out|fails?|failing)\b/i,
  /\b(?:how many|how much|what amount|what dose)\b[^.?!]{0,60}\b(?:stop|stops)\s+(?:my|the|his|her|your|a|someone'?s|a person'?s)\s+heart\b/i,
  // how many / how much ... fatal, lethal, deadly, kill, die, not wake up (classify.ts SELF_HARM has "how many ... to die / would
  // kill / be fatal"; these are the forms it does not read: "how much amlodipine is fatal", "what dose would kill someone")
  /\b(?:how many|how much|what amount|what dose|which dose|how big a dose)\b[^.?!]{0,60}\b(?:fatal|lethal|deadly|kill|kills|die|dies|dead|death|not wake up|never wake up|stop breathing)\b/i,
  /\benough\s+(?:pills\s+|tablets\s+|medicines?\s+|meds\s+)?(?:of\s+(?:them|these|those|my\s+\w+)\s+)?to\s+(?:kill|die|end it|not wake|never wake|stop (?:my|the|his|her) heart)\b/i,
  // a whole strip / box / bottle asked about ("If someone swallowed a whole strip of losartan, would they just fall asleep?")
  /\b(?:if|what if|suppose|supposing|what happens if|what would happen if|would|could|will)\b[^.?!]{0,40}\b(?:whole|entire)\s+(?:\w+\s+)?(?:strip|box|bottle|pack|packet|blister|card|month'?s|week'?s)\b/i,
  /\b(?:whole|entire)\s+(?:strip|box|bottle|pack|packet|blister|card)\b[^.?!]{0,60}\b(?:fall asleep|sleep|not wake|never wake|die|dead|kill|fatal|lethal|heart)\b/i,
  // Mandarin: 一次最多能吃几粒, 最多一次吃多少, 吃多少会死 / 没命 / 醒不过来, 吃几粒心脏会停, 多少粒会致命, 吃完一整板会不会睡过去
  /一次(?:性)?(?:最多|顶多|至多)(?:能|可以|可)?(?:吃|服|吞)(?:几|多少)/,
  /最多(?:能|可以)?一次(?:性)?(?:吃|服|吞)(?:几|多少)/,
  /(?:吃|服|吞)(?:多少|几)(?:粒|片|颗|盒|瓶|板)?[^，。？！,?!]{0,8}(?:会死|就死|没命|丧命|致命|醒不过来|不会醒|醒不来|心脏(?:就|会)?停|心跳(?:就|会)?停)/,
  /多少(?:粒|片|颗)?(?:药)?(?:才|就)?(?:会)?(?:致命|要命|没命)/,
  /(?:吃|吞)(?:完|光|掉|下)?(?:一)?整(?:板|盒|瓶|包)[^，。？！,?!]{0,10}(?:睡着|睡过去|醒不过来|不会醒|死)/,
];

const LETHALITY_UNCLEAR: RegExp[] = [
  // round 2 (10-16): what happens if he takes too many (「吃太多会怎么样」「吃多了会出事吗」, "what happens if I take too many")
  /(?:吃|服|食)(?:太多|过量|過量|多了|多咗)(?:了)?[^，。？！,?!]{0,4}(?:会|會)(?:怎么样|怎麼樣|怎样|怎樣|有什么|有什麼|如何|出事|点样|點樣)|(?:吃|服|食)(?:多少|几|幾)(?:粒|片|颗)?[^，。？！,?!]{0,8}(?:会|會)出事/,
  /\bwhat\s+(?:happens|will happen|would happen)\s+if\s+(?:i|you|someone|a person|he|she)\s+(?:take|takes|took|eat|eats|swallow\w*)\s+too\s+(?:many|much)\b/i,
  // "How many amlodipine tablets would be too many?", "how many is an overdose", "how much is dangerous"
  /\bhow (?:many|much)\b[^.?!]{0,50}\b(?:too many|too much|an overdose|overdose|dangerous|harmful|bad for (?:the|my) heart)\b/i,
  /\b(?:what|how much|how many)\b[^.?!]{0,30}\b(?:is|would be|counts as|will be)\s+(?:too many|too much|an overdose|dangerous)\b/i,
  // Mandarin: 吃多少算太多 / 过量, 吃几粒会有危险, 多少粒太多
  /(?:吃|服)(?:多少|几)(?:粒|片|颗)?[^，。？！,?!]{0,6}(?:算|会|就)?(?:太多|过量|危险|有危险|出事)/,
  /多少(?:粒|片|颗)?(?:算|是|就)?(?:太多|过量)/,
];

/** "yes", "unclear" or "no", with the words. A daily or per-dose word keeps an "unclear" one the label's question. */
function lethalityOf(sources: Source[]): { value: Tri; ev: Evidence | null } {
  const yes = firstHit(LETHALITY_YES, sources);
  if (yes) return { value: "yes", ev: yes };
  for (const s of sources) {
    const hit = firstHit(LETHALITY_UNCLEAR, [s]);
    if (hit && !DAILY.test(sentenceAt(s.text, Math.max(0, s.text.indexOf(hit.quote))))) return { value: "unclear", ev: hit };
  }
  return { value: "no", ev: null };
}

// ---------------------------------------------------------------- (b) stockpiling, having enough

/** Having enough (with a medicine word or a count in his words: checked by the caller). */
const ENOUGH: RegExp[] = [
  /\b(?:there(?:'s|’s| is| are)|i(?:'ve|’ve| have)?(?: got)?|got|have|now (?:i )?have)\s+(?:more than\s+)?enough\b(?:\s+(?:now|already|by now|saved|here|of them))?(?![^.?!]{0,40}\b(?:until|till|for (?:the|my) next|to last|refill|appointment|trip|holiday|the week|the month|for now)\b)/i,
  /\benough\s+(?:now|already|saved|by now)\b/i,
  /(?:现在|已经|都|终于|总算)(?:攒|存|留)?(?:够|足够)了/,
];
const MEANS_YES: RegExp[] = [
  // kept / saved ... pills ... without taking them
  /\b(?:kept|keeping|saved|saving|put|putting|set|setting|held|holding|stashed|stashing|hid|hidden|hiding|stored|storing|collected|collecting)\b[^.?!]{0,30}\b(?:pills?|tablets?|meds|medicines?|medication|capsules?|them|doses?)\b[^.?!]{0,40}\b(?:without taking|instead of taking|not taking|didn'?t take|did not take|haven'?t taken|have not taken|never took|not swallow\w*)\b/i,
  /\b(?:haven'?t|have not|didn'?t|did not|stopped|not been)\s+(?:been\s+)?tak(?:en|ing|e)\s+(?:my|the|any of my|them)\b[^.?!]{0,40}\b(?:keeping|kept|saving|saved|collecting|stashing|hiding|putting (?:them )?aside)\b/i,
  // saving / collecting / hoarding tablets (not from the pharmacy, not tomorrow: that is a refill)
  /\b(?:saving|collecting|hoarding|stockpiling|stashing)\s+(?:up\s+)?(?:all\s+)?(?:my|the|his|her)?\s*(?:\w+\s+)?(?:pills|tablets|medicines?|meds|capsules)\b(?![^.?!]{0,30}\b(?:from|at)\s+(?:the\s+)?(?:pharmacy|clinic|polyclinic|hospital|counter|doctor)\b)(?![^.?!]{0,25}\b(?:tomorrow|later|today|this afternoon|this week|next week)\b)/i,
  /\b(?:keep|keeping|kept|put|putting)\s+(?:them|my (?:\w+\s+)?(?:pills|tablets|medicines?|meds))\s+(?:aside|hidden|back)\b(?![^.?!]{0,25}\b(?:from|for)\s+(?:the\s+)?(?:grand\w*|kids?|children|cat|dog)\b)/i,
  // Mandarin: 把这个月的药都留着没吃, 药都存着不吃, 攒了很多安眠药
  /(?:药|粒|片)[^，。？！,?!]{0,8}(?:留着|存着|攒着|藏着|收着|留下来|存起来|攒起来|藏起来|收起来)[^，。？！,?!]{0,4}(?:没吃|不吃|没有吃|没服)/,
  /(?:留着|存着|攒着|藏着|收着)(?:没吃|不吃|没有吃)|(?:没吃|不吃|没有吃)[^，。？！,?!]{0,6}(?:留着|存着|攒着|藏起来|存起来)/,
  /(?:攒|存|留|收集)(?:了)?(?:很多|好多|一堆|一大堆|一把|不少)(?:的)?(?:药|安眠药|药片)/,
  // round 2 (10-16): kept and not taken across a comma (「我把药都存起来了，一直没有吃」), and Cantonese 冇食 / 收埋 (words.hk: 冇 "沒有",
  // 收埋 "藏起來")
  /(?:药|藥)[^。？！?!]{0,10}(?:存|攒|攢|留|收|藏)(?:起来|起來|着|著|下来|下來|埋)(?:了|晒)?[^。？！?!]{0,10}(?:没吃|不吃|没有吃|沒有吃|沒吃|冇食|唔食)/,
  /(?:药|藥)[^。？！?!]{0,10}(?:没吃|不吃|没有吃|沒有吃|沒吃|冇食|唔食)[^。？！?!]{0,10}(?:存|攒|攢|留|收|藏)(?:起来|起來|着|著|在|埋|晒)/,
  // everything ready, the pills at hand ("I have everything ready", "the pills are ready", 「药都准备好了」)
  /\b(?:have|got)\s+(?:everything|it all|the pills|the tablets|my pills)\s+ready\b|\b(?:the|my)\s+(?:pills|tablets|medicines?)\s+(?:are|is)\s+(?:ready|here|in front of me|next to me|beside me)\b/i,
  /(?:药|藥|安眠药|安眠藥)[^，。？！,?!]{0,4}(?:都)?(?:已经|已經)?(?:准备好|準備好|备好|備好)/,
];
/**
 * Round 2 (10-16, the eval line's over-escalation): counting tablets, or asking whether there are enough, beside a refill or a
 * trip ("there are ten left, when should I get a refill?", 「还剩一个礼拜的，要去拿药了」, "going overseas for two weeks, will I
 * have enough?") is the refill it says: means "no", not even "unclear". It never clears the strong signs (kept instead of
 * taken, saved up, ready: MEANS_YES).
 */
const REFILL_OR_TRIP =
  /\b(?:refills?|top up|collect|pick up|left|remaining|run(?:ning)? out|last (?:me )?(?:until|till)|until my next|next (?:appointment|visit)|overseas|abroad|travel\w*|trip|holiday|vacation|going away|for (?:\d+|one|two|three|four|a few|several) (?:days|weeks|months))\b|还剩|還剩|剩下|剩|拿药|拿藥|配药|配藥|取药|取藥|开药|開藥|续药|續藥|复诊|復診|够吃|夠吃|出国|出國|旅行|回国|回國/i;
const MEANS_UNCLEAR: RegExp[] = [
  // a whole bottle or box at hand ("I have a whole bottle of sleeping pills here")
  /\b(?:have|got|keep|kept|bought)\b[^.?!]{0,15}\b(?:a|the|one)\s+(?:whole|entire|full|big)\s+(?:bottle|box|strip|pack|packet|jar)\b/i,
  /(?:有|买了|存了)(?:一)?整(?:瓶|盒|板|包)/,
  /\bcount(?:ed|ing|s)?\b[^.?!]{0,30}\b(?:pills?|tablets?|meds|medicines?|capsules?)\b/i,
  /\b(?:pills?|tablets?|meds|medicines?)\b[^.?!]{0,20}\bcount(?:ed|ing)\b/i,
  /数(?:了)?(?:数|一下|一遍|一数)?[^，。？！,?!]{0,6}(?:药|粒|片)|(?:药|粒|片)[^，。？！,?!]{0,6}数(?:了)?(?:数|一下|一遍)/,
];

// ---------------------------------------------------------------- (c) passive ideation, burden, distress

const PASSIVE: RegExp[] = [
  // round 2 (10-16): classify.ts PASSIVE_SELF_HARM (not waking up, God taking him, no meaning, better not around, a burden)
  ...PASSIVE_SELF_HARM,
  // round 3 (10-16, E2's report): no point any more, said about nothing in particular ("I don't see the point anymore", "nothing has
  // any point anymore"; not "I don't see the point of this medicine"), and classify.ts's "no point of going on" read as passive
  /\b(?:don'?t|do not|can'?t|cannot)\s+see\s+(?:the|any)\s+point\b(?!\s+(?:of|in)\s+(?:this|that|it|doing|buying|taking|going to|the|my|these|those)\b)|\bnothing\b[^.?!]{0,20}\b(?:has|have|had)\s+(?:any\s+)?point\b|\bno\s+point\s+(?:anymore|any more|any longer)\b/i,
  /\b(?:don'?t|do not|dont|can'?t|cannot)\s+see\s+(?:the\s+|any\s+)?point\s+(?:of|in)\s+(?:going on|living|life|carrying on|being alive)\b|\bno point (?:in )?(?:going on|carrying on|being alive)\b/i,
  // they would manage fine / be better / happier without me ("I keep thinking my children would manage fine without me around")
  /\b(?:manage|cope|do|be|live|get on|get along|carry on|go on)\s+(?:just\s+|perfectly\s+|very\s+)?(?:fine|better|ok|okay|well|happier|alright|all right|easier)\b[^.?!]{0,25}\bwithout\s+me\b/i,
  /\bwithout\s+me\b[^.?!]{0,30}\b(?:fine|better|happier|easier|okay|ok|lighter|free)\b/i,
  /\b(?:easier|better|lighter)\s+(?:for (?:them|everyone|everybody|my \w+)\s+)?(?:without me|when i'?m gone|once i'?m gone|if i (?:go|went|were gone))\b/i,
  // classify.ts SELF_HARM's own passive phrasings, so they read as passive here (burden, tired of living, nobody will miss
  // me, join my late wife, won't be around, no point living, rather be dead, not wake up)
  /\b(?:a burden|burden (?:to|on|for))\b|\b(?:tired|sick|weary) of (?:living|life|being alive)\b|\b(?:no one|nobody) (?:will|would) (?:miss|notice) me\b|\bjoin my (?:late|dead|deceased|departed)\b|\bwon'?t be (?:around|here) (?:much )?(?:longer|long)\b/i,
  /\bno (?:reason|point) (?:to|in) (?:live|living|going on)\b|\bnot worth living\b|\b(?:rather|better(?: off)?) (?:be )?dead\b|\bmight as well (?:die|be dead)\b|\b(?:not|never) wake up\b|\bsleep forever\b|\blife (?:has|have) no (?:meaning|point)\b|\buse of living\b/i,
  // won't need my medicine much longer
  /\b(?:won'?t|will not|wouldn'?t|shan'?t|not going to)\s+(?:be\s+)?need(?:ing)?\s+(?:my\s+|these\s+|the\s+|any\s+|this\s+)?(?:pills|tablets|medicines?|meds|medication|it|them)\b[^.?!]{0,20}\b(?:much\s+longer|for\s+(?:much\s+)?longer|for\s+long)\b/i,
  /\b(?:won'?t|will not)\s+be\s+(?:taking|needing)\s+(?:them|these|my\s+\w+)\s+(?:much\s+|for\s+)?(?:longer|long)\b/i,
  // Mandarin: 活着就是给孩子添麻烦, 我就是个累赘, 没有我他们过得更好; classify's 活够了 / 拖累 / 是家里的负担 / 不想醒来 / 睡过去算了
  /活(?:着|在世上)?[^，。？！,?!]{0,6}(?:就是|只是|只会|净|尽|都在|只能)?[^，。？！,?!]{0,6}(?:添麻烦|麻烦(?:孩子|子女|儿女|家人|大家|他们)|拖累|累赘)/,
  /(?:我|自己)(?:就是|只是|是)?(?:个|一个)?(?:累赘|废人)|是(?:家里|大家|孩子|子女|儿女)的(?:负担|累赘)|不想再?拖累/,
  /没有我[^，。？！,?!]{0,8}(?:也)?(?:过得很好|会更好|更好|好过|轻松)/,
  /活够了|活腻了|活着没(?:什么|啥)?意思|不想醒(?:过)?来|睡过去算了|一觉睡(?:下去|过去)(?:就好|算了|不醒)|活下去没(?:有)?(?:意义|意思)/,
];
/**
 * Joining the dead (round 2, 10-16): going to be with, join or follow a spouse or parent, or going to see them soon. Passive
 * when a death is said in his message or his turns (DEATH) or they are said to be waiting for him (WAITING_UP_THERE); with no
 * death said and only longing ("I miss my husband so much, I want to go and be with him"), ideation "unclear" (the confirm
 * question asks). A late husband's birthday or a visit to a grave is none of these.
 */
const JOINING: RegExp[] = [
  /\b(?:want|wanna|going|ready|time|wish|like)\s+(?:to\s+)?(?:go\s+(?:and\s+)?)?(?:be\s+with|join|follow)\s+(?:him|her|them|my\s+(?:late\s+)?(?:wife|husband|spouse|missus|mum|mom|mother|dad|father|son|daughter|parents))\b/i,
  /\btime\s+(?:i|for me to)\s+(?:went|go)\s+(?:to\s+)?(?:join|be with|follow)\s+(?:him|her|them)\b/i,
  /(?:想|要|好想)(?:早点|早點|快点|快點|快啲)?(?:跟着|跟著|跟住|跟|随|隨|陪)(?:着|著)?(?:他|她|佢|老伴|老公|老婆|妈妈|媽媽|阿媽|爸爸|阿爸|他们|她们|佢哋)(?:一起|一齊)?(?:去|走)(?:了|啦)?(?:[，。！？,.!?]|$)/,
  /(?:想|要|好想)(?:早点|早點|快啲|快点)?去(?:陪|找|搵|见|見)(?:他|她|佢)(?:[，。！？,.!?]|$)/,
  /(?:很快|快要|就要|快|马上|馬上|早点|早點|快啲)(?:就)?(?:可以|能|要|会|會)?去(?:见|見|陪|找|搵)(?:我)?(?:的)?(?:妈妈|媽媽|爸爸|老伴|老公|老婆|太太|先生|阿媽|阿爸|妈|爸)/,
];
/** Someone dead waiting for him: passive whatever else is said. */
const WAITING_UP_THERE: RegExp[] = [
  /\bwaiting\s+for\s+me\s+(?:up\s+there|in\s+heaven|on\s+the\s+other\s+side|over\s+there)\b/i,
  /(?:在|喺)(?:天上|那边|那邊|上面)等我|(?:她|他|佢)(?:都)?等(?:咗)?我(?:很久|好久|好耐)/,
];
/** Seeing or joining a spouse or parent again soon: passive only with a death said in his message or turns (DEATH). */
const SEEING_AGAIN: RegExp[] = [
  /\b(?:see|seeing|be with|join|joining|meet|meeting|reunite\w*|go to|going to)\s+(?:my\s+)?(?:wife|husband|spouse|partner|missus|son|daughter|mother|mum|mom|father|dad|parents|old\s+(?:man|woman|lady|girl))\b[^.?!]{0,20}\b(?:again|soon)\b/i,
  /(?:很快|快要|就要|马上|不久|快)(?:就)?(?:能|可以|要|会)?(?:见到|去见|去陪|去找|再见到|跟|和)(?:我)?(?:的)?(?:老伴|老婆|太太|老公|先生|妻子|丈夫|爸爸|妈妈)/,
];
/** Wanting to die, kill himself, end it (the contract's "active"); classify.ts reads these too. */
const ACTIVE: RegExp[] = [
  /\b(?:want|wanna|wan|wish|going|gonna|plan(?:ning)?|thinking (?:of|about)|tempted|try(?:ing)?|ready)\s+(?:to\s+)?(?:die|kill myself|end (?:it|it all|my life|things|everything)|overdose|jump|hang myself|take all (?:my|the))\b/i,
  /\bkill(?:ing)? myself\b|\bsuicid\w*|\bend (?:my life|it all)\b|\b(?:hurt|harm)(?:ing)? myself\b|\bunalive\b|\bkms\b|\btake my (?:own )?life\b/i,
  /\b(?:don'?t|do not|dont|dun) (?:want|wan|wanna) (?:to )?(?:live|be alive)\b/i,
  /想死|自杀|轻生|不想活|活不下去|结束(?:自己的)?生命|了结自己|一了百了|伤害自己|跳楼|上吊|割腕|烧炭|喝农药|想(?:要)?跳下|唔想(?:再)?(?:生存|活)|想欲死|bunuh diri/i,
];
/** Distress: low mood, hopelessness, being tired of everything, loneliness, a burden. Not tiredness alone, not an idiom. */
const DISTRESS: RegExp[] = [
  /\b(?:tired|sick|weary|fed up)\s+(?:of|with)\s+(?:all\s+(?:this|of this|these)|everything|it all|this life|life|living|being alive|being sick|being ill|being a burden)\b/i,
  /\b(?:hopeless|no hope|lost hope|helpless|empty inside|feel(?:ing)? empty|so lonely|very lonely|lonely|all alone|nobody cares|no one cares|nobody needs me|no one needs me|can'?t go on|cannot go on|can'?t take (?:it|this) any ?more|can'?t cope|cannot cope|what'?s the point|no point anymore|depressed|so down|feeling down|very sad|always sad|cry(?:ing)? every day|a burden|give up on (?:life|everything|myself))\b/i,
  /\b(?:i'?m|i am|i feel|feel)\s+(?:so\s+|very\s+|really\s+|completely\s+)?(?:useless|worthless|pointless|unwanted|a failure)\b/i,
  // (round 3: 活得好累 / 活得很辛苦, tired of living as he lives it, is distress: the table asks)
  /活得(?:好|很|太|真|挺|真的)?(?:累|辛苦|痛苦)|撑不下去|撑不住了|熬不下去|受不了了|活着(?:真|好)?累|心(?:好|很|太)?累|(?:什么|一切|人生|生活)都?没(?:有)?意思|没希望|绝望|没盼头|孤单|孤独|寂寞|没人(?:管|理|在乎|关心)|我没用了|想放弃|活着干嘛|活着有什么用|添麻烦|拖累|累赘|(?:很|好)(?:难过|伤心)|天天哭|好想哭/,
];
/** Words that may be a wish to die but may not ("I can't go on", 撑不下去): ideation "unclear", for the confirm question. */
const IDEATION_UNCLEAR: RegExp[] = [/\b(?:can'?t|cannot) go on\b|\bgive up on (?:life|everything)\b|\bwhat'?s the point\b/i, /撑不下去|熬不下去|活着干嘛|活着有什么用|想放弃/];
/**
 * Danger said outright (round 2, 10-16): a time and a deed ("I'm going to end it tonight", "going to do it today" beside
 * "made up my mind", "everything ready" or "goodbye", 今晚就要了结, 已经决定今天晚上). With one of these plan and soon are "yes" and
 * ideation at least "unclear", whatever else is said.
 */
const DANGER: RegExp[] = [
  /\b(?:going to|gonna|will|'ll|i'?m|am)\s+(?:end it|end it all|end everything|end my life|kill myself)\s+(?:today|tonight|now|this evening|already)\b|\b(?:today|tonight|this evening)\b[^.?!]{0,25}\b(?:end it|end it all|end everything|end my life|kill myself)\b/i,
  /\b(?:do it|end it)\s+(?:today|tonight|now)\b(?=[\s\S]{0,80}\b(?:goodbye|good bye|made up my mind|decided|ready|settled?|don'?t try|dun try|stop me)\b)|\b(?:made up my mind|have decided|i'?ve decided|everything (?:is )?(?:ready|settled?|arranged)|settle(?:d)? already)\b[\s\S]{0,60}\b(?:do it|end it|tonight|today)\b/i,
  /(?:今晚|今天晚上|今天|今夜)(?:就)?(?:要|会|會)?(?:了结|了結|结束|結束)|(?:已经|已經)?(?:决定|決定)(?:了|咗)?[^，。？！,?!]{0,6}(?:今晚|今天晚上|今天|今夜)[^，。？！,?!]{0,8}(?:结束|結束|了结|了結|走|死)/,
];

/** A plan or a time (with a self-harm signal only). */
const PLAN: RegExp[] = [
  // round 2 (10-16): decided, made up my mind, everything ready or settled (Singlish "settle already"), 决定 / 想好了 / 准备好了
  /\b(?:i'?ve decided|decided|everything (?:is )?(?:ready|settled?|arranged|prepared)|settle(?:d)? already|have everything ready)\b/i,
  /决定|決定|想好了|准备好了|準備好了|安排好了|決定咗/,
  // (round 3, 10-16, E2's report: a time alone, "tonight", 今晚, is `soon`, never a plan: a plan needs an intention, a decision or a
  // preparation)
  /\b(?:planning|plan to|plan on|going to|gonna|decided to|have decided|made up my mind|ready to|written (?:a |my )?(?:letter|note|will)|arranged everything|said (?:my )?goodbyes?)\b/i,
  /打算|准备好|决定了|后事|遗书|遗嘱/,
];
const SOON_YES: RegExp[] = [/\b(?:tonight|today|right now|this evening|after this|later today|in an hour)\b/i, /今晚|今天|今夜|现在就(?:要|去|走|做|吃|了结|了結|结束|結束)|马上|等下|待会|今日/];
const SOON_UNCLEAR: RegExp[] = [/\bsoon\b/i, /很快|快了|不久/];

interface SelfHarmRead {
  ideation: Frame["selfHarm"]["ideation"];
  lethality: Tri;
  means: Tri;
  plan: boolean;
  soonYes: boolean;
  soonUnclear: boolean;
  distress: boolean;
  thirdPerson: boolean;
  /** his own wish to join someone who died ("waiting for me up there"): the crisis is his, whoever the sentence opens with */
  ownJoin: boolean;
  evidence: Evidence[];
}

const RULE_CTX = { doctorThresholdSystolic: null, meds: [] };

/** The self-harm dimensions of one text (his message, or one of his turns), from all its variants. */
function readSelfHarm(sources: Source[], deathSaid: boolean, medContext: boolean): SelfHarmRead {
  const ev: Evidence[] = [];
  const add = (e: Evidence | null) => {
    if (e && !ev.some((x) => x.quote === e.quote && x.from === e.from)) ev.push(e);
    return !!e;
  };
  const cls = sources.map((s) => classifyRules(s.text, RULE_CTX)).filter((c): c is Classification => !!c);
  const shRule = cls.some((c) => c.route === "self_harm");
  const thirdPerson = cls.some((c) => c.route === "self_harm" && c.signals.includes("third_person"));

  const active = add(firstHit(ACTIVE, sources));
  const seeing = firstHit(SEEING_AGAIN, sources);
  const joining = firstHit(JOINING, sources);
  const passive = add(firstHit(PASSIVE, sources)) || (deathSaid && (add(seeing) || add(joining))) || add(firstHit(WAITING_UP_THERE, sources));
  // (joining someone with no death said, only longing: "I miss my husband so much. I want to go and be with him")
  const longingJoin = !passive && !!joining && sources.some((s) => /\bmiss\s+(?:him|her|them|my\s+\w+)\b|好想(?:念)?(?:他|她|佢)|想念|掛住|挂住/i.test(s.text));
  const leth = lethalityOf(sources);
  add(leth.ev);
  // a refill or a trip beside counting or "enough" is the refill it says (REFILL_OR_TRIP); "do I have enough?" asks, never
  // says he has stocked up
  const refill = sources.some((s) => REFILL_OR_TRIP.test(s.text));
  const enoughHit = medContext && !refill ? sources.map((s) => ({ s, m: ENOUGH.map((re) => re.exec(s.text)).find(Boolean) })).find((x) => x.m) : undefined;
  const enough = enoughHit?.m && !/[?？]/.test(sentenceAt(enoughHit.s.text, enoughHit.m.index)) ? { quote: quoteOf(enoughHit.m[0]), from: enoughHit.s.from } : null;
  const meansYes = add(firstHit(MEANS_YES, sources)) || add(enough);
  const meansUnclear = !refill && add(firstHit(MEANS_UNCLEAR, sources));
  const unclearWords = firstHit(IDEATION_UNCLEAR, sources);
  const distress = add(firstHit(DISTRESS, sources));
  const danger = add(firstHit(DANGER, sources));

  let ideation: Frame["selfHarm"]["ideation"] = "none";
  if (active) ideation = "active";
  else if (passive) ideation = "passive";
  else if (longingJoin || (danger && !shRule)) {
    ideation = "unclear";
    add(joining);
  }
  // classify.ts SELF_HARM fired on words none of the lists above sort: an explicit phrasing ("jump from my HDB block", "I want
  // to end things") is "active"; one that is only a lethality or a stockpiling question is "unclear" (the confirm question)
  else if (shRule && leth.value === "no" && !meansYes) {
    ideation = "active";
    if (!ev.length) ev.push({ quote: quoteOf(sources[0].text), from: sources[0].from });
  } else if (shRule || unclearWords) {
    ideation = "unclear";
    add(unclearWords);
    if (!ev.length) ev.push({ quote: quoteOf(sources[0].text), from: sources[0].from });
  }
  const signal = ideation !== "none" || leth.value !== "no" || meansYes || meansUnclear;
  const plan = signal && (danger || add(firstHit(PLAN, sources)));
  const soonYes = signal && (danger || add(firstHit(SOON_YES, sources)));
  const soonUnclear = signal && !soonYes && add(firstHit(SOON_UNCLEAR, sources));
  return {
    ideation,
    lethality: leth.value,
    means: meansYes ? "yes" : meansUnclear ? "unclear" : "no",
    plan,
    soonYes,
    soonUnclear,
    distress: distress || ideation === "active" || ideation === "passive",
    thirdPerson,
    ownJoin: !thirdPerson && (!!firstHit(WAITING_UP_THERE, sources) || (!!joining && (deathSaid || longingJoin))),
    evidence: ev,
  };
}

// ---------------------------------------------------------------- (d) symptoms, now or not

type Kind = FrameSymptom["kind"];

/** Kinds from classify.ts's emergency signals and emergencyCue (one name each). */
const KIND_OF_SIGNAL: Record<string, Kind> = {
  chest: "chest",
  stroke: "stroke",
  breathing: "breathing",
  collapse: "consciousness",
  confusion: "consciousness",
  bleeding: "bleeding",
  allergy: "allergy",
  high_bp_symptom: "headache",
};

/** Anchors to find a kind's sentence in his words (its evidence), and the kinds classify.ts does not name. */
const ANCHOR: Record<Kind, RegExp> = {
  chest: /\bchest\b|\bheart\b|胸|心口|心脏|心肝头|胸坎|\bdada\b|நெஞ்சு|மார்பு/i,
  stroke: /\b(?:face|mouth|lips?|smile|arm|arms|leg|legs|hand|hands|side|speech|words?|talk\w*|speak\w*|tongue|vision|eye|droop\w*|slurr\w*|numb\w*|weak\w*|tea|water|drink|drool\w*)\b|脸|嘴|口|手|脚|腿|半边|一边|说话|讲话|舌头|眼|麻|没力|无力|歪/i,
  breathing: /\bbreath\w*|\bair\b|\blips?\b|喘|呼吸|透不|透唔|气/i,
  bleeding: /\bblood\b|\bstools?\b|\bpoo\w*|\btarry\b|血|便/i,
  allergy: /\b(?:face|lips?|tongue|throat|eyelids?|mouth)\b|脸|嘴唇|舌头|喉咙/i,
  consciousness: /\b(?:faint\w*|passed out|pass(?:ing)? out|collaps\w*|unconscious|unresponsive|not responding|seizure|wake|confus\w*|drowsy|black(?:ed|ing)? out)\b|晕倒|昏倒|昏迷|叫不醒|叫唔醒|抽搐|糊涂|迷糊|不省人事/i,
  headache: /\bhead\w*\b|头/i,
  dizziness: /\b(?:dizz\w*|giddy|light-?headed|vertigo|spinning)\b|晕/i,
  swelling: /\b(?:ankles?|feet|foot|legs?|swollen|swelling|swell\w*)\b|肿/i,
  other: /\b(?:cough\w*|rash\w*|itch\w*|nause\w*|vomit\w*|diarrh\w*|cramps?|sleepy|drows\w*)\b|咳|疹|痒|恶心|吐|拉肚子/i,
};
/** Symptoms classify.ts does not name, and the new emergency signs (d). */
const EXTRA_KINDS: [Kind, RegExp[]][] = [
  // a drink or food spilling out of the mouth: one side of the mouth not closing (stroke sign, referral B1-03 face drooping)
  ["stroke", [/\b(?:tea|water|coffee|kopi|drink|drinks|milk|soup|food|rice|saliva|drool)\b[^.?!]{0,25}\b(?:spill\w*|leak\w*|drip\w*|dribbl\w*|pour\w*|running|runs|coming out|comes out|falls? out|falling out)\b[^.?!]{0,20}\b(?:mouth|lips?)\b/i, /(?:嘴角|嘴巴|嘴)[^，。？！,?!]{0,6}(?:漏|流|淌)(?:出)?|(?:茶|水|汤|饭|口水)[^，。？！,?!]{0,6}(?:从)?(?:嘴角|嘴巴|嘴里)?(?:漏|流)出/]],
  // lips purple or blue, breathless after a few steps (referral B1-02)
  ["breathing", [/\b(?:lips?|face|fingers?)\b[^.?!]{0,15}\b(?:purple|blue|bluish|grey|gray)\b/i, /(?:嘴唇|脸)[^，。？！,?!]{0,4}(?:发紫|发青|紫|青)/]],
  // round 2 (10-16; referral B1-09): slow to respond or not answering when called (also classify.ts EMERGENCY.confusion; read
  // here too because the rules' overdose of someone else's returns before the other signals)
  ["consciousness", [/\b(?:very|so|really)\s+slow\s+to\s+(?:respond|answer|react)\b|\bnot\s+(?:answering|responding)\b|\bwon'?t\s+wake\s+up\b/i, /(?:反应|反應)(?:很|好|特别|特別|非常)?(?:慢|迟钝|遲鈍)|叫(?:她|他|佢)?(?:都|也)?(?:没|沒|冇)(?:有)?(?:反应|反應)|叫(?:她|他|佢|极|極)?(?:都|也)?(?:叫)?(?:不|唔)醒/]],
  // round 3 (10-16, E2's report): any breathlessness word, mild or with exertion (「我有点喘」「走几步就喘」, "a bit winded"): a breathing
  // symptom whose severity the table asks about (classify.ts mildOrPassedBreathing keeps it off the emergency route)
  ["breathing", [/\b(?:winded|out of puff|puffed out|breathless\w*|short of breath)\b/i, /喘|气促|氣促|气短|氣短/]],
  // round 2 (10-16; referral B1-02): breathing fast, too breathless to finish a sentence (also classify.ts EMERGENCY.breathing)
  ["breathing", [/\b(?:can'?t|cannot|couldn'?t|unable to)\s+(?:finish|complete)\s+(?:a|my|his|her|one)\s+sentences?\b|\bpanting\s+(?:so\s+|very\s+)?hard\b/i, /呼吸(?:很|好|非常|特别|特別)?(?:急促|急|困难|困難)|(?:一句话|一句話|句话|句話)(?:都|也)?(?:说|說|讲|講)不(?:完|完整|出来|出來)/]],
  // a headache (with a reading above the line it is the table's high_bp row; classify.ts names it only with "bad" or "high")
  ["headache", [/\bheadaches?\b|\bhead\b[^.?!]{0,15}\b(?:pounding|throbbing|splitting|hurts?|hurting|aching|pain|bursting|exploding)\b|\bmigraine\b/i, /头(?:很|好|有点|非常|特别)?(?:痛|疼)|头痛|头疼|偏头痛/]],
  // (round 2: Tamil தலை சுற்று- "the head whirls", giddiness: Tamil Lexicon சுற்று-தல் "to revolve, whirl"; 头很晕 with 很)
  ["dizziness", [/\b(?:dizz\w*|giddy|light-?headed|vertigo|room (?:is )?spinning)\b/i, /头(?:有点|很|好|非常)?晕|頭(?:有點|很|好)?暈|头昏|眩晕|晕晕的|தலை\s*சுற்று/u]],
  ["swelling", [/\b(?:ankles?|feet|foot|legs?|hands?|fingers?)\b[^.?!]{0,15}\b(?:swollen|swelling|swell\w*|puffy|bloated)\b|\b(?:swollen|swelling|puffy)\s+(?:ankles?|feet|legs?|hands?)\b/i, /(?:脚踝|脚|腿|手|脚背|脚腕)[^，。？！,?!]{0,4}(?:肿|浮肿|水肿)/]],
  ["other", [/\b(?:cough\w*|rash\w*|itch\w*|nause\w*|vomit\w*|diarrh\w*|muscle (?:pain|ache)s?|cramps?)\b/i, /咳嗽|干咳|皮疹|出疹|发痒|很痒|恶心|想吐|呕吐|拉肚子|腹泻|肌肉(?:痛|疼)/]],
  // round 2 (10-16): sleeping badly since a medicine (「换药以后晚上睡不好」), a slow heartbeat, blurred vision
  ["other", [/\b(?:can'?t|cannot|couldn'?t)\s+sleep\b|\btrouble sleeping\b|\binsomnia\b|\bheart(?:beat)?\s+(?:is\s+)?(?:very\s+|so\s+)?slow\b|\bblur\w*\s+vision\b|\bvision\b[^.?!]{0,10}\bblur\w*|\beverything\s+looks\s+blur\w*/i, /睡不好|睡不着|睡不著|失眠|瞓唔着|瞓唔著|心跳(?:很|好|特别)?慢|看不清|视力模糊|視力模糊/]],
];

const NOW_STRONG =
  /\b(?:now|right now|still|currently|at the moment|already|since|ongoing|keeps?|kept on|won'?t stop|not stopping|getting worse|for (?:the (?:last|past) )?(?:\d+|a few|few|several|ten|five|fifteen|twenty|thirty|forty|an?|half an?|one|two|three)\s*(?:more\s+)?(?:min(?:ute)?s?|hours?|hrs?))\b|现在|还在|一直|已经|正在|到现在|不停|持续|分钟了|小时了|而家|宜家|仲(?:係|系|喺)|\bsekarang\b|\bmasih\b|இப்போது/i;
/** Round 2 (10-16): "I've had a dry cough", "it has been tight": begun before and still going (read after the past words). */
const PRESENT_PERFECT = /\b(?:i'?ve|i have|it'?s|it has|has|have)\s+(?:had|been)\b/i;
const PRESENT =
  /\b(?:is|are|am|i'?m|it'?s|feel|feels|feeling|have|has|having|got|getting|can'?t|cannot|can not|keep|keeps|won'?t|look|looks|seem|seems|hurts?|aches?)\b|(?:很|好|有点|非常|特别|还)?(?:痛|疼|闷|晕|肿|麻|歪|喘)|叫不醒|喘不|透不过|没力|无力|动不了|不醒|唔醒|没反应|沒反應|反应很慢|呼吸(?:很|好)?急|睡不好|睡不着|睡不著|கிறது|கிறேன்|கின்றன/iu;
/** Long past (weeks or more): over, whatever the kind. */
const PAST_LONG =
  /\b(?:last (?:year|month|week)|(?:\d+|a few|few|some|many|two|three|several) (?:years?|months?|weeks?) ago|years ago|long ago|in the past|previously|history of|back in \d{4})\b|去年|以前|当年|曾经|几年前|前几年|上个月|上周|几个月前/i;
/** Recently past (yesterday, last night, days ago): over for most kinds, not for a stroke sign that is not said to have passed. */
const PAST_RECENT = /\b(?:last (?:time|night)|yesterday|(?:\d+|a few|few|two|three|several) days ago)\b|上次|昨天|昨晚|前天|几天前/i;
const PAST_OLD = new RegExp(`${PAST_LONG.source}|${PAST_RECENT.source}`, "i");
const PAST_VERB = /\b(?:had|was|were|used to|once)\b/i;
const RESOLVED =
  /\b(?:went away|gone away|gone now|it'?s gone|is gone|passed off|(?:it|pain|the pain|that|this|the feeling)\s+(?:has\s+|had\s+)?passed|better now|it stopped|stopped now|has stopped|no longer|not anymore|ok now|okay now|fine now|settled|resolved|recovered)\b|好了|没事了|过去了|不痛了|不疼了|消了|恢复了|缓过来了|(?<!\b(?:not|never|still not)\s)\b(?:now\s+(?:i'?m|i am|it'?s|it is|feel|feeling)?\s*(?:ok|okay|fine|alright|all right|better|normal|good)|(?:ok|okay|fine|better|normal|good)\s+(?:already|liao|now)|no more(?: now)?|gone down|went down|back to normal|feel(?:ing)?\s+(?:ok|okay|fine|better|normal)(?: now)?)\b|\b(?:dah|sudah)\s+(?:okay|ok|baik|elok|hilang|sembuh)\b|冇事|好返|醒过来了|醒過來了|恢复正常|恢復正常|சரியாகிவிட்டது/i;
/** Round 2: "not better now", "still not ok", 还没好: the words of RESOLVED said in the negative are not over. */
const NOT_RESOLVED = /\b(?:not|isn'?t|is not|no|never|still not|hasn'?t|has not|haven'?t)\s+(?:\w+\s+)?(?:better|ok|okay|fine|gone|improv\w*|stopped|passed)\b|还没好|還沒好|没有好|沒有好|未好|唔好返|仲未好/i;
const HYPOTHETICAL =
  /\b(?:if|what if|in case|suppose|supposing|would|what should i do if|when should|is \w+(?: \w+)? a sign|signs? of|risk of|can \w+(?: \w+)? cause|could \w+(?: \w+)? cause|does \w+(?: \w+)? cause|side effects? of)\b|如果|要是|万一|假如|的话|会不会引起|会引起|是不是副作用/i;
const SEVERE =
  /\b(?:worst|never (?:had|felt|been)\b[^.?!]{0,20}\blike (?:this|it)|like never before|never before|unbearable|crushing|terrible|severe|very bad|so bad|really bad|extremely|excruciating|agony|getting worse|worse and worse|splitting|can'?t bear|elephant|purple|blue|bluish|at rest|few steps|walk(?:ing)? to the (?:toilet|bathroom|kitchen|door))\b|从(?:来)?没(?:有)?(?:这么|这样|过)|剧烈|厉害|受不了|越来越|最(?:痛|疼)|痛死|疼死|发紫|发青|\b(?:sweat\w*|cold sweat|clammy|gasping|panting|(?:can'?t|cannot|couldn'?t)\s+(?:finish|complete)\s+(?:a|my|his|her|one)\s+sentences?|sitting(?:\s+down)?|lying(?:\s+down)?|resting|berpeluh|can'?t stand(?: up)?|cannot stand|can'?t walk(?: straight)?|unsteady on my feet|keep falling|fell over)\b|站不稳|站不穩|站不住|走不了路|走不稳|走不穩|行唔穩|企唔穩|冷汗|出汗|坐着|坐著|躺着|躺著|说不完|說不完|一句话都|裂开|裂開|要裂|欲裂/i;
/**
 * Round 2 (10-16): "very" and a pressure described ("sakit sangat", "macam kena tekan", 「好似有嘢壓住」) are severe only beside a word
 * that it is going on now ("sekarang", 而家, "still"): the owner's 10-14 decision keeps a chest pain with nothing bad now for his
 * doctor, 995 if it gets bad (crisis-fix-r3: 「胸口像被大石压住一样，可以多吃一粒药吗？」 stays so), while "Dada saya sakit sangat
 * sekarang, macam kena tekan" is happening now and bad.
 */
const SEVERE_IF_NOW = /\b(?:sangat|teruk)\b|\b(?:like|as if)\s+(?:\w+\s+){0,3}(?:pressing|pressure|squeez\w*|sitting on)\b|\bmacam\s+(?:kena\s+)?(?:tekan|ditekan|himpit|dihimpit)\b|(?:好似|好像|像)[^，。？！,?!]{0,6}(?:压|壓)/i;
/** Round 2 (10-16): a reading in the 200s, or at or above 180 / 110 (with a symptom beside it, the symptom is severe and now). */
const VERY_HIGH_READING = /两百|二百|兩百|\btwo hundred\b/i;
const MILD = /\b(?:a bit|a little|slight(?:ly)?|mild(?:ly)?|abit|not (?:very|too|that) bad|only a little|minor)\b|有点|有一点|一点点|稍微|轻微|不太/i;
const SUDDEN = /\bsudden(?:ly)?\b|\ball of a sudden\b|\bjust now\b|\bout of nowhere\b|突然|忽然|一下子|雄雄|\btiba[- ]tiba\b/i;
const GRADUAL = /\b(?:slowly|gradually|over (?:the|a few|several) (?:days|weeks|months))\b|慢慢|逐渐/i;
/** A time earlier today: a symptom said in the past tense with one of these may still be going on. */
const EARLIER_TODAY = /\b(?:this morning|today|earlier|just now|this afternoon|tonight|an hour ago|minutes ago)\b|今天|今早|早上|刚才|刚刚|下午|晚上/i;

/**
 * Words that LOWER a symptom, for evidence.ts (a lowering value must quote words that say it): over (in the past and over: a
 * stroke sign only when it is said to have passed or is long past), mild, came on gradually.
 */
export function saysOver(kind: FrameSymptom["kind"], s: string): boolean {
  return (RESOLVED.test(s) && !NOT_RESOLVED.test(s)) || PAST_LONG.test(s) || (kind !== "stroke" && PAST_RECENT.test(s));
}
export const saysMild = (s: string): boolean => MILD.test(s);
export const saysGradual = (s: string): boolean => GRADUAL.test(s);

const NUM_WORDS: Record<string, number> = { a: 1, an: 1, one: 1, two: 2, three: 3, five: 5, ten: 10, fifteen: 15, twenty: 20, thirty: 30, forty: 40, few: 3, "a few": 3, several: 5 };
const ZH_NUM: Record<string, number> = { 一: 1, 二: 2, 两: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9, 十: 10, 二十: 20, 三十: 30, 四十: 40 };

/** How long, in minutes, when his sentence says ("for 10 minutes", "half an hour", "10 分钟", 半小时). */
function minutesIn(s: string): number | null {
  if (/\bhalf an hour\b|半(?:个)?小时|半个钟/i.test(s)) return 30;
  const en = /\b(\d+(?:\.\d+)?|a few|few|several|an?|one|two|three|five|ten|fifteen|twenty|thirty|forty)\s*(?:more\s+)?(min(?:ute)?s?|hours?|hrs?)\b/i.exec(s);
  if (en) {
    const n = /^\d/.test(en[1]) ? Number(en[1]) : NUM_WORDS[en[1].toLowerCase()];
    if (n !== undefined && Number.isFinite(n)) return Math.round(/^h/i.test(en[2]) ? n * 60 : n);
  }
  const zh = /(\d+|二十|三十|四十|[一二两三四五六七八九十])\s*(?:个)?(分钟|小时|钟头)/.exec(s);
  if (zh) {
    const n = /^\d/.test(zh[1]) ? Number(zh[1]) : ZH_NUM[zh[1]];
    if (n !== undefined) return zh[2] === "分钟" ? n : n * 60;
  }
  return null;
}

/** now / severe / sudden / minutes of one symptom, from its own sentence. */
function timing(kind: Kind, s: string): Pick<FrameSymptom, "now" | "minutes" | "severe" | "sudden"> {
  let now: Tri;
  if (HYPOTHETICAL.test(s) && !NOW_STRONG.test(s)) now = "unclear";
  else if (RESOLVED.test(s) && !NOT_RESOLVED.test(s)) now = "no";
  else if (NOW_STRONG.test(s)) now = "yes";
  else if (PAST_LONG.test(s)) now = "no";
  else if (PAST_RECENT.test(s)) now = kind === "stroke" ? "unclear" : "no";
  else if (PRESENT_PERFECT.test(s)) now = "yes";
  else if (PAST_VERB.test(s)) now = "unclear";
  else if (PRESENT.test(s) && !(EARLIER_TODAY.test(s) && PAST_VERB.test(s))) now = "yes";
  else now = "unclear";
  const severe: Tri = SEVERE.test(s) || (SEVERE_IF_NOW.test(s) && NOW_STRONG.test(s)) ? "yes" : MILD.test(s) ? "no" : "unclear";
  const sudden: Tri = SUDDEN.test(s) ? "yes" : GRADUAL.test(s) ? "no" : "unclear";
  return { now, minutes: now === "no" ? null : minutesIn(s), severe, sudden };
}

/** The symptoms in his message (all its variants), each with its own sentence as evidence. */
function readSymptoms(sources: Source[], original: string): FrameSymptom[] {
  const kinds = new Set<Kind>();
  for (const s of sources) {
    const c = classifyRules(s.text, RULE_CTX);
    // (round 2: a red flag beside a very high reading is a headache only when a headache is said; blurred vision or vomiting is "other")
    if (c?.route === "emergency") for (const sig of c.signals) if (KIND_OF_SIGNAL[sig]) kinds.add(sig === "high_bp_symptom" && !EXTRA_KINDS.find(([k]) => k === "headache")![1].some((re) => re.test(s.text)) ? "other" : KIND_OF_SIGNAL[sig]);
    for (const k of emergencyCue(s.text)) if (KIND_OF_SIGNAL[k]) kinds.add(KIND_OF_SIGNAL[k]);
    // (round 3: breathing trouble that is mild or has passed leaves the rules' route, not the frame: the table asks, or sees now "no")
    if (breathingSaid(s.text)) kinds.add("breathing");
    for (const [kind, res] of EXTRA_KINDS) if (matchAny(res, s.text)) kinds.add(kind);
  }
  // (an allergy is a face or throat swelling: the same words are not also the ankle-swelling kind)
  if (kinds.has("allergy") && kinds.has("swelling") && !/\b(?:ankles?|feet|foot|legs?)\b|脚|腿/i.test(original)) kinds.delete("swelling");
  const out: FrameSymptom[] = [];
  for (const kind of kinds) {
    // its sentence in his words as typed when the anchor is there, else in the variant that named it
    const src = sources.find((s) => ANCHOR[kind].test(s.text)) ?? sources[0];
    const m = ANCHOR[kind].exec(src.text);
    const sentence = m ? sentenceAt(src.text, m.index) : src.text;
    out.push({ kind, ...timing(kind, sentence), evidence: [{ quote: quoteOf(sentence), from: src.from }] });
  }
  return out;
}

// ---------------------------------------------------------------- (e) medicine facts

const LOOKS_DIFFERENT: RegExp[] = [
  /\b(?:look|looks|looking|looked|seem|seems)\s+(?:a\s+bit\s+|quite\s+|very\s+|totally\s+|completely\s+|kind of\s+)?(?:different|strange|new|odd|unusual|weird|not the same)\b/i,
  /\b(?:different|new|another|changed?)\s+(?:colou?r|shape|size|marking|markings|logo|imprint|brand|packaging|print)\b/i,
  /\b(?:colou?r|shape|size|marking|markings|imprint)\s+(?:is|are|has|have|looks?)?\s*(?:different|changed|not the same)\b/i,
  /\b(?:white|pink|blue|yellow|orange|red|green|brown|purple|round|oval|bigger|smaller|larger|longer)\s+instead\s+of\s+(?:white|pink|blue|yellow|orange|red|green|brown|purple|round|oval|small|big)\b/i,
  /\b(?:used to be|last time (?:it was|they were))\s+(?:white|pink|blue|yellow|orange|red|green|round|oval|bigger|smaller)\b/i,
  /\b(?:look|looks|are|is|seem|seems)\s+(?:a\s+bit\s+|much\s+|quite\s+)?(?:smaller|bigger|larger|thinner|thicker|darker|lighter|paler|rounder|longer|shorter)\s+than\s+(?:before|last time|last month|usual|the old ones|they used to|it used to|my old ones)\b/i,
  /比(?:以前|上次|之前|原来|上个月)(?:的)?(?:小|大|厚|薄|深|浅|圆|长|短)/,
  /(?:颜色|样子|形状|大小|外观|包装|刻字|印字|字母)[^，。？！,?!]{0,4}(?:不一样|不同|变了|换了|不对)|(?:跟|和|与)(?:以前|上次|之前|上个月)[^，。？！,?!]{0,6}(?:不一样|不同)|(?:变成|换成)了?(?:白|粉|蓝|黄|红|绿|橙|紫)色/,
];
const SINCE_MEDICINE: RegExp[] = [
  /\b(?:since|after|ever since)\s+(?:i\s+)?(?:started|starting|took|taking|began|changed|switched|switching|changing)\b[^.?!]{0,30}\b(?:pill|pills|tablet|tablets|medicine|medication|meds|dose|one)\b/i,
  /\b(?:since|after)\s+(?:the|my|this)\s+(?:new|changed|other)\s+(?:pill|pills|tablet|tablets|medicine|medication|meds|dose|one)\b/i,
  /\bafter\s+(?:taking|i take|i took)\b/i,
  /(?:自从|从)?(?:吃了|吃|服了|换了|改了|开始吃)[^，。？！,?!]{0,8}(?:药|这个|新药)[^，。？！,?!]{0,2}(?:以后|之后|后|开始)/,
];
const STOP_DONE: RegExp[] = [
  /\b(?:i(?:'ve| have)?|i already|already|i just)\s+(?:stopped|quit|stop(?:ped)? taking|not been taking|been skipping|halved|cut (?:it|them|my \w+) out)\b/i,
  /\b(?:i\s+)?(?:stopped|quit)\s+(?:taking\s+)?(?:my|the|it|them|this|that)\b/i,
  /\b(?:haven'?t|have not|didn'?t|did not)\s+(?:been\s+)?tak(?:en|ing|e)\s+(?:my|the|it|them|any)\b[^.?!]{0,30}\b(?:for|since)\s+(?:\d+|a few|few|several|two|three|a|one|over a)\s+(?:days?|weeks?|months?)\b/i,
  // round 2 (10-16): Malay (Kamus Dewan: berhenti "tidak meneruskan"; dah = sudah): "Saya dah berhenti makan ubat darah tinggi"
  /\b(?:dah|sudah|telah)\s+berhenti\s+(?:makan|ambil|minum)\s+(?:\w+\s+){0,3}?ubat\b|\b(?:dah|sudah|telah)\s+berhenti\s+(?:makan|ambil)\b/i,
  /(?:已经|早就)(?:把(?:药|它))?(?:停|停掉|停了|不吃了|没吃了)|(?:药|它)(?:已经|早就)?(?:停了|停掉了|不吃了)|(?:好几天|几天|一个星期|一周|几个星期|很久)(?:都)?没(?:有)?吃(?:药)?了/,
];
const STOP_SUGGESTED: RegExp[] = [
  /\b(?:son|daughter|wife|husband|friend|friends|neighbou?r|sister|brother|kids?|children|family|grandson|granddaughter|colleague|someone|they|he|she|people|auntie|aunty|uncle|relative|cousin|in-laws?|the internet|facebook|whatsapp|tiktok|youtube|a video|the news|article)\b[^.?!]{0,30}\b(?:says?|said|told me|tells me|keeps? saying|thinks?|wants? me|asked me|suggest\w*|recommend\w*|advis\w*|read|reads|saw|heard|watched|found)\b[^.?!]{0,40}\b(?:stop|quit|skip|cut down|cut back|halve|reduce|lower|change|switch|not (?:to )?take|don'?t take|no need to take|throw away|come off)\b/i,
  /(?:儿子|女儿|老婆|老公|太太|先生|朋友|邻居|孙子|孙女|家人|孩子|亲戚|姐姐|妹妹|哥哥|弟弟|别人|他们|网上|视频|微信|抖音)[^，。？！,?!]{0,8}(?:说|叫|让|劝|要|建议)(?:我)?[^，。？！,?!]{0,8}(?:停|别吃|不要吃|不用吃|少吃|减|换|不吃)/,
];
const STOP_ASKED: RegExp[] = [
  /\b(?:can|could|should|may|must|do)\s+i\s+(?:stop|quit|skip|halve|cut down|reduce|lower|change|switch|come off)\b|\b(?:is it ok(?:ay)?|ok(?:ay)?|safe|fine|alright)\s+(?:to|if i)\s+(?:stop|quit|skip|come off)\b/i,
  /(?:可以|能|能不能|可不可以|要不要|该不该|是不是可以)(?:不吃|停|停药|停掉|少吃|减)|(?:不吃|停药|停掉)(?:可以|行|好)(?:吗|不)/,
];
/** A dose taken twice (the amount "double"). */
/**
 * Round 3: he does not know whether he took it at all ("I don't remember if I took it", 「不记得有没有吃过」, 「唔記得食咗未」): one more
 * is then an amount nobody knows. ("I think I took it twice" says twice: the double stands, the table asks the rest.)
 */
const UNSURE =
  /\b(?:(?:can'?t|don'?t|do not|cannot) remember|forgot|forget|not sure|unsure)\s+(?:if|whether)\b|不记得[^，。？！,?!]{0,6}(?:有没有|是否|吃没吃|吃过没)|不記得[^，。？！,?!]{0,6}(?:有沒有|是否)|忘了[^，。？！,?!]{0,4}(?:有没有|是否)|唔記得[^，。？！,?!]{0,6}(?:食咗未|有冇)|唔记得[^，。？！,?!]{0,6}(?:食咗未|有冇)/i;
/** A medicine as the thing taken: "my pill", "it", "today's dose", "my amlodipine" (never "my blood pressure"). */
const TAKEN_MED = String.raw`(?:(?:(?:my|the|this|that|today'?s|this morning'?s|tonight'?s|his|her)\s+)?(?:[\w'’-]+\s+){0,2}?(?:pills?|tablets?|medicines?|medication|meds|doses?|capsules?|\w+(?:pine|sartan|statin|formin|profen|amol|pril|olol))|it|them)`;
const DOUBLE: RegExp[] = [
  new RegExp(String.raw`\b(?:took|taken|had|ate|swallowed)\s+${TAKEN_MED}\s+(?:\w+\s+)?(?:twice|two times|2 times|again)\b(?!\s+(?:a|per|each|every)\s+(?:day|week)|\s+daily)`, "i"),
  /\b(?:took|taken|had)\b[^.?!]{0,20}\b(?:a double dose|double (?:the |my )?dose|twice the dose|a second dose)\b/i,
  /(?:吃|服)了(?:两|二|2)(?:次|遍|回)|重复(?:吃|服)了|(?:药)(?:吃|服)重了|又(?:吃|服)了(?:一)?(?:次|遍|回)/,
];
const EXTRA_ONE: RegExp[] = [
  /\b(?:took|taken|had|ate|eat|eats|swallowed)\b[^.?!]{0,30}\b(?:an?|one|1)\s+(?:extra|more|additional)\s+(?:[\w'’-]+\s+){0,2}?(?:pills?|tablets?|doses?|capsules?|ones?\b|of (?:my|the|his|her)\b)/i,
  // (round 2: Cantonese 食多咗一粒, words.hk 咗 perfective)
  /多(?:吃|服|食)(?:了|咗)(?:一|1|半)(?:粒|片|颗|顆|次)|(?:吃|服|食)多(?:了|咗)(?:一|1|半)(?:粒|片|颗|顆)/,
];
const EXTRA_MORE: RegExp[] = [
  /\b(?:took|taken|had|ate|eat|eats|swallowed)\b[^.?!]{0,30}\b(?:(?:two|2|three|3|a few|few|several|some)\s+(?:extra|more|additional)\s+(?:[\w'’-]+\s+){0,2}?(?:pills?|tablets?|doses?|capsules?|ones?)|(?:a few|some|several) of (?:my|the|his|her) (?:[\w'’-]+\s+){0,2}?(?:pills?|tablets?|capsules?|meds|medicines?))\b/i,
  // (round 2: 把药吃了好几次, taken again and again)
  /多(?:吃|服|食)(?:了|咗)(?:两|二|2|三|3|几|幾)(?:粒|片|颗|顆)|(?:药|藥)[^，。？！,?!]{0,4}(?:吃|服|食)(?:了|咗)(?:好几|好幾|几|幾)(?:次|遍|回)/,
];
const FAR_BEYOND: RegExp[] = [
  /\b(?:took|taken|had|ate|swallowed)\s+(?:about\s+|around\s+|like\s+|maybe\s+|almost\s+)?(?:(?:[5-9]|[1-9]\d+|five|six|seven|eight|nine|ten|eleven|twelve|fifteen|twenty|thirty|a handful|a bunch|a lot|many|lots)\s+(?:of\s+)?(?:my|the|his|her|these|those)?\s*(?:\w+\s+){0,2}(?:pills|tablets|capsules|meds|ones))\b/i,
  /(?:吃|吞|服)(?:了)?(?:[5-9]|[1-9]\d|五|六|七|八|九|十|二十|三十|一把|一大把|好多|很多)(?:几)?(?:粒|片|颗)/,
];
const ALL_OF_THEM: RegExp[] = [
  /\b(?:took|taken|had|ate|swallowed|finished)\b[^.?!]{0,20}\b(?:all (?:of )?(?:my|the|his|her|them)|the (?:whole|entire)|a (?:whole|entire))\b[^.?!]{0,20}\b(?:pills|tablets|bottle|box|strip|pack|packet|blister|medicines?|meds|week'?s|month'?s)\b/i,
  /\b(?:swallowed|took|ate)\s+(?:a|the)\s+(?:whole|entire)\s+(?:strip|box|bottle|pack|packet|blister)\b/i,
  /(?:吃|吞|服)(?:了|完|光|掉|下)?(?:一)?整(?:瓶|盒|板|包)|(?:所有|全部)(?:的)?药[^，。？！,?!]{0,4}(?:吃|吞)(?:了|掉|光|完)/,
];
const AMOUNT_UNKNOWN: RegExp[] = [/\b(?:took|taken|had|ate|swallowed)\b[^.?!]{0,20}\btoo (?:many|much)\s+(?:of\s+)?(?:(?:my|the|his|her)\s+)?(?:[\w'’-]+\s+)?(?:pills?|tablets?|medicines?|medication|meds|capsules?)\b|\b(?:took|taken)\s+too many\b|\boverdos(?:ed|ing)\b|\b(?:took|taken|swallowed)\s+a\s+lot\s+of\s+(?:my|the|his|her)\b|\b(?:took|taken|had|ate|swallowed)\s+more\b[^.?!]{0,40}\bthan\s+(?:i|you|he|she|we)\s+(?:should(?:\s+have)?|was\s+supposed\s+to|were\s+supposed\s+to|meant\s+to|needed)\b|\bmore\s+than\s+(?:the|my)\s+(?:dose|prescribed|label)\b/i, /(?:药)?吃多了|吃(?:药)?过量|服(?:药)?过量|(?:吃|吞|服|食)(?:了|咗)(?:很多|好多|一大堆|一堆|太多)(?:的)?[^，。？！,?!]{0,4}(?:药|藥)/];

/**
 * A missed dose in his words ("I forgot this morning's pill", "missed my dose", 忘了吃药, 漏吃), or null. The Frame has no
 * field for it (the missed_dose pathway needs one: the report to E2 names it); until then the engine can read this.
 */
const MISSED: RegExp[] = [
  /\b(?:forgot|forget|forgotten|missed|skipped)\b[^.?!]{0,25}\b(?:pill|pills|tablet|tablets|dose|doses|medicine|medication|meds)\b/i,
  /\b(?:forgot|forget|forgotten)\s+to\s+take\b/i,
  /\b(?:didn'?t|did not|haven'?t|have not)\s+take\s+(?:my|the|this morning'?s|today'?s|last night'?s)\b/i,
  /(?:忘了|忘记|漏|没)(?:吃|服)(?:了)?(?:药|今天的药|早上的药|晚上的药|一次)|(?:药)(?:忘了|忘记)(?:吃)|漏(?:吃|服)/,
];
export function missedDoseQuote(text: string): string | null {
  return firstHit(MISSED, normalizedVariants(text).map((v) => ({ text: v, from: "message" })))?.quote ?? null;
}

// ---------------------------------------------------------------- his medicines

/** Medicine kinds by what they are for (KB ids), for "my BP pill", "the cholesterol pill", 降压药. */
const CLASS_WORDS: { re: RegExp; ids: string[] }[] = [
  { re: /\b(?:blood pressure|bp|hypertension|high blood)\s+(?:pills?|tablets?|medicines?|medications?|meds)\b|降压药|血压药/i, ids: ["amlodipine", "losartan"] },
  { re: /\bcholesterol\s+(?:pills?|tablets?|medicines?|medications?|meds)\b|\bstatins?\b|降脂药|降胆固醇(?:的)?药|胆固醇(?:的)?药|血脂药/i, ids: ["atorvastatin"] },
  { re: /\b(?:diabetes|diabetic|sugar|blood sugar)\s+(?:pills?|tablets?|medicines?|medications?|meds)\b|降糖药|糖尿病(?:的)?药|血糖药/i, ids: ["metformin"] },
  { re: /\bpain ?killers?\b|\bpain (?:pills?|tablets?|medicines?)\b|止痛药/i, ids: ["paracetamol", "ibuprofen"] },
  { re: /\bblood thinners?\b|薄血药/i, ids: ["aspirin"] },
];
/** "my pill", "the white ones", "the new pill", 这个药: a medicine of his, which one not said. */
const GENERIC_MED =
  /\b(?:my|the|this|that|these|those|his|her|a|an)\s+(?:[\w'’-]+\s+){0,2}?(?:pills?|tablets?|medicines?|medications?|meds|capsules?|ones)\b|这(?:个|粒|颗|种)?药|那(?:个|粒|颗|种)?药|(?:我的|吃的)药|(?:吃|服)了?(?:这个|那个|新的?)?药|药片|(?:白色|粉色|黄色|蓝色)的|新(?:的)?药|新藥|\bubat\b|மருந்து|மாத்திரை/iu;

const hasHan = (s: string) => /\p{Script=Han}/u.test(s);

/** The KB drug id of one of his medicines (its name, brand or Chinese name), or null. */
function kbIdOf(name: string): string | null {
  return matchDrug(name)?.drugId ?? findDrugMentions(name)[0]?.drugId ?? null;
}

/** His medicines his words name or point at (refs: his ids, "unknown", "unspecified"), with the words. */
function readMedicines(sources: Source[], meds: RulesContext["meds"]): Frame["medicines"] {
  const out = new Map<string, Evidence[]>();
  const add = (ref: string, quote: string, from: string) => {
    const list = out.get(ref) ?? [];
    if (!list.some((e) => e.quote === quote && e.from === from)) list.push({ quote: quoteOf(quote), from });
    out.set(ref, list);
  };
  const his = meds.map((m) => ({ ...m, norm: normalizeName(m.name), kb: kbIdOf(m.name) }));
  for (const s of sources) {
    const lower = s.text.normalize("NFKC").toLowerCase();
    const named = new Set<string>();
    // KB names and aliases (amlodipine, Norvasc, 氨氯地平, Panadol): his when on his list, else a medicine not on it
    for (const m of findDrugMentions(s.text)) {
      const quote = s.text.slice(m.index, m.index + m.alias.length);
      const mine = his.filter((h) => h.kb === m.drugId);
      if (mine.length) for (const h of mine) add(h.id, quote, s.from);
      else add("unknown", quote, s.from);
      named.add(m.alias);
    }
    // his medicines' own names (also names the KB does not know), and a near spelling of a long one
    for (const h of his) {
      if (h.norm.length < 3) continue;
      const i = lower.indexOf(h.norm);
      if (i >= 0 && (hasHan(h.norm) || (!/[a-z0-9]/.test(lower[i - 1] ?? " ") && !/[a-z0-9]/.test(lower[i + h.norm.length] ?? " ")))) {
        add(h.id, s.text.slice(i, i + h.norm.length), s.from);
        continue;
      }
      if (!hasHan(h.norm) && h.norm.length >= 6 && !h.norm.includes(" ")) {
        for (const tok of s.text.match(/[A-Za-z]{5,}/g) ?? []) {
          const t = tok.toLowerCase();
          if (t[0] === h.norm[0] && t !== h.norm && levenshtein(t, h.norm) <= 2) add(h.id, tok, s.from);
        }
      }
    }
    // what it is for: "my BP pills", "the cholesterol pill", 降压药
    for (const c of CLASS_WORDS) {
      const m = c.re.exec(s.text);
      if (!m) continue;
      const mine = his.filter((h) => h.kb && c.ids.includes(h.kb));
      // (round 2, 10-16: one of two BP medicines said as "my BP pill" or 降压药 is one he did not name: unspecified, so which one is
      // asked; 「不小心多吃了一粒降压药」 with amlodipine and losartan on his list read as both, "several medicines", and 995. A
      // plural, "my BP pills", is all of them)
      const plural = /s\b|们|們/i.test(m[0]);
      if (mine.length > 1 && !plural) add("unspecified", m[0], s.from);
      else for (const h of mine) add(h.id, m[0], s.from);
      if (!mine.length) add("unspecified", m[0], s.from);
    }
    // a medicine-like name Ripple does not know (classify.ts unknownDrugName), unless it is one of his
    const unknown = unknownDrugName(s.text);
    if (unknown && !his.some((h) => h.norm && (normalizeName(unknown) === h.norm || levenshtein(normalizeName(unknown), h.norm) <= 2))) {
      add("unknown", unknown, s.from);
    }
  }
  // "my pill", "the white ones": his only medicine, or unspecified
  if (![...out.keys()].some((k) => k !== "unknown")) {
    const generic = firstHit([GENERIC_MED], sources);
    if (generic) add(meds.length === 1 ? meds[0].id : "unspecified", generic.quote, generic.from);
  }
  return [...out.entries()].map(([ref, evidence]) => ({ ref, evidence }));
}

// ---------------------------------------------------------------- who, when, acts

const FIRST_PERSON = /\b(?:i|i'm|im|i've|i'd|i'll|me|my|myself|mine)\b|我(?!(?:的|们|們|哋|家)?(?:爸|妈|媽|老|爷|爺|奶|外|儿|兒|女|孙|孫|阿|先生|太太|丈夫|妻子|哥|姐|弟|妹))/i;
// (round 3: "I don't remember if I took it" asks nothing hypothetical: the if of remember / know / sure / forgot / wonder is not one)
const HYPO_WHEN = /(?<!\b(?:remember|know|sure|forgot|forget|wonder|check|ask)\s)\bif\b|\b(?:what if|suppose|supposing|would|a person|someone|somebody|anyone|people|one can)\b|如果|要是|假如|万一|一个人|有人/i;
const TODAY = /\b(?:today|this morning|tonight|this afternoon|this evening|just now|earlier)\b|今天|今早|今晚|刚才|刚刚|早上|中午|下午|今朝|今日|啱先|啱啱|\btadi\b|\bpagi tadi\b/i;
const PAST_WHEN = /\b(?:yesterday|last (?:night|week|month|year|time)|ago|previously)\b|昨天|昨晚|上次|以前|去年|前天/i;

function whenOf(text: string): Frame["when"] {
  if (HYPO_WHEN.test(text) && !NOW_STRONG.test(text)) return "hypothetical";
  if (/\b(?:now|right now|still|currently|at the moment)\b|现在|还在|正在/i.test(text)) return "now";
  if (TODAY.test(text)) return "today";
  if (PAST_WHEN.test(text) || PAST_OLD.test(text)) return "past";
  return "unclear";
}

// ---------------------------------------------------------------- missing

/** Every fact name `missing` may hold (screen.ts holds the model to the same list). */
export const MISSING_FACTS = ["medicine", "amount", "now", "minutes", "symptoms", "who", "when", "self_harm", "plan", "means", "soon"] as const;

/**
 * What a pathway would still have to ask, from the frame's own fields (mergeFrames and screenRisk recompute it with this):
 *   medicine   an amount, a changed look, stopping or changing, or an event, and no medicine of his named;
 *   amount     more than the label, how much not said;
 *   now        a symptom not known to be happening now or not;
 *   minutes    chest pain not over, how long not said;
 *   symptoms   more than the label, and no symptom said either way;
 *   who        whose it is not said, with an amount or a symptom not over;
 *   when       stopped already or an event, and when not said;
 *   self_harm  the confirm question: ideation unclear, a lethality question, stockpiling;
 *   plan / means / soon  the danger questions, with ideation and the fact unclear.
 */
export function missingFor(f: Frame): string[] {
  const out: string[] = [];
  const specific = f.medicines.some((m) => m.ref !== "unspecified" && m.ref !== "unknown");
  const needsMedicine =
    f.amount.relation !== "none" ||
    f.looksDifferent === "yes" ||
    f.stopOrChange !== "none" ||
    f.acts.includes("event") ||
    f.acts.includes("change_request") ||
    // a symptom next to a medicine he did not name (a side effect: "since I started the new pill")
    (f.symptoms.length > 0 && f.medicines.some((m) => m.ref === "unspecified"));
  if (needsMedicine && !specific) out.push("medicine");
  if (f.amount.relation === "unknown") out.push("amount");
  if (f.symptoms.some((s) => s.now === "unclear")) out.push("now");
  if (f.symptoms.some((s) => s.kind === "chest" && s.now !== "no" && s.minutes === null)) out.push("minutes");
  if (f.amount.relation !== "none" && f.symptoms.length === 0) out.push("symptoms");
  if (f.about === "unclear" && (f.amount.relation !== "none" || f.symptoms.some((s) => s.now !== "no"))) out.push("who");
  if (f.when === "unclear" && (f.stopOrChange === "done" || f.acts.includes("event"))) out.push("when");
  const sh = f.selfHarm;
  if (sh.ideation === "unclear" || sh.lethalityQuestion !== "no" || sh.means !== "no") out.push("self_harm");
  if (sh.ideation === "active" || sh.ideation === "passive") {
    if (sh.plan === "unclear") out.push("plan");
    if (sh.means === "unclear") out.push("means");
    if (sh.soon === "unclear") out.push("soon");
  }
  return [...new Set(out)];
}

// ---------------------------------------------------------------- the frame

const IDEATION_RANK = { none: 0, unclear: 1, passive: 2, active: 3 } as const;
const TRI_RANK = { no: 0, unclear: 1, yes: 2 } as const;
const maxTri = (a: Tri, b: Tri): Tri => (TRI_RANK[a] >= TRI_RANK[b] ? a : b);

/**
 * The Frame the rules alone can fill for his message in its conversation (see the header). ctx.meds: his medicines (id and
 * the name he would use); ctx.turns: his conversation before this message, oldest first (the last 10 are read; only his
 * own turns count as his words, Ripple's never do).
 */
export function rulesFrame(text: string, ctx: RulesContext): Frame {
  const msg: Source[] = normalizedVariants(text).map((v) => ({ text: v, from: "message" }));
  const turns = (ctx.turns ?? []).slice(-10);
  const hisTurns: Source[][] = turns
    .map((t, i) => ({ t, from: `turn:${turns.length - i}` }))
    .filter(({ t }) => t.role === "patient")
    .map(({ t, from }) => normalizedVariants(t.text.slice(0, 400)).map((v) => ({ text: v, from })));
  const everything = [msg, ...hisTurns].flat();
  const deathSaid = everything.some((s) => DEATH.test(s.text));
  // (round 2: a medicine's own name counts too: "The new box of amlodipine has a different shape from before")
  const hisNames = ctx.meds.map((m) => normalizeName(m.name)).filter((n) => n.length >= 3);
  const medContext = everything.some((s) => MED_WORD.test(s.text) || findDrugMentions(s.text).length > 0 || hisNames.some((n) => s.text.toLowerCase().includes(n)));

  // self-harm: his message, then each of his turns (a wish, a lethality question or stockpiling said three turns ago still
  // stands in this conversation; the table must not ask again a confirm question his turns already answer)
  const sh = readSelfHarm(msg, deathSaid, medContext);
  let { ideation, lethality, means, distress, plan, soonYes } = { ideation: sh.ideation, lethality: sh.lethality, means: sh.means, distress: sh.distress, plan: sh.plan, soonYes: sh.soonYes };
  const shEvidence = [...sh.evidence];
  for (const turn of hisTurns) {
    const t = readSelfHarm(turn, deathSaid, medContext);
    if (t.ideation === "none" && t.lethality === "no" && t.means === "no" && !t.distress) continue;
    if (IDEATION_RANK[t.ideation] > IDEATION_RANK[ideation]) ideation = t.ideation;
    lethality = maxTri(lethality, t.lethality);
    means = maxTri(means, t.means);
    distress = distress || t.distress;
    plan = plan || t.plan;
    soonYes = soonYes || t.soonYes;
    for (const e of t.evidence) if (!shEvidence.some((x) => x.quote === e.quote && x.from === e.from)) shEvidence.push(e);
  }
  // a "too many" question next to distress or a wish to die (in this message or his turns) is the lethality question (mt-a1,
  // mt-a2: "How many amlodipine tablets would be too many?" after "I'm so tired of all this lately")
  if (lethality === "unclear" && (ideation !== "none" || distress)) lethality = "yes";
  const anySignal = ideation !== "none" || lethality !== "no" || means !== "no";
  const selfHarm: Frame["selfHarm"] = {
    ideation,
    plan: plan ? "yes" : anySignal ? "unclear" : "no",
    means: maxTri(means, anySignal ? "unclear" : "no"),
    soon: soonYes ? "yes" : anySignal ? "unclear" : "no",
    lethalityQuestion: lethality,
    evidence: anySignal || distress ? shEvidence : [],
  };

  // who: a child who swallowed tablets, another adult, him, or not said (from his words as typed: "other_adult" lowers). Someone
  // else telling him to stop his medicine (「女儿叫我别吃降压药了」) is about him: the other person is only the one who said it
  const cls = classifyRules(text, RULE_CTX);
  const suggestedToHim = !!firstHit(STOP_SUGGESTED, msg) && /\b(?:me|i)\b|我/i.test(text);
  const about: Frame["about"] = cls?.signals.includes("child")
    ? "child"
    : !suggestedToHim && !sh.ownJoin && (aboutSomeoneElse(text) || (sh.thirdPerson && cls?.route === "self_harm") || cls?.signals.includes("third_person"))
      ? "other_adult"
      : FIRST_PERSON.test(text)
        ? "self"
        : "unclear";

  const symptoms = readSymptoms(msg, text);
  // a reading above 180 / 110 next to a symptom: the symptom is today's, the reading its evidence (the number: findReading)
  // (round 2, 10-16: in the 200s, at or above 200 / 120 or said as 两百多 / "two hundred", the symptom beside it is a red flag, so
  // severe; referral B1-05. Between 180 and 200 the owner's 10-14 decision stands: a chest pain or a stroke sign beside a reading
  // above his doctor's line is kept for his doctor, 995 if it gets bad (too-early-995, symptom-signal); the rules' high_bp_symptom
  // still brings 995 for blurred vision, vomiting, confusion or a splitting headache at 180 / 110)
  const reading = findReading(text);
  const veryHigh = VERY_HIGH_READING.exec(text);
  if (reading && (reading.systolic > 180 || (reading.diastolic ?? 0) > 110)) {
    for (const s of symptoms) {
      if (s.now === "unclear") s.now = "yes";
      s.evidence.push({ quote: reading.text, from: "message" });
    }
  }
  if ((reading && (reading.systolic >= 200 || (reading.diastolic ?? 0) >= 120)) || veryHigh) {
    for (const s of symptoms) {
      if (s.now === "unclear") s.now = "yes";
      if (s.now === "yes") s.severe = "yes";
      if (!reading) s.evidence.push({ quote: veryHigh![0], from: "message" });
    }
  }
  // a symptom since a new or changed medicine: the words are the symptom's evidence too
  const since = firstHit(SINCE_MEDICINE, msg);
  if (since) for (const s of symptoms) if (!s.evidence.some((e) => e.quote === since.quote)) s.evidence.push(since);

  const looks = medContext ? firstHit(LOOKS_DIFFERENT, msg) : null;
  const stopDone = firstHit(STOP_DONE, msg);
  const stopSuggested = stopDone ? null : firstHit(STOP_SUGGESTED, msg);
  const question = isQuestion(text) || /[?？]|(?:吗|嗎|呢)\s*$/.test(text);
  const stopAsked =
    stopDone || stopSuggested ? null : (firstHit(STOP_ASKED, msg) ?? (question && msg.some((s) => detectTopics(s.text).includes("stopping")) ? { quote: quoteOf(text), from: "message" } : null));
  const stopOrChange: Frame["stopOrChange"] = stopDone ? "done" : stopSuggested ? "suggested_by_other" : stopAsked ? "asked" : "none";

  // how much: more than the label, as he says it
  let amount: Frame["amount"] = { relation: "none", evidence: [] };
  const amountHits: [Frame["amount"]["relation"], RegExp[]][] = [
    ["all", ALL_OF_THEM],
    ["far_beyond", FAR_BEYOND],
    ["extra_more", EXTRA_MORE],
    ["double", DOUBLE],
    ["extra_one", EXTRA_ONE],
    ["unknown", AMOUNT_UNKNOWN],
  ];
  for (const [relation, res] of amountHits) {
    const hit = firstHit(res, msg);
    if (hit) {
      amount = { relation, evidence: [hit] };
      break;
    }
  }
  if (amount.relation === "none") {
    const extra = msg.map((s) => extraDose(s.text, question)).find(Boolean);
    if (extra === "taken") amount = { relation: "extra_one", evidence: [{ quote: quoteOf(text), from: "message" }] };
  }
  // a whole strip asked about (sh-a3) is "all", in a hypothetical or a question ("I have a whole bottle here" is not an amount
  // taken: MEANS_UNCLEAR reads it)
  if (amount.relation === "none" && (question || HYPO_WHEN.test(text))) {
    const whole = firstHit([/\b(?:a|the)\s+(?:whole|entire)\s+(?:\w+\s+)?(?:strip|box|bottle|pack|packet|blister)\b/i, /整(?:瓶|盒|板|包)/], msg);
    if (whole) amount = { relation: "all", evidence: [whole] };
  }
  // (round 3, 10-16, E2's report: 「我不记得今天有没有吃过药，好像又吃了一次」 is an uncertain extra dose: one more or twice said with "I
  // think", "not sure", 好像, 可能, 不记得 is an amount nobody knows, so how many is asked)
  if ((amount.relation === "extra_one" || amount.relation === "double") && UNSURE.test(text)) amount = { relation: "unknown", evidence: amount.evidence };
  // a child who swallowed some of his tablets: his label says nothing of a child's amount, so how many is the question
  if (about === "child" && amount.relation !== "all" && amount.relation !== "far_beyond") {
    amount = { relation: "unknown", evidence: amount.evidence.length ? amount.evidence : [{ quote: quoteOf(text), from: "message" }] };
  }

  const missed = firstHit(MISSED, msg);
  const medicines = readMedicines(msg, ctx.meds);
  const acts = new Set<Frame["acts"][number]>();
  if (question) acts.add("question");
  if (symptoms.length) acts.add("symptom");
  const hypothetical = whenOf(text) === "hypothetical";
  if ((amount.relation !== "none" && !hypothetical) || missed || stopOrChange === "done" || about === "child") acts.add("event");
  if (stopOrChange === "asked" || (question && msg.some((s) => detectTopics(s.text).includes("dose_change")))) acts.add("change_request");
  if (distress || ideation !== "none") acts.add("emotion");
  if (!acts.size) acts.add("other");

  const frame: Frame = {
    about,
    acts: [...acts],
    medicines,
    amount,
    when: whenOf(text),
    symptoms,
    looksDifferent: looks ? "yes" : "no",
    stopOrChange,
    selfHarm,
    distress: distress ? "yes" : "no",
    missing: [],
  };
  if (looks) {
    // (the look's words are evidence for the medicine it is about, or for an unspecified one)
    const target = frame.medicines[0] ?? { ref: ctx.meds.length === 1 ? ctx.meds[0].id : "unspecified", evidence: [] };
    if (!frame.medicines.length) frame.medicines.push(target);
    if (!target.evidence.some((e) => e.quote === looks.quote)) target.evidence.push(looks);
  }
  for (const hit of [stopDone, stopSuggested, stopAsked, missed]) {
    if (!hit) continue;
    if (!frame.medicines.length) frame.medicines.push({ ref: ctx.meds.length === 1 ? ctx.meds[0].id : "unspecified", evidence: [] });
    const target = frame.medicines[0];
    if (!target.evidence.some((e) => e.quote === hit.quote)) target.evidence.push(hit);
  }
  frame.missing = missingFor(frame);
  return frame;
}
