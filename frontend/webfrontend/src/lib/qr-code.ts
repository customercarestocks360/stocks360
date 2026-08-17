/**
 * Minimal QR Code (model 2) encoder — byte mode, error-correction level M,
 * versions 1–10. Written in-repo rather than pulled in as a dependency because
 * the only thing the app needs is "turn this deposit address into a scannable
 * matrix"; `qrMatrix` returns the module grid and the caller draws it.
 */

const EC_LEVEL_M_BITS = 0b00;

/** [ecCodewordsPerBlock, group1Blocks, group1DataCodewords, group2Blocks, group2DataCodewords] */
const EC_TABLE_M: Record<number, [number, number, number, number, number]> = {
  1: [10, 1, 16, 0, 0],
  2: [16, 1, 28, 0, 0],
  3: [26, 1, 44, 0, 0],
  4: [18, 2, 32, 0, 0],
  5: [24, 2, 43, 0, 0],
  6: [16, 4, 27, 0, 0],
  7: [18, 4, 31, 0, 0],
  8: [22, 2, 38, 2, 39],
  9: [22, 3, 36, 2, 37],
  10: [26, 4, 43, 1, 44],
};

/** Byte-mode payload capacity in bytes, per version, at EC level M. */
const BYTE_CAPACITY_M: Record<number, number> = {
  1: 14, 2: 26, 3: 42, 4: 62, 5: 84, 6: 106, 7: 122, 8: 152, 9: 180, 10: 213,
};

/** Row/column centres of the alignment patterns for each version. */
const ALIGNMENT_CENTERS: Record<number, number[]> = {
  1: [],
  2: [6, 18],
  3: [6, 22],
  4: [6, 26],
  5: [6, 30],
  6: [6, 34],
  7: [6, 22, 38],
  8: [6, 24, 42],
  9: [6, 26, 46],
  10: [6, 28, 50],
};

// ── GF(256) arithmetic, primitive polynomial 0x11D ──────────────────────────
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
  for (let i = 255; i < 512; i++) EXP[i] = EXP[i - 255]!;
}

function gfMul(a: number, b: number) {
  if (a === 0 || b === 0) return 0;
  return EXP[LOG[a]! + LOG[b]!]!;
}

/** Reed–Solomon generator polynomial of the given degree. */
function rsGenerator(degree: number) {
  let poly = [1];
  for (let i = 0; i < degree; i++) {
    const next = new Array<number>(poly.length + 1).fill(0);
    // Multiply by (x + α^i), coefficients ordered highest-degree first.
    for (let j = 0; j < poly.length; j++) {
      next[j] = next[j]! ^ poly[j]!;
      next[j + 1] = next[j + 1]! ^ gfMul(poly[j]!, EXP[i]!);
    }
    poly = next;
  }
  return poly;
}

function rsEncode(data: number[], ecLength: number) {
  const gen = rsGenerator(ecLength);
  const remainder = new Array<number>(ecLength).fill(0);
  for (const byte of data) {
    const factor = byte ^ remainder[0]!;
    remainder.shift();
    remainder.push(0);
    for (let i = 0; i < ecLength; i++) {
      remainder[i] = remainder[i]! ^ gfMul(gen[i + 1]!, factor);
    }
  }
  return remainder;
}

// ── Bit buffer ──────────────────────────────────────────────────────────────
class BitBuffer {
  bits: number[] = [];
  put(value: number, length: number) {
    for (let i = length - 1; i >= 0; i--) this.bits.push((value >>> i) & 1);
  }
  get length() {
    return this.bits.length;
  }
}

function pickVersion(byteLength: number) {
  for (let v = 1; v <= 10; v++) {
    if (byteLength <= BYTE_CAPACITY_M[v]!) return v;
  }
  throw new Error(`qrMatrix: ${byteLength} bytes exceeds the supported capacity (version 10, EC level M)`);
}

/** Mode indicator + character count + payload, padded to the version's capacity. */
function buildCodewords(bytes: number[], version: number) {
  const [ecPerBlock, g1Blocks, g1Data, g2Blocks, g2Data] = EC_TABLE_M[version]!;
  const totalDataCodewords = g1Blocks * g1Data + g2Blocks * g2Data;

  const buf = new BitBuffer();
  buf.put(0b0100, 4); // byte mode
  buf.put(bytes.length, version >= 10 ? 16 : 8);
  for (const b of bytes) buf.put(b, 8);

  const capacityBits = totalDataCodewords * 8;
  buf.put(0, Math.min(4, capacityBits - buf.length)); // terminator
  while (buf.length % 8 !== 0) buf.bits.push(0);

  const codewords: number[] = [];
  for (let i = 0; i < buf.length; i += 8) {
    let byte = 0;
    for (let j = 0; j < 8; j++) byte = (byte << 1) | buf.bits[i + j]!;
    codewords.push(byte);
  }
  const PAD = [0xec, 0x11];
  for (let i = 0; codewords.length < totalDataCodewords; i++) codewords.push(PAD[i % 2]!);

  // Split into blocks, compute EC per block, then interleave both sets.
  const dataBlocks: number[][] = [];
  const ecBlocks: number[][] = [];
  let offset = 0;
  for (let i = 0; i < g1Blocks + g2Blocks; i++) {
    const size = i < g1Blocks ? g1Data : g2Data;
    const block = codewords.slice(offset, offset + size);
    offset += size;
    dataBlocks.push(block);
    ecBlocks.push(rsEncode(block, ecPerBlock));
  }

  const out: number[] = [];
  const maxData = Math.max(g1Data, g2Data);
  for (let i = 0; i < maxData; i++) {
    for (const block of dataBlocks) if (i < block.length) out.push(block[i]!);
  }
  for (let i = 0; i < ecPerBlock; i++) {
    for (const block of ecBlocks) out.push(block[i]!);
  }
  return out;
}

type Grid = (boolean | null)[][];

function placeFunctionPatterns(grid: Grid, size: number, version: number) {
  const setFinder = (row: number, col: number) => {
    for (let r = -1; r <= 7; r++) {
      for (let c = -1; c <= 7; c++) {
        const rr = row + r;
        const cc = col + c;
        if (rr < 0 || rr >= size || cc < 0 || cc >= size) continue;
        const onRing = (r >= 0 && r <= 6 && (c === 0 || c === 6)) || (c >= 0 && c <= 6 && (r === 0 || r === 6));
        const inCore = r >= 2 && r <= 4 && c >= 2 && c <= 4;
        grid[rr]![cc] = onRing || inCore;
      }
    }
  };
  setFinder(0, 0);
  setFinder(0, size - 7);
  setFinder(size - 7, 0);

  // Timing patterns
  for (let i = 8; i < size - 8; i++) {
    grid[6]![i] = i % 2 === 0;
    grid[i]![6] = i % 2 === 0;
  }

  // Alignment patterns — skipped where they would collide with a finder.
  const centers = ALIGNMENT_CENTERS[version]!;
  for (const r of centers) {
    for (const c of centers) {
      const nearFinder =
        (r === 6 && c === 6) || (r === 6 && c === size - 7) || (r === size - 7 && c === 6);
      if (nearFinder) continue;
      for (let dr = -2; dr <= 2; dr++) {
        for (let dc = -2; dc <= 2; dc++) {
          grid[r + dr]![c + dc] = Math.max(Math.abs(dr), Math.abs(dc)) !== 1;
        }
      }
    }
  }

  grid[size - 8]![8] = true; // the always-dark module
}

function reserveInfoAreas(grid: Grid, size: number, version: number) {
  for (let i = 0; i < 9; i++) {
    if (grid[8]![i] === null) grid[8]![i] = false;
    if (grid[i]![8] === null) grid[i]![8] = false;
  }
  for (let i = 0; i < 8; i++) {
    if (grid[8]![size - 1 - i] === null) grid[8]![size - 1 - i] = false;
    if (grid[size - 1 - i]![8] === null) grid[size - 1 - i]![8] = false;
  }
  if (version >= 7) {
    for (let i = 0; i < 6; i++) {
      for (let j = 0; j < 3; j++) {
        grid[size - 11 + j]![i] = false;
        grid[i]![size - 11 + j] = false;
      }
    }
  }
}

function maskBit(mask: number, row: number, col: number) {
  switch (mask) {
    case 0: return (row + col) % 2 === 0;
    case 1: return row % 2 === 0;
    case 2: return col % 3 === 0;
    case 3: return (row + col) % 3 === 0;
    case 4: return (Math.floor(row / 2) + Math.floor(col / 3)) % 2 === 0;
    case 5: return ((row * col) % 2) + ((row * col) % 3) === 0;
    case 6: return (((row * col) % 2) + ((row * col) % 3)) % 2 === 0;
    default: return (((row + col) % 2) + ((row * col) % 3)) % 2 === 0;
  }
}

function penalty(m: boolean[][], size: number) {
  let score = 0;

  // Rule 1 — runs of five or more identical modules.
  const scanRuns = (get: (a: number, b: number) => boolean) => {
    for (let a = 0; a < size; a++) {
      let run = 1;
      for (let b = 1; b < size; b++) {
        if (get(a, b) === get(a, b - 1)) {
          run++;
        } else {
          if (run >= 5) score += 3 + (run - 5);
          run = 1;
        }
      }
      if (run >= 5) score += 3 + (run - 5);
    }
  };
  scanRuns((r, c) => m[r]![c]!);
  scanRuns((c, r) => m[r]![c]!);

  // Rule 2 — 2×2 blocks of one colour.
  for (let r = 0; r < size - 1; r++) {
    for (let c = 0; c < size - 1; c++) {
      const v = m[r]![c]!;
      if (v === m[r]![c + 1] && v === m[r + 1]![c] && v === m[r + 1]![c + 1]) score += 3;
    }
  }

  // Rule 3 — finder-like 1:1:3:1:1 sequences.
  const A = [true, false, true, true, true, false, true, false, false, false, false];
  const B = [false, false, false, false, true, false, true, true, true, false, true];
  const matches = (get: (i: number) => boolean, start: number, pat: boolean[]) => {
    for (let i = 0; i < pat.length; i++) if (get(start + i) !== pat[i]) return false;
    return true;
  };
  for (let a = 0; a < size; a++) {
    for (let b = 0; b + 11 <= size; b++) {
      const row = (i: number) => m[a]![i]!;
      const col = (i: number) => m[i]![a]!;
      if (matches(row, b, A) || matches(row, b, B)) score += 40;
      if (matches(col, b, A) || matches(col, b, B)) score += 40;
    }
  }

  // Rule 4 — deviation from a 50% dark ratio.
  let dark = 0;
  for (let r = 0; r < size; r++) for (let c = 0; c < size; c++) if (m[r]![c]) dark++;
  const percent = (dark * 100) / (size * size);
  score += Math.floor(Math.abs(percent - 50) / 5) * 10;

  return score;
}

/** BCH(15,5) format information, already XOR-masked. */
function formatBits(mask: number) {
  const data = (EC_LEVEL_M_BITS << 3) | mask;
  let rem = data << 10;
  for (let i = 14; i >= 10; i--) {
    if ((rem >>> i) & 1) rem ^= 0b10100110111 << (i - 10);
  }
  return ((data << 10) | rem) ^ 0b101010000010010;
}

/** BCH(18,6) version information, for versions 7 and up. */
function versionBits(version: number) {
  let rem = version << 12;
  for (let i = 17; i >= 12; i--) {
    if ((rem >>> i) & 1) rem ^= 0b1111100100101 << (i - 12);
  }
  return (version << 12) | rem;
}

/**
 * Encodes `text` and returns the finished module grid (true = dark). The grid
 * has no quiet zone; add one when rendering.
 */
export function qrMatrix(text: string): boolean[][] {
  const bytes = [...new TextEncoder().encode(text)];
  const version = pickVersion(bytes.length);
  const size = version * 4 + 17;
  const codewords = buildCodewords(bytes, version);

  const grid: Grid = Array.from({ length: size }, () => new Array<boolean | null>(size).fill(null));
  placeFunctionPatterns(grid, size, version);

  // Snapshot which modules are functional before the info areas get reserved,
  // so masking can later be applied to exactly the data modules.
  const isFunction = grid.map((row) => row.map((v) => v !== null));
  reserveInfoAreas(grid, size, version);
  const isReserved = grid.map((row) => row.map((v) => v !== null));

  // Zigzag placement, bottom-right upward, skipping the vertical timing column.
  let bitIndex = 0;
  const nextBit = () => {
    const byte = codewords[bitIndex >> 3];
    const bit = byte === undefined ? 0 : (byte >> (7 - (bitIndex & 7))) & 1;
    bitIndex++;
    return bit === 1;
  };
  let upward = true;
  for (let right = size - 1; right >= 1; right -= 2) {
    if (right === 6) right = 5;
    for (let i = 0; i < size; i++) {
      const row = upward ? size - 1 - i : i;
      for (let j = 0; j < 2; j++) {
        const col = right - j;
        if (isReserved[row]![col]) continue;
        grid[row]![col] = nextBit();
      }
    }
    upward = !upward;
  }

  // Try every mask, keep the lowest-penalty result.
  let best: boolean[][] | null = null;
  let bestMask = 0;
  let bestScore = Infinity;
  for (let mask = 0; mask < 8; mask++) {
    const candidate = grid.map((row, r) =>
      row.map((v, c) => (isFunction[r]![c] ? v === true : (v === true) !== maskBit(mask, r, c))),
    );
    applyFormat(candidate, size, mask);
    if (version >= 7) applyVersion(candidate, size, version);
    const score = penalty(candidate, size);
    if (score < bestScore) {
      bestScore = score;
      bestMask = mask;
      best = candidate;
    }
  }
  void bestMask;
  return best!;
}

function applyFormat(m: boolean[][], size: number, mask: number) {
  const bits = formatBits(mask);
  const bit = (i: number) => ((bits >> i) & 1) === 1;
  // Copy 1 wraps the top-left finder, reading MSB-first along the row (skipping
  // the timing column at index 6) and then up the column.
  for (let i = 0; i <= 5; i++) m[8]![i] = bit(14 - i);
  m[8]![7] = bit(8);
  m[8]![8] = bit(7);
  m[7]![8] = bit(6);
  for (let i = 9; i <= 14; i++) m[14 - i]![8] = bit(14 - i);

  // Copy 2 splits the other way round: the low 8 bits run right-to-left along
  // the top-right, the high 7 run bottom-to-top along the bottom-left.
  for (let i = 0; i <= 7; i++) m[8]![size - 1 - i] = bit(i);
  for (let i = 8; i <= 14; i++) m[size - 15 + i]![8] = bit(i);
  m[size - 8]![8] = true;
}

function applyVersion(m: boolean[][], size: number, version: number) {
  const bits = versionBits(version);
  for (let i = 0; i < 18; i++) {
    const on = ((bits >> i) & 1) === 1;
    const a = Math.floor(i / 3);
    const b = (i % 3) + size - 11;
    m[a]![b] = on;
    m[b]![a] = on;
  }
}
