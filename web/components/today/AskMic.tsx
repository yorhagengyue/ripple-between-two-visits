"use client";

/**
 * The microphone of 问一句 (C2 track S; real-app 2.10 「没有 Whisper 时，不显示麦克风按钮」): he says his question, reads the
 * words Ripple heard, and only then asks. components/today/AskSection.tsx uses it on the ask screen, and only when the
 * server says a transcription service is connected (lib/safety/voice.ts askVoiceAvailable). Without one nothing of it
 * is rendered at all.
 *
 *   idle         one worded button with the microphone icon: 「按一下开始说，说完再按一下」
 *   starting     the browser asks for the microphone (通用-4a): on the ask screen the round mark has the screen already,
 *                without its halo, under 「按一下说」, and the browser's own question stands over it
 *   listening    the timeline draft's 07-1a: the round mark with its halo, 「正在听，说完再按一下」; under it 「说完了」 (the
 *                same button) and 「改用打字」, which lets the microphone go and sends nothing. It stops by itself at 30 s
 *   sending      the recording goes to POST /api/ask/transcribe: 「正在转成文字……」
 *   heard        07-1b: his words as his own entry of a line under 「听到你说」, then 「重新说」 and 「问这句」. Nothing is
 *                asked before 「问这句」: it hands the words to `onAsk`, the same path as a typed question (POST /api/ask,
 *                its waiting words, its limits)
 *   nothing      nothing was heard: 「没听清。再说一次，或者打字问。」
 *   failed       the words could not be made (no connection, the service busy or away): 「现在转不成文字，先打字问。」
 *   denied       the microphone was refused (通用-4b): a box says where to switch it on. The button stays for another try
 *   unavailable  this browser has no microphone to offer (通用-4c; an old browser, a page not on https): a box says so,
 *                no button; typing is the way
 *
 * The recording is a 16 kHz mono 16-bit WAV made in the browser (components/visit/useWavRecorder.ts). It is sent once and
 * kept nowhere: not here after the answer, not on the server. The words on the screen are his own; this file words
 * nothing about his health.
 *
 * The pieces, so a screen can put them where its layout wants them (the ask screen: the stage in the page, the controls
 * in the dock at the bottom):
 *   useAskMic     the state and what a tap does
 *   MicStage      the page while the microphone has the screen: listening, turning into words, the words he said
 *   MicControls   the buttons of those three states
 *   MicButton     the worded button that starts (idle, starting, nothing, failed, denied)
 *   MicNote       the sentence after nothing was heard or the words could not be made
 *   MicBlocked    the box for a refused or missing microphone
 *   AskMic        all of it in one column (the first layout's export, kept)
 *
 * Test hooks: ask-mic-section (data-state), ask-mic (data-state, aria-pressed), ask-mic-cancel, ask-mic-note, ask-heard,
 * ask-heard-send, ask-heard-again.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { askCopy } from "@/components/daily/ask-copy";
import { Box, Bubble, Button, ButtonRow, Icon, PrimaryButton, SecondaryButton, Timeline, TimelineItem } from "@/components/ui";
import { useWavRecorder } from "@/components/visit/useWavRecorder";
import { uiCopy } from "@/lib/ui/copy";
import type { UiLocale } from "@/lib/ui/tokens";
import { parseWav, sliceWav } from "@/lib/visit/wav";

export type AskMicState = "idle" | "starting" | "listening" | "sending" | "heard" | "nothing" | "failed" | "denied" | "unavailable";

/** The longest question: the route's MAX_QUESTION_MS (lib/safety/voice.ts is server-only, so the number is repeated here). */
const MAX_LISTEN_MS = 30_000;
const TRANSCRIBE = "/api/ask/transcribe";
/** The states a tap on the microphone starts a new recording from. */
const CAN_START: readonly AskMicState[] = ["idle", "nothing", "failed", "denied"];

type Heard = { kind: "heard"; text: string } | { kind: "nothing" } | { kind: "failed" };

/** What the recorder needs from the browser. Without it there is no microphone to ask for. */
function canRecord(): boolean {
  return typeof navigator !== "undefined" && typeof navigator.mediaDevices?.getUserMedia === "function" && typeof AudioWorkletNode !== "undefined";
}

/** The recording as the route takes it: at most 30 s. A timer is never exact, so what runs past 30 s is cut off. */
async function questionWav(blob: Blob): Promise<Blob> {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  const info = parseWav(bytes);
  if (!info || info.durationMs <= MAX_LISTEN_MS) return blob;
  const cut = sliceWav(bytes, 0, MAX_LISTEN_MS);
  return cut ? new Blob([cut.buffer as ArrayBuffer], { type: "audio/wav" }) : blob;
}

/** POST /api/ask/transcribe with the device's own cookie: his words, nothing heard, or no words to be had right now. */
async function sendRecording(wav: Blob, signal: AbortSignal): Promise<Heard> {
  const res = await fetch(TRANSCRIBE, { method: "POST", headers: { "Content-Type": "audio/wav" }, credentials: "same-origin", body: wav, signal }).catch(() => null);
  if (!res) return { kind: "failed" };
  // too short to hold a question (422): the same to him as nothing heard
  if (res.status === 422) return { kind: "nothing" };
  if (!res.ok) return { kind: "failed" };
  const data = (await res.json().catch(() => null)) as { text?: unknown } | null;
  if (!data || typeof data.text !== "string") return { kind: "failed" };
  const text = data.text.trim();
  return text ? { kind: "heard", text } : { kind: "nothing" };
}

export interface AskMicApi {
  state: AskMicState;
  /** the words Ripple heard (state "heard") */
  heard: string;
  /** 「问这句」 was tapped and the question is on its way */
  asking: boolean;
  /** the microphone has the screen: listening, turning his words into text, or his words wait for 「问这句」 */
  active: boolean;
  /** start, or (while listening) stop and send */
  tap(): void;
  /** 「改用打字」 while the browser asks, he speaks or his words are being made: the microphone is let go and nothing is sent or shown */
  cancel(): void;
  askThis(): Promise<void>;
  again(): void;
}

export function useAskMic({
  onAsk,
  auto = false,
}: {
  /** 「问这句」: ask these words as a typed question is asked. Answering `false` (it did not go through) keeps the words on the screen. */
  onAsk: (text: string) => void | boolean | Promise<void | boolean>;
  /** start listening as soon as the screen is there (he came through 「按一下说」) */
  auto?: boolean;
}): AskMicApi {
  const { start, stop } = useWavRecorder();
  const [state, setState] = useState<AskMicState>("idle");
  const [heard, setHeard] = useState("");
  const [asking, setAsking] = useState(false);
  /** the state as the handlers see it: a tap and the 30 s timer can arrive in the same moment */
  const phase = useRef<AskMicState>("idle");
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const sending = useRef<AbortController | null>(null);
  const alive = useRef(true);

  const go = useCallback((next: AskMicState) => {
    phase.current = next;
    setState(next);
  }, []);
  /** the state right now, after an await (a tap may have changed it meanwhile) */
  const now = useCallback((): AskMicState => phase.current, []);

  /** He tapped 「说完了」, or 30 s passed: stop, send the recording once, show what was heard. */
  const finish = useCallback(async () => {
    if (phase.current !== "listening") return;
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    go("sending");
    const blob = await stop();
    // he left, or tapped 「改用打字」 meanwhile: nothing is sent
    if (!alive.current || now() !== "sending") return;
    if (!blob) return go("failed");
    const ctl = new AbortController();
    sending.current = ctl;
    const out = await sendRecording(await questionWav(blob), ctl.signal);
    sending.current = null;
    if (!alive.current || now() !== "sending") return;
    if (out.kind === "heard") setHeard(out.text);
    go(out.kind);
  }, [go, now, stop]);

  const begin = useCallback(async () => {
    if (!CAN_START.includes(phase.current)) return;
    if (!canRecord()) return go("unavailable");
    go("starting");
    const ok = await start();
    // he left, or tapped 「改用打字」 while the browser was still asking: the microphone is let go again
    if (!alive.current || now() !== "starting") {
      if (ok) void stop();
      return;
    }
    if (!ok) return go("denied");
    go("listening");
    timer.current = setTimeout(() => void finish(), MAX_LISTEN_MS);
  }, [finish, go, now, start, stop]);

  // the screen changes in the middle of a sentence: the microphone is let go and nothing is sent
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      if (timer.current) clearTimeout(timer.current);
      timer.current = null;
      sending.current?.abort();
      void stop();
    };
  }, [stop]);

  // he came through 「按一下说」: the screen opens listening (the browser asks for the microphone the first time)
  const autoStarted = useRef(false);
  useEffect(() => {
    if (!auto || autoStarted.current) return;
    autoStarted.current = true;
    void begin();
  }, [auto, begin]);

  const tap = useCallback(() => void (phase.current === "listening" ? finish() : begin()), [begin, finish]);

  const cancel = useCallback(() => {
    if (phase.current !== "starting" && phase.current !== "listening" && phase.current !== "sending") return;
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    sending.current?.abort();
    sending.current = null;
    go("idle");
    void stop();
  }, [go, stop]);

  const askThis = useCallback(async () => {
    if (asking || !heard) return;
    setAsking(true);
    let went: unknown = false;
    try {
      went = await onAsk(heard);
    } finally {
      if (alive.current) {
        setAsking(false);
        // a question that did not go through stays on the screen, so 「问这句」 can be tapped again
        if (went !== false) {
          setHeard("");
          go("idle");
        }
      }
    }
  }, [asking, go, heard, onAsk]);

  const again = useCallback(() => {
    setHeard("");
    go("idle");
  }, [go]);

  return { state, heard, asking, active: state === "listening" || state === "sending" || state === "heard", tap, cancel, askThis, again };
}

/**
 * The page while the microphone has the screen (the draft's 07-1a and 07-1b): the round mark and what is happening, then
 * his words as his own entry of a line. Decorative shapes only; the words say everything.
 */
export function MicStage({ mic, locale }: { mic: AskMicApi; locale: UiLocale }) {
  const ui = uiCopy(locale);
  const copy = askCopy(locale);
  if (mic.state === "heard") {
    return (
      <Timeline>
        <TimelineItem node="me" who={ui.heard}>
          <Bubble node="me" testId="ask-heard">
            {mic.heard}
          </Bubble>
        </TimelineItem>
      </Timeline>
    );
  }
  // the browser is still asking for the microphone (通用-4a: its own question stands over this), he is speaking, or
  // his words are being made
  const state = mic.state === "listening" ? "listening" : mic.state === "starting" ? "starting" : "sending";
  return (
    <div className="rpu rpu-micstage" data-rp="mic-stage" data-state={state} role="status">
      <span className="rpu-micstage-mark" aria-hidden="true">
        <i />
        <i />
        <i />
        <i />
        <i />
      </span>
      <p className="rpu-micstage-title">{state === "listening" ? ui.micListening : state === "starting" ? ui.saySpeak : copy.voiceSending}</p>
    </div>
  );
}

/** The buttons of the three states in which the microphone has the screen. */
export function MicControls({ mic, locale, disabled = false }: { mic: AskMicApi; locale: UiLocale; disabled?: boolean }) {
  const ui = uiCopy(locale);
  if (mic.state === "heard") {
    return (
      <div data-testid="ask-mic-section" data-state="heard">
        <ButtonRow cols={2}>
          <SecondaryButton data-testid="ask-heard-again" disabled={mic.asking} onClick={mic.again}>
            {ui.sayAgain}
          </SecondaryButton>
          <PrimaryButton data-testid="ask-heard-send" pending={mic.asking || disabled} onClick={() => void mic.askThis()}>
            {ui.askThis}
          </PrimaryButton>
        </ButtonRow>
      </div>
    );
  }
  const listening = mic.state === "listening";
  return (
    <div className="rpu-btns" data-testid="ask-mic-section" data-state={mic.state}>
      {/* a recording can always be stopped, also while an earlier question is still being answered */}
      <button type="button" className="rpu rpu-btn" data-variant="dark" data-testid="ask-mic" data-state={listening ? "listening" : "idle"} aria-pressed={listening} aria-busy={listening ? undefined : true} disabled={!listening} onClick={mic.tap}>
        <span>{ui.sayDone}</span>
      </button>
      <Button variant="link" data-testid="ask-mic-cancel" onClick={mic.cancel}>
        {ui.saySwitchToType}
      </Button>
    </div>
  );
}

/** The worded button that starts a recording: 「按一下开始说，说完再按一下」. Not drawn where there is no microphone. */
export function MicButton({ mic, locale, disabled = false, compact = false }: { mic: AskMicApi; locale: UiLocale; disabled?: boolean; compact?: boolean }) {
  const ui = uiCopy(locale);
  if (mic.active || mic.state === "unavailable") return null;
  const waiting = mic.state === "starting";
  return (
    <button
      type="button"
      className="rpu rpu-btn"
      data-variant="secondary"
      data-size={compact ? "compact" : undefined}
      data-testid="ask-mic"
      data-state="idle"
      aria-pressed={false}
      aria-busy={waiting ? true : undefined}
      disabled={waiting || disabled}
      onClick={mic.tap}
    >
      <Icon name="mic" stroke={2.6} />
      <span>{ui.micIdle}</span>
    </button>
  );
}

/** After a recording that gave no words: one sentence, where he will tap next. */
export function MicNote({ mic, locale }: { mic: AskMicApi; locale: UiLocale }) {
  const copy = askCopy(locale);
  if (mic.state !== "nothing" && mic.state !== "failed") return null;
  return (
    <p className="rpu-cite" role={mic.state === "failed" ? "alert" : "status"} data-testid="ask-mic-note" style={{ marginTop: 0 }}>
      {mic.state === "failed" ? copy.voiceFailed : copy.voiceNothing}
    </p>
  );
}

/** The microphone was refused, or this phone has none (the draft's 通用-4b, 通用-4c): what to do, typing always stays. */
export function MicBlocked({ mic, locale }: { mic: AskMicApi; locale: UiLocale }) {
  const ui = uiCopy(locale);
  if (mic.state !== "denied" && mic.state !== "unavailable") return null;
  const denied = mic.state === "denied";
  return (
    <div role="alert" data-testid="ask-mic-note" data-state={mic.state}>
      <Box variant="line" title={denied ? ui.micDeniedTitle : ui.micUnavailableTitle}>
        {denied ? ui.micDeniedBody : ui.micUnavailableBody}
      </Box>
    </div>
  );
}

/** The whole microphone in one column, as the first layout drew it under the typing field. */
export function AskMic({
  locale,
  disabled = false,
  onAsk,
}: {
  locale: UiLocale;
  /** a question is on its way (typed or spoken): no new recording starts and 「问这句」 waits */
  disabled?: boolean;
  /** 「问这句」: ask these words as a typed question is asked. Answering `false` (it did not go through) keeps the words on the screen. */
  onAsk: (text: string) => void | boolean | Promise<void | boolean>;
}) {
  const mic = useAskMic({ onAsk });
  return (
    <div className="rpu rpu-stack" data-state={mic.state} style={{ marginTop: 12 }}>
      <MicBlocked mic={mic} locale={locale} />
      <MicNote mic={mic} locale={locale} />
      {mic.active ? (
        <>
          <MicStage mic={mic} locale={locale} />
          <MicControls mic={mic} locale={locale} disabled={disabled} />
        </>
      ) : (
        <div data-testid="ask-mic-section" data-state={mic.state}>
          <MicButton mic={mic} locale={locale} disabled={disabled} />
        </div>
      )}
    </div>
  );
}
