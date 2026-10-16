/**
 * POST /api/tts — read a card aloud (task M5 item 3; spec section 2 "文本 → 音频").
 *   body { card: "explain", med_id, locale? }  (locale defaults to zh-Hans, Mr Tan's language)
 *   200 audio/wav: the explain card of that medicine on the session's story day, read by TTS_PROVIDER (mock by
 *       default). The text is built on the server from the card itself (lib/explain/read-aloud.ts), so the voice
 *       says exactly the card's sentences; the browser cannot send its own words. Headers: X-Ripple-Tts-Provider,
 *       X-Ripple-Tts-Sha256 (sha256 of the text read), X-Ripple-Tts-Synthetic (1 = placeholder voice).
 *   400 bad body / no session, 404 unknown session or medicine, 409 not_yet (no explain card on this day),
 *   503 tts_not_configured (trtc chosen and a setting is missing, or the service refused the configuration in the
 *       last ten minutes), 503 tts_provider_failed (the service gave no audio this time: busy, slow, unreachable).
 *
 * C2 track F, round three (real-app 2.17, 6.10): on an account the card has 「读给我听」 only when a real voice can speak
 * (lib/tts readAloudOffered("account"), the rule every read-aloud button in the app is drawn from). Without one this
 * route answers an account 404 tts_unavailable and synthesises nothing: never the mock's placeholder tones, never a 503
 * for a provider that is chosen but cannot speak. The demo is unchanged (its page leaves the button out while the
 * provider cannot answer, so the 503 tts_not_configured above is only what a direct request sees).
 *
 * C2 track T: TTS_PROVIDER=trtc is a real, billed service now (lib/tts/trtc.ts). Track L's per-person limit in POST
 * below (30 an hour, lib/guard/limits.ts) is what bounds the spend from one phone.
 */
import type { NextRequest } from "next/server";
import { z } from "zod";
import { readExplainCardAloud } from "@/lib/explain/read-aloud";
import { ExplainError } from "@/lib/explain/understanding";
import { jsonError, parseBody, storeErrorResponse } from "@/lib/session/http";
import { readAloudOffered, TtsError } from "@/lib/tts";
import { requireSubject } from "@/lib/subject";
import { limitByPerson } from "@/lib/subject/limits";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ttsBody = z
  .object({
    card: z.literal("explain"),
    med_id: z.string().min(1).max(100),
    locale: z.enum(["en", "zh-Hans"]).optional(),
  })
  .strict();

export async function POST(req: NextRequest): Promise<Response> {
  const found = await requireSubject(req);
  if (!found.ok) return found.res;
  const body = await parseBody(req, ttsBody);
  if (!body.ok) return body.res;
  // an account: only a real voice that can speak (the page draws no button otherwise)
  if (found.subject.kind === "account" && !readAloudOffered("account")) return jsonError(404, "tts_unavailable");
  // C2 track L: a card read aloud, 30 an hour per person (not in the design's table; lib/guard/limits.ts says why 30)
  const over = await limitByPerson(found.subject, "readAloud");
  if (over) return over;
  try {
    const out = await readExplainCardAloud(found.store, found.session.id, body.data.med_id, body.data.locale ?? "zh-Hans");
    return new Response(Buffer.from(out.audio.audio), {
      status: 200,
      headers: {
        "Content-Type": out.audio.mime,
        "Content-Length": String(out.audio.audio.byteLength),
        "Cache-Control": "no-store",
        "X-Ripple-Tts-Provider": out.audio.provider,
        "X-Ripple-Tts-Sha256": out.sha256,
        "X-Ripple-Tts-Synthetic": out.audio.synthetic ? "1" : "0",
      },
    });
  } catch (e) {
    if (e instanceof ExplainError) return jsonError(e.code === "not_yet" ? 409 : 404, e.code);
    if (e instanceof TtsError) return jsonError(e.code === "not_configured" || e.code === "provider_failed" ? 503 : 400, `tts_${e.code}`);
    return storeErrorResponse(e);
  }
}
