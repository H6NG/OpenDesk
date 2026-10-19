import { DateTime } from "luxon";
import { formatClock, relativeDayLabel, speakDateTime } from "../spokenTime.js";
import { speakCode } from "../codes.js";
import type { Slot } from "../availability.js";

export function formatMoney(cents: number): string {
  const dollars = cents / 100;
  return dollars % 1 === 0 ? `$${dollars}` : `$${dollars.toFixed(2)}`;
}

function capitalize(s: string): string {
  return s.length === 0 ? s : s.charAt(0).toUpperCase() + s.slice(1);
}

function stripPeriod(t: string): string {
  return t.replace(/\s*(AM|PM)$/i, "");
}

function joinWithOr(times: string[]): string {
  if (times.length === 1) return times[0];
  if (times.length === 2) return `${stripPeriod(times[0])} or ${times[1]}`;
  return `${times.slice(0, -1).map(stripPeriod).join(", ")}, or ${times[times.length - 1]}`;
}

function speakSlotsForDay(daySlots: Slot[]): string {
  const groups: { staffName: string; times: string[] }[] = [];
  for (const slot of daySlots) {
    const t = formatClock(DateTime.fromISO(slot.start, { setZone: true }));
    const last = groups[groups.length - 1];
    if (last && last.staffName === slot.staffName) last.times.push(t);
    else groups.push({ staffName: slot.staffName, times: [t] });
  }
  return groups.map((g) => `${joinWithOr(g.times)} with ${g.staffName}`).join(", or ");
}

/** "Thursday at 6:15 or 6:30 PM with Priya, or 7:15 PM with Sam." */
export function speakAvailability(slots: Slot[], nowBiz: DateTime): string {
  if (slots.length === 0) return "";
  const order: string[] = [];
  const byDay = new Map<string, Slot[]>();
  for (const s of slots) {
    const dateIso = s.start.slice(0, 10);
    if (!byDay.has(dateIso)) {
      byDay.set(dateIso, []);
      order.push(dateIso);
    }
    byDay.get(dateIso)!.push(s);
  }
  const clauses = order.map((dateIso) => {
    const daySlots = byDay.get(dateIso)!;
    const dayDt = DateTime.fromISO(daySlots[0].start, { setZone: true });
    const label = capitalize(relativeDayLabel(dayDt, nowBiz));
    return `${label} at ${speakSlotsForDay(daySlots)}`;
  });
  return `${clauses.join("; ")}.`;
}

export function speakHold(slot: Slot, businessName: string, nowBiz: DateTime): string {
  const when = speakDateTime(DateTime.fromISO(slot.start, { setZone: true }), nowBiz);
  return `I'm holding ${slot.serviceName} with ${slot.staffName} at ${businessName}, ${when}, for ${formatMoney(slot.priceCents)}. Should I book it?`;
}

export function speakConfirmation(code: string, serviceName: string, staffName: string, start: string, nowBiz: DateTime): string {
  const when = speakDateTime(DateTime.fromISO(start, { setZone: true }), nowBiz);
  return `You're booked for ${serviceName} with ${staffName}, ${when}. Your confirmation code is ${speakCode(code)}.`;
}

/** "...and 3 more every week after that." */
export function speakSeriesSummary(freq: "weekly" | "biweekly" | "monthly", remainingCount: number): string {
  if (remainingCount <= 0) return "";
  const cadence = freq === "weekly" ? "every week" : freq === "biweekly" ? "every other week" : "every month";
  return ` ...and ${remainingCount} more ${cadence} after that.`;
}
