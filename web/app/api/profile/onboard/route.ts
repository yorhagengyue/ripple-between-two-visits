/**
 * POST /api/profile/onboard — his answer on one setting-up screen (journey 01 建档; real-app 2.5). Track C.
 *
 *   { step: "who", by: "self" | "family" | null }        who is filling it in this round; null: skipped, so it stays
 *                                                         what sign-up said (「家人帮我操作」) or what he chose before
 *   { step: "clinic", clinic: string | null }             null: skipped
 *   { step: "breakfast", time: "HH:MM" | null }
 *   { step: "habits", habits: [{ label, label_zh?, days: ["Tue", ...], time }] | null }
 *   { step: "meds", choice: "photo" | "later" }
 *   { step: "age", age: number | null }
 *   { step: "conditions", items: string[] | null }
 *   { step: "allergies", items: string[] | null, none?: boolean }
 *   { step: "family", choice: "invite" | "later" }
 *   { step: "reminders", result: "granted" | "denied" | "dismissed" | "unsupported" | "needs_home_screen" | "failed" | "later" }
 *   { step: "done" }
 * -> 200 { next: <step> | null, href, profile }: href is the next screen, or /p/today once he is done.
 * While a family member fills it in for him (sign-up said so, or who: family), every fact of the round is source
 * family, unconfirmed: it waits for his 对, and a clinic or routine stays out of his settings until he confirms it. What
 * he fills in himself is written as his setting and as his own fact. His own account only (404 otherwise); 400 with
 * the input problem's code.
 */
import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { accountSelf, inputErrorResponse } from "@/lib/profile/http";
import { applyOnboardAnswer, type OnboardAnswer } from "@/lib/profile/onboarding";
import { profileView } from "@/lib/profile/view";
import { parseBody } from "@/lib/session/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const text = z.string().max(400);
const habit = z
  .object({
    label: text,
    label_zh: text.nullable().optional(),
    days: z.array(z.enum(["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"])).min(1).max(7),
    time: z.string().max(5),
  })
  .strict();

const answerBody = z.discriminatedUnion("step", [
  z.object({ step: z.literal("who"), by: z.enum(["self", "family"]).nullable() }).strict(),
  z.object({ step: z.literal("clinic"), clinic: text.nullable() }).strict(),
  z.object({ step: z.literal("breakfast"), time: z.string().max(5).nullable() }).strict(),
  z.object({ step: z.literal("habits"), habits: z.array(habit).max(12).nullable() }).strict(),
  z.object({ step: z.literal("meds"), choice: z.enum(["photo", "later"]) }).strict(),
  z.object({ step: z.literal("age"), age: z.number().int().nullable() }).strict(),
  z.object({ step: z.literal("conditions"), items: z.array(text).max(20).nullable() }).strict(),
  z.object({ step: z.literal("allergies"), items: z.array(text).max(20).nullable(), none: z.boolean().optional() }).strict(),
  z.object({ step: z.literal("family"), choice: z.enum(["invite", "later"]) }).strict(),
  z.object({ step: z.literal("reminders"), result: z.enum(["granted", "denied", "dismissed", "unsupported", "needs_home_screen", "failed", "later"]) }).strict(),
  z.object({ step: z.literal("done") }).strict(),
]);

export async function POST(req: NextRequest): Promise<Response> {
  const found = await accountSelf(req);
  if (!found.ok) return found.res;
  const body = await parseBody(req, answerBody);
  if (!body.ok) return body.res;
  try {
    const r = await applyOnboardAnswer(found.store, found.session, body.data as OnboardAnswer);
    return NextResponse.json({ next: r.next, href: r.href, profile: await profileView(found.store, r.scope) });
  } catch (err) {
    return inputErrorResponse(err);
  }
}
