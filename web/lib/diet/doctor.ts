/**
 * The doctor's own words about food (journey 13; M16; e2e-chains 11 step 1). Server-only.
 *
 * The diet screen puts these first, word for word (Dr Lim's first visit: "Cut down on salt. Less gravy, don't finish
 * the soup. And keep up your morning walks."), and the daily diet check exists only while there is one (老人端提示词
 * 13.5: 每天一问只在医生给过饮食交代时出现).
 *
 * A doctor's line counts when he confirmed who said it at a visit that happened (lib/chat/said.ts) and it talks about
 * food: it names a food word (DIET_WORDS) and is neither about a medicine nor a test (a line about taking the tablet
 * after breakfast, or fasting before a blood test, is not a diet instruction), nor a question the doctor asked. A visit
 * item of type "lifestyle" made from such a line marks it too (itemId). Newest visit first.
 *
 * Words are matched, never written: what is shown is the doctor's whole line.
 */
import { confirmedClinicianLines, type SaidLine } from "@/lib/chat/said";
import type { SessionRow, Store } from "@/lib/store/types";

/** Food words in a doctor's line (English, Mandarin). 糖尿病 (diabetes) is a condition, not sugar. */
export const DIET_WORDS: readonly RegExp[] = [
  /\b(?:salt|salty|sodium|gravy|soups?|sauces?|sugar|sugary|sweet drinks?|soft drinks?|fizzy drinks?|fried|deep[- ]fried|oily|fatty|fats?|fruits?|vegetables?|veggies|wholegrains?|whole grains?|brown rice|portions?|desserts?|kuehs?|hawker food|diet)\b/i,
  /盐|咸|汤|汁|糖(?!尿)|甜|油炸|炸的|油腻|肥肉|蔬菜|青菜|水果|饮食|甜品|糙米|全麦/,
];

/** A line about a medicine (taking it, its dose) or a test is not a diet instruction, whatever food word it has. */
const NOT_DIET: readonly RegExp[] = [
  /\b(?:tablets?|pills?|medicines?|medications?|meds|doses?|milligrams?|mg|amlodipine|losartan|metformin|statin|atorvastatin|ibuprofen|paracetamol|blood test|fast(?:ing)?|empty stomach)\b/i,
  /药|粒|片|剂量|毫克|验血|空腹|禁食/,
];

export function isDietLine(text: string): boolean {
  if (!DIET_WORDS.some((re) => re.test(text))) return false;
  if (NOT_DIET.some((re) => re.test(text))) return false;
  // a question the doctor asked ("Any soup today?") is not an instruction
  if (/[?？]\s*$/.test(text.trim())) return false;
  return true;
}

export interface DoctorDietLine extends SaidLine {
  role: "doctor";
}

/** The doctor's confirmed lines about food, newest visit first (empty when he has none). */
export async function doctorDietLines(store: Store, scope: SessionRow): Promise<DoctorDietLine[]> {
  const lines = await confirmedClinicianLines(store, scope, { roles: ["doctor"] });
  return lines.filter((l): l is DoctorDietLine => l.role === "doctor" && isDietLine(l.text));
}
