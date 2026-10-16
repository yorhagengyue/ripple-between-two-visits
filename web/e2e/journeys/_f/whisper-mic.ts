/**
 * The fake microphone for journey 05-whisper (C2 track F): a 16 kHz mono 16-bit WAV that Chromium plays as the
 * microphone (--use-fake-device-for-media-stream --use-file-for-fake-audio-capture=<wav>%noloop). It is Dr Lim's two
 * lines of the first visit in the repo's stand-in voice (fixtures/visits/clips/v1-u08.wav, v1-u09.wav), placed where
 * they are in that visit: silence, R1 「At home, we want it below 135 over 85.」 from 0:49.4 (speech from about 0:49.5,
 * as the fixture's 49 520 ms), R2 (the warning line with 995) right after it, then two seconds of silence. Real speech,
 * so the Whisper service hears it; the silence before it stands for the rest of the visit, which has no stand-in voice.
 *
 * Written once at import (the browser's launch options need the path before the test runs), under the OS temp folder.
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

const RATE = 16_000;
const CLIPS = path.join(__dirname, "..", "..", "..", "fixtures", "visits", "clips");

/** where R1's clip starts in the recording (its speech starts about 0.12 s into the clip) */
export const R1_AT_MS = 49_400;
/** R2's clip right after R1's (R1's clip is 5.35 s with its margins) */
export const R2_AT_MS = 55_200;
const TAIL_MS = 2_000;

/** The 16-bit samples of a PCM WAV (16 kHz mono, as the clips are). */
function pcm16(file: string): Int16Array {
  const buf = readFileSync(file);
  if (buf.toString("ascii", 0, 4) !== "RIFF" || buf.toString("ascii", 8, 12) !== "WAVE") throw new Error(`${file}: not a WAV`);
  let off = 12;
  let fmt: { rate: number; channels: number; bits: number } | null = null;
  while (off + 8 <= buf.length) {
    const id = buf.toString("ascii", off, off + 4);
    const size = buf.readUInt32LE(off + 4);
    const body = off + 8;
    if (id === "fmt ") fmt = { channels: buf.readUInt16LE(body + 2), rate: buf.readUInt32LE(body + 4), bits: buf.readUInt16LE(body + 14) };
    if (id === "data") {
      if (!fmt || fmt.rate !== RATE || fmt.channels !== 1 || fmt.bits !== 16) throw new Error(`${file}: expected 16 kHz mono 16-bit`);
      const n = Math.floor(Math.min(size, buf.length - body) / 2);
      const out = new Int16Array(n);
      for (let i = 0; i < n; i++) out[i] = buf.readInt16LE(body + i * 2);
      return out;
    }
    off = body + size + (size % 2);
  }
  throw new Error(`${file}: no data chunk`);
}

function wav(samples: Int16Array): Buffer {
  const data = samples.length * 2;
  const out = Buffer.alloc(44 + data);
  out.write("RIFF", 0, "ascii");
  out.writeUInt32LE(36 + data, 4);
  out.write("WAVE", 8, "ascii");
  out.write("fmt ", 12, "ascii");
  out.writeUInt32LE(16, 16);
  out.writeUInt16LE(1, 20); // PCM
  out.writeUInt16LE(1, 22); // mono
  out.writeUInt32LE(RATE, 24);
  out.writeUInt32LE(RATE * 2, 28);
  out.writeUInt16LE(2, 32);
  out.writeUInt16LE(16, 34);
  out.write("data", 36, "ascii");
  out.writeUInt32LE(data, 40);
  for (let i = 0; i < samples.length; i++) out.writeInt16LE(samples[i], 44 + i * 2);
  return out;
}

function build(): string {
  const r1 = pcm16(path.join(CLIPS, "v1-u08.wav"));
  const r2 = pcm16(path.join(CLIPS, "v1-u09.wav"));
  const at = (ms: number) => Math.round((ms * RATE) / 1000);
  const total = at(R2_AT_MS) + r2.length + at(TAIL_MS);
  const all = new Int16Array(total);
  all.set(r1, at(R1_AT_MS));
  all.set(r2, at(R2_AT_MS));
  const dir = path.join(os.tmpdir(), "ripple-journeys");
  mkdirSync(dir, { recursive: true });
  const file = path.join(dir, "05-whisper-mic.wav");
  writeFileSync(file, wav(all));
  return file;
}

/** The fake microphone's file, and how long it plays (ms). */
export const WHISPER_MIC_WAV = build();
export const WHISPER_MIC_MS = R2_AT_MS + Math.round((pcm16(path.join(CLIPS, "v1-u09.wav")).length / RATE) * 1000) + TAIL_MS;

/** Launch options: the config's own args, the fake media, and the microphone fed from the file (played once). */
export const WHISPER_MIC_LAUNCH = {
  args: [
    "--autoplay-policy=no-user-gesture-required",
    "--force-device-scale-factor=2",
    "--use-fake-ui-for-media-stream",
    "--use-fake-device-for-media-stream",
    `--use-file-for-fake-audio-capture=${WHISPER_MIC_WAV}%noloop`,
  ],
};
