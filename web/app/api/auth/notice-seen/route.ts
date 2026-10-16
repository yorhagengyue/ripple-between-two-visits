/**
 * POST /api/auth/notice-seen { event } (signed in; docs/plan/real-app.md 2.4; track A): he tapped 「知道了」 on the line
 * his Today page shows after a password reset (lib/auth/notices.ts). Writes one account event reset_notice_seen naming
 * that reset, so the line has been said and does not come back. -> 200 { ok: true } (also when it was already
 * acknowledged). Refusals: 401 not_signed_in, 404 not_found (not one of his password resets).
 */
import type { NextRequest } from "next/server";
import { z } from "zod";
import { accountRoute, guardPost, json } from "@/lib/auth/http";
import { RESET_NOTICE_SEEN } from "@/lib/auth/notices";
import { parseBody } from "@/lib/session/http";
import { accountDeps, currentUser } from "@/lib/subject/account";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const schema = z.object({ event: z.string().min(1).max(80) }).strict();

export const POST = accountRoute(async (req: NextRequest): Promise<Response> => {
  const bad = guardPost(req);
  if (bad) return bad;
  const me = await currentUser(req);
  if (!me) return json({ error: "not_signed_in" }, 401);
  const body = await parseBody(req, schema);
  if (!body.ok) return body.res;
  const { store } = accountDeps();
  const events = await store.listAccountEvents(me.userId);
  if (!events.some((e) => e.id === body.data.event && e.kind === "password_reset")) return json({ error: "not_found" }, 404);
  if (!events.some((e) => e.kind === RESET_NOTICE_SEEN && e.detail?.event === body.data.event)) {
    await store.addAccountEvent(me.userId, RESET_NOTICE_SEEN, { event: body.data.event });
  }
  return json({ ok: true });
});
