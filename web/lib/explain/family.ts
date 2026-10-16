/**
 * A family member's long press, the part the two routes share (owner's decision of 2026-10-14: 「长按进入 AI 在家属端也
 * 要有」; POST /api/explain?link= reads, POST /api/explain/add?link= puts a question on his list). Server-only.
 *
 * She reaches his records through her active care link (lib/subject requireSubject with allowFamily: the store is his
 * space, read-only), cut by his switches for that link, read from the store on every request:
 *
 *   herViewer(found)   who she is (lib/care/http.ts herOf), his switches for her link (lib/family/grants.ts readGrants)
 *                      and how she calls him (lib/care/copy.ts dadWord: the link's word, else 爸爸 / Dad), as the viewer
 *                      lib/explain/evidence.ts cuts by. null: this request is not a family member's
 *   mayHold            a thing of a type whose switch is off is not hers to hold (subjects.ts HOLD_GRANT): the routes
 *                      answer 404 not_found, the same as for a thing that does not exist
 *   mayAdd()           may she put a question on his list from the sheet? Only while he shares his questions with her
 *                      AND has acknowledged her link (lib/care/ack.ts: a link she bound herself by typing his account
 *                      reaches his phone with nothing of hers until he answers; POST /api/family/questions holds the
 *                      same two rules). His acknowledgement is read through binding's narrow store, and only when the
 *                      switch is on
 */
import { linkAcknowledged } from "@/lib/care/ack";
import { dadWord } from "@/lib/care/copy";
import { herOf } from "@/lib/care/http";
import { readGrants } from "@/lib/family/grants";
import type { Store } from "@/lib/store/types";
import type { Subject } from "@/lib/subject";
import { bindEntryStore } from "@/lib/subject/bind";
import type { EvidenceViewer } from "./evidence";
import { familyMayHold, type HoldLocale, type HoldType, type WordsViewer } from "./subjects";

export interface HerViewer {
  userId: string;
  linkId: string;
  /** her label as he named her, for his access log */
  label: string | null;
  /** what lib/explain/evidence.ts cuts by */
  evidence: Extract<EvidenceViewer, { kind: "family" }>;
  /** what the words are written for (lib/explain/copy.ts, verdict.ts) */
  words: Extract<WordsViewer, { kind: "family" }>;
  mayHold: (type: HoldType) => boolean;
  /** "ok", or why not: he does not share his questions with her, or he has not acknowledged her link yet */
  mayAdd: () => Promise<"ok" | "not_shared" | "link_not_acknowledged">;
}

/** The family member behind a request and what he shares with her now, or null when it is not a family member's. */
export async function herViewer(found: { subject: Subject; session: { id: string }; store: Pick<Store, "getFamilyGrant"> }, locale: HoldLocale): Promise<HerViewer | null> {
  const her = herOf(found.subject);
  const link = found.subject.link;
  if (!her || !link) return null;
  const grants = (await readGrants(found.store, found.session, her.linkId)).items;
  const dad = dadWord(her.patientLabel, locale);
  return {
    userId: her.userId,
    linkId: her.linkId,
    label: her.label,
    evidence: { kind: "family", grants, dad, linkId: her.linkId },
    words: { kind: "family", dad },
    mayHold: (type) => familyMayHold(type, grants),
    mayAdd: async () => (!grants.questions_count ? "not_shared" : (await linkAcknowledged(bindEntryStore(), link)) ? "ok" : "link_not_acknowledged"),
  };
}
