import type { ParseKeys } from 'i18next';
import type { EventKind } from '../net/types';
import i18n, { getLanguage, type Locale } from './index';

export function formatNumber(value: number, locale: Locale = getLanguage()): string {
  return new Intl.NumberFormat(locale).format(value);
}

/** Formats an ISO `YYYY-MM-DD` date string using the active locale (medium style, e.g. Nov 15, 2026 / 15.11.2026 / 15 nov. 2026). */
export function formatDate(isoDate: string, locale: Locale = getLanguage()): string {
  const d = new Date(`${isoDate}T12:00:00`);
  if (Number.isNaN(d.getTime())) return isoDate;
  return new Intl.DateTimeFormat(locale, { dateStyle: 'medium' }).format(d);
}

/** Formats an ISO `YYYY-MM-DD` date string with weekday, day, and short month for the Check-In sheet. */
export function formatWeekdayDate(isoDate: string, locale: Locale = getLanguage()): string {
  const d = new Date(`${isoDate}T12:00:00`);
  if (Number.isNaN(d.getTime())) return isoDate;
  return new Intl.DateTimeFormat(locale, { weekday: 'long', day: 'numeric', month: 'short' }).format(d);
}

/** Translates a server/backend error code + params into a localized message, falling back to `fallback` if unknown. */
export function translateApiError(code?: string, params?: Record<string, unknown>, fallback?: string): string {
  if (code) {
    const key = `errors.${code}`;
    if (i18n.exists(key)) {
      return (i18n.t as unknown as (k: string, opts?: Record<string, unknown>) => string)(key, params);
    }
  }
  return fallback || code || 'Error';
}

export function translateQueuedDrop(kind: EventKind, day: number, reason: string): string {
  const kindLabel =
    kind === 'checkin'
      ? i18n.t('errors.eventKind_checkin')
      : kind === 'orders'
        ? i18n.t('errors.eventKind_orders')
        : i18n.t('errors.eventKind_hash');
  return i18n.t('errors.queued_write_dropped', { kindLabel, day, reason });
}

const SKIP_REASON_MAP: Record<string, ParseKeys> = {
  'unknown pad': 'skipReasons.unknown_pad',
  'not your pad': 'skipReasons.not_your_pad',
  'pad occupied': 'skipReasons.pad_occupied',
  'unknown building': 'skipReasons.unknown_building',
  'not enough gold': 'skipReasons.not_enough_gold',
  'nothing to upgrade': 'skipReasons.nothing_to_upgrade',
  'max level': 'skipReasons.max_level',
  'nothing to repair': 'skipReasons.nothing_to_repair',
  'not damaged': 'skipReasons.not_damaged',
  'unknown player': 'skipReasons.unknown_player',
  'unknown sector': 'skipReasons.unknown_sector',
  'unknown stance': 'skipReasons.unknown_stance',
  'unknown order': 'skipReasons.unknown_order',
};

/** Translates canonical `sim/orders.ts` skip reason strings without mutating simulation state. */
export function translateSkipReason(reason: string): string {
  const mapped = SKIP_REASON_MAP[reason];
  if (mapped) return i18n.t(mapped);
  const minMatch = reason.match(/^minimum (\d+)$/);
  if (minMatch) return i18n.t('skipReasons.minimum_donate', { min: Number(minMatch[1]) });
  return reason;
}
