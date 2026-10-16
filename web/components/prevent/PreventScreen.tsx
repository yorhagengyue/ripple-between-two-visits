"use client";

/**
 * 预防：筛查和疫苗 (journey 11; 老人端提示词 11; M10), drawn as the timeline draft's 11-1 (web/progress/fe-1113.md): each
 * block is a section title and a line of nodes, and the node says where an entry is from. The server page hands it the
 * screen (lib/prevent/view.ts) and draws the header; after a tap the page's server data is read again (router.refresh).
 *
 *   the next visit      a box with the accent border: its date and how many days to it (the countdown, M10 step 6).
 *                       Words only: the way to the questions is the header's 「‹ 问题单」 (owner's tidy of 10-13)
 *   the doctor's words  first: what the doctor said about tests and follow-ups at his last clinic visit, each line on
 *                       the doctor's node (「医生说 · 9月8日 · 0:52」, word for word in the serif face, the checked
 *                       Chinese under English words, 「听原声」), then 「我做过了」 (the doctor already asked for it)
 *   the table's lines   each on the node of a written source: its name, the table's line as the back end words it, the
 *                       line that says where it is from (table, version) with the pill that opens the official page,
 *                       then 「加进问题单，问医生」 and 「我做过了」 side by side. Once its question is on the list the
 *                       entry says so in a tinted box with the way to the list. Cardiovascular screening after a
 *                       diagnosis: the tag 「由你的医生跟进」, the table's line, and the reason in a card (the doctor's
 *                       own line, or the fact in his profile); no buttons
 *   done                what he marked done: the tick, the day it was noted, and 「撤回」 (a 12 s 「撤销」 bar in the
 *                       strip at the bottom right after the tap)
 *   the caveat          what suits him and any subsidy is his doctor's to say (the NAIS line, with its source)
 *   not there yet       no age in his profile (a dashed box and the way to his profile); no line of the doctor's; no
 *                       line listed for his age: one dashed entry each, in the section it belongs to
 *   a tap that failed   a box with the red border inside the entry he tapped
 * It never tells him what to do or what he qualifies for: every line says what the table lists or what was said
 * (tests/unit/prevent scans this file and components/prevent/copy.ts).
 *
 * Test hooks: prevent-screen, prevent-next (data-days), prevent-noage, prevent-row (data-item, data-kind, data-state),
 * prevent-ask, prevent-asked (data-question), prevent-done-btn, prevent-done (data-item), prevent-undo-btn,
 * prevent-followed, prevent-source (data-url), prevent-caveat, prevent-error, prevent-nodoctor, prevent-notable,
 * prevent-doctor-translation, undo-toast.
 */
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Act, Acts, Box, PlayPill, SectionTitle, SubCard, SubRow, Tag, Timeline, TimelineItem, TlControls, TlNote, UndoToast } from "@/components/ui";
import { askCopy } from "@/components/daily/ask-copy";
import { DoctorWords, SourceHead } from "@/components/diet/DoctorWords";
import { longDay, shortDay } from "@/lib/daily/i18n";
import type { Locale } from "@/lib/i18n";
import type { PreventRow, PreventView, SourceView } from "@/lib/prevent/view";
import { uiCopy } from "@/lib/ui/copy";
import { PREVENT_WORDS } from "./copy";
import "@/components/diet/diet.css";

type Action = "done" | "undo" | "ask";

async function act(item: string, action: Action, locale: Locale): Promise<boolean> {
  const res = await fetch(`/api/prevent?locale=${encodeURIComponent(locale)}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "same-origin",
    body: JSON.stringify({ item, action }),
  }).catch(() => null);
  return !!res && res.ok;
}

/** Where a line is from, in the back end's words (「出处：国家成人免疫计划表（2026年4月1日版）」), and the pill that opens the official page. */
function Source({ s, locale }: { s: SourceView; locale: Locale }) {
  const w = PREVENT_WORDS[locale];
  return (
    <div className="fe13-col" data-testid="prevent-source" data-url={s.url}>
      <TlNote>{w.source(s)}</TlNote>
      <TlControls>
        <PlayPill href={s.url}>{w.open}</PlayPill>
      </TlControls>
    </div>
  );
}

interface RowProps {
  row: PreventRow;
  locale: Locale;
  /** the tap that is on its way */
  busy: { item: string; action: Action } | null;
  /** his last tap on this entry did not go through */
  failed: boolean;
  onAct: (item: string, action: Action) => void;
}

function Failed({ locale }: { locale: Locale }) {
  return (
    <div role="alert" data-testid="prevent-error">
      <Box variant="red" title={PREVENT_WORDS[locale].failed} />
    </div>
  );
}

/** One line that is still open: the doctor's own words, or a line of the official tables. */
function Row({ row, locale, busy, failed, onAct }: RowProps) {
  const w = PREVENT_WORDS[locale];
  const copy = askCopy(locale);
  const ui = uiCopy(locale);
  const state = row.followed ? "followed" : row.done ? "done" : "listed";
  const attrs = { "data-item": row.id, "data-kind": row.kind, "data-state": state } as const;
  const mine = (action: Action) => busy?.item === row.id && busy.action === action;
  // while a tap of this entry is on its way its other button waits (greyed); the other entries keep their look (the
  // screen lets one tap through at a time), so a tap does not grey every button of the page for a moment
  const waiting = busy?.item === row.id;
  const canAsk = row.canAsk && !row.questionId;
  const actions =
    !row.followed && !row.done ? (
      <>
        {row.canAsk && row.questionId ? (
          <div data-testid="prevent-asked" data-question={row.questionId}>
            <Box variant="tint" title={ui.added} link={{ href: "/p/questions", label: w.seeQuestions }} />
          </div>
        ) : null}
        {/* side by side (the draft's row of two); in English the long words get a row each */}
        <Acts cols={canAsk && locale === "zh-Hans" ? 2 : 1}>
          {canAsk ? (
            <Act variant="outline" pending={mine("ask")} disabled={waiting} onClick={() => onAct(row.id, "ask")} data-testid="prevent-ask">
              {w.ask}
            </Act>
          ) : null}
          <Act pending={mine("done")} disabled={waiting} onClick={() => onAct(row.id, "done")} data-testid="prevent-done-btn">
            {w.didIt}
          </Act>
        </Acts>
        {failed ? <Failed locale={locale} /> : null}
      </>
    ) : undefined;

  if (row.kind === "doctor" && row.doctor) {
    return (
      <TimelineItem node="doc" testId="prevent-row" attrs={attrs} actions={actions}>
        <SourceHead kind="doctor" node="doc" who={copy.doctorSaid} when={`${row.doctor.date} · ${row.doctor.at}`} />
        <DoctorWords line={row.doctor} locale={locale} translationTestId="prevent-doctor-translation" />
      </TimelineItem>
    );
  }

  return (
    <TimelineItem node="lab" title={row.title} testId="prevent-row" attrs={attrs} actions={actions}>
      {row.followed ? (
        <div className="fe13-col" data-testid="prevent-followed">
          <TlControls>
            <Tag tone="ink">{row.followed.status}</Tag>
          </TlControls>
          <p className="rpu-said" data-rp="table-line" lang={locale}>
            {row.followed.table}
          </p>
          {/* why the line switched: the doctor's own words at a visit, or the fact in his profile */}
          {row.doctor ? (
            <SubCard>
              <SubRow who={copy.doctorSaid} meta={`${row.doctor.date} · ${row.doctor.at}`}>
                <DoctorWords line={row.doctor} locale={locale} size="sub" clip={false} translationTestId="prevent-doctor-translation" />
              </SubRow>
            </SubCard>
          ) : null}
          {row.followed.fact ? <TlNote>{w.fact(row.followed.fact)}</TlNote> : null}
          <Source s={row.followed.source} locale={locale} />
        </div>
      ) : (
        <>
          {row.table ? (
            <p className="rpu-said" data-rp="table-line" lang={locale}>
              {row.table}
            </p>
          ) : null}
          {row.source ? <Source s={row.source} locale={locale} /> : null}
          {row.lastDone ? <TlNote>{w.lastDone(longDay(locale, row.lastDone))}</TlNote> : null}
        </>
      )}
    </TimelineItem>
  );
}

/** One line he marked done: the tick, what it is, the day it was noted, 「撤回」. */
function DoneEntry({ row, locale, busy, failed, onAct }: RowProps) {
  const w = PREVENT_WORDS[locale];
  const copy = askCopy(locale);
  const noted = row.done ? w.marked(shortDay(locale, row.done.date)) : undefined;
  const actions = (
    <>
      <Acts>
        <Act pending={busy?.item === row.id && busy.action === "undo"} onClick={() => onAct(row.id, "undo")} data-testid="prevent-undo-btn">
          {w.undo}
        </Act>
      </Acts>
      {failed ? <Failed locale={locale} /> : null}
    </>
  );
  if (row.kind === "doctor" && row.doctor) {
    return (
      <TimelineItem node="ok" testId="prevent-done" attrs={{ "data-item": row.id }} note={noted} actions={actions}>
        <SourceHead kind="doctor" node="doc" who={copy.doctorSaid} when={`${row.doctor.date} · ${row.doctor.at}`} />
        <DoctorWords line={row.doctor} locale={locale} clip={false} />
      </TimelineItem>
    );
  }
  return <TimelineItem node="ok" title={row.title} note={noted} testId="prevent-done" attrs={{ "data-item": row.id }} actions={actions} />;
}

export function PreventScreen({ view, locale }: { view: PreventView; locale: Locale }) {
  const router = useRouter();
  const w = PREVENT_WORDS[locale];
  const [busy, setBusy] = useState<{ item: string; action: Action } | null>(null);
  const [failed, setFailed] = useState<string | null>(null);
  const [undo, setUndo] = useState<{ key: number; item: string } | null>(null);

  async function onAct(item: string, action: Action) {
    setBusy({ item, action });
    setFailed(null);
    const ok = await act(item, action, locale);
    setBusy(null);
    if (!ok) return setFailed(item);
    if (action === "done") setUndo((u) => ({ key: (u?.key ?? 0) + 1, item }));
    if (action === "undo") setUndo(null);
    router.refresh();
  }

  // an entry's buttons: one tap at a time (a second one while the first is on its way is not taken; the entry it
  // belongs to still shows its buttons, he taps again). The undo strip's 「撤销」 always goes through (onAct itself)
  const tap = (i: string, a: Action) => {
    if (busy === null) void onAct(i, a);
  };
  // a line he marked done is listed under 「已经做了的」: its own section is not "empty" then
  const doctorDone = view.done.some((r) => r.kind === "doctor");
  const tableDone = view.done.some((r) => r.kind !== "doctor");

  return (
    <div className="rpu-stack" data-testid="prevent-screen">
      {view.next && (
        <div data-testid="prevent-next" data-days={view.next.days}>
          <Box variant="acc" title={w.next}>
            {w.nextValue(shortDay(locale, view.next.date), view.next.days)}
          </Box>
        </div>
      )}
      {view.noAge && (
        <Box variant="dash" testId="prevent-noage" link={{ href: "/p/profile", label: w.noAgeLink }}>
          {w.noAge}
        </Box>
      )}

      {view.doctor.length > 0 ? (
        <div className="fe13-section">
          <SectionTitle>{w.doctor}</SectionTitle>
          <Timeline>
            {view.doctor.map((r) => (
              <Row key={r.id} row={r} locale={locale} busy={busy} failed={failed === r.id} onAct={tap} />
            ))}
          </Timeline>
        </div>
      ) : !doctorDone ? (
        <div className="fe13-section">
          <SectionTitle>{w.doctor}</SectionTitle>
          <Timeline>
            <TimelineItem node="miss" title={w.noDoctor} testId="prevent-nodoctor" />
          </Timeline>
        </div>
      ) : null}

      {view.table.length > 0 ? (
        <div className="fe13-section">
          <SectionTitle>{w.table}</SectionTitle>
          <Timeline>
            {view.table.map((r) => (
              <Row key={r.id} row={r} locale={locale} busy={busy} failed={failed === r.id} onAct={tap} />
            ))}
          </Timeline>
        </div>
      ) : !view.noAge && !tableDone ? (
        <div className="fe13-section">
          <SectionTitle>{w.table}</SectionTitle>
          <Timeline>
            <TimelineItem node="miss" title={w.noTable} testId="prevent-notable" />
          </Timeline>
        </div>
      ) : null}

      {view.done.length > 0 && (
        <div className="fe13-section">
          <SectionTitle>{w.done}</SectionTitle>
          <Timeline>
            {view.done.map((r) => (
              <DoneEntry key={r.id} row={r} locale={locale} busy={busy} failed={failed === r.id} onAct={tap} />
            ))}
          </Timeline>
        </div>
      )}

      <Timeline>
        <TimelineItem node="lab" testId="prevent-caveat">
          {/* the entry opens with the table's own line: it moves up so the node stands at its first line (diet.css) */}
          <p className="rpu-said fe13-lead-said" data-rp="table-line" lang={locale}>
            {view.caveat.text}
          </p>
          <Source s={view.caveat.source} locale={locale} />
        </TimelineItem>
      </Timeline>

      {/* the undo strip sits over the foot of the page for 12 s; the foundation's screen keeps that much more room under
          the last block meanwhile (UndoToast tells it how high the strip is), so nothing stays hidden behind it */}
      {undo && (
        <div data-testid="undo-toast" key={undo.key}>
          <UndoToast message={w.toast} locale={locale} onUndo={() => void onAct(undo.item, "undo")} onExpire={() => setUndo(null)} />
        </div>
      )}
    </div>
  );
}
