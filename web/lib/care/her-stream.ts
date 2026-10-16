/**
 * Her side of the live stream on a real account (C2 track D, the one-second fix round; real-app 2.22 「他关一项：她那边
 * 1 秒内跟着变」, 「她开着的页面 1 秒内显示『爸爸已经停止分享』」, 3.10 撤回). Server-only; GET /api/events?link= builds one per
 * stream (app/api/events/route.ts) and keeps the wiring, this module decides what goes to her and when.
 *
 * Why it exists: the first run on the hosted database (10-11) took 1.7 s from his 「停止分享」 to her screen and 4 s from
 * a switch to her week. Nothing was waiting on a timer; it was round trips in a row, each some tens of milliseconds:
 * his request made eight store calls before it published, the event was stored before it was delivered, her stream
 * read her link (twice) before sending anything, and then her page asked for its data again (23 calls, 10 deep). Now:
 *
 *   what takes something away goes first    his switch change and the end of her link are sent the moment this instance
 *                                            knows of them: straight from publish(), before the event is stored
 *                                            (lib/bus.ts subscribeEarly), and when they come from the table they are
 *                                            never held back for the link re-read (the event IS the news)
 *   the fresh copy follows                   after a switch change her stream builds her home and pushes it as
 *                                            `event: view`: her page does not have to ask (no request, no second
 *                                            look-up of who she is). One round of calls: every section, built from
 *                                            what the stream already holds (his scope row on today's date, the
 *                                            switches the event carried), while his scope, her link and her switches
 *                                            are read again to check exactly that, and her look is logged. If the
 *                                            check disagrees (he changed a setting, the switches moved) the copy is
 *                                            built again from what was just read. Only for a stream that asked for it
 *                                            (?view=1, her home), since each push is logged as a look at his day
 *   every copy carries its order             the link's grant version is on every switch frame and every copy of her
 *                                            home; the stream takes a change once and in order (lib/family/events.ts),
 *                                            the page drops a copy older than what it has shown
 *   a missed event is caught                 every few seconds, and before anything read from the table goes to her,
 *                                            her link AND her switches are read again (one round): a link that ended
 *                                            closes the stream, switches that changed are sent as if the event had come
 *
 * Bounds (L = one round trip to the database; the event's own steps on his side are in lib/care/links.ts):
 *   one server instance     his request reaches the store write after 3 L (the stop) or 4 L (a switch); her frame goes
 *                           out in the same tick. Nothing else is in the way: no poll, no timer. A section he switched
 *                           ON is on her screen one more L later (the pushed copy): 5 L from his tap.
 *   two instances           her stream may be held by the other one: the event is stored (1 L), found by that
 *                           instance's next read of the table (at most BUS_POLL_MS, 300 ms, plus the read in flight)
 *                           and sent at once. At L = 5 ms about 0.35 s at worst; at L = 80 ms up to 0.9 s.
 *   the event is lost       (its write failed, or the instance died after the store write): the re-read catches it in
 *                           at most LINK_CHECK_MS (3 s) plus one round.
 *
 * The family texts asked again (owner, 2026-10-14; lib/care/reconsent.ts). A stream opened while he or she has not
 * agreed to the family text in force follows her switches in the alert-only form (her store cuts what it reads, the
 * stream cuts what his events carry: lib/family/events.ts createFamilyStream), and every copy of her home it pushes says
 * so. Its re-read asks again whether both have agreed (binding's narrow store reads both people's records); once they
 * have, the stream ends with the renew frame (lib/guard/stream.ts): the browser comes straight back and the new stream
 * is not cut. A stream of a link in good standing reads nothing more.
 */
import type { BusEvent } from "@/lib/bus";
import { CLOSING_TYPES, type FamilyStream } from "@/lib/family/events";
import { NO_GRANTS } from "@/lib/family/types";
import { RENEW_FRAME } from "@/lib/guard/stream";
import type { CareLinkRow, FamilyGrantItems, FamilyGrantRow, SessionRow, Store } from "@/lib/store/types";
import { bindEntryStore } from "@/lib/subject/bind";
import { projectScope } from "@/lib/time/clock";
import { nowMs } from "@/lib/time/now";
import { logLookAfter } from "./access-log";
import { familyHome, herHomeNow, shownSections } from "./home";
import { isHeld, linkConsent, type LinkConsent } from "./reconsent";

/** How often her stream reads her link and her switches again (the events tell it at once; this catches a missed one). */
export const LINK_CHECK_MS = 3000;

/** The SSE event name of a pushed copy of her home (components/family/useFamilyStream.ts listens for it). */
export const VIEW_EVENT = "view";

export interface HerSideInput {
  /** her store through her link (family mode: lib/subject/scoped-store.ts) */
  store: Store;
  /** his scope as the stream's request read it (its id is his user id; never sent to her) */
  scope: SessionRow;
  /** her link as the stream's request read it */
  link: CareLinkRow;
  userId: string;
  /** her switches as the stream follows them */
  stream: FamilyStream;
  /** the grant row the stream started from */
  grant: FamilyGrantRow | null;
  /** push her home after a switch change (her home asked: ?view=1) */
  pushView: boolean;
  /** whether each of them had agreed to the family text in force when the stream opened (the subject's; absent: both) */
  consent?: LinkConsent | null;
}

export interface HerCheck {
  /** what to send (a closing frame, or her switches as they are now); "" when there is nothing to say */
  frame: string;
  /** her link is over: the stream ends after the frame */
  end: boolean;
  /** her switches moved: a fresh copy of her home should follow */
  changed: boolean;
}

export interface HerSide {
  /** the stream's first frame: her switches as they are now, so a page that missed a change while it was not connected is put right at once */
  hello: string;
  /** an event that takes something away from her screen (his switch change, the end of her link): sent without waiting for anything */
  urgent(event: BusEvent): boolean;
  /** an event straight from this instance's publish, before it is stored (id 0): the frame to send now, or "" */
  early(event: BusEvent): string;
  /** her link and her switches, read again */
  check(): Promise<HerCheck | null>;
  /** her home as it is now, as one `event: view` frame; "" when it should not be sent (not asked for, her link is over, a newer change is on its way) */
  view(): Promise<string>;
  pushView: boolean;
  /** which change of her switches the stream is at (a frame that moved it is followed by a fresh copy of her home) */
  version(): number;
}

/** A frame with no `id:` line: it is not part of the stored sequence, so the browser's Last-Event-ID stays where it is. */
function frameOf(event: Omit<BusEvent, "id" | "session_id" | "say">, scopeId: string, name?: string): string {
  const text = `${name ? `event: ${name}\n` : ""}data: ${JSON.stringify({ id: 0, session_id: "", say: "", ...event })}\n\n`;
  return scopeId ? text.split(scopeId).join("") : text;
}

/** Her switches as a frame her page reads like the event itself. */
function switchesFrame(scopeId: string, linkId: string, items: FamilyGrantItems, version: number, at: string): string {
  return frameOf({ type: "family_grant.changed", at, data: { grant: { session_id: "", member: linkId, items, created_at: at, updated_at: at, version }, changed: {} } }, scopeId);
}

/** The closing frame when no event said so: who ended it is on the link row (or the row is gone with his account). */
function closingFrame(scopeId: string, linkId: string, link: CareLinkRow | null): string {
  const by = link === null ? "gone" : link.revoked_by === "family" ? "family" : "patient";
  return frameOf({ type: "care_link.revoked", at: new Date().toISOString(), data: { link: { id: linkId, status: link?.status ?? "revoked", by } } }, scopeId);
}

/** A scope row without what is computed for the moment it is read (an account's day and time of day). */
const stored = (row: SessionRow): string => JSON.stringify({ ...row, story_day: null, story_time: null });

export function herSide(input: HerSideInput): HerSide {
  const { store, userId, stream } = input;
  const scopeId = input.scope.id;
  const linkId = input.link.id;
  /** her link waited for the family text in force when the stream opened (lib/care/reconsent.ts) */
  const held = isHeld(input.consent);
  /** his scope row as last read from the store (the connection's, then each check's) */
  let scopeRow = input.scope;
  const her = (links: CareLinkRow[]) => links.find((l) => l.id === linkId) ?? null;
  const viewFrame = (home: unknown): string => {
    const text = `event: ${VIEW_EVENT}\ndata: ${JSON.stringify(home)}\n\n`;
    return scopeId ? text.split(scopeId).join("") : text;
  };

  return {
    pushView: input.pushView,
    version: () => stream.version(),
    hello: switchesFrame(scopeId, linkId, stream.grants(), stream.version(), input.grant?.updated_at ?? new Date().toISOString()),
    urgent: (event) => event.type === "family_grant.changed" || CLOSING_TYPES.has(event.type),
    early(event) {
      if (event.type !== "family_grant.changed" && !CLOSING_TYPES.has(event.type)) return "";
      // through the same filter as every event: another member's switches, another link's end, a change she already has
      const shown = stream.view(event).event;
      return shown ? frameOf({ type: shown.type, at: shown.at, data: shown.data }, scopeId) : "";
    },
    async check() {
      // her own links (one read: asking for a single link costs two on a scoped store) and her switches, together; while
      // her link waits for both of them to agree to the family text in force, whether they have now as well
      const [links, grant, consent] = await Promise.all([
        store.listCareLinks({ family_id: userId }).catch(() => undefined),
        store.getFamilyGrant(scopeId, linkId).catch(() => undefined),
        held ? linkConsent(bindEntryStore(), input.link).catch(() => null) : Promise.resolve(null),
      ]);
      if (links === undefined) return null; // could not read: keep going, the next check asks again
      const link = her(links);
      if (!link || link.status !== "active") return { frame: closingFrame(scopeId, linkId, link), end: true, changed: false };
      // both have agreed: this stream's switches are cut for its whole life, so it ends and the browser opens one that is not
      if (held && consent && !isHeld(consent)) return { frame: RENEW_FRAME, end: true, changed: false };
      if (grant && typeof grant.version === "number" && stream.adopt({ ...NO_GRANTS, ...grant.items }, grant.version)) {
        return { frame: switchesFrame(scopeId, linkId, stream.grants(), grant.version, grant.updated_at), end: false, changed: true };
      }
      return null;
    },
    async view() {
      if (!input.pushView || stream.closed()) return "";
      const now = nowMs();
      const version = stream.version();
      const grants = stream.grants();
      // his scope as the stream holds it, on the date and time it is now (lib/time/clock.ts: an account's day is counted, not stored)
      const guess = projectScope(scopeRow, now);
      const items = shownSections({ grants });
      // One round. Her home from what the stream holds; the three reads that check it; and her look, logged whenever
      // something of his is in the copy (no copy of his day leaves without it; one row per change he makes, so the
      // ten-minute rule for her own re-reads, which would cost a read first, is not applied here).
      const [fresh, links, grant, home] = await Promise.all([
        store.getSession(scopeId),
        store.listCareLinks({ family_id: userId }),
        store.getFamilyGrant(scopeId, linkId),
        familyHome(store, guess, { link: input.link, grants, version, consent: input.consent }, now),
        items.length ? logLookAfter(store, scopeId, { linkId, userId, label: input.link.family_label, route: "/f", items }, now, []) : Promise.resolve(false),
      ]);
      const link = her(links);
      if (!fresh || !link || link.status !== "active") return ""; // the check, or the closing event, ends the stream
      // his switches moved while this was read: that change sends its own copy
      if (stream.closed() || stream.version() !== version) return "";
      const same = stored(fresh) === stored(scopeRow) && (grant?.version ?? 0) === version;
      scopeRow = fresh;
      if (same) return viewFrame(home);
      // what the copy was built from is not what the store says now (a setting of his, or switches the stream had not
      // heard of): built again from what was just read, the ordinary way (lib/care/home.ts herHomeNow)
      const again = await herHomeNow(store, fresh, { link, userId, consent: input.consent }, now);
      if (stream.closed() || again.grantsVersion < stream.version()) return "";
      stream.adopt(again.grants, again.grantsVersion);
      return viewFrame(again);
    },
  };
}
