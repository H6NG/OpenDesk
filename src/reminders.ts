import { isoUtc } from "./clock.js";
import type { Store } from "./store.js";

export type ReminderKind = "hold_expiring" | "appointment_upcoming";

export interface NotificationSink {
  notify(message: string, context: { kind: ReminderKind; appointmentId: string }): void | Promise<void>;
}

/** This sandbox has no SMS/push provider, so "sending" a notification means logging it. */
export class ConsoleNotificationSink implements NotificationSink {
  notify(message: string): void {
    console.log(`[notify] ${message}`);
  }
}

let sink: NotificationSink = new ConsoleNotificationSink();

/** Lets tests (and other callers) inject a stub instead of the console sink. */
export function setNotificationSink(s: NotificationSink): void {
  sink = s;
}

const HOLD_REMINDER_THRESHOLD = 0.8; // fire once a hold has used 80% of its TTL
const APPT_REMINDER_LEAD_MS = 2 * 60 * 60_000; // ~2 hours before start

/**
 * Sweeps holds nearing expiry and confirmed appointments nearing their start
 * time, firing at most one reminder per hold/appointment (tracked on the
 * appointment record itself so a restart doesn't double-send).
 */
export function sweepReminders(store: Store, nowMs: number): void {
  for (const appt of store.data.appointments) {
    if (appt.status === "held" && appt.holdKind === "customer" && appt.holdExpiresAt && !appt.holdReminderSentAt) {
      const expiresMs = Date.parse(appt.holdExpiresAt);
      const createdMs = Date.parse(appt.createdAt);
      const ttlMs = expiresMs - createdMs;
      const elapsedMs = nowMs - createdMs;
      if (ttlMs > 0 && nowMs < expiresMs && elapsedMs >= ttlMs * HOLD_REMINDER_THRESHOLD) {
        fire(store, appt, nowMs, "holdReminderSentAt", "hold_expiring", holdExpiringMessage(store, appt));
      }
    }

    if (appt.status === "confirmed" && !appt.apptReminderSentAt) {
      const msUntilStart = Date.parse(appt.start) - nowMs;
      if (msUntilStart > 0 && msUntilStart <= APPT_REMINDER_LEAD_MS) {
        fire(store, appt, nowMs, "apptReminderSentAt", "appointment_upcoming", appointmentUpcomingMessage(store, appt));
      }
    }
  }
}

function fire(
  store: Store,
  appt: { id: string; businessId: string; holdReminderSentAt?: string | null; apptReminderSentAt?: string | null },
  nowMs: number,
  field: "holdReminderSentAt" | "apptReminderSentAt",
  kind: ReminderKind,
  message: string,
): void {
  appt[field] = isoUtc(nowMs);
  store.touch();
  store.addEvent(appt.businessId, "reminder_sent", message);
  void sink.notify(message, { kind, appointmentId: appt.id });
}

function holdExpiringMessage(store: Store, appt: { businessId: string; customerName: string }): string {
  const business = store.getBusiness(appt.businessId);
  return `Reminder: ${appt.customerName}'s hold${business ? ` at ${business.name}` : ""} is about to expire — confirm it to keep the spot.`;
}

function appointmentUpcomingMessage(store: Store, appt: { businessId: string; customerName: string; start: string }): string {
  const business = store.getBusiness(appt.businessId);
  return `Reminder: ${appt.customerName} has an upcoming appointment${business ? ` at ${business.name}` : ""}.`;
}
