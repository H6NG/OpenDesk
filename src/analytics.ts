import { DateTime } from "luxon";
import type { Store } from "./store.js";
import type { AppointmentSource } from "./types.js";

export interface AnalyticsResult {
  businessId: string;
  days: number;
  /** Count of non-cancelled/expired appointments starting in each local hour (0-23). */
  bookingsByHour: { hour: number; count: number }[];
  /** Confirmed-appointment revenue per calendar day, oldest first, zero-filled for quiet days. */
  revenueByDay: { date: string; revenueCents: number }[];
  /** Non-cancelled/expired appointment counts by booking channel. */
  sourceSplit: { source: AppointmentSource; count: number }[];
  /**
   * Proxy no-show rate: of past appointments that were ever confirmed or
   * cancelled, the fraction cancelled inside the business's cancellation
   * notice window. There's no explicit "no-show" status in this system, so
   * a cancellation too close to the appointment to be a normal change of
   * plans stands in for one.
   */
  noShowRate: number;
  noShowSampleSize: number;
}

export function computeAnalytics(store: Store, businessId: string, nowMs: number, days: number): AnalyticsResult {
  const business = store.getBusiness(businessId);
  if (!business) throw new Error("Unknown business.");

  const nowBiz = DateTime.fromMillis(nowMs, { zone: business.timezone });
  const windowStart = nowBiz.minus({ days }).startOf("day");

  const inRange = store.data.appointments.filter((a) => {
    if (a.businessId !== businessId) return false;
    const start = DateTime.fromISO(a.start, { setZone: true });
    return start >= windowStart && start <= nowBiz;
  });

  const hourCounts = new Array(24).fill(0) as number[];
  const revenueByDayMap = new Map<string, number>();
  for (let d = windowStart; d <= nowBiz; d = d.plus({ days: 1 })) {
    revenueByDayMap.set(d.toISODate()!, 0);
  }
  const sourceCounts: Record<AppointmentSource, number> = { alexa: 0, phone: 0, "walk-in": 0 };

  for (const a of inRange) {
    if (a.status === "cancelled" || a.status === "expired") continue;
    const start = DateTime.fromISO(a.start, { setZone: true });
    hourCounts[start.hour] += 1;
    sourceCounts[a.source] += 1;
    if (a.status === "confirmed") {
      const service = business.services.find((s) => s.id === a.serviceId);
      if (service) {
        const dateIso = start.toISODate()!;
        revenueByDayMap.set(dateIso, (revenueByDayMap.get(dateIso) ?? 0) + service.priceCents);
      }
    }
  }

  const noticeMs = business.cancelNoticeHours * 3_600_000;
  const pastAppointments = inRange.filter((a) => Date.parse(a.start) < nowMs && (a.status === "confirmed" || a.status === "cancelled"));
  const lateCancellations = pastAppointments.filter(
    (a) => a.status === "cancelled" && Date.parse(a.start) - Date.parse(a.updatedAt) < noticeMs,
  );

  return {
    businessId,
    days,
    bookingsByHour: hourCounts.map((count, hour) => ({ hour, count })),
    revenueByDay: [...revenueByDayMap.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([date, revenueCents]) => ({ date, revenueCents })),
    sourceSplit: (Object.keys(sourceCounts) as AppointmentSource[]).map((source) => ({ source, count: sourceCounts[source] })),
    noShowRate: pastAppointments.length > 0 ? lateCancellations.length / pastAppointments.length : 0,
    noShowSampleSize: pastAppointments.length,
  };
}
