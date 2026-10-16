"use client";

/**
 * After the visit, on his account (C2 track F; real-app 2.14-2.15, 12): one line at a time, each answer saved as he
 * taps (POST /api/visits/[id]/verdict), then the record where every line can be changed again, and 「就这样，存好」
 * (POST /api/visits/[id]/confirm: his own lines are his, his answered questions get the clinician's words). After he
 * confirmed, the same record shows what he decided and each line keeps its 「改一下」 (an edit, kept in its history).
 *
 * Also the two states without lines: the recording waits for its text (awaiting_transcript: listen to it), or nothing
 * was recorded (an empty visit: it does not count as the last visit). No clinical words of the app's own: the lines are
 * the record's, word for word; the rest is lib/visit/account-copy.ts (and the new pieces' names, ./words.ts).
 *
 * The screens, laid out after the timeline draft (web/progress/fe-05.md):
 *   05-3   the recording waits for its text: 「录音已存，还没有文字。」, a line of two entries (the recording is saved;
 *          the text comes later), 「听录音」 under the line, his own notes, 「先自己记一句」
 *   05-4   one line at a time: the header says 「第 8 件 / 共 12 件」; a line of entries with the one before it (as he
 *          answered it), the line he is asked about (a dashed card), and 「下一件，等你认」; the question and the three
 *          answers stay in the strip at the foot of the screen
 *   05-5   after 「不是」 the line stays on the screen, flagged, with 「已记下：不是 · 撤销」 for 12 seconds and 「下一件」.
 *          「撤销」 saves 「不记得」 (the server has no "not answered yet" to go back to: with 「不记得」 the flag and the
 *          question it added are taken back) and asks the line again. Only on the first pass: a line changed from the
 *          record goes straight back to the record.
 *   05-6   the record: what the doctor told him, each line under the node of who said it (the solid ring only after
 *          「是」), with the record's own name for it (「目标」, 「警示线」), the play pill and 「改一下」
 *   06-1   once he confirmed: 「记好了。」 and, when the visit prescribed a medicine, that it waits for its label (with
 *          「看我的药物」); 「回到今天」 only right after 「就这样，存好」 on this page, not on a record opened later
 *   06-2   what the counter (or the pharmacist) said, as a section of its own: after he confirmed, the whole stretch at
 *          the counter, with his own lines there (「你说的」) and the counter's lines the record holds nothing for
 *   「我说的话 N 句 · 看一下」   (real-app 2.15 「他点出哪几句是自己说的」; a visit can hold dozens of his lines, so they
 *          are behind one row of the record): every line the record holds as his, a guess or confirmed, each with
 *          「不是我说的」 (POST /api/visits/[id]/mine, before and after he confirmed); a line given back says so and can
 *          be taken again
 *
 * C2 round two (view.account, lib/visit/view.ts):
 *   - while the recording waits he can write a line of his own (「先自己记一句」, POST /api/visits/[id]/note): saved as
 *     his note and shown here as 「本人记的」, now and after the text arrives; it is never shown as anyone else's words;
 *   - when the server used up its attempts the screen says the text could not be made and that the recording is still
 *     there (he can listen, and write his line);
 *   - with his consent to AI processing off, one sentence says so and where to change it (「我」);
 *   - the example account's sample visit carries 「示例回放」 on every screen of its review.
 *
 * C2 round three:
 *   - the sentence about AI processing describes this visit: it is read from the visit's own record of how it was
 *     made (view.account.aiOff, aiOffFrom "record"), in the past tense; the way to 「我」 is offered only while his
 *     setting is off now (it changes the visits to come, not this one);
 *   - 「哪几句是我说的」 (real-app 2.15): on the record, the lines whose speaker nobody could tell, each with one tap,
 *     saved as he taps (POST /api/visits/[id]/mine); a line he marked can be given back until he confirms;
 *   - the follow-up planned from this visit: 「大约 11月20日」, and 「改成我约的日子」 (PATCH /api/visits/[id]).
 *
 * Ripple's summary (owner's decision of 10-14; lib/visit/ripple-summary.ts): the final summary, written from the whole
 * transcript once the record was made (view.account.summary, or the event visit.summary when it arrives while this page
 * is open), is drawn at the top of the record and of the first line he is asked about, as 「Ripple 的总结」 with the line
 * that it is Ripple's from the recording and not confirmed (./RippleNotes.tsx); the doctor's own lines follow as before.
 * It is never one of the lines he answers, and never a source.
 */
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState, type FormEvent, type ReactNode } from "react";
import { useLiveEvent } from "@/components/live/LiveSession";
import { Box, Bubble, Button, Field, ListCard, ListItem, ListenBar, PageHeader, PrimaryButton, Said, SaidTranslation, SecondaryButton, SectionTitle, Tag, Timeline, TimelineItem } from "@/components/ui";
import { useHeaderUnder } from "@/components/ui/AccountHeader";
import { fetchSignedIn, postJson } from "@/lib/session/client";
import { uiCopy } from "@/lib/ui/copy";
import { at, clipTimeLabel, minSec, reviewSpeaker, shortDate, type AccountLocale } from "@/lib/visit/account-copy";
import { vt, type VisitKey } from "@/lib/visit/strings";
import type { LineView, OwnNoteView, VisitSummaryView, VisitView } from "@/lib/visit/types";
import type { ItemVerdict } from "@/lib/visit/verdict";
import { AskedWords } from "./AskedWords";
import { ClipRow, Heading, Problem, VisitDock, VisitHeader } from "./parts";
import { ReviewChecks } from "./ReviewChecks";
import { RippleNotes } from "./RippleNotes";
import { HeldDock, HeldLine, lineLang, progressWords, ReviewDock, ReviewedLine, ReviewOne, verdictWords, WaitingLine, type ReviewEntry } from "./ReviewOne";
import { placeWords, twoSentences, vw } from "./words";
// owner 10-14: a line of the record he confirmed can be held for Ripple's read of it
import { Explainable } from "@/components/explain/Explainable";
import { lineRef } from "@/lib/explain/subjects";

/** The warning line, or a line that sends him to 995 or A&E (the screen's side of lib/visit/verdict.ts emergencyItem). */
const EMERGENCY_WORDS = /\b995\b|\bA&E\b|急诊|救护车/i;

/** The review's lines: each doctor's-note card (its items together), then each answer to his questions, in time order. */
export function reviewEntries(view: VisitView): ReviewEntry[] {
  const out: ReviewEntry[] = [];
  const seen = new Set<string>();
  const lineOf = (id: string) => view.lines.find((l) => l.id === id) ?? null;
  for (const c of view.cards) {
    if (c.kind !== "doc") continue;
    const itemIds = c.rows.map((r) => r.itemId);
    for (const id of itemIds) seen.add(id);
    const verdicts = c.rows.map((r) => r.verdict ?? null);
    const line = lineOf(c.anchor);
    out.push({
      key: c.id,
      lineId: c.anchor,
      itemIds,
      text: c.quote,
      lang: line?.lang ?? null,
      role: c.role,
      tStartMs: c.tStartMs,
      clip: c.clip,
      question: null,
      // the rows of one line are answered together; rows that disagree are asked again
      verdict: verdicts.every((v) => v === verdicts[0]) ? verdicts[0] : null,
      translation: line?.translation ?? null,
      rows: c.rows.map((r) => ({ variant: r.variant, ...(r.drugName ? { drugName: r.drugName } : {}), ...(r.strength ? { strength: r.strength } : {}) })),
      emergency: c.rows.some((r) => r.variant === "threshold") || EMERGENCY_WORDS.test(c.quote),
    });
  }
  for (const q of view.qlist?.items ?? []) {
    const a = q.answer;
    if (!a?.itemId || seen.has(a.itemId)) continue;
    seen.add(a.itemId);
    const line = lineOf(a.utteranceId);
    out.push({
      key: q.id,
      lineId: a.utteranceId,
      itemIds: [a.itemId],
      text: a.text,
      lang: line?.lang ?? null,
      role: a.role,
      tStartMs: a.tStartMs,
      clip: line?.clip ?? null,
      question: q.text.own ?? q.text.zh ?? q.text.en ?? null,
      // 「你问：」 only for his own words (lib/visit/view.ts: the words his question list shows, and whose they are)
      questionOwn: q.text.own !== undefined && (q.wording === undefined || q.wording === "own_words"),
      verdict: a.verdict ?? null,
      translation: line?.translation ?? null,
    });
  }
  return out.sort((a, b) => a.tStartMs - b.tStartMs);
}

const cap = (x: string) => (x ? x[0].toUpperCase() + x.slice(1) : x);

/** What the record holds a line as, in the record's own words: 「目标」, 「警示线」, 「Amlodipine 5 mg · 为什么吃这个药」. */
function entryTitle(locale: AccountLocale, e: ReviewEntry): string | null {
  if (!e.rows?.length) return null;
  const names: string[] = [];
  for (const r of e.rows) {
    const name = (r.variant === "new_med" || r.variant === "med") && r.drugName ? `${cap(r.drugName)}${r.strength ? ` ${r.strength}` : ""}` : vt(locale, `variant.${r.variant}` as VisitKey);
    if (!names.includes(name)) names.push(name);
  }
  return names.join(" · ");
}

type Speaker = "doctor" | "dispenser" | "pharmacist";
const SPEAKERS: readonly Speaker[] = ["doctor", "dispenser", "pharmacist"];

export function AccountReview({
  view: initial,
  locale,
  context,
  retainUntil,
  keepForever,
  recordingUrl,
  recordingMore,
  recordingLengths,
  prescribed,
}: {
  view: VisitView;
  locale: AccountLocale;
  /** 「10月12日的看诊」 */
  context: string;
  /** "1月10日": when the recording is deleted; null when there is no recording */
  retainUntil: string | null;
  keepForever: boolean;
  /** a short-lived link to his recording (awaiting its text) */
  recordingUrl: string | null;
  /** C2 track R, a long recording kept as several files: the files after the first, played through as one */
  recordingMore?: string[];
  /** ... and every file's length in ms, the first one first (null: one file, whose length the file says) */
  recordingLengths?: number[] | null;
  /** a medicine of this visit is on his list awaiting its label */
  prescribed: boolean;
}) {
  const router = useRouter();
  const copy = uiCopy(locale);
  const [view, setView] = useState(initial);
  const [editing, setEditing] = useState<string | null>(null);
  /** 05-5: the line he just said 「不是」 to stays on the screen until 「下一件」 */
  const [held, setHeld] = useState<string | null>(null);
  /** ... and its undo bar (a counter: each 「不是」 starts the bar's clock again); null once it is gone */
  const [undo, setUndo] = useState<number | null>(null);
  /** a line he took his 「不是」 back from: asked again although the server now holds 「不记得」 for it */
  const [again, setAgain] = useState<string | null>(null);
  /** 「我说的话」 is open: the lines that were his when he opened it (one he gives back stays on that screen, saying so) */
  const [ownIds, setOwnIds] = useState<string[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  /** he pressed 「就这样，存好」 on this page, just now: only then is 「回到今天」 the next step (owner's tidy of 10-13) */
  const [justSaved, setJustSaved] = useState(false);
  // a recording in several files: its whole length is on the visit (the first file alone would say less)
  const wholeMs = recordingLengths?.length ? recordingLengths.reduce((ms, n) => ms + n, 0) : null;
  const [durationMs, setDurationMs] = useState<number | null>(wholeMs);
  const [kept, setKept] = useState(keepForever);
  const [ownNotes, setOwnNotes] = useState<OwnNoteView[]>(initial.account?.ownNotes ?? []);
  const [draft, setDraft] = useState("");
  const [noteFailed, setNoteFailed] = useState(false);
  const [booking, setBooking] = useState<string | null>(null);
  const [bookFailed, setBookFailed] = useState(false);
  const acct = view.account;
  /** Ripple's final summary that arrived while this page was open (visit.summary, stage final) */
  const [arrived, setArrived] = useState<VisitSummaryView | null>(null);
  useLiveEvent(
    (event) => {
      const d = event.data as { visit_id?: string; stage?: string; lang?: string; points?: { text?: unknown; lines?: unknown }[]; at?: string } | null;
      if (d?.visit_id !== view.visit.id || d.stage !== "final") return;
      const points = (d.points ?? [])
        .filter((p): p is { text: string; lines?: unknown } => typeof p.text === "string" && p.text.trim() !== "")
        .map((p) => ({ text: p.text, lines: Array.isArray(p.lines) ? p.lines.filter((x): x is string => typeof x === "string") : [] }));
      if (points.length) setArrived({ stage: "final", lang: d.lang === "en" ? "en" : "zh-Hans", points, madeAt: d.at ?? "" });
    },
    ["visit.summary"],
  );
  const summary = acct?.summary ?? arrived;
  /** at the top: Ripple's summary, named as Ripple's and as not confirmed; the doctor's own lines follow */
  const notes = summary ? (
    <RippleNotes title={vw(locale, "review.notes")} note={vw(locale, "review.notesNote")} points={summary.points.map((p) => p.text)} lang={summary.lang} testId="review-notes" openLabel={vw(locale, "live.notesOpen")} />
  ) : null;
  const back = { href: "/p/visit", label: copy.tabs.visit };
  // the hairline under the header of a one-line screen (the draft's 05-4), unless the account draws its own line there
  // (an example account: 「示例资料：…」 sits right under the header and is the separator itself)
  const headerLine = !useHeaderUnder();
  const place = placeWords(locale, view.visit);

  async function saveOwnNote(e: FormEvent) {
    e.preventDefault();
    const text = draft.trim();
    if (!text || busy) return;
    setBusy(true);
    setNoteFailed(false);
    try {
      const out = await postJson<{ notes: OwnNoteView[] }>(`/api/visits/${encodeURIComponent(view.visit.id)}/note`, null, { text });
      setOwnNotes(out.notes);
      setDraft("");
    } catch {
      setNoteFailed(true);
    } finally {
      setBusy(false);
    }
  }

  /** his own lines about this visit: his notes, under his own node, in the plain face (never the quote face) */
  const ownNotesList = ownNotes.length ? (
    <section className="rpu-visit-group" data-testid="review-own-notes" data-count={ownNotes.length}>
      <SectionTitle>{at(locale, "review.ownNote.section")}</SectionTitle>
      <Timeline>
        {ownNotes.map((n) => (
          <TimelineItem key={n.id} node="me" who={at(locale, "review.ownNote.tag")} testId="review-own-note" attrs={{ "data-note": n.id }}>
            <Bubble node="me">{n.text}</Bubble>
          </TimelineItem>
        ))}
      </Timeline>
    </section>
  ) : null;

  /** the sample visit's label and, with AI off, the one sentence and the way to change it */
  const banner =
    acct?.sample || acct?.aiOff ? (
      <div style={{ display: "contents" }} data-testid="review-banner" data-sample={acct.sample ? "true" : "false"} data-ai-off={acct.aiOff ? "true" : "false"}>
        {acct.sample ? (
          <Box
            variant="grey"
            title={
              <span data-testid="review-sample">
                <Tag tone="ink">{at(locale, "review.sample")}</Tag>
              </span>
            }
          >
            {at(locale, "review.sampleNote")}
          </Box>
        ) : null}
        {acct.aiOff ? (
          // this visit's record was made without AI (kept with the visit); where the visit does not say, his setting now
          <span style={{ display: "contents" }} data-testid="review-ai-off" data-from={acct.aiOffFrom} data-now={acct.aiOffNow ? "off" : "on"}>
            <Box variant="grey" link={acct.aiOffNow ? { href: "/p/me/ai", label: at(locale, "review.aiOffChange") } : undefined}>
              {at(locale, acct.aiOffFrom === "record" ? "review.aiOffMade" : "review.aiOff")}
            </Box>
          </span>
        ) : null}
      </div>
    ) : null;

  async function toggleKeep() {
    const next = !kept;
    lastTry.current = () => void toggleKeep();
    setBusy(true);
    setFailed(false);
    try {
      await postJson(`/api/visits/${encodeURIComponent(view.visit.id)}/keep`, null, { keep: next });
      setKept(next);
    } catch {
      setFailed(true);
    } finally {
      setBusy(false);
    }
  }

  const retention = retainUntil ? (
    <div className="rpu-visit-keep" data-testid="review-retention" data-kept={kept ? "true" : "false"}>
      <p className="rpu-visit-keep-t">{kept ? at(locale, "review.keptForever") : at(locale, "review.retainUntil", { date: retainUntil })}</p>
      <Button variant="small" aria-pressed={kept} onClick={() => void toggleKeep()} disabled={busy} data-testid="review-keep">
        {at(locale, kept ? "review.keepOff" : "review.keepOn")}
      </Button>
    </div>
  ) : null;
  const entries = useMemo(() => reviewEntries(view), [view]);
  const id = view.visit.id;
  const status = view.visit.status;

  // Each line, the held line and 「我说的话」 are screens of their own: a new one starts at its top. The record is long:
  // coming back to it from one line (改一下) or from his own lines, he is where he left it.
  const recordScroll = useRef(0);
  const leaveRecord = () => {
    recordScroll.current = window.scrollY;
  };
  const firstPending = status === "review" ? (entries.find((e) => e.verdict === null)?.key ?? null) : null;
  const screenKey = held ? `held:${held}` : editing ? `one:${editing}` : again ? `one:${again}` : ownIds ? "own" : firstPending ? `one:${firstPending}` : "record";
  const firstScreen = useRef(true);
  useEffect(() => {
    if (firstScreen.current) {
      firstScreen.current = false;
      return;
    }
    window.scrollTo(0, screenKey === "record" ? recordScroll.current : 0);
  }, [screenKey]);

  /** the save he last tapped: 「再试一次」 does exactly that again */
  const lastTry = useRef<(() => void) | null>(null);
  /**
   * Something he tapped did not get saved: said under what he was doing and brought into view (these pages are long, and
   * the strip of buttons covers their end). 「再试一次」 sends the same save again; nothing he answered before is touched.
   */
  const problem = failed ? (
    <Problem
      title={at(locale, "visit.failed")}
      retryLabel={copy.retry}
      onRetry={() => {
        setFailed(false);
        lastTry.current?.();
      }}
      reveal
      testId="review-problem"
      retryTestId="review-problem-retry"
    />
  ) : null;

  async function answer(entry: ReviewEntry, verdict: ItemVerdict, opts: { hold?: boolean } = {}) {
    lastTry.current = () => void answer(entry, verdict, opts);
    setBusy(true);
    setFailed(false);
    try {
      const out = await postJson<{ view: VisitView }>(`/api/visits/${encodeURIComponent(id)}/verdict`, null, { items: entry.itemIds, verdict, locale });
      setView(out.view);
      // 05-5: on the first pass 「不是」 keeps the line on the screen, with its undo bar
      const hold = opts.hold === true && verdict === "wrong";
      setHeld(hold ? entry.key : null);
      setUndo((n) => (hold ? (n ?? 0) + 1 : null));
      setAgain(null);
      setEditing(null);
    } catch {
      setFailed(true);
    } finally {
      setBusy(false);
    }
  }

  /**
   * 「撤销」 of a 「不是」: the server has no "not answered yet" to return a line to, so the line is saved as 「不记得」
   * (the flag and the question his 「不是」 added are taken back with it) and asked again here.
   */
  async function undoNo(entry: ReviewEntry) {
    lastTry.current = () => void undoNo(entry);
    setBusy(true);
    setFailed(false);
    try {
      const out = await postJson<{ view: VisitView }>(`/api/visits/${encodeURIComponent(id)}/verdict`, null, { items: entry.itemIds, verdict: "unsure", locale });
      setView(out.view);
      setHeld(null);
      setUndo(null);
      setAgain(entry.key);
    } catch {
      setFailed(true);
    } finally {
      setBusy(false);
    }
  }

  /** 「是我说的」 / 「不是我说的」 on a line whose speaker nobody could tell: saved as he taps */
  async function markMine(lineId: string, mine: boolean) {
    lastTry.current = () => void markMine(lineId, mine);
    setBusy(true);
    setFailed(false);
    try {
      const out = await postJson<{ view: VisitView }>(`/api/visits/${encodeURIComponent(id)}/mine`, null, { line: lineId, mine });
      setView(out.view);
    } catch {
      setFailed(true);
    } finally {
      setBusy(false);
    }
  }

  /** 「我约的日子」: the planned follow-up's day, from the doctor's 「大约」 to the day he booked */
  async function book(plannedId: string, date: string) {
    setBusy(true);
    setBookFailed(false);
    try {
      // as every other save here: a sign-in that has ended leads to the login page and back (lib/session/client.ts)
      const res = await fetchSignedIn(`/api/visits/${encodeURIComponent(plannedId)}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ date }) });
      if (!res.ok) throw new Error("refused");
      const out = (await res.json()) as { visit: { id: string; date: string; approx: boolean } };
      // the view carries the follow-up: his day goes into it (the next answer from the server brings the same)
      setView((v) => (v.account ? { ...v, account: { ...v.account, followUp: { id: out.visit.id, date: out.visit.date, approx: out.visit.approx } } } : v));
      setBooking(null);
      router.refresh();
    } catch {
      setBookFailed(true);
    } finally {
      setBusy(false);
    }
  }

  async function save() {
    lastTry.current = () => void save();
    setBusy(true);
    setFailed(false);
    try {
      const mine = view.lines.filter((l) => l.role === "patient").map((l) => l.id);
      const out = await postJson<{ view: VisitView }>(`/api/visits/${encodeURIComponent(id)}/confirm`, null, { mine, items: {}, locale });
      setView(out.view);
      setJustSaved(true);
      // 「记好了。」 and what follows from the visit are at the top of the record
      recordScroll.current = 0;
      window.scrollTo(0, 0);
      router.refresh();
    } catch {
      setFailed(true);
    } finally {
      setBusy(false);
    }
  }

  // ---- the recording waits for its text (05-3)
  if (status === "awaiting_transcript") {
    const d = durationMs !== null ? minSec(durationMs) : null;
    // the server sent the recording as often as it may and the text could not be made: the recording is still his
    const gaveUp = acct?.transcript === "failed";
    const sub = recordingUrl
      ? at(locale, gaveUp ? "review.transcriptFailedSub" : "review.awaitingSub", { min: d?.min ?? "…", sec: d?.sec ?? "…" })
      : at(locale, "review.awaitingNoAudio");
    // one existing sentence pair as the line's two entries: what is saved, and what comes later
    const [savedWords, laterWords] = recordingUrl && !gaveUp ? twoSentences(sub) : [sub, null];
    return (
      <div style={{ display: "contents" }} data-testid="review-awaiting" data-status={status} data-transcript={gaveUp ? "failed" : "waiting"}>
        <PageHeader back={back} title={context} subtitle={place} locale={locale} />
        <div className="rpu-stack rpu-visit-body">
          <Heading title={at(locale, gaveUp ? "review.transcriptFailed" : "review.awaiting")} />
          <Timeline>
            <TimelineItem node={recordingUrl ? "ok" : "miss"} title={savedWords} />
            {laterWords ? <TimelineItem node="miss" title={laterWords} /> : null}
          </Timeline>
          {recordingUrl ? (
            <div className="rpu-ind">
              <ListenBar
                src={recordingUrl}
                more={recordingMore}
                lengthsMs={recordingLengths ?? undefined}
                time={durationMs !== null ? clipTimeLabel(durationMs) : "…"}
                locale={locale}
                kind="self"
                label={at(locale, "review.listenRecording")}
                style={{ marginTop: 0 }}
              />
              {/* the length of his recording, for the sentence above (the bar plays it); a recording in one file is asked for it */}
              {wholeMs === null ? (
                <audio preload="metadata" src={recordingUrl} hidden onLoadedMetadata={(e) => setDurationMs(Number.isFinite(e.currentTarget.duration) ? e.currentTarget.duration * 1000 : null)} />
              ) : null}
            </div>
          ) : null}
          {ownNotesList}
          {/* 「先自己记一句」: his own note about this visit (never the doctor's words) */}
          <form className="rpu-visit-group" data-rp="own-note" data-testid="review-own-note-form" onSubmit={(e) => void saveOwnNote(e)}>
            <Field
              className="rpu-visit-field"
              id="rpu-own-note"
              label={at(locale, "review.ownNote.label")}
              hint={at(locale, "review.ownNote.hint")}
              error={noteFailed ? <span data-testid="review-own-note-failed">{at(locale, "review.ownNote.failed")}</span> : undefined}
              data-testid="review-own-note-input"
              value={draft}
              maxLength={300}
              autoComplete="off"
              enterKeyHint="done"
              placeholder={at(locale, "review.ownNote.placeholder")}
              onChange={(e) => setDraft(e.target.value)}
            />
            <SecondaryButton type="submit" disabled={busy || !draft.trim()} data-testid="review-own-note-save">
              {at(locale, "review.ownNote.save")}
            </SecondaryButton>
          </form>
          {retention}
          {problem}
        </div>
        <VisitDock>
          <PrimaryButton href="/p/today">{at(locale, "review.next.today")}</PrimaryButton>
        </VisitDock>
      </div>
    );
  }

  // ---- still recording or being transcribed: back to the visit screen
  if (status === "recording" || status === "transcribing" || status === "planned") {
    const date = shortDate(view.visit.date, locale);
    // a planned follow-up has nothing to end: its row and 「我约的日子」 are on the visit page
    const planned = status === "planned";
    return (
      <div style={{ display: "contents" }} data-testid="review-not-ready" data-status={status}>
        <PageHeader back={back} title={context} subtitle={place} locale={locale} />
        <div className="rpu-stack rpu-visit-body">
          <Timeline>
            <TimelineItem node={planned ? "next" : "now"} title={at(locale, planned ? "visit.planned.on" : status === "transcribing" ? "visit.transcribing" : "visit.reopened", { date })} />
          </Timeline>
        </div>
        <VisitDock>
          <PrimaryButton href={planned ? "/p/visit" : `/p/visit?visit=${encodeURIComponent(id)}`}>{at(locale, planned ? "visit.back" : "visit.unfinished.end")}</PrimaryButton>
        </VisitDock>
      </div>
    );
  }

  // ---- nothing was recorded
  if (view.lines.length === 0) {
    return (
      <div style={{ display: "contents" }} data-testid="review-empty" data-status={status}>
        <PageHeader back={back} title={context} subtitle={place} locale={locale} />
        <div className="rpu-stack rpu-visit-body">
          <Box variant="dash" title={at(locale, "review.empty")}>
            {at(locale, "review.emptySub")}
          </Box>
          {ownNotesList}
        </div>
        <VisitDock>
          <PrimaryButton href="/p/today">{at(locale, "review.next.today")}</PrimaryButton>
        </VisitDock>
      </div>
    );
  }

  const pending = entries.filter((e) => e.verdict === null);
  const indexOf = (e: ReviewEntry) => entries.indexOf(e) + 1;

  // ---- 05-5: he just said 「不是」; the line stays, flagged, until 「下一件」
  const heldEntry = held ? (entries.find((e) => e.key === held) ?? null) : null;
  if (heldEntry) {
    const at_ = entries.indexOf(heldEntry);
    const before = at_ > 0 && entries[at_ - 1].verdict !== null ? entries[at_ - 1] : null;
    return (
      <div style={{ display: "contents" }} data-testid="review-queue" data-status={status} data-pending={pending.length} data-held="true">
        <PageHeader back={back} title={context} subtitle={<span data-testid="review-progress">{progressWords(locale, at_ + 1, entries.length)}</span>} locale={locale} line={headerLine} />
        <div className="rpu-stack rpu-visit-body" data-lined={headerLine ? "true" : undefined}>
          {banner}
          <Timeline>
            {before ? <ReviewedLine entry={before} locale={locale} /> : null}
            <HeldLine entry={heldEntry} index={at_ + 1} total={entries.length} context={context} locale={locale} />
          </Timeline>
          {problem}
        </div>
        <HeldDock
          locale={locale}
          busy={busy}
          undo={undo}
          last={pending.length === 0}
          onUndo={() => void undoNo(heldEntry)}
          onUndoGone={() => setUndo(null)}
          onNext={() => {
            setHeld(null);
            setUndo(null);
          }}
        />
      </div>
    );
  }

  // ---- 05-4: one line at a time
  const asked = again ? (entries.find((e) => e.key === again) ?? null) : null;
  const current = editing ? (entries.find((e) => e.key === editing) ?? null) : (asked ?? (status === "review" ? (pending[0] ?? null) : null));
  if (current) {
    const at_ = entries.indexOf(current);
    const before = at_ > 0 && entries[at_ - 1].verdict !== null ? entries[at_ - 1] : null;
    const after = editing ? null : (entries.slice(at_ + 1).find((e) => e.verdict === null) ?? null);
    return (
      <div style={{ display: "contents" }} data-testid="review-queue" data-status={status} data-pending={pending.length}>
        <PageHeader back={back} title={context} subtitle={<span data-testid="review-progress">{progressWords(locale, at_ + 1, entries.length)}</span>} locale={locale} line={headerLine} />
        <div className="rpu-stack rpu-visit-body" data-lined={headerLine ? "true" : undefined}>
          {banner}
          {/* the first line he is asked about, right after the visit: Ripple's summary on top (not on every line) */}
          {!editing && !again && pending.length === entries.length ? notes : null}
          <Timeline open={!!after}>
            {before ? <ReviewedLine entry={before} locale={locale} /> : null}
            <ReviewOne key={current.key} entry={current} index={indexOf(current)} total={entries.length} context={context} locale={locale} />
            {after ? <WaitingLine entry={after} locale={locale} /> : null}
          </Timeline>
          {problem}
        </div>
        {/* the first pass holds a 「不是」 on the screen (05-5); a line changed from the record goes straight back to it */}
        <ReviewDock entry={current} locale={locale} busy={busy} onAnswer={(v) => void answer(current, v, { hold: !editing && status === "review" })} />
      </div>
    );
  }

  // ---- 「我说的话」: the lines the record holds as his own, each one his to give back
  if (ownIds) {
    const listed = ownIds.map((lineId) => view.lines.find((l) => l.id === lineId)).filter((l): l is LineView => !!l);
    return (
      <div style={{ display: "contents" }} data-testid="review-own-lines" data-status={status} data-count={listed.filter((l) => l.role === "patient").length}>
        <VisitHeader title={vw(locale, "own.title")} subtitle={context} locale={locale} onBack={() => setOwnIds(null)} />
        <div className="rpu-stack rpu-visit-body">
          <p className="rpu-visit-note">{vw(locale, "own.sub")}</p>
          <Timeline>
            {listed.map((l) => {
              const mine = l.role === "patient";
              // his own node only once it is confirmed as his; a guess is the dashed ring and says it is a guess
              const sure = mine && l.roleState === "confirmed";
              return (
                <TimelineItem
                  key={l.id}
                  node={sure ? "me" : "miss"}
                  time={clipTimeLabel(l.tStartMs)}
                  who={mine ? (sure ? at(locale, "review.mine.stateYes") : vw(locale, "own.guess")) : at(locale, "review.mine.stateNo")}
                  testId="review-own-lines-row"
                  attrs={{ "data-line": l.id, "data-mine": mine ? "true" : "false", "data-state": l.roleState }}
                  actions={
                    <div className="rpu-tl-ctl">
                      <button type="button" className="rpu-chip-btn" data-rp="change" aria-pressed={mine} data-testid="review-own-lines-toggle" onClick={() => void markMine(l.id, !mine)} disabled={busy}>
                        {at(locale, mine ? "review.mine.undo" : "review.mine.yes")}
                      </button>
                    </div>
                  }
                >
                  <Bubble node="me" lang={lineLang(l.lang)}>
                    “{l.text}”
                  </Bubble>
                </TimelineItem>
              );
            })}
          </Timeline>
          {problem}
        </div>
        <VisitDock>
          <PrimaryButton onClick={() => setOwnIds(null)} data-testid="review-own-lines-done">
            {vw(locale, "own.done")}
          </PrimaryButton>
        </VisitDock>
      </div>
    );
  }

  // ---- 05-6, 06-1, 06-2: the record
  const right = entries.filter((e) => e.verdict === "right").length;
  /** every line the record holds as his own (a guess or confirmed): behind one row, 「我说的话 N 句」 */
  const ownLines = view.lines.filter((l) => l.role === "patient");
  const confirmed = status === "confirmed";
  // 「哪几句是我说的」: lines nobody could attribute (not the ones asked about above, one by one), and, until he confirms,
  // the ones he marked as his own (so a slip can be taken back)
  const askedLines = new Set(entries.map((e) => e.lineId));
  const unclear = view.lines.filter((l) => !askedLines.has(l.id) && !l.inQuestion && (l.roleState === "unknown" || (!confirmed && l.role === "patient" && l.roleState === "confirmed")));
  const fu = view.account?.followUp ?? null;
  const groups = SPEAKERS.map((speaker) => ({ speaker, entries: entries.filter((e) => reviewSpeaker(e.role) === speaker) })).filter((g) => g.entries.length > 0);

  const row = (e: ReviewEntry): ReactNode => {
    const isRight = e.verdict === "right";
    const speaker = reviewSpeaker(e.role);
    const title = entryTitle(locale, e);
    const entry = (
      <TimelineItem
        key={e.key}
        node={isRight ? "doc" : "unc"}
        time={clipTimeLabel(e.tStartMs)}
        // 「医生说」 only after his 「是」; any other line is still the app's guess, and says what he answered
        who={isRight ? verdictWords(locale, e) : at(locale, `review.inferred.${speaker}`)}
        meta={isRight || e.verdict === "wrong" ? undefined : verdictWords(locale, e)}
        title={title ?? undefined}
        testId="review-row"
        attrs={{ "data-line": e.lineId, "data-verdict": e.verdict ?? "none" }}
      >
        {e.question ? <AskedWords question={{ text: e.question, own: e.questionOwn !== false }} locale={locale} /> : null}
        <Said lang={lineLang(e.lang)} source={{ kind: speaker, ref: e.lineId }}>
          “{e.text}”
        </Said>
        {e.translation ? <SaidTranslation note={at(locale, "review.translationTag")}>{e.translation}</SaidTranslation> : null}
        <ClipRow clip={e.clip} label={copy.listenOriginal} locale={locale}>
          {e.verdict === "wrong" ? <Tag tone="ink">{verdictWords(locale, e)}</Tag> : null}
          <button
            type="button"
            className="rpu-chip-btn rpu-visit-change"
            data-rp="change"
            data-testid="review-change"
            onClick={() => {
              leaveRecord();
              setEditing(e.key);
            }}
            disabled={busy}
          >
            {at(locale, "review.change")}
          </button>
        </ClipRow>
      </TimelineItem>
    );
    // a line he confirmed stands for a record of his: it can be held (the others are still the app's guess)
    return isRight && e.itemIds[0] ? (
      <Explainable key={e.key} as="line" subject={{ type: "visit_line", ref: lineRef(view.visit.id, e.itemIds[0]) }} locale={locale} label={title ?? verdictWords(locale, e)}>
        {entry}
      </Explainable>
    ) : (
      entry
    );
  };

  /**
   * 06-2: the stretch at the counter (or with the pharmacist), once he confirmed the visit: after the section's first
   * line, what he himself said there (confirmed as his) and the same speaker's lines the record holds nothing for (a
   * 「对。」), up to the first line of anyone else after the section's last line.
   */
  const stretch = (g: { speaker: Speaker; entries: ReviewEntry[] }): LineView[] => {
    if (g.speaker === "doctor" || !confirmed) return [];
    const from = g.entries[0].tStartMs;
    const last = g.entries[g.entries.length - 1].tStartMs;
    const out: LineView[] = [];
    for (const l of view.lines) {
      if (l.tStartMs <= from || askedLines.has(l.id)) continue;
      const his = l.role === "patient" && l.roleState === "confirmed";
      const theirs = l.role === g.speaker;
      if (l.tStartMs > last && !his && !theirs) break;
      if (his || theirs) out.push(l);
    }
    return out;
  };
  const stretchLine = (l: LineView, speaker: Speaker): ReactNode => {
    if (l.role === "patient") {
      return (
        <TimelineItem key={l.id} node="me" time={clipTimeLabel(l.tStartMs)} who={at(locale, "review.mine.stateYes")} testId="review-own-line" attrs={{ "data-line": l.id }}>
          <Bubble node="me" lang={lineLang(l.lang)}>
            {l.text}
          </Bubble>
        </TimelineItem>
      );
    }
    // a line of the counter's he was never asked about: the solid ring and 「柜台说」 only when the record holds it as confirmed
    const sure = l.roleState === "confirmed";
    return (
      <TimelineItem
        key={l.id}
        node={sure ? "doc" : "unc"}
        time={clipTimeLabel(l.tStartMs)}
        who={sure ? verdictWords(locale, { verdict: "right", role: l.role }) : at(locale, `review.inferred.${speaker}`)}
        testId="review-said-line"
        attrs={{ "data-line": l.id, "data-state": l.roleState }}
      >
        <Said lang={lineLang(l.lang)} source={{ kind: speaker, ref: l.id }}>
          “{l.text}”
        </Said>
        <ClipRow clip={l.clip} label={copy.listenOriginal} locale={locale} />
      </TimelineItem>
    );
  };

  return (
    <div style={{ display: "contents" }} data-testid="review-summary" data-status={status}>
      <PageHeader back={back} title={context} subtitle={confirmed ? vw(locale, "summary.done") : place} locale={locale} />
      <div className="rpu-stack rpu-visit-body">
        {banner}
        {/* Ripple's summary at the top of the record; the doctor's own lines follow, as before */}
        {notes}
        {/* where the review stands: 「认好了。」 until he saves; then 「记好了。」 and, 06-1, the medicine that waits for its label */}
        <Timeline>
          {confirmed ? (
            <TimelineItem node="ok" title={at(locale, "review.confirmedTitle")} titleWrap={(t) => <div data-rp="done-hero">{t}</div>} />
          ) : (
            <TimelineItem node="now" title={at(locale, "review.summaryTitle")} note={at(locale, "review.summarySub", { n: right })} />
          )}
          {confirmed && prescribed ? <TimelineItem node="now" title={at(locale, "review.next.medsSub")} testId="review-prescribed" /> : null}
        </Timeline>
        {/* 「回到今天」 only right after he saved the lines here; a confirmed visit opened from the records is there to be
            read, and the tab bar leads to today (owner's tidy of 10-13). 「看我的药物」 as before: while a medicine waits */}
        {confirmed && (prescribed || justSaved) ? (
          <div className="rpu rpu-btns rpu-ind">
            {prescribed ? (
              <PrimaryButton href="/p/meds" data-testid="review-to-meds">
                {at(locale, "review.next.meds")}
              </PrimaryButton>
            ) : (
              <PrimaryButton href="/p/today">{at(locale, "review.next.today")}</PrimaryButton>
            )}
            {prescribed && justSaved ? <Button variant="link" href="/p/today">{at(locale, "review.next.today")}</Button> : null}
          </div>
        ) : null}

        {groups.map((g) => {
          const items: { t: number; node: ReactNode }[] = [
            ...g.entries.map((e) => ({ t: e.tStartMs, node: row(e) })),
            ...stretch(g).map((l) => ({ t: l.tStartMs, node: stretchLine(l, g.speaker) })),
          ].sort((a, b) => a.t - b.t);
          return (
            <section key={g.speaker} className="rpu-visit-group" data-testid="review-said" data-speaker={g.speaker}>
              <SectionTitle>{vw(locale, `summary.section.${g.speaker}`)}</SectionTitle>
              <Timeline>{items.map((i) => i.node)}</Timeline>
            </section>
          );
        })}

        {ownLines.length ? (
          <ListCard testId="review-own-lines-entry">
            <ListItem
              mark="me"
              title={vw(locale, "own.count", { n: ownLines.length })}
              right={vw(locale, "own.open")}
              rightTone="accent"
              chevron
              onClick={() => {
                leaveRecord();
                setOwnIds(ownLines.map((l) => l.id));
              }}
              testId="review-own-lines-open"
              attrs={{ "data-count": ownLines.length }}
            />
          </ListCard>
        ) : null}

        {/* what he said next to his own records (the check cards): its own section, components/visit/elder/ReviewChecks.tsx */}
        <ReviewChecks view={view} locale={locale} />

        {unclear.length ? (
          <section className="rpu-visit-group" data-testid="review-mine" data-count={unclear.length}>
            <div>
              <SectionTitle>{at(locale, "review.mine.section")}</SectionTitle>
              <p className="rpu-visit-note" style={{ marginTop: 6 }}>
                {at(locale, "review.mine.sub")}
              </p>
            </div>
            <Timeline>
              {unclear.map((l) => {
                const mine = l.role === "patient";
                return (
                  <TimelineItem
                    key={l.id}
                    node={mine ? "me" : "miss"}
                    time={clipTimeLabel(l.tStartMs)}
                    who={at(locale, mine ? "review.mine.stateYes" : "review.mine.stateNo")}
                    testId="review-mine-row"
                    attrs={{ "data-line": l.id, "data-mine": mine ? "true" : "false" }}
                    actions={
                      <div className="rpu-tl-ctl">
                        <button type="button" className="rpu-chip-btn" data-rp="change" aria-pressed={mine} data-testid="review-mine-toggle" onClick={() => void markMine(l.id, !mine)} disabled={busy}>
                          {at(locale, mine ? "review.mine.undo" : "review.mine.yes")}
                        </button>
                      </div>
                    }
                  >
                    <Bubble node="me" lang={lineLang(l.lang)}>
                      “{l.text}”
                    </Bubble>
                  </TimelineItem>
                );
              })}
            </Timeline>
          </section>
        ) : null}

        {fu ? (
          <section className="rpu-visit-group" data-testid="review-follow-up" data-visit={fu.id} data-approx={fu.approx ? "true" : "false"} data-date={fu.date}>
            <SectionTitle>{at(locale, "review.followUp.section")}</SectionTitle>
            <Timeline>
              <TimelineItem node="next" title={at(locale, fu.approx ? "review.followUp.approx" : "review.followUp.booked", { date: shortDate(fu.date, locale) })} />
            </Timeline>
            {booking === null ? (
              <div className="rpu-ind">
                <SecondaryButton onClick={() => setBooking(fu.date)} disabled={busy} data-testid="review-follow-up-change">
                  {at(locale, "review.followUp.change")}
                </SecondaryButton>
              </div>
            ) : (
              <div className="rpu-visit-group rpu-ind" data-rp="follow-up-date">
                <Field
                  className="rpu-visit-field"
                  id="rpu-follow-up-date"
                  type="date"
                  label={at(locale, "review.followUp.label")}
                  error={bookFailed ? <span data-rp="form-problem" data-testid="review-follow-up-bad">{at(locale, "review.followUp.bad")}</span> : undefined}
                  value={booking}
                  onChange={(e) => setBooking(e.target.value)}
                  data-testid="review-follow-up-date"
                />
                <div className="rpu rpu-btns">
                  <SecondaryButton onClick={() => void book(fu.id, booking)} disabled={busy || !/^\d{4}-\d{2}-\d{2}$/.test(booking)} data-testid="review-follow-up-save">
                    {at(locale, "review.followUp.save")}
                  </SecondaryButton>
                  <Button
                    variant="link"
                    onClick={() => {
                      setBooking(null);
                      setBookFailed(false);
                    }}
                    disabled={busy}
                  >
                    {at(locale, "review.followUp.cancel")}
                  </Button>
                </div>
              </div>
            )}
          </section>
        ) : null}

        {ownNotesList}
        {retention}
        {problem}
      </div>
      {confirmed ? null : (
        <VisitDock>
          <PrimaryButton onClick={() => void save()} pending={busy} data-testid="review-save">
            {at(locale, "review.save")}
          </PrimaryButton>
        </VisitDock>
      )}
    </div>
  );
}
