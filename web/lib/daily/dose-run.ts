/**
 * One pass of an account's medicine day (C2 track B; real-app 2.7, 2.24, 8.3 jobs/dose). Server-only. The scheduled job
 * (lib/jobs/daily.ts) runs it for every account scope every minute; tests run it with an injected clock.
 *
 *   1. settle    every tracked cell since tracking began whose window closed with no answer -> unconfirmed /
 *                no_reply (lib/daily/doses.ts settleAccountNoReply; idempotent)
 *   2. remind    today's slots in their first or second reminder stretch with a cell still waiting for him (no answer,
 *                or 等一下) -> one reminder_delivery per slot and stretch (dose_first / dose_second, ref "dose"), and
 *                the notice to his phone: 「早上的药」「还没记」, tapping it opens /p/today?remind=dose-morning. A slot
 *                whose first stretch passed unseen (the server was down, he signed up at 09:00) gets only what is due
 *                now. Nothing before 08:45, nothing for an untracked cell.
 *   3. tell her  every "no reply" cell whose window closed within the last six hours (lib/daily/no-reply.ts
 *                FAMILY_ALERT_FRESH_MS: her alert belongs to the moment the window closes, real-app 2.24), per slot, for
 *                each active care link whose no_reply_alert switch is on and that was confirmed before the window
 *                closed -> one family_no_reply delivery per link, day and slot, and the notice to her phone. A cell
 *                settled by one of his own reads is caught here on the next run (the delivery is the record, not the
 *                settling), and a cell he answered before this run is no longer "no reply": nothing is sent for it.
 *                An older cell (the server was down, the first pass over old days) is settled in step 1 and never
 *                announced: no burst of old alerts.
 * Never touches a demo scope.
 */
import { isAccount, scopeNow } from "@/lib/store/scope";
import type { CareLinkRow, DaySlot, SessionRow, Store } from "@/lib/store/types";
import type { Locale } from "@/lib/i18n";
import { sendNotice, type Notice } from "@/lib/jobs/notify";
import { buildDoseDay, scopeSlotSchedule, slotInstants, waitingForHim } from "./cells";
import { settleAccountNoReply } from "./doses";
import { dt, shortTime, type DailyKey } from "./i18n";
import { DELIVERY, FAMILY_ALERT_FRESH_MS, noReplyCells } from "./no-reply";

/** His active links and their no-reply switch (the job reads links through the process store: lib/jobs). */
export interface LinkWithSwitch {
  link: Pick<CareLinkRow, "id" | "family_id" | "patient_label" | "confirmed_at" | "status">;
  noReplyAlert: boolean;
  /** her language for the notice (her account's, else zh-Hans) */
  locale: Locale;
}

export interface DoseRunDeps {
  /** his active care links with their switches; default none */
  links?: () => Promise<LinkWithSwitch[]>;
  /** his language for the notice (his account's, else zh-Hans) */
  locale?: Locale;
  /** where notices go (default lib/jobs/notify.ts sendNotice) */
  send?: (notice: Notice, store: Store) => Promise<{ sent: number }>;
}

export interface DoseRunCounts {
  settled: number;
  first: number;
  second: number;
  family: number;
  /** notices the sender reported as sent */
  sent: number;
}

const slotKey = (prefix: "slot" | "slotMed", slot: DaySlot) => `${prefix}.${slot}` as DailyKey;

export async function runDoseDay(store: Store, scope: SessionRow, nowMs: number, deps: DoseRunDeps = {}): Promise<DoseRunCounts> {
  const counts: DoseRunCounts = { settled: 0, first: 0, second: 0, family: 0, sent: 0 };
  if (!isAccount(scope) || !scope.owner_user_id) return counts;
  const send = deps.send ?? sendNotice;
  const locale = deps.locale ?? "zh-Hans";

  // 1. settle
  counts.settled = (await settleAccountNoReply(store, scope, nowMs)).length;

  // 2. remind (today only)
  const today = scope.story_day;
  const [meds, doses] = await Promise.all([store.listMeds(scope.id), store.listDoses(scope.id, { fromDay: today, toDay: today })]);
  for (const slotDay of buildDoseDay(scope, today, meds, doses, nowMs)) {
    if (slotDay.phase !== "first" && slotDay.phase !== "second") continue;
    if (!slotDay.cells.some(waitingForHim)) continue;
    const kind = slotDay.phase === "first" ? DELIVERY.doseFirst : DELIVERY.doseSecond;
    const { created, delivery } = await store.recordDelivery(scope.id, { kind, ref: "dose", day: today, slot: slotDay.slot });
    if (!created) continue;
    counts[slotDay.phase] += 1;
    const notice: Notice = {
      kind,
      to: { role: "patient", userId: scope.owner_user_id },
      title: dt(locale, slotKey("slotMed", slotDay.slot)),
      body: dt(locale, "notice.dose.body"),
      url: `/p/today?remind=dose-${slotDay.slot}`,
      tag: `dose-${slotDay.date}-${slotDay.slot}`,
      ttlS: 3600,
      deliveryId: delivery.id,
      scopeId: scope.id,
      locale,
    };
    counts.sent += (await send(notice, store)).sent;
  }

  // 3. tell her
  const links = (await deps.links?.()) ?? [];
  const on = links.filter((l) => l.noReplyAlert && l.link.status === "active" && !!l.link.family_id);
  if (on.length) {
    const cells = await noReplyCells(store, scope, { fromDay: today - 1, toDay: today });
    const slots = new Map<string, { day: number; date: string; slot: DaySlot }>();
    for (const c of cells) slots.set(`${c.day}|${c.slot}`, { day: c.day, date: c.date, slot: c.slot });
    // the windows' instants are on the scope's own dates: their age is read at its own "now" (track J's offset)
    const at = scopeNow(scope, nowMs);
    for (const s of slots.values()) {
      const schedule = scopeSlotSchedule(scope, s.slot);
      const { closeMs } = slotInstants(scope, s.day, schedule);
      // an old cell: in his record, never announced (no burst of old alerts)
      if (at - closeMs > FAMILY_ALERT_FRESH_MS) continue;
      for (const l of on) {
        // C2 track J: her confirmation is an instant on the app's clock, the window's close is on the scope's dates (a
        // filming account's clock offset): bring it to the scope's time first (the same instant for every other account)
        const since = l.link.confirmed_at ? scopeNow(scope, Date.parse(l.link.confirmed_at)) : Number.NaN;
        // she joined after this window closed: not hers to be told about
        if (Number.isFinite(since) && since > closeMs) continue;
        const { created, delivery } = await store.recordDelivery(scope.id, { kind: DELIVERY.familyNoReply, ref: l.link.id, day: s.day, slot: s.slot });
        if (!created) continue;
        counts.family += 1;
        const who = l.link.patient_label?.trim() || dt(l.locale, "notice.family.who");
        const notice: Notice = {
          kind: DELIVERY.familyNoReply,
          to: { role: "family", userId: l.link.family_id!, linkId: l.link.id },
          title: dt(l.locale, "notice.family.title", { who, slotMed: dt(l.locale, slotKey("slotMed", s.slot)).toLowerCase() }),
          body: dt(l.locale, "notice.family.body", { first: shortTime(schedule.first), second: shortTime(schedule.second) }),
          url: `/f?link=${encodeURIComponent(l.link.id)}`,
          tag: `no-reply-${s.date}-${s.slot}`,
          ttlS: FAMILY_ALERT_FRESH_MS / 1000,
          deliveryId: delivery.id,
          scopeId: scope.id,
          locale: l.locale,
        };
        counts.sent += (await send(notice, store)).sent;
      }
    }
  }
  return counts;
}
