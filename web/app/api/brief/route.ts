/**
 * GET /api/brief — the visit brief's data (spec section 2; task M7): exactly what /p/brief renders, from the same
 * lib/summary/brief.ts buildBrief, after the same two idempotent steps the page runs first (settle doses whose
 * reminder window closed with no answer; bring the routine-pattern question up to date).
 *   ?locale=en|zh-Hans  question wording and medicine names; else the rp_lang cookie; else zh-Hans (like the page)
 *   200 { brief: BriefView }   Cache-Control: no-store
 *   400 no_session, 404 session_not_found, 403 patient_only for Wei Ling (family role)
 *
 * Story-day gating is buildBrief's: nothing after session.story_day is read (readings, doses, notes, questions,
 * medicines, R1), and a question stays in the brief until its answer has been said by the story moment (10-10).
 *
 * An account (C2 track B, journey 14): lib/summary/account-brief.ts buildAccountBrief: the window from the last clinic visit
 * that happened, the doctor's numbers he confirmed, readings above the warning line on their own lines, untracked cells
 * left out, his words in English when track S's checked translation exists (his AI consent permitting). Same shape plus
 * { kind: "account", date, above, targetLine, english, aiAllowed, nextVisit }.
 *
 * POST /api/brief { shown: "doctor" } — an account, when he opens 「给医生看」 (C2 track B, second round; e2e-chains 序 19):
 * keeps the brief as it is being shown (which day, to whom, which version, both languages) and stamps shown_at
 * (lib/summary/brief-snapshot.ts). The same version shown again that day is the same row. 200 { shown: { id, date,
 * version, shown_at, created } }; the demo: 404; Wei Ling: 403 patient_only.
 *
 * Who may read it: Mr Tan's side (patient, a judge's own sandbox, or a request with no role) and the crew screens.
 * Wei Ling does not: the brief carries his notes word for word and his blood pressure numbers, which she sees only
 * when he switches them on, and none of his switches (lib/family/types GRANT_KEYS) covers the brief. If a switch for
 * the brief is added there, read it here (lib/family/grants readGrants) and let her through when it is on.
 */
import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { settleNoReply } from "@/lib/daily/doses";
import { isAccount } from "@/lib/store/scope";
import { buildAccountBrief } from "@/lib/summary/account-brief";
import { syncPatternQuestions } from "@/lib/daily/patterns";
import { denyFamily } from "@/lib/family/role";
import { DEFAULT_PATIENT_LOCALE, LOCALE_COOKIE, toLocale } from "@/lib/i18n";
import { jsonError, parseBody, storeErrorResponse } from "@/lib/session/http";
import { buildBrief } from "@/lib/summary/brief";
import { recordBriefShown } from "@/lib/summary/brief-snapshot";
import { requireSubject } from "@/lib/subject";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest): Promise<Response> {
  const found = await requireSubject(req);
  if (!found.ok) return found.res;
  const denied = await denyFamily(req, found.session);
  if (denied) return denied;
  const locale = toLocale(req.nextUrl.searchParams.get("locale") ?? req.cookies.get(LOCALE_COOKIE)?.value, DEFAULT_PATIENT_LOCALE);
  try {
    const store = found.store;
    await settleNoReply(store, found.session);
    await syncPatternQuestions(store, found.session);
    const brief = isAccount(found.session) ? await buildAccountBrief(store, found.session, locale, { translate: "model" }) : await buildBrief(store, found.session, locale);
    return NextResponse.json({ brief }, { headers: { "Cache-Control": "no-store" } });
  } catch (err) {
    return storeErrorResponse(err);
  }
}

const shownBody = z.object({ shown: z.literal("doctor") }).strict();

export async function POST(req: NextRequest): Promise<Response> {
  const found = await requireSubject(req);
  if (!found.ok) return found.res;
  if (!isAccount(found.session)) return jsonError(404, "not_found");
  const denied = await denyFamily(req, found.session);
  if (denied) return denied;
  const body = await parseBody(req, shownBody);
  if (!body.ok) return body.res;
  try {
    const homeLocale = toLocale(req.cookies.get(LOCALE_COOKIE)?.value, DEFAULT_PATIENT_LOCALE);
    const shown = await recordBriefShown(found.store, found.session, { homeLocale });
    return NextResponse.json({ shown: { id: shown.id, date: shown.date, version: shown.version, shown_at: shown.shownAt, created: shown.created } }, { headers: { "Cache-Control": "no-store" } });
  } catch (err) {
    return storeErrorResponse(err);
  }
}
