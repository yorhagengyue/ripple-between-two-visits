/**
 * Request bodies of the visit and speech routes (zod). Client-safe.
 */
import { z } from "zod";
import { MAX_PARTS } from "./parts";

const id = z.string().trim().regex(/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/);

/** POST /api/visits */
export const startVisitBody = z
  .object({
    mode: z.enum(["record", "replay"]),
    /** replay: which sample visit (v1, v2, v3, p1) */
    fixture: id.optional(),
    consent: z
      .object({
        given: z.boolean(),
        at: z.string().datetime().optional(),
        statement: z.string().trim().min(1).max(300).optional(),
        /** an account: someone is helping him on his device right now (the consent record keeps it; real-app 3.11) */
        assisted: z.boolean().optional(),
      })
      .strict()
      .optional(),
    /** an account's recording: at the clinic (default) or the pharmacy */
    place: z.enum(["clinic", "pharmacy"]).optional(),
  })
  .strict();

/** POST /api/visits/[id]/replay */
export const replayBody = z
  .object({
    speed: z.number().min(0.25).max(20).optional(),
    source: z.enum(["replay", "live"]).optional(),
  })
  .strict();

const incoming = z
  .object({
    id: id.optional(),
    t_start_ms: z.number().int().min(0),
    t_end_ms: z.number().int().min(0),
    speaker_cluster: z.number().int().min(0).max(32).nullable().optional(),
    lang: z.string().max(16).nullable().optional(),
    text: z.string().trim().min(1).max(2000),
  })
  .strict()
  .refine((u) => u.t_end_ms >= u.t_start_ms, { message: "t_end_ms before t_start_ms" });

/** POST /api/visits/[id]/extract: finished sentences from a realtime client (any chunk size). */
export const extractBody = z
  .object({
    utterances: z.array(incoming).min(1).max(100),
    /** turn the scripted fallback on or off for this visit (filming sessions only) */
    fallback: z.boolean().optional(),
  })
  .strict();

/** POST /api/visits/[id]/finalize */
export const finalizeBody = z.object({ job_id: z.string().trim().min(1).max(128) }).strict();

/** POST /api/visits/[id]/confirm */
export const confirmBody = z
  .object({
    mine: z.array(id).max(500),
    items: z.record(z.string().max(200), z.enum(["right", "wrong", "unsure"])),
    locale: z.enum(["en", "zh-Hans"]).optional(),
  })
  .strict();

/** POST /api/visits/[id]/verdict: one answer of the one-line-at-a-time review (the items of one line), or an edit after confirming */
export const verdictBody = z
  .object({
    items: z.array(z.string().trim().min(1).max(200)).min(1).max(20),
    verdict: z.enum(["right", "wrong", "unsure"]),
    locale: z.enum(["en", "zh-Hans"]).optional(),
  })
  .strict();

/** POST /api/visits/[id]/mine: one line of the review he says was his own (or gives back) */
export const mineBody = z
  .object({
    line: id,
    mine: z.boolean(),
  })
  .strict();

/** POST /api/visits/[id]/scripted; `key` = the crew key, for a caller that carries neither the cookie nor the header (lib/crew/gate.ts) */
export const scriptedBody = z
  .object({
    on: z.boolean(),
    key: z.string().trim().min(1).max(200).optional(),
  })
  .strict();

/** POST /api/asr/jobs */
export const asrJobBody = z
  .object({
    visit_id: id,
    /** Storage path of the whole-visit WAV (from /api/upload-url, kind "recording"); omitted for a replay */
    audio_path: z.string().trim().min(1).max(512).optional(),
    /**
     * C2 track R: the recording was uploaded as this many parts, each registered through POST /api/visits/[id]/parts.
     * The server uses the list on the visit, and only when it has exactly this many (409 parts_missing otherwise).
     */
    parts: z.number().int().min(1).max(MAX_PARTS).optional(),
    speakers: z.number().int().min(1).max(8).optional(),
    lang: z.enum(["zh-en-mixed", "en"]).optional(),
  })
  .strict();

/** POST /api/asr/realtime-token */
export const realtimeTokenBody = z.object({ visit_id: id.optional() }).strict();
