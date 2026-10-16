/**
 * POST /api/explain: Ripple's read of one thing he held on his screen (owner's decision of 10-14, modelled on his iOS
 * app: the client sends only what the thing is, the server looks everything up; ripple-core src/routes/explain.ts).
 *
 * Body: { subject_type, subject_ref, locale?: "en" | "zh-Hans" }. The types and how a ref is spelled:
 * lib/explain/subjects.ts (med, dose, bp, bp_week, visit, visit_line, question, next_visit).
 * 200 HoldRead { subject: { type, ref, name }, verdict, abstain, verdictBy, verdictWhy?, checked[], sources[], ask, answerId }
 *     (a family member's also carries `note`, the line under the sentence)
 *     With `Accept: text/event-stream` (the sheet asks so since 10-15, owner: 「需要非常完整的 SSE 的输出」) the answer is
 *     Server-Sent Events, each `event: <name>` and one `data: <json>` line:
 *       read     HoldRead with `waiting: true`   what Ripple looked at (the lines and quotes) and the sentence built from
 *                                              his records, at once, when a model is about to be asked
 *       stage    { stage: "writing" }           the model is writing the sentence
 *       delta    { text }                       the sentence's words as the model writes them (the `verdict` field)
 *       retract  { why }                        those words are taken back: the sentence built from his records stands
 *                                              (the model abstained, a guard dropped it, it failed)
 *       final    HoldRead                       exactly the JSON body the request without the header gets
 *       error    { status, error }              it failed after the stream had begun
 *     Without a model call it is the one final event. Everything refused (400, 401, 403, 404) is refused before the stream
 *     begins, as the plain JSON answer.
 *     With `Accept: application/x-ndjson` (the sheet before 10-15) and a model about to be asked, the answer comes as two
 *     lines, each a whole HoldRead: first what Ripple looked at, with the sentence built from his records and
 *     `waiting: true`; then the same with the sentence as it stands once the model has answered (or has not, within 8 s).
 *     Without a model call it is one line. Any other caller gets one JSON object, as above.
 * 400 bad body | 401 not signed in | 403 account_only (a demo session), link_not_active (her link is over) | 404
 * not_found (his records hold no such thing, or it is not hers to hold), link_not_found | 500
 *
 * His own account: the subject is the sign-in cookie's, as for /api/ask (lib/subject requireSubject). The demo's
 * sessions keep their own screens, which have no long press.
 *
 * A family member (owner's decision of 2026-10-14: 「长按进入 AI 在家属端也要有」): POST /api/explain?link=<her care link>
 * with the same body. She reads his space through her active link, read-only, cut by HIS SWITCHES for that link as they
 * are in the store at this moment (lib/explain/family.ts herViewer):
 *   - a thing of a type whose switch is off is 404 not_found, the answer a thing that does not exist gets (dose and med:
 *     his medicine; bp and bp_week: his blood pressure; visit and visit_line: his visit records; question and
 *     next_visit: his questions);
 *   - every line of `checked` and every entry of `sources` is one a switch of his allows (lib/explain/evidence.ts cuts
 *     where each is produced), in the family side's words, about him in the third person;
 *   - `ask` is null while he does not share his questions with her, and while he has not acknowledged a link she bound
 *     herself (lib/care/ack.ts): the sheet then shows no 「加入待问问题」;
 *   - her look is logged for him like every look of hers (lib/care/access-log.ts: one row per link and set of switches
 *     every ten minutes, naming the switches the answer drew on). That row is the only thing written.
 *
 * What is read and what is written: lib/explain/evidence.ts builds the lines and the sources from his records, the
 * same readers as his screens. Then ONE model call may write the sentence at the top from that evidence, when his
 * consent to AI processing is on (lib/safety/consent.ts aiConsent, read through his own store; on her read through
 * lib/subject/patient-consent.ts, because his consent records are not hers to read), a model is configured and his
 * day's model spend is not used up (real-app 3.5: lib/subject/usage.ts personSpendFor, asked before the call and
 * settled after it: his spend on her read too, the work is done on his records). In every other case, and when the
 * guards drop the model's words, the sentence is the one built from his records, and the answer says so (verdictBy
 * "records", verdictWhy). Nothing is written to his records here.
 */
import type { NextRequest } from "next/server";
import { z } from "zod";
import { logLook } from "@/lib/care/access-log";
import { holdWords } from "@/lib/explain/copy";
import { buildEvidence } from "@/lib/explain/evidence";
import { herViewer, type HerViewer } from "@/lib/explain/family";
import { HOLD_GRANT, HOLD_TYPES, REF_MAX, type HoldRead } from "@/lib/explain/subjects";
import { writeVerdict, type VerdictResult } from "@/lib/explain/verdict";
import { createMainLlm } from "@/lib/llm";
import { requestLocale } from "@/lib/profile/http";
import { aiConsent } from "@/lib/safety/consent";
import { readOnce } from "@/lib/safety/read-once";
import { EVENT_STREAM_HEADERS, sseFrame, wantsEventStream } from "@/lib/sse/frames";
import { StoreError } from "@/lib/store";
import { requireSubject } from "@/lib/subject";
import { patientAiConsent } from "@/lib/subject/patient-consent";
import { personSpendFor } from "@/lib/subject/usage";
import { nowMs } from "@/lib/time/now";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** one HoldRead per line */
const LINES = "application/x-ndjson";

const bodySchema = z.object({
  subject_type: z.enum(HOLD_TYPES),
  subject_ref: z.string().max(REF_MAX).default(""),
  locale: z.enum(["en", "zh-Hans"]).optional(),
});

const notFound = () => Response.json({ error: "not_found" }, { status: 404 });

export async function POST(req: NextRequest): Promise<Response> {
  // ?link= is her way in; without it this is his own account, exactly as before
  const found = await requireSubject(req, { allowFamily: true });
  if (!found.ok) return found.res;
  const { subject, session, store } = found;
  if (subject.kind !== "account") return Response.json({ error: "account_only" }, { status: 403 });
  if (subject.relation !== "self" && subject.relation !== "family") return Response.json({ error: "patient_only", detail: "Only he holds his own records." }, { status: 403 });

  let body: z.infer<typeof bodySchema>;
  try {
    const parsed = bodySchema.safeParse(await req.json());
    if (!parsed.success) return Response.json({ error: "bad_request", issues: parsed.error.issues.map((i) => i.message) }, { status: 400 });
    body = parsed.data;
  } catch {
    return Response.json({ error: "bad_json" }, { status: 400 });
  }
  const locale = body.locale ?? requestLocale(req);

  try {
    // one read of each thing for this request (the evidence asks for the visits, the medicines and the list more than once)
    const ro = readOnce(store);
    // a family member: his switches for her link, now. A type whose switch is off is not hers to hold
    let her: HerViewer | null = null;
    if (subject.relation === "family") {
      her = await herViewer({ subject, session, store: ro }, locale);
      if (!her || !her.mayHold(body.subject_type)) return notFound();
    }
    const now = nowMs();
    const aiAllowed = her ? await patientAiConsent(session) : await aiConsent(ro, session);
    const evidence = await buildEvidence({
      store: ro,
      scope: session,
      subject: { type: body.subject_type, ref: body.subject_ref },
      locale,
      nowMs: now,
      aiAllowed,
      ...(her ? { viewer: her.evidence } : {}),
    });
    if (!evidence) return notFound();
    // hers: nothing to add while her question could not reach his list (POST /api/explain/add would refuse it)
    const ask = her && evidence.ask && (await her.mayAdd()) !== "ok" ? null : evidence.ask;
    // her look, logged for him under the switches the answer drew on (her one write; throttled like her pages' looks)
    if (her) {
      const items = [...new Set([HOLD_GRANT[body.subject_type], ...(evidence.shared ?? [])])];
      await logLook(store, session.id, { linkId: her.linkId, userId: her.userId, label: her.label, route: "/api/explain", items }, now);
    }

    // the one model call, for him: his day's spend is asked before it and settled after it
    const mayAsk = aiAllowed && !evidence.fixed;
    const spend = mayAsk ? personSpendFor(session) : null;
    const spendCapped = spend ? await spend.capped() : false;
    const llm = spend && !spendCapped ? spend.wrap(createMainLlm()) : undefined;
    const sentence = async (onWords?: (text: string) => void): Promise<VerdictResult> => {
      const said = await writeVerdict(evidence, { locale, aiAllowed, spendCapped, llm, ...(her ? { viewer: her.words } : {}), ...(onWords ? { onWords } : {}) });
      if (llm) await spend?.settle();
      return said;
    };
    const note = her ? holdWords(locale, her.words).disclaimer : null;
    const readWith = (said: VerdictResult, waiting = false): HoldRead => ({
      subject: evidence.subject,
      verdict: said.verdict,
      abstain: said.abstain,
      verdictBy: said.by,
      ...(said.why ? { verdictWhy: said.why } : {}),
      checked: evidence.checked,
      sources: evidence.sources,
      ask,
      answerId: evidence.answerId,
      // hers: the line under the sentence names him as she calls him
      ...(note ? { note } : {}),
      ...(waiting ? { waiting: true } : {}),
    });

    const asksModel = !!llm && llm.provider !== "mock";
    // SSE (owner 10-15, see the header): what Ripple looked at at once, then the sentence word by word, then the answer
    if (wantsEventStream(req.headers.get("accept"))) {
      const encoder = new TextEncoder();
      let closed = false;
      const stream = new ReadableStream<Uint8Array>({
        async start(controller) {
          const write = (frame: string) => {
            if (closed) return;
            try {
              controller.enqueue(encoder.encode(frame));
            } catch {
              closed = true;
            }
          };
          try {
            if (asksModel) {
              write(sseFrame("read", readWith({ verdict: evidence.verdict, abstain: evidence.abstain, by: "records" }, true)));
              write(sseFrame("stage", { stage: "writing" }));
            }
            let wrote = false;
            const said = await sentence((words) => {
              wrote = true;
              write(sseFrame("delta", { text: words }));
            });
            // the model's words were shown and the sentence built from his records stands instead: they are taken back
            if (wrote && said.by !== "model") write(sseFrame("retract", { why: said.why ?? "records" }));
            write(sseFrame("final", readWith(said)));
          } catch (e) {
            console.error("[api/explain] failed while streaming", (e as Error).message);
            write(sseFrame("error", { status: 500, error: "internal_error" }));
          } finally {
            closed = true;
            try {
              controller.close();
            } catch {
              // closed already
            }
          }
        },
        cancel() {
          // he closed the sheet: nobody is reading any more
          closed = true;
        },
      });
      return new Response(stream, { status: 200, headers: EVENT_STREAM_HEADERS });
    }
    // the sheet before 10-15: what Ripple looked at goes out at once, the sentence follows when the model has answered
    if (asksModel && (req.headers.get("accept") ?? "").includes(LINES)) {
      const encoder = new TextEncoder();
      const line = (read: HoldRead) => encoder.encode(JSON.stringify(read) + "\n");
      const stream = new ReadableStream<Uint8Array>({
        async start(controller) {
          try {
            controller.enqueue(line(readWith({ verdict: evidence.verdict, abstain: evidence.abstain, by: "records" }, true)));
            controller.enqueue(line(readWith(await sentence())));
          } catch {
            // he closed the sheet: nobody is reading any more
          } finally {
            try {
              controller.close();
            } catch {
              // closed already
            }
          }
        },
      });
      return new Response(stream, { headers: { "Content-Type": `${LINES}; charset=utf-8`, "Cache-Control": "no-store, no-transform", "X-Accel-Buffering": "no" } });
    }
    return Response.json(readWith(await sentence()), her ? { headers: { "Cache-Control": "no-store" } } : undefined);
  } catch (e) {
    if (e instanceof StoreError && e.code === "session_not_found") return Response.json({ error: "session_not_found" }, { status: 404 });
    console.error("[api/explain] failed", (e as Error).message);
    return Response.json({ error: "internal_error" }, { status: 500 });
  }
}
