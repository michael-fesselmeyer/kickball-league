/**
 * A small QR code encoder for printed sheets: byte mode, error correction
 * level M (about 15% of the code can be smudged), versions 1 to 10, so up to
 * 213 bytes, plenty for a link. It draws on the server with no package and no
 * outside service. The steps follow the QR code standard (ISO/IEC 18004):
 * encode the bytes, add Reed-Solomon error correction, place the modules,
 * then pick the mask with the lowest penalty.
 */

/** Dark modules as rows of booleans, without the quiet zone. */
export type QrMatrix = readonly (readonly boolean[])[];

const MAX_VERSION = 10;
/** Error correction codewords per block at level M, by version. */
const ECC_PER_BLOCK = [0, 10, 16, 26, 18, 24, 16, 18, 22, 22, 26];
/** Number of error correction blocks at level M, by version. */
const BLOCKS = [0, 1, 1, 1, 2, 2, 4, 4, 4, 5, 5];
/** Level M's two format bits. */
const LEVEL_M = 0b00;

/** Modules left for data and error correction once the patterns are drawn. */
function rawDataModules(version: number): number {
  let result = (16 * version + 128) * version + 64;
  if (version >= 2) {
    const align = Math.floor(version / 7) + 2;
    result -= (25 * align - 10) * align - 55;
    if (version >= 7) result -= 36;
  }
  return result;
}

/** Data codewords a version holds at level M. */
export function dataCodewords(version: number): number {
  return (
    Math.floor(rawDataModules(version) / 8) -
    (ECC_PER_BLOCK[version] ?? 0) * (BLOCKS[version] ?? 0)
  );
}

// ---------------------------------------------------------------------------
// Reed-Solomon over GF(256), with the QR code's polynomial 0x11D.

function gfMultiply(x: number, y: number): number {
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
      result[j] = gfMultiply(result[j] ?? 0, root);
      if (j + 1 < degree) result[j] = (result[j] ?? 0) ^ (result[j + 1] ?? 0);
    }
    root = gfMultiply(root, 0x02);
  }
  return result;
}

/** The error correction codewords for a block of data codewords. */
export function reedSolomon(data: readonly number[], degree: number): number[] {
  const divisor = rsDivisor(degree);
  const result = new Array<number>(degree).fill(0);
  for (const b of data) {
    const factor = b ^ (result.shift() ?? 0);
    result.push(0);
    divisor.forEach((d, i) => {
      result[i] = (result[i] ?? 0) ^ gfMultiply(d, factor);
    });
  }
  return result;
}

// ---------------------------------------------------------------------------
// Codewords

/** The data codewords for `bytes` in byte mode, padded to the version. */
export function dataFor(bytes: Uint8Array, version: number): number[] {
  const bits: number[] = [];
  const push = (value: number, length: number) => {
    for (let i = length - 1; i >= 0; i--) bits.push((value >>> i) & 1);
  };
  push(0b0100, 4);
  push(bytes.length, version <= 9 ? 8 : 16);
  for (const b of bytes) push(b, 8);
  const capacity = dataCodewords(version) * 8;
  push(0, Math.min(4, capacity - bits.length));
  push(0, (8 - (bits.length % 8)) % 8);
  for (let pad = 0xec; bits.length < capacity; pad ^= 0xec ^ 0x11) push(pad, 8);
  const words: number[] = [];
  for (let i = 0; i < bits.length; i += 8)
    words.push(bits.slice(i, i + 8).reduce((acc, bit) => (acc << 1) | bit, 0));
  return words;
}

/** Splits the data into blocks, adds error correction and interleaves. */
function withErrorCorrection(data: readonly number[], version: number) {
  const blocks = BLOCKS[version] ?? 1;
  const eccLength = ECC_PER_BLOCK[version] ?? 0;
  const raw = Math.floor(rawDataModules(version) / 8);
  const shortBlocks = blocks - (raw % blocks);
  const shortLength = Math.floor(raw / blocks);
  const all: number[][] = [];
  for (let i = 0, k = 0; i < blocks; i++) {
    const length = shortLength - eccLength + (i < shortBlocks ? 0 : 1);
    const block = data.slice(k, k + length);
    k += length;
    const ecc = reedSolomon(block, eccLength);
    // Short blocks get a placeholder so every block lines up when interleaved.
    if (i < shortBlocks) block.push(-1);
    all.push([...block, ...ecc]);
  }
  const result: number[] = [];
  for (let i = 0; i < (all[0]?.length ?? 0); i++)
    for (const block of all) {
      const word = block[i];
      if (word !== undefined && word >= 0) result.push(word);
    }
  return result;
}

// ---------------------------------------------------------------------------
// The matrix

class Grid {
  readonly version: number;
  readonly size: number;
  readonly dark: boolean[][];
  readonly fixed: boolean[][];

  constructor(version: number) {
    this.version = version;
    this.size = version * 4 + 17;
    this.dark = Array.from({ length: this.size }, () =>
      new Array<boolean>(this.size).fill(false),
    );
    this.fixed = Array.from({ length: this.size }, () =>
      new Array<boolean>(this.size).fill(false),
    );
  }

  set(x: number, y: number, dark: boolean) {
    const row = this.dark[y];
    const fixed = this.fixed[y];
    if (!row || !fixed || x < 0 || x >= this.size) return;
    row[x] = dark;
    fixed[x] = true;
  }
}

/** Centers of the alignment patterns along each axis. */
export function alignmentPositions(version: number): number[] {
  if (version === 1) return [];
  const count = Math.floor(version / 7) + 2;
  const step = Math.ceil((version * 4 + 4) / (count * 2 - 2)) * 2;
  const result = [6];
  for (let pos = version * 4 + 10; result.length < count; pos -= step)
    result.splice(1, 0, pos);
  return result;
}

/** The 15 format bits for level M and a mask, with their error correction. */
export function formatBits(mask: number): number {
  const data = (LEVEL_M << 3) | mask;
  let rem = data;
  for (let i = 0; i < 10; i++) rem = (rem << 1) ^ ((rem >>> 9) * 0x537);
  return ((data << 10) | rem) ^ 0x5412;
}

function drawFormat(grid: Grid, mask: number) {
  const bits = formatBits(mask);
  const bit = (i: number) => ((bits >>> i) & 1) !== 0;
  const n = grid.size;
  for (let i = 0; i <= 5; i++) grid.set(8, i, bit(i));
  grid.set(8, 7, bit(6));
  grid.set(8, 8, bit(7));
  grid.set(7, 8, bit(8));
  for (let i = 9; i < 15; i++) grid.set(14 - i, 8, bit(i));
  for (let i = 0; i < 8; i++) grid.set(n - 1 - i, 8, bit(i));
  for (let i = 8; i < 15; i++) grid.set(8, n - 15 + i, bit(i));
  grid.set(8, n - 8, true);
}

function drawVersion(grid: Grid) {
  if (grid.version < 7) return;
  let rem = grid.version;
  for (let i = 0; i < 12; i++) rem = (rem << 1) ^ ((rem >>> 11) * 0x1f25);
  const bits = (grid.version << 12) | rem;
  for (let i = 0; i < 18; i++) {
    const dark = ((bits >>> i) & 1) !== 0;
    const a = grid.size - 11 + (i % 3);
    const b = Math.floor(i / 3);
    grid.set(a, b, dark);
    grid.set(b, a, dark);
  }
}

function drawPatterns(grid: Grid) {
  const n = grid.size;
  for (let i = 0; i < n; i++) {
    grid.set(6, i, i % 2 === 0);
    grid.set(i, 6, i % 2 === 0);
  }
  for (const [cx, cy] of [
    [3, 3],
    [n - 4, 3],
    [3, n - 4],
  ] as const)
    for (let dy = -4; dy <= 4; dy++)
      for (let dx = -4; dx <= 4; dx++) {
        const d = Math.max(Math.abs(dx), Math.abs(dy));
        grid.set(cx + dx, cy + dy, d !== 2 && d !== 4);
      }
  const align = alignmentPositions(grid.version);
  const last = align.length - 1;
  align.forEach((ax, i) =>
    align.forEach((ay, j) => {
      // The three corners with a finder pattern get no alignment pattern.
      if ((i === 0 && (j === 0 || j === last)) || (i === last && j === 0))
        return;
      for (let dy = -2; dy <= 2; dy++)
        for (let dx = -2; dx <= 2; dx++)
          grid.set(
            ax + dx,
            ay + dy,
            Math.max(Math.abs(dx), Math.abs(dy)) !== 1,
          );
    }),
  );
  drawFormat(grid, 0);
  drawVersion(grid);
}

function drawCodewords(grid: Grid, words: readonly number[]) {
  const n = grid.size;
  let i = 0;
  for (let right = n - 1; right >= 1; right -= 2) {
    if (right === 6) right = 5;
    const upward = ((right + 1) & 2) === 0;
    for (let vert = 0; vert < n; vert++)
      for (let j = 0; j < 2; j++) {
        const x = right - j;
        const y = upward ? n - 1 - vert : vert;
        const row = grid.dark[y];
        if (!row || grid.fixed[y]?.[x] || i >= words.length * 8) continue;
        row[x] = (((words[i >>> 3] ?? 0) >>> (7 - (i & 7))) & 1) !== 0;
        i++;
      }
  }
}

const MASKS: readonly ((x: number, y: number) => boolean)[] = [
  (x, y) => (x + y) % 2 === 0,
  (_x, y) => y % 2 === 0,
  (x) => x % 3 === 0,
  (x, y) => (x + y) % 3 === 0,
  (x, y) => (Math.floor(x / 3) + Math.floor(y / 2)) % 2 === 0,
  (x, y) => ((x * y) % 2) + ((x * y) % 3) === 0,
  (x, y) => (((x * y) % 2) + ((x * y) % 3)) % 2 === 0,
  (x, y) => (((x + y) % 2) + ((x * y) % 3)) % 2 === 0,
];

function applyMask(grid: Grid, mask: number) {
  const flip = MASKS[mask];
  if (!flip) return;
  grid.dark.forEach((row, y) =>
    row.forEach((dark, x) => {
      if (!grid.fixed[y]?.[x] && flip(x, y)) row[x] = !dark;
    }),
  );
}

const FINDER_LIKE = [1, 0, 1, 1, 1, 0, 1, 0, 0, 0, 0];
const FINDER_LIKE_BACK = [...FINDER_LIKE].reverse();

/** The standard's penalty for a masked matrix; lower scans better. */
export function penalty(matrix: QrMatrix): number {
  const n = matrix.length;
  const at = (x: number, y: number) => matrix[y]?.[x] ?? false;
  let score = 0;
  const lines: boolean[][] = [];
  for (let i = 0; i < n; i++) {
    lines.push([...(matrix[i] ?? [])]);
    lines.push(Array.from({ length: n }, (_, k) => at(i, k)));
  }
  for (const line of lines) {
    // Runs of five or more modules of one color.
    let run = 1;
    for (let k = 1; k <= n; k++) {
      if (k < n && line[k] === line[k - 1]) run++;
      else {
        if (run >= 5) score += run - 2;
        run = 1;
      }
    }
    // Patterns that look like a finder pattern.
    const bits = line.map((d) => (d ? 1 : 0));
    for (let k = 0; k + FINDER_LIKE.length <= n; k++) {
      const window = bits.slice(k, k + FINDER_LIKE.length);
      if (
        window.every((b, m) => b === FINDER_LIKE[m]) ||
        window.every((b, m) => b === FINDER_LIKE_BACK[m])
      )
        score += 40;
    }
  }
  // Two-by-two blocks of one color.
  for (let y = 0; y < n - 1; y++)
    for (let x = 0; x < n - 1; x++) {
      const c = at(x, y);
      if (c === at(x + 1, y) && c === at(x, y + 1) && c === at(x + 1, y + 1))
        score += 3;
    }
  // Far from half dark.
  const dark = matrix.reduce((acc, row) => acc + row.filter(Boolean).length, 0);
  const total = n * n;
  score += (Math.ceil(Math.abs(dark * 20 - total * 10) / total) - 1) * 10;
  return score;
}

/**
 * The QR code for `text` (UTF-8): the smallest version that holds it, with
 * the mask that scores best. Throws for text longer than version 10 holds.
 */
export function qrMatrix(text: string): QrMatrix {
  const bytes = new TextEncoder().encode(text);
  let version = 1;
  // Mode (4 bits) and length (8 or 16 bits) come before the bytes.
  while (
    version <= MAX_VERSION &&
    4 + (version <= 9 ? 8 : 16) + bytes.length * 8 > dataCodewords(version) * 8
  )
    version++;
  if (version > MAX_VERSION) throw new Error("Text too long for a QR code");
  const words = withErrorCorrection(dataFor(bytes, version), version);
  let best: { matrix: boolean[][]; score: number } | null = null;
  for (let mask = 0; mask < MASKS.length; mask++) {
    const grid = new Grid(version);
    drawPatterns(grid);
    drawCodewords(grid, words);
    applyMask(grid, mask);
    drawFormat(grid, mask);
    const score = penalty(grid.dark);
    if (!best || score < best.score) best = { matrix: grid.dark, score };
  }
  return best?.matrix ?? [];
}

/**
 * The code as one SVG path, a square per dark module, with the standard's
 * four-module quiet zone included in the view box.
 */
export function qrSvgPath(matrix: QrMatrix): {
  path: string;
  viewBox: string;
} {
  const parts: string[] = [];
  matrix.forEach((row, y) =>
    row.forEach((dark, x) => {
      if (dark) parts.push(`M${x + 4} ${y + 4}h1v1h-1z`);
    }),
  );
  const side = matrix.length + 8;
  return { path: parts.join(""), viewBox: `0 0 ${side} ${side}` };
}
