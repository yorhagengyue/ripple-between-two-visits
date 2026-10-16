/**
 * /api/family/links/[id]/grants — his switches for one family member (C2 track D; real-app 2.19, 2.22, 3.10 开关).
 *   GET  -> { items, version, history: GrantVersionView[] }  (oldest version first, each with what it turned on / off)
 *   POST { items: { <switch>: boolean, ... }, assisted? } -> { items, version, updated_at }
 *        Only he changes them, from his own account, and only once he has confirmed her (the link is active). Each
 *        change is a new version (care_grant_history), a consent record (family_share, with the version and the
 *        switches; assisted when someone is helping him on his device) and family_grant.changed on his channel: her
 *        open page follows within a second (her stream takes only her own link's change).
 *   404 link_not_found, 409 link_not_active (nobody accepted yet, or he has not confirmed her), 409 link_closed (the
 *   link ended: he invites again).
 */
import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { publishGrantChange } from "@/lib/care/events";
import { careLocale, failureResponse, himOf, notFound, routeId } from "@/lib/care/http";
import { grantHistory, setLinkSwitches } from "@/lib/care/links";
import { NO_GRANTS } from "@/lib/family/types";
import { parseBody, storeErrorResponse } from "@/lib/session/http";
import { requireSubject } from "@/lib/subject";
import { careEntryStore } from "@/lib/subject/care";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const items = z
  .object({
    dose_summary: z.boolean(),
    bp_summary: z.boolean(),
    questions_count: z.boolean(),
    no_reply_alert: z.boolean(),
    visit_transcripts: z.boolean(),
    notes: z.boolean(),
  })
  .partial()
  .strict()
  .refine((x) => Object.keys(x).length > 0, { message: "at least one switch" });

const body = z.object({ items, assisted: z.boolean().optional() }).strict();

export async function GET(req: NextRequest, ctx: { params: Promise<{ id: string }> }): Promise<Response> {
  const found = await requireSubject(req);
  if (!found.ok) return found.res;
  const him = himOf(found.subject);
  if (!him) return notFound();
  try {
    const id = await routeId(ctx);
    const link = await found.store.getCareLink(id).catch(() => null);
    if (!link || link.patient_id !== him.userId) return NextResponse.json({ error: "link_not_found" }, { status: 404 });
    const grant = await found.store.getFamilyGrant(found.session.id, id);
    return NextResponse.json({ items: { ...NO_GRANTS, ...(grant?.items ?? {}) }, version: grant?.version ?? 1, history: await grantHistory(found.store, id) });
  } catch (err) {
    return storeErrorResponse(err);
  }
}

export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }): Promise<Response> {
  const found = await requireSubject(req);
  if (!found.ok) return found.res;
  const him = himOf(found.subject);
  if (!him) return notFound();
  const b = await parseBody(req, body);
  if (!b.ok) return b.res;
  try {
    const id = await routeId(ctx);
    const r = await setLinkSwitches(found.store, found.session, him.userId, id, b.data.items, careLocale(req), (grant, changed) => publishGrantChange(found.session.id, grant, changed), { texts: careEntryStore(), assisted: b.data.assisted });
    if (!r.ok) return failureResponse(r);
    return NextResponse.json({ items: r.grant.items, version: r.grant.version ?? 1, updated_at: r.grant.updated_at });
  } catch (err) {
    return storeErrorResponse(err);
  }
}
