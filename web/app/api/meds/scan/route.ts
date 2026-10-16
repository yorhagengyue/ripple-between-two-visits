/**
 * POST /api/meds/scan — 「拍药盒，看怎么吃」 / "Scan a medicine box" (scene 3 of the owner's film, 10-15): a photo of one
 * of his boxes -> which of his medicines it is, how to take it from his checked label, what it is for from the leaflet,
 * and what his doctor said about it with the recorded line's clip (lib/meds/scan.ts). Nothing is written to his
 * medicines; the photo is read as the add flow reads it (lib/meds/write.ts readLabel).
 *
 * The browser first uploads the photo through POST /api/upload-url ({ kind: "label" }) and sends the path here.
 * Body: { path, locale?: "en" | "zh-Hans" } (default: the request's language).
 *
 * 200 ScanView { outcome: his | differs | not_his | unknown, read, med, differs, say, how, noDirections, purpose,
 *     doctor, question, provider }
 * 400 no session / bad body; 403 patient_only (a family member's link), photo_not_in_session, ai_off (his consent to
 * AI processing is off: the photo goes to no reader); 404 photo_not_found; 422 label_unreadable { detail: { code } };
 * 429 over the day's label reads (the add flow's limit: one count per photo read).
 */
import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { medsErrorResponse } from "@/lib/meds/http";
import { scanBox } from "@/lib/meds/scan";
import { hisSubject, requestLocale } from "@/lib/profile/http";
import { parseBody } from "@/lib/session/http";
import { limitByPerson } from "@/lib/subject/limits";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const body = z
  .object({
    path: z.string().trim().min(1).max(300),
    locale: z.enum(["en", "zh-Hans"]).optional(),
  })
  .strict();

export async function POST(req: NextRequest): Promise<Response> {
  const found = await hisSubject(req);
  if (!found.ok) return found.res;
  const parsed = await parseBody(req, body);
  if (!parsed.ok) return parsed.res;
  // the same count as reading a label in the add flow (lib/guard/limits.ts labelRead)
  const over = await limitByPerson(found.subject, "labelRead");
  if (over) return over;
  try {
    const view = await scanBox({ sessionId: found.session.id, path: parsed.data.path, locale: parsed.data.locale ?? requestLocale(req) }, { store: found.store });
    return NextResponse.json(view);
  } catch (err) {
    return medsErrorResponse(err, "api/meds/scan");
  }
}
