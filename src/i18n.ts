import type { Locale } from "./types.js";

/**
 * Spanish/English templates for tool speech strings that aren't already
 * handled by mcp/speech.ts (which covers availability/hold/confirm/series
 * readbacks). find_businesses has no single business to key a locale off
 * of, so it always speaks English; see PROGRESS_DEV.md.
 */

export function sayServicePriceList(services: { name: string; priceCents: number }[], formatMoney: (cents: number) => string, locale: Locale): string {
  const word = locale === "es" ? "por" : "for";
  return services.map((s) => `${s.name} ${word} ${formatMoney(s.priceCents)}`).join(", ");
}

export function sayBusinessSummary(businessName: string, serviceList: string, hoursText: string, policyNote: string, locale: Locale): string {
  if (locale === "es") return `${businessName}: ${serviceList}. Horario: ${hoursText}. ${policyNote}`;
  return `${businessName}: ${serviceList}. Hours: ${hoursText}. ${policyNote}`;
}

export function sayBusinessClosed(businessName: string, when: string | null, locale: Locale): string {
  if (locale === "es") {
    return when ? `${businessName} está cerrado ${when}.` : `${businessName} está cerrado todo el tiempo que preguntaste.`;
  }
  return when ? `${businessName} is closed ${when}.` : `${businessName} is closed the whole time you asked about.`;
}

export function sayFullyBooked(businessName: string, alternativesSpeech: string | null, locale: Locale): string {
  if (locale === "es") {
    return alternativesSpeech
      ? `${businessName} está completo en ese horario. La próxima disponibilidad que veo es ${alternativesSpeech} ¿Quieres que te anote en la lista de espera para tu horario original?`
      : `${businessName} está completo durante la próxima semana. ¿Quieres que te anote en la lista de espera?`;
  }
  return alternativesSpeech
    ? `${businessName} is fully booked then. The next opening I see is ${alternativesSpeech} Want me to add you to the waitlist for your original time instead?`
    : `${businessName} is fully booked for the next week. Want me to add you to the waitlist?`;
}

export function sayNoAppointments(locale: Locale): string {
  return locale === "es" ? "No tienes citas próximas." : "You don't have any upcoming appointments.";
}

export function sayAppointmentLine(
  serviceName: string,
  businessName: string,
  staffName: string,
  when: string,
  code: string,
  seriesExtra: number,
  locale: Locale,
): string {
  const suffix =
    seriesExtra > 0 ? (locale === "es" ? ` (más ${seriesExtra} en esta serie)` : ` (plus ${seriesExtra} more in this series)`) : "";
  if (locale === "es") return `${serviceName} en ${businessName} con ${staffName} el ${when}, código ${code}${suffix}`;
  return `${serviceName} at ${businessName} with ${staffName} on ${when}, code ${code}${suffix}`;
}

export function sayWaitlistOfferLine(serviceName: string, businessName: string, when: string, staffName: string, locale: Locale): string {
  if (locale === "es") {
    return `Buenas noticias: se abrió un espacio para ${serviceName} en ${businessName} el ${when} con ${staffName}; di confirmar para tomarlo.`;
  }
  return `Good news: a spot opened up for ${serviceName} at ${businessName} on ${when} with ${staffName}; say confirm to grab it.`;
}

export function sayAppointmentSummary(count: number, lines: string[], locale: Locale): string {
  if (locale === "es") return `Tienes ${count} cita${count === 1 ? "" : "s"}: ${lines.join(". ")}.`;
  return `You have ${count} appointment${count === 1 ? "" : "s"}: ${lines.join(". ")}.`;
}

export function sayRescheduled(when: string, staffName: string, seriesShiftedCount: number | undefined, locale: Locale): string {
  let s = locale === "es" ? `Listo. Tu cita ahora es ${when} con ${staffName}.` : `Done. Your appointment is now ${when} with ${staffName}.`;
  if (seriesShiftedCount && seriesShiftedCount > 1) {
    const n = seriesShiftedCount - 1;
    s +=
      locale === "es"
        ? ` También moví el resto de la serie — ${n} ocurrencia${n === 1 ? "" : "s"} más.`
        : ` I moved the rest of the series too — ${n} more occurrence${n === 1 ? "" : "s"}.`;
  }
  return s;
}

export function sayCancelled(lateFee: boolean, cancelNoticeHours: number, seriesCancelledCount: number | undefined, locale: Locale): string {
  let s: string;
  if (locale === "es") {
    s = lateFee
      ? `Cancelado. Como es dentro de las ${cancelNoticeHours} horas antes de la cita, puede aplicar un cargo por cancelación tardía.`
      : "Cancelado. Sin cargo porque avisaste con suficiente tiempo.";
  } else {
    s = lateFee
      ? `Cancelled. Since that's within ${cancelNoticeHours} hours of the appointment, a late cancellation fee may apply.`
      : "Cancelled. No fee since you gave enough notice.";
  }
  if (seriesCancelledCount && seriesCancelledCount > 1) {
    const n = seriesCancelledCount - 1;
    s +=
      locale === "es"
        ? ` También cancelé las otras ${n} ocurrencia${n === 1 ? "" : "s"} próximas de la serie.`
        : ` I also cancelled the other ${n} upcoming occurrence${n === 1 ? "" : "s"} in the series.`;
  }
  return s;
}

export function sayAlreadyCancelled(locale: Locale): string {
  return locale === "es" ? "Esa cita ya está cancelada." : "That appointment is already cancelled.";
}

export function sayWaitlistJoined(serviceName: string, businessName: string, windowLabel: string, locale: Locale): string {
  if (locale === "es") return `Estás en la lista de espera para ${serviceName} en ${businessName}, ${windowLabel}. Te avisaré si se abre un espacio.`;
  return `You're on the waitlist for ${serviceName} at ${businessName}, ${windowLabel}. I'll let you know if a spot opens up.`;
}
