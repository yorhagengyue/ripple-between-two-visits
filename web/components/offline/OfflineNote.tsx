"use client";

/**
 * What waits on this phone, on the pages that can record without a network (C2 track O; real-app 2.25: Today and blood
 * pressure). Built from components/ui in the timeline design's look (front-end line fe-12; the draft's 通用-3 for the
 * no-network box): words on every button, nothing judged, no medicine name.
 *
 *   no network     a grey box: 「现在没有网络。」 over 「在这一页记下的，连上网就发出去。」 (one fixed sentence, split
 *                  into the box's title and its line) while the browser says so
 *   waiting        「已记下（等连网）」 over a white card, one row per entry: the part of the day's medicine, when he
 *                  tapped, his answer on the right (two medicines of the same slot answered together read as one row:
 *                  no medicine is named here); a reading with its numbers as he typed them. `removable` (the blood
 *                  pressure page) adds 「删掉这一条」 under a reading that has not left the phone, so a mistyped one can
 *                  be taken out (`onTakeOut` tells the page which one)
 *   refused        a box with the red border per entry the server did not take: 「没有记上」, which entry, the reason
 *                  in fixed words, and 「知道了」 to put it away. Nothing leaves this list by itself
 * Renders nothing while there is a network and nothing waits. What it does is unchanged from track O's: only the look.
 *
 * Test hooks: offline-note (data-offline, data-waiting, data-refused), offline-line, outbox-waiting, outbox-entry
 * (data-kind, data-state), outbox-refused, outbox-put-away, outbox-take-out.
 */
import { Box, Button, ListCard, ListItem, SecondaryButton } from "@/components/ui";
import { clockWords, dateWords, dt, type DailyKey } from "@/lib/daily/i18n";
import type { Locale } from "@/lib/i18n";
import { takeOut, tapNow } from "@/lib/offline/client";
import { offlineCopy, type OfflineCopy } from "@/lib/offline/copy";
import type { OutboxEntry } from "@/lib/offline/outbox";
import { localDate, localHHMM } from "@/lib/time/clock";
import { useNoNetwork, useOfflineKit, useOutbox } from "./OfflineProvider";
import "./offline-note.css";

const SLOTS = new Set(["morning", "midday", "evening", "night"]);

function words(c: OfflineCopy, locale: Locale, e: OutboxEntry, tz: string): { label: string; value: string } {
  const tapped = Date.parse(e.at);
  const day = localDate(tapped, tz);
  // an entry of another day says which day (「10月13日 周二 · 早上 8:46」); today's only the time
  const time = `${day === localDate(tapNow(), tz) ? "" : `${dateWords(locale, day)} · `}${clockWords(locale, localHHMM(tapped, tz))}`;
  if (e.label.kind === "dose") {
    const slot = SLOTS.has(e.label.slot) ? dt(locale, `slotMed.${e.label.slot}` as DailyKey) : e.label.slot;
    const said = e.label.state === "taken" ? c.taken : e.label.state === "missed" ? c.missed : c.later;
    return { label: `${slot} · ${time}`, value: said };
  }
  const reading = e.label.systolic !== null && e.label.diastolic !== null ? `${e.label.systolic}/${e.label.diastolic}` : c.notMeasured;
  return { label: `${c.bp} · ${time}`, value: e.label.pulse ? `${reading} · ${c.pulse(e.label.pulse)}` : reading };
}

/**
 * A fixed sentence of two as a box's title and its line: 「现在没有网络。」 and what follows it. The text is not changed:
 * the two parts read one after the other are the sentence as lib/offline/copy.ts has it (the second keeps its space).
 */
export function titleAndLine(sentence: string): [string, string] {
  const m = /^(.*?[。．.!?！？])(\s*\S.*)$/.exec(sentence);
  return m ? [m[1], m[2]] : [sentence, ""];
}

export function OfflineNote({ locale, tz, removable = false, onTakeOut }: { locale: Locale; tz: string; removable?: boolean; onTakeOut?: (id: string) => void }) {
  const kit = useOfflineKit();
  const entries = useOutbox();
  const noNetwork = useNoNetwork();
  const c = offlineCopy(locale);
  const refused = entries.filter((e) => e.state === "refused");
  // medicine answers that read the same (same slot, same minute, same answer) are one line
  const seen = new Set<string>();
  const waiting = entries.filter((e) => {
    if (e.state !== "waiting") return false;
    if (e.kind !== "dose") return true;
    const w = words(c, locale, e, tz);
    const line = `${w.label}|${w.value}`;
    if (seen.has(line)) return false;
    seen.add(line);
    return true;
  });
  const waitingCount = entries.filter((e) => e.state === "waiting").length;
  if (!noNetwork && !waiting.length && !refused.length) return null;
  const [lineTitle, lineRest] = titleAndLine(c.noNetwork);
  return (
    <div className="rpu rpu-stack rp12-offline" data-testid="offline-note" data-offline={noNetwork ? "true" : "false"} data-waiting={waitingCount} data-refused={refused.length}>
      {noNetwork ? (
        <div role="status" data-testid="offline-line">
          <Box variant="grey" title={lineTitle}>
            {lineRest || undefined}
          </Box>
        </div>
      ) : null}
      {waiting.length ? (
        <ListCard heading={c.waiting} testId="outbox-waiting">
          {waiting.map((e) => {
            const w = words(c, locale, e, tz);
            return (
              <div key={e.id} className="rp12-out" data-testid="outbox-entry" data-kind={e.kind} data-state="waiting" data-at={e.at}>
                <ListItem title={w.label} right={w.value} />
                {removable && e.kind === "bp" ? (
                  <div className="rp12-out-act">
                    <Button
                      variant="danger-outline"
                      data-testid="outbox-take-out"
                      onClick={() => {
                        if (takeOut(kit, e.id)) onTakeOut?.(e.id);
                      }}
                    >
                      {c.takeOut}
                    </Button>
                  </div>
                ) : null}
              </div>
            );
          })}
        </ListCard>
      ) : null}
      {refused.length ? (
        <div className="rpu-stack" data-testid="outbox-refused" role="alert">
          {refused.map((e) => {
            const w = words(c, locale, e, tz);
            return (
              <div key={e.id} data-testid="outbox-entry" data-kind={e.kind} data-state="refused" data-why={e.why ?? ""}>
                <Box variant="red" title={c.refused}>
                  <p className="rp12-out-what">
                    {w.label}
                    <span className="rp12-out-said">{w.value}</span>
                  </p>
                  <p className="rp12-out-why">{c.why(e.why)}</p>
                  <SecondaryButton className="rp12-out-away" data-testid="outbox-put-away" onClick={() => takeOut(kit, e.id)}>
                    {c.putAway}
                  </SecondaryButton>
                </Box>
              </div>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}
