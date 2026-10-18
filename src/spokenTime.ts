import * as chrono from "chrono-node";
import { DateTime } from "luxon";

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
const DAYPART_RULES: DaypartRule[] = [
  { pattern: /\b(late afternoon|end of day|after school)\b/, band: [900, 1080], name: "late afternoon" },
  { pattern: /\b(early morning|before work)\b/, band: [420, 570], name: "early morning" },
  { pattern: /\b(lunchtime|lunch time|lunch|midday)\b/, band: [690, 810], name: "lunchtime" },
  { pattern: /\bmorning\b/, band: [480, 720], name: "morning" },
  { pattern: /\bafternoon\b/, band: [720, 1020], name: "afternoon" },
  { pattern: /\b(after work|evening|tonight)\b/, band: [1020, 1260], name: "evening" },
];

const BETWEEN_RE =
  /\bbetween\s+(\d{1,2})(?::(\d{2}))?\s*(am|pm)?\s+and\s+(\d{1,2})(?::(\d{2}))?\s*(am|pm)?\b/i;
const AFTER_RE = /\bafter\s+(\d{1,2})(?::(\d{2}))?\s*(am|pm)?\b/i;
const BEFORE_RE = /\bbefore\s+(\d{1,2})(?::(\d{2}))?\s*(am|pm)?\b/i;

const NEXT_WEEKEND_RE = /\bnext weekend\b/;
const THIS_WEEKEND_RE = /\bthis weekend\b/;
const NEXT_WEEK_RE = /\bnext week\b/;
const THIS_WEEK_RE = /\bthis week\b/;
const ASAP_RE = /\b(asap|whenever)\b/;

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

function extractBand(phrase: string): { band?: [number, number]; rest: string } {
  let m = BETWEEN_RE.exec(phrase);
  if (m) {
    const from = bareHourToMinutes(m[1], m[2], m[3]);
    const to = bareHourToMinutes(m[4], m[5], m[6]);
    return { band: [from, to], rest: phrase.replace(BETWEEN_RE, " ") };
  }
  m = AFTER_RE.exec(phrase);
  if (m) {
    const from = bareHourToMinutes(m[1], m[2], m[3]);
    return { band: [from, 1440], rest: phrase.replace(AFTER_RE, " ") };
  }
  m = BEFORE_RE.exec(phrase);
  if (m) {
    const to = bareHourToMinutes(m[1], m[2], m[3]);
    return { band: [0, to], rest: phrase.replace(BEFORE_RE, " ") };
  }
  for (const rule of DAYPART_RULES) {
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
 */
export function parseSpokenWindow(
  phrase: string,
  nowInBusinessZone: DateTime,
  horizonDays = 14,
): SpokenWindow {
  const today = nowInBusinessZone.startOf("day");
  const horizonEnd = today.plus({ days: horizonDays - 1 });

  let normalized = (phrase ?? "").trim().toLowerCase();
  normalized = normalized.replace(/\bnoon\b/g, "12pm").replace(/\bmidnight\b/g, "12am");

  if (normalized === "" || ASAP_RE.test(normalized)) {
    return { fromDay: isoDate(today), toDay: isoDate(horizonEnd), label: "as soon as possible" };
  }

  if (NEXT_WEEKEND_RE.test(normalized)) {
    const nextMonday = mondayOf(today).plus({ days: 7 });
    const sat = nextMonday.plus({ days: 5 });
    const sun = nextMonday.plus({ days: 6 });
    const { band } = extractBand(normalized.replace(NEXT_WEEKEND_RE, " "));
    return { fromDay: isoDate(sat), toDay: isoDate(sun), band, label: "next weekend" };
  }
  if (THIS_WEEKEND_RE.test(normalized)) {
    const thisMonday = mondayOf(today);
    const sat = laterDay(today, thisMonday.plus({ days: 5 }));
    const sun = laterDay(today, thisMonday.plus({ days: 6 }));
    const { band } = extractBand(normalized.replace(THIS_WEEKEND_RE, " "));
    return { fromDay: isoDate(sat), toDay: isoDate(sun), band, label: "this weekend" };
  }
  if (NEXT_WEEK_RE.test(normalized)) {
    const nextMonday = mondayOf(today).plus({ days: 7 });
    const { band } = extractBand(normalized.replace(NEXT_WEEK_RE, " "));
    return { fromDay: isoDate(nextMonday), toDay: isoDate(nextMonday.plus({ days: 6 })), band, label: "next week" };
  }
  if (THIS_WEEK_RE.test(normalized)) {
    const thisSunday = mondayOf(today).plus({ days: 6 });
    const { band } = extractBand(normalized.replace(THIS_WEEK_RE, " "));
    return { fromDay: isoDate(today), toDay: isoDate(thisSunday), band, label: "this week" };
  }

  const { band, rest } = extractBand(normalized);

  const ref = { instant: nowInBusinessZone.toJSDate(), timezone: -nowInBusinessZone.offset };
  const results = chrono.parse(rest, ref, { forwardDate: true });
  const result = results[0];

  // "day" itself is often left uncertain by chrono when it's only implied by
  // forwardDate-rolling a bare time (e.g. "8am" rolling to tomorrow), so an
  // explicit hour also counts as resolving a single day.
  const dayIsCertain =
    !!result &&
    (result.start.isCertain("day") || result.start.isCertain("weekday") || result.start.isCertain("hour"));

  if (!dayIsCertain) {
    // No day mentioned: search across the whole horizon for the requested band.
    return { fromDay: isoDate(today), toDay: isoDate(horizonEnd), band, label: band ? phraseLabel(normalized) : "any time" };
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
    label: exact ? speakDateTime(exact, nowInBusinessZone) : phraseLabel(normalized, resolvedDay, nowInBusinessZone),
  };
}

function phraseLabel(normalized: string, day?: DateTime, nowRef?: DateTime): string {
  if (day && nowRef) {
    const dayPart = relativeDayLabel(day, nowRef);
    for (const rule of DAYPART_RULES) {
      if (rule.pattern.test(normalized)) return `${dayPart} ${rule.name}`;
    }
    if (BETWEEN_RE.test(normalized) || AFTER_RE.test(normalized) || BEFORE_RE.test(normalized)) {
      return dayPart;
    }
    return dayPart;
  }
  for (const rule of DAYPART_RULES) {
    if (rule.pattern.test(normalized)) return rule.name;
  }
  return "any time";
}

function relativeDayLabel(day: DateTime, nowRef: DateTime): string {
  const today = nowRef.startOf("day");
  const diffDays = Math.round(day.startOf("day").diff(today, "days").days);
  if (diffDays === 0) return "today";
  if (diffDays === 1) return "tomorrow";
  if (diffDays > 1 && diffDays < 7) return day.toFormat("cccc");
  return day.toFormat("cccc, MMMM d");
}

function formatClock(dt: DateTime): string {
  const hour12 = dt.hour % 12 === 0 ? 12 : dt.hour % 12;
  const minute = String(dt.minute).padStart(2, "0");
  const period = dt.hour < 12 ? "AM" : "PM";
  return `${hour12}:${minute} ${period}`;
}

/**
 * "tomorrow at 9:00 AM" / "Thursday at 5:30 PM" / "Monday, November 2 at 10:00 AM"
 */
export function speakDateTime(dt: DateTime, nowRef?: DateTime): string {
  const reference = (nowRef ?? dt).setZone(dt.zone);
  const dayLabel = relativeDayLabel(dt, reference);
  return `${dayLabel} at ${formatClock(dt)}`;
}
