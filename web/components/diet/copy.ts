/**
 * The words of the diet screens that are Ripple's own interface (design group 13; web/progress/fe-1113.md): the header,
 * the section titles, the labels and the buttons of /p/diet, of 「我常吃的」 and of Today's daily question. Nothing here
 * is a sentence about food: those are the doctor's own words, the knowledge base's lines (kb/diet.json, each with its
 * page), the leaflet's line, the back end's fixed question and its fixed referral (lib/diet), drawn as they come.
 *
 * A plain module (no "use client"): the server page reads it for the header, the client screens for the rest.
 */
import type { Locale } from "@/lib/i18n";

export interface DietWords {
  title: string;
  doctor: string;
  /** the doctor's section while his record holds no line of the doctor's about food */
  noDoctor: string;
  week: string;
  official: (name: string) => string;
  says: (publisher: string) => string;
  page: (s: { title: string; pageDate: string | null }, reviewed: string) => string;
  open: string;
  /** a condition the knowledge base holds no line for */
  noLines: string;
  noCondition: string;
  /** the section of the leaflet's line about grapefruit */
  grapefruit: string;
  /** the leaflet's head line: the word for the source, then (in grey) its title and the date its page says it was reviewed */
  leaflet: string;
  leafletTitle: (title: string) => string;
  leafletDate: (date: string) => string;
  /** the button on the diet screen that opens his own dishes, and that screen's title and grey line */
  foodsOpen: string;
  foods: string;
  foodsHint: string;
  pickedNone: string;
  failed: string;
  /** the button under the referral: the way to add a question for his doctor in his own words */
  askDoctor: string;
  /* the daily question */
  /** Today's entry: what it is */
  label: string;
  /** the same entry on the diet screen's own line */
  daily: string;
  /** where the question is taken from: the doctor's line, its date and its time point in the recording */
  from: (date: string, at: string) => string;
  noted: (answer: string) => string;
  change: string;
  see: string;
}

export const DIET_WORDS: Record<Locale, DietWords> = {
  "zh-Hans": {
    title: "饮食",
    doctor: "医生说的饮食的话",
    noDoctor: "就诊记录里还没有医生说的饮食的话。",
    week: "这一周的饮食核对",
    official: (name) => `官方的饮食条目：${name}`,
    says: (p) => `${p}写着`,
    page: (s, r) => `${s.title}${s.pageDate ? ` · 页面日期 ${s.pageDate}` : ""} · ${r} 核对`,
    open: "看官方原文",
    noLines: "资料库里这一项还没有条目。",
    noCondition: "你的资料和就诊记录里还没有高血压、糖尿病或高胆固醇，所以这里先不列这几种病的饮食条目。",
    grapefruit: "西柚",
    leaflet: "单张",
    leafletTitle: (t) => `：${t}`,
    leafletDate: (d) => `页面写着 ${d} 审阅`,
    foodsOpen: "我常吃的小贩中心食物",
    foods: "我常吃的",
    foodsHint: "点你常吃的，下面会列出官方写的吃法。",
    pickedNone: "官方页面没有专门写这一样。",
    failed: "未能记录，再点一次。",
    askDoctor: "问医生",
    label: "饮食 · 每天一问",
    daily: "每天一问",
    from: (date, at) => `取自医生的话 · ${date} · ${at}`,
    noted: (a) => `已记录：${a}`,
    change: "改一下",
    see: "看饮食",
  },
  en: {
    title: "Food",
    doctor: "Your doctor's words about food",
    noDoctor: "Your visit records hold no words of your doctor's about food yet.",
    week: "This week's food check",
    official: (name) => `Official food lines: ${name}`,
    says: (p) => `${p} says`,
    page: (s, r) => `${s.title}${s.pageDate ? ` · page dated ${s.pageDate}` : ""} · checked ${r}`,
    open: "Open the official page",
    noLines: "The knowledge base holds no line for this one yet.",
    noCondition: "Your profile and visits record no high blood pressure, diabetes or high cholesterol, so the lines for those are not listed.",
    grapefruit: "Grapefruit",
    leaflet: "Leaflet",
    leafletTitle: (t) => `: ${t}`,
    leafletDate: (d) => `reviewed ${d}`,
    foodsOpen: "The hawker food I often eat",
    foods: "What I often eat",
    foodsHint: "Tap what you often eat; the official lines for it show below.",
    pickedNone: "The official pages say nothing about this one in particular.",
    failed: "Not saved. Tap again.",
    // (the foundation's English for 「问医生」 is "For the doctor", the name of a side of the question list: not a button's words)
    askDoctor: "Ask the doctor",
    label: "Food · today's question",
    daily: "Today's question",
    from: (date, at) => `from your doctor's words · ${date} · ${at}`,
    noted: (a) => `Noted: ${a}`,
    change: "Change",
    see: "See food",
  },
};
