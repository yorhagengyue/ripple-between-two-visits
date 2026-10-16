/**
 * A small QR code encoder for one job: the address on /demo that a judge scans with a phone (real-status: "首页没有给
 * 手机的链接和二维码"). Byte mode, error correction level M, versions 1 to 10 (up to 213 bytes, plenty for a URL), the
 * mask with the lowest penalty. Pure and client-safe; no dependency. Follows ISO/IEC 18004 (the same steps as the
 * well-known reference implementations): data codewords, Reed-Solomon blocks interleaved, function patterns, zigzag
 * placement, masking, format and version information.
 */

/** Level M, versions 1..10: [total codewords, EC codewords per block, number of blocks]. */
const VERSIONS: readonly (readonly [number, number, number])[] = [
  [26, 10, 1],
  [44, 16, 1],
  [70, 26, 1],
  [100, 18, 2],
  [134, 24, 2],
  [172, 16, 4],
  [196, 18, 4],
  [242, 22, 4],
  [292, 22, 5],
  [346, 26, 5],
];

/** Alignment pattern centre positions, versions 1..10. */
const ALIGN: readonly (readonly number[])[] = [[], [6, 18], [6, 22], [6, 26], [6, 30], [6, 34], [6, 22, 38], [6, 24, 42], [6, 26, 46], [6, 28, 50]];

export interface QrCode {
  version: number;
  size: number;
  mask: number;
  /** modules[y][x]: true = dark */
  modules: boolean[][];
}

const bit = (x: number, i: number) => ((x >>> i) & 1) !== 0;

function gfMul(x: number, y: number): number {
  let z = 0;
  for (let i = 7; i >= 0; i--) {
    z = (z << 1) ^ ((z >>> 7) * 0x11d);
    z ^= ((y >>> i) & 1) * x;
  }
  return z & 0xff;
}

function rsDivisor(degree: number): number[] {
  const result = new Array<number>(degree).fill(0);
  result[degree - 1] = 1;
  let root = 1;
  for (let i = 0; i < degree; i++) {
    for (let j = 0; j < degree; j++) {
      result[j] = gfMul(result[j], root);
      if (j + 1 < degree) result[j] ^= result[j + 1];
    }
    root = gfMul(root, 0x02);
  }
  return result;
}

function rsRemainder(data: number[], divisor: number[]): number[] {
  const result = new Array<number>(divisor.length).fill(0);
  for (const b of data) {
    const factor = b ^ (result.shift() as number);
    result.push(0);
    divisor.forEach((d, i) => (result[i] ^= gfMul(d, factor)));
  }
  return result;
}

function utf8(text: string): number[] {
  return Array.from(new TextEncoder().encode(text));
}

/** The data codewords (mode, count, bytes, terminator, padding) for a version. */
function dataCodewords(bytes: number[], version: number, capacity: number): number[] | null {
  const countBits = version <= 9 ? 8 : 16;
  const bits: number[] = [];
  const push = (value: number, len: number) => {
    for (let i = len - 1; i >= 0; i--) bits.push((value >>> i) & 1);
  };
  push(0b0100, 4);
  push(bytes.length, countBits);
  for (const b of bytes) push(b, 8);
  const capBits = capacity * 8;
  if (bits.length > capBits) return null;
  push(0, Math.min(4, capBits - bits.length));
  while (bits.length % 8 !== 0) bits.push(0);
  const out: number[] = [];
  for (let i = 0; i < bits.length; i += 8) out.push(bits.slice(i, i + 8).reduce((a, b) => (a << 1) | b, 0));
  for (let pad = 0xec; out.length < capacity; pad ^= 0xec ^ 0x11) out.push(pad);
  return out;
}

function interleave(data: number[], version: number): number[] {
  const [raw, eccLen, blocks] = VERSIONS[version - 1];
  const shortBlocks = blocks - (raw % blocks);
  const shortLen = Math.floor(raw / blocks);
  const divisor = rsDivisor(eccLen);
  const all: number[][] = [];
  for (let i = 0, k = 0; i < blocks; i++) {
    const dat = data.slice(k, k + shortLen - eccLen + (i < shortBlocks ? 0 : 1));
    k += dat.length;
    const ecc = rsRemainder(dat, divisor);
    if (i < shortBlocks) dat.push(0);
    all.push(dat.concat(ecc));
  }
  const out: number[] = [];
  for (let i = 0; i < all[0].length; i++) {
    all.forEach((block, j) => {
      if (i !== shortLen - eccLen || j >= shortBlocks) out.push(block[i]);
    });
  }
  return out;
}

class Grid {
  readonly modules: boolean[][];
  readonly fn: boolean[][];
  constructor(readonly size: number) {
    this.modules = Array.from({ length: size }, () => new Array<boolean>(size).fill(false));
    this.fn = Array.from({ length: size }, () => new Array<boolean>(size).fill(false));
  }
  set(x: number, y: number, dark: boolean): void {
    this.modules[y][x] = dark;
    this.fn[y][x] = true;
  }
}

function drawFunctionPatterns(g: Grid, version: number): void {
  const n = g.size;
  for (let i = 0; i < n; i++) {
    g.set(6, i, i % 2 === 0);
    g.set(i, 6, i % 2 === 0);
  }
  for (const [cx, cy] of [
    [3, 3],
    [n - 4, 3],
    [3, n - 4],
  ]) {
    for (let dy = -4; dy <= 4; dy++) {
      for (let dx = -4; dx <= 4; dx++) {
        const x = cx + dx;
        const y = cy + dy;
        if (x < 0 || y < 0 || x >= n || y >= n) continue;
        const d = Math.max(Math.abs(dx), Math.abs(dy));
        g.set(x, y, d !== 2 && d !== 4);
      }
    }
  }
  const pos = ALIGN[version - 1];
  const last = pos.length - 1;
  pos.forEach((a, i) =>
    pos.forEach((b, j) => {
      if ((i === 0 && j === 0) || (i === 0 && j === last) || (i === last && j === 0)) return;
      for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) g.set(a + dx, b + dy, Math.max(Math.abs(dx), Math.abs(dy)) !== 1);
    }),
  );
  drawFormat(g, 0); // reserved now, written for real once the mask is chosen
  if (version >= 7) {
    let rem = version;
    for (let i = 0; i < 12; i++) rem = (rem << 1) ^ ((rem >>> 11) * 0x1f25);
    const bits = (version << 12) | rem;
    for (let i = 0; i < 18; i++) {
      const a = n - 11 + (i % 3);
      const b = Math.floor(i / 3);
      g.set(a, b, bit(bits, i));
      g.set(b, a, bit(bits, i));
    }
  }
}

/** Format information: level M (00) and the mask, BCH(15,5), masked with 0x5412. */
export function formatBits(mask: number): number {
  const data = (0b00 << 3) | mask;
  let rem = data;
  for (let i = 0; i < 10; i++) rem = (rem << 1) ^ ((rem >>> 9) * 0x537);
  return ((data << 10) | rem) ^ 0x5412;
}

function drawFormat(g: Grid, mask: number): void {
  const n = g.size;
  const bits = formatBits(mask);
  for (let i = 0; i <= 5; i++) g.set(8, i, bit(bits, i));
  g.set(8, 7, bit(bits, 6));
  g.set(8, 8, bit(bits, 7));
  g.set(7, 8, bit(bits, 8));
  for (let i = 9; i < 15; i++) g.set(14 - i, 8, bit(bits, i));
  for (let i = 0; i < 8; i++) g.set(n - 1 - i, 8, bit(bits, i));
  for (let i = 8; i < 15; i++) g.set(8, n - 15 + i, bit(bits, i));
  g.set(8, n - 8, true);
}

function placeCodewords(g: Grid, codewords: number[]): void {
  const n = g.size;
  let i = 0;
  for (let right = n - 1; right >= 1; right -= 2) {
    if (right === 6) right = 5;
    for (let vert = 0; vert < n; vert++) {
      for (let j = 0; j < 2; j++) {
        const x = right - j;
        const upward = ((right + 1) & 2) === 0;
        const y = upward ? n - 1 - vert : vert;
        if (!g.fn[y][x] && i < codewords.length * 8) {
          g.modules[y][x] = bit(codewords[i >>> 3], 7 - (i & 7));
          i++;
        }
      }
    }
  }
}

const MASKS: ((x: number, y: number) => boolean)[] = [
  (x, y) => (x + y) % 2 === 0,
  (x, y) => y % 2 === 0,
  (x) => x % 3 === 0,
  (x, y) => (x + y) % 3 === 0,
  (x, y) => (Math.floor(x / 3) + Math.floor(y / 2)) % 2 === 0,
  (x, y) => ((x * y) % 2) + ((x * y) % 3) === 0,
  (x, y) => (((x * y) % 2) + ((x * y) % 3)) % 2 === 0,
  (x, y) => (((x + y) % 2) + ((x * y) % 3)) % 2 === 0,
];

function applyMask(g: Grid, mask: number): void {
  for (let y = 0; y < g.size; y++) for (let x = 0; x < g.size; x++) if (!g.fn[y][x] && MASKS[mask](x, y)) g.modules[y][x] = !g.modules[y][x];
}

/** The standard penalty (runs, 2x2 blocks, finder-like patterns, dark balance): lower is easier to scan. */
export function penalty(m: boolean[][]): number {
  const n = m.length;
  let score = 0;
  const lines: boolean[][] = [];
  for (let y = 0; y < n; y++) lines.push(m[y]);
  for (let x = 0; x < n; x++) lines.push(m.map((row) => row[x]));
  const finderA = [true, false, true, true, true, false, true, false, false, false, false];
  const finderB = [...finderA].reverse();
  for (const line of lines) {
    let run = 1;
    for (let i = 1; i <= line.length; i++) {
      if (i < line.length && line[i] === line[i - 1]) run++;
      else {
        if (run >= 5) score += 3 + (run - 5);
        run = 1;
      }
    }
    for (let i = 0; i + 11 <= line.length; i++) {
      const seg = line.slice(i, i + 11);
      if (seg.every((v, k) => v === finderA[k]) || seg.every((v, k) => v === finderB[k])) score += 40;
    }
  }
  for (let y = 0; y + 1 < n; y++) for (let x = 0; x + 1 < n; x++) if (m[y][x] === m[y][x + 1] && m[y][x] === m[y + 1][x] && m[y][x] === m[y + 1][x + 1]) score += 3;
  const dark = m.reduce((a, row) => a + row.filter(Boolean).length, 0);
  const total = n * n;
  score += (Math.ceil(Math.abs(dark * 20 - total * 10) / total) - 1) * 10;
  return score;
}

/** The QR code of `text` (UTF-8, byte mode, level M), or null when it does not fit version 10. */
export function encodeQr(text: string): QrCode | null {
  const bytes = utf8(text);
  for (let version = 1; version <= VERSIONS.length; version++) {
    const [raw, eccLen, blocks] = VERSIONS[version - 1];
    const data = dataCodewords(bytes, version, raw - eccLen * blocks);
    if (!data) continue;
    const codewords = interleave(data, version);
    const size = version * 4 + 17;
    let best: QrCode | null = null;
    let bestScore = Infinity;
    for (let mask = 0; mask < 8; mask++) {
      const g = new Grid(size);
      drawFunctionPatterns(g, version);
      placeCodewords(g, codewords);
      applyMask(g, mask);
      drawFormat(g, mask);
      const score = penalty(g.modules);
      if (score < bestScore) {
        bestScore = score;
        best = { version, size, mask, modules: g.modules.map((row) => [...row]) };
      }
    }
    return best;
  }
  return null;
}

/** An SVG path ("M x y h1 v1 h-1 z" per dark module) with a quiet zone of `quiet` modules; viewBox 0 0 w w. */
export function qrSvgPath(qr: QrCode, quiet = 4): { d: string; width: number } {
  const parts: string[] = [];
  qr.modules.forEach((row, y) => row.forEach((dark, x) => dark && parts.push(`M${x + quiet} ${y + quiet}h1v1h-1z`)));
  return { d: parts.join(""), width: qr.size + quiet * 2 };
}
