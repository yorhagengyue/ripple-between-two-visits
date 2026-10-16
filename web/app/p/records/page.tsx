/**
 * /p/records — 「记录」, the third of the elder's four tabs (owner's decision of 2026-10-14: 今天 / 就诊 / 记录 / 我; the old
 * tabs 体征记录 /p/bp and 我的药物 /p/meds are merged here: "records hold medicines, blood pressure and everything else").
 * One short screen, each part read by the reader its own page uses; nothing is written from here:
 *
 *   (on the screen 血压 comes first: recording a reading is the daily action, and it stays on the first screen)
 *   药物       every medicine he has now (lib/meds/list.ts listMedGroups, the list /p/meds draws), one row each: the name
 *              and strength, the Chinese generic name, and when he takes it in the slot words (早间 / 午间 / 晚间 / 睡前)
 *              with where that comes from (「依药品标签」, or 「你选的时间」; lib/daily/slots.ts doseSlotsOf); a medicine
 *              still waiting for its label or not identified says that instead. A row opens the medicine's card. Then
 *              「拍药袋新增药物」 (the add flow, /p/meds/add; 「以后再说」 comes back here) and 「按来源查看」 (/p/meds)
 *   血压       the account's blood pressure view (lib/daily/bp.ts accountBpView, the reader /p/bp uses): 「该测量血压了
 *              （早间）」 while the doctor's plan asks for a reading now, the latest reading with when it was taken (today:
 *              the time; an earlier day: the day and its part, 早间 / 晚间, as the week's rows say it), this
 *              week's count (components/bp/week.ts: the week the 「看全部」 page opens on), the doctor's number with its
 *              date when he has one; then 「记录一次血压」 (the keypad of /p/bp, ?do=record) and 「看全部」 (/p/bp).
 *              Numbers only: nothing compares a reading with the doctor's number or judges it (as on /p/bp)
 *   其他记录   only what he has: his notes (a row with their count, opening ?view=notes below) and what he said to Ripple
 *              (lib/chat/view.ts chatDays; opening /p/chat). No row for something he has none of; no section without a row
 *
 * ?view=notes: his notes, newest first: the day, how he left it (语音 / 打字) and his words as kept (the notes table, read
 * as her shared-notes page reads it). His notes had no page of their own on his side before this one.
 *
 * Holding a medicine, the latest reading or the week's count opens Ripple's read of it (components/explain/Explainable,
 * as on /p/meds and /p/bp). The bottom bar shows 「记录」 here and on the pages under it (its place "records").
 * Left out on purpose: the watch's trends and the diet question (off the demo path, owner 10-14; their pages stay), the
 * question list (就诊's), prevention (reached from the question list). ?lang=en|zh-Hans renders this screen in that
 * language. A demo session (the judges' sandbox, a filming session) keeps its own tabs, which have no 「记录」: its Today.
 *
 * Test hooks: page-records (data-scope), records-meds (data-count), records-med-<id> (data-status), records-meds-empty,
 * records-meds-add, records-meds-all, records-bp, records-bp-due (data-part), records-bp-latest (data-id, data-reading),
 * records-bp-none, records-bp-week (data-count, data-monday), records-bp-target (data-target, data-state),
 * records-bp-record, records-bp-all, records-other, records-notes (data-count), records-chat (data-count),
 * records-notes-view (data-count), records-note (data-source), records-notes-empty.
 */
import { redirect } from "next/navigation";
import { weekCountWords } from "@/components/bp/copy";
import { mondayOf, weekView } from "@/components/bp/week";
import { TimeKeeper } from "@/components/daily/elder/TimeKeeper";
import { Explainable } from "@/components/explain/Explainable";
import { markOf } from "@/components/meds/elder/pages";
import { ScanBox } from "@/components/meds/elder/ScanBox";
import { Box, Button, Chevron, ListCard, ListItem, PageHeader, PrimaryButton, Screen, SecondaryButton, SectionTitle, TabBar } from "@/components/ui";
import { chatDays } from "@/lib/chat/view";
import { accountBpView, type AccountBpReading } from "@/lib/daily/bp";
import { clockWords, dateWords, dt, shortDay, type DailyKey } from "@/lib/daily/i18n";
import { doseSlotsOf } from "@/lib/daily/slots";
import type { Locale } from "@/lib/i18n";
import { mx, patientStatusWords, slotWords, statusWords } from "@/lib/meds/account-copy";
import { listMedGroups } from "@/lib/meds/list";
import type { MedListItem } from "@/lib/meds/types";
import { RECORDS_HREF, rc } from "@/lib/records/copy";
import { getPatientLocale } from "@/lib/session/server";
import { scopeD0, scopeNow, scopeTz } from "@/lib/store/scope";
import type { MedicationRow, SessionRow } from "@/lib/store/types";
import { storyDate } from "@/lib/story/clock";
import { getPageSubject, type PageSubject } from "@/lib/subject";
import { zonedTimeToUtcMs } from "@/lib/time/clock";
import { nowMs as appNowMs } from "@/lib/time/now";
import { uiCopy } from "@/lib/ui/copy";

export const dynamic = "force-dynamic";

type Search = Record<string, string | string[] | undefined>;

const one = (v: string | string[] | undefined): string | undefined => (Array.isArray(v) ? v[0] : v);

export default async function RecordsPage({ searchParams }: { searchParams: Promise<Search> }) {
  const [ctx, cookieLocale, sp] = await Promise.all([getPageSubject(), getPatientLocale(), searchParams]);
  if (!ctx) return null;
  if (ctx.subject.kind !== "account") redirect("/p/today");
  const lang = one(sp.lang);
  const locale: Locale = lang === "en" || lang === "zh-Hans" ? lang : cookieLocale;
  return one(sp.view) === "notes" ? notesScreen(ctx, locale) : recordsScreen(ctx, locale);
}

/**
 * When he takes a medicine, as its row says it: what he said about a box nobody identified, a medicine still waiting
 * for its label, else the slots with where they come from (「早间服用 · 依药品标签」) or 「尚未设定服药时间」.
 */
function whenWords(locale: Locale, m: MedListItem, row: MedicationRow | undefined, scope: SessionRow): string {
  if (m.patientStatus) return patientStatusWords(locale, m.patientStatus);
  if (m.status === "unidentified" || m.status === "awaiting_label") return statusWords(locale, m.status);
  const { slots, source } = row ? doseSlotsOf(scope, row) : { slots: m.slots ?? [], source: null };
  if (!slots.length) return mx(locale, "card.slots.none");
  return mx(locale, source === "patient" ? "card.slots.patient" : "card.slots.label", { slots: slotWords(locale, slots) });
}

/** The newest reading with both numbers: the latest day, then the latest time it was written that day. */
function latestOf(readings: readonly AccountBpReading[]): AccountBpReading | null {
  let best: AccountBpReading | null = null;
  for (const r of readings) {
    if (r.state !== "recorded" || r.systolic === null || r.diastolic === null) continue;
    if (!best || r.date > best.date || (r.date === best.date && r.time > best.time)) best = r;
  }
  return best;
}

async function recordsScreen(ctx: PageSubject, locale: Locale) {
  const store = ctx.store;
  const session = ctx.session;
  const nowMs = appNowMs();
  const [groups, medRows, bp, notes, talk] = await Promise.all([
    listMedGroups(store, session.id, session.story_day, locale, session.story_time),
    store.listMeds(session.id),
    accountBpView(store, session, locale, nowMs),
    store.listNotes(session.id, { toDay: session.story_day }),
    chatDays(store, session),
  ]);

  // ---- 药物
  const meds = groups.flatMap((g) => g.items);
  const rowOf = new Map(medRows.map((m) => [m.id, m]));

  // ---- 血压: the latest reading, this week's count, the doctor's number, a part of the day due now
  const latest = latestOf(bp.readings);
  const monday = mondayOf(bp.date);
  const week = weekView(bp.readings, monday);
  const target = bp.target;
  const due = (bp.plan?.today ?? []).filter((p) => p.state === "due").map((p) => p.part);
  const shown = (r: Pick<AccountBpReading, "systolic" | "diastolic">) => `${r.systolic}/${r.diastolic}`;
  // when, as the week's rows say it: today's with the time it was written, an earlier day's with its part of the day
  // (早间 / 晚间; the example account's readings were all written when it was laid out)
  const latestWhen = !latest
    ? ""
    : latest.date === bp.date
      ? [rc(locale, "bpToday"), latest.time ? clockWords(locale, latest.time) : null].filter(Boolean).join(" ")
      : `${shortDay(locale, latest.date)} ${dt(locale, `bp.slot.${latest.part}` as DailyKey)}`;
  const weekWords = weekCountWords(locale, week.facts.count);
  // the doctor's plan has its own moments (a part becomes due, a part passes): the screen reads itself again then, as
  // /p/bp does; his midnight and the medicine moments are the layout's (components/daily/elder/DayClock.tsx)
  const tz = scopeTz(session);
  const at = scopeNow(session, nowMs);
  const moments = (bp.plan?.today ?? []).flatMap((p) => [zonedTimeToUtcMs(bp.date, p.remind, tz), zonedTimeToUtcMs(bp.date, p.closes, tz)]).filter((m) => m > at);

  // ---- 其他记录: only what he has
  const said = talk.reduce((n, d) => n + d.count, 0);
  const others = [
    notes.length ? (
      <ListItem key="notes" title={rc(locale, "notes")} right={rc(locale, "notesCount", { n: notes.length })} chevron href={`${RECORDS_HREF}?view=notes`} testId="records-notes" attrs={{ "data-count": notes.length }} />
    ) : null,
    said ? <ListItem key="chat" title={rc(locale, "chat")} right={rc(locale, "chatCount", { n: said })} chevron href="/p/chat" testId="records-chat" attrs={{ "data-count": said }} /> : null,
  ].filter(Boolean);

  return (
    <Screen locale={locale} tabBar={<TabBar active="records" locale={locale} />} tabBarPlacement="fixed">
      <TimeKeeper nextAtMs={moments.length ? Math.min(...moments) - (at - nowMs) : null} serverNowMs={nowMs} />
      <PageHeader title={rc(locale, "title")} subtitle={dateWords(locale, bp.date)} locale={locale} />
      <div className="rpu-stack" data-testid="page-records" data-scope="account">
        <section className="rpu-stack" data-testid="records-bp">
          <SectionTitle>{rc(locale, "bp")}</SectionTitle>
          <ListCard>
            {due.length ? <ListItem mark="todo" title={dt(locale, "today.bp.dueNow", { part: dt(locale, `slot.${due[0]}` as DailyKey) })} testId="records-bp-due" attrs={{ "data-part": due[0] }} /> : null}
            {latest ? (
              <Explainable as="row" subject={{ type: "bp", ref: latest.id }} locale={locale} label={shown(latest)}>
                <ListItem title={<span translate="no">{shown(latest)}</span>} sub={rc(locale, "bpLatest", { when: latestWhen })} testId="records-bp-latest" attrs={{ "data-id": latest.id, "data-reading": shown(latest) }} />
              </Explainable>
            ) : (
              <ListItem title={rc(locale, "bpNone")} dim testId="records-bp-none" />
            )}
            {latest ? (
              <Explainable as="row" subject={{ type: "bp_week", ref: monday }} locale={locale} label={weekWords}>
                <ListItem title={weekWords} testId="records-bp-week" attrs={{ "data-count": week.facts.count, "data-monday": monday }} />
              </Explainable>
            ) : null}
            {target ? (
              <ListItem
                title={dt(locale, "bp.doctorNumber")}
                // the visit's date; a number he has not confirmed says so, as the week's caption does
                sub={[shortDay(locale, target.date), target.state === "inferred" ? uiCopy(locale).inferredDoctor : null].filter(Boolean).join(" · ")}
                right={<span translate="no">{target.diastolic !== null ? `${target.systolic}/${target.diastolic}` : String(target.systolic)}</span>}
                testId="records-bp-target"
                attrs={{ "data-target": target.diastolic !== null ? `${target.systolic}/${target.diastolic}` : String(target.systolic), "data-state": target.state }}
              />
            ) : null}
          </ListCard>
          <div className="rpu-btns">
            <PrimaryButton href="/p/bp?do=record" nav="forward" data-testid="records-bp-record">
              {dt(locale, "bp.record.title")}
            </PrimaryButton>
            <Button variant="link" href="/p/bp" nav="forward" aria-label={rc(locale, "bpAllLabel")} data-testid="records-bp-all">
              {rc(locale, "bpAll")}
              <Chevron />
            </Button>
          </div>
        </section>

        <section className="rpu-stack" data-testid="records-meds" data-count={meds.length}>
          <SectionTitle>{rc(locale, "meds")}</SectionTitle>
          {/* scene 3 (owner 10-15): one of his boxes photographed -> how to take it, in a sheet over this page; first in the
              section, so it is there as soon as he reaches his medicines */}
          {meds.length ? <ScanBox locale={locale} addHref={`/p/meds/add?next=${RECORDS_HREF}`} testId="records-meds-scan" /> : null}
          {meds.length ? (
            <ListCard>
              {meds.map((m) => {
                const fullName = [m.name, m.strength].filter(Boolean).join(" ");
                return (
                  <Explainable key={m.id} as="row" subject={{ type: "med", ref: m.id }} locale={locale} label={fullName}>
                    <ListItem
                      mark={markOf(m)}
                      title={<span translate="no">{fullName}</span>}
                      // the Chinese generic name, and under it when he takes it (two short lines, as on /p/meds)
                      sub={[m.zhName, whenWords(locale, m, rowOf.get(m.id), session)].filter(Boolean).join("\n")}
                      chevron
                      href={`/p/meds/${encodeURIComponent(m.id)}`}
                      testId={`records-med-${m.id}`}
                      attrs={{ "data-status": m.status }}
                    />
                  </Explainable>
                );
              })}
            </ListCard>
          ) : (
            <Box variant="dash" title={rc(locale, "medsEmpty")} testId="records-meds-empty" />
          )}
          <div className="rpu-btns">
            <SecondaryButton icon="camera" href={`/p/meds/add?next=${RECORDS_HREF}`} nav="forward" data-testid="records-meds-add">
              {rc(locale, "medsAdd")}
            </SecondaryButton>
            {meds.length ? (
              <Button variant="link" href="/p/meds" nav="forward" data-testid="records-meds-all">
                {rc(locale, "medsByOrigin")}
                <Chevron />
              </Button>
            ) : null}
          </div>
        </section>

        {others.length ? (
          <section className="rpu-stack" data-testid="records-other">
            <SectionTitle>{rc(locale, "other")}</SectionTitle>
            <ListCard>{others}</ListCard>
          </section>
        ) : null}
      </div>
    </Screen>
  );
}

/** ?view=notes: his notes, newest first, word for word with their day and how he left them. */
async function notesScreen(ctx: PageSubject, locale: Locale) {
  const session = ctx.session;
  const d0 = scopeD0(session);
  const notes = [...(await ctx.store.listNotes(session.id, { toDay: session.story_day }))].reverse();
  return (
    <Screen locale={locale} tabBar={<TabBar active="records" locale={locale} />} tabBarPlacement="fixed">
      <PageHeader back={{ href: RECORDS_HREF, label: rc(locale, "title") }} title={rc(locale, "notes")} locale={locale} />
      <div className="rpu-stack" data-testid="records-notes-view" data-count={notes.length}>
        {notes.length ? (
          <ListCard>
            {notes.map((n) => (
              <ListItem
                key={n.id}
                mark="me"
                title={<span lang={n.lang ?? undefined}>{n.text}</span>}
                sub={`${dateWords(locale, storyDate(d0, n.day))} · ${rc(locale, n.source === "voice_note" ? "noteVoice" : "noteTyped")}`}
                testId="records-note"
                attrs={{ "data-source": n.source }}
              />
            ))}
          </ListCard>
        ) : (
          <Box variant="dash" title={rc(locale, "notesEmpty")} testId="records-notes-empty" />
        )}
      </div>
    </Screen>
  );
}
