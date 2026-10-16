/**
 * A family member puts a question on his list (owner 10-14: a follow-up on her 「留意」 that is neither Ripple's nor hers
 * to settle is a question for his doctor, and she can put it on his question list with one tap). Server-only.
 *
 *   addFamilyQuestion(store, scope, input)   the question goes on his list through the path his own add uses
 *                                            (lib/profile/questions.ts addQuestionFor): the same words already there
 *                                            are never a second row (merged; one the doctor already answered is left
 *                                            as it is). Words he set aside stay set aside ("aside", nothing written):
 *                                            asking or not is his, and her tap does not undo it
 *
 * What makes the row hers: asked_by_user_id is her user id (his list then shows 「家人加的」, lib/profile/questions.ts
 * ListQuestion.fromFamily), and its evidence names the care link it came through. Its origin is "own": a value the
 * column already holds (no migration; question.origin has no CHECK, supabase/migrations/0001_tables.sql), and the one
 * his own screens put a question under when they add it from a read of a record (components/explain/ExplainSheet.tsx).
 *
 * The caller decides whether she may: his questions_count switch for her link must be on, and the link acknowledged
 * (lib/care/ack.ts; POST /api/family/questions checks both). `store` is hers, bound to his scope through her link
 * (lib/subject/scoped-store.ts lets family mode make exactly this write: a new open question in her own name).
 *
 * The words are never hers to type: every caller builds them on the server from his own record (lib/care/record.ts, the
 * long press's read), so nothing she writes reaches his list as a question.
 */
import { addQuestionFor, questionKey, type AddOutcome } from "@/lib/profile/questions";
import type { SessionRow, Store } from "@/lib/store/types";

export async function addFamilyQuestion(
  store: Store,
  scope: SessionRow,
  input: { linkId: string; userId: string; text: string; for: "doctor" | "pharmacist" },
): Promise<{ outcome: AddOutcome | "aside"; id: string }> {
  const key = questionKey(input.text);
  const aside = (await store.listQuestions(scope.id)).find((q) => q.status === "skipped" && !q.merged_into && q.for === input.for && questionKey(q.text) === key);
  if (aside) return { outcome: "aside", id: aside.id };
  const r = await addQuestionFor(store, scope, {
    for: input.for,
    text: input.text,
    origin: "own",
    askedByUserId: input.userId,
    evidence: JSON.stringify({ kind: "family", link: input.linkId }),
  });
  return { outcome: r.outcome, id: r.question.id };
}
