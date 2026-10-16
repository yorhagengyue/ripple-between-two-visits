/** Small byte fixtures for the blob tests. */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

/** A real 16 kHz mono 16-bit PCM WAV of `samples` samples (a short ramp). */
export function wavBytes(samples = 160): Uint8Array {
  const dataLen = samples * 2;
  const buf = Buffer.alloc(44 + dataLen);
  buf.write("RIFF", 0, "ascii");
  buf.writeUInt32LE(36 + dataLen, 4);
  buf.write("WAVE", 8, "ascii");
  buf.write("fmt ", 12, "ascii");
  buf.writeUInt32LE(16, 16);
  buf.writeUInt16LE(1, 20); // PCM
  buf.writeUInt16LE(1, 22); // mono
  buf.writeUInt32LE(16_000, 24);
  buf.writeUInt32LE(32_000, 28);
  buf.writeUInt16LE(2, 32);
  buf.writeUInt16LE(16, 34);
  buf.write("data", 36, "ascii");
  buf.writeUInt32LE(dataLen, 40);
  for (let i = 0; i < samples; i++) buf.writeInt16LE((i * 97) % 2000 - 1000, 44 + i * 2);
  return new Uint8Array(buf);
}

/** The leading bytes of a WebM file (EBML header) plus filler: what MediaRecorder produces. */
export function webmBytes(): Uint8Array {
  return new Uint8Array([0x1a, 0x45, 0xdf, 0xa3, 0x9f, 0x42, 0x86, 0x81, 0x01, 0x42, 0xf7, 0x81, 0x01, 0x42, 0xf2, 0x81, 0x04]);
}

/** The synthetic amlodipine label photo (read only; web/fixtures is owned by the data side). */
export function labelPng(): Uint8Array {
  return new Uint8Array(readFileSync(fileURLToPath(new URL("../../../fixtures/labels/amlodipine.png", import.meta.url))));
}

export function equalBytes(a: Uint8Array, b: Uint8Array): boolean {
  return a.byteLength === b.byteLength && Buffer.from(a).equals(Buffer.from(b));
}
