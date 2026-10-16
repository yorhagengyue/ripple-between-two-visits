"use client";

import type { MouseEventHandler, ReactNode } from "react";
import { fill, familyCopy } from "@/lib/ui/copy";
import { cx, type FamilyBaseProps } from "@/lib/ui/props";
import type { UiLocale } from "@/lib/ui/tokens";
import { Chip, LinkRow, MicMark, PlayButton, Said, StepList } from "./FamilyBits";
import { FamilyButton } from "./FamilyButton";
import { FamilyDock } from "./FamilyScreen";
import { Quote } from "./Quote";
import { Waveform } from "./Waveform";
import { DayMark } from "./WeekStrip";

export type RecorderState = "mic-ask" | "mic-denied" | "idle" | "recording" | "recorded" | "playing" | "saving" | "saved" | "deleted" | "error";

/**
 * Recording the reminder Dad hears after breakfast (the v3 draft's E1 to E4, E6, I5). The page owns the microphone,
 * the upload and the top bar; this is the screen for every state:
 *   idle / deleted         E1  「录一句话，每天 8:45 放给爸爸听。」, what plays now (a play key when it has sound, its
 *                              words, 「代录音」), the row to her earlier recordings, the teal record key
 *   recording              E2  「在录了，慢慢说。」, the running time (44px), the live shape, 「录完了」 and 「不录了」
 *   recorded / playing     E3  「刚录好的，先听一遍再决定。」, the length and the shape, 「听一遍」 / 「重录」, the one solid
 *                              button 「就用这段」
 *   saving / error             and 「删掉这段」 in plain words; a failed save says so and keeps the take
 *   saved                  E4  「已经换成这段」 with the tick, 「明天 8:45 开始放这段。」, the take to play back, and what
 *                              his card will show (kept from before the draft: her words, or only her name, and why)
 *   mic-ask                E6  「录音要用麦克风。」 and what the phone will ask, 「打开麦克风」, 「先不录」
 *   mic-denied             I5  「麦克风被关掉了。」 and where to turn it on, the steps on an iPhone, 「再试一次」
 * The sentences are the ones written before the draft (a sentence that became a title and a line is split at its full
 * stop); the draft's own words are only on what it added (E2's two lines, 「不录了」, 「先不录」).
 */
export function ReminderRecorder({
  state,
  locale,
  playsAt,
  elapsed = "0:00",
  levels = [],
  current,
  saved,
  errorText,
  onRequestMic,
  onStart,
  onStop,
  onCancel,
  onListen,
  onPause,
  onAgain,
  onDelete,
  onUse,
  onPlayCurrent,
  currentPlaying = false,
  mineHref,
  homeHref,
  micSteps,
  micDeniedDetail,
  playback,
  after,
  clipName,
  dad,
  className,
  style,
}: FamilyBaseProps & {
  state: RecorderState;
  locale: UiLocale;
  /** her word for him: 「每天 8:45 放给妈妈听」, 「叫她平时的称呼」; null: 爸爸 / 他 */
  dad?: string | null;
  /** when his phone plays it: "8:45" */
  playsAt: string;
  /** the recording's length (or the running time while recording): "0:04" */
  elapsed?: string;
  /** listen-back position 0..1 (kept for callers; the draft draws no progress line) */
  progress?: number;
  /** the take's shape, 0..1 per bar */
  levels?: readonly number[];
  /** the reminder Dad hears now: its words (null: only whose recording it is) and whose voice */
  current?: { words: ReactNode | null; ownVoice: boolean; standIn?: boolean; label?: ReactNode };
  /** after 「就用这段」: what his card shows (her words, or her name only, and why) */
  saved?: { words: ReactNode | null; why?: ReactNode };
  errorText?: ReactNode;
  onRequestMic?: MouseEventHandler<HTMLButtonElement>;
  onStart?: MouseEventHandler<HTMLButtonElement>;
  onStop?: MouseEventHandler<HTMLButtonElement>;
  /** 「不录了」: the take is dropped, back to the start */
  onCancel?: MouseEventHandler<HTMLButtonElement>;
  onListen?: MouseEventHandler<HTMLButtonElement>;
  onPause?: MouseEventHandler<HTMLButtonElement>;
  onAgain?: MouseEventHandler<HTMLButtonElement>;
  onDelete?: MouseEventHandler<HTMLButtonElement>;
  onUse?: MouseEventHandler<HTMLButtonElement>;
  /** the play key beside what plays now; left out when that clip has no sound she can fetch */
  onPlayCurrent?: MouseEventHandler<HTMLButtonElement>;
  currentPlaying?: boolean;
  /** 「我录过的」: her earlier recordings, on their own screen */
  mineHref?: string;
  /** 「先不录」 and 「回到爸爸今天」 */
  homeHref?: string;
  /** the microphone was refused: how to turn it on (an iPhone's three steps); none where the steps are not known */
  micSteps?: readonly ReactNode[];
  micDeniedDetail?: ReactNode;
  /** the saved take, to play back: only when its shape and length are known (it was recorded just now) */
  playback?: { levels: readonly number[]; length: string; playing: boolean; onToggle: MouseEventHandler<HTMLButtonElement> };
  /** what follows the saved state (the way home, another take) */
  after?: ReactNode;
  /** what his card says for a clip without words: 「Wei Ling 的录音」, by the name he gave her link */
  clipName?: string;
}) {
  const copy = familyCopy(locale, dad);
  const zh = locale === "zh-Hans";
  const hasTake = state === "recorded" || state === "playing" || state === "saving" || state === "error";
  const herClip = clipName ?? (zh ? "女儿的录音" : "Your recording");
  const quoted = (words: ReactNode) => <>「{words}」</>;
  const time = playsAt;

  return (
    <section className={cx("rpf rpf-col", className)} data-rp="recorder" data-state={state} data-testid="recorder" style={style}>
      {state === "saved" && (
        <>
          <div className="rpf-empty" style={{ gap: 18 }}>
            <p className="rpf-empty-mark" data-kind="done" style={{ margin: 0 }}>
              <DayMark mark="taken" size={32} />
              <span>{copy.recSavedMark}</span>
            </p>
            <h1 className="rpf-h1" data-testid="rec-saved">
              {fill(copy.recSavedTitle, { time })}
            </h1>
            {playback && (
              <div className="rpf-playback" data-testid="rec-playback">
                <PlayButton playing={playback.playing} label={playback.playing ? copy.recPause : copy.recListen} onClick={playback.onToggle} data-testid="rec-playback-play" />
                <Waveform levels={playback.levels} size="small" />
                <span>{playback.length}</span>
              </div>
            )}
            {saved && <Quote who={copy.recCardShows} words={saved.words ? quoted(saved.words) : herClip} source={saved.why} data-testid="rec-card-preview" style={{ marginTop: 0 }} />}
          </div>
          {after}
        </>
      )}

      {state === "mic-ask" && (
        <>
          <div className="rpf-empty" style={{ gap: 20 }} data-testid="rec-mic">
            <MicMark />
            <h1 className="rpf-h1" data-testid="family-headline">
              {copy.recMicTitle}
            </h1>
            <p className="rpf-sub" style={{ marginTop: -8 }}>
              {fill(copy.recMicBody, { time })}
            </p>
          </div>
          <FamilyDock foot="b">
            <FamilyButton onClick={onRequestMic} data-testid="rec-mic-allow">
              {copy.recMicAskButton}
            </FamilyButton>
            {homeHref && (
              <FamilyButton href={homeHref} nav="back" variant="quiet" data-testid="rec-mic-later">
                {copy.recMicLater}
              </FamilyButton>
            )}
          </FamilyDock>
        </>
      )}

      {state === "mic-denied" && (
        <>
          <div data-testid="rec-mic">
            <MicMark off />
            <h1 className="rpf-h1" data-testid="family-headline">
              {copy.recMicDeniedTitle}
            </h1>
            <p className="rpf-sub">{micDeniedDetail ?? copy.recMicDenied}</p>
            {micSteps && micSteps.length > 0 && <StepList steps={micSteps} style={{ marginTop: 24 }} />}
          </div>
          <FamilyDock foot="b">
            <FamilyButton onClick={onRequestMic} data-testid="rec-mic-retry">
              {copy.retry}
            </FamilyButton>
            {homeHref && (
              <FamilyButton href={homeHref} nav="back" variant="quiet" data-testid="rec-mic-home">
                {copy.backHome}
              </FamilyButton>
            )}
          </FamilyDock>
        </>
      )}

      {(state === "idle" || state === "deleted") && (
        <>
          <h1 className="rpf-h1" data-testid="family-headline">
            {fill(copy.recTitle, { time })}
          </h1>
          <p className="rpf-tips">{zh ? `${copy.recTips[0]}${copy.recTips[1]}` : `${copy.recTips[0]} ${copy.recTips[1]}`}</p>
          {current && (
            <>
              <p className="rpf-section" style={{ marginTop: 32, marginBottom: 0 }}>
                {current.label ?? copy.recCurrent}
              </p>
              <div className="rpf-nowrow" data-testid="rec-current">
                {onPlayCurrent && <PlayButton playing={currentPlaying} label={currentPlaying ? copy.recPause : copy.recListen} onClick={onPlayCurrent} data-testid="rec-current-play" />}
                <div>
                  <Said>{current.words ? quoted(current.words) : herClip}</Said>
                </div>
                {(current.standIn || current.ownVoice) && <Chip>{current.standIn ? copy.recStandInNow : copy.recOwnVoice}</Chip>}
              </div>
            </>
          )}
          {mineHref && (
            <LinkRow href={mineHref} data-testid="rec-mine-open" style={current ? undefined : { marginTop: 32 }}>
              {copy.recMine}
            </LinkRow>
          )}
          {state === "deleted" && (
            <p className="rpf-rec-status rpf-rise" role="status" style={{ marginTop: 16 }} data-testid="rec-deleted">
              {copy.recDeleted}
            </p>
          )}
          <button type="button" className="rpf-recbtn" onClick={onStart} data-testid="rec-start">
            <span className="rpf-recbtn-ring" aria-hidden="true">
              <i />
            </span>
            <span>{copy.recStart}</span>
          </button>
        </>
      )}

      {state === "recording" && (
        <>
          <h1 className="rpf-h1" data-testid="family-headline">
            {copy.recLiveTitle}
          </h1>
          <p className="rpf-tips">{copy.recLiveBody}</p>
          <div className="rpf-take" data-live="true">
            <p className="rpf-rec-time" data-testid="rec-time">
              {elapsed}
            </p>
            <Waveform levels={levels} live />
          </div>
          <FamilyDock foot="b">
            <FamilyButton glyph="stop" onClick={onStop} data-testid="rec-stop">
              {copy.recStop}
            </FamilyButton>
            <FamilyButton variant="quiet" onClick={onCancel} data-testid="rec-cancel">
              {copy.recCancel}
            </FamilyButton>
          </FamilyDock>
        </>
      )}

      {hasTake && (
        <>
          {/* the one sentence that was here before the draft, as the screen's large sentence */}
          <h1 className="rpf-h1" data-testid="family-headline">
            {copy.recDone}
          </h1>
          {state === "error" && (
            <p className="rpf-rec-status" data-tone="warn" role="alert" style={{ marginTop: 12 }} data-testid="rec-error">
              {errorText ?? copy.recError}
            </p>
          )}
          <div className="rpf-take">
            <p className="rpf-rec-time" data-testid="rec-time">
              {elapsed}
            </p>
            <Waveform levels={levels} />
            <div className="rpf-btns" data-pair="true" style={{ marginTop: 10 }}>
              <FamilyButton variant="secondary" glyph={state === "playing" ? undefined : "play"} onClick={state === "playing" ? onPause : onListen} disabled={state === "saving"} data-testid="rec-listen">
                {state === "playing" ? copy.recPause : copy.recListen}
              </FamilyButton>
              <FamilyButton variant="secondary" onClick={onAgain} disabled={state === "saving"} data-testid="rec-again">
                {copy.recAgain}
              </FamilyButton>
            </div>
          </div>
          <FamilyDock foot="b">
            <FamilyButton variant="primary" onClick={onUse} pending={state === "saving"} data-testid="rec-use">
              {state === "saving" ? copy.recSaving : copy.recUse}
            </FamilyButton>
            <FamilyButton variant="quiet" onClick={onDelete} disabled={state === "saving"} data-testid="rec-delete">
              {copy.recDelete}
            </FamilyButton>
          </FamilyDock>
        </>
      )}
    </section>
  );
}
