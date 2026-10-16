/**
 * Keyword topics of a user input (English, Mandarin, Singlish). Used by the rule classifier, by candidate
 * selection and as hints for the generator. Topic names are shared with Candidate.topics.
 *
 * 10-09 (DeepSeek fixer): dose questions the rules used to miss ("can take one more or not", "eat two tablet
 * tonight can?", "should I take another one?", "Doctor said can increase if high right?", "What's the maximum dose
 * of amlodipine per day?", "the dose you recommend"), skipping a dose ("skip tonight boleh?", 今晚不吃可以吗), and
 * requests phrased as an instruction ("Summarise ...", "Explain in your own words ...", 用你自己的话解释 ...),
 * which are questions, not statements to log.
 */

export const TOPIC_PATTERNS: Record<string, RegExp[]> = {
  purpose: [
    /\bwhat(?:'s| is| are)\b.*\bfor\b/i,
    /\bfor what\b/i,
    /\bwhat (?:does|do) (?:it|this|they)\b/i,
    /\bwhat(?:'s| is) (?:this|that|it)\b/i,
    /\bwhat\b[^.?!]{0,40}\bis (?:it |this |that )?for\b/i,
    /做什么|干什么|什么用|是什么药|治什么|用来|有什么用/,
  ],
  why_take: [/\bwhy\b/i, /\bfeel (?:fine|ok|okay|good|well)\b/i, /为什么|为何|感觉很好|没感觉|没什么感觉/],
  food: [
    /\b(?:food|meal|meals|breakfast|lunch|dinner|empty stomach)\b/i,
    /\bbefore or after\b/i,
    /饭前|饭后|空腹|早饭|早餐|吃饭/,
  ],
  side_effects: [/\bside[- ]?effects?\b/i, /副作用|不良反应/],
  missed: [/\bforg[eo]t\b|\bforgotten\b|\bmissed\b|\bmiss (?:a|my|the|his|her)\b/i, /忘了|忘记|漏了|漏吃|没吃到|补吃|補吃/],
  grapefruit: [/\bgrapefruit\b|\bpomelo\b/i, /西柚|葡萄柚|柚子/],
  label: [/\blabel\b|\bthe bag\b|\bhow many\b/i, /药袋|标签|袋子上/],
  stopping: [
    /\bstop(?:ping)?\b|\bquit\b/i,
    /停药|停掉|不吃了|不用吃了|可以停/,
    /\bskip(?:ping)?\b|\b(?:not|don'?t|dont|no need to) take (?:it|my|the|this|tonight|today)\b/i,
    /(?:今晚|今天|明天|早上|晚上|这次)不吃|不吃(?:可以|行|好|要紧)|可以不吃|先不吃|跳过|停一天|停几天/,
    // round 2 (10-09): "Can I pause the amlodipine during Chinese New Year?" (a medicine, not the recording)
    /\b(?:pause|take a break from|hold off(?: on)?)\b[^.?!]{0,25}\b(?:medicines?|medications?|meds|tablets?|pills?|amlodipine|losartan|metformin|atorvastatin|aspirin|ibuprofen|paracetamol|treatment|dose)\b/i,
    /(?:暂停|停)(?:吃)?(?:一下|几天|一阵)?(?:药|降压药|这个药)|过年(?:期间|的时候)?(?:不吃|停)/,
    // wave B (round-3 check problem 5): Malay "berhenti makan amlodipine" (berhenti = stop)
    /\bberhenti\s+(?:makan|ambil|minum|guna)\b/i,
  ],
  combination: [
    /\btogether\b|\bwith (?:my|the|his|her) (?:\w+ ){0,3}(?:pill|pills|medicine|medicines|tablet|tablets|medication)\b/i,
    /\bsafe with\b|\bmix\b/i,
    /一起吃|同时吃|一起服|混着吃/,
    // wave B (round-3 check problem 5): "Can I take panadol with amlodipine?", "Ibuprofen and the BP pill at the same
    // time ok?" (a medicine named on both sides; "at the same time every day" alone is timing, not combining)
    /\b(?:take|taking|took|eat|have|swallow)\b[^.?!]{0,30}\bwith\s+(?:\w+\s+){0,2}(?:amlodipine|losartan|ibuprofen|paracetamol|panadol|aspirin|nurofen|metformin|atorvastatin|\w+(?:pine|sartan|statin|profen|amol))\b/i,
    /\b(?:and|with|plus)\b[^.?!]{0,40}\b(?:at the same time|together)\b/i,
  ],
  target: [
    /\bshould (?:it |the number |my reading )?be\b|\bthe number\b|\btarget\b|\bbelow\b|\bgood\b|\bok(?:ay)?\b.*\breading\b/i,
    /多少算|算好|算高|算低|算正常|应该是多少|目标/,
    // C2 track S (real-status v1: 「总结一下医生说我血压怎么样」 got "I won't guess" for the pharmacist): what the doctor said
    // about his blood pressure is the doctor's own number (R1), quoted with its date
    /\b(?:doctor|dr\.?|doc)\b[^.?!]{0,25}\b(?:said|say|says|told|tell|mentioned)\b[^.?!]{0,30}\b(?:blood pressure|BP|readings?)\b/i,
    /(?:医生|醫生|大夫)[^。？！?.!]{0,6}(?:说|說|讲|講|交代|嘱咐|囑咐)[^。？！?.!]{0,10}(?:血压|血壓|读数|讀數)|(?:血压|血壓)[^。？！?.!]{0,8}(?:医生|醫生|大夫)[^。？！?.!]{0,4}(?:怎么说|怎麼說|说了什么|說了什麼|说什么|說什麼|怎么讲|怎麼講)/,
  ],
  threshold: [/\bA&E\b|\bemergency\b|\bhospital\b|\b995\b/i, /急诊|医院|急救|救护车/],
  readings_summary: [/\breadings?\b.*\b(?:been|week|lately|so far)\b|\bhow have my\b|\baverage\b/i, /这几天的血压|这周|这个星期|平均|最近血压/],
  blood_test: [/\bblood test\b|\bkidney test\b|\btest\b.*\bblood\b/i, /验血|抽血|验肾|检查血/],
  appointment: [/\bappointment\b|\bnext visit\b|\bcome back\b|\bsee (?:the )?doctor again\b/i, /复诊|下次看|下一次看|什么时候再去|预约/],
  refill: [/\brun(?:ning)? out\b|\brefill\b|\bfinish(?:ed)? (?:my|the) (?:pills|tablets|medicine)\b/i, /吃完|快没了|续药|配药/],
  recording: [/\brecording\b|\btranscript\b|\brecorded\b/i, /录音|看诊记录|逐字稿/],
  dose_change: [
    // (fix round 3: "Panadol Extra" and "extra strength" are product names, not an extra dose)
    /(?<!\b(?:panadol|tylenol|excedrin)\s)\bextra\b(?!\s+strength)|\bmore (?:tablet|tablets|pill|pills|medicine)\b|\btwo (?:tablets|pills)\b|\bdouble\b|\bhalf\b|\bcut\b.*\btablet\b/i,
    /\b(?:increase|reduce|lower|raise|change|switch)\b.*\b(?:dose|medicine|tablet|pill|time)\b/i,
    // (fix round 3: "Can I give Dad two of his tablets tonight, his reading is 165?" asked by his daughter)
    /\bgive (?:him|her|dad|daddy|papa|pa|mum|mom|mummy|ma|grandpa|grandma|granny|uncle|auntie|aunty|my (?:dad|father|mum|mom|mother|husband|wife|grandfather|grandmother)) (?:two|2|three|3|another|an extra|one more|extra|double|a double)\b/i,
    /\bstronger\b/i,
    /\b(?:right|correct|exact) dose\b|\bhow (?:much|many) (?:should|can|do) (?:i|he|she) take\b/i,
    // (C2 track S: 补吃 alone, taking a forgotten tablet late, is the missed-dose topic; 补回来 "making it up" and any
    // extra tablet stay a dose change)
    /多吃|少吃|加药|减药|加量|减量|换成|换药|吃两粒|吃两片|补回来|加倍|翻倍|吃几粒|吃几片|掰开|半粒|半片/,
    /\bone more\b|\banother (?:one|tablet|pill|dose)\b|\btake (?:more|another|extra)\b|\btake (?:two|2|three|3)\b(?!\s+(?:different|kinds?|types?|medicines|medications))|\b(?:two|2|three|3) (?:tablet|pill)\b/i,
    /\b(?:can|should|could|may) (?:i |he |she |we )?(?:increase|decrease|reduce|raise|lower)\b|\b(?:increase|raise|lower) (?:it|the dose|my dose|his dose)\b/i,
    /\bmax(?:imum)?\b[^.?!]{0,15}\bdose\b|\bdose\b[^.?!]{0,30}\bmax(?:imum)?\b|\b(?:how much|how many)\b[^.?!]{0,40}\btoo (?:much|many)\b|\btoo (?:much|many) (?:amlodipine|medicine|tablets?|pills?)\b/i,
    /\bdose (?:you|do you|would you) (?:recommend|suggest)\b|\b(?:recommend(?:ed)?|suggest(?:ed)?)\b[^.?!]{0,20}\bdose\b/i,
    /多一粒|再吃一粒|加一粒|再加一粒|最多(?:能)?吃|最大剂量/,
    // round 2 (10-09): "Can I have an additional pill?", "every other day instead?", "... I can cut down?", 药可以加一颗吗
    /\badditional (?:pill|tablet|dose|one)\b|\bevery (?:other|second|alternate) day\b|\balternate days?\b|\bcut (?:down|back)\b|\b(?:less|more) often\b/i,
    /(?:多|加|再)(?:吃|服)?(?:一|两|二|1|2)(?:粒|片|颗)|吃两颗|隔(?:一)?天吃|两天吃一次|少吃点|减少(?:药量|剂量|吃药)/,
    // wave B (round-3 check problem 5): Cantonese 食 = eat ("血压药食两粒得唔得"); "so I can go up to 10?";
    // "the maximum amount of amlodipine per day"
    /食(?:两|兩|二|2|多)(?:粒|片|颗|顆)|食多(?:一)?(?:粒|片|颗|顆)|多食(?:一|两|兩)?(?:粒|片|颗|顆)/,
    /\bgo (?:up|down) to (?:\d+(?:\.\d+)?|one|two|three|four|five|ten)\b(?!\s*(?:am|pm|o'?clock|floor|storey|minutes?|hours?|days?|weeks?))|\bmax(?:imum)?\s+(?:amount|number|dosage|tablets?|pills?|mg)\b/i,
    // fix round 1: "Can I take 10mg instead of 5mg?", "copy my label but with TWO instead of ONE", "take 10 mg"
    /\b\d+(?:\.\d+)?\s*(?:mg|milligrams?)\b[^.?!]{0,25}\binstead\b|\binstead of\s+(?:\d+(?:\.\d+)?\s*(?:mg|milligrams?)|one|1|two|2|half)\b|\b(?:one|two|three|half|1|2|3)\s+(?:tablets?\s+|pills?\s+)?instead of\b|\b(?:take|have|use)\s+\d+(?:\.\d+)?\s*(?:mg|milligrams?)\b/i,
    // Malay (Kamus Dewan via PRPM DBP: biji, penjodoh bilangan "bagi benda kecil"; makan ubat): "boleh makan 2 biji
    // amlodipine hari ni?", "tambah sebiji lagi"
    /\b(?:makan|ambil|telan|minum)\s+(?:\d+|dua|tiga|empat|lebih|lagi|setengah|separuh)\s*(?:biji|tablet|pil)\b|\b(?:sebiji|satu biji|dua biji)\s+lagi\b|\btambah\s+(?:\d+\s*|satu\s+|sebiji\s*|dua\s+)?(?:biji|tablet|pil|dos|ubat)\b|\b(?:lebih|tambah)\s+dos\b/i,
    // fix round 2 (the B2 red team's routing gaps): how often or when he takes it is the prescription too ("Can I take
    // losartan twice a day?", "Can I take my amlodipine at night instead of the morning?"), and 减半 is half a dose
    // ("我可以把降压药减半吗？", as "Can I cut my losartan in half?" already was)
    // (taking it, not measuring: "measure twice a day" is the doctor's own instruction for readings)
    /\b(?:take|taking|took|have|eat|swallow)\b[^.?!]{0,30}\b(?:twice|two times|2 times|2x|three times|thrice|3 times|3x)\s+(?:a|per|each|every)\s+day\b|\b(?:take|taking|have|eat|swallow)\b[^.?!]{0,30}\b(?:twice|three times)\s+daily\b/i,
    /\b(?:take|taking|have|eat|swallow)\b[^.?!]{0,40}\b(?:at|in the|by)\s+(?:night|evening|bedtime|morning|afternoon)\s+instead\b|\b(?:take|taking|have|eat|swallow)\b[^.?!]{0,40}\binstead of\s+(?:in\s+)?(?:the\s+)?(?:morning|night|evening|afternoon|bedtime)\b/i,
    /减半|減半|(?:吃|服)半(?:粒|片|颗|顆)|改(?:到|成|在)(?:晚上|早上|睡前|下午)(?:吃|服)|一天(?:吃|服)(?:两|兩|三|2|3)次/,
    // fix round 3: "Write the label instruction again but change ONE to TWO"
    /\bchange\s+(?:the\s+)?(?:one|1|two|2|half|once)\s+(?:tablet\s+|tablets\s+)?(?:to|into|for)\s+(?:one|1|two|2|three|3|half|twice)\b/i,
    // "How many ibuprofen can I take for my knee tonight?" (a medicine named between "how many" and "can I take")
    // (not "How many tablets do I take per day?": that asks what the label says)
    /\bhow (?:much|many)\b[^.?!]{0,30}\b(?:can|should|may|could) (?:i|he|she|we) (?:take|have|eat|swallow)\b/i,
  ],
};

/** Words for going without food, the same for a blood test (验血要空腹吗？) as for taking a tablet on an empty stomach. */
const FASTING_WORDS = /空腹|禁食|\bempty stomach\b|\bfast(?:ing)?\b/gi;

export function detectTopics(text: string): string[] {
  const out: string[] = [];
  for (const [topic, res] of Object.entries(TOPIC_PATTERNS)) if (res.some((re) => re.test(text))) out.push(topic);
  // gap 3.9 (10-10): a question about a blood test whose only food words are fasting words (「验血要空腹吗？」, "empty
  // stomach for the blood test?") is about the test, not about taking a tablet with or without food. As food, it got the
  // leaflets' "with a meal or on an empty stomach" lines (about the tablets) instead of Dr Lim's answer about the test.
  // One that also names or points at a medicine keeps the food topic (「验血那天药要空腹吃吗？」).
  if (out.includes("blood_test") && out.includes("food") && !refersToMedicine(text)) {
    const rest = text.replace(FASTING_WORDS, " ");
    if (!TOPIC_PATTERNS.food.some((re) => re.test(rest))) out.splice(out.indexOf("food"), 1);
  }
  return out;
}

/** A blood-pressure reading typed in the input ("150/95", "185/110", 血压 150). */
export interface TypedReading {
  systolic: number;
  diastolic: number | null;
  text: string;
}

export function findReading(text: string): TypedReading | null {
  const pair = /(\d{2,3})\s*(?:\/|over|\\)\s*(\d{2,3})/i.exec(text);
  if (pair) return { systolic: Number(pair[1]), diastolic: Number(pair[2]), text: pair[0] };
  const single = /(?:血压|reading|pressure|BP)\D{0,6}(\d{2,3})/i.exec(text);
  if (single) return { systolic: Number(single[1]), diastolic: null, text: single[0] };
  return null;
}

/** The input refers to "his medicine" without naming it ("this one", 这个白色的小药, the blood pressure pill). */
export function refersToMedicine(text: string): boolean {
  return (
    /\b(?:pill|pills|tablet|tablets|medicine|medication|meds|this one|the new one|it)\b/i.test(text) ||
    /药|这个|那个|这粒|那粒/.test(text)
  );
}

/** Words that point at the self-bought painkiller in Mr Tan's story. */
export function mentionsPainkiller(text: string): boolean {
  return /\bpain ?killers?\b|\bknee\b/i.test(text) || /止痛药|膝盖/.test(text);
}

/** Words that point at the blood-pressure medicine. */
export function mentionsBpMedicine(text: string): boolean {
  // fix round 1: plurals too ("my BP pills", "blood pressure tablets"); 降血压的 (v2: the relative's box "也是降血压的")
  // is not his BP medicine
  return /\bblood pressure (?:pills?|medicines?|tablets?|medications?|meds)\b|\bBP (?:pills?|medicines?|tablets?|meds)\b/i.test(text) || /降压药|血压药|降壓藥|血壓藥/.test(text);
}

/** A request phrased as an instruction ("Summarise ...", "Tell me ...", 用你自己的话解释 ...). */
export function isRequest(text: string): boolean {
  return (
    /^\s*(?:please\s+|pls\s+|can you\s+|could you\s+)?(?:explain|summari[sz]e|describe|tell|rephrase|repeat|list|show|give|translate|define|clarify|answer|confirm|compare|rewrite|simplify|paraphrase|copy|quote|read)\b/i.test(text) ||
    /\b(?:tell me|in your own words|let me know)\b/i.test(text) ||
    /^\s*(?:请|麻烦你?|帮我)?(?:解释|说说|讲讲|讲一下|说一下|告诉我|总结|概括|翻译|介绍)|用你自己的话|告诉我|帮我(?:解释|看看|总结|说说|查)/.test(text) ||
    // fix round 3 (the B2 red team: these were saved as notes): 「用简单的话解释一下单张说的副作用」, "Write the label instruction
    // again but change ONE to TWO"
    /用(?:简单|簡單|浅白|淺白|白话|白話|简单点|簡單點)的?(?:话|話|方式)|(?:解释|解釋|说明|說明|讲解|講解)一下/.test(text) ||
    /^\s*(?:please\s+)?(?:write|print|type|change|edit|make)\b[^.?!]{0,60}\b(?:again|instead|to say|so it says)\b/i.test(text)
  );
}

/** A question (as opposed to a statement for the log); a request phrased as an instruction counts. */
export function isQuestion(text: string): boolean {
  return (
    /[?？]/.test(text) ||
    /^\s*(?:what|why|how|when|where|which|who|can|could|should|shall|is|are|do|does|did|will|may|must)\b/i.test(text) ||
    /\b(?:or not|can or not|ah\?|leh\?)\b/i.test(text) ||
    /吗|呢|怎么|什么|为什么|能不能|可不可以|要不要|是不是|多少|几/.test(text) ||
    // Cantonese question forms (wave B: "血压药食两粒得唔得" has no question mark)
    /得唔得|可唔可以|使唔使|係咪|系咪|好唔好|啱唔啱|點樣|点样|乜嘢|咩/.test(text) ||
    isRequest(text)
  );
}

/**
 * C2: the finer side of a topic that two questions must share to be the same question (a dose question that goes the same
 * way, a side effect with the same symptom, a blood-test question about the same thing): "can I take an extra tablet?" is
 * not answered by what the doctor said about halving it, nor "my ankles swell" by what he said about dizziness.
 */
const FACETS: Record<string, Record<string, RegExp>> = {
  dose_change: {
    more: /\bextra\b|\bmore\b|\banother\b|\bdouble\b|\btwo\b|\bincrease\b|\braise\b|\bstronger\b|\badditional\b|多吃|多一|加一|再吃|两粒|兩粒|两片|兩片|两颗|翻倍|加倍|补回来|補回來/i,
    less: /\bhalf\b|\bcut\b|\breduce\b|\blower\b|\bless\b|\bdecrease\b|\bskip\b|减|減|半粒|半片|一半|少吃|不吃/i,
    timing: /\bnight\b|\bevening\b|\bbedtime\b|\binstead\b|\btwice\b|\bthree times\b|晚上|睡前|改到|改成|改在|一天两次|一天兩次|一天三次/i,
  },
  side_effects: {
    swelling: /swell|swollen|肿|腫/i,
    dizzy: /dizz|giddy|晕|暈/i,
    headache: /headache|头痛|頭痛|头疼|頭疼/i,
    rash: /rash|itch|疹|痒|癢/i,
    cough: /cough|咳/i,
    flushing: /flush|脸红|臉紅|发热|發熱/i,
  },
  blood_test: {
    fasting: /\bfast(?:ing)?\b|empty stomach|空腹|禁食/i,
    when: /\bwhen\b|什么时候|什麼時候|几时|幾時|哪天/i,
  },
};

/** The facets of `topic` that a text names (FACETS), e.g. side_effects of 「脚踝肿」: ["swelling"]. */
export function facetsOf(topic: string, text: string): string[] {
  const facets = FACETS[topic];
  return facets ? Object.entries(facets).filter(([, re]) => re.test(text)).map(([k]) => k) : [];
}

/** Two texts share the facet of `topic` (see FACETS); a topic without facets, or two texts with none, always do. */
export function sameFacet(topic: string, a: string, b: string): boolean {
  if (!FACETS[topic]) return true;
  const fa = facetsOf(topic, a);
  const fb = facetsOf(topic, b);
  if (fa.length === 0 && fb.length === 0) return true;
  return fa.some((f) => fb.includes(f));
}
