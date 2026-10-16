/**
 * The QR code on /demo (lib/crew/qr.ts): byte mode, level M, versions 1-10. The two golden codes below were decoded back
 * to their text with OpenCV's QRCodeDetector when the encoder was written (10-10, track E), so a change that breaks the
 * code changes their hash here; the structure is checked directly: finder patterns, timing, the dark module, the format
 * information (BCH-valid, level M, the chosen mask), the version picked, the capacity.
 */
import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { encodeQr, formatBits, qrSvgPath } from "@/lib/crew/qr";

const hash = (m: boolean[][]) =>
  createHash("sha256")
    .update(m.map((r) => r.map((v) => (v ? "1" : "0")).join("")).join("\n"))
    .digest("hex");

describe("encodeQr", () => {
  it("the golden codes (decoded with OpenCV when written)", () => {
    const a = encodeQr("http://localhost:3550/signup")!;
    expect([a.version, a.size, a.mask]).toEqual([3, 29, 4]);
    expect(hash(a.modules)).toBe("afc8a4e61b9d3773460bd1add98ba8bf619cd67dd2d735cdb419eeff04902b13");
    const b = encodeQr("Hello")!;
    expect([b.version, b.size, b.mask]).toEqual([1, 21, 2]);
    expect(hash(b.modules)).toBe("23ee6cfca3dbe1d4f97f19ebb43f20041cb5d2de6238cd30381a1325a3a1d5e2");
  });

  it("finder patterns in three corners, timing lines, the dark module", () => {
    const q = encodeQr("https://ripple.example.sg/signup")!;
    const n = q.size;
    const finder = (ox: number, oy: number) => {
      for (let y = 0; y < 7; y++) {
        for (let x = 0; x < 7; x++) {
          const d = Math.max(Math.abs(x - 3), Math.abs(y - 3));
          expect(q.modules[oy + y][ox + x], `${ox + x},${oy + y}`).toBe(d !== 2);
        }
      }
    };
    finder(0, 0);
    finder(n - 7, 0);
    finder(0, n - 7);
    for (let i = 8; i < n - 8; i++) {
      expect(q.modules[6][i]).toBe(i % 2 === 0);
      expect(q.modules[i][6]).toBe(i % 2 === 0);
    }
    expect(q.modules[n - 8][8]).toBe(true);
  });

  it("the format information is BCH-valid, says level M and the mask, and is written twice", () => {
    for (const text of ["Hello", "http://100.80.153.4:3300/signup", "x".repeat(120)]) {
      const q = encodeQr(text)!;
      const n = q.size;
      const m = q.modules;
      const bitsAt = (cells: [number, number][]) => cells.reduce((acc, [x, y], i) => acc | ((m[y][x] ? 1 : 0) << i), 0);
      const first: [number, number][] = [
        [8, 0], [8, 1], [8, 2], [8, 3], [8, 4], [8, 5], [8, 7], [8, 8], [7, 8], [5, 8], [4, 8], [3, 8], [2, 8], [1, 8], [0, 8],
      ];
      const second: [number, number][] = [
        ...Array.from({ length: 8 }, (_, i) => [n - 1 - i, 8] as [number, number]),
        ...Array.from({ length: 7 }, (_, i) => [8, n - 7 + i] as [number, number]),
      ];
      const f = bitsAt(first);
      expect(f, text).toBe(formatBits(q.mask));
      expect(bitsAt(second), text).toBe(f);
      const raw = f ^ 0x5412;
      expect(raw >>> 13, "level M").toBe(0b00);
      expect((raw >>> 10) & 0b111).toBe(q.mask);
      // the BCH remainder of the 15 bits is zero
      let rem = raw;
      for (let i = 14; i >= 10; i--) if ((rem >>> i) & 1) rem ^= 0x537 << (i - 10);
      expect(rem).toBe(0);
    }
  });

  it("the smallest version that fits; null past version 10", () => {
    expect(encodeQr("Hello")!.version).toBe(1);
    expect(encodeQr("x".repeat(14))!.version).toBe(1);
    expect(encodeQr("x".repeat(15))!.version).toBe(2);
    expect(encodeQr("x".repeat(213))!.version).toBe(10);
    expect(encodeQr("x".repeat(214))).toBeNull();
    expect(encodeQr("x".repeat(120))!.version).toBe(7); // version information is drawn from 7 on
  });

  it("an SVG path with a quiet zone", () => {
    const q = encodeQr("Hello")!;
    const svg = qrSvgPath(q);
    expect(svg.width).toBe(29);
    expect(svg.d.startsWith("M4 4h1v1h-1z")).toBe(true);
    expect(svg.d.match(/M/g)!.length).toBe(q.modules.flat().filter(Boolean).length);
  });
});
