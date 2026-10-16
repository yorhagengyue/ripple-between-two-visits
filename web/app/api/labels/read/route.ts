/**
 * POST /api/labels/read — label photo -> fields (spec section 2; web-app.md section 8).
 *
 * The browser first uploads the photo through POST /api/upload-url ({ kind: "label" }) and sends the returned
 * path here. Body: { path }. The photo is read from the labels bucket, transcribed (lib/vision: the main model's
 * image input, deepseek-flash with LLM_PROVIDER=deepseek or OpenAI as the optional provider with LLM_PROVIDER=openai;
 * the recorded cassettes with LLM_PROVIDER=replay; the vision cassettes in mock mode) and parsed into fields
 * (lib/meds/parse-label). The raw transcription never leaves the server.
 *
 * 200 { read_token, fields, display_name, provider } — the fields go to the patient to confirm one by one, the
 *     token goes back to POST /api/meds with his confirmation.
 * 400 no session / bad body; 403 photo_not_in_session; 404 session_not_found / photo_not_found;
 * 422 label_unreadable { detail: { code } } (e.g. cassette_missing in mock mode).
 * 403 ai_off: on an account whose latest ai_processing decision is not "granted" the photo is handed to no reader at
 * all (read on every request: turning it on under 「我」 works from the next one). He types the label's words himself
 * (POST /api/meds/manual). A demo session reads as before.
 */
import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { medsErrorResponse } from "@/lib/meds/http";
import { readLabel } from "@/lib/meds/write";
import { parseBody } from "@/lib/session/http";
import { requireSubject } from "@/lib/subject";
import { limitByPerson } from "@/lib/subject/limits";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const body = z.object({ path: z.string().trim().min(1).max(300) }).strict();

export async function POST(req: NextRequest): Promise<Response> {
  const found = await requireSubject(req);
  if (!found.ok) return found.res;
  const parsed = await parseBody(req, body);
  if (!parsed.ok) return parsed.res;
  // C2 track L: reading a label, 30 a day per person (real-app 3.5; lib/guard/limits.ts)
  const over = await limitByPerson(found.subject, "labelRead");
  if (over) return over;
  try {
    return NextResponse.json(await readLabel({ sessionId: found.session.id, path: parsed.data.path }, { store: found.store }));
  } catch (err) {
    return medsErrorResponse(err, "api/labels/read");
  }
}
