/**
 * POST /api/me/delete { password, confirm: true } — delete his account and everything in it (docs/plan/real-app.md
 * 3.11 删除账号; the elder brief 15.2: the app's only second-step confirmation; journey 15; C2 track H).
 *
 *   200 { ok: true }                 deleted; the sign-in cookies are cleared in the same answer
 *   400 confirm_required             the body did not carry confirm: true (the second screen sends it)
 *   401 not_signed_in | wrong_password
 *   423 locked { until }             the sixth wrong password in 15 minutes on this device (track A's lockout)
 *   503 storage_not_empty | storage_failed | identity_failed
 *                                    nothing more was deleted after the failing step; he can tap again
 *
 * The order (storage first and checked empty, the family links ended, his sessions and identity, the rows, the check
 * that nothing is left, one ops_run row with counts) is lib/privacy/delete.ts deleteAccountEverywhere.
 */
import type { NextRequest } from "next/server";
import { z } from "zod";
import { guardPost, json, requestFacts, signedOutResponse } from "@/lib/auth/http";
import { getBlobStore } from "@/lib/blob";
import { errorCode, log } from "@/lib/log";
import { confirmPassword, deleteAccountEverywhere } from "@/lib/privacy/delete";
import { parseBody } from "@/lib/session/http";
import { accountDeps, currentUser } from "@/lib/subject/account";
import { realNowMs } from "@/lib/time/now";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ROUTE = "/api/me/delete";
const schema = z.object({ password: z.string().max(200), confirm: z.boolean().optional() }).strict();

export async function POST(req: NextRequest): Promise<Response> {
  const t0 = realNowMs();
  const bad = guardPost(req);
  if (bad) return bad;
  // who is asking comes before what is asked (real-app 8.2: a request with no sign-in is 401, whatever its body)
  const me = await currentUser(req);
  if (!me) return json({ error: "not_signed_in" }, 401);
  const body = await parseBody(req, schema);
  if (!body.ok) return body.res;
  if (body.data.confirm !== true) return json({ error: "confirm_required" }, 400);
  const deps = { ...accountDeps(), blob: getBlobStore() };
  const done = (status: number, code?: string, counts?: Record<string, number>) =>
    log(status >= 500 ? "error" : "info", "me.delete", { route: ROUTE, method: "POST", status, ms: realNowMs() - t0, code, user: me.userId, counts });
  try {
    const check = await confirmPassword(deps, me, body.data.password, requestFacts(req));
    if (!check.ok) {
      done(check.status, check.error);
      const res = json(check.until ? { error: check.error, until: check.until } : { error: check.error }, check.status);
      if (check.until) res.headers.set("retry-after", String(Math.max(1, Math.ceil((Date.parse(check.until) - Date.now()) / 1000))));
      return res;
    }
    const r = await deleteAccountEverywhere(deps, me.userId, { reason: "user" });
    if (!r.ok) {
      done(r.status, r.error);
      return json({ error: r.error }, r.status);
    }
    done(200, r.counts.leftover ? "leftover" : "deleted", { ...r.counts });
    return signedOutResponse(req, { ok: true });
  } catch (err) {
    done(500, errorCode(err));
    return json({ error: "delete_failed" }, 500);
  }
}
