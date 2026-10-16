/**
 * POST /api/me/example — the example account's own buttons (real-app 4.7; journey 22). Track C.
 *
 *   { action: "reseed" }         「重新铺一遍示例资料」: every record of his space goes, Mr Tan's six weeks are laid
 *                                 out again on today's dates (today is day 42 again), tracking from now
 *                                 -> 200 { href: "/p/today" }
 *   { action: "clear" }          「清空，从我自己的开始」: every record goes, the space becomes a blank one from today,
 *                                 setting up starts again -> 200 { href: "/onboard" }
 *   { action: "dismiss_intro" }  the one-time card on Today was read ("知道了") -> 200 { ok: true }
 * Both buttons keep his family links and their switches (people, not the timeline), and write an account_event. Files
 * he uploaded on the example are left unreferenced for the orphan sweep (track H).
 * His own account only (404 otherwise); the two buttons only while the account runs on the example (409 not_example).
 */
import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { publish } from "@/lib/bus";
import { LOCALE_COOKIE } from "@/lib/i18n";
import { consentStamp } from "@/lib/privacy/consents";
import { accountSelf } from "@/lib/profile/http";
import { jsonError, parseBody, storeErrorResponse } from "@/lib/session/http";
import { clearExample, reseedExample } from "@/lib/story/example";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const body = z.object({ action: z.enum(["reseed", "clear", "dismiss_intro"]) }).strict();

export async function POST(req: NextRequest): Promise<Response> {
  const found = await accountSelf(req);
  if (!found.ok) return found.res;
  const parsed = await parseBody(req, body);
  if (!parsed.ok) return parsed.res;
  const { store, session: scope, subject } = found;
  const action = parsed.data.action;
  try {
    if (action === "dismiss_intro") {
      await store.updateScope(scope.id, { settings: { example_intro_dismissed: true } });
      return NextResponse.json({ ok: true });
    }
    if (!scope.example_data) return jsonError(409, "not_example");
    const userId = subject.userId!;
    // files he uploaded on the example (a recording, a label photo) are no longer referenced by any row after this;
    // the orphan sweep (track H) removes them. Only the demo's reset deletes files directly (lib/how/trust.ts says so).
    if (action === "reseed") {
      await reseedExample(store, scope);
      await store.addAccountEvent(userId, "example_reseeded", {});
      publish(scope.id, "account.reseeded", "The example data was laid out again for today.", { kind: "example" });
      return NextResponse.json({ href: "/p/today" });
    }
    await clearExample(store, scope);
    await store.addAccountEvent(userId, "example_cleared", {});
    // C2 track H (only add): the record carries the version and sha256 of the example-data text he agreed to (real-app 3.11)
    const stamp = consentStamp("example_data", req.cookies.get(LOCALE_COOKIE)?.value === "en" ? "en" : "zh-Hans");
    await store.addConsentRecord({
      user_id: userId,
      scope_id: scope.id,
      kind: "example_data",
      decision: "withdrawn",
      method: "example_clear_button",
      version: stamp.version,
      text_sha256: stamp.text_sha256,
      evidence: { locale: stamp.locale },
    });
    publish(scope.id, "account.reseeded", "The example data was cleared: he starts from his own.", { kind: "blank" });
    return NextResponse.json({ href: "/onboard" });
  } catch (err) {
    return storeErrorResponse(err);
  }
}
