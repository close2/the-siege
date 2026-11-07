import { describe, expect, it } from 'vitest';
import { baseGold, dayGold, heroLevel, heroStatus, incomeMultiplier, ratio, xpGain } from '../economy';
import { demoConfig } from '../fixtures';

describe('economy', () => {
  it('ratio for binary / checklist', () => {
    const c = demoConfig({ type: 'checklist', rules: ['a', 'b', 'c', 'd'] });
    expect(ratio(c, { kept: [true, true, false, false] })).toBe(0.5);
    expect(ratio(c, { kept: [true, true, true, true] })).toBe(1);
    expect(ratio(c, null)).toBeNull();
    expect(ratio(c, { value: 3 })).toBeNull();
  });

  it('ratio for numeric higher / lower', () => {
    const hi = demoConfig({ type: 'numeric', target: 8000, direction: 'higher', rules: [] });
    expect(ratio(hi, { value: 4000 })).toBe(0.5);
    expect(ratio(hi, { value: 80000 })).toBe(4);
    const lo = demoConfig({ type: 'numeric', target: 60, direction: 'lower', rules: [] });
    expect(ratio(lo, { value: 30 })).toBe(2);
    expect(ratio(lo, { value: 0 })).toBe(4);
    expect(ratio(lo, { value: 120 })).toBe(0.5);
  });

  it('gold table', () => {
    expect(baseGold(null)).toBe(0);
    expect(baseGold(0)).toBe(4);
    expect(baseGold(0.5)).toBe(7);
    expect(baseGold(1)).toBe(12);
    expect(baseGold(1.49)).toBe(12);
    expect(baseGold(1.5)).toBe(14);
    expect(heroStatus(null)).toBe('absent');
    expect(heroStatus(0.5)).toBe('weary');
    expect(heroStatus(1)).toBe('normal');
    expect(heroStatus(2)).toBe('inspired');
  });

  it('income multiplier clamps', () => {
    expect(incomeMultiplier(7)).toBe(3);
    expect(incomeMultiplier(30)).toBe(1);
    expect(incomeMultiplier(90)).toBe(0.5);
    expect(dayGold(30, 1, 2)).toBe(24);
    expect(dayGold(90, 0.5, 1)).toBe(4); // 7 * 0.5 = 3.5 → 4
  });

  it('xp and levels', () => {
    expect(xpGain(1)).toBe(2);
    expect(xpGain(0.2)).toBe(1);
    expect(xpGain(null)).toBe(0);
    expect(heroLevel(0)).toBe(1);
    expect(heroLevel(4)).toBe(2);
    expect(heroLevel(28)).toBe(5);
    expect(heroLevel(100)).toBe(5);
  });
});
