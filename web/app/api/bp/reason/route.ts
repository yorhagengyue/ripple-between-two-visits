/**
 * POST /api/bp/reason — what happened on the day of a reading outside his doctor's target (owner 10-15, the demo video's
 * second scene; lib/daily/bp-reason.ts). The blood pressure page's card sends his words once the spoken words are made
 * (POST /api/ask/transcribe) or once he typed them.
 *
 * Body: { reading: <the reading's id>, text: <his words, as heard>, source?: "voice_note" | "typed" }
 *   201 { note: { id, text, lang, at }, question: { id, text, lang, outcome, by }, ai }
 *       his words are one of his notes, tied to the reading and dated on its day; one question for his doctor is on his
 *       list (outcome created, or merged / reopened / answered for the same words already there, updated when the same
 *       reading's open question was written again from his newest words, kept when he changed or set aside that one).
 *       `by`: "model" (written by the main model, checked) or "template" (the fixed question); `ai`: his consent to AI
 *       processing was on, so the model could be asked
 *   400 invalid / empty / too_long | 401 | 404 not_found (no such reading of his) | 409 not_outside_target (the reading
 *   is not outside the target he confirmed, or there is none) | 429 too_many (this reading was talked about 10 times)
 *
 * His own account only (her phone, her account, a demo session: 404 / 403, lib/profile/http.ts accountSelf). The main model
 * is asked only with his consent to AI processing (lib/safety/consent.ts), never on the offline mock, and within his day's
 * spend (lib/subject/usage.ts personSpendFor); otherwise the fixed question. No log line carries his words.
 */
import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { ReasonError, saveReadingReason } from "@/lib/daily/bp-reason";
import { createMainLlm, mainProviderKind } from "@/lib/llm";
import { accountSelf, inputErrorResponse, requestLocale } from "@/lib/profile/http";
import { aiConsent } from "@/lib/safety/consent";
import { jsonError, parseBody } from "@/lib/session/http";
import { personSpendFor } from "@/lib/subject/usage";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const body = z
  .object({
    reading: z.string().min(1).max(80),
    text: z.string().min(1).max(2000),
    source: z.enum(["voice_note", "typed"]).optional(),
  })
  .strict();

const STATUS: Record<ReasonError["code"], number> = { empty: 400, too_long: 400, not_found: 404, not_outside_target: 409, too_many: 429 };

export async function POST(req: NextRequest): Promise<Response> {
  const found = await accountSelf(req);
  if (!found.ok) return found.res;
  const parsed = await parseBody(req, body);
  if (!parsed.ok) return parsed.res;
  const { store, session } = found;
  try {
    const ai = await aiConsent(store, session);
    // the model only with his consent and never on the offline mock (its answer would not be a question): else the
    // fixed question; the day's spend is asked before the call and settled after it
    const spend = ai && mainProviderKind() !== "mock" ? personSpendFor(session) : null;
    const llm = spend && !(await spend.capped()) ? spend.wrap(createMainLlm()) : null;
    const saved = await saveReadingReason(store, session, { readingId: parsed.data.reading, text: parsed.data.text, source: parsed.data.source }, { locale: requestLocale(req), llm });
    if (llm) await spend?.settle();
    return NextResponse.json(
      {
        note: { id: saved.note.id, text: saved.note.text, lang: saved.note.lang, at: saved.note.created_at },
        question: saved.question,
        ai,
      },
      { status: 201 },
    );
  } catch (err) {
    if (err instanceof ReasonError) return jsonError(STATUS[err.code], err.code);
    return inputErrorResponse(err);
  }
}
