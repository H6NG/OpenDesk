import { DateTime } from "luxon";
import { formatClock, relativeDayLabel, speakDateTime } from "../spokenTime.js";
import { speakCode } from "../codes.js";
import type { Slot } from "../availability.js";
import type { Locale } from "../types.js";

export function formatMoney(cents: number): string {
  const dollars = cents / 100;
  return dollars % 1 === 0 ? `$${dollars}` : `$${dollars.toFixed(2)}`;
}

function capitalize(s: string): string {
  return s.length === 0 ? s : s.charAt(0).toUpperCase() + s.slice(1);
}

function stripPeriod(t: string, locale: Locale): string {
  return locale === "es" ? t.replace(/\s*de la (mañana|tarde|noche)$/i, "") : t.replace(/\s*(AM|PM)$/i, "");
}

function joinWithOr(times: string[], locale: Locale): string {
  const or = locale === "es" ? "o" : "or";
  if (times.length === 1) return times[0];
  if (times.length === 2) return `${stripPeriod(times[0], locale)} ${or} ${times[1]}`;
  return `${times.slice(0, -1).map((t) => stripPeriod(t, locale)).join(", ")}, ${or} ${times[times.length - 1]}`;
}

function speakSlotsForDay(daySlots: Slot[], locale: Locale): string {
  const groups: { staffName: string; times: string[] }[] = [];
  for (const slot of daySlots) {
    const t = formatClock(DateTime.fromISO(slot.start, { setZone: true }), locale);
    const last = groups[groups.length - 1];
    if (last && last.staffName === slot.staffName) last.times.push(t);
    else groups.push({ staffName: slot.staffName, times: [t] });
  }
  const withWord = locale === "es" ? "con" : "with";
  return groups.map((g) => `${joinWithOr(g.times, locale)} ${withWord} ${g.staffName}`).join(locale === "es" ? ", o " : ", or ");
}

/** "Thursday at 6:15 or 6:30 PM with Priya, or 7:15 PM with Sam." */
export function speakAvailability(slots: Slot[], nowBiz: DateTime, locale: Locale = "en"): string {
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
    const label = capitalize(relativeDayLabel(dayDt, nowBiz, locale));
    const at = locale === "es" ? "a las" : "at";
    return `${label} ${at} ${speakSlotsForDay(daySlots, locale)}`;
  });
  return `${clauses.join("; ")}.`;
}

export function speakHold(slot: Slot, businessName: string, nowBiz: DateTime, locale: Locale = "en"): string {
  const when = speakDateTime(DateTime.fromISO(slot.start, { setZone: true }), nowBiz, locale);
  if (locale === "es") {
    return `Estoy reservando ${slot.serviceName} con ${slot.staffName} en ${businessName}, ${when}, por ${formatMoney(slot.priceCents)}. ¿Confirmo la reserva?`;
  }
  return `I'm holding ${slot.serviceName} with ${slot.staffName} at ${businessName}, ${when}, for ${formatMoney(slot.priceCents)}. Should I book it?`;
}

export function speakConfirmation(code: string, serviceName: string, staffName: string, start: string, nowBiz: DateTime, locale: Locale = "en"): string {
  const when = speakDateTime(DateTime.fromISO(start, { setZone: true }), nowBiz, locale);
  if (locale === "es") {
    return `Listo, tienes ${serviceName} con ${staffName}, ${when}. Tu código de confirmación es ${speakCode(code)}.`;
  }
  return `You're booked for ${serviceName} with ${staffName}, ${when}. Your confirmation code is ${speakCode(code)}.`;
}

/** "...and 3 more every week after that." / "...y 3 más cada semana después de esa." */
export function speakSeriesSummary(freq: "weekly" | "biweekly" | "monthly", remainingCount: number, locale: Locale = "en"): string {
  if (remainingCount <= 0) return "";
  if (locale === "es") {
    const cadence = freq === "weekly" ? "cada semana" : freq === "biweekly" ? "cada dos semanas" : "cada mes";
    return ` ...y ${remainingCount} más ${cadence} después de esa.`;
  }
  const cadence = freq === "weekly" ? "every week" : freq === "biweekly" ? "every other week" : "every month";
  return ` ...and ${remainingCount} more ${cadence} after that.`;
}
