/**
 * GET /api/ask/history[?day=<story day>]: the asks of one day and their answers, oldest first (lib/safety/turns.ts), for the
 * /p/ask screen and track K's chat screen. Default: the scope's today (an account's real date; the demo's story day).
 *
 * 200 { day, date, turns: AskTurn[], ai, voice }    AskTurn = { id, day, at, text, lang, answer: StoredAnswer | null }
 *     ai: his consent to AI processing as it is now (false: the ask screens say the one sentence of lib/safety/no-ai.ts)
 *     voice: a transcription service is connected (lib/safety/voice.ts askVoiceAvailable); only then does Today's ask
 *            section draw the microphone (real-app 2.10 「没有 Whisper 时，不显示麦克风按钮」)
 * 400 no session / bad day | 401 not signed in | 403 patient_only (Wei Ling's phone: his conversation is his) | 404
 *
 * Nothing here names the scope: an account's rows come back with session_id "" and the turns carry none.
 */
import type { NextRequest } from "next/server";
import { denyFamily } from "@/lib/family/role";
import { aiConsent } from "@/lib/safety/consent";
import { askTurns } from "@/lib/safety/turns";
import { askVoiceAvailable } from "@/lib/safety/voice";
import { StoreError } from "@/lib/store";
import { scopeD0 } from "@/lib/store/scope";
import { storyDate } from "@/lib/story/clock";
import { requireSubject } from "@/lib/subject";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest): Promise<Response> {
  const found = await requireSubject(req);
  if (!found.ok) return found.res;
  const { subject, session, store } = found;
  if (subject.kind === "account" && subject.relation !== "self") {
    return Response.json({ error: "patient_only", detail: "His conversation is his own." }, { status: 403 });
  }
  const denied = await denyFamily(req, session);
  if (denied) return denied;
  const raw = req.nextUrl.searchParams.get("day");
  const day = raw === null || raw.trim() === "" ? session.story_day : Number(raw);
  if (!Number.isInteger(day) || day < 0 || day > session.story_day) return Response.json({ error: "bad_day" }, { status: 400 });
  try {
    const [turns, ai] = await Promise.all([askTurns(store, session.id, day), aiConsent(store, session)]);
    return Response.json({ day, date: storyDate(scopeD0(session), day), turns, ai, voice: askVoiceAvailable() });
  } catch (e) {
    if (e instanceof StoreError && e.code === "session_not_found") return Response.json({ error: "session_not_found" }, { status: 404 });
    console.error("[api/ask/history] failed", (e as Error).message);
    return Response.json({ error: "internal_error" }, { status: 500 });
  }
}
