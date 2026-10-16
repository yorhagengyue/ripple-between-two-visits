/**
 * web/kb/diet.json: the official diet lines (journey 13; M16 「kb/diet.json 先做高血压、糖尿病、高胆固醇三种，每条是新加坡官方来源
 * （HPB、HealthHub）的转述，挂出处和审阅日期」). Server and client safe (pure; the JSON is bundled).
 *
 * The file's rules (meta.rules), checked by tests/unit/diet/diet.test.ts:
 *   - patient-facing text is our paraphrase of the official page, never its sentences copied; each line names its source
 *     (publisher, page title, URL, the page's own date when it shows one) and the date we reviewed it;
 *   - no numbers in the text (no grams, milligrams, teaspoons, calories), no claim that a food lowers, controls or
 *     prevents anything, no 你应该 / 你需要 / 建议 / you should;
 *   - zh is a draft until a Mandarin reader reviews it.
 * Which lines he sees: those for the conditions recorded about him (lib/prevent/conditions.ts), and the eating-out lines
 * for the hawker dishes he picked. Grapefruit is never here: it comes only from his medicine's leaflet (patient_text).
 */
import { z } from "zod";
import dietFile from "@/kb/diet.json";
import type { Locale } from "@/lib/i18n";
import type { ConditionId } from "@/lib/prevent/conditions";

export const DIET_CONDITIONS = ["hypertension", "diabetes", "high_cholesterol"] as const;
export type DietCondition = (typeof DIET_CONDITIONS)[number];

const sourceSchema = z.object({
  publisher: z.string().min(1),
  /** who wrote the page when it is not the publisher (a HealthHub article contributed by NHG Health) */
  contributor: z.string().optional(),
  title: z.string().min(1),
  url: z.string().url(),
  page_date: z.string().nullable(),
  reviewed: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
});

const lineSchema = z.object({
  id: z.string().regex(/^(?:ht|dm|ch|hk)-\d{2}$/),
  conditions: z.array(z.enum(DIET_CONDITIONS)),
  foods: z.array(z.string()),
  en: z.string().min(1),
  zh: z.string().min(1),
  source: z.string().min(1),
  zh_status: z.enum(["draft", "reviewed"]),
  /** a dish line: the page names the dish itself, or only its kind ("soup dishes", "fried noodles") */
  mapping: z.enum(["named dish", "dish type only"]).optional(),
});

const foodSchema = z.object({ id: z.string().regex(/^[a-z_]+$/), zh: z.string().min(1), en: z.string().min(1) });

const fileSchema = z.object({
  meta: z.object({ title: z.string(), reviewed: z.string(), rules: z.array(z.string()), note: z.string().optional() }),
  sources: z.record(z.string(), sourceSchema),
  foods: z.array(foodSchema),
  lines: z.array(lineSchema),
});

export type DietSource = z.infer<typeof sourceSchema>;
export type DietLine = z.infer<typeof lineSchema>;
export type DietFood = z.infer<typeof foodSchema>;
export type DietKb = z.infer<typeof fileSchema>;

let cached: DietKb | null = null;

/** The parsed file (throws on a malformed file: tests catch it before a build ships it). */
export function dietKb(): DietKb {
  cached ??= fileSchema.parse(dietFile);
  return cached;
}

export const isDietCondition = (c: ConditionId | string): c is DietCondition => (DIET_CONDITIONS as readonly string[]).includes(c);

/** The lines for one of his conditions, in file order. */
export function linesForCondition(condition: DietCondition): DietLine[] {
  return dietKb().lines.filter((l) => l.conditions.includes(condition));
}

/** The eating-out lines for one hawker dish, in file order. */
export function linesForFood(food: string): DietLine[] {
  return dietKb().lines.filter((l) => l.foods.includes(food));
}

export function sourceOf(line: Pick<DietLine, "source">): DietSource {
  const s = dietKb().sources[line.source];
  if (!s) throw new Error(`kb/diet.json: line names an unknown source ${line.source}`);
  return s;
}

export function foodById(id: string): DietFood | null {
  return dietKb().foods.find((f) => f.id === id) ?? null;
}

export const lineText = (line: Pick<DietLine, "en" | "zh">, locale: Locale) => (locale === "zh-Hans" ? line.zh : line.en);
