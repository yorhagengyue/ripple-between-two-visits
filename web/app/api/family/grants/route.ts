/**
 * /api/family/grants — what Wei Ling can see (spec section 2, task M6 item 2).
 *   GET  -> { member: "wei-ling", items: { dose_summary, bp_summary, questions_count, no_reply_alert,
 *            visit_transcripts, notes }, updated_at }  (a device in the session may read the switches; Wei Ling's
 *            phone, a stranger and a request with no device get 403 at the proxy gate, lib/family/gate.ts)
 *   POST { items: { <switch>: boolean, ... } } -> 200 { member, items, updated_at }
 *        Only Mr Tan changes them: the family role (and backstage, director) gets 403 patient_only
 *        (lib/family/role.ts). Merges the given switches and publishes family_grant.changed with the whole row,
 *        so an open /f follows: within 1 s on the in-memory store; on STORE=supabase (Tokyo database) switching off
 *        stays under 1 s and switching on takes up to 2 s (her page re-reads GET /api/family/view), which Gengyue
 *        accepted for this wave on 10-10 (real accounts and a Singapore database come later).
 * Session: ?session= or cookie rp_session.
 * A real account (C2 track D): 404 use_links. His switches belong to each family member's link there:
 * /api/family/links/[id]/grants (never the demo's single "wei-ling" row).
 */
import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { readGrants, setGrants } from "@/lib/family/grants";
import { denyNonPatient } from "@/lib/family/role";
import { FAMILY_MEMBER } from "@/lib/family/types";
import { parseBody, storeErrorResponse } from "@/lib/session/http";
import { requireSubject } from "@/lib/subject";

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

const grantBody = z.object({ items, member: z.literal(FAMILY_MEMBER).optional() }).strict();

export async function GET(req: NextRequest): Promise<Response> {
  const found = await requireSubject(req);
  if (!found.ok) return found.res;
  if (found.subject.kind === "account") return NextResponse.json({ error: "use_links" }, { status: 404 });
  try {
    return NextResponse.json(await readGrants(found.store, found.session));
  } catch (err) {
    return storeErrorResponse(err);
  }
}

export async function POST(req: NextRequest): Promise<Response> {
  const found = await requireSubject(req);
  if (!found.ok) return found.res;
  if (found.subject.kind === "account") return NextResponse.json({ error: "use_links" }, { status: 404 });
  const denied = await denyNonPatient(req, found.session);
  if (denied) return denied;
  const body = await parseBody(req, grantBody);
  if (!body.ok) return body.res;
  try {
    const store = found.store;
    const grant = await setGrants(store, found.session, body.data.items);
    return NextResponse.json({ member: grant.member, items: grant.items, updated_at: grant.updated_at });
  } catch (err) {
    return storeErrorResponse(err);
  }
}
