/**
 * The prevention lines (journey 11; M10; 老人端提示词 11.2), from web/kb/screening.json (table C: Healthier SG Screening and
 * the National Adult Immunisation Schedule, NAIS 2026-04-01). Client-safe, pure.
 *
 * The kb's own rule: "Patient-facing text is our paraphrase with a citation; never copy HealthHub/HPB/MOH sentences."
 * So every line here is our own words of what the table says, with the table it is from, its version and the official
 * page. Each line says what the TABLE lists ("表上写着……"), never what he must do: no 你需要 / 你应该 / 你该 / 你符合 /
 * you need / you are due / you are eligible (tests/unit/prevent/prevent.test.ts scans every string). Whether a line
 * suits him and whether he gets a subsidy is his doctor's to say (the NAIS caveat, C2-12, at the foot of the screen).
 *
 * Which lines are shown follows the table's "who" column with what is recorded about him (lib/prevent/conditions.ts):
 * his age and the conditions he or his doctor recorded. Lines only for women (cervical and breast screening, Tdap,
 * HPV2) are not listed: his profile has no field for it, and nothing is guessed. Hepatitis B, MMR and varicella
 * ("no evidence of immunity") are for his doctor to judge and are not listed either.
 *
 * Cardiovascular risk screening (C1-02) is only for adults never diagnosed with high blood pressure, diabetes or high
 * cholesterol; once one of them is recorded, the line switches to the table's C1-03: already diagnosed, followed by the
 * family doctor (M10 step 4).
 */
import type { Locale } from "@/lib/i18n";
import type { ConditionId } from "./conditions";

export interface PreventSource {
  name: Record<Locale, string>;
  /** the official page (as listed in kb/screening.json) */
  url: string;
  /** the version or the date the kb checked it */
  version: Record<Locale, string>;
}

export interface Person {
  age: number | null;
  conditions: ReadonlySet<ConditionId>;
}

export interface PreventItem {
  /** the kb row (kb/screening.json id) */
  id: string;
  kind: "vaccine" | "screening";
  title: Record<Locale, string>;
  /** what the table lists, our words */
  table: Record<Locale, string>;
  /** the table's "who" column against what is recorded about him */
  applies: (p: Person) => boolean;
  /** a 「我做过了」 counts this many days (then the line comes back); null: once */
  everyDays: number | null;
  source: PreventSource;
  /** 「加进问题单」: the question for his doctor, in his voice */
  question: Record<Locale, string>;
}

const NAIS: PreventSource = {
  name: { "zh-Hans": "国家成人免疫计划表", en: "National Adult Immunisation Schedule" },
  url: "https://isomer-user-content.by.gov.sg/18/94b2ad6d-6ff8-4ae8-a945-d77326d83e3f/NAIS_1%20Apr%202026.pdf",
  version: { "zh-Hans": "2026年4月1日版", en: "version of 1 Apr 2026" },
};

const HSG: PreventSource = {
  name: { "zh-Hans": "Healthier SG 筛查（HealthHub）", en: "Healthier SG Screening (HealthHub)" },
  url: "https://www.healthhub.sg/programmes/healthiersg-screening",
  version: { "zh-Hans": "资料库 2026年10月1日核对", en: "checked 1 Oct 2026" },
};

const atLeast = (n: number) => (p: Person) => p.age !== null && p.age >= n;
const any = (p: Person, ids: ConditionId[]) => ids.some((id) => p.conditions.has(id));

/** Diagnosed with one of these, cardiovascular risk screening is no longer the table's line for him (C1-03). */
export const CARDIO_DIAGNOSES: readonly ConditionId[] = ["hypertension", "diabetes", "high_cholesterol"];

export const CARDIO: PreventItem = {
  id: "C1-02",
  kind: "screening",
  title: { "zh-Hans": "心血管风险筛查", en: "Cardiovascular risk screening" },
  table: {
    "zh-Hans": "Healthier SG 筛查表上写着：40 岁以上、从没被诊断出高血压、糖尿病或高胆固醇的成年人做这项筛查，量体重和腰围、血压、血糖、胆固醇，一般 3 年一次。",
    en: "The Healthier SG Screening table lists it for adults 40 and over never diagnosed with high blood pressure, diabetes or high cholesterol: weight and waist, blood pressure, blood sugar and cholesterol, usually every 3 years.",
  },
  applies: (p) => atLeast(40)(p) && !any(p, [...CARDIO_DIAGNOSES]),
  everyDays: 3 * 365,
  source: HSG,
  question: { "zh-Hans": "心血管风险筛查适合我吗？", en: "Is the cardiovascular risk screening right for me?" },
};

/** C1-03: the cardiovascular line once he is diagnosed. */
export const CARDIO_FOLLOWED = {
  id: "C1-03",
  status: { "zh-Hans": "由你的医生跟进", en: "Followed by your doctor" },
  table: {
    "zh-Hans": "表上写着：已经诊断有高血压、糖尿病或高胆固醇的人不做这项筛查，由家庭医生定期看诊、验血跟进。",
    en: "The table says people already diagnosed with high blood pressure, diabetes or high cholesterol don't take this screening; their family doctor follows them with regular visits and tests.",
  },
  source: {
    name: { "zh-Hans": "Healthier SG 筛查（HealthHub）、国家筛查委员会报告", en: "Healthier SG Screening (HealthHub), national screening committee report" },
    url: "https://isomer-user-content.by.gov.sg/3/15ed4753-8da1-4550-b237-fdabf2b54206/STRC%202026_Volume%201_Feb2026.pdf",
    version: { "zh-Hans": "2026年2月", en: "Feb 2026" },
  } satisfies PreventSource,
} as const;

/** The lines in the order the screen lists them (after the doctor's own words). */
export const PREVENT_ITEMS: readonly PreventItem[] = [
  {
    id: "C2-03",
    kind: "vaccine",
    title: { "zh-Hans": "流感疫苗", en: "Influenza (flu) vaccine" },
    table: {
      "zh-Hans": "国家成人免疫计划表上写着：65 岁以上的成年人，以及有糖尿病、慢性心肺肾病等长期病的成年人，每年（或每个流感季）打一剂。",
      en: "The National Adult Immunisation Schedule lists one dose every year (or every flu season) for adults 65 and over, and for adults with long-term conditions such as diabetes or chronic heart, lung or kidney disease.",
    },
    applies: (p) => atLeast(65)(p) || (p.age !== null && p.age >= 18 && any(p, ["diabetes", "heart_disease", "kidney_disease", "lung_disease"])),
    everyDays: 365,
    source: NAIS,
    question: { "zh-Hans": "今年的流感疫苗适合我打吗？", en: "Is this year's flu vaccine right for me?" },
  },
  {
    id: "C2-04",
    kind: "vaccine",
    title: { "zh-Hans": "肺炎球菌疫苗（PCV20）", en: "Pneumococcal vaccine (PCV20)" },
    table: {
      "zh-Hans": "国家成人免疫计划表上写着：65 岁以上的成年人打一剂；有慢性心、肺、肝病，糖尿病或慢性肾病的成年人也在表上。",
      en: "The schedule lists one dose for adults 65 and over; adults with chronic heart, lung or liver disease, diabetes or chronic kidney disease are listed too.",
    },
    applies: (p) => atLeast(65)(p) || (p.age !== null && p.age >= 18 && any(p, ["diabetes", "heart_disease", "kidney_disease", "lung_disease"])),
    everyDays: null,
    source: NAIS,
    question: { "zh-Hans": "肺炎球菌疫苗（PCV20）适合我打吗？", en: "Is the pneumococcal vaccine (PCV20) right for me?" },
  },
  {
    id: "C2-06",
    kind: "vaccine",
    title: { "zh-Hans": "带状疱疹疫苗（Shingrix）", en: "Shingles vaccine (Shingrix)" },
    table: {
      "zh-Hans": "国家成人免疫计划表上写着：60 岁以上的成年人打两剂，相隔 2 到 6 个月。",
      en: "The schedule lists two doses, 2 to 6 months apart, for adults 60 and over.",
    },
    applies: atLeast(60),
    everyDays: null,
    source: NAIS,
    question: { "zh-Hans": "带状疱疹疫苗适合我打吗？", en: "Is the shingles vaccine right for me?" },
  },
  {
    id: "C1-06",
    kind: "screening",
    title: { "zh-Hans": "大肠癌筛查（FIT 粪便检测）", en: "Colorectal cancer screening (FIT stool test)" },
    table: {
      "zh-Hans": "Healthier SG 筛查表上写着：50 岁以上、过去一年没做过的人，每年做一次，在家自己取样。",
      en: "The Healthier SG Screening table lists it for adults 50 and over who have not done one in the past year: once a year, the sample taken at home.",
    },
    applies: atLeast(50),
    everyDays: 365,
    source: HSG,
    question: { "zh-Hans": "大肠癌筛查（FIT）适合我做吗？", en: "Is the colorectal cancer screening (FIT) right for me?" },
  },
  CARDIO,
  {
    id: "C1-08",
    kind: "screening",
    title: { "zh-Hans": "乐龄功能检查（视力、听力、口腔）", en: "Project Silver Screen (vision, hearing, oral health)" },
    table: {
      "zh-Hans": "HealthHub 写着：60 岁以上的公民和永久居民，过去 12 个月没查过的，可以做这项检查。",
      en: "HealthHub lists it for citizens and permanent residents 60 and over who were not screened in the past 12 months.",
    },
    applies: atLeast(60),
    everyDays: 365,
    source: {
      name: { "zh-Hans": "Project Silver Screen（HealthHub）", en: "Project Silver Screen (HealthHub)" },
      url: "https://www.healthhub.sg/well-being-and-lifestyle/active-ageing/project-silver-screen",
      version: { "zh-Hans": "2026年9月8日", en: "8 Sep 2026" },
    },
    question: { "zh-Hans": "乐龄功能检查（视力、听力、口腔）我可以去做吗？", en: "Can I go for Project Silver Screen (vision, hearing, oral health)?" },
  },
  {
    id: "C1-04",
    kind: "screening",
    title: { "zh-Hans": "糖尿病风险自我评估（网上）", en: "Diabetes Risk Assessment (online)" },
    table: {
      "zh-Hans": "HealthHub 写着：18 到 39 岁的成年人在网上自己做；风险低的，每 2 年再做一次。",
      en: "HealthHub lists it for adults 18 to 39, done online; at lower risk, again every 2 years.",
    },
    applies: (p) => p.age !== null && p.age >= 18 && p.age <= 39,
    everyDays: 2 * 365,
    source: {
      name: { "zh-Hans": "Healthier SG 筛查问答（HealthHub）", en: "Healthier SG Screening FAQ (HealthHub)" },
      url: "https://www.healthhub.sg/programmes/healthiersg-screening/screening-faq",
      version: HSG.version,
    },
    question: { "zh-Hans": "糖尿病风险自我评估要怎么做？", en: "How do I do the Diabetes Risk Assessment?" },
  },
];

/** C2-12, the foot of the screen: what suits him and any subsidy is his doctor's to say. */
export const CAVEAT = {
  id: "C2-12",
  text: {
    "zh-Hans": "国家成人免疫计划表上写着：每个人适合什么、能不能拿补贴，要看医生。",
    en: "The National Adult Immunisation Schedule says it is for your doctor to say what suits you and whether you get a subsidy.",
  },
  source: NAIS,
} as const;
