/**
 * A small QR code encoder for the check-in code (ADR 0012): byte mode,
 * error correction level M, versions 1 to 10 (up to 213 bytes, plenty for
 * a URL). It runs on the server and the page gets plain SVG, so no QR
 * library ships to the browser or joins the dependencies.
 *
 * Follows ISO/IEC 18004: data and error correction codewords in blocks,
 * function patterns, the zigzag data placement, the mask with the lowest
 * penalty, and format and version information.
 *
 * Pure: the same text always gives the same modules.
 */

export type QrCode = {
  version: number;
  size: number;
  /** modules[y][x]: true is dark. */
  modules: boolean[][];
  mask: number;
};

/** Level M: error correction codewords per block, and blocks, by version. */
const ECC_PER_BLOCK = [10, 16, 26, 18, 24, 16, 18, 22, 22, 26];
const BLOCKS = [1, 1, 1, 2, 2, 4, 4, 4, 5, 5];
export const MAX_VERSION = 10;

/** Data and error correction modules a version holds. */
function rawDataModules(version: number): number {
  let result = (16 * version + 128) * version + 64;
  if (version >= 2) {
    const align = Math.floor(version / 7) + 2;
    result -= (25 * align - 10) * align - 55;
    if (version >= 7) result -= 36;
  }
  return result;
}

const totalCodewords = (version: number) =>
  Math.floor(rawDataModules(version) / 8);

export function dataCodewords(version: number): number {
  const i = version - 1;
  return totalCodewords(version) - (ECC_PER_BLOCK[i] ?? 0) * (BLOCKS[i] ?? 0);
}

// GF(256) with the QR polynomial x^8 + x^4 + x^3 + x^2 + 1.
const EXP = new Uint8Array(512);
const LOG = new Uint8Array(256);
{
  let x = 1;
  for (let i = 0; i < 255; i++) {
    EXP[i] = x;
    LOG[x] = i;
    x <<= 1;
    if (x & 0x100) x ^= 0x11d;
  }
  for (let i = 255; i < 512; i++) EXP[i] = EXP[i - 255] ?? 0;
}
const mul = (a: number, b: number) =>
  a === 0 || b === 0 ? 0 : (EXP[(LOG[a] ?? 0) + (LOG[b] ?? 0)] ?? 0);

/** The Reed-Solomon generator of `degree`, highest power first, leading 1 dropped. */
function generator(degree: number): number[] {
  const poly = new Array<number>(degree).fill(0);
  poly[degree - 1] = 1;
  let root = 1;
  for (let i = 0; i < degree; i++) {
    for (let j = 0; j < degree; j++) {
      poly[j] = mul(poly[j] ?? 0, root) ^ (poly[j + 1] ?? 0);
    }
    root = mul(root, 2);
  }
  return poly;
}

/** The error correction codewords of `data`. */
export function reedSolomon(data: readonly number[], degree: number): number[] {
  const gen = generator(degree);
  const rem = new Array<number>(degree).fill(0);
  for (const byte of data) {
    const factor = byte ^ (rem.shift() ?? 0);
    rem.push(0);
    for (let i = 0; i < degree; i++)
      rem[i] = (rem[i] ?? 0) ^ mul(gen[i] ?? 0, factor);
  }
  return rem;
}

/** The smallest version that holds `length` bytes, or null. */
export function versionFor(length: number): number | null {
  for (let v = 1; v <= MAX_VERSION; v++) {
    const countBits = v <= 9 ? 8 : 16;
    if (4 + countBits + 8 * length <= dataCodewords(v) * 8) return v;
  }
  return null;
}

function dataBytes(bytes: Uint8Array, version: number): number[] {
  const bits: number[] = [];
  const put = (value: number, length: number) => {
    for (let i = length - 1; i >= 0; i--) bits.push((value >>> i) & 1);
  };
  put(0b0100, 4);
  put(bytes.length, version <= 9 ? 8 : 16);
  for (const b of bytes) put(b, 8);
  const capacity = dataCodewords(version) * 8;
  put(0, Math.min(4, capacity - bits.length));
  put(0, (8 - (bits.length % 8)) % 8);
  const out: number[] = [];
  for (let i = 0; i < bits.length; i += 8)
    out.push(bits.slice(i, i + 8).reduce((n, b) => (n << 1) | b, 0));
  for (let pad = 0xec; out.length < capacity / 8; pad ^= 0xec ^ 0x11)
    out.push(pad);
  return out;
}

/** Splits the data into blocks, adds error correction and interleaves them. */
function withErrorCorrection(
  data: readonly number[],
  version: number,
): number[] {
  const blocks = BLOCKS[version - 1] ?? 1;
  const ecc = ECC_PER_BLOCK[version - 1] ?? 0;
  const raw = totalCodewords(version);
  const shortBlocks = blocks - (raw % blocks);
  const shortLength = Math.floor(raw / blocks) - ecc;
  const dataBlocks: number[][] = [];
  const eccBlocks: number[][] = [];
  for (let i = 0, k = 0; i < blocks; i++) {
    const length = shortLength + (i < shortBlocks ? 0 : 1);
    const block = data.slice(k, k + length);
    k += length;
    dataBlocks.push(block);
    eccBlocks.push(reedSolomon(block, ecc));
  }
  const out: number[] = [];
  for (let i = 0; i <= shortLength; i++)
    for (const block of dataBlocks)
      if (i < block.length) out.push(block[i] ?? 0);
  for (let i = 0; i < ecc; i++)
    for (const block of eccBlocks) out.push(block[i] ?? 0);
  return out;
}

/** Centers of the alignment patterns along each axis. */
export function alignmentCenters(version: number): number[] {
  if (version === 1) return [];
  const count = Math.floor(version / 7) + 2;
  const size = version * 4 + 17;
  const step = Math.ceil((version * 4 + 4) / (count * 2 - 2)) * 2;
  const centers = [6];
  for (let pos = size - 7; centers.length < count; pos -= step)
    centers.splice(1, 0, pos);
  return centers;
}

const MASKS: ((x: number, y: number) => boolean)[] = [
  (x, y) => (x + y) % 2 === 0,
  (_, y) => y % 2 === 0,
  (x) => x % 3 === 0,
  (x, y) => (x + y) % 3 === 0,
  (x, y) => (Math.floor(x / 3) + Math.floor(y / 2)) % 2 === 0,
  (x, y) => ((x * y) % 2) + ((x * y) % 3) === 0,
  (x, y) => (((x * y) % 2) + ((x * y) % 3)) % 2 === 0,
  (x, y) => (((x + y) % 2) + ((x * y) % 3)) % 2 === 0,
];

/** Level M's two format bits are 00; then the mask and a BCH code. */
export function formatBits(mask: number): number {
  const data = (0b00 << 3) | mask;
  let rem = data;
  for (let i = 0; i < 10; i++) rem = (rem << 1) ^ ((rem >>> 9) * 0x537);
  return ((data << 10) | rem) ^ 0x5412;
}

export function versionBits(version: number): number {
  let rem = version;
  for (let i = 0; i < 12; i++) rem = (rem << 1) ^ ((rem >>> 11) * 0x1f25);
  return (version << 12) | rem;
}

class Grid {
  readonly modules: boolean[][];
  readonly isFunction: boolean[][];
  constructor(readonly size: number) {
    this.modules = Array.from({ length: size }, () =>
      new Array<boolean>(size).fill(false),
    );
    this.isFunction = Array.from({ length: size }, () =>
      new Array<boolean>(size).fill(false),
    );
  }
  set(x: number, y: number, dark: boolean) {
    const row = this.modules[y];
    const fn = this.isFunction[y];
    if (!row || !fn || x < 0 || x >= this.size) return;
    row[x] = dark;
    fn[x] = true;
  }
  isFn(x: number, y: number) {
    return this.isFunction[y]?.[x] ?? true;
  }
}

function drawFunctionPatterns(grid: Grid, version: number) {
  const size = grid.size;
  for (let i = 0; i < size; i++) {
    grid.set(6, i, i % 2 === 0);
    grid.set(i, 6, i % 2 === 0);
  }
  // Finders with their separators.
  for (const [cx, cy] of [
    [3, 3],
    [size - 4, 3],
    [3, size - 4],
  ] as const) {
    for (let dy = -4; dy <= 4; dy++)
      for (let dx = -4; dx <= 4; dx++) {
        const d = Math.max(Math.abs(dx), Math.abs(dy));
        grid.set(cx + dx, cy + dy, d !== 2 && d !== 4);
      }
  }
  const centers = alignmentCenters(version);
  const last = centers.length - 1;
  centers.forEach((cy, i) =>
    centers.forEach((cx, j) => {
      // Not where a finder sits.
      if (
        (i === 0 && j === 0) ||
        (i === 0 && j === last) ||
        (i === last && j === 0)
      )
        return;
      for (let dy = -2; dy <= 2; dy++)
        for (let dx = -2; dx <= 2; dx++)
          grid.set(
            cx + dx,
            cy + dy,
            Math.max(Math.abs(dx), Math.abs(dy)) !== 1,
          );
    }),
  );
  drawFormat(grid, 0);
  if (version >= 7) {
    const bits = versionBits(version);
    for (let i = 0; i < 18; i++) {
      const dark = ((bits >>> i) & 1) === 1;
      const a = size - 11 + (i % 3);
      const b = Math.floor(i / 3);
      grid.set(a, b, dark);
      grid.set(b, a, dark);
    }
  }
}

function drawFormat(grid: Grid, mask: number) {
  const bits = formatBits(mask);
  const bit = (i: number) => ((bits >>> i) & 1) === 1;
  const size = grid.size;
  for (let i = 0; i <= 5; i++) grid.set(8, i, bit(i));
  grid.set(8, 7, bit(6));
  grid.set(8, 8, bit(7));
  grid.set(7, 8, bit(8));
  for (let i = 9; i < 15; i++) grid.set(14 - i, 8, bit(i));
  for (let i = 0; i < 8; i++) grid.set(size - 1 - i, 8, bit(i));
  for (let i = 8; i < 15; i++) grid.set(8, size - 15 + i, bit(i));
  // The dark module.
  grid.set(8, size - 8, true);
}

function placeData(grid: Grid, codewords: readonly number[]) {
  const size = grid.size;
  let i = 0;
  for (let right = size - 1; right >= 1; right -= 2) {
    if (right === 6) right = 5;
    for (let vert = 0; vert < size; vert++) {
      for (let j = 0; j < 2; j++) {
        const x = right - j;
        const upward = ((right + 1) & 2) === 0;
        const y = upward ? size - 1 - vert : vert;
        if (grid.isFn(x, y) || i >= codewords.length * 8) continue;
        const row = grid.modules[y];
        if (row)
          row[x] = (((codewords[i >>> 3] ?? 0) >>> (7 - (i & 7))) & 1) === 1;
        i++;
      }
    }
  }
}

function applyMask(grid: Grid, mask: number) {
  const test = MASKS[mask] ?? MASKS[0]!;
  for (let y = 0; y < grid.size; y++)
    for (let x = 0; x < grid.size; x++) {
      const row = grid.modules[y];
      if (row && !grid.isFn(x, y) && test(x, y)) row[x] = !row[x];
    }
}

const FINDER_LIKE = [
  [1, 0, 1, 1, 1, 0, 1, 0, 0, 0, 0],
  [0, 0, 0, 0, 1, 0, 1, 1, 1, 0, 1],
];

/** The standard's penalty score: lower reads more reliably. */
export function penalty(modules: readonly (readonly boolean[])[]): number {
  const size = modules.length;
  const at = (x: number, y: number) => modules[y]?.[x] ?? false;
  let score = 0;
  for (const line of [
    (i: number, j: number) => at(j, i),
    (i: number, j: number) => at(i, j),
  ]) {
    for (let i = 0; i < size; i++) {
      let run = 1;
      for (let j = 1; j <= size; j++) {
        if (j < size && line(i, j) === line(i, j - 1)) run++;
        else {
          if (run >= 5) score += run - 2;
          run = 1;
        }
      }
      for (let j = 0; j + 11 <= size; j++)
        for (const pattern of FINDER_LIKE)
          if (pattern.every((p, k) => line(i, j + k) === (p === 1)))
            score += 40;
    }
  }
  let dark = 0;
  for (let y = 0; y < size; y++)
    for (let x = 0; x < size; x++) {
      if (at(x, y)) dark++;
      if (
        x < size - 1 &&
        y < size - 1 &&
        at(x, y) === at(x + 1, y) &&
        at(x, y) === at(x, y + 1) &&
        at(x, y) === at(x + 1, y + 1)
      )
        score += 3;
    }
  const total = size * size;
  score += Math.floor(Math.abs(dark * 20 - total * 10) / total) * 10;
  return score;
}

/** Encodes `text` as UTF-8 in a QR code, or throws when it is too long. */
export function encodeQr(text: string): QrCode {
  const bytes = new TextEncoder().encode(text);
  const version = versionFor(bytes.length);
  if (version === null)
    throw new Error(`Too long for a QR code here: ${bytes.length} bytes`);
  const size = version * 4 + 17;
  const codewords = withErrorCorrection(dataBytes(bytes, version), version);
  let best: { grid: Grid; mask: number; score: number } | null = null;
  for (let mask = 0; mask < 8; mask++) {
    const grid = new Grid(size);
    drawFunctionPatterns(grid, version);
    placeData(grid, codewords);
    applyMask(grid, mask);
    drawFormat(grid, mask);
    const score = penalty(grid.modules);
    if (!best || score < best.score) best = { grid, mask, score };
  }
  if (!best) throw new Error("No mask");
  return { version, size, modules: best.grid.modules, mask: best.mask };
}

/**
 * The code as an SVG path, one module per unit, with the four-module quiet
 * zone the standard asks for: `M x y h n v1 h -n z` for each run of dark
 * modules in a row.
 */
export function qrPath(code: QrCode, quiet = 4): string {
  const parts: string[] = [];
  code.modules.forEach((row, y) => {
    let x = 0;
    while (x < code.size) {
      if (!row[x]) {
        x++;
        continue;
      }
      const start = x;
      while (x < code.size && row[x]) x++;
      parts.push(
        `M${start + quiet} ${y + quiet}h${x - start}v1h-${x - start}z`,
      );
    }
  });
  return parts.join("");
}
