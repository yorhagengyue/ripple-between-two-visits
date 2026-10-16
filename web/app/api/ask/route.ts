/**
 * POST /api/ask: one sentence from the user (typed, or a voice transcript) -> classify -> generate -> three
 * checks -> structured answer (docs/plan/spec.md sections 2, 4, 5). The scope is the request's subject (lib/subject:
 * ?session= or the rp_session cookie for the demo, the sign-in cookie for an account). Every step is written to
 * safety_event and pushed to GET /api/events; the ask and its answer are kept as today's two chat rows (lib/safety/turns.ts:
 * GET /api/ask/history and /p/ask read them back after a refresh).
 *
 * Body: { text: string, locale?: "en" | "zh-Hans", medIds?: string[] }. There is no `role` field (C2 round 2, real-app 6.11
 * 「去掉请求体里的 role」): an older client that still sends one has it dropped unread, like any other unknown key.
 * 200 AskResult | 400 bad body or no session | 401 not signed in | 403 patient_only (Wei Ling's phone) | 404 unknown
 * session | 429 cost guard | 500
 *
 * Streaming (owner 10-15: 「需要非常完整的 SSE 的输出，无论是哪个端，子女和老人，我都需要 SSE」): a request whose Accept header
 * names text/event-stream gets the same answer as Server-Sent Events, told while it is made (lib/safety/pipeline.ts
 * "Streaming"; lib/safety/types.ts AskStreamEvent). Each event is `event: <name>` and one `data: <json>` line:
 *   stage     { stage: "reading" | "writing", locale? }   reading: his question was admitted and his sources are being
 *                                                         looked at (always the first event); writing: Ripple's own words
 *   sentence  { index, sentence, route }                  one final sentence of the answer (it passed the three checks), in
 *                                                         the answer's order; a 995 or helpline line before any model call
 *                                                         of the crisis wording
 *   delta     { text }                                    Ripple's own everyday answer, words as the model writes them
 *                                                         (never on a crisis answer)
 *   retract   { why }                                     those words are taken back (a guard, the gate, a failure)
 *   replace   { sentences, route }                        the sentences as they now stand (the crisis lines in a person's
 *                                                         words passed their checks)
 *   final     AskResult                                   exactly the JSON body the request without the header gets; the
 *                                                         truth the screen settles on (sent after the turn is kept)
 *   error     { status, error, ... }                      the answer failed after the stream had begun: the body and status
 *                                                         the plain request would have answered with
 * A comment line every 10 s keeps a quiet connection open. Everything that is refused (400, 401, 403, 404, 429 with its
 * words and Retry-After) is refused before the stream begins, as a plain JSON answer exactly as without the header: the
 * stream starts only once his question is admitted (the first event). A reader that goes away does not stop the answer: it
 * is still made, kept and recorded. Without the header nothing changed.
 *
 * 429 (real-app 2.10, 3.5 「问一句，每人：每小时 60 次、每天 20 万 token」), counted per person in the store (lib/safety/cost-guard.ts
 * StoreCostGuard: a restart or a second instance does not reset it): { error: "rate_limited", limit, retryAfterSec, retryAt }
 * with Retry-After. limit "requests_per_hour": his clock hour's questions are used up, retryAt is the next full hour
 * (「这个小时问得太多了，11:00 以后再问」); "tokens_per_day": his day's model tokens are used up, retryAt is his next midnight
 * (「今天问得太多了，明天再问」). The per-person model spend cap (US$0.20 a day) refuses nothing: the answer is then made with no
 * model call (AskResult.spendCapped).
 *
 * Who asks is the server's to say (C2, real-app 2.10 「身份由服务端定，不再信请求体里的 role」), never the body's:
 *   account   his own sign-in (relation self) asks as himself; her care link never reaches this route (no ?link=), and a
 *             family subject would get 403 patient_only: she cannot ask in his name
 *   demo      the device's member row (lib/family/role.ts): Wei Ling's phone is refused before the body is read
 *             (denyFamily); his phone, a judge's own sandbox and the crew's director device (both play his phone) and a
 *             plain call with no device are him ("patient": the question list shows such an ask in his own words); a
 *             backstage screen is labelled as such
 * His consent to AI processing decides whether any model may see the ask (lib/safety/consent.ts aiConsent; the demo's
 * synthetic story: yes). Without it the answer comes from the rules and fixed templates only.
 */
import type { NextRequest } from "next/server";
import { z } from "zod";
import { publish } from "@/lib/bus";
import { denyFamily, requesterRole } from "@/lib/family/role";
import { ask, CostLimitError, storeCostGuard } from "@/lib/safety";
import { prefetchAsk } from "@/lib/safety/pipeline";
import { readOnce } from "@/lib/safety/read-once";
import { aiConsent } from "@/lib/safety/consent";
import { detectLang } from "@/lib/safety/text";
import { recordAskTurn } from "@/lib/safety/turns";
import type { AskResult, AskStreamEvent } from "@/lib/safety/types";
import { DRILL_SENTENCE, drillAsked, drillLeaked } from "@/lib/crew/drill";
import { EVENT_STREAM_HEADERS, sseComment, sseFrame, wantsEventStream } from "@/lib/sse/frames";
import { StoreError } from "@/lib/store";
import { requireSubject, type Subject } from "@/lib/subject";
import { usageStore } from "@/lib/subject/usage";
import { nowMs } from "@/lib/time/now";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const bodySchema = z.object({
  text: z.string().trim().min(1).max(1000),
  locale: z.enum(["en", "zh-Hans"]).optional(),
  medIds: z.array(z.string().max(100)).max(10).optional(),
});

/** How often a quiet stream says it is still there (a comment line). */
const KEEP_ALIVE_MS = 10_000;

/** The answer was withheld because the check drill's sentence got through (see below). */
class DrillLeak extends Error {}

/** The label of the asker for the safety record and the backstage line (the question list counts only "patient"). */
async function askerRole(req: NextRequest, subject: Subject): Promise<string> {
  if (subject.kind === "account") return "patient";
  const role = await requesterRole(req, subject.scope).catch(() => null);
  return role === "backstage" ? role : "patient";
}

/** A failed ask as the plain request answers it: the status, the JSON body and its headers (both paths use it). */
function failure(e: unknown, sessionId: string): { status: number; body: Record<string, unknown>; headers?: Record<string, string> } {
  if (e instanceof CostLimitError) {
    publish(sessionId, "ask.blocked", `Cost guard: ${e.limit.replace(/_/g, " ")} reached`, { limit: e.limit, retryAfterSec: e.retryAfterSec });
    return {
      status: 429, headers: { "Retry-After": String(e.retryAfterSec) },
      body: { error: "rate_limited", limit: e.limit, retryAfterSec: e.retryAfterSec, retryAt: new Date(nowMs() + e.retryAfterSec * 1000).toISOString(), message: e.message },
    };
  }
  if (e instanceof StoreError && e.code === "session_not_found") return { status: 404, body: { error: "session_not_found" } };
  if (e instanceof DrillLeak) {
    // cannot happen while layer 1 works (the words are in no source); if it ever does, nothing of the answer is sent
    console.error("[api/ask] the check drill's sentence was not stopped: the answer is withheld");
    return { status: 500, body: { error: "drill_failed" } };
  }
  console.error("[api/ask] failed", (e as Error).message);
  return { status: 500, body: { error: "internal_error" } };
}

/** An event's data on the wire: the event without its type (the type is the frame's name). */
function eventData(e: AskStreamEvent): Record<string, unknown> {
  const data: Record<string, unknown> = { ...e };
  delete data.type;
  return data;
}

export async function POST(req: NextRequest): Promise<Response> {
  const found = await requireSubject(req);
  if (!found.ok) return found.res;
  const { subject, session, store } = found;
  const sessionId = session.id;
  if (subject.kind === "account" && subject.relation !== "self") {
    return Response.json({ error: "patient_only", detail: "Only he asks, from his own phone." }, { status: 403 });
  }
  const denied = await denyFamily(req, session);
  if (denied) return denied;

  let body: z.infer<typeof bodySchema>;
  try {
    const parsed = bodySchema.safeParse(await req.json());
    if (!parsed.success) return Response.json({ error: "bad_request", issues: parsed.error.issues.map((i) => i.message) }, { status: 400 });
    body = parsed.data;
  } catch {
    return Response.json({ error: "bad_json" }, { status: 400 });
  }

  // C2 track E (lib/crew/drill.ts): the demo's check drill. In a demo scope, an ask sent with ?drill=1 gets one fixed
  // sentence no source says added to its answer, so the three checks can be watched stopping it (the backstage row says
  // it was planted: components/backstage/sentences.ts). Never on an account; the planted words are never among the
  // sentences an answer shows. Fix round of 10-11: the sentence is added by the pipeline after the answer is composed
  // (AskDeps.plant), not through the model client, so the drill is the same with the real model, the offline one, and
  // when the model does not answer in time (it used to need a compose reply to add the sentence to).
  const plant = subject.kind === "demo" && drillAsked(req.nextUrl.searchParams) ? DRILL_SENTENCE : null;

  /** The answer, kept as today's turn before it goes out (the same for both paths). */
  const answer = async (stream?: (e: AskStreamEvent) => void): Promise<AskResult> => {
    // one read of each thing for this ask, the ones every answer needs started now, next to his consent (C2 latency pass:
    // lib/safety/read-once.ts; ask() finds the rows, and does not read the scope row again)
    const ro = readOnce(store);
    prefetchAsk(ro, session, { text: body.text, locale: body.locale });
    // his counters (questions this hour, model tokens and model spend today), counted in the store and started now, next
    // to the other reads: ask() decides with them once the rules have looked at his words
    const costGuard = storeCostGuard(usageStore(), session);
    void costGuard.prepare().catch(() => undefined);
    const [role, aiAllowed] = await Promise.all([askerRole(req, subject), aiConsent(ro, session)]);
    const result = await ask(
      { sessionId, text: body.text, locale: body.locale, role, medIds: body.medIds },
      { store: ro, aiAllowed, session, costGuard, ...(plant ? { plant } : {}), ...(stream ? { stream } : {}) },
    );
    if (plant && drillLeaked(result.sentences)) throw new DrillLeak();
    // today's conversation, kept for him before the answer goes out, so /p/ask and the chat show it on the next read (a
    // failure to keep it never costs him the answer)
    await recordAskTurn(ro, sessionId, { day: session.story_day, text: body.text, lang: detectLang(body.text), result }).catch((e: unknown) => {
      console.error("[api/ask] could not keep the turn", (e as Error).message);
    });
    return result;
  };

  if (!wantsEventStream(req.headers.get("accept"))) {
    try {
      return Response.json(await answer());
    } catch (e) {
      const f = failure(e, sessionId);
      return Response.json(f.body, { status: f.status, ...(f.headers ? { headers: f.headers } : {}) });
    }
  }

  // ---- the same answer as Server-Sent Events (see the header)
  const encoder = new TextEncoder();
  /** frames written before the stream is read, then straight to it */
  const pending: string[] = [];
  let write: ((frame: string) => void) | null = null;
  let begun: () => void = () => {};
  const firstEvent = new Promise<void>((resolve) => {
    begun = resolve;
  });
  const out = (frame: string) => {
    if (write) write(frame);
    else pending.push(frame);
    begun();
  };
  const onEvent = (e: AskStreamEvent) => {
    // the check drill's planted words never leave, not even for a moment (the final answer is withheld if they pass)
    if (plant && ((e.type === "sentence" && drillLeaked([e.sentence])) || (e.type === "replace" && drillLeaked(e.sentences)))) return;
    out(sseFrame(e.type, eventData(e)));
  };
  type Settled = { ok: true; result: AskResult } | { ok: false; error: unknown };
  const settled: Promise<Settled> = answer(onEvent).then(
    (result) => ({ ok: true as const, result }),
    (error: unknown) => ({ ok: false as const, error }),
  );
  // nothing is sent until his question is admitted: a refusal before that is the plain answer it always was
  const early = await Promise.race([firstEvent.then(() => null), settled]);
  if (early && !early.ok) {
    const f = failure(early.error, sessionId);
    return Response.json(f.body, { status: f.status, ...(f.headers ? { headers: f.headers } : {}) });
  }

  let closed = false;
  let keepAlive: ReturnType<typeof setInterval> | null = null;
  const body$ = new ReadableStream<Uint8Array>({
    start(controller) {
      const close = () => {
        if (closed) return;
        closed = true;
        if (keepAlive) clearInterval(keepAlive);
        try {
          controller.close();
        } catch {
          // closed already
        }
      };
      write = (frame: string) => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(frame));
        } catch {
          closed = true;
        }
      };
      for (const frame of pending.splice(0)) write(frame);
      keepAlive = setInterval(() => write?.(sseComment()), KEEP_ALIVE_MS);
      void settled.then((s) => {
        if (s.ok) {
          write?.(sseFrame("final", s.result));
        } else {
          const f = failure(s.error, sessionId);
          write?.(sseFrame("error", { status: f.status, ...f.body }));
        }
        close();
      });
    },
    cancel() {
      // he closed the screen: nobody reads any more (the answer is still made and kept)
      closed = true;
      if (keepAlive) clearInterval(keepAlive);
    },
  });
  return new Response(body$, { status: 200, headers: EVENT_STREAM_HEADERS });
}
