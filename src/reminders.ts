import { isoUtc } from "./clock.js";
import type { Store } from "./store.js";

export type ReminderKind = "hold_expiring" | "appointment_upcoming";
export type NotificationKind = ReminderKind | "order_ready";

export interface NotificationContext {
  kind: NotificationKind;
  /** Set for hold/appointment reminders. */
  appointmentId?: string;
  /** Set for order-ready notifications. */
  orderId?: string;
  /** Null when the customer has no phone on file; sinks that need a destination (e.g. SMS) should skip and log rather than throw. */
  customerPhone: string | null;
  customerName: string;
  /** Explicit SMS opt-in on file for this customer. A sink that actually reaches the customer externally (e.g. SMS) must not send unless this is true — ConsoleNotificationSink is exempt since it never leaves the server. */
  smsConsent: boolean;
}

export interface NotificationSink {
  notify(message: string, context: NotificationContext): void | Promise<void>;
}

/** This sandbox has no SMS/push provider configured by default, so "sending" a notification means logging it. */
export class ConsoleNotificationSink implements NotificationSink {
  notify(message: string): void {
    console.log(`[notify] ${message}`);
  }
}

let sink: NotificationSink = new ConsoleNotificationSink();

/** Lets tests (and other callers, e.g. server.ts choosing a real SMS sink) inject a stub instead of the console sink. */
export function setNotificationSink(s: NotificationSink): void {
  sink = s;
}

/** Fires a notification through whichever sink is currently installed. Used by reminders below and by catalog.ts's order-ready flow. */
export function notify(message: string, context: NotificationContext): void {
  void sink.notify(message, context);
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
  appt: { id: string; businessId: string; customerId: string; customerName: string; holdReminderSentAt?: string | null; apptReminderSentAt?: string | null },
  nowMs: number,
  field: "holdReminderSentAt" | "apptReminderSentAt",
  kind: ReminderKind,
  message: string,
): void {
  appt[field] = isoUtc(nowMs);
  store.touch();
  store.addEvent(appt.businessId, "reminder_sent", message);
  const customer = store.getCustomer(appt.customerId);
  notify(message, { kind, appointmentId: appt.id, customerPhone: customer?.phone || null, customerName: appt.customerName, smsConsent: customer?.smsConsent === true });
}

function holdExpiringMessage(store: Store, appt: { businessId: string; customerName: string }): string {
  const business = store.getBusiness(appt.businessId);
  return `Reminder: ${appt.customerName}'s hold${business ? ` at ${business.name}` : ""} is about to expire — confirm it to keep the spot.`;
}

function appointmentUpcomingMessage(store: Store, appt: { businessId: string; customerName: string; start: string }): string {
  const business = store.getBusiness(appt.businessId);
  return `Reminder: ${appt.customerName} has an upcoming appointment${business ? ` at ${business.name}` : ""}.`;
}
