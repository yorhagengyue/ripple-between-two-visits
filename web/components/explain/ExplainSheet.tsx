"use client";

/**
 * Ripple's read of the thing he held (owner's decision of 10-14, modelled on his iOS app's Explain sheet:
 * RippleApp/Explain/ExplainSheet.swift). A sheet over the foot of the phone, not a page: the elder side's light paper,
 * nothing under 18px, buttons 64 high, no shadow.
 *
 *   the bar        「Ripple 的解读」 and 「关」
 *   the name       what he held, as the server names it (the screen's own name for it while that is on its way)
 *   the sentence   one or two sentences, in Ripple's tinted bubble: the model's, written from the evidence below and let
 *                  through by the guards, else the one built from his records (data-by, data-why say which)
 *   查看了什么      what Ripple looked at, as ticked lines
 *   原话           the quotes that bear on it, in the order the server gives them, drawn with the ask screen's own
 *                  pieces (components/daily/answer-parts.ts sorts them; SourceLine, <Said>, the label as printed,
 *                  PlayClip for a line that has a recording): who said it and when, word for word. Nothing here
 *                  writes a sentence. For a reading of today above the doctor's warning line the fixed 995 template
 *                  is among them, after his doctor's own words (lib/safety/threshold.ts, the owner's order of 10-14):
 *                  the red card with its one call button, by itself between two stretches of the line, as on the ask
 *                  screen
 *   the line       「来自你的记录和医生的原话，不是医疗建议。」
 *   the foot       「加进问题单」 (POST /api/questions, the question list's own route: the thing's name in a fixed frame,
 *                  his to change on the list; not offered for a question that is on the list already) and 「再问一句」
 *                  (the ask screen)
 * States: 「正在看…」 while loading; 「现在看不了，过一会儿再试。」 with 「再试一次」 when it failed; 「这条记录找不到了。」 when
 * his records no longer hold the thing. Closing: 「关」, the Escape key, a tap on the dimmed ground.
 *
 * POST /api/explain answers as Server-Sent Events (owner 10-15: 「需要非常完整的 SSE 的输出，无论是哪个端，子女和老人」; the
 * route's header lists them; lib/sse/client.ts reads them): first what Ripple looked at (the lines and the quotes, at
 * once), then the sentence word by word in Ripple's bubble with a soft caret and 「正在写…」 under it (explain-writing),
 * then the answer itself (explain-verdict, as before). Words the server takes back (the model abstained, a guard dropped
 * them) leave the bubble, and the sentence built from his records stands. A plain answer (JSON, or the lines of
 * application/x-ndjson the sheet asked for before 10-15) is read as it always was.
 *
 * On a family member's screen (`link`: her care link; owner's decision of 10-14, the same sheet on the family side) the
 * layout is this one, and four things differ:
 *   the read      POST /api/explain?link=<her link>: his record through her link, cut by his switches, in the family
 *                 side's words (about him, never 「你」). A thing she may not hold is 「这条记录已不存在，或未分享。」
 *   the line      「根据{爸爸}同意分享的记录写成，不是医嘱。」 in the place of his line. It comes with the answer
 *                 (HoldRead.note): her word for him is the one kept with her link, which only the server knows
 *   the foot      「加入待问问题」 posts to /api/explain/add?link= with what she held and nothing else (the server writes
 *                 the question's words again from what she may see); it is there only while he shares his questions
 *                 with her (the answer's `ask` is null otherwise). No 「再问一句」: the ask screen is his
 *   the place     drawn on the page, held to her phone's column (explain.css, data-viewer="family")
 *
 * Test hooks: explain-sheet (data-state: loading, read, failed, gone; data-type, data-ref), explain-close,
 * explain-name, explain-verdict (data-by, data-why, data-abstain), explain-writing (the sentence while it is written),
 * explain-checked, explain-sources, explain-source (data-kind, data-source), explain-clip, explain-add (data-state),
 * explain-ask-more, explain-retry.
 */
import { useRouter } from "next/navigation";
import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { SourceLine } from "@/components/chat/ChatAnswer";
import { PlayClip } from "@/components/chat/PlayClip";
import { answerParts, type AnswerPart } from "@/components/daily/answer-parts";
import { askCopy } from "@/components/daily/ask-copy";
import { ButtonRow, EmergencyBlock, LabelOriginal, Said, SaidTranslation, SecondaryButton, Timeline, TimelineItem } from "@/components/ui";
import { holdWords } from "@/lib/explain/copy";
import type { HoldLocale, HoldRead, HoldSubject } from "@/lib/explain/subjects";
import { sendJson } from "@/lib/profile/client";
import { fetchSignedIn } from "@/lib/session/client";
import { postEventStream } from "@/lib/sse/client";
import { uiCopy } from "@/lib/ui/copy";
import type { NodeKind } from "@/lib/ui/tokens";
import "./explain.css";
import { TypeOut } from "./TypeOut";

/** The answer as it stands: the lines and quotes, with the sentence still on its way (`waiting`) or there. */
type Shown = HoldRead;

type State = { phase: "loading" } | { phase: "failed" } | { phase: "gone" } | { phase: "read"; read: Shown };

/** No answer at all after this long: 「现在看不了」 (the server caps its one model call at 8 s). */
const GIVE_UP_MS = 20_000;

/** Each line of the answer as it arrives (one JSON object per line; a plain JSON body is one line). */
async function readLines(res: Response, onLine: (read: Shown) => void): Promise<void> {
  const take = (line: string) => {
    if (line.trim()) onLine(JSON.parse(line) as Shown);
  };
  const reader = res.body?.getReader();
  if (!reader) {
    (await res.text()).split("\n").forEach(take);
    return;
  }
  const decoder = new TextDecoder();
  let rest = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (value) rest += decoder.decode(value, { stream: true });
    for (let cut = rest.indexOf("\n"); cut >= 0; cut = rest.indexOf("\n")) {
      take(rest.slice(0, cut));
      rest = rest.slice(cut + 1);
    }
    if (done) break;
  }
  take(rest);
}

const TICK = (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={3.4} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
    <path d="m5 12.5 4.5 4.5L19 7.5" />
  </svg>
);

/** One quoted source as an entry of the line, as the ask screen draws it (components/daily/AnswerCard.tsx). */
function SourceEntry({ part, locale, family }: { part: AnswerPart; locale: HoldLocale; family?: boolean }) {
  const copy = askCopy(locale);
  const ui = uiCopy(locale);
  const hooks = { testId: "explain-source", attrs: { "data-kind": part.kind, "data-source": part.source } as const };
  if (part.kind === "quote") {
    // who said it: the words that carry the rule stay as they are (「好像是医生说的」 until he confirmed the speaker)
    const guessed = part.inferred && part.speaker === "doctor";
    const who = guessed ? ui.inferredDoctor : part.inferred ? ui.sources[part.speaker] : part.speaker === "pharmacist" ? copy.pharmacistSaid : part.speaker === "dispenser" ? copy.dispenserSaid : copy.doctorSaid;
    const node: NodeKind = guessed ? "unc" : "doc";
    return (
      <TimelineItem node={node} frame={guessed ? "dash" : undefined} {...hooks}>
        <SourceLine kind={part.speaker} node={node} who={who} when={part.when} inferred={part.inferred} />
        <Said lang={part.lang} source={{ kind: part.speaker, ref: part.ref }} style={{ marginTop: 0 }}>
          {part.lang === "en" ? `“${part.text}”` : `「${part.text}」`}
        </Said>
        {part.translation ? <SaidTranslation note={copy.translation}>{part.translation}</SaidTranslation> : null}
        {part.clipUrl ? <PlayClip url={part.clipUrl} standIn={part.standIn} locale={locale} label={copy.listen} playingLabel={copy.listening} testId="explain-clip" /> : null}
      </TimelineItem>
    );
  }
  if (part.kind === "label") {
    return (
      <TimelineItem node="lab" {...hooks}>
        {/* hers: the tag in her register (owner 10-14), and the label as it is printed; the plain restatement is his side's */}
        <SourceLine kind="label" node="lab" who={family ? (locale === "en" ? "Medicine label" : "药品标签") : ui.sources.label} />
        {part.restated && !family ? (
          <p className="rpu-said" data-rp="label-line" lang="zh-Hans" style={{ marginTop: 0 }}>
            {part.restated}
          </p>
        ) : null}
        <LabelOriginal style={{ marginTop: 0 }}>{part.printed}</LabelOriginal>
      </TimelineItem>
    );
  }
  if (part.kind === "leaflet") {
    return (
      <TimelineItem node="lab" {...hooks} note={part.from ? copy.leafletFrom(part.from) : undefined}>
        <SourceLine kind="leaflet" node="lab" who={ui.sources.leaflet} />
        <p className="rpu-said" data-rp="leaflet-line" lang={part.lang} style={{ marginTop: 0 }}>
          {part.text}
        </p>
      </TimelineItem>
    );
  }
  // the evidence holds quotes only (lib/explain/evidence.ts): nothing else is drawn as a source
  return null;
}

export function ExplainSheet({
  subject,
  locale,
  name,
  link,
  onClose,
  closing = false,
}: {
  subject: HoldSubject;
  locale: HoldLocale;
  /** the screen's own name for the thing, until the server's arrives */
  name?: string;
  /** her care link's id: a family member reads his record through it (see the header) */
  link?: string;
  onClose: () => void;
  /** it is on its way out: it goes down over its fading ground (explain.css), and takes no more taps */
  closing?: boolean;
}) {
  const family = !!link;
  const query = link ? `?link=${encodeURIComponent(link)}` : "";
  // hers: the family side's words for the sheet's own parts. The one line that names him (「根据爸爸同意分享的记录写成」)
  // comes with the answer (HoldRead.note): only the server knows how she calls him
  const w = holdWords(locale, family ? { kind: "family", dad: "" } : { kind: "self" });
  const ui = uiCopy(locale);
  const router = useRouter();
  const titleId = useId();
  const sheet = useRef<HTMLDivElement | null>(null);
  /** a tap on the ground closes only when it began there (the finger that held the element is still coming up) */
  const groundDown = useRef(false);
  const [state, setState] = useState<State>({ phase: "loading" });
  /** SSE: the sentence while the model writes it (null: nothing is being written) */
  const [writing, setWriting] = useState<string | null>(null);
  // the final sentence came through the stream: it types out (TypeOut); a plain answer shows at once
  const [typed, setTyped] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [adding, setAdding] = useState(false);
  const [added, setAdded] = useState<null | "added" | "on_list" | "aside" | "failed">(null);

  // the one request: what he held, nothing else
  useEffect(() => {
    let live = true;
    const ctl = new AbortController();
    const giveUp = window.setTimeout(() => ctl.abort(), GIVE_UP_MS);
    /** whatever went wrong: the lines already on the screen stay (with the sentence built from his records), else 「现在看不了」 */
    const fail = () => {
      if (live) setState((s) => (s.phase === "read" ? { phase: "read", read: { ...s.read, waiting: false } } : { phase: "failed" }));
    };
    (async () => {
      try {
        if (live) setWriting(null);
        // SSE: what Ripple looked at, then the sentence word by word, then the answer (see the header)
        let failed = false;
        const out = await postEventStream(
          `/api/explain${query}`,
          { subject_type: subject.type, subject_ref: subject.ref, locale },
          {
            signal: ctl.signal,
            fetchImpl: fetchSignedIn,
            onEvent: ({ event, data }) => {
              if (!live) return;
              if (event === "read") setState({ phase: "read", read: data as Shown });
              else if (event === "stage") setWriting((w) => w ?? "");
              // (10-15: the words as the model writes them are not painted: a check may still refuse them, and a word on
              // the screen is never taken back. The sheet shows Ripple writing; the checked sentence then types out)
              else if (event === "delta") setWriting((w) => w ?? "");
              else if (event === "retract") setWriting((w) => w ?? "");
              else if (event === "final") {
                setWriting(null);
                setTyped(true);
                setState({ phase: "read", read: data as Shown });
              } else if (event === "error") failed = true;
            },
          },
        );
        const res = out.res;
        if (out.streamed) {
          // a stream that broke off, or an error after it began: the lines already on the screen stay
          if (!out.ended || failed) fail();
          if (live) setWriting(null);
          return;
        }
        // hers: a link that is over (403) or gone reads as a record that is not there: nothing of his is said
        if (res.status === 404 || (family && res.status === 403)) {
          if (live) setState({ phase: "gone" });
          return;
        }
        if (!res.ok) return fail();
        // a plain answer: one JSON object (or the lines of the sheet before 10-15)
        let lines = 0;
        await readLines(res, (read) => {
          lines += 1;
          if (live) setState({ phase: "read", read });
        });
        // the last line is the whole answer: nothing is on its way any more
        if (lines === 0) fail();
        else if (live) setState((s) => (s.phase === "read" && s.read.waiting ? { phase: "read", read: { ...s.read, waiting: false } } : s));
      } catch {
        fail();
      } finally {
        window.clearTimeout(giveUp);
      }
    })();
    return () => {
      live = false;
      window.clearTimeout(giveUp);
      ctl.abort();
    };
  }, [subject.type, subject.ref, locale, attempt, query]);

  // Escape closes; the sheet takes the focus when it opens
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.stopPropagation();
      onClose();
    };
    window.addEventListener("keydown", onKey, true);
    sheet.current?.focus({ preventScroll: true });
    return () => window.removeEventListener("keydown", onKey, true);
  }, [onClose]);

  const read = state.phase === "read" ? state.read : null;
  // the sources in the order the server gave them, as stretches of a line: 995 (a card by itself) stands between them
  const parts = read ? answerParts(read.sources, locale).filter((p) => p.kind === "quote" || p.kind === "label" || p.kind === "leaflet" || p.kind === "emergency") : [];
  const blocks: ReactNode[] = [];
  let line: ReactNode[] = [];
  const flush = (key: string) => {
    if (line.length) blocks.push(<Timeline key={key}>{line}</Timeline>);
    line = [];
  };
  parts.forEach((p, i) => {
    if (p.kind === "emergency") {
      flush(`line-${i}`);
      blocks.push(
        <div key={`${p.source}-${i}`} data-testid="explain-source" data-kind={p.kind} data-source={p.source}>
          <EmergencyBlock who={ui.sources.ripple} title={p.text} call={{ number: "995" }} locale={locale} style={{ marginTop: 0 }} />
        </div>,
      );
    } else {
      line.push(<SourceEntry key={`${p.source}-${i}`} part={p} locale={locale} family={family} />);
    }
  });
  flush("line-end");

  async function add() {
    if (!read?.ask || adding || added === "added" || added === "on_list" || added === "aside") return;
    setAdding(true);
    setAdded(null);
    // his: the question list's own route, with the words the answer gave. Hers: only what she held; the server writes
    // the words again from what she may see
    const r = family
      ? await sendJson<{ outcome?: string }>("POST", `/api/explain/add${query}`, { subject_type: subject.type, subject_ref: subject.ref, locale })
      : await sendJson<{ outcome?: string }>("POST", "/api/questions", { text: read.ask.text, for: read.ask.for, origin: "own" });
    setAdding(false);
    if (!r.ok) return setAdded("failed");
    // hers: words he set aside stay set aside (lib/care/family-questions.ts), and the button says so
    setAdded(r.data.outcome === "created" ? "added" : r.data.outcome === "aside" ? "aside" : "on_list");
    // the screens under the sheet count his questions: they read again
    router.refresh();
  }

  const stop = (e: { stopPropagation: () => void }) => e.stopPropagation();
  return (
    // nothing done in the sheet reaches what React holds above the element he pressed
    <div
      className="rpx-root"
      data-rp-phone-fixed=""
      data-testid="explain-sheet"
      data-state={state.phase}
      data-type={subject.type}
      data-ref={subject.ref}
      data-viewer={family ? "family" : undefined}
      data-closing={closing ? "true" : undefined}
      lang={locale}
      onClick={stop}
      onPointerDown={stop}
      onPointerUp={stop}
      onMouseDown={stop}
      onMouseUp={stop}
      onTouchStart={stop}
      onTouchEnd={stop}
      onKeyDown={stop}
      onContextMenu={stop}
    >
      <div
        className="rpx-ground"
        data-testid="explain-ground"
        onPointerDown={() => {
          groundDown.current = true;
        }}
        onClick={() => {
          if (groundDown.current) onClose();
        }}
      />
      <div ref={sheet} className="rpx-sheet" role="dialog" aria-modal="true" aria-labelledby={titleId} tabIndex={-1}>
        <div className="rpx-bar">
          <p className="rpx-bar-t" id={titleId}>
            {w.sheetTitle}
          </p>
          <button type="button" className="rpx-close" data-testid="explain-close" onClick={onClose}>
            {w.close}
          </button>
        </div>
        <div className="rpx-body">
          {read?.subject.name || name ? (
            <h2 className="rpx-name" data-testid="explain-name">
              {read?.subject.name ?? name}
            </h2>
          ) : null}
          {state.phase === "loading" ? (
            <p className="rpx-wait" role="status" data-testid="explain-loading">
              {w.loading}
            </p>
          ) : null}
          {state.phase === "failed" ? (
            <p className="rpx-wait" role="alert" data-testid="explain-failed">
              {w.failed}
            </p>
          ) : null}
          {state.phase === "gone" ? (
            <p className="rpx-wait" role="alert" data-testid="explain-gone">
              {w.gone}
            </p>
          ) : null}
          {read ? (
            <>
              {read.waiting && writing !== null ? (
                // SSE: Ripple is writing (the soft caret alone in its bubble), 「正在写…」 under it; the sentence itself
                // appears once it passed its checks (TypeOut below)
                <>
                  <p className="rpu-bubble" data-rp="bubble" data-node="rip" data-rp-role="say" data-testid="explain-writing">
                    <span className="rpu-caret" aria-hidden="true" />
                  </p>
                  <p className="rpx-wait" role="status" data-testid="explain-loading">
                    {w.writing}
                  </p>
                </>
              ) : read.waiting ? (
                <p className="rpx-wait" role="status" data-testid="explain-loading">
                  {writing !== null ? w.writing : w.loading}
                </p>
              ) : (
                <p className="rpu-bubble" data-rp="bubble" data-node="rip" data-rp-role="say" data-testid="explain-verdict" data-by={read.verdictBy} data-why={read.verdictWhy} data-abstain={read.abstain ? "true" : "false"}>
                  <TypeOut text={read.verdict} animate={typed} />
                </p>
              )}
              {read.checked.length ? (
                <section className="rpx-sec" data-testid="explain-checked">
                  <p className="rpu rpu-label">{w.checked}</p>
                  <ul className="rpx-checked">
                    {read.checked.map((line, i) => (
                      <li key={i}>
                        <span className="rpx-tick" aria-hidden="true">
                          {TICK}
                        </span>
                        <span>{line}</span>
                      </li>
                    ))}
                  </ul>
                </section>
              ) : null}
              {blocks.length ? (
                <section className="rpx-sec" data-testid="explain-sources">
                  <p className="rpu rpu-label">{w.sources}</p>
                  {blocks}
                </section>
              ) : null}
              <p className="rpx-note" data-testid="explain-disclaimer">
                {read.note ?? w.disclaimer}
              </p>
            </>
          ) : null}
        </div>
        {/* hers: 「加入待问问题」 alone (no 「再问一句」: the ask screen is his), and no foot at all when there is nothing
            to add (he does not share his questions, or the thing is a question already) */}
        {family && state.phase !== "failed" && !read?.ask ? null : (
          <div className="rpx-foot">
            {state.phase === "failed" ? (
              <SecondaryButton
                data-testid="explain-retry"
                onClick={() => {
                  setState({ phase: "loading" });
                  setAttempt((n) => n + 1);
                }}
              >
                {w.retry}
              </SecondaryButton>
            ) : (
              <ButtonRow cols={read?.ask && !family ? 2 : 1}>
                {read?.ask ? (
                  <SecondaryButton data-testid="explain-add" data-state={added ?? "idle"} pending={adding} disabled={added === "added" || added === "on_list" || added === "aside"} onClick={() => void add()}>
                    {added === "added" ? w.added : added === "on_list" ? w.onList : added === "aside" ? w.aside : w.add}
                  </SecondaryButton>
                ) : null}
                {family ? null : (
                  <SecondaryButton href="/p/ask" data-testid="explain-ask-more">
                    {w.askMore}
                  </SecondaryButton>
                )}
              </ButtonRow>
            )}
            {added === "failed" ? (
              <p className="rpx-note" role="alert">
                {w.addFailed}
              </p>
            ) : null}
          </div>
        )}
      </div>
    </div>
  );
}
