"use client";

/**
 * Her reminder recorder on a real account (/f/reminder?link=; C2 track D; relaid to the v3 draft's E1 to E4, E6 and I5
 * by the fe-d track):
 *   record     the browser's 16 kHz WAV recorder (components/visit/useWavRecorder.ts), its live shape from the PCM blocks
 *   listen     the take, played here before anything is sent
 *   again      a new take replaces it; 「删掉这段」 drops it (nothing was sent); 「不录了」 drops a take while it runs
 *   use        upload into his space through her link (POST /api/upload-url kind "reminder", PUT), then POST
 *              /api/reminders: the server takes the words from the clip itself and keeps them off his card when they name
 *              a medicine, a number or a dose; the screen says which: 「爸爸的卡上会显示：「…」」 or only 「Wei Ling 的录音」 (the name he gave her link)
 *   mine       her earlier recordings have a screen of their own (E5: components/family/HerRecordings.tsx)
 * The microphone is asked from her tap. The first time, the screen says what it is for before the phone asks (E6);
 * refused, it says where to turn it on (I5).
 *
 * The top bar is drawn here because it follows the state: the way back to her home, 「正在录」 with no way back while a
 * take runs (E2), nothing but 中/EN once a take is saved (E4).
 */
import { useEffect, useRef, useState } from "react";
import { useWavRecorder } from "@/components/visit/useWavRecorder";
import { FamilyButton, FamilyDock, FamilyTop, ReminderRecorder, type RecorderState } from "@/components/family-ui";
import { barsOf, clipClock } from "@/lib/care/clip-shape";
import { dadWord } from "@/lib/care/copy";
import { hc } from "@/lib/care/her-copy";
import type { HerClipView, HerReminders } from "@/lib/care/reminders";
import { dt } from "@/lib/daily/i18n";
import { isUploadUrl, requestJson, UPLOAD_TIMEOUT_MS, type UploadUrl } from "@/lib/family/fetch";
import type { Locale } from "@/lib/i18n";
import { familyCopy } from "@/lib/ui/copy";
import { useIsIos } from "./HerBits";

function levelOf(block: Float32Array): number {
  let sum = 0;
  for (let i = 0; i < block.length; i++) sum += block[i] * block[i];
  return Math.min(1, Math.sqrt(sum / Math.max(1, block.length)) * 6);
}

interface Take {
  blob: Blob;
  url: string;
  seconds: number;
  /** the whole take's shape, one level per block */
  shape: number[];
}

export function ReminderStudio({
  locale,
  linkId,
  playsAt,
  initial,
  homeHref,
  mineHref,
  herLabel,
  dad,
  langHref,
}: {
  locale: Locale;
  linkId: string;
  playsAt: string;
  /** kept for callers: this screen shows no dates any more (her recordings are listed on their own screen) */
  tz?: string;
  initial: HerReminders;
  homeHref: string;
  /** 「我录过的」: her earlier recordings (E5) */
  mineHref?: string;
  /** the name he gave her link ("Wei Ling"): his card says 「Wei Ling 的录音」 for a clip without words */
  herLabel?: string | null;
  /** how she calls him, for 「爸爸今天」, 「回到爸爸今天」 and the recorder's own words (「放给妈妈听」, 「叫她平时的称呼」) */
  dad?: string;
  langHref?: string;
}) {
  const him = dadWord(dad, locale);
  // the same words his card shows (lib/daily/i18n.ts today.reminder.recording, components/daily/elder/HerReminder.tsx)
  const name = herLabel?.trim() || null;
  const clipName = name ? dt(locale, "today.reminder.recording", { name }) : dt(locale, "today.reminder.recordingDefault");
  const recorder = useWavRecorder();
  const ios = useIsIos();
  const [state, setState] = useState<RecorderState>("idle");
  const [take, setTake] = useState<Take | null>(null);
  /** the take that was just saved: still on this phone, so E4 can play it back and draw its shape */
  const [kept, setKept] = useState<Omit<Take, "blob"> | null>(null);
  const [levels, setLevels] = useState<number[]>([]);
  const [elapsed, setElapsed] = useState(0);
  const [progress, setProgress] = useState(0);
  const [reminders, setReminders] = useState(initial);
  const [saved, setSaved] = useState<{ words: string | null; why: string | null } | null>(null);
  const [errorText, setErrorText] = useState<string | null>(null);
  /** which other sound plays: what his phone plays now (E1), or the saved take (E4) */
  const [sounding, setSounding] = useState<"current" | "kept" | null>(null);
  const audio = useRef<HTMLAudioElement | null>(null);
  const other = useRef<HTMLAudioElement | null>(null);
  const started = useRef(0);
  const all = useRef<number[]>([]);
  const explained = useRef(false);
  const urls = useRef<string[]>([]);
  const q = `link=${encodeURIComponent(linkId)}`;

  useEffect(() => {
    if (state !== "recording") return;
    const timer = setInterval(() => setElapsed((Date.now() - started.current) / 1000), 200);
    return () => clearInterval(timer);
  }, [state]);

  // the takes live in this phone's memory until the screen is left
  useEffect(
    () => () => {
      for (const u of urls.current) URL.revokeObjectURL(u);
      urls.current = [];
    },
    [],
  );
  const forget = (url: string) => {
    URL.revokeObjectURL(url);
    urls.current = urls.current.filter((u) => u !== url);
  };

  async function reload() {
    const r = await requestJson<HerReminders>(`/api/reminders?${q}`);
    if (r.ok) setReminders(r.data);
  }

  function quiet() {
    other.current?.pause();
    setSounding(null);
  }

  /** `asked`: she already read what the microphone is for (E6) and tapped 「允许用麦克风」 */
  async function start(asked = false) {
    setErrorText(null);
    quiet();
    if (!asked && !explained.current) {
      // the first time: say what the microphone is for before the phone asks (E6)
      try {
        const st = await navigator.permissions?.query({ name: "microphone" as PermissionName });
        if (st?.state === "prompt") {
          explained.current = true;
          setState("mic-ask");
          return;
        }
      } catch {
        // no permissions API: the phone asks straight away
      }
    }
    explained.current = true;
    all.current = [];
    setLevels([]);
    setElapsed(0);
    recorder.setListener((block) => {
      all.current.push(levelOf(block));
      setLevels(all.current.slice(-34));
    });
    const ok = await recorder.start();
    if (!ok) {
      let denied = false;
      try {
        const st = await navigator.permissions?.query({ name: "microphone" as PermissionName });
        denied = st?.state === "denied";
      } catch {
        // no permissions API: ask again from the button
      }
      setState(denied ? "mic-denied" : "mic-ask");
      return;
    }
    started.current = Date.now();
    setState("recording");
  }

  async function stop() {
    recorder.setListener(null);
    const blob = await recorder.stop();
    if (!blob || blob.size <= 44) {
      setState("idle");
      return;
    }
    if (take) forget(take.url);
    const url = URL.createObjectURL(blob);
    urls.current.push(url);
    setTake({ blob, url, seconds: (blob.size - 44) / 32000, shape: [...all.current] });
    setState("recorded");
  }

  /** 「不录了」: the take that is running is dropped; nothing was kept or sent */
  async function cancel() {
    recorder.setListener(null);
    await recorder.stop();
    all.current = [];
    setLevels([]);
    setState("idle");
  }

  function listen() {
    const el = audio.current;
    if (!el) return;
    el.currentTime = 0;
    void el.play().then(
      () => setState("playing"),
      () => setState("recorded"),
    );
  }

  function pause() {
    audio.current?.pause();
    setState("recorded");
  }

  function dropTake() {
    audio.current?.pause();
    if (take) forget(take.url);
    setTake(null);
    setLevels([]);
    setState("deleted");
  }

  /** The play key beside what his phone plays now (E1) and beside the saved take (E4): play, or stop. */
  function toggle(which: "current" | "kept", url: string) {
    const el = other.current;
    if (!el) return;
    if (sounding === which) return quiet();
    el.src = url;
    void el.play().then(
      () => setSounding(which),
      () => setSounding(null),
    );
  }

  async function use() {
    if (!take) return;
    audio.current?.pause();
    setState("saving");
    setErrorText(null);
    const fail = (words?: string) => {
      setErrorText(words ?? null);
      setState("error");
    };
    const link = await requestJson<UploadUrl>(`/api/upload-url?${q}`, { method: "POST", json: { kind: "reminder", content_type: "audio/wav" }, check: isUploadUrl });
    if (!link.ok) return fail();
    const up = link.data;
    const put = await requestJson(up.url, { method: up.method === "POST" ? "POST" : "PUT", headers: up.headers, body: take.blob, timeoutMs: UPLOAD_TIMEOUT_MS, expect: "any" });
    if (!put.ok) return fail();
    const reg = await requestJson<{ clip: HerClipView; shown: "text" | "label_only"; why: "clinical" | "no_transcript" | null }>(`/api/reminders?${q}`, { method: "POST", json: { audio_path: up.path }, timeoutMs: 30_000 });
    if (!reg.ok) return fail(reg.code === "audio_empty" ? hc(locale, "recNoSound") : undefined);
    setSaved({
      words: reg.data.clip?.text ?? null,
      why: reg.data.why === "clinical" ? hc(locale, "recWhyClinical", { dad: him }) : reg.data.why === "no_transcript" ? hc(locale, "recWhyNoWords", { dad: him }) : null,
    });
    if (kept) forget(kept.url);
    setKept({ url: take.url, seconds: take.seconds, shape: take.shape });
    setTake(null);
    setState("saved");
    void reload();
  }

  /** 「再录一段」 (kept from before the draft): back to the start, the saved take's sound let go */
  function another() {
    quiet();
    if (kept) forget(kept.url);
    setKept(null);
    setState("idle");
  }

  const current = reminders.current;
  const copy = familyCopy(locale, him);
  const top =
    state === "recording" ? (
      <FamilyTop live={copy.recRecording} locale={locale} langHref={langHref} />
    ) : state === "saved" ? (
      <FamilyTop locale={locale} langHref={langHref} />
    ) : (
      <FamilyTop back={{ href: homeHref, label: hc(locale, "dadToday", { dad: him }) }} locale={locale} langHref={langHref} />
    );
  return (
    <div className="rpf-col" data-testid="reminder-studio" data-state={state}>
      {top}
      <ReminderRecorder
        locale={locale}
        dad={him}
        state={state}
        playsAt={playsAt.replace(/^0/, "")}
        elapsed={clipClock(state === "recording" ? elapsed : (take?.seconds ?? 0))}
        progress={progress}
        levels={state === "recording" ? levels : take ? barsOf(take.shape, 46) : []}
        clipName={clipName}
        current={current ? { words: current.text, ownVoice: current.whose === "yours", standIn: current.whose === "stand_in" } : undefined}
        onPlayCurrent={current?.audioUrl ? () => toggle("current", current.audioUrl!) : undefined}
        currentPlaying={sounding === "current"}
        saved={saved ? { words: saved.words, why: saved.why ?? undefined } : undefined}
        playback={kept ? { levels: barsOf(kept.shape, 30), length: clipClock(kept.seconds), playing: sounding === "kept", onToggle: () => toggle("kept", kept.url) } : undefined}
        errorText={errorText ?? undefined}
        mineHref={mineHref}
        homeHref={homeHref}
        micSteps={ios ? [hc(locale, "micStep1"), hc(locale, "micStep2"), hc(locale, "micStep3")] : undefined}
        onRequestMic={() => void start(true)}
        onStart={() => void start()}
        onStop={() => void stop()}
        onCancel={() => void cancel()}
        onListen={listen}
        onPause={pause}
        onAgain={() => void start(true)}
        onDelete={dropTake}
        onUse={() => void use()}
        after={
          // E4: one outlined button home; 「再录一段」 stays as plain words under it (not in the draft)
          <FamilyDock foot="h">
            <FamilyButton href={homeHref} variant="secondary" data-testid="rec-home">
              {hc(locale, "backHome")}
            </FamilyButton>
            <FamilyButton variant="quiet" onClick={another} data-testid="rec-new">
              {hc(locale, "recNew")}
            </FamilyButton>
          </FamilyDock>
        }
      />
      {take && <audio ref={audio} src={take.url} preload="auto" onTimeUpdate={(e) => setProgress(e.currentTarget.duration > 0 ? e.currentTarget.currentTime / e.currentTarget.duration : 0)} onEnded={() => setState("recorded")} data-testid="rec-take-audio" />}
      <audio ref={other} preload="none" onEnded={() => setSounding(null)} data-testid="rec-other-audio" />
    </div>
  );
}
