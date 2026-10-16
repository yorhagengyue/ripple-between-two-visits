"use client";

/**
 * Wei Ling records her reminder for Dad on /f (task M6 item 3). The existing WAV recorder (components/visit/
 * useWavRecorder.ts: AudioWorklet, 16 kHz mono 16-bit WAV; no MediaRecorder, no WebM) makes the file; it goes up
 * through the existing signed upload (POST /api/upload-url kind "reminder" -> PUT) and is registered as a reminder
 * clip with POST /api/reminders. At the next reminder time his phone plays HER clip (the player prefers her newest
 * own recording over the seed's stand-in voice) and labels it 女儿的录音 / Wei Ling's recording.
 * Her words are hers: the optional text is what she says she said, stored with the clip as her words (女儿说).
 *
 * Saving is three requests (upload link, PUT, register), each with a timeout (8 s; 60 s for the PUT). If any of
 * them fails she is told, and her recording stays on the screen so "Save for Dad" can be tapped again without
 * recording it again.
 *
 * C2 follow-up (track E; real-app 12 「她录的提醒存完听不回、删不掉」): under the recorder, 「你录的提醒」 lists the recordings
 * she saved in this copy, newest first (GET /api/reminders: the clips with their audio links): each can be listened to
 * and deleted (DELETE /api/demo/reminders/[id]), and the one Dad's phone plays now is marked. Recording again is the
 * recorder above. After a delete his phone plays her next newest recording, or the story's stand-in voice (labelled
 * 代录音) when none is left. The list follows reminder.clip_added (a save or a delete, here or on another phone).
 */
import { useEffect, useRef, useState } from "react";
import { useWavRecorder } from "@/components/visit/useWavRecorder";
import { useLiveEvent, useLiveSession } from "@/components/live/LiveSession";
import { demoText } from "@/lib/crew/demo-copy";
import type { ReminderClipView } from "@/lib/daily/types";
import { preferredClip } from "@/lib/family/clips";
import { isUploadUrl, requestJson, UPLOAD_TIMEOUT_MS, type UploadUrl } from "@/lib/family/fetch";
import { ft } from "@/lib/family/i18n";
import { saveErrorFor, saveErrorKey, type SaveError } from "@/lib/family/recorder";
import type { Locale } from "@/lib/i18n";
import { withSession } from "@/lib/session/client";
import { formatClockTime } from "@/lib/story/clock";

type Phase = "idle" | "recording" | "recorded" | "saving" | "saved" | "error";

export function ReminderRecorder({
  locale,
  firstReminder,
  current,
}: {
  locale: Locale;
  /** "08:45": when his phone asks after breakfast */
  firstReminder: string;
  /** what plays now: her own recording, the seed's stand-in voice, or nothing */
  current: "hers" | "stand_in" | null;
}) {
  const { session } = useLiveSession();
  const recorder = useWavRecorder();
  const [phase, setPhase] = useState<Phase>("idle");
  const [blob, setBlob] = useState<Blob | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [text, setText] = useState("");
  const [seconds, setSeconds] = useState(0);
  const [saved, setSaved] = useState(false);
  const [saveError, setSaveError] = useState<SaveError>("retry");
  const audio = useRef<HTMLAudioElement | null>(null);
  /** the copy's clips as GET /api/reminders gives them (null until read; the page's `current` stands in until then) */
  const [clips, setClips] = useState<ReminderClipView[] | null>(null);
  const [reload, setReload] = useState(0);
  const [deleting, setDeleting] = useState<string | null>(null);
  const [mineNote, setMineNote] = useState<"deleted" | "failed" | null>(null);
  const players = useRef(new Map<string, HTMLAudioElement>());

  // her recordings, read again after a save or a delete (from this phone or another one in the copy)
  useEffect(() => {
    let live = true;
    void requestJson<{ clips: ReminderClipView[] }>(withSession("/api/reminders", session.id), { check: (x): x is { clips: ReminderClipView[] } => !!x && typeof x === "object" && Array.isArray((x as { clips?: unknown }).clips) }).then((r) => {
      if (live && r.ok) setClips(r.data.clips);
    });
    return () => {
      live = false;
    };
  }, [session.id, reload]);
  useLiveEvent(() => setReload((n) => n + 1), ["reminder.clip_added", "session.reset"]);

  useEffect(() => {
    if (phase !== "recording") return;
    const started = Date.now();
    const timer = setInterval(() => setSeconds(Math.floor((Date.now() - started) / 1000)), 250);
    return () => clearInterval(timer);
  }, [phase]);

  // the preview link lives as long as its recording
  const previewUrl = useRef<string | null>(null);
  function setPreviewFor(b: Blob | null) {
    if (previewUrl.current) URL.revokeObjectURL(previewUrl.current);
    previewUrl.current = b ? URL.createObjectURL(b) : null;
    setPreview(previewUrl.current);
  }
  useEffect(
    () => () => {
      if (previewUrl.current) URL.revokeObjectURL(previewUrl.current);
    },
    [],
  );

  async function start() {
    setSeconds(0);
    setBlob(null);
    setPreviewFor(null);
    if (await recorder.start()) setPhase("recording");
    else setPhase("idle");
  }

  async function stop() {
    const b = await recorder.stop();
    setBlob(b);
    setPreviewFor(b);
    setPhase(b ? "recorded" : "idle");
  }

  async function save() {
    if (!blob) return;
    setPhase("saving");
    const fail = (step: string, problem: string, status?: number, code?: string) => {
      console.warn("[family/reminder] saving failed", step, problem, status ?? "", code ?? "");
      setSaveError(step === "register" ? saveErrorFor(status, code) : "retry");
      setPhase("error");
    };
    const link = await requestJson<UploadUrl>(withSession("/api/upload-url", session.id), {
      method: "POST",
      json: { kind: "reminder", content_type: "audio/wav" },
      check: isUploadUrl,
    });
    if (!link.ok) return fail("upload-url", link.problem, link.status);
    const up = link.data;
    const put = await requestJson(up.url, { method: up.method === "POST" ? "POST" : "PUT", headers: up.headers, body: blob, timeoutMs: UPLOAD_TIMEOUT_MS, expect: "any" });
    if (!put.ok) return fail("upload", put.problem, put.status);
    const words = text.trim();
    const reg = await requestJson(withSession("/api/reminders", session.id), { method: "POST", json: words ? { audio_path: up.path, text: words } : { audio_path: up.path } });
    if (!reg.ok) return fail("register", reg.problem, reg.status, reg.code);
    setSaved(true);
    setPhase("saved");
    setMineNote(null);
    setReload((n) => n + 1);
  }

  /** Listen to one of her saved recordings (one at a time). */
  function listen(id: string) {
    for (const [other, el] of players.current) if (other !== id) el.pause();
    const el = players.current.get(id);
    if (!el) return;
    el.currentTime = 0;
    void el.play().catch(() => undefined);
  }

  /** 「删掉这段」: the recording goes; Dad's phone plays her next newest one, or the stand-in voice. */
  async function remove(id: string) {
    if (deleting) return;
    setDeleting(id);
    setMineNote(null);
    players.current.get(id)?.pause();
    const res = await requestJson(withSession(`/api/demo/reminders/${encodeURIComponent(id)}`, session.id), { method: "DELETE" });
    setDeleting(null);
    if (!res.ok) {
      console.warn("[family/reminder] deleting failed", res.problem, res.status ?? "", res.code ?? "");
      setMineNote("failed");
      return;
    }
    setClips((list) => (list ? list.filter((c) => c.id !== id) : list));
    setSaved(false);
    if (phase === "saved") setPhase("idle");
    setMineNote("deleted");
    setReload((n) => n + 1);
  }

  // what his phone plays now: from the clips once they are read (so a delete shows at once), else what the page said
  const playing = clips ? preferredClip(clips) : null;
  const now: "hers" | "stand_in" | null = clips ? (playing?.audio_url ? (playing.stand_in ? "stand_in" : "hers") : null) : saved ? "hers" : current;
  const which = now === "hers" ? ft(locale, "rec.yours") : now === "stand_in" ? ft(locale, "rec.standIn") : null;
  // hers: the recordings saved in this copy (a file of their own), newest first; the story's stand-in is not one
  const mine = (clips ?? []).filter((c) => c.audio_url && !c.stand_in).reverse();

  return (
    <section className="rp-card" data-testid="reminder-recorder" data-phase={phase}>
      <p className="font-bold">{ft(locale, "rec.title")}</p>
      <p className="mt-1 text-body text-ink-2">{ft(locale, "rec.explain", { time: formatClockTime(firstReminder, locale) })}</p>
      {which ? (
        <p className="mt-1 text-body" data-testid="reminder-recorder-current" data-current={now === "hers" ? "hers" : "stand_in"}>
          {ft(locale, "rec.current", { which })}
        </p>
      ) : null}

      {recorder.state === "unavailable" ? <p className="mt-2 text-body">{ft(locale, "rec.unavailable")}</p> : null}

      {phase === "recording" ? (
        <div className="mt-3 flex items-center gap-3">
          <p className="text-body font-semibold" data-testid="reminder-recording">
            {ft(locale, "rec.recording", { s: seconds })}
          </p>
          <button type="button" className="rp-btn rp-btn-ghost min-h-12 px-5" onClick={() => void stop()} data-testid="reminder-rec-stop">
            {ft(locale, "rec.stop")}
          </button>
        </div>
      ) : null}

      {phase === "idle" || phase === "saved" || (phase === "error" && !blob) ? (
        <button
          type="button"
          className="rp-btn rp-btn-ghost mt-3 min-h-12 w-full"
          disabled={recorder.state === "starting"}
          onClick={() => void start()}
          data-testid="reminder-rec-start"
        >
          {recorder.state === "starting" ? ft(locale, "rec.starting") : phase === "idle" ? ft(locale, "rec.start") : ft(locale, "rec.again")}
        </button>
      ) : null}

      {(phase === "recorded" || phase === "saving" || phase === "error") && blob ? (
        <div className="mt-3 flex flex-col gap-3">
          <div className="flex gap-2">
            <button type="button" className="rp-btn rp-btn-ghost min-h-12 flex-1" onClick={() => void audio.current?.play()} data-testid="reminder-rec-preview">
              ▶ {ft(locale, "rec.preview")}
            </button>
            <button type="button" className="rp-btn rp-btn-ghost min-h-12 flex-1" disabled={phase === "saving"} onClick={() => void start()} data-testid="reminder-rec-again">
              {ft(locale, "rec.again")}
            </button>
          </div>
          {preview ? <audio ref={audio} src={preview} preload="auto" /> : null}
          <label className="flex flex-col gap-1 text-body">
            <span>{ft(locale, "rec.text")}</span>
            <input
              className="rounded-xl border border-hair-2 bg-surface px-3 py-2 text-body"
              value={text}
              maxLength={200}
              onChange={(e) => setText(e.target.value)}
              data-testid="reminder-rec-text"
            />
          </label>
          <button type="button" className="rp-btn rp-btn-ghost min-h-12 w-full font-bold" disabled={phase === "saving"} onClick={() => void save()} data-testid="reminder-rec-save">
            {phase === "saving" ? ft(locale, "rec.saving") : ft(locale, "rec.save")}
          </button>
        </div>
      ) : null}

      {phase === "saved" ? (
        <p className="mt-3 text-body font-semibold" role="status" data-testid="reminder-rec-saved">
          {ft(locale, "rec.saved")}
        </p>
      ) : null}
      {phase === "error" ? (
        <p className="mt-3 text-body" role="status" data-testid="reminder-rec-error" data-error={saveError}>
          {ft(locale, saveErrorKey(saveError))}
        </p>
      ) : null}

      {mine.length > 0 || mineNote ? (
        <div className="mt-4 border-t border-hair pt-3" data-testid="reminder-mine" data-count={mine.length}>
          {mine.length > 0 ? <p className="font-bold">{demoText(locale, "rec.mine")}</p> : null}
          <ul className="mt-1 flex flex-col gap-3">
            {mine.map((c) => (
              <li key={c.id} data-testid="reminder-mine-clip" data-clip={c.id} data-current={playing?.id === c.id ? "true" : "false"}>
                {playing?.id === c.id ? (
                  <p className="rp-src" data-testid="reminder-mine-current">
                    {demoText(locale, "rec.mine.playing")}
                  </p>
                ) : null}
                {c.text ? (
                  <p className="text-body" lang={c.lang ?? undefined}>
                    <span className="text-ink-2">{demoText(locale, "rec.mine.saidAs")}</span>「{c.text}」
                  </p>
                ) : null}
                <audio
                  ref={(el) => {
                    if (el) players.current.set(c.id, el);
                    else players.current.delete(c.id);
                  }}
                  src={c.audio_url ?? undefined}
                  preload="none"
                  data-testid="reminder-mine-audio"
                />
                <div className="mt-1 flex gap-2">
                  <button type="button" className="rp-btn rp-btn-ghost min-h-12 flex-1" onClick={() => listen(c.id)} data-testid="reminder-mine-listen">
                    ▶ {demoText(locale, "rec.mine.listen")}
                  </button>
                  <button type="button" className="rp-btn rp-btn-ghost min-h-12 flex-1" disabled={deleting !== null} onClick={() => void remove(c.id)} data-testid="reminder-mine-delete">
                    {deleting === c.id ? demoText(locale, "rec.mine.deleting") : demoText(locale, "rec.mine.delete")}
                  </button>
                </div>
              </li>
            ))}
          </ul>
          {mineNote ? (
            <p className="mt-2 text-body" role="status" data-testid="reminder-mine-note" data-note={mineNote}>
              {demoText(locale, mineNote === "deleted" ? "rec.mine.deleted" : "rec.mine.failed")}
            </p>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}
