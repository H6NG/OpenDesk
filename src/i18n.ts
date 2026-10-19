import type { Locale } from "./types.js";

/**
 * Spanish/French/English templates for tool speech strings that aren't
 * already handled by mcp/speech.ts (which covers availability/hold/confirm/
 * series readbacks). find_businesses has no single business to key a locale
 * off of, so it always speaks English; see PROGRESS_DEV.md.
 */

export function sayServicePriceList(services: { name: string; priceCents: number }[], formatMoney: (cents: number) => string, locale: Locale): string {
  const word = locale === "es" ? "por" : locale === "fr" ? "pour" : "for";
  return services.map((s) => `${s.name} ${word} ${formatMoney(s.priceCents)}`).join(", ");
}

export function sayBusinessSummary(businessName: string, serviceList: string, hoursText: string, policyNote: string, locale: Locale): string {
  if (locale === "es") return `${businessName}: ${serviceList}. Horario: ${hoursText}. ${policyNote}`;
  if (locale === "fr") return `${businessName} : ${serviceList}. Horaires : ${hoursText}. ${policyNote}`;
  return `${businessName}: ${serviceList}. Hours: ${hoursText}. ${policyNote}`;
}

export function sayBusinessClosed(businessName: string, when: string | null, alternativesSpeech: string | null, locale: Locale): string {
  let base: string;
  if (locale === "es") {
    base = when ? `${businessName} está cerrado ${when}.` : `${businessName} está cerrado todo el tiempo que preguntaste.`;
  } else if (locale === "fr") {
    base = when ? `${businessName} est fermé ${when}.` : `${businessName} est fermé tout le temps que vous avez demandé.`;
  } else {
    base = when ? `${businessName} is closed ${when}.` : `${businessName} is closed the whole time you asked about.`;
  }
  if (!alternativesSpeech) return base;
  if (locale === "es") return `${base} El próximo horario abierto es ${alternativesSpeech}`;
  if (locale === "fr") return `${base} Le prochain horaire ouvert est ${alternativesSpeech}`;
  return `${base} The next time they're open is ${alternativesSpeech}`;
}

export function sayFullyBooked(businessName: string, alternativesSpeech: string | null, locale: Locale): string {
  if (locale === "es") {
    return alternativesSpeech
      ? `${businessName} está completo en ese horario. La próxima disponibilidad que veo es ${alternativesSpeech} ¿Quieres que te anote en la lista de espera para tu horario original?`
      : `${businessName} está completo durante la próxima semana. ¿Quieres que te anote en la lista de espera?`;
  }
  if (locale === "fr") {
    return alternativesSpeech
      ? `${businessName} est complet à ce moment-là. La prochaine disponibilité que je vois est ${alternativesSpeech} Voulez-vous que je vous ajoute à la liste d'attente pour votre horaire initial ?`
      : `${businessName} est complet pour la semaine à venir. Voulez-vous que je vous ajoute à la liste d'attente ?`;
  }
  return alternativesSpeech
    ? `${businessName} is fully booked then. The next opening I see is ${alternativesSpeech} Want me to add you to the waitlist for your original time instead?`
    : `${businessName} is fully booked for the next week. Want me to add you to the waitlist?`;
}

export function sayNoAppointments(locale: Locale): string {
  if (locale === "es") return "No tienes citas próximas.";
  if (locale === "fr") return "Vous n'avez aucun rendez-vous à venir.";
  return "You don't have any upcoming appointments.";
}

export function sayAppointmentLine(
  serviceName: string,
  businessName: string,
  staffName: string,
  when: string,
  code: string,
  extraCount: number,
  locale: Locale,
  extraKind: "series" | "group" = "series",
): string {
  let suffix = "";
  if (extraCount > 0) {
    if (extraKind === "group") {
      suffix =
        locale === "es"
          ? ` (más ${extraCount} en este grupo)`
          : locale === "fr"
            ? ` (plus ${extraCount} autres dans ce groupe)`
            : ` (plus ${extraCount} more in this group)`;
    } else {
      suffix =
        locale === "es"
          ? ` (más ${extraCount} en esta serie)`
          : locale === "fr"
            ? ` (plus ${extraCount} autres dans cette série)`
            : ` (plus ${extraCount} more in this series)`;
    }
  }
  if (locale === "es") return `${serviceName} en ${businessName} con ${staffName} el ${when}, código ${code}${suffix}`;
  if (locale === "fr") return `${serviceName} chez ${businessName} avec ${staffName} le ${when}, code ${code}${suffix}`;
  return `${serviceName} at ${businessName} with ${staffName} on ${when}, code ${code}${suffix}`;
}

export function sayWaitlistOfferLine(serviceName: string, businessName: string, when: string, staffName: string, locale: Locale): string {
  if (locale === "es") {
    return `Buenas noticias: se abrió un espacio para ${serviceName} en ${businessName} el ${when} con ${staffName}; di confirmar para tomarlo.`;
  }
  if (locale === "fr") {
    return `Bonne nouvelle : une place s'est libérée pour ${serviceName} chez ${businessName} le ${when} avec ${staffName} ; dites confirmer pour la prendre.`;
  }
  return `Good news: a spot opened up for ${serviceName} at ${businessName} on ${when} with ${staffName}; say confirm to grab it.`;
}

export function sayAppointmentSummary(count: number, lines: string[], locale: Locale): string {
  if (locale === "es") return `Tienes ${count} cita${count === 1 ? "" : "s"}: ${lines.join(". ")}.`;
  if (locale === "fr") return `Vous avez ${count} rendez-vous : ${lines.join(". ")}.`;
  return `You have ${count} appointment${count === 1 ? "" : "s"}: ${lines.join(". ")}.`;
}

export function sayRescheduled(when: string, staffName: string, seriesShiftedCount: number | undefined, locale: Locale): string {
  let s =
    locale === "es"
      ? `Listo. Tu cita ahora es ${when} con ${staffName}.`
      : locale === "fr"
        ? `C'est fait. Votre rendez-vous est maintenant ${when} avec ${staffName}.`
        : `Done. Your appointment is now ${when} with ${staffName}.`;
  if (seriesShiftedCount && seriesShiftedCount > 1) {
    const n = seriesShiftedCount - 1;
    if (locale === "es") s += ` También moví el resto de la serie — ${n} ocurrencia${n === 1 ? "" : "s"} más.`;
    else if (locale === "fr") s += ` J'ai aussi déplacé le reste de la série — ${n} occurrence${n === 1 ? "" : "s"} de plus.`;
    else s += ` I moved the rest of the series too — ${n} more occurrence${n === 1 ? "" : "s"}.`;
  }
  return s;
}

export function sayCancelled(lateFee: boolean, cancelNoticeHours: number, seriesCancelledCount: number | undefined, locale: Locale): string {
  let s: string;
  if (locale === "es") {
    s = lateFee
      ? `Cancelado. Como es dentro de las ${cancelNoticeHours} horas antes de la cita, puede aplicar un cargo por cancelación tardía.`
      : "Cancelado. Sin cargo porque avisaste con suficiente tiempo.";
  } else if (locale === "fr") {
    s = lateFee
      ? `Annulé. Comme c'est dans les ${cancelNoticeHours} heures avant le rendez-vous, des frais d'annulation tardive peuvent s'appliquer.`
      : "Annulé. Aucun frais, car vous avez prévenu à temps.";
  } else {
    s = lateFee
      ? `Cancelled. Since that's within ${cancelNoticeHours} hours of the appointment, a late cancellation fee may apply.`
      : "Cancelled. No fee since you gave enough notice.";
  }
  if (seriesCancelledCount && seriesCancelledCount > 1) {
    const n = seriesCancelledCount - 1;
    if (locale === "es") s += ` También cancelé las otras ${n} ocurrencia${n === 1 ? "" : "s"} próximas de la serie.`;
    else if (locale === "fr") s += ` J'ai aussi annulé les ${n} autre${n === 1 ? "" : "s"} occurrence${n === 1 ? "" : "s"} à venir de la série.`;
    else s += ` I also cancelled the other ${n} upcoming occurrence${n === 1 ? "" : "s"} in the series.`;
  }
  return s;
}

export function sayAlreadyCancelled(locale: Locale): string {
  if (locale === "es") return "Esa cita ya está cancelada.";
  if (locale === "fr") return "Ce rendez-vous est déjà annulé.";
  return "That appointment is already cancelled.";
}

export function sayWaitlistJoined(serviceName: string, businessName: string, windowLabel: string, locale: Locale): string {
  if (locale === "es") return `Estás en la lista de espera para ${serviceName} en ${businessName}, ${windowLabel}. Te avisaré si se abre un espacio.`;
  if (locale === "fr") return `Vous êtes sur la liste d'attente pour ${serviceName} chez ${businessName}, ${windowLabel}. Je vous préviendrai si une place se libère.`;
  return `You're on the waitlist for ${serviceName} at ${businessName}, ${windowLabel}. I'll let you know if a spot opens up.`;
}

export function sayItemAvailable(
  productName: string,
  businessName: string,
  stockQty: number,
  priceCents: number,
  formatMoney: (cents: number) => string,
  locale: Locale,
): string {
  if (locale === "es") return `${businessName} tiene ${stockQty} ${productName}, a ${formatMoney(priceCents)} cada uno.`;
  if (locale === "fr") return `${businessName} a ${stockQty} ${productName} en stock, à ${formatMoney(priceCents)} chacun.`;
  return `${businessName} has ${stockQty} ${productName} left, at ${formatMoney(priceCents)} each.`;
}

export function sayItemOutOfStock(productName: string, businessName: string, locale: Locale): string {
  if (locale === "es") return `${businessName} no tiene ${productName} en este momento.`;
  if (locale === "fr") return `${businessName} n'a plus de ${productName} pour le moment.`;
  return `${businessName} is out of ${productName} right now.`;
}

export function sayNoOrders(locale: Locale): string {
  if (locale === "es") return "No tienes pedidos activos.";
  if (locale === "fr") return "Vous n'avez aucune commande en cours.";
  return "You don't have any active orders.";
}

export function sayOrderLine(productName: string, businessName: string, quantity: number, pickupLabel: string, code: string, locale: Locale): string {
  if (locale === "es") return `${quantity} ${productName} de ${businessName}, listo ${pickupLabel}, código ${code}`;
  if (locale === "fr") return `${quantity} ${productName} chez ${businessName}, prêt ${pickupLabel}, code ${code}`;
  return `${quantity} ${productName} from ${businessName}, ready ${pickupLabel}, code ${code}`;
}

export function sayOrderSummary(count: number, lines: string[], locale: Locale): string {
  if (locale === "es") return `Tienes ${count} pedido${count === 1 ? "" : "s"}: ${lines.join(". ")}.`;
  if (locale === "fr") return `Vous avez ${count} commande${count === 1 ? "" : "s"} : ${lines.join(". ")}.`;
  return `You have ${count} order${count === 1 ? "" : "s"}: ${lines.join(". ")}.`;
}

export function sayOrderCancelled(locale: Locale): string {
  if (locale === "es") return "Pedido cancelado.";
  if (locale === "fr") return "Commande annulée.";
  return "Order cancelled.";
}

export function sayOrderAlreadyCancelled(locale: Locale): string {
  if (locale === "es") return "Ese pedido ya está cancelado.";
  if (locale === "fr") return "Cette commande est déjà annulée.";
  return "That order is already cancelled.";
}
