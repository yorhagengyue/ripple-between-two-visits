/**
 * zod schemas for the session, clock, director and dose routes (spec section 2: every request and
 * response is validated). Client-safe.
 */
import { z } from "zod";
import { isClockTime } from "@/lib/story/clock";

export const memberRole = z.enum(["patient", "family", "backstage", "director", "judge"]);
export const daySlot = z.enum(["morning", "midday", "evening", "night"]);
export const doseState = z.enum(["taken", "missed", "unconfirmed"]);
export const clockTime = z.string().refine(isClockTime, { message: "time must be HH:MM (24h)" });
/** The story runs D0 to D42; leave room for a few days either side. */
export const storyDay = z.number().int().min(0).max(120);
export const joinCode = z
  .string()
  .trim()
  .min(4)
  .max(12)
  .transform((s) => s.toUpperCase());

/** POST /api/session */
export const createSessionBody = z
  .object({
    /** sandbox = judge's own copy (expires); filming = long-lived session for the shoot */
    kind: z.enum(["sandbox", "filming"]).default("sandbox"),
    story_day: storyDay.optional(),
    story_time: clockTime.nullable().optional(),
    filming_mode: z.boolean().optional(),
    /** role of the device creating it; defaults to judge (sandbox) or director (filming) */
    role: memberRole.optional(),
    device_label: z.string().trim().max(60).optional(),
    /**
     * the film crew's key (lib/session/crew-key.ts): required for kind "filming" and for filming_mode true, unless
     * the request carries it as the x-ripple-crew-key header or the rp_crew cookie
     */
    crew_key: z.string().max(200).optional(),
  })
  .strict();
export type CreateSessionBody = z.infer<typeof createSessionBody>;

/** POST /api/session/join */
export const joinSessionBody = z
  .object({
    code: joinCode,
    role: memberRole,
    device_label: z.string().trim().max(60).optional(),
  })
  .strict();
export type JoinSessionBody = z.infer<typeof joinSessionBody>;

/** POST /api/clock: either a day (with optional time) or a beat ("next", "prev" or a beat id). */
export const clockBody = z
  .object({
    day: storyDay.optional(),
    time: clockTime.nullable().optional(),
    beat: z.string().min(1).max(40).optional(),
  })
  .strict()
  .refine((b) => b.day !== undefined || b.beat !== undefined, { message: "give day or beat" });
export type ClockBody = z.infer<typeof clockBody>;

/** POST /api/director/cue */
export const cueBody = z.discriminatedUnion("cue", [
  z.object({ cue: z.literal("reminder"), slot: daySlot.optional() }).strict(),
  z.object({ cue: z.literal("no_reply"), slot: daySlot.optional() }).strict(),
]);
export type CueBody = z.infer<typeof cueBody>;

/** POST /api/director/filming; switching it on needs the crew key (body, x-ripple-crew-key header or rp_crew cookie) */
export const filmingBody = z.object({ on: z.boolean(), crew_key: z.string().max(200).optional() }).strict();

/** POST /api/doses */
export const doseBody = z
  .object({
    medication_id: z.string().min(1).max(80),
    /** defaults to the session's story day */
    day: storyDay.optional(),
    slot: daySlot,
    state: doseState,
    /** option code, e.g. "later", "forgot", "tai_chi_morning" */
    reason: z.string().max(40).nullable().optional(),
    reason_text: z.string().max(200).nullable().optional(),
  })
  .strict();
export type DoseBody = z.infer<typeof doseBody>;
