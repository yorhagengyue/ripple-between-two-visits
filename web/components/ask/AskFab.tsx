"use client";

/**
 * 提问 as one round button at the bottom right of his pages (owner 10-15: 「提问这个部分可以做成全局的右下角按钮。然后它长按
 * 就可以直接语音输入然后输出解释和推荐，不要单独做一个页面，这样太重了」). Mounted once in his layout (app/p/layout.tsx), so
 * it is on every page that has his tab bar, and on none without one (the recording, the consent card, sign-in).
 *
 *   hold        he holds the button: after HOLD_MS the microphone opens and a sheet rises: 「正在听」, bars that move with
 *               his voice. He lets go: the words are made (POST /api/ask/transcribe: Tencent Cloud or Whisper, as the
 *               deployment has it) and asked at once (POST /api/ask, the very request a typed question makes), and the
 *               answer opens in the sheet: his words, then Ripple's answer (components/daily/AnswerCard). Sliding the
 *               finger up off the button before letting go cancels: nothing is sent.
 *   tap         a short tap opens the same sheet with a field to type the question in.
 *   the sheet   stays over the page he is on (no page of its own); 「关闭」 or a tap on the dark backdrop closes it. After an
 *               answer the field is there for the next question.
 * Without a speech service (askVoiceAvailable false: the offline preview) a hold opens the typing sheet with a line that
 * says speaking is not available here.
 * SSE (owner 10-15: 「需要非常完整的 SSE 的输出」): the question goes as a stream (components/today/AskSection.tsx streamAsk), so
 * the sheet shows his words, then the answer as it is made: the sentences that are final already, Ripple's own words as
 * they are written with a soft caret, the stage line under them (「在找医生说过的话……」, 「正在写……」; hook ask-thinking), all
 * drawn by AnswerCard's draft; then the final answer as before (ask-fab-answer).
 * The guided harness (2026-10-16): an answer may end on one follow-up question with buttons (AnswerCard, FollowUpQuestion).
 * His tap is asked as a typed question is, with `reply`: the answer stays in the sheet with what he chose marked and the
 * waiting line under it until the new answer begins, then the sheet shows the new answer as the next question's, and the
 * focus moves to it; a tap that did not go through opens the question again with the sentence that says why. The sheet holds
 * one answer, so only its question is ever shown. The button stands above the tab bar and above any buttons fixed at the bottom of
 * the page (a [data-rp="dock"]) or the undo strip after a reading (a [data-rp="toast"]), so it never covers them.
 */
import { usePathname } from "next/navigation";
import { useCallback, useEffect, useRef, useState, type FormEvent, type PointerEvent as ReactPointerEvent } from "react";
import { AnswerCard } from "@/components/daily/AnswerCard";
import { FollowUpChip } from "@/components/daily/FollowUpQuestion";
import { placeFollowUp } from "@/components/daily/follow-up-place";
import { askCopy, limitWords } from "@/components/daily/ask-copy";
import { draftAnswer, hasProgress, stageWords, streamAsk, type AskProgress } from "@/components/today/AskSection";
import { Icon } from "@/components/ui/icons";
import { barsFor } from "@/components/visit/elder/MicCheck";
import { micName, rememberMic, settleMic, startRecording } from "@/components/visit/mic-devices";
import { useWavRecorder } from "@/components/visit/useWavRecorder";
import type { FollowUpReply } from "@/lib/safety/risk/types";
import type { AskTurn } from "@/lib/safety/turns";
import type { UiLocale } from "@/lib/ui/tokens";
import { parseWav, sliceWav } from "@/lib/visit/wav";
import "./ask-fab.css";

/** How long a press is before it is a hold (the microphone opens). */
export const HOLD_MS = 350;
/** Sliding up this far off the button before letting go cancels a spoken question. */
const CANCEL_PX = 80;
/** The longest spoken question (the transcription route takes 30 s). */
const MAX_LISTEN_MS = 29_000;

const WORDS = {
  "zh-Hans": {
    button: "提问",
    buttonHint: "提问：点一下打字，按住说话",
    listening: "正在听",
    mic: "麦克风：",
    letGo: "说完松开，就会回答",
    cancelHint: "上滑取消",
    cancelNow: "松开取消",
    thinking: "正在想……",
    close: "关闭",
    field: "打字问",
    send: "问这句",
    holdHint: "也可以按住右下角的按钮直接说。",
    holdToSpeak: "按住 说话",
    letGoToAsk: "松开 就问",
    noVoice: "这里不能用说的，请打字问。",
    micOff: "麦克风打不开。请在浏览器里允许使用麦克风，或者打字问。",
  },
  en: {
    button: "Ask",
    buttonHint: "Ask: tap to type, hold to speak",
    listening: "Listening",
    mic: "Microphone: ",
    letGo: "Let go when you have finished, and Ripple answers",
    cancelHint: "Slide up to cancel",
    cancelNow: "Let go to cancel",
    thinking: "Thinking…",
    close: "Close",
    field: "Type a question",
    send: "Ask this",
    holdHint: "You can also hold the round button at the bottom right and speak.",
    holdToSpeak: "Hold to speak",
    letGoToAsk: "Let go to ask",
    noVoice: "Speaking is not available here; please type.",
    micOff: "The microphone could not be opened. Allow it in the browser, or type your question.",
  },
} as const;

type Mode = "closed" | "typing" | "listening" | "making" | "asking" | "answer";

/** Pages where the button is not drawn although they may have a tab bar: the old ask screen and the day's conversation. */
const NOT_ON = [/^\/p\/ask(?:\/|$)/, /^\/p\/chat(?:\/|$)/];

/**
 * The bottom edge the button stands on: the top of the tab bar or of the highest fixed dock or undo strip, whichever is
 * higher. Null (the button is not drawn) without a fixed tab bar, and while a part of the page that must not have it
 * floating over is there (a [data-fab="off"], 10-15: the blood pressure keypad, whose bottom-right key it covered; the
 * card after a reading outside the target, whose own hold button is the one to use there).
 */
function standOn(): number | null {
  const bar = document.querySelector<HTMLElement>('.rpu-tabs[data-placement="fixed"]');
  if (!bar || document.querySelector('[data-fab="off"]')) return null;
  let top = bar.getBoundingClientRect().top;
  for (const dock of document.querySelectorAll<HTMLElement>('[data-rp="dock"], [data-rp="toast"]')) {
    const pos = getComputedStyle(dock).position;
    if (pos !== "fixed" && pos !== "sticky") continue;
    const r = dock.getBoundingClientRect();
    if (r.height > 0 && r.bottom >= window.innerHeight - 160 && r.top < top) top = r.top;
  }
  return window.innerHeight - top;
}

export function AskFab({ locale, voice }: { locale: UiLocale; voice: boolean }) {
  const pathname = usePathname() ?? "";
  const w = WORDS[locale === "en" ? "en" : "zh-Hans"];
  const copy = askCopy(locale);
  const recorder = useWavRecorder({ hold: true });
  const [mode, setModeState] = useState<Mode>("closed");
  // the page the sheet was opened on: on another page it is closed (a listening microphone stays until he lets go)
  const [sheetPath, setSheetPath] = useState(pathname);
  const setMode = useCallback(
    (m: Mode | ((cur: Mode) => Mode)) => {
      setSheetPath(pathname);
      setModeState(m);
    },
    [pathname],
  );
  const [bottom, setBottom] = useState<number | null>(null);
  const [turn, setTurn] = useState<AskTurn | null>(null);
  /** SSE: the answer as it stands while it is being made */
  const [progress, setProgress] = useState<AskProgress | null>(null);
  /** SSE: the answer took the place of its draft, which was on the screen (it does not rise in again) */
  const [settled, setSettled] = useState(false);
  /** harness (10-16): his tap on the answer's follow-up question is on its way */
  const [replying, setReplying] = useState<FollowUpReply | null>(null);
  /** harness (10-16): the question could not show with the 995 line when the answer came: the chip (the answer's turn id) */
  const [chipFor, setChipFor] = useState<string | null>(null);
  const sheet = useRef<HTMLElement | null>(null);
  const hideChip = useCallback(() => setChipFor(null), []);
  const sheetRoot = useCallback(() => sheet.current, []);
  const openQuestion = useCallback(() => sheet.current?.querySelector<HTMLElement>('[data-testid="ask-fab-answer"] [data-testid="ask-followup"][data-state="open"]') ?? null, []);
  const [heard, setHeard] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [lit, setLit] = useState(0);
  const [micLabel, setMicLabel] = useState("");
  const [cancelling, setCancelling] = useState(false);
  const press = useRef<{ timer: number | null; held: boolean; startY: number; started: boolean } | null>(null);
  const field = useRef<HTMLTextAreaElement | null>(null);
  const hidden = NOT_ON.some((re) => re.test(pathname));

  // where the button stands: re-read when the page changes, the window resizes or the page's bottom bars change
  useEffect(() => {
    if (hidden) return;
    let raf = 0;
    const place = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => setBottom(standOn()));
    };
    place();
    const mo = new MutationObserver(place);
    mo.observe(document.body, { childList: true, subtree: true });
    window.addEventListener("resize", place);
    return () => {
      cancelAnimationFrame(raf);
      mo.disconnect();
      window.removeEventListener("resize", place);
    };
  }, [hidden, pathname]);

  // while the button is drawn the page keeps room for it at its foot (ask-fab.css), so its last buttons scroll clear of it
  const drawn = !hidden && bottom !== null;
  useEffect(() => {
    if (!drawn) return;
    document.documentElement.setAttribute("data-ask-fab", "shown");
    return () => document.documentElement.removeAttribute("data-ask-fab");
  }, [drawn]);

  // the bars while he speaks
  useEffect(() => {
    if (mode !== "listening") return;
    const t = window.setInterval(() => {
      setLit(barsFor(recorder.level()));
      setMicLabel(micName(recorder.inputLabel()));
    }, 120);
    const stop = window.setTimeout(() => void finishSpeaking(false), MAX_LISTEN_MS);
    return () => {
      window.clearInterval(t);
      window.clearTimeout(stop);
    };
    // finishSpeaking is stable enough here: it reads refs and the recorder
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode]);

  const ask = useCallback(
    async (text: string, reply?: FollowUpReply) => {
      const q = text.trim();
      if (!q) return;
      setNote(null);
      setProgress(null);
      if (reply) {
        // harness (10-16): his tap on the answer's follow-up question: the answer stays in the sheet, what he chose marked
        // and the waiting line under it, until the new answer begins
        if (typeof navigator !== "undefined" && navigator.onLine === false) {
          setNote(copy.offline);
          return;
        }
        setReplying(reply);
      } else {
        setHeard(q);
        setMode("asking");
        if (typeof navigator !== "undefined" && navigator.onLine === false) {
          setNote(copy.offline);
          setMode("typing");
          return;
        }
      }
      // SSE: the answer as it is made goes to the sheet (the outcome is the plain request's)
      let drafted = false;
      const out = await streamAsk(
        q,
        locale,
        (p) => {
          if (hasProgress(p) && !drafted && reply) {
            // his tap's answer has begun: the next turn, as a typed question's
            setHeard(q);
            setMode("asking");
          }
          if (hasProgress(p)) drafted = true;
          setProgress(p);
        },
        reply,
      );
      setProgress(null);
      setSettled(drafted);
      setReplying(null);
      if (!out.ok) {
        setNote(out.status === 429 ? limitWords(locale, out) : out.status === 0 ? copy.offline : copy.failed);
        // a tap that did not go through: the answer and its question again (the sheet still holds that turn)
        setMode(reply ? "answer" : "typing");
        return;
      }
      setTurn(out.turn);
      setMode("answer");
      setChipFor(null);
      requestAnimationFrame(() => {
        // harness (10-16): an answer with a question: the sheet goes where the question shows, the 995 line kept in view
        const answer = sheet.current?.querySelector<HTMLElement>('[data-testid="ask-fab-answer"]');
        if (answer && placeFollowUp(answer, sheet.current?.querySelector<HTMLElement>(".rpa-holdbar") ?? null, sheet.current)) setChipFor(out.turn.id);
        // after his tap: the focus on the new answer (his words, its heading)
        if (!reply) return;
        const heading = document.querySelector<HTMLElement>('[data-testid="ask-fab-answer"] h1');
        if (!heading) return;
        heading.tabIndex = -1;
        heading.focus({ preventScroll: true });
      });
    },
    [copy, locale, setMode],
  );

  async function startSpeaking() {
    if (!voice) {
      setNote(w.noVoice);
      setMode("typing");
      return;
    }
    setTurn(null);
    setHeard(null);
    setNote(null);
    setCancelling(false);
    setMode("listening");
    // the microphone kept for this browser (the one a recording or his pick found), else the default; a silent one is
    // replaced by one with sound while he speaks (components/visit/mic-devices.ts)
    const ok = await startRecording(recorder);
    if (press.current) press.current.started = ok;
    if (ok) void settleMic(recorder, 350).catch(() => null);
    if (!ok) {
      setNote(w.micOff);
      setMode("typing");
      return;
    }
    // he let go while the browser was still asking for the microphone: nothing to send
    if (!press.current) await finishSpeaking(true);
  }

  async function finishSpeaking(cancel: boolean) {
    if (recorder.state !== "recording" && recorder.state !== "paused") {
      if (cancel) setMode("closed");
      return;
    }
    // the microphone that heard him is the one for next time
    if (recorder.hearing().peak > 0.02) rememberMic(recorder.inputId());
    const blob = await recorder.stop();
    if (cancel || !blob) {
      setMode("closed");
      return;
    }
    setMode("making");
    const bytes = new Uint8Array(await blob.arrayBuffer());
    const info = parseWav(bytes);
    // a question is at most 30 s at the route: a longer one is cut to its first 30 s
    const body = info && info.durationMs > 30_000 ? sliceWav(bytes, 0, 30_000) : bytes;
    try {
      const res = await fetch("/api/ask/transcribe", { method: "POST", headers: { "Content-Type": "audio/wav" }, credentials: "same-origin", body: body as BodyInit });
      const data = (await res.json().catch(() => ({}))) as { text?: string; error?: string };
      if (res.status === 422 || (res.ok && !data.text)) {
        setNote(copy.voiceNothing);
        setMode("typing");
        return;
      }
      if (!res.ok || !data.text) {
        setNote(res.status === 429 ? limitWords(locale, data as { limit?: unknown; retryAt?: unknown }) : copy.voiceFailed);
        setMode("typing");
        return;
      }
      await ask(data.text);
    } catch {
      setNote(copy.voiceFailed);
      setMode("typing");
    }
  }

  function onDown(e: ReactPointerEvent<HTMLButtonElement>) {
    if (e.button !== 0) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    const p = { timer: null as number | null, held: false, startY: e.clientY, started: false };
    p.timer = window.setTimeout(() => {
      p.held = true;
      void startSpeaking();
    }, HOLD_MS);
    press.current = p;
  }

  function onMove(e: ReactPointerEvent<HTMLButtonElement>) {
    const p = press.current;
    if (!p?.held) return;
    setCancelling(p.startY - e.clientY > CANCEL_PX);
  }

  function onUp(e: ReactPointerEvent<HTMLButtonElement>, from: "fab" | "bar" = "fab") {
    const p = press.current;
    press.current = null;
    if (!p) return;
    if (p.timer !== null) window.clearTimeout(p.timer);
    if (!p.held) {
      // a tap: the round button opens the typing sheet; the sheet's own bar only puts the cursor in the field
      if (from === "fab") {
        setNote(null);
        setMode("typing");
      }
      window.setTimeout(() => field.current?.focus(), 60);
      return;
    }
    const cancel = p.startY - e.clientY > CANCEL_PX || e.type === "pointercancel";
    if (p.started) void finishSpeaking(cancel);
    // (not started yet: startSpeaking sees press.current gone and lets the microphone go)
  }

  function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    const text = String(new FormData(form).get("q") ?? "");
    form.reset();
    void ask(text);
  }

  if (hidden || bottom === null) return null;
  const shown: Mode = mode === "listening" || sheetPath === pathname ? mode : "closed";
  const open = shown !== "closed";
  return (
    <>
      <button
        type="button"
        className="rpa-fab"
        data-testid="ask-fab"
        data-mode={shown}
        aria-label={w.buttonHint}
        style={{ bottom: `${bottom + 14}px` }}
        onPointerDown={onDown}
        onPointerMove={onMove}
        onPointerUp={(e) => onUp(e)}
        onPointerCancel={(e) => onUp(e)}
        onContextMenu={(e) => e.preventDefault()}
      >
        <Icon name="mic" size={28} />
        <span className="rpa-fab-word">{w.button}</span>
      </button>
      {open ? (
        <div className="rpa-sheet-wrap" data-testid="ask-sheet" data-mode={shown}>
          <div className="rpa-scrim" onClick={() => (shown === "listening" ? undefined : setMode("closed"))} aria-hidden="true" />
          <section ref={sheet} className="rpa-sheet" role="dialog" aria-modal="true" aria-label={w.button}>
            {shown === "listening" ? (
              <div className="rpa-listen" data-testid="ask-listening" data-cancel={cancelling ? "true" : "false"}>
                <p className="rpa-listen-t">{cancelling ? w.cancelNow : w.listening}</p>
                <span className="rpa-bars" aria-hidden="true">
                  {Array.from({ length: 5 }, (_, i) => (
                    <span key={i} className="rpa-bar" data-on={i < lit ? "true" : undefined} />
                  ))}
                </span>
                <p className="rpa-listen-s">{cancelling ? "" : `${w.letGo} · ${w.cancelHint}`}</p>
                {/* which microphone is listening (10-15); a silent one is replaced by itself (mic-devices settleMic) */}
                {micLabel ? <p className="rpa-listen-s" data-testid="ask-mic-name">{`${w.mic}${micLabel}`}</p> : null}
              </div>
            ) : (
              <>
                <div className="rpa-sheet-head">
                  <span className="rpa-sheet-t">{w.button}</span>
                  <button type="button" className="rpa-close" onClick={() => setMode("closed")} data-testid="ask-sheet-close">
                    {w.close}
                  </button>
                </div>
                <div className="rpa-sheet-body">
                  {shown === "making" ? <p className="rpa-wait" data-testid="ask-making">{copy.voiceSending}</p> : null}
                  {shown === "asking" && heard && hasProgress(progress) ? (
                    // SSE: what has come of the answer so far, by the answer's own card (its draft), the stage line under it
                    <div data-testid="ask-fab-draft">
                      <AnswerCard question={heard} answer={draftAnswer(progress, locale)} locale={locale} draft={{ line: stageWords(locale, progress), writing: progress.writing, testId: "ask-thinking" }} />
                    </div>
                  ) : shown === "asking" ? (
                    <>
                      {heard ? <p className="rpa-heard" data-testid="ask-heard-line">{heard}</p> : null}
                      <p className="rpa-wait" data-testid="ask-thinking">{progress ? stageWords(locale, progress) : w.thinking}</p>
                    </>
                  ) : null}
                  {shown === "answer" && turn?.answer ? (
                    <div data-testid="ask-fab-answer">
                      <AnswerCard
                        key={turn.id}
                        question={turn.text}
                        answer={turn.answer}
                        locale={locale}
                        latest
                        askedAt={turn.at}
                        settled={settled}
                        // harness (10-16): the answer's follow-up question, his to answer here (or his tap on its way)
                        followUp={replying ? { chosen: replying.optionIds, pending: true } : { onReply: (a) => ask(a.text, a.reply) }}
                      />
                    </div>
                  ) : null}
                  {/* harness (10-16): the question could not show with the 995 line: the chip over the foot of the sheet */}
                  {shown === "answer" && turn && chipFor === turn.id && !replying ? (
                    <FollowUpChip locale={turn.answer?.locale ?? locale} question={openQuestion} root={sheetRoot} bottom={voice ? "86px" : "12px"} onSeen={hideChip} />
                  ) : null}
                  {note ? <p className="rpa-note" data-testid="ask-fab-note">{note}</p> : null}
                  {shown === "typing" || shown === "answer" ? (
                    <form className="rpa-form" onSubmit={submit}>
                      <textarea ref={field} name="q" className="rpa-field" rows={2} maxLength={500} placeholder={w.field} aria-label={w.field} data-testid="ask-fab-input" />
                      <button type="submit" className="rpa-send" data-testid="ask-fab-send">
                        {w.send}
                      </button>
                    </form>
                  ) : null}
                </div>
              </>
            )}
            {/* 「按住 说话」 at the foot of the sheet in every mode (10-15: after an answer the sheet covers the round
                button); it stays mounted while the sheet turns to 正在听, so the finger holding it is never lost */}
            {voice ? (
              <button
                type="button"
                className="rpa-holdbar"
                data-testid="ask-sheet-hold"
                data-holding={shown === "listening" ? "true" : "false"}
                onPointerDown={onDown}
                onPointerMove={onMove}
                onPointerUp={(e) => onUp(e, "bar")}
                onPointerCancel={(e) => onUp(e, "bar")}
                onContextMenu={(e) => e.preventDefault()}
              >
                <Icon name="mic" size={24} />
                <span>{shown === "listening" ? (cancelling ? w.cancelNow : w.letGoToAsk) : w.holdToSpeak}</span>
              </button>
            ) : null}
          </section>
        </div>
      ) : null}
    </>
  );
}
