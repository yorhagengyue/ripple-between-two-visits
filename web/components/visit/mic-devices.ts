"use client";

/**
 * Which microphone to record from (owner 10-15: 「麦克风还是无法真正检索我使用的麦克风是哪」). The browser's default is
 * whatever the computer calls default: on his, a wireless headset that sent nothing but zeros while it was switched off,
 * with a working microphone right next to it. So:
 *   listMics      the microphones the browser knows (their names once he has allowed the microphone)
 *   watchMics     every microphone open at once, raw (no echo cancellation, noise suppression or gain), each one's level
 *                 read several times a second: the list where he speaks and sees which one moves (MicCheck's 「换一个」)
 *   probeMics     the same for a moment: each one's loudest sample
 *   settleMic     right after a recording starts: if the microphone in use sends nothing, the recording moves to the one
 *                 that has sound (the one he picked before when it still has sound, else the loudest)
 *   rememberMic   the one he picked, or the one a recording heard him on, kept in this browser for the next recording
 *                 and the 提问 button (localStorage; nothing leaves the phone)
 * Nothing here records: the levels are read and dropped.
 */
import { MIC_SILENT_PEAK, type MicInput, type WavRecorder } from "./useWavRecorder";

const KEY = "rp_mic";

/** The microphone kept for this browser, or null. */
export function rememberedMic(): string | null {
  try {
    return window.localStorage.getItem(KEY);
  } catch {
    return null;
  }
}

export function rememberMic(id: string | null | undefined): void {
  if (!id || id === "default" || id === "communications") return;
  try {
    window.localStorage.setItem(KEY, id);
  } catch {
    // private browsing: nothing kept, the next recording looks again
  }
}

/** The microphones the browser knows; the "default" and "communications" entries are copies of real ones and left out. */
export async function listMics(): Promise<MicInput[]> {
  try {
    const all = await navigator.mediaDevices.enumerateDevices();
    return all.filter((d) => d.kind === "audioinput" && d.deviceId && d.deviceId !== "default" && d.deviceId !== "communications").map((d) => ({ id: d.deviceId, label: d.label }));
  } catch {
    return [];
  }
}

export interface MicLevel extends MicInput {
  /** the loudest sample since the last read (0 to 1); 0 for one that could not be opened */
  peak: number;
  /** it could be opened */
  open: boolean;
}

/**
 * Every microphone open at once, raw, its level read every `everyMs`: `onLevels` gets the list each time (the loudest
 * sample since the last read, per microphone). Returns the function that closes them all.
 */
export async function watchMics(onLevels: (levels: MicLevel[]) => void, everyMs = 150): Promise<() => void> {
  const mics = await listMics();
  const ac = new AudioContext();
  const opened = await Promise.all(
    mics.map(async (m) => {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          audio: { deviceId: { exact: m.id }, echoCancellation: false, noiseSuppression: false, autoGainControl: false },
        });
        const an = ac.createAnalyser();
        an.fftSize = 2048;
        ac.createMediaStreamSource(stream).connect(an);
        return { m, stream, an };
      } catch {
        return { m, stream: null, an: null };
      }
    }),
  );
  await ac.resume().catch(() => undefined);
  const buf = new Float32Array(2048);
  const read = () => {
    onLevels(
      opened.map(({ m, an }) => {
        if (!an) return { ...m, peak: 0, open: false };
        an.getFloatTimeDomainData(buf);
        let peak = 0;
        for (let i = 0; i < buf.length; i++) {
          const v = buf[i] < 0 ? -buf[i] : buf[i];
          if (v > peak) peak = v;
        }
        return { ...m, peak, open: true };
      }),
    );
  };
  read();
  const timer = window.setInterval(read, everyMs);
  return () => {
    window.clearInterval(timer);
    for (const o of opened) o.stream?.getTracks().forEach((t) => t.stop());
    void ac.close().catch(() => undefined);
  };
}

/** Every microphone for `ms`: each one's loudest sample over that time. */
export async function probeMics(ms = 500): Promise<MicLevel[]> {
  const best = new Map<string, MicLevel>();
  const stop = await watchMics((levels) => {
    for (const l of levels) {
      const was = best.get(l.id);
      if (!was || l.peak > was.peak) best.set(l.id, l);
    }
  }, 50);
  await new Promise((r) => window.setTimeout(r, ms));
  stop();
  return [...best.values()];
}

/**
 * Right after a recording started (on the remembered microphone or the browser's default): when the one in use has sent
 * nothing by now, the recording moves to a microphone with sound: the remembered one when it has sound, else the loudest.
 * Returns the microphone it moved to, or null when it stayed.
 */
export async function settleMic(rec: Pick<WavRecorder, "hearing" | "inputId" | "switchInput">, ms = 500): Promise<string | null> {
  const levels = await probeMics(ms);
  // the one in use, as heard through the recording itself (its id may be the browser's "default")
  if (rec.hearing().peak >= MIC_SILENT_PEAK) return null;
  const live = levels.filter((l) => l.open && l.peak >= MIC_SILENT_PEAK && l.id !== rec.inputId());
  if (!live.length) return null;
  const kept = rememberedMic();
  const target = (kept && live.find((l) => l.id === kept)) || [...live].sort((a, b) => b.peak - a.peak)[0];
  if (!(await rec.switchInput(target.id))) return null;
  rememberMic(target.id);
  return target.id;
}

/** A recording starts on the microphone kept for this browser when there is one and it opens, else on the default. */
export async function startRecording(rec: Pick<WavRecorder, "start">): Promise<boolean> {
  const kept = rememberedMic();
  if (kept && (await rec.start(kept))) return true;
  return rec.start();
}

/** A microphone's name without the browser's "Default - " / "默认 - " in front of it. */
export function micName(label: string | null | undefined): string {
  return (label ?? "").replace(/^(?:default|communications|默认|通讯)\s*[-–—:：]\s*/i, "").trim();
}
