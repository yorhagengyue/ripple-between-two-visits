/**
 * GET /api/family/view — Wei Ling's view of Mr Tan's week (task M6 item 1): only the sections he has switched on.
 *
 * Demo (judge sandbox, crew filming session): as before, lib/family/view.ts
 *   { day, grants, generatedAt, doses?, bp?, questions?, visits?, notes? }
 * Each read first settles doses whose reminder window closed with no answer (lib/daily/doses.ts), like the daily
 * screens, so the counts match his Today screen. The switches are read while that settles (they do not depend on
 * it), then every switched-on section is built at once (lib/family/view.ts): fewer round trips under STORE=supabase.
 *
 * Her real account (C2 track D, ?link=<her care link>): her home, lib/care/home.ts FamilyHomeData: today's state, the
 * timeline, the week, the counts, the no-reply alert, each only while his switch for her link is on. Her read writes
 * nothing of his (no settling: the scheduled job does that) except her own access-log row (lib/care/access-log.ts,
 * at most one per ten minutes for the same sections). His own account: 404 (his data is on his own pages).
 * The copy says which change of his switches it was built at (grantsVersion): her page drops a copy that is older than
 * a change it has already shown, so a read that was on its way when he switched something off cannot bring it back.
 */
import { NextResponse, type NextRequest } from "next/server";
import { herHomeNow } from "@/lib/care/home";
import { settleNoReply } from "@/lib/daily/doses";
import { readGrants } from "@/lib/family/grants";
import { familyView } from "@/lib/family/view";
import { storeErrorResponse } from "@/lib/session/http";
import { requireSubject } from "@/lib/subject";
import { nowMs } from "@/lib/time/now";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest): Promise<Response> {
  // her care link (?link=): his space, read only, through the switches of her link
  const found = await requireSubject(req, { allowFamily: true });
  if (!found.ok) return found.res;
  try {
    const store = found.store;
    const link = found.subject.link;
    if (found.subject.kind === "account") {
      if (found.subject.relation !== "family" || !link || !found.subject.userId) return NextResponse.json({ error: "not_found" }, { status: 404 });
      // her switches, her sections and her look, in two rounds of calls (lib/care/home.ts herHomeNow); the copy says when
      // her link waits for the family text in force (her store has cut the switches: lib/care/reconsent.ts)
      return NextResponse.json(await herHomeNow(store, found.session, { link, userId: found.subject.userId, consent: found.subject.consent }, nowMs()), { headers: { "Cache-Control": "no-store" } });
    }
    // a family read writes nothing of his: no settling of "no reply" here (the scheduled job does it on an account)
    const [, grants] = await Promise.all([link ? null : settleNoReply(store, found.session), readGrants(store, found.session, link?.id)]);
    return NextResponse.json(await familyView(store, found.session, { grants: grants.items }), { headers: { "Cache-Control": "no-store" } });
  } catch (err) {
    return storeErrorResponse(err);
  }
}
