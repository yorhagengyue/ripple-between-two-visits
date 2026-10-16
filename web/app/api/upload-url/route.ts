/**
 * POST /api/upload-url — a signed link the browser uploads one file to, directly (spec section 2: the
 * bytes never pass through this API).
 *
 * Body: { kind: "segment" | "recording" | "reminder" | "label", content_type, visit_id?, utterance_id? }
 *   - segment, recording, reminder: content_type must be audio/wav (16 kHz mono, recorded in the
 *     browser). audio/webm and every other type are refused with 415.
 *   - label: image/png, image/jpeg or image/webp.
 *   - segment and recording need visit_id, a visit of this session (404 visit_not_found otherwise).
 * Session: ?session= or cookie rp_session (400 no_session, 404 session_not_found).
 *
 * 200: { bucket, path, url, method: "PUT", headers, expires_at, max_bytes }. The browser sends the
 * bytes with `fetch(url, { method, headers, body })`, then gives `path` to the route that uses the file
 * (visit.audio_path, utterance.clip_path, /api/labels/read). With BLOB_DRIVER=local the url is a
 * same-origin path; with supabase it is an absolute Supabase Storage link.
 *
 * Line bind (only add): through her link, 409 link_not_acknowledged while he has not acknowledged it (lib/care/ack.ts:
 * she bound his account by typing it and he has not tapped 「知道了」). No link is signed, so no file of hers reaches
 * his folder before he has answered; the same answer as the route that would register the recording (/api/reminders).
 */
import { NextResponse, type NextRequest } from "next/server";
import { BUCKET_CONFIG, blobPrefix, blobUserTag, getBlobStore, planUpload, UPLOAD_LINK_SECONDS, uploadUrlBody } from "@/lib/blob";
import { blobErrorResponse } from "@/lib/blob/http";
import { jsonError, parseBody, storeErrorResponse } from "@/lib/session/http";
import { StoreError } from "@/lib/store";
import { requireSubject } from "@/lib/subject";
import { limitByPerson } from "@/lib/subject/limits";
// line bind (only add): her upload waits for his acknowledgement of her link, like the recording it is for
import { LINK_NOT_ACKNOWLEDGED, linkAcknowledged } from "@/lib/care/ack";
import { bindEntryStore } from "@/lib/subject/bind";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest): Promise<Response> {
  // her care link (?link=) may ask for one thing only: the upload of her reminder recording into his space
  const found = await requireSubject(req, { allowFamily: true });
  if (!found.ok) return found.res;
  const body = await parseBody(req, uploadUrlBody);
  if (!body.ok) return body.res;
  if (found.subject.relation === "family" && body.data.kind !== "reminder") return jsonError(403, "family_reminder_only");
  // line bind (only add): a link he has not acknowledged gets no upload link (nothing of hers goes into his folder yet)
  if (found.subject.relation === "family" && found.subject.link) {
    try {
      if (!(await linkAcknowledged(bindEntryStore(), found.subject.link))) return jsonError(409, LINK_NOT_ACKNOWLEDGED);
    } catch (err) {
      return storeErrorResponse(err);
    }
  }
  // C2 track L: upload links, 100 an hour per person (real-app 3.5; lib/guard/limits.ts)
  const over = await limitByPerson(found.subject, "uploadLink");
  if (over) return over;
  const sessionId = found.session.id;
  try {
    // the scope's own prefix: a demo session's id, an account's one-way stand-in (never its id in the path or link)
    // C2 track H (only add): her recording's file name starts with her own tag (real-app 3.10), so her export and her
    // account deletion find the files she uploaded into his folder, and she can only register a file she uploaded
    const by = found.subject.relation === "family" && found.subject.userId ? { by: blobUserTag(found.subject.userId) } : {};
    const plan = planUpload(blobPrefix(found.session), body.data, by);
    if (body.data.visit_id) {
      const visit = await found.store.getVisit(sessionId, body.data.visit_id);
      if (!visit) return jsonError(404, "visit_not_found");
    }
    const link = await getBlobStore().signedUploadUrl(plan.bucket, plan.path, plan.contentType, UPLOAD_LINK_SECONDS);
    return NextResponse.json({
      bucket: plan.bucket,
      path: plan.path,
      url: link.url,
      method: link.method,
      headers: link.headers,
      expires_at: link.expiresAt,
      max_bytes: BUCKET_CONFIG[plan.bucket].maxBytes,
    });
  } catch (err) {
    if (err instanceof StoreError) return storeErrorResponse(err);
    return blobErrorResponse(err);
  }
}
