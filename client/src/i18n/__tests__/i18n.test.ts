import { describe, expect, it } from 'vitest';
import { getTheme } from '../../content/themes';
import de from '../../locales/de.json';
import en from '../../locales/en.json';
import fr from '../../locales/fr.json';
import { ApiError } from '../../net/types';
import { fmtDuration, getHeroInfo } from '../../ui/common';
import { formatDate, formatNumber, translateApiError, translateSkipReason } from '../format';
import i18n, { SUPPORTED_LOCALES, detectInitialLocale, setLanguage } from '../index';

function flatten(obj: Record<string, unknown>, prefix = '', out: Record<string, string> = {}): Record<string, string> {
  for (const [k, v] of Object.entries(obj)) {
    const next = prefix ? `${prefix}.${k}` : k;
    if (v && typeof v === 'object' && !Array.isArray(v)) {
      flatten(v as Record<string, unknown>, next, out);
    } else {
      out[next] = String(v);
    }
  }
  return out;
}

function extractPlaceholders(str: string): string[] {
  return [...new Set([...str.matchAll(/\{\{(\w+)\}\}/g)].map((m) => m[1]))].sort();
}

describe('i18n catalogs & runtime', () => {
  const flatEn = flatten(en as unknown as Record<string, unknown>);
  const flatDe = flatten(de as unknown as Record<string, unknown>);
  const flatFr = flatten(fr as unknown as Record<string, unknown>);
  const enKeys = Object.keys(flatEn).sort();

  it('has identical keys across English, German, and French', () => {
    expect(SUPPORTED_LOCALES).toEqual(['en', 'de', 'fr']);
    expect(Object.keys(flatDe).sort()).toEqual(enKeys);
    expect(Object.keys(flatFr).sort()).toEqual(enKeys);
  });

  it('has non-empty translations and matching {{placeholders}} in every locale', () => {
    for (const key of enKeys) {
      expect(flatEn[key].trim().length, `en:${key}`).toBeGreaterThan(0);
      expect(flatDe[key].trim().length, `de:${key}`).toBeGreaterThan(0);
      expect(flatFr[key].trim().length, `fr:${key}`).toBeGreaterThan(0);

      const ph = extractPlaceholders(flatEn[key]);
      expect(extractPlaceholders(flatDe[key]), `de placeholders for ${key}`).toEqual(ph);
      expect(extractPlaceholders(flatFr[key]), `fr placeholders for ${key}`).toEqual(ph);
    }
  });

  it('detects initial locale with priority: saved > browser > fallback en', () => {
    expect(detectInitialLocale({ saved: 'de', browserLanguages: ['fr-FR', 'en-US'] })).toBe('de');
    expect(detectInitialLocale({ saved: 'fr', browserLanguages: ['de-DE'] })).toBe('fr');
    expect(detectInitialLocale({ saved: 'invalid', browserLanguages: ['de-AT', 'en-US'] })).toBe('de');
    expect(detectInitialLocale({ saved: null, browserLanguages: ['fr-CA'] })).toBe('fr');
    expect(detectInitialLocale({ saved: null, browserLanguages: ['es-ES', 'de-CH'] })).toBe('de');
    expect(detectInitialLocale({ saved: null, browserLanguages: ['es-ES', 'ja-JP'] })).toBe('en');
    expect(detectInitialLocale({ saved: null, browserLanguages: [] })).toBe('en');
  });

  it('switches languages at runtime and handles plurals, content helpers, and error codes', async () => {
    await setLanguage('en', false);
    expect(i18n.t('app.title')).toBe('The Siege');
    expect(i18n.t('home.defenders', { count: 1 })).toBe('1 defender');
    expect(i18n.t('home.defenders', { count: 4 })).toBe('4 defenders');
    expect(getHeroInfo('knight').name).toBe('Knight');
    expect(getTheme('sugar').roles.flyer.plural).toBe('Floss Bats');

    await setLanguage('de', false);
    expect(i18n.t('app.title')).toBe('Die Belagerung');
    expect(i18n.t('home.defenders', { count: 1 })).toBe('1 Verteidiger');
    expect(i18n.t('home.defenders', { count: 4 })).toBe('4 Verteidiger');
    expect(getHeroInfo('knight').name).toBe('Ritter');
    expect(getTheme('sugar').roles.flyer.plural).toBe('Zuckerwatte-Fledermäuse');
    expect(fmtDuration(0)).toBe('jetzt');
    expect(translateSkipReason('not enough gold')).toBe('nicht genug Gold');
    expect(translateSkipReason('minimum 5')).toBe('mindestens 5 Gold');
    expect(ApiError.fromCode(400, 'invalid_name', { min: 2, max: 24 }).message).toBe('Der Name muss 2–24 Zeichen lang sein.');

    await setLanguage('fr', false);
    expect(i18n.t('app.title')).toBe('Le Siège');
    expect(i18n.t('home.defenders', { count: 1 })).toBe('1 défenseur');
    expect(i18n.t('home.defenders', { count: 3 })).toBe('3 défenseurs');
    expect(i18n.t('report.leaks', { count: 1 })).toBe('1 est passé');
    expect(i18n.t('report.leaks', { count: 2 })).toBe('2 sont passés');
    expect(getHeroInfo('priest').name).toBe('Prêtresse');
    expect(getTheme('sugar').bossName).toBe('Le Spectre de Sucre');
    expect(translateApiError('day_closed')).toBe("Ce jour est clos — l'Aube est passée.");

    // Formatting helpers respect locale
    expect(formatNumber(8000, 'en')).toBe('8,000');
    expect(formatNumber(8000, 'de')).toBe('8.000');
    expect(formatDate('2026-11-15', 'de')).toContain('2026');

    await setLanguage('en', false);
  });
});
