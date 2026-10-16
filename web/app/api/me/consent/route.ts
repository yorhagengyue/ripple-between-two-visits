/**
 * His AI-processing consent from 「我 → AI 处理」 (docs/plan/real-app.md 3.11, 2.23; journey 15; C2 track H).
 *
 *   GET  /api/me/consent                                   -> 200 { ai: { on, decision, at, version } }
 *   POST /api/me/consent { kind: "ai_processing", on, assisted? }
 *                                                          -> 200 { ai, changed }   a new consent record (granted, or
 *                                                             withdrawn) with the version and the sha256 of the text his
 *                                                             screen showed; the same state again writes nothing;
 *                                                             assisted: true when someone is helping him on his device
 *                                                             (the record keeps the flag and the note)
 *   401 not_signed_in
 *
 * aiConsent (lib/safety/consent.ts) reads the newest record on the next request: off means no model of any kind sees
 * his ask, and no translation. The other consent kinds are recorded where they are given (sign-up, the visit card, the
 * family links, a visit's 「一直保留」).
 */
import type { NextRequest } from "next/server";
import { z } from "zod";
import { guardPost, json } from "@/lib/auth/http";
import { publish } from "@/lib/bus";
import { LOCALE_COOKIE } from "@/lib/i18n";
import { errorCode, log } from "@/lib/log";
import { aiState, setAiConsent } from "@/lib/privacy/ai";
import { parseBody } from "@/lib/session/http";
import { requireUser } from "@/lib/subject";
import { accountDeps } from "@/lib/subject/account";
import { realNowMs } from "@/lib/time/now";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ROUTE = "/api/me/consent";
const schema = z.object({ kind: z.literal("ai_processing"), on: z.boolean(), locale: z.enum(["zh-Hans", "en"]).optional(), assisted: z.boolean().optional() }).strict();

export async function GET(req: NextRequest): Promise<Response> {
  const found = await requireUser(req);
  if (!found.ok) return found.res;
  return json({ ai: await aiState(found.store, found.user.userId) });
}

export async function POST(req: NextRequest): Promise<Response> {
  const t0 = realNowMs();
  const bad = guardPost(req);
  if (bad) return bad;
  // who is asking comes before what is asked (real-app 8.2: a request with no sign-in is 401, whatever its body)
  const found = await requireUser(req);
  if (!found.ok) return found.res;
  const body = await parseBody(req, schema);
  if (!body.ok) return body.res;
  const { user, scope, store } = found;
  const locale = body.data.locale ?? (req.cookies.get(LOCALE_COOKIE)?.value === "en" ? "en" : "zh-Hans");
  try {
    const r = await setAiConsent({ store, texts: accountDeps().store }, { userId: user.userId, scopeId: scope?.id ?? null, on: body.data.on, locale, assisted: body.data.assisted === true });
    if (r.changed && scope) {
      publish(scope.id, "consent.recorded", `AI processing ${r.state.on ? "switched on" : "switched off"} on his Me screen`, {
        kind: "ai_processing",
        decision: r.state.decision,
        version: r.state.version,
      });
    }
    log("info", "me.consent", { route: ROUTE, method: "POST", status: 200, ms: realNowMs() - t0, code: r.state.on ? "ai_on" : "ai_off", user: user.userId, counts: { changed: r.changed ? 1 : 0 } });
    return json({ ai: r.state, changed: r.changed });
  } catch (err) {
    log("error", "me.consent", { route: ROUTE, method: "POST", status: 500, ms: realNowMs() - t0, code: errorCode(err), user: user.userId });
    return json({ error: "consent_failed" }, 500);
  }
}
