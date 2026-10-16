/**
 * Where uploads go. The server picks every path; the browser never names one. All paths start with the
 * session id, so a reset can clear a session with removePrefix(bucket, sessionId).
 *
 *   segment    audio   <session>/visits/<visit_id>/segments/<utterance_id | random>.wav
 *   recording  audio   <session>/visits/<visit_id>/recording-<random>.wav   (the whole visit)
 *   reminder   audio   <session>/reminders/<random>.wav                     (Wei Ling's reminder, M6)
 *                      <prefix>/reminders/<her tag>-<random>.wav            (C2: her recording through her care link;
 *                                                                            the tag is lib/blob/prefix.ts blobUserTag)
 *   label      labels  <session>/labels/<random>.<png|jpg|webp>             (label photo, M3)
 *
 * No node: imports, so client code can import the body schema.
 */
import { z } from "zod";
import { BlobError, type BlobBucket, type BlobContentType } from "./types";
import { assertContentType, assertPath, EXTENSION_FOR } from "./validate";

export const UPLOAD_KINDS = ["segment", "recording", "reminder", "label"] as const;
export type UploadKind = (typeof UPLOAD_KINDS)[number];

/** Upload links from /api/upload-url last 10 minutes (Supabase's own are fixed at 2 hours). */
export const UPLOAD_LINK_SECONDS = 600;

/**
 * C2 track H (only add): a link the browser reads a file through lasts 10 minutes (docs/plan/real-app.md 3.9 「浏览器只拿
 * 服务端签的 10 分钟链接」). Both drivers sign read links for exactly the seconds asked. The one longer link the design
 * gives is the export's (24 hours, lib/privacy/rules.ts EXPORT_LINK_SECONDS); nothing may ask for more than that
 * (./validate.ts clampExpiry). tests/unit/blob/link-lifetimes.test.ts reads every call site.
 */
export const READ_LINK_SECONDS = 600;

const idSegment = z
  .string()
  .trim()
  .regex(/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/, "letters, digits, '.', '_' or '-'");

/** POST /api/upload-url */
export const uploadUrlBody = z
  .object({
    kind: z.enum(UPLOAD_KINDS),
    /** audio/wav for segment, recording, reminder; image/png | image/jpeg | image/webp for label */
    content_type: z.string().trim().min(1).max(120),
    /** required for segment and recording; must be a visit of this session */
    visit_id: idSegment.optional(),
    /** segment only: names the file after the utterance (re-uploading replaces it) */
    utterance_id: idSegment.optional(),
  })
  .strict();
export type UploadUrlBody = z.infer<typeof uploadUrlBody>;

export interface UploadPlan {
  bucket: BlobBucket;
  path: string;
  contentType: BlobContentType;
}

const BUCKET_FOR: Record<UploadKind, BlobBucket> = {
  segment: "audio",
  recording: "audio",
  reminder: "audio",
  label: "labels",
};

const randomName = (): string => globalThis.crypto.randomUUID();

/** C2 track H (only add): who uploads. `by` is the uploader's tag (blobUserTag), put in front of a reminder's file name. */
export interface PlanOptions {
  by?: string;
}

/**
 * Bucket, path and content type for an upload. Throws BlobError: unsupported_content_type (e.g.
 * audio/webm, or an image for an audio kind), invalid (visit_id missing or utterance_id on a non-segment).
 */
export function planUpload(sessionId: string, body: UploadUrlBody, opts: PlanOptions = {}): UploadPlan {
  const bucket = BUCKET_FOR[body.kind];
  const contentType = assertContentType(bucket, body.content_type);
  const ext = EXTENSION_FOR[contentType];
  if ((body.kind === "segment" || body.kind === "recording") && !body.visit_id) {
    throw new BlobError("invalid", `visit_id is required for a ${body.kind}`);
  }
  if (body.utterance_id && body.kind !== "segment") {
    throw new BlobError("invalid", "utterance_id is only for a segment");
  }
  let path: string;
  switch (body.kind) {
    case "segment":
      path = `${sessionId}/visits/${body.visit_id}/segments/${body.utterance_id ?? randomName()}.${ext}`;
      break;
    case "recording":
      path = `${sessionId}/visits/${body.visit_id}/recording-${randomName()}.${ext}`;
      break;
    case "reminder":
      path = `${sessionId}/reminders/${opts.by ? `${opts.by}-` : ""}${randomName()}.${ext}`;
      break;
    case "label":
      path = `${sessionId}/labels/${randomName()}.${ext}`;
      break;
  }
  return { bucket, path: assertPath(path), contentType };
}

/** True when `path` belongs to the session (use before reading a path the browser sent back). */
export function pathInSession(sessionId: string, path: string): boolean {
  try {
    assertPath(path);
  } catch {
    return false;
  }
  return path.startsWith(`${sessionId}/`);
}
