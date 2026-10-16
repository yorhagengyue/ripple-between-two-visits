"use client";

/**
 * 「留意」 of her bottom bar (owner 10-14): what is open, then what needs her attention, each item with a follow-up, and
 * one line for everything routine.
 *
 *   the top bar           the place's name and his date
 *   the open 「没回」      while two reminders stand unanswered today (the v3 draft's D2): 「爸爸还没回早上的药。」; the morning
 *                         as a timeline (8:45 her reminder, no answer; 9:15 once more, no answer; 9:45 marked 「没回」 and
 *                         she was told, on the amber bell); his last entry she may know of; ONE amber button,
 *                         「打电话给爸爸」 (D4: no number saved yet, the same button opens the bottom sheet,
 *                         components/family/CallDad.tsx); what Ripple will not do
 *   the record            his last 14 days as her switches allow them (lib/care/record.ts herRecord, drawn by
 *                         RecordFeed): the next planned visit; 「需要留意」, the items that need attention, each with
 *                         its follow-up (a question for his doctor she can put on his list with one tap, or the call
 *                         button); 「其余记录」, one line for the routine of his last 7 days and the way to her calendar
 *   the foot line         what he agreed to show; it opens the list of his switches
 *
 * 「加入问题单」: POST /api/family/questions names the item, the server builds the question again and adds it (the words
 * never travel from here). The card says 「已加入问题单」 at once, and the page is read again.
 *
 * Live, as before. When he answers after all, the open block goes by itself and his answer is routine (one more in the
 * line's count). When he switches a kind off, everything that switch was showing leaves the screen at once:
 * her home's copy through lib/care/hide.ts hideOff, the record's rows through allowedEntries; the fresh copies follow
 * (her home's from /api/family/view, the record's with the page itself, read again: router.refresh, as
 * components/family/HerLive.tsx does). Her link ending while this is open: the sentence of H1, as on her home.
 */
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { ConsentFoot, EmptyBlock, FamilyDock, FamilyScreen, FamilyTabs, FamilyTop, NoReplyAlert, familyTabHrefs } from "@/components/family-ui";
import { dateLine, privacyLine } from "@/lib/care/copy";
import { savedPhone } from "@/lib/care/device";
import { hc } from "@/lib/care/her-copy";
import { hideOff } from "@/lib/care/hide";
import { herPaths, homeHeadline, lastEntryWords, timelineItems } from "@/lib/care/her-view";
import type { FamilyHomeData } from "@/lib/care/home-types";
import type { HerRecord, RecordEntry } from "@/lib/care/record";
import type { Locale } from "@/lib/i18n";
import { familyCopy } from "@/lib/ui/copy";
import { CallDad } from "./CallDad";
// line bind (round two, only add): 「绑定另一位长辈」 on the screen that says her link is over
import { BindAgainButton } from "./BindAgain";
import { RecordFeed, allowedEntries, shownEntries, type AskState } from "./RecordFeed";
import { switchesOf, useFamilyStream } from "./useFamilyStream";
// the family texts asked again (owner 10-14, only add): the quiet line while her link waits for both of them
import { ReconsentLine } from "./Reconsent";
// owner 10-16 (only add): what he told Ripple that may need attention, whatever his switches (lib/care/told.ts)
import type { ToldNotice } from "@/lib/care/told";
import { ToldCard } from "./ToldCard";

/** Her home's copy without the moment it was built: two copies that say the same thing compare equal. */
const sameDay = (home: FamilyHomeData): string => JSON.stringify({ ...home, generatedAt: 0 });

export function AlertScreen({
  locale,
  linkId,
  since,
  tz,
  initial,
  record,
  langHref,
  dad,
  told = [],
}: {
  locale: Locale;
  linkId: string;
  since: number;
  tz: string;
  initial: FamilyHomeData;
  /**
   * owner 10-16: the notices 「爸爸跟 Ripple 说了一件可能要留意的事」 sent to her link (lib/care/told.ts toldNotices), newest
   * first. THE BASELINE: shown whatever his switches say (never cut by hideOff or allowedEntries); read again with the page
   */
  told?: readonly ToldNotice[];
  /** his record as the server built it with this page (lib/care/record.ts); a newer one arrives each time the page is read again */
  record: HerRecord;
  langHref: string;
  dad: string;
}) {
  const router = useRouter();
  const [home, setHome] = useState(initial);
  const [rec, setRec] = useState(record);
  const [given, setGiven] = useState(record);
  const [phone, setPhone] = useState<string | null>(null);
  /** where each tap on 「加入问题单」 stands, by item (the record says it itself once the page is read again) */
  const [asks, setAsks] = useState<Record<string, AskState | undefined>>({});
  const [ended, setEnded] = useState<false | "ended" | "gone">(false);
  const paths = herPaths(linkId);
  /** the newest change of his switches this screen has shown: a copy built before it is dropped (lib/care/hide.ts) */
  const seen = useRef(initial.grantsVersion ?? 0);
  /** her home's copy as last read, to tell when something of his changed without an event saying so */
  const lastRead = useRef(sameDay(initial));
  /** her link is over: the page is not read again (the server would send her to her home, away from the sentence that says so) */
  const over = useRef(false);
  useEffect(() => setPhone(savedPhone(linkId)), [linkId]);

  // the page was read again (router.refresh): the newer record is the one shown. What a switch that is off was showing
  // never comes back with it: the rows are cut by his switches as this screen knows them every time they are drawn
  if (record !== given) {
    setGiven(record);
    if (record.generatedAt >= rec.generatedAt) setRec(record);
  }

  /** The record again, with the page (the builder is the server's): after anything of his changed. */
  const reread = useCallback(() => {
    if (!over.current) router.refresh();
  }, [router]);

  /**
   * 「加入问题单」: the item's suggested question goes on his list. Only the item's id is sent: the server builds the
   * words again from his record, in this page's language.
   */
  const add = useCallback(
    async (entry: RecordEntry) => {
      setAsks((a) => ({ ...a, [entry.id]: "busy" }));
      try {
        const res = await fetch(`/api/family/questions?link=${encodeURIComponent(linkId)}&locale=${encodeURIComponent(locale)}`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          cache: "no-store",
          credentials: "same-origin",
          body: JSON.stringify({ entry: entry.id }),
        });
        if (!res.ok) throw new Error(String(res.status));
        setAsks((a) => ({ ...a, [entry.id]: "added" }));
        reread();
      } catch {
        setAsks((a) => ({ ...a, [entry.id]: "failed" }));
      }
    },
    [linkId, locale, reread],
  );

  const refetch = useCallback(
    async (alsoRecord: boolean) => {
      try {
        const res = await fetch(`/api/family/view?link=${encodeURIComponent(linkId)}`, { cache: "no-store", credentials: "same-origin" });
        if (res.status === 403 || res.status === 404) {
          over.current = true;
          return setEnded(res.status === 404 ? "gone" : "ended");
        }
        if (res.ok) {
          const next = (await res.json()) as FamilyHomeData;
          const version = next.grantsVersion ?? 0;
          if (version < seen.current) return; // read before his last change of the switches: not shown
          seen.current = version;
          setHome((prev) => (version >= (prev.grantsVersion ?? 0) && next.generatedAt >= prev.generatedAt ? next : prev));
          // a read nobody announced (the timer) found his day changed: the record is read again too
          const read = sameDay(next);
          const changed = read !== lastRead.current;
          lastRead.current = read;
          if (alsoRecord && changed) reread();
        }
      } catch {
        // keep what is shown
      }
    },
    [linkId, reread],
  );

  const live = useFamilyStream(ended ? null : linkId, since, {
    onEvent: (e) => {
      const switches = switchesOf(e);
      if (switches) {
        // a change this screen already shows (a connection's first frame says his switches as they are)
        if (switches.version !== null && switches.version <= seen.current) return;
        if (switches.version !== null) seen.current = switches.version;
        // what he switched off leaves the screen now; the fresh copies are read after
        setHome((prev) => hideOff(prev, switches.items, switches.version ?? undefined));
        setRec((prev) => {
          const grants = { ...prev.grants, ...switches.items };
          return { ...prev, grants, entries: allowedEntries(prev.entries, grants) };
        });
      }
      // the event says something of his changed: her home's copy and the record, side by side
      void refetch(false);
      reread();
    },
    onEnd: (by) => {
      over.current = true;
      setEnded(by === "gone" ? "gone" : "ended");
    },
  });
  useEffect(() => {
    const onFocus = () => {
      void refetch(false);
      reread();
    };
    window.addEventListener("focus", onFocus);
    const timer = setInterval(() => void refetch(true), 15_000);
    return () => {
      window.removeEventListener("focus", onFocus);
      clearInterval(timer);
    };
  }, [refetch, reread]);

  const nr = home.noReply;
  const open = !!nr && !nr.answeredSince;
  const yourVoice = home.reminder?.whose === "yours";
  const items = open ? timelineItems(home.timeline, { tz, locale, yourVoice, herWords: yourVoice ? (home.reminder?.text ?? null) : null, dad }) : [];
  const head = homeHeadline(home, dad, locale, tz);
  const state = ended ? ended : !nr ? "none" : nr.answeredSince ? "answered" : "no_reply";
  // his switches as this screen knows them (her home's copy: cut the moment he switches something off) decide the rows
  const rows = ended ? [] : shownEntries(rec.entries, home.grants);
  // the line that says all of it is what he agreed to share; it opens the list (F1). The last thing on the screen: at
  // the bottom of the phone while the record is short, after the last row once it is not
  const foot = (
    <ConsentFoot href={paths.shared} data-testid="open-shared" style={{ marginTop: "auto" }}>
      {privacyLine(dad, home.grants, locale)}
    </ConsentFoot>
  );
  return (
    <div className="contents" data-testid="family-alert" data-state={state} data-live={ended ? "closed" : live}>
      <FamilyScreen locale={locale} tabs={ended ? undefined : <FamilyTabs locale={locale} active="notice" hrefs={familyTabHrefs(paths)} />}>
        {ended ? (
          <>
            {/* her link ended while this screen was open: as on her home (H1, with 「我的」 at the top right: her own
                account's rows need no link in force); a link that is gone has no button and no 「我的」 */}
            <FamilyTop brand locale={locale} langHref={langHref} meHref={ended === "gone" ? undefined : paths.me} />
            <EmptyBlock title={ended === "gone" ? hc(locale, "goneTitle") : hc(locale, "endedTitle", { dad })} detail={ended === "gone" ? hc(locale, "goneBody") : hc(locale, "endedBody", { dad })} />
            {/* line bind (round two): with the quiet way back to the form 「填长辈的账号」, as on her home */}
            <FamilyDock foot="h">
              {ended !== "gone" && <CallDad linkId={linkId} locale={locale} dad={dad} phone={phone} variant="primary" onSaved={setPhone} />}
              <BindAgainButton locale={locale} />
            </FamilyDock>
          </>
        ) : (
          <>
            {/* 「留意」 of her bottom bar (owner 10-14): the top names the place and his date; the bar leads back home */}
            <FamilyTop title={familyCopy(locale, dad).tabs.notice} kicker={dateLine(home.today, locale)} locale={locale} langHref={langHref} />
            {/* the family texts asked again (only add): why only the alert shows while her link waits for both of them */}
            {home.reconsent && <ReconsentLine locale={locale} dad={dad} />}
            {/* owner 10-16: what he told Ripple that may need attention stands first, each with the way to open the
                conversation (the baseline: no switch decides it) */}
            {told.map((n) => (
              <ToldCard
                key={n.id}
                notice={n}
                today={home.today}
                tz={tz}
                locale={locale}
                dad={dad}
                href={`/f/alert/told?link=${encodeURIComponent(linkId)}&id=${encodeURIComponent(n.id)}`}
                call={<CallDad linkId={linkId} locale={locale} dad={dad} phone={phone} variant="secondary" onSaved={setPhone} />}
              />
            ))}
            {open && (
              // what is open stands first: D2 (and D4: without a saved number the button opens the bottom sheet)
              <NoReplyAlert
                locale={locale}
                dad={dad}
                title={head.title}
                timeline={items}
                lastEntry={lastEntryWords(home, locale, tz)}
                call={<CallDad linkId={linkId} locale={locale} dad={dad} phone={phone} variant="warn" onSaved={setPhone} />}
              />
            )}
            {/* then what needs attention, newest first, and one line for the rest; once he answers, the block above goes */}
            <RecordFeed
              entries={rows}
              today={home.today}
              locale={locale}
              tz={tz}
              dad={dad}
              linkId={linkId}
              grants={home.grants}
              acknowledged={rec.acknowledged}
              phone={phone}
              onPhone={setPhone}
              asks={asks}
              onAdd={(entry) => void add(entry)}
              calendarHref={familyTabHrefs(paths).week}
              shared={Object.values(home.grants).some(Boolean)}
            />
            {foot}
          </>
        )}
      </FamilyScreen>
    </div>
  );
}
