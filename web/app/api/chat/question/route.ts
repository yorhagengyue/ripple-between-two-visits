/**
 * POST /api/chat/question — 「加进问题单」 under a note in his conversation (journey 04; 老人端提示词 04.3: 他点了才加).
 * Body: { turn: <his row id> }. His own words of that turn go on his list for the doctor (origin chat, track C's
 * addQuestionFor: the same words are never a second row; one the doctor already answered comes back as answered).
 *
 * 200 { question: { id, outcome } } | 400 | 401 | 403 patient_only | 404 turn_not_found
 */
import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { relatedDoctorLine } from "@/lib/chat/related";
import { confirmedClinicianLines } from "@/lib/chat/said";
import { hisSubject, inputErrorResponse } from "@/lib/profile/http";
import { addQuestionFor } from "@/lib/profile/questions";
import { jsonError, parseBody } from "@/lib/session/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const body = z.object({ turn: z.string().min(1).max(200) }).strict();

export async function POST(req: NextRequest): Promise<Response> {
  const found = await hisSubject(req);
  if (!found.ok) return found.res;
  const parsed = await parseBody(req, body);
  if (!parsed.ok) return parsed.res;
  const { store, session } = found;
  try {
    const row = (await store.listChatMessages(session.id, { toDay: session.story_day })).find((r) => r.id === parsed.data.turn && r.role === "patient");
    if (!row) return jsonError(404, "turn_not_found");
    const line = relatedDoctorLine(row.text, await confirmedClinicianLines(store, session, { roles: ["doctor"] }));
    const r = await addQuestionFor(store, session, {
      for: "doctor",
      origin: "chat",
      text: row.text,
      lang: row.lang,
      evidence: JSON.stringify({ kind: "chat", turn: row.id, ...(line ? { doctor_line: `${line.visitId}:${line.utteranceId}` } : {}) }),
    });
    return NextResponse.json({ question: { id: r.question.id, outcome: r.outcome } });
  } catch (err) {
    return inputErrorResponse(err);
  }
}
