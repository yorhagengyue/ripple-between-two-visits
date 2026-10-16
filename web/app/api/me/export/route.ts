/**
 * His data as one file (docs/plan/real-app.md 3.11 导出; journey 15; C2 track H).
 *
 *   GET  /api/me/export   -> 200 { limit: 3, used, left, resets_at }            how many exports are left today
 *   POST /api/me/export   -> 200 the file itself: application/json, Content-Disposition attachment;
 *                            filename="ripple-export-<his date>.json"; headers X-Ripple-Export-Left (today's exports
 *                            left), X-Ripple-Links-Expire (when the file's recording and photo links stop working)
 *                         -> 429 { error: "export_limit", until } (Retry-After) after 3 today
 *                         -> 401 not_signed_in
 *
 * The file is made for this request and handed over; nothing is kept on the server (lib/privacy/export.ts). Signed in
 * as himself only (a family member exports her own account and links the same way, without a space). The daily count
 * and the operators' read log live outside any scope binding: they use the process-wide store from
 * lib/subject/account.ts, like track A's account routes.
 */
import type { NextRequest } from "next/server";
import { guardPost, json } from "@/lib/auth/http";
import { tokenClaims } from "@/lib/auth/jwt";
import { loginOf, loginShown } from "@/lib/auth/service";
import { getBlobStore } from "@/lib/blob";
import { errorCode, log } from "@/lib/log";
import { EXPORT_LIMIT_PER_DAY, exportAllowance, runExport } from "@/lib/privacy/export";
import { requireUser } from "@/lib/subject";
import { accountDeps } from "@/lib/subject/account";
import { nowMs, realNowMs } from "@/lib/time/now";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ROUTE = "/api/me/export";

export async function GET(req: NextRequest): Promise<Response> {
  const found = await requireUser(req);
  if (!found.ok) return found.res;
  const a = await exportAllowance(accountDeps().store, { userId: found.user.userId, scope: found.scope }, { nowMs: nowMs() });
  return json({ limit: EXPORT_LIMIT_PER_DAY, used: a.used, left: a.left, resets_at: a.resetsAt });
}

export async function POST(req: NextRequest): Promise<Response> {
  const t0 = realNowMs();
  const bad = guardPost(req);
  if (bad) return bad;
  const found = await requireUser(req);
  if (!found.ok) return found.res;
  const { user, scope, store } = found;
  const deps = accountDeps();
  try {
    const login = loginOf(user.account, tokenClaims(req.cookies.get("rp_at")?.value ?? "").email);
    const r = await runExport(
      { own: store, admin: deps.store, auth: deps.auth, blob: getBlobStore() },
      { userId: user.userId, account: user.account, scope, login: login ? loginShown(login) : null, origin: req.nextUrl.origin },
      { nowMs: nowMs(), realNowMs: realNowMs() },
    );
    if (!r.ok) {
      log("info", "me.export", { route: ROUTE, method: "POST", status: 429, ms: realNowMs() - t0, code: r.error, user: user.userId });
      const res = json({ error: r.error, until: r.until }, 429);
      res.headers.set("retry-after", String(Math.max(1, Math.ceil((Date.parse(r.until) - nowMs()) / 1000))));
      return res;
    }
    log("info", "me.export", { route: ROUTE, method: "POST", status: 200, ms: realNowMs() - t0, user: user.userId, counts: { files: r.file.files, rows: r.file.rows, left: r.left } });
    return new Response(r.file.json, {
      status: 200,
      headers: {
        "content-type": "application/json; charset=utf-8",
        "content-disposition": `attachment; filename="${r.file.fileName}"`,
        "cache-control": "private, no-store",
        "x-ripple-export-left": String(r.left),
        "x-ripple-links-expire": r.file.linksExpireAt,
        "x-ripple-export-files": String(r.file.files),
        "x-ripple-export-name": r.file.fileName,
      },
    });
  } catch (err) {
    log("error", "me.export", { route: ROUTE, method: "POST", status: 500, ms: realNowMs() - t0, code: errorCode(err), user: user.userId });
    return json({ error: "export_failed" }, 500);
  }
}
