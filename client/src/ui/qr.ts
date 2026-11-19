// Minimal ISO/IEC 18004 QR Code encoder (Byte mode, Error Correction Level L, Versions 1–6).
// Zero external dependencies; encodes up to 134 UTF-8 bytes (more than enough for pairing URLs).

const GF_EXP = new Uint8Array(512);
const GF_LOG = new Uint8Array(256);
(() => {
  let x = 1;
  for (let i = 0; i < 255; i++) {
    GF_EXP[i] = x;
    GF_LOG[x] = i;
    x <<= 1;
    if (x & 0x100) x ^= 0x11d;
  }
  for (let i = 255; i < 512; i++) GF_EXP[i] = GF_EXP[i - 255];
})();

function gfMul(a: number, b: number): number {
  return a === 0 || b === 0 ? 0 : GF_EXP[GF_LOG[a] + GF_LOG[b]];
}

function rsGenerator(degree: number): Uint8Array {
  let poly: Uint8Array = new Uint8Array([1]);
  for (let i = 0; i < degree; i++) {
    const next = new Uint8Array(poly.length + 1);
    const factor = GF_EXP[i];
    for (let j = 0; j < poly.length; j++) {
      next[j] ^= poly[j];
      next[j + 1] ^= gfMul(poly[j], factor);
    }
    poly = next;
  }
  return poly;
}

export function rsEncode(data: Uint8Array, ecCount: number): Uint8Array {
  const gen = rsGenerator(ecCount);
  const rem = new Uint8Array(ecCount);
  for (let i = 0; i < data.length; i++) {
    const factor = data[i] ^ rem[0];
    rem.copyWithin(0, 1);
    rem[ecCount - 1] = 0;
    if (factor !== 0) {
      for (let j = 0; j < ecCount; j++) {
        rem[j] ^= gfMul(gen[j + 1], factor);
      }
    }
  }
  return rem;
}

interface VersionSpec {
  version: number;
  size: number;
  blocks: number;
  dataPerBlock: number;
  ecPerBlock: number;
  align: number[];
}

// EC Level L specifications for Versions 1–6 (ISO/IEC 18004 Table 9)
const VERSIONS: VersionSpec[] = [
  { version: 1, size: 21, blocks: 1, dataPerBlock: 19, ecPerBlock: 7, align: [] },
  { version: 2, size: 25, blocks: 1, dataPerBlock: 34, ecPerBlock: 10, align: [6, 18] },
  { version: 3, size: 29, blocks: 1, dataPerBlock: 55, ecPerBlock: 15, align: [6, 22] },
  { version: 4, size: 33, blocks: 1, dataPerBlock: 80, ecPerBlock: 20, align: [6, 26] },
  { version: 5, size: 37, blocks: 1, dataPerBlock: 108, ecPerBlock: 26, align: [6, 30] },
  { version: 6, size: 41, blocks: 2, dataPerBlock: 68, ecPerBlock: 18, align: [6, 34] },
];

export interface QrMatrix {
  version: number;
  size: number;
  /** Row-major boolean grid: true = dark module */
  modules: boolean[];
}

function buildCodewords(bytes: Uint8Array, spec: VersionSpec): Uint8Array {
  const totalData = spec.blocks * spec.dataPerBlock;
  const bits: number[] = [];
  const pushBits = (val: number, len: number) => {
    for (let i = len - 1; i >= 0; i--) bits.push((val >>> i) & 1);
  };
  // Byte mode (0100), 8-bit length (valid for versions 1–9)
  pushBits(0b0100, 4);
  pushBits(bytes.length, 8);
  for (const b of bytes) pushBits(b, 8);

  const capBits = totalData * 8;
  const term = Math.min(4, capBits - bits.length);
  for (let i = 0; i < term; i++) bits.push(0);
  while (bits.length % 8 !== 0) bits.push(0);

  const data = new Uint8Array(totalData);
  let byteIdx = 0;
  for (let i = 0; i < bits.length; i += 8) {
    let v = 0;
    for (let j = 0; j < 8; j++) v = (v << 1) | bits[i + j];
    data[byteIdx++] = v;
  }
  const pad = [0xec, 0x11];
  let padIdx = 0;
  while (byteIdx < totalData) {
    data[byteIdx++] = pad[padIdx++ & 1];
  }

  // Split into RS blocks & interleave data then EC codewords
  const dataBlocks: Uint8Array[] = [];
  const ecBlocks: Uint8Array[] = [];
  for (let b = 0; b < spec.blocks; b++) {
    const slice = data.subarray(b * spec.dataPerBlock, (b + 1) * spec.dataPerBlock);
    dataBlocks.push(slice);
    ecBlocks.push(rsEncode(slice, spec.ecPerBlock));
  }

  const out = new Uint8Array(totalData + spec.blocks * spec.ecPerBlock);
  let pos = 0;
  for (let i = 0; i < spec.dataPerBlock; i++) {
    for (let b = 0; b < spec.blocks; b++) out[pos++] = dataBlocks[b][i];
  }
  for (let i = 0; i < spec.ecPerBlock; i++) {
    for (let b = 0; b < spec.blocks; b++) out[pos++] = ecBlocks[b][i];
  }
  return out;
}

function formatBits(mask: number): number {
  // EC Level L = 01
  const data = (0b01 << 3) | (mask & 7);
  let rem = data << 10;
  for (let i = 14; i >= 10; i--) {
    if (rem & (1 << i)) rem ^= 0x537 << (i - 10);
  }
  return ((data << 10) | rem) ^ 0x5412;
}

function maskBit(mask: number, r: number, c: number): boolean {
  switch (mask) {
    case 0:
      return (r + c) % 2 === 0;
    case 1:
      return r % 2 === 0;
    case 2:
      return c % 3 === 0;
    case 3:
      return (r + c) % 3 === 0;
    case 4:
      return (Math.floor(r / 2) + Math.floor(c / 3)) % 2 === 0;
    case 5:
      return ((r * c) % 2) + ((r * c) % 3) === 0;
    case 6:
      return (((r * c) % 2) + ((r * c) % 3)) % 2 === 0;
    default:
      return (((r + c) % 2) + ((r * c) % 3)) % 2 === 0;
  }
}

function penaltyScore(grid: boolean[], size: number): number {
  let score = 0;
  const at = (r: number, c: number) => grid[r * size + c];

  // Rule 1: 5+ consecutive same-color modules in row/col
  for (let r = 0; r < size; r++) {
    let runH = 1;
    let runV = 1;
    for (let i = 1; i < size; i++) {
      if (at(r, i) === at(r, i - 1)) runH++;
      else {
        if (runH >= 5) score += 3 + (runH - 5);
        runH = 1;
      }
      if (at(i, r) === at(i - 1, r)) runV++;
      else {
        if (runV >= 5) score += 3 + (runV - 5);
        runV = 1;
      }
    }
    if (runH >= 5) score += 3 + (runH - 5);
    if (runV >= 5) score += 3 + (runV - 5);
  }

  // Rule 2: 2x2 blocks of same color
  for (let r = 0; r < size - 1; r++) {
    for (let c = 0; c < size - 1; c++) {
      const v = at(r, c);
      if (v === at(r, c + 1) && v === at(r + 1, c) && v === at(r + 1, c + 1)) score += 3;
    }
  }

  // Rule 3: finder-like 1:1:3:1:1 patterns
  const matchFinder = (arr: boolean[]) => {
    for (let i = 0; i <= arr.length - 11; i++) {
      const a =
        arr[i] &&
        !arr[i + 1] &&
        arr[i + 2] &&
        arr[i + 3] &&
        arr[i + 4] &&
        !arr[i + 5] &&
        arr[i + 6] &&
        !arr[i + 7] &&
        !arr[i + 8] &&
        !arr[i + 9] &&
        !arr[i + 10];
      const b =
        !arr[i] &&
        !arr[i + 1] &&
        !arr[i + 2] &&
        !arr[i + 3] &&
        arr[i + 4] &&
        !arr[i + 5] &&
        arr[i + 6] &&
        arr[i + 7] &&
        arr[i + 8] &&
        !arr[i + 9] &&
        arr[i + 10];
      if (a || b) score += 40;
    }
  };
  for (let i = 0; i < size; i++) {
    const row: boolean[] = [];
    const col: boolean[] = [];
    for (let j = 0; j < size; j++) {
      row.push(at(i, j));
      col.push(at(j, i));
    }
    matchFinder(row);
    matchFinder(col);
  }

  // Rule 4: dark/light balance
  let dark = 0;
  for (const m of grid) if (m) dark++;
  const pct = (dark * 100) / (size * size);
  const k = Math.floor(Math.abs(pct - 50) / 5);
  score += k * 10;
  return score;
}

export function encodeQr(text: string): QrMatrix {
  const bytes = new TextEncoder().encode(text);
  // 2 bytes overhead for mode (4b) + length (8b) + 4b terminator
  const spec = VERSIONS.find((v) => bytes.length <= v.blocks * v.dataPerBlock - 2);
  if (!spec) throw new Error('QR payload too long');

  const { size, version } = spec;
  const base = new Array<boolean>(size * size).fill(false);
  const fn = new Array<boolean>(size * size).fill(false);
  const setFn = (r: number, c: number, dark: boolean) => {
    if (r < 0 || c < 0 || r >= size || c >= size) return;
    base[r * size + c] = dark;
    fn[r * size + c] = true;
  };

  // Finder patterns + separators
  const drawFinder = (r0: number, c0: number) => {
    for (let dr = -1; dr <= 7; dr++) {
      for (let dc = -1; dc <= 7; dc++) {
        const r = r0 + dr;
        const c = c0 + dc;
        if (r < 0 || c < 0 || r >= size || c >= size) continue;
        const inside = dr >= 0 && dr <= 6 && dc >= 0 && dc <= 6;
        const border = dr === 0 || dr === 6 || dc === 0 || dc === 6;
        const center = dr >= 2 && dr <= 4 && dc >= 2 && dc <= 4;
        setFn(r, c, inside && (border || center));
      }
    }
  };
  drawFinder(0, 0);
  drawFinder(0, size - 7);
  drawFinder(size - 7, 0);

  // Alignment patterns
  for (const r0 of spec.align) {
    for (const c0 of spec.align) {
      if (fn[r0 * size + c0]) continue;
      for (let dr = -2; dr <= 2; dr++) {
        for (let dc = -2; dc <= 2; dc++) {
          const dark = Math.max(Math.abs(dr), Math.abs(dc)) !== 1;
          setFn(r0 + dr, c0 + dc, dark);
        }
      }
    }
  }

  // Timing patterns
  for (let i = 8; i < size - 8; i++) {
    setFn(6, i, i % 2 === 0);
    setFn(i, 6, i % 2 === 0);
  }

  // Dark module
  setFn(4 * version + 9, 8, true);

  // Reserve format info cells
  for (let i = 0; i < 9; i++) {
    if (!fn[8 * size + i]) setFn(8, i, false);
    if (!fn[i * size + 8]) setFn(i, 8, false);
  }
  for (let i = size - 8; i < size; i++) {
    if (!fn[8 * size + i]) setFn(8, i, false);
  }
  for (let i = size - 7; i < size; i++) {
    if (!fn[i * size + 8]) setFn(i, 8, false);
  }

  // Place data bits in zig-zag columns
  const codewords = buildCodewords(bytes, spec);
  let bitIdx = 0;
  let upward = true;
  for (let col = size - 1; col >= 1; col -= 2) {
    if (col === 6) col = 5;
    for (let step = 0; step < size; step++) {
      const r = upward ? size - 1 - step : step;
      for (let dc = 0; dc < 2; dc++) {
        const c = col - dc;
        if (fn[r * size + c]) continue;
        const bit = bitIdx < codewords.length * 8 ? (codewords[bitIdx >>> 3] >>> (7 - (bitIdx & 7))) & 1 : 0;
        bitIdx++;
        base[r * size + c] = bit === 1;
      }
    }
    upward = !upward;
  }

  const applyFormat = (grid: boolean[], mask: number) => {
    const bits = formatBits(mask);
    const bit = (i: number) => ((bits >>> i) & 1) === 1;
    const h1 = [0, 1, 2, 3, 4, 5, 7, 8];
    const v1 = [7, 5, 4, 3, 2, 1, 0];
    for (let i = 0; i < 8; i++) grid[8 * size + h1[i]] = bit(14 - i);
    for (let i = 0; i < 7; i++) grid[v1[i] * size + 8] = bit(6 - i);
    for (let i = 0; i < 7; i++) grid[(size - 1 - i) * size + 8] = bit(14 - i);
    for (let i = 0; i < 8; i++) grid[8 * size + (size - 8 + i)] = bit(7 - i);
  };

  let bestGrid = base;
  let bestScore = Infinity;
  for (let mask = 0; mask < 8; mask++) {
    const candidate = base.slice();
    for (let r = 0; r < size; r++) {
      for (let c = 0; c < size; c++) {
        if (!fn[r * size + c] && maskBit(mask, r, c)) {
          candidate[r * size + c] = !candidate[r * size + c];
        }
      }
    }
    applyFormat(candidate, mask);
    const sc = penaltyScore(candidate, size);
    if (sc < bestScore) {
      bestScore = sc;
      bestGrid = candidate;
    }
  }

  return { version, size, modules: bestGrid };
}
