/**
 * POST /api/family/bind/seen — 「知道了」: he acknowledges a link a family member bound by typing his account (line bind;
 * lib/care/bind.ts acknowledgeLink, lib/care/ack.ts for what it opens).
 *   body { link, assisted? }   his own link; assisted: someone is helping him on his device right now
 *   200 { ok: true }: his family_share granted record (method direct_bind_ack) names the link from now on, so her voice
 *       reminder and what she adds to his details are no longer refused. Written once: a second tap, or a link he has
 *       acknowledged another way (he bound it himself, he confirmed an invitation, he changed a switch), writes nothing.
 *   404 link_not_found (not his link; a family member's own account: 404 no_profile), 409 link_not_active (nobody is
 *   bound yet), 409 link_closed (the link has ended), 401 not_signed_in.
 * His own account only.
 */
import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { acknowledgeLink } from "@/lib/care/bind";
import { careLocale, failureResponse, himOf, notFound } from "@/lib/care/http";
import { parseBody, storeErrorResponse } from "@/lib/session/http";
import { requireSubject } from "@/lib/subject";
import { careEntryStore } from "@/lib/subject/care";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const body = z.object({ link: z.string().trim().min(1).max(100), assisted: z.boolean().optional() }).strict();

export async function POST(req: NextRequest): Promise<Response> {
  const found = await requireSubject(req);
  if (!found.ok) return found.res;
  const him = himOf(found.subject);
  if (!him) return notFound();
  const b = await parseBody(req, body);
  if (!b.ok) return b.res;
  try {
    const r = await acknowledgeLink(found.store, found.session, him.userId, b.data.link, careLocale(req), { texts: careEntryStore(), assisted: b.data.assisted });
    return r.ok ? NextResponse.json({ ok: true }) : failureResponse(r);
  } catch (err) {
    return storeErrorResponse(err);
  }
}
