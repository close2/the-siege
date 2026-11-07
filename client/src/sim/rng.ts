// Deterministic PRNG (sfc32) seeded from strings. No Math.random anywhere in sim/.

export function fnv1a(str: string, salt = 0): number {
  let h = (0x811c9dc5 ^ salt) >>> 0;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

export class Rng {
  private a: number;
  private b: number;
  private c: number;
  private d: number;

  constructor(seed: string) {
    this.a = fnv1a(seed, 0x9e3779b9);
    this.b = fnv1a(seed, 0x243f6a88);
    this.c = fnv1a(seed, 0xb7e15162);
    this.d = fnv1a(seed, 0x6a09e667);
    for (let i = 0; i < 12; i++) this.next();
  }

  /** uint32 */
  next(): number {
    const t0 = (this.a + this.b) | 0;
    this.a = this.b ^ (this.b >>> 9);
    this.b = (this.c + (this.c << 3)) | 0;
    this.c = (this.c << 21) | (this.c >>> 11);
    this.d = (this.d + 1) | 0;
    const t = (t0 + this.d) | 0;
    this.c = (this.c + t) | 0;
    return t >>> 0;
  }

  /** [0, 1) */
  float(): number {
    return this.next() / 4294967296;
  }

  /** integer in [0, n) */
  int(n: number): number {
    return Math.floor(this.float() * n);
  }

  /** integer in [min, max] */
  range(min: number, max: number): number {
    return min + this.int(max - min + 1);
  }

  pick<T>(arr: readonly T[]): T {
    return arr[this.int(arr.length)];
  }
}

export function rngFor(...parts: (string | number)[]): Rng {
  return new Rng(parts.join('|'));
}
