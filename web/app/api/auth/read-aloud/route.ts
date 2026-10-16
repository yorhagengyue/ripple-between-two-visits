/**
 * POST /api/auth/read-aloud { screen, locale, part? } (docs/plan/real-app.md 2.0 「同意页、恢复码页有『读给我听』」; track A).
 * A sibling of POST /api/tts for the screens that come before any sign-in. -> 200 audio/wav: one part of that screen's
 * sentences, read by TTS_PROVIDER. The words are built on the server from the same function the screen renders
 * (lib/auth/read-aloud-text.ts): the body names a screen, a language and a part number and nothing else, so the browser
 * cannot make the voice say its own text (an unknown field is 400). Headers: X-Ripple-Tts-Provider,
 * X-Ripple-Tts-Sha256 (of the text read), X-Ripple-Tts-Part, X-Ripple-Tts-Parts.
 * Refusals: 404 tts_unavailable while the provider is the mock (the pages do not show the button then) or for a part
 * the screen does not have, 429 too_many { until } (30 an hour per IP: nobody is signed in here), 503 tts_unavailable
 * when the provider is chosen but cannot speak.
 */
import type { NextRequest } from "next/server";
import { z } from "zod";
import { accountRoute, guardPost, json, refusal, requestFacts } from "@/lib/auth/http";
import { bucketKey, hitLimit, LIMITS } from "@/lib/auth/limits";
import { accountReadAloudAvailable, readAccountScreenAloud } from "@/lib/auth/read-aloud";
import { READ_ALOUD_SCREENS } from "@/lib/auth/read-aloud-text";
import { parseBody } from "@/lib/session/http";
import { accountDeps } from "@/lib/subject/account";
import { TtsError } from "@/lib/tts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const schema = z
  .object({
    screen: z.enum(READ_ALOUD_SCREENS),
    locale: z.enum(["zh-Hans", "en"]),
    part: z.number().int().min(0).max(50).optional(),
  })
  .strict();

export const POST = accountRoute(async (req: NextRequest): Promise<Response> => {
  const bad = guardPost(req);
  if (bad) return bad;
  const body = await parseBody(req, schema);
  if (!body.ok) return body.res;
  if (!accountReadAloudAvailable()) return json({ error: "tts_unavailable" }, 404);
  const limited = await hitLimit(accountDeps().store, `a:ra:${bucketKey("ip", requestFacts(req).ip)}`, LIMITS.readAloudPerIp);
  if (!limited.ok) return refusal({ ok: false, status: 429, error: "too_many", until: limited.until });
  try {
    const out = await readAccountScreenAloud(body.data.screen, body.data.locale, body.data.part ?? 0);
    if (!out) return json({ error: "tts_unavailable" }, 404);
    return new Response(Buffer.from(out.audio.audio), {
      status: 200,
      headers: {
        "Content-Type": out.audio.mime,
        "Content-Length": String(out.audio.audio.byteLength),
        "Cache-Control": "private, no-store",
        "X-Ripple-Tts-Provider": out.audio.provider,
        "X-Ripple-Tts-Sha256": out.sha256,
        "X-Ripple-Tts-Part": String(out.part),
        "X-Ripple-Tts-Parts": String(out.parts),
      },
    });
  } catch (err) {
    if (err instanceof TtsError) return json({ error: "tts_unavailable" }, 503);
    throw err;
  }
});
