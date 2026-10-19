import * as chrono from "chrono-node";
import { DateTime } from "luxon";
import type { Locale } from "./types.js";

export interface SpokenWindow {
  fromDay: string; // "YYYY-MM-DD"
  toDay: string; // "YYYY-MM-DD"
  band?: [number, number]; // minutes since midnight, [from, to)
  exact?: DateTime;
  label: string;
}

interface DaypartRule {
  pattern: RegExp;
  band: [number, number];
  name: string;
}

// Order matters: more specific multi-word phrases must be checked before the
// shorter phrases they contain (e.g. "late afternoon" before "afternoon").
const DAYPART_RULES_EN: DaypartRule[] = [
  { pattern: /\b(late afternoon|end of day|after school)\b/, band: [900, 1080], name: "late afternoon" },
  { pattern: /\b(early morning|before work)\b/, band: [420, 570], name: "early morning" },
  { pattern: /\b(lunchtime|lunch time|lunch|midday)\b/, band: [690, 810], name: "lunchtime" },
  { pattern: /\bmorning\b/, band: [480, 720], name: "morning" },
  { pattern: /\bafternoon\b/, band: [720, 1020], name: "afternoon" },
  { pattern: /\b(after work|evening|tonight)\b/, band: [1020, 1260], name: "evening" },
];

// Spanish equivalents of the same bands. "mediodía" (noon) is deliberately
// not a lunchtime trigger here since it's normalized to "12pm" below and
// used by antes de/después de (before/after) instead.
const DAYPART_RULES_ES: DaypartRule[] = [
  { pattern: /\b(a última hora de la tarde|al final del día)\b/, band: [900, 1080], name: "última hora de la tarde" },
  { pattern: /\b(temprano por la mañana|antes del trabajo)\b/, band: [420, 570], name: "temprano por la mañana" },
  { pattern: /\b(a la hora de comer|a la hora del almuerzo)\b/, band: [690, 810], name: "a la hora de comer" },
  { pattern: /\b(por la mañana|en la mañana)\b/, band: [480, 720], name: "por la mañana" },
  { pattern: /\b(por la tarde|en la tarde)\b/, band: [720, 1020], name: "por la tarde" },
  { pattern: /\b(después del trabajo|por la noche|esta noche)\b/, band: [1020, 1260], name: "por la noche" },
];

// French equivalents. "midi" (noon) is deliberately not a lunchtime trigger
// here, same reasoning as "mediodía" above; it's normalized to "12pm" and
// used by avant/après (before/after) instead.
const DAYPART_RULES_FR: DaypartRule[] = [
  { pattern: /\b(en fin d'après-midi|en fin de journée)\b/, band: [900, 1080], name: "en fin d'après-midi" },
  { pattern: /\b(tôt le matin|avant le travail)\b/, band: [420, 570], name: "tôt le matin" },
  // Leading \b can't anchor right before an accented letter (à is not a \w
  // char in JS regex), so this is written without the leading "à " that a
  // natural phrase would have; "l'heure du déjeuner" still matches it.
  { pattern: /\b(l'heure du déjeuner|au déjeuner|pendant le déjeuner)\b/, band: [690, 810], name: "à l'heure du déjeuner" },
  { pattern: /\bmatin\b/, band: [480, 720], name: "matin" },
  { pattern: /\baprès-midi\b/, band: [720, 1020], name: "après-midi" },
  { pattern: /\b(après le travail|le soir|ce soir)\b/, band: [1020, 1260], name: "soir" },
];

const BETWEEN_RE_EN = /\bbetween\s+(\d{1,2})(?::(\d{2}))?\s*(am|pm)?\s+and\s+(\d{1,2})(?::(\d{2}))?\s*(am|pm)?\b/i;
const AFTER_RE_EN = /\bafter\s+(\d{1,2})(?::(\d{2}))?\s*(am|pm)?\b/i;
const BEFORE_RE_EN = /\bbefore\s+(\d{1,2})(?::(\d{2}))?\s*(am|pm)?\b/i;

const BETWEEN_RE_ES = /\bentre\s+(?:la[s]?\s+)?(\d{1,2})(?::(\d{2}))?\s*(am|pm)?\s+y\s+(?:la[s]?\s+)?(\d{1,2})(?::(\d{2}))?\s*(am|pm)?\b/i;
const AFTER_RE_ES = /\bdespués de(?:l)?\s+(?:la[s]?\s+)?(\d{1,2})(?::(\d{2}))?\s*(am|pm)?\b/i;
const BEFORE_RE_ES = /\bantes de(?:l)?\s+(?:la[s]?\s+)?(\d{1,2})(?::(\d{2}))?\s*(am|pm)?\b/i;

const BETWEEN_RE_FR = /\bentre\s+(\d{1,2})(?::(\d{2}))?\s*(am|pm)?\s+et\s+(\d{1,2})(?::(\d{2}))?\s*(am|pm)?\b/i;
const AFTER_RE_FR = /\baprès\s+(\d{1,2})(?::(\d{2}))?\s*(am|pm)?\b/i;
const BEFORE_RE_FR = /\bavant\s+(\d{1,2})(?::(\d{2}))?\s*(am|pm)?\b/i;

const NEXT_WEEKEND_RE_EN = /\bnext weekend\b/;
const THIS_WEEKEND_RE_EN = /\bthis weekend\b/;
const NEXT_WEEK_RE_EN = /\bnext week\b/;
const THIS_WEEK_RE_EN = /\bthis week\b/;
const ASAP_RE_EN = /\b(asap|whenever)\b/;

const NEXT_WEEKEND_RE_ES = /\b(el próximo fin de semana|fin de semana que viene)\b/;
const THIS_WEEKEND_RE_ES = /\beste fin de semana\b/;
const NEXT_WEEK_RE_ES = /\b(la próxima semana|semana que viene)\b/;
const THIS_WEEK_RE_ES = /\besta semana\b/;
const ASAP_RE_ES = /\b(lo antes posible|cuanto antes|cuando sea)\b/;

const NEXT_WEEKEND_RE_FR = /\b(le week-end prochain|le prochain week-end)\b/;
const THIS_WEEKEND_RE_FR = /\bce week-end\b/;
const NEXT_WEEK_RE_FR = /\bla semaine prochaine\b/;
const THIS_WEEK_RE_FR = /\bcette semaine\b/;
const ASAP_RE_FR = /\b(dès que possible|n'importe quand|quand vous voulez)\b/;

interface LocaleRules {
  daypartRules: DaypartRule[];
  betweenRe: RegExp;
  afterRe: RegExp;
  beforeRe: RegExp;
  nextWeekendRe: RegExp;
  thisWeekendRe: RegExp;
  nextWeekRe: RegExp;
  thisWeekRe: RegExp;
  asapRe: RegExp;
  normalize: (phrase: string) => string;
  chronoParse: (text: string, ref: { instant: Date; timezone: number }, opts: { forwardDate: boolean }) => chrono.ParsedResult[];
  asapLabel: string;
  anyTimeLabel: string;
  nextWeekendLabel: string;
  thisWeekendLabel: string;
  nextWeekLabel: string;
  thisWeekLabel: string;
}

const RULES: Record<Locale, LocaleRules> = {
  en: {
    daypartRules: DAYPART_RULES_EN,
    betweenRe: BETWEEN_RE_EN,
    afterRe: AFTER_RE_EN,
    beforeRe: BEFORE_RE_EN,
    nextWeekendRe: NEXT_WEEKEND_RE_EN,
    thisWeekendRe: THIS_WEEKEND_RE_EN,
    nextWeekRe: NEXT_WEEK_RE_EN,
    thisWeekRe: THIS_WEEK_RE_EN,
    asapRe: ASAP_RE_EN,
    normalize: (p) => p.replace(/\bnoon\b/g, "12pm").replace(/\bmidnight\b/g, "12am"),
    chronoParse: (text, ref, opts) => chrono.parse(text, ref, opts),
    asapLabel: "as soon as possible",
    anyTimeLabel: "any time",
    nextWeekendLabel: "next weekend",
    thisWeekendLabel: "this weekend",
    nextWeekLabel: "next week",
    thisWeekLabel: "this week",
  },
  es: {
    daypartRules: DAYPART_RULES_ES,
    betweenRe: BETWEEN_RE_ES,
    afterRe: AFTER_RE_ES,
    beforeRe: BEFORE_RE_ES,
    nextWeekendRe: NEXT_WEEKEND_RE_ES,
    thisWeekendRe: THIS_WEEKEND_RE_ES,
    nextWeekRe: NEXT_WEEK_RE_ES,
    thisWeekRe: THIS_WEEK_RE_ES,
    asapRe: ASAP_RE_ES,
    normalize: (p) => p.replace(/\bmediodía\b/g, "12pm").replace(/\bmedianoche\b/g, "12am"),
    chronoParse: (text, ref, opts) => chrono.es.parse(text, ref, opts),
    asapLabel: "lo antes posible",
    anyTimeLabel: "cualquier hora",
    nextWeekendLabel: "el próximo fin de semana",
    thisWeekendLabel: "este fin de semana",
    nextWeekLabel: "la próxima semana",
    thisWeekLabel: "esta semana",
  },
  fr: {
    daypartRules: DAYPART_RULES_FR,
    betweenRe: BETWEEN_RE_FR,
    afterRe: AFTER_RE_FR,
    beforeRe: BEFORE_RE_FR,
    nextWeekendRe: NEXT_WEEKEND_RE_FR,
    thisWeekendRe: THIS_WEEKEND_RE_FR,
    nextWeekRe: NEXT_WEEK_RE_FR,
    thisWeekRe: THIS_WEEK_RE_FR,
    asapRe: ASAP_RE_FR,
    // "midi" (noon) normalizes to a bare time, but not inside "après-midi"
    // (afternoon), which must survive to match the afternoon daypart rule.
    normalize: (p) => p.replace(/(?<!après-)\bmidi\b/g, "12pm").replace(/\bminuit\b/g, "12am"),
    chronoParse: (text, ref, opts) => chrono.fr.parse(text, ref, opts),
    asapLabel: "dès que possible",
    anyTimeLabel: "n'importe quelle heure",
    nextWeekendLabel: "le week-end prochain",
    thisWeekendLabel: "ce week-end",
    nextWeekLabel: "la semaine prochaine",
    thisWeekLabel: "cette semaine",
  },
};

/** Bare hour 1-7 means PM (per spec); 8-11 stay as literal (AM) hours; 12 is noon. */
function bareHourToMinutes(hourStr: string, minStr: string | undefined, merStr: string | undefined): number {
  let hour = parseInt(hourStr, 10);
  const min = minStr ? parseInt(minStr, 10) : 0;
  if (merStr) {
    const m = merStr.toLowerCase();
    if (m === "pm" && hour < 12) hour += 12;
    if (m === "am" && hour === 12) hour = 0;
  } else if (hour >= 1 && hour <= 7) {
    hour += 12;
  }
  return hour * 60 + min;
}

function extractBand(phrase: string, rules: LocaleRules): { band?: [number, number]; rest: string } {
  let m = rules.betweenRe.exec(phrase);
  if (m) {
    const from = bareHourToMinutes(m[1], m[2], m[3]);
    const to = bareHourToMinutes(m[4], m[5], m[6]);
    return { band: [from, to], rest: phrase.replace(rules.betweenRe, " ") };
  }
  m = rules.afterRe.exec(phrase);
  if (m) {
    const from = bareHourToMinutes(m[1], m[2], m[3]);
    return { band: [from, 1440], rest: phrase.replace(rules.afterRe, " ") };
  }
  m = rules.beforeRe.exec(phrase);
  if (m) {
    const to = bareHourToMinutes(m[1], m[2], m[3]);
    return { band: [0, to], rest: phrase.replace(rules.beforeRe, " ") };
  }
  for (const rule of rules.daypartRules) {
    if (rule.pattern.test(phrase)) {
      return { band: rule.band, rest: phrase.replace(rule.pattern, " ") };
    }
  }
  return { rest: phrase };
}

function isoDate(dt: DateTime): string {
  return dt.toISODate()!;
}

function mondayOf(dt: DateTime): DateTime {
  return dt.minus({ days: dt.weekday - 1 }).startOf("day");
}

function laterDay(a: DateTime, b: DateTime): DateTime {
  return a > b ? a : b;
}

/**
 * Parses a spoken scheduling phrase into a search window. Dates/times come
 * from chrono-node (forwardDate, reference instant + timezone offset);
 * "between/after/before" and daypart phrases ("morning", "after work", ...)
 * are matched directly since chrono does not understand this domain's bands.
 * `locale` picks the keyword/daypart vocabulary and the matching chrono-node
 * parser (chrono.es for Spanish, chrono.fr for French) for the business's language.
 */
export function parseSpokenWindow(
  phrase: string,
  nowInBusinessZone: DateTime,
  horizonDays = 14,
  locale: Locale = "en",
): SpokenWindow {
  const rules = RULES[locale];
  const today = nowInBusinessZone.startOf("day");
  const horizonEnd = today.plus({ days: horizonDays - 1 });

  let normalized = (phrase ?? "").trim().toLowerCase();
  normalized = rules.normalize(normalized);

  if (normalized === "" || rules.asapRe.test(normalized)) {
    return { fromDay: isoDate(today), toDay: isoDate(horizonEnd), label: rules.asapLabel };
  }

  if (rules.nextWeekendRe.test(normalized)) {
    const nextMonday = mondayOf(today).plus({ days: 7 });
    const sat = nextMonday.plus({ days: 5 });
    const sun = nextMonday.plus({ days: 6 });
    const { band } = extractBand(normalized.replace(rules.nextWeekendRe, " "), rules);
    return { fromDay: isoDate(sat), toDay: isoDate(sun), band, label: rules.nextWeekendLabel };
  }
  if (rules.thisWeekendRe.test(normalized)) {
    const thisMonday = mondayOf(today);
    const sat = laterDay(today, thisMonday.plus({ days: 5 }));
    const sun = laterDay(today, thisMonday.plus({ days: 6 }));
    const { band } = extractBand(normalized.replace(rules.thisWeekendRe, " "), rules);
    return { fromDay: isoDate(sat), toDay: isoDate(sun), band, label: rules.thisWeekendLabel };
  }
  if (rules.nextWeekRe.test(normalized)) {
    const nextMonday = mondayOf(today).plus({ days: 7 });
    const { band } = extractBand(normalized.replace(rules.nextWeekRe, " "), rules);
    return { fromDay: isoDate(nextMonday), toDay: isoDate(nextMonday.plus({ days: 6 })), band, label: rules.nextWeekLabel };
  }
  if (rules.thisWeekRe.test(normalized)) {
    const thisSunday = mondayOf(today).plus({ days: 6 });
    const { band } = extractBand(normalized.replace(rules.thisWeekRe, " "), rules);
    return { fromDay: isoDate(today), toDay: isoDate(thisSunday), band, label: rules.thisWeekLabel };
  }

  const { band, rest } = extractBand(normalized, rules);

  const ref = { instant: nowInBusinessZone.toJSDate(), timezone: -nowInBusinessZone.offset };
  const results = rules.chronoParse(rest, ref, { forwardDate: true });
  const result = results[0];

  // "day" itself is often left uncertain by chrono when it's only implied by
  // forwardDate-rolling a bare time (e.g. "8am" rolling to tomorrow), so an
  // explicit hour also counts as resolving a single day.
  const dayIsCertain =
    !!result &&
    (result.start.isCertain("day") || result.start.isCertain("weekday") || result.start.isCertain("hour"));

  if (!dayIsCertain) {
    // No day mentioned: search across the whole horizon for the requested band.
    return { fromDay: isoDate(today), toDay: isoDate(horizonEnd), band, label: band ? phraseLabel(normalized, rules) : rules.anyTimeLabel };
  }

  const year = result.start.get("year")!;
  const month = result.start.get("month")!;
  const day = result.start.get("day")!;
  let resolvedDay: DateTime = DateTime.fromObject(
    { year, month, day },
    { zone: nowInBusinessZone.zone },
  ).startOf("day");
  if (resolvedDay < today) resolvedDay = today;

  let exact: DateTime | undefined;
  if (!band && result.start.isCertain("hour")) {
    const hour = result.start.get("hour")!;
    const minute = result.start.get("minute") ?? 0;
    exact = resolvedDay.set({ hour, minute, second: 0, millisecond: 0 });
  }

  return {
    fromDay: isoDate(resolvedDay),
    toDay: isoDate(resolvedDay),
    band,
    exact,
    label: exact ? speakDateTime(exact, nowInBusinessZone, locale) : phraseLabel(normalized, rules, resolvedDay, nowInBusinessZone, locale),
  };
}

function phraseLabel(normalized: string, rules: LocaleRules, day?: DateTime, nowRef?: DateTime, locale: Locale = "en"): string {
  if (day && nowRef) {
    const dayPart = relativeDayLabel(day, nowRef, locale);
    for (const rule of rules.daypartRules) {
      if (rule.pattern.test(normalized)) return `${dayPart} ${rule.name}`;
    }
    if (rules.betweenRe.test(normalized) || rules.afterRe.test(normalized) || rules.beforeRe.test(normalized)) {
      return dayPart;
    }
    return dayPart;
  }
  for (const rule of rules.daypartRules) {
    if (rule.pattern.test(normalized)) return rule.name;
  }
  return rules.anyTimeLabel;
}

const WEEKDAY_FAR_FORMAT: Record<Locale, string> = {
  en: "cccc, MMMM d",
  es: "cccc, d 'de' MMMM",
  fr: "cccc d MMMM",
};

const TODAY_LABEL: Record<Locale, string> = { en: "today", es: "hoy", fr: "aujourd'hui" };
const TOMORROW_LABEL: Record<Locale, string> = { en: "tomorrow", es: "mañana", fr: "demain" };

export function relativeDayLabel(day: DateTime, nowRef: DateTime, locale: Locale = "en"): string {
  const today = nowRef.startOf("day");
  const diffDays = Math.round(day.startOf("day").diff(today, "days").days);
  const localized = day.setLocale(locale);
  if (diffDays === 0) return TODAY_LABEL[locale];
  if (diffDays === 1) return TOMORROW_LABEL[locale];
  if (diffDays > 1 && diffDays < 7) return localized.toFormat("cccc");
  return localized.toFormat(WEEKDAY_FAR_FORMAT[locale]);
}

export function formatClock(dt: DateTime, locale: Locale = "en"): string {
  const hour12 = dt.hour % 12 === 0 ? 12 : dt.hour % 12;
  const minute = String(dt.minute).padStart(2, "0");
  if (locale === "es") {
    const period = dt.hour < 12 ? "de la mañana" : dt.hour < 19 ? "de la tarde" : "de la noche";
    return `${hour12}:${minute} ${period}`;
  }
  if (locale === "fr") {
    const period = dt.hour < 12 ? "du matin" : dt.hour < 19 ? "de l'après-midi" : "du soir";
    return `${hour12}:${minute} ${period}`;
  }
  const period = dt.hour < 12 ? "AM" : "PM";
  return `${hour12}:${minute} ${period}`;
}

/**
 * "tomorrow at 9:00 AM" / "Thursday at 5:30 PM" / "Monday, November 2 at 10:00 AM"
 * ("mañana a las 9:00 de la mañana" in Spanish / "demain à 9:00 du matin" in French)
 */
export function speakDateTime(dt: DateTime, nowRef?: DateTime, locale: Locale = "en"): string {
  const reference = (nowRef ?? dt).setZone(dt.zone);
  const dayLabel = relativeDayLabel(dt, reference, locale);
  const clock = formatClock(dt, locale);
  if (locale === "es") return `${dayLabel} a las ${clock}`;
  if (locale === "fr") return `${dayLabel} à ${clock}`;
  return `${dayLabel} at ${clock}`;
}
