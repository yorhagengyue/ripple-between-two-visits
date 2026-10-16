/**
 * POST /api/family/questions?link=<her care link> — she puts a suggested question on his list (owner 10-14: a follow-up
 * on her 「留意」 that is neither Ripple's nor hers to settle is a question for his doctor, one tap away).
 *
 * { entry } -> the id of an item of her record (lib/care/record.ts RecordEntry.id). The server builds her record again,
 * in the language her page is in, finds that item's suggested question and adds those words: the browser never sends a
 * question's text, so nothing she types can reach his list this way.
 *   201 { outcome: "created", added: true }    a new question on his list, in her name (his list says 「家人加的」)
 *   200 { outcome: "merged" | "answered", added: true }
 *                                              the same words were there already (also: the item's follow-up is a
 *                                              question Ripple had put on his list: nothing is written), or the doctor
 *                                              has answered them
 *   200 { outcome: "aside", added: false }     he set these words aside on his list: nothing is put back
 *   400 invalid_body
 *   403 not_shared               his questions_count switch for her link is off: she cannot write to a list she is not shown
 *   404 entry_not_found          no such item now, or it has no suggested question (his switches or his records moved on)
 *   409 link_not_acknowledged    she bound the link herself and he has not answered yet: nothing of hers reaches his
 *                                phone until he does (lib/care/ack.ts, as for her recording and a fact she proposes)
 * Her care link only. His own account and the demo add through POST /api/questions: 404 here.
 */
import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { LINK_NOT_ACKNOWLEDGED, linkAcknowledged } from "@/lib/care/ack";
import { addFamilyQuestion } from "@/lib/care/family-questions";
import { herRecord } from "@/lib/care/record";
import { readGrants } from "@/lib/family/grants";
import { inputErrorResponse, requestLocale } from "@/lib/profile/http";
import { jsonError, parseBody } from "@/lib/session/http";
import { requireSubject } from "@/lib/subject";
import { bindEntryStore } from "@/lib/subject/bind";
import { nowMs } from "@/lib/time/now";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const addBody = z.object({ entry: z.string().min(1).max(200) }).strict();

const NO_STORE = { "Cache-Control": "no-store" };

export async function POST(req: NextRequest): Promise<Response> {
  const found = await requireSubject(req, { allowFamily: true });
  if (!found.ok) return found.res;
  const { link, userId } = found.subject;
  if (found.subject.kind !== "account" || found.subject.relation !== "family" || !link || !userId) return jsonError(404, "not_found");
  const body = await parseBody(req, addBody);
  if (!body.ok) return body.res;
  try {
    const grants = await readGrants(found.store, found.session, link.id);
    if (!grants.items.questions_count) return jsonError(403, "not_shared");
    if (!(await linkAcknowledged(bindEntryStore(), link))) return jsonError(409, LINK_NOT_ACKNOWLEDGED);
    // her record as it is now, under his switches as they are now: the words added are the ones the server builds
    const record = await herRecord(found.store, found.session, { link, userId, grants: grants.items, locale: requestLocale(req), acknowledged: true }, nowMs());
    const entry = record.entries.find((e) => e.id === body.data.entry);
    if (!entry?.ask) return jsonError(404, "entry_not_found");
    // these very words stand on his list already
    if (entry.ask.added) return NextResponse.json({ outcome: "merged", added: true }, { headers: NO_STORE });
    const r = await addFamilyQuestion(found.store, found.session, { linkId: link.id, userId, text: entry.ask.text, for: entry.ask.for });
    // he set these words aside: asking or not is his, so nothing is put back
    if (r.outcome === "aside") return NextResponse.json({ outcome: "aside", added: false }, { headers: NO_STORE });
    return NextResponse.json({ outcome: r.outcome, added: true }, { status: r.outcome === "created" ? 201 : 200, headers: NO_STORE });
  } catch (err) {
    return inputErrorResponse(err);
  }
}
