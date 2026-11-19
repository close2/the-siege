import { describe, expect, it } from 'vitest';
import { encodeQr, rsEncode } from '../qr';

/** Verifies BCH(15, 5) format info checksum after removing the 0x5412 mask. */
function decodeFormatBits(raw15: number): { ecBits: number; mask: number; syndrome: number } {
  const unmasked = raw15 ^ 0x5412;
  let rem = unmasked;
  for (let i = 14; i >= 10; i--) {
    if (rem & (1 << i)) rem ^= 0x537 << (i - 10);
  }
  return {
    ecBits: (unmasked >>> 13) & 0b11,
    mask: (unmasked >>> 10) & 0b111,
    syndrome: rem,
  };
}

describe('QR Code encoder (ISO/IEC 18004)', () => {
  it('computes exact Reed-Solomon EC codewords for ISO/IEC 18004 Version 1-M reference vector', () => {
    // Standard QR spec Version 1-M ("HELLO WORLD" alphanumeric): 16 data codewords -> 10 EC codewords
    const data = new Uint8Array([32, 91, 11, 120, 209, 114, 220, 77, 67, 64, 236, 17, 236, 17, 236, 17]);
    const expectedEc = [196, 35, 39, 119, 235, 215, 231, 226, 93, 23];
    expect([...rsEncode(data, 10)]).toEqual(expectedEc);
  });

  it('produces valid finder, timing, dark module, and matching BCH format info across versions 1–6', () => {
    const samples = [
      'ABCD1234', // Version 1 (21x21)
      'https://siege.app/link#ABCD1234', // Version 2 (25x25)
      'https://siege.example.org/link#ABCD1234', // Version 3 (29x29)
      'https://a-very-long-selfhosted-domain.example.org/app/link#ABCD1234', // Version 4 (33x33)
      'https://example.org/link#' + 'A'.repeat(95), // Version 6 (41x41, 2 interleaved RS blocks)
    ];
    for (const payload of samples) {
      const qr = encodeQr(payload);
      const at = (r: number, c: number) => qr.modules[r * qr.size + c];

      expect(qr.size).toBe(17 + 4 * qr.version);
      expect(qr.modules).toHaveLength(qr.size * qr.size);

      // 3 finder corners: outer ring dark, 3x3 center dark
      for (const [r0, c0] of [
        [0, 0],
        [0, qr.size - 7],
        [qr.size - 7, 0],
      ]) {
        expect(at(r0, c0)).toBe(true);
        expect(at(r0 + 3, c0 + 3)).toBe(true);
        expect(at(r0 + 1, c0 + 1)).toBe(false);
      }

      // Dark module at (4*version + 9, 8)
      expect(at(4 * qr.version + 9, 8)).toBe(true);

      // Timing patterns alternate on row 6 and col 6
      for (let i = 8; i < qr.size - 8; i++) {
        expect(at(6, i)).toBe(i % 2 === 0);
        expect(at(i, 6)).toBe(i % 2 === 0);
      }

      // Extract BOTH format info copies and verify they match + have zero BCH syndrome + EC Level L (01)
      const h1 = [0, 1, 2, 3, 4, 5, 7, 8];
      const v1 = [7, 5, 4, 3, 2, 1, 0];
      let fmt1 = 0;
      for (const c of h1) fmt1 = (fmt1 << 1) | (at(8, c) ? 1 : 0);
      for (const r of v1) fmt1 = (fmt1 << 1) | (at(r, 8) ? 1 : 0);

      let fmt2 = 0;
      for (let i = 0; i < 7; i++) fmt2 = (fmt2 << 1) | (at(qr.size - 1 - i, 8) ? 1 : 0);
      for (let i = 0; i < 8; i++) fmt2 = (fmt2 << 1) | (at(8, qr.size - 8 + i) ? 1 : 0);

      expect(fmt1).toBe(fmt2);
      const decoded = decodeFormatBits(fmt1);
      expect(decoded.syndrome).toBe(0);
      expect(decoded.ecBits).toBe(0b01); // EC Level L
    }
  });

  it('rejects payloads exceeding Version 6 capacity', () => {
    expect(() => encodeQr('X'.repeat(200))).toThrow();
  });
});
