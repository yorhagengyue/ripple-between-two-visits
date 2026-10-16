"use client";

/**
 * The card after a reading outside the target his doctor set (owner 10-15, the demo video's second scene: 「量完显示今天超过
 * 了异常值；老人按住按钮用语音说『今天打太极，所以没怎么吃午饭』；系统记下来，放进日历，下次就诊的准备里自动多一个问题」).
 * It stands under 「记下了：152/96」 on the screen after a reading (components/daily/elder/BpAccount.tsx), never for a reading
 * above the doctor's warning line (that screen is track S's relay, unchanged), and is calm: the paper, one hairline, the
 * doctor's colour on the small mark the calendars use for the same thing.
 *
 *   the words   「152/96 超出了林医生定的目标」 and under it 「目标是 135/85（9月3日定）。」: the doctor's own numbers, who
 *               gave them and when (lib/daily/bp-target.ts; the doctor's name from the visit's details,
 *               lib/daily/visit-details.ts, else 「医生」). His doctor's sentence itself follows the card, as before.
 *   the button  「按住，告诉 Ripple 今天发生了什么」, big, as the ask button's hold: after HOLD_MS the microphone opens (the one
 *               kept for this browser, a silent one replaced by one with sound: components/visit/mic-devices.ts), bars move
 *               with his voice, and letting go makes his words (POST /api/ask/transcribe, Tencent Cloud or Whisper as the
 *               deployment has it); sliding up off it before letting go cancels. Its words are the screen's language
 *               only (owner 10-15: both sides in English for the video); he may speak either. Without a speech service (or a
 *               microphone) he types.
 *   after       his words go to POST /api/bp/reason: kept as his note, exactly as heard (「记下了：「…」」), and one
 *               question for his next visit is on his list (the model's, checked, or the fixed one); the card says it
 *               was added, shows it, and leads to his list (就诊). 「再说一次」 takes his words again (one question per
 *               reading: it is written again from the newest words).
 *
 * The round Ask button is not drawn while this card is on the screen (data-fab="off", components/ask/AskFab.tsx): its own
 * hold button is the one to use here, and two microphone buttons on one screen would leave him guessing which (10-15).
 *
 * Test hooks: bp-outside (data-reading, data-phase), bp-tell-hold (data-holding), bp-tell-listening, bp-tell-making,
 * bp-tell-noted, bp-tell-adding, bp-tell-question (data-outcome, data-by), bp-tell-see, bp-tell-again, bp-tell-type,
 * bp-tell-field, bp-tell-save, bp-tell-error, bp-tell-no-ai.
 */
import { useEffect, useRef, useState, type FormEvent, type PointerEvent as ReactPointerEvent } from "react";
import { Icon } from "@/components/ui/icons";
import { barsFor } from "@/components/visit/elder/MicCheck";
import { micName, rememberMic, settleMic, startRecording } from "@/components/visit/mic-devices";
import { useWavRecorder } from "@/components/visit/useWavRecorder";
import { shortDay } from "@/lib/daily/i18n";
import type { Locale } from "@/lib/i18n";
import { NO_AI_SENTENCE } from "@/lib/safety/no-ai";
import { fetchSignedIn } from "@/lib/session/client";
import { parseWav, sliceWav } from "@/lib/visit/wav";
import { bpc } from "./copy";

/** How long a press is before it is a hold (the microphone opens): the ask button's. */
const HOLD_MS = 350;
/** Sliding up this far off the button before letting go cancels. */
const CANCEL_PX = 80;
/** The longest he speaks (the transcription route takes 30 s). */
const MAX_LISTEN_MS = 29_000;

type Phase = "idle" | "listening" | "making" | "adding" | "done" | "typing" | "error";

interface Added {
  text: string;
  lang: string | null;
  outcome: "created" | "merged" | "reopened" | "answered" | "updated" | "kept";
  by: "model" | "template" | null;
}

export interface OutsideTargetProps {
  locale: Locale;
  reading: { id: string; systolic: number; diastolic: number };
  /** the target his doctor set and the date of the visit it was given at (YYYY-MM-DD) */
  target: { systolic: number; diastolic: number; date: string };
  /** the doctor's name as a sentence says it (「林医生」 / "Dr Lim"), or null */
  doctor: string | null;
  /** a speech service is connected (lib/safety/voice.ts askVoiceAvailable): else he types */
  voice: boolean;
}

export function BpOutsideTarget({ locale, reading, target, doctor, voice }: OutsideTargetProps) {
  const recorder = useWavRecorder({ hold: true });
  const [phase, setPhase] = useState<Phase>(voice ? "idle" : "typing");
  const [noted, setNoted] = useState<string | null>(null);
  const [added, setAdded] = useState<Added | null>(null);
  const [ai, setAi] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [lit, setLit] = useState(0);
  const [mic, setMic] = useState("");
  const [cancelling, setCancelling] = useState(false);
  const [hint, setHint] = useState(false);
  const [draft, setDraft] = useState("");
  const press = useRef<{ timer: number | null; held: boolean; startY: number; started: boolean } | null>(null);
  const self = useRef<HTMLElement | null>(null);

  // the card comes up under 「记下了」 at the foot of the first screen: a moment later the page moves just enough for the
  // whole card, its button included, to stand above what is fixed at the foot (the tab bar, the undo strip, the ask
  // button), never past the card's own top
  useEffect(() => {
    const t = window.setTimeout(() => {
      const el = self.current;
      if (!el) return;
      let foot = window.innerHeight;
      for (const bar of document.querySelectorAll<HTMLElement>('.rpu-tabs[data-placement="fixed"], [data-rp="toast"]')) {
        const r = bar.getBoundingClientRect();
        // a bar in the lower half of the screen (the undo strip stands on the tab bar, not on the screen's edge)
        if (r.height > 0 && r.top < foot && r.top > window.innerHeight / 2) foot = r.top;
      }
      const box = el.getBoundingClientRect();
      const over = box.bottom - (foot - 12);
      if (over <= 0) return;
      const reduce = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
      window.scrollBy({ top: Math.min(over, Math.max(0, box.top - 16)), behavior: reduce ? "auto" : "smooth" });
    }, 600);
    return () => window.clearTimeout(t);
  }, []);

  const shown = `${reading.systolic}/${reading.diastolic}`;
  const who = doctor ?? bpc(locale, "yourDoctor");

  // the bars while he speaks, and the longest he may
  useEffect(() => {
    if (phase !== "listening") return;
    const t = window.setInterval(() => {
      setLit(barsFor(recorder.level()));
      setMic(micName(recorder.inputLabel()));
    }, 120);
    const stop = window.setTimeout(() => void finish(false), MAX_LISTEN_MS);
    return () => {
      window.clearInterval(t);
      window.clearTimeout(stop);
    };
    // finish reads refs and the recorder
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase]);

  /** His words (heard or typed) are kept with the reading, and the question goes on his list. */
  async function keep(text: string, source: "voice_note" | "typed") {
    const words = text.replace(/\s+/g, " ").trim();
    if (!words) {
      setError(bpc(locale, "tellNothing"));
      setPhase("error");
      return;
    }
    setNoted(words);
    setError(null);
    setPhase("adding");
    try {
      const res = await fetchSignedIn(`/api/bp/reason?locale=${locale}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({ reading: reading.id, text: words, source }),
      });
      const data = (await res.json().catch(() => ({}))) as { question?: Added; ai?: boolean };
      if (!res.ok || !data.question) throw new Error(String(res.status));
      setAdded(data.question);
      setAi(data.ai !== false);
      setPhase("done");
    } catch {
      // nothing was kept: his words wait in the field, ready to send again
      setNoted(null);
      setDraft(words);
      setError(bpc(locale, "tellFailed"));
      setPhase("typing");
    }
  }

  async function begin() {
    setError(null);
    setHint(false);
    setCancelling(false);
    setPhase("listening");
    const ok = await startRecording(recorder);
    if (press.current) press.current.started = ok;
    if (ok) void settleMic(recorder, 350).catch(() => null);
    if (!ok) {
      setError(bpc(locale, "tellMicOff"));
      setPhase("typing");
      return;
    }
    // he let go while the browser was still asking for the microphone: nothing to send
    if (!press.current) await finish(true);
  }

  async function finish(cancel: boolean) {
    if (recorder.state !== "recording" && recorder.state !== "paused") {
      if (cancel) setPhase(added ? "done" : "idle");
      return;
    }
    if (recorder.hearing().peak > 0.02) rememberMic(recorder.inputId());
    const blob = await recorder.stop();
    if (cancel || !blob) {
      setPhase(added ? "done" : "idle");
      return;
    }
    setPhase("making");
    const bytes = new Uint8Array(await blob.arrayBuffer());
    const info = parseWav(bytes);
    const body = info && info.durationMs > 30_000 ? sliceWav(bytes, 0, 30_000) : bytes;
    try {
      const res = await fetch("/api/ask/transcribe", { method: "POST", headers: { "Content-Type": "audio/wav" }, credentials: "same-origin", body: body as BodyInit });
      const data = (await res.json().catch(() => ({}))) as { text?: string };
      if (res.status === 422 || (res.ok && !data.text)) {
        setError(bpc(locale, "tellNothing"));
        setPhase("error");
        return;
      }
      if (!res.ok || !data.text) throw new Error(String(res.status));
      await keep(data.text, "voice_note");
    } catch {
      setError(bpc(locale, "tellFailed"));
      setPhase("error");
    }
  }

  function onDown(e: ReactPointerEvent<HTMLButtonElement>) {
    if (e.button !== 0) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    const p = { timer: null as number | null, held: false, startY: e.clientY, started: false };
    p.timer = window.setTimeout(() => {
      p.held = true;
      void begin();
    }, HOLD_MS);
    press.current = p;
  }

  function onMove(e: ReactPointerEvent<HTMLButtonElement>) {
    const p = press.current;
    if (p?.held) setCancelling(p.startY - e.clientY > CANCEL_PX);
  }

  function onUp(e: ReactPointerEvent<HTMLButtonElement>) {
    const p = press.current;
    press.current = null;
    if (!p) return;
    if (p.timer !== null) window.clearTimeout(p.timer);
    if (!p.held) {
      // a tap, not a hold: say how
      setHint(true);
      return;
    }
    const cancel = p.startY - e.clientY > CANCEL_PX || e.type === "pointercancel";
    if (p.started) void finish(cancel);
  }

  function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    void keep(draft, "typed");
  }

  const listening = phase === "listening";
  const canHold = voice && (phase === "idle" || phase === "listening" || phase === "error" || phase === "done");
  const outcomeWords =
    added?.outcome === "updated"
      ? bpc(locale, "tellUpdated")
      : added?.outcome === "kept"
        ? bpc(locale, "tellKept")
        : added?.outcome === "merged" || added?.outcome === "answered" || added?.outcome === "reopened"
          ? bpc(locale, "tellAlready")
          : bpc(locale, "tellAdded");

  return (
    <section ref={self} className="rpu rp03-out" data-rp="bp-outside" data-fab="off" data-testid="bp-outside" data-reading={shown} data-phase={phase} aria-live="polite">
      <div className="rp03-out-head">
        <span className="rp03-out-mark" aria-hidden="true" />
        <h2 className="rp03-out-title">{bpc(locale, "outsideTitle", { reading: shown, doctor: who })}</h2>
      </div>
      <p className="rp03-out-src" data-testid="bp-outside-source">
        {bpc(locale, "outsideSource", { target: `${target.systolic}/${target.diastolic}`, date: shortDay(locale, target.date) })}
      </p>

      {noted ? (
        <p className="rp03-out-noted" data-testid="bp-tell-noted">
          <span className="rp03-out-label">{bpc(locale, "tellNoted")}</span>{" "}
          <span className="rp03-out-words" lang={/\p{Script=Han}/u.test(noted) ? "zh-Hans" : "en"}>
            {locale === "zh-Hans" ? `「${noted}」` : `“${noted}”`}
          </span>
        </p>
      ) : null}

      {phase === "making" ? (
        <p className="rp03-out-wait" data-testid="bp-tell-making">
          {bpc(locale, "tellMaking")}
        </p>
      ) : null}
      {phase === "adding" ? (
        <p className="rp03-out-wait" data-testid="bp-tell-adding">
          {bpc(locale, "tellAdding")}
        </p>
      ) : null}

      {phase === "done" && added ? (
        <div className="rp03-out-q" data-testid="bp-tell-question" data-outcome={added.outcome} data-by={added.by ?? ""}>
          <p className="rp03-out-label">{outcomeWords}</p>
          <p className="rp03-out-qtext" lang={added.lang ?? undefined}>
            {added.text}
          </p>
          {!ai ? (
            <p className="rp03-out-note" data-testid="bp-tell-no-ai">
              {locale === "zh-Hans" ? NO_AI_SENTENCE.zh : NO_AI_SENTENCE.en}
            </p>
          ) : null}
          <a className="rp03-out-link" href="/p/visit" data-testid="bp-tell-see">
            {bpc(locale, "tellSee")}
          </a>
        </div>
      ) : null}

      {error ? (
        <p className="rp03-out-error" role="alert" data-testid="bp-tell-error">
          {error}
        </p>
      ) : null}

      {listening ? (
        <div className="rp03-out-listen" data-testid="bp-tell-listening" data-cancel={cancelling ? "true" : "false"}>
          <span className="rp03-out-bars" aria-hidden="true">
            {Array.from({ length: 5 }, (_, i) => (
              <span key={i} className="rp03-out-bar" data-on={i < lit ? "true" : undefined} />
            ))}
          </span>
          <p className="rp03-out-wait">{cancelling ? bpc(locale, "tellCancelNow") : `${bpc(locale, "tellListening")} · ${bpc(locale, "tellCancel")}`}</p>
          {mic ? <p className="rp03-out-note">{`${bpc(locale, "tellMic")}${mic}`}</p> : null}
        </div>
      ) : null}

      {canHold ? (
        <button
          type="button"
          className="rp03-out-hold"
          data-testid={phase === "done" ? "bp-tell-again" : "bp-tell-hold"}
          data-holding={listening ? "true" : "false"}
          data-quiet={phase === "done" ? "true" : undefined}
          onPointerDown={onDown}
          onPointerMove={onMove}
          onPointerUp={onUp}
          onPointerCancel={onUp}
          onContextMenu={(e) => e.preventDefault()}
        >
          <Icon name="mic" size={26} />
          <span className="rp03-out-hold-words">
            <span className="rp03-out-hold-t">{listening ? (cancelling ? bpc(locale, "tellCancelNow") : bpc(locale, "tellListeningShort")) : phase === "done" ? bpc(locale, "tellAgain") : bpc(locale, "tellHold")}</span>
          </span>
        </button>
      ) : null}
      {hint && !listening ? <p className="rp03-out-note">{bpc(locale, "tellHoldHint")}</p> : null}

      {phase === "typing" ? (
        <form className="rp03-out-form" onSubmit={submit}>
          <label className="rp03-out-label" htmlFor={`bp-tell-${reading.id}`}>
            {bpc(locale, "tellTypeLabel")}
          </label>
          <textarea
            id={`bp-tell-${reading.id}`}
            className="rp03-out-field"
            rows={2}
            maxLength={500}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            data-testid="bp-tell-field"
          />
          <button type="submit" className="rp03-out-save" data-testid="bp-tell-save" disabled={!draft.trim()}>
            {bpc(locale, "tellSave")}
          </button>
        </form>
      ) : voice && (phase === "idle" || phase === "error") ? (
        <button type="button" className="rp03-out-link" data-testid="bp-tell-type" onClick={() => setPhase("typing")}>
          {bpc(locale, "tellType")}
        </button>
      ) : null}
    </section>
  );
}
