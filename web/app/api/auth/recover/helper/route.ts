/**
 * /api/auth/recover/helper (signed in; docs/plan/real-app.md 2.4, 3.6; track A): his switch 「忘记密码时，让 Wei Ling 帮我」.
 *   GET  -> 200 { helpers: [{ link_id, label, relation, on }] }: his active family members, each with its switch (all
 *           off until he turns one on).
 *   POST { link_id, on, locale? } -> 200 { helper }: the switch of one of HIS active links. A change writes a consent
 *           record family_reset_helper (granted / withdrawn, with the version and hash of the text his screen shows:
 *           lib/privacy/consent-texts-more.ts, written through lib/privacy/consents.ts) and an account event. 404 link_not_found (no such link, or not his),
 *           409 link_not_active.
 * Refusals: 401 not_signed_in. Nothing here is reachable through a family link: only his own token changes it.
 */
import type { NextRequest } from "next/server";
import { z } from "zod";
import { listResetHelpers, setResetHelper } from "@/lib/auth/family-reset";
import { accountRoute, guardPost, json, refusal } from "@/lib/auth/http";
import { parseBody } from "@/lib/session/http";
import { accountDeps, currentUser } from "@/lib/subject/account";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const schema = z.object({ link_id: z.string().uuid(), on: z.boolean(), locale: z.enum(["zh-Hans", "en"]).optional() }).strict();

export const GET = accountRoute(async (req: NextRequest): Promise<Response> => {
  const me = await currentUser(req);
  if (!me) return json({ error: "not_signed_in" }, 401);
  return json({ helpers: await listResetHelpers(accountDeps(), me) });
});

export const POST = accountRoute(async (req: NextRequest): Promise<Response> => {
  const bad = guardPost(req);
  if (bad) return bad;
  const me = await currentUser(req);
  if (!me) return json({ error: "not_signed_in" }, 401);
  const body = await parseBody(req, schema);
  if (!body.ok) return body.res;
  const r = await setResetHelper(accountDeps(), me, body.data);
  return r.ok ? json({ helper: r.helper }) : refusal(r);
});
