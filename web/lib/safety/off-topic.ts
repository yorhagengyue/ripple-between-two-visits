/**
 * Chit-chat Ripple has nothing for (C2 track S; routed from track K, whose chat met 「今天天气怎么样？」 going to the model and
 * adding a question for his doctor): the weather, the lottery, the news, a match, the markets, a joke, a song or a story.
 * classify.ts classifyRules sends such a question or request to the cant_help route (templates.ts cant_help:
 * 「这个我帮不上，要我记下来吗？」) with no model call and no question, and only when nothing else in it is Ripple's: no topic,
 * typed reading, medicine, symptom or crisis word (classifyRules checks those). A statement about the weather
 * (「今天好热」) stays a note.
 *
 * Small and literal on purpose: a subject word, asked about (the weather, the lottery, the news, sports and the markets
 * need a question; entertainment is a request in itself), and nothing that touches his care or how he feels
 * (CARE_OR_FEELING: medicine, the clinic, his body, food and drink, exercise, sleep, mood). Anything not listed goes the
 * usual way, so a miss costs at most a question on his list, never a crisis: every crisis rule runs before this one.
 */
export type OffTopicSubject = "weather" | "lottery" | "news" | "sports" | "markets" | "entertainment";

/** Subjects that are chit-chat when asked about (classify.ts isQuestion). */
const ASKED: [OffTopicSubject, RegExp][] = [
  ["weather", /天气|天氣|下雨|下雪|落雨|台风|颱風|气温|氣溫|雷雨|烟霾|煙霾|\bweather\b|\bforecasts?\b|\brain(?:s|ing|y)?\b|\bhaze\b|\bthunderstorms?\b|\bcuaca\b|\bhujan\b/i],
  ["lottery", /彩票|万字|萬字|多多彩|开彩|開彩|开奖|開獎|中奖|中獎|\b4d\b|\btoto\b|\blotter(?:y|ies)\b|\bjackpot\b|\bloteri\b/i],
  ["news", /新闻|新聞|头条|頭條|时事|時事|\bnews\b|\bheadlines?\b|\bberita\b/i],
  [
    "sports",
    /足球|篮球|籃球|羽毛球|乒乓|网球|網球|世界杯|世界盃|英超|球赛|球賽|赛马|賽馬|奥运|奧運|谁赢|誰贏|\bfootball\b|\bsoccer\b|\bbasketball\b|\bbadminton\b|\bworld cup\b|\bpremier league\b|\bwho won\b|\bhorse rac(?:e|es|ing)\b|\bbola sepak\b/i,
  ],
  ["markets", /股票|股市|股价|股價|汇率|匯率|金价|金價|\bstocks?\b|\bstock market\b|\bshare prices?\b|\bexchange rates?\b|\bgold price\b|\bbitcoin\b/i],
];

/**
 * Entertainment asked for: a request in itself (「讲个笑话」, 「你会唱歌吗」, "tell me a joke"), no question mark needed. Asked
 * of Ripple only (at the start, or after 给我 / 你 / 能不能 ...): 「孙子讲笑话很好笑」 and 「我今天去唱歌了」 stay notes.
 */
const ENTERTAINMENT =
  /(?:^|给我|給我|帮我|幫我|请|請|你|能不能|可不可以|可以|会不会|會不會|会|會)\s*(?:[讲講说說](?:个|個|一个|一個|几个|幾個)?(?:笑话|笑話|故事)|唱(?:首|一首|个|個)?歌|放(?:首|一首)歌|猜谜|猜謎)|\btell me (?:a |another )?(?:joke|story|riddle)\b|\bsing (?:me )?(?:a )?song\b|\bplay (?:me )?(?:a song|some music)\b/i;

/** A-not-A questions isQuestion does not list (「会不会下雨」, 「有没有新闻」). */
const A_NOT_A = /会不会|會不會|有没有|有沒有|好不好|热不热|熱不熱|冷不冷/;

/** Anything about his care or how he feels: then it is not chit-chat, whatever else it mentions. */
const CARE_OR_FEELING = new RegExp(
  [
    // his medicine, the people and places of his care, his body (refersToMedicine's own words; its pronouns, "it" and
    // 「这个」, are read as the medicine only in a medicine question: 「明天会下雨吗」 and "Will it rain?" are not)
    "药|藥|这粒|那粒|医生|醫生|药剂师|藥劑師|护士|護士|诊所|診所|医院|醫院|看诊|看診|复诊|複診|检查|檢查|报告|報告|血压|血壓|血糖|身体|身體|健康|病",
    // food and drink, exercise, sleep (the diet and routine screens', or a question for his doctor)
    "吃|喝|饮食|飲食|运动|運動|走路|散步|睡",
    // how he feels
    "心情|难过|難過|伤心|傷心|孤单|孤單|孤独|孤獨|寂寞|烦|煩|担心|擔心|害怕|怕|哭|累",
    "\\b(?:pills?|tablets?|medicines?|medications?|meds|doctor|pharmacist|nurse|clinic|hospital|visit|appointment|tests?|reports?|blood|bp|sugar|health|body)\\b",
    "\\b(?:eat|eating|drink|drinking|food|diet|exercise|walk|walking|sleep|sleeping)\\b",
    "\\b(?:lonely|alone|sad|upset|worried|worry|scared|afraid|tired|cry|crying)\\b|\\bdepress",
  ].join("|"),
  "i",
);

/**
 * The chit-chat subject of a question or request, or null (see the header). `question`: the words are asked (classify.ts
 * isQuestion); entertainment needs no question form.
 */
export function offTopic(text: string, question: boolean): OffTopicSubject | null {
  if (CARE_OR_FEELING.test(text)) return null;
  if (ENTERTAINMENT.test(text)) return "entertainment";
  // (an A-not-A question with no question mark counts here too: 「明天会不会下雨」)
  if (!question && !A_NOT_A.test(text)) return null;
  for (const [subject, re] of ASKED) if (re.test(text)) return subject;
  return null;
}
