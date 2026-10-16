"use client";

/**
 * Microphone -> 16 kHz mono 16-bit WAV, in the browser (web-app.md section 8: no WebM; Tencent needs a real
 * conversion, not a renamed file). An AudioContext at 16 kHz does the resampling where the browser allows
 * it; otherwise the blocks are resampled here. The AudioWorklet (public/worklets/pcm-recorder.js) hands
 * over raw PCM blocks; MediaRecorder is never used.
 *
 * 10-15 (the owner recorded 29 s of a visit and got 「没有录到声音」: the browser had opened a microphone that sent nothing
 * but zeros, a headset that was off, and nothing on the screen said so): the recorder also measures what comes in. level()
 * is how loud the last moments were (0 to 1, for a meter), hearing() how long this microphone has been heard and the
 * loudest moment since it was opened (a working microphone in a quiet room is never all zeros), inputs() the
 * microphones the browser knows, and switchInput() moves the same recording to another one without stopping it.
 */
import { useCallback, useRef, useState } from "react";
import { concatFloat32, encodeWav, resampleLinear, TARGET_SAMPLE_RATE } from "@/lib/visit/wav";

export type RecorderState = "idle" | "starting" | "recording" | "paused" | "stopped" | "unavailable";

declare global {
  interface Window {
    /** e2e: what the last recording produced */
    __rpLastRecording?: { type: string; size: number; sampleRate: number; durationMs: number; header: number[] };
  }
}

/** A microphone the browser knows (its label only once he has allowed the microphone). */
export interface MicInput {
  id: string;
  label: string;
}

export interface WavRecorder {
  state: RecorderState;
  /** opens the microphone (a given one, or the browser's default) and starts recording */
  start(deviceId?: string): Promise<boolean>;
  pause(on: boolean): void;
  stop(): Promise<Blob | null>;
  /** live captions (SPEECH_PROVIDER=whisper): every PCM block as it arrives, with the context's sample rate */
  setListener(fn: ((block: Float32Array, sampleRate: number) => void) | null): void;
  /** how loud the last moments were: 0 (nothing) to 1, falling back slowly like a meter */
  level(): number;
  /** since the microphone in use was opened: how long it has been heard (ms of audio) and its loudest sample */
  hearing(): { ms: number; peak: number };
  /** the microphones the browser knows */
  inputs(): Promise<MicInput[]>;
  /** the microphone in use (its device id), when the browser says */
  inputId(): string | null;
  /** the microphone in use as the browser names it (once he has allowed the microphone), or null */
  inputLabel(): string | null;
  /** the same recording goes on from another microphone; false when that one could not be opened (the old one stays) */
  switchInput(deviceId: string): Promise<boolean>;
}

/** Below this the microphone is sending nothing at all (-80 dBFS): a headset that is off, a muted or empty device. */
export const MIC_SILENT_PEAK = 1e-4;

interface Opened {
  ac: AudioContext;
  worklet: AudioWorkletNode;
  media: MediaStream;
}

/**
 * `hold: false` (C2 track R, the account's visit page): the recorder does not keep the recording in memory. Every block
 * goes to the listener and nowhere else, and `stop()` answers null: the page keeps the recording on the phone as it is
 * made (components/visit/elder/recording-store.ts) and uploads it from there, so a visit of an hour or three never sits
 * in the page's memory. The default keeps everything and `stop()` answers the whole WAV, as before (the demo's visit,
 * her reminder).
 */
export function useWavRecorder(opts: { hold?: boolean } = {}): WavRecorder {
  const hold = opts.hold !== false;
  const heard = useRef(0);
  const [state, setState] = useState<RecorderState>("idle");
  const opened = useRef<Opened | null>(null);
  const paused = useRef(false);
  const chunks = useRef<Float32Array[]>([]);
  const listener = useRef<((block: Float32Array, sampleRate: number) => void) | null>(null);
  // what comes in (10-15): the meter's level, and since this microphone was opened, how much was heard and how loud
  const meter = useRef(0);
  const since = useRef({ samples: 0, rate: TARGET_SAMPLE_RATE, peak: 0 });

  /** One microphone into one worklet; its blocks go where every block goes (the listener, and the WAV when held). */
  const open = useCallback(
    async (deviceId?: string): Promise<Opened> => {
      const media = await navigator.mediaDevices.getUserMedia({
        audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true, ...(deviceId ? { deviceId: { exact: deviceId } } : {}) },
      });
      let ac: AudioContext;
      try {
        ac = new AudioContext({ sampleRate: TARGET_SAMPLE_RATE });
      } catch {
        ac = new AudioContext();
      }
      try {
        await ac.audioWorklet.addModule("/worklets/pcm-recorder.js");
      } catch (e) {
        media.getTracks().forEach((t) => t.stop());
        await ac.close().catch(() => undefined);
        throw e;
      }
      const source = ac.createMediaStreamSource(media);
      const worklet = new AudioWorkletNode(ac, "pcm-recorder", { numberOfInputs: 1, numberOfOutputs: 0, channelCount: 1 });
      since.current = { samples: 0, rate: ac.sampleRate, peak: 0 };
      worklet.port.onmessage = (e: MessageEvent<Float32Array>) => {
        const block = e.data;
        let peak = 0;
        for (let i = 0; i < block.length; i++) {
          const v = block[i] < 0 ? -block[i] : block[i];
          if (v > peak) peak = v;
        }
        // the meter rises at once and falls back slowly; the hearing counts only this microphone
        meter.current = Math.max(peak, meter.current * 0.85);
        since.current.samples += block.length;
        if (peak > since.current.peak) since.current.peak = peak;
        if (hold) chunks.current.push(block);
        heard.current += block.length;
        try {
          listener.current?.(block, ac.sampleRate);
        } catch {
          // live captions must never break the recording
        }
      };
      source.connect(worklet);
      if (paused.current) worklet.port.postMessage({ paused: true });
      return { ac, worklet, media };
    },
    [hold],
  );

  const close = useCallback(async (o: Opened | null) => {
    if (!o) return;
    o.worklet.port.postMessage({ paused: true });
    o.worklet.port.onmessage = null;
    o.worklet.disconnect();
    o.media.getTracks().forEach((t) => t.stop());
    await o.ac.close().catch(() => undefined);
  }, []);

  const start = useCallback(
    async (deviceId?: string): Promise<boolean> => {
      if (typeof window === "undefined" || !navigator.mediaDevices?.getUserMedia || typeof AudioWorkletNode === "undefined") {
        setState("unavailable");
        return false;
      }
      setState("starting");
      try {
        chunks.current = [];
        heard.current = 0;
        meter.current = 0;
        paused.current = false;
        opened.current = await open(deviceId);
        setState("recording");
        return true;
      } catch {
        setState("unavailable");
        return false;
      }
    },
    [open],
  );

  const pause = useCallback((on: boolean) => {
    paused.current = on;
    opened.current?.worklet.port.postMessage({ paused: on });
    setState((s) => (s === "recording" || s === "paused" ? (on ? "paused" : "recording") : s));
  }, []);

  const stop = useCallback(async (): Promise<Blob | null> => {
    const o = opened.current;
    if (!o) return null;
    const rate = o.ac.sampleRate;
    opened.current = null;
    await close(o);
    meter.current = 0;
    setState("stopped");
    if (!hold) {
      // nothing was kept here: only what the recording was, for the tests that ask
      window.__rpLastRecording = { type: "audio/wav", size: 0, sampleRate: TARGET_SAMPLE_RATE, durationMs: Math.round((heard.current / rate) * 1000), header: [] };
      return null;
    }
    const pcm = resampleLinear(concatFloat32(chunks.current), rate, TARGET_SAMPLE_RATE);
    chunks.current = [];
    const bytes = encodeWav(pcm, TARGET_SAMPLE_RATE);
    const blob = new Blob([bytes.buffer as ArrayBuffer], { type: "audio/wav" });
    window.__rpLastRecording = {
      type: blob.type,
      size: blob.size,
      sampleRate: TARGET_SAMPLE_RATE,
      durationMs: Math.round((pcm.length / TARGET_SAMPLE_RATE) * 1000),
      header: Array.from(bytes.slice(0, 44)),
    };
    return blob;
  }, [hold, close]);

  const setListener = useCallback((fn: ((block: Float32Array, sampleRate: number) => void) | null) => {
    listener.current = fn;
  }, []);

  const level = useCallback(() => {
    // read by the meter several times a second: it falls back between blocks too
    meter.current *= 0.97;
    return meter.current;
  }, []);

  const hearing = useCallback(() => ({ ms: Math.round((since.current.samples / since.current.rate) * 1000), peak: since.current.peak }), []);

  const inputs = useCallback(async (): Promise<MicInput[]> => {
    try {
      const all = await navigator.mediaDevices.enumerateDevices();
      return all.filter((d) => d.kind === "audioinput" && d.deviceId && d.deviceId !== "default" && d.deviceId !== "communications").map((d) => ({ id: d.deviceId, label: d.label }));
    } catch {
      return [];
    }
  }, []);

  const inputId = useCallback(() => opened.current?.media.getAudioTracks()[0]?.getSettings().deviceId ?? null, []);
  const inputLabel = useCallback(() => opened.current?.media.getAudioTracks()[0]?.label || null, []);

  const switchInput = useCallback(
    async (deviceId: string): Promise<boolean> => {
      const old = opened.current;
      if (!old) return false;
      let next: Opened;
      try {
        // the new one first: when it cannot be opened, the old one goes on as it was
        next = await open(deviceId);
      } catch {
        return false;
      }
      opened.current = next;
      meter.current = 0;
      await close(old);
      return true;
    },
    [open, close],
  );

  return { state, start, pause, stop, setListener, level, hearing, inputs, inputId, inputLabel, switchInput };
}
