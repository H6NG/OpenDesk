import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { DateTime } from "luxon";
import { Store } from "../src/store.js";
import { computeAnalytics } from "../src/analytics.js";
import type { Appointment, Business } from "../src/types.js";

const TZ = "America/Los_Angeles";

const BUSINESS: Business = {
  id: "biz",
  name: "Test Shop",
  category: "barber",
  keywords: [],
  address: "1 Main St",
  city: "LA",
  phone: "555",
  timezone: TZ,
  hours: { 1: [["09:00", "17:00"]], 2: [["09:00", "17:00"]], 3: [], 4: [], 5: [], 6: [], 7: [] },
  services: [{ id: "cut", name: "Cut", durationMin: 30, priceCents: 2000 }],
  staff: [{ id: "sam", name: "Sam", title: "Barber", serviceIds: ["cut"] }],
  bufferMin: 0,
  slotStepMin: 15,
  leadTimeMin: 0,
  cancelNoticeHours: 24,
  policyNote: "",
};

function appt(overrides: Partial<Appointment> & { id: string; start: string }): Appointment {
  const start = DateTime.fromISO(overrides.start, { setZone: true });
  return {
    code: overrides.id.toUpperCase().slice(0, 4),
    businessId: "biz",
    serviceId: "cut",
    staffId: "sam",
    customerId: "cust",
    customerName: "Customer",
    end: start.plus({ minutes: 30 }).toISO()!,
    status: "confirmed",
    holdExpiresAt: null,
    holdKind: null,
    source: "alexa",
    notes: "",
    createdAt: "2026-10-01T00:00:00.000Z",
    updatedAt: "2026-10-01T00:00:00.000Z",
    ...overrides,
  };
}

async function freshStore(appointments: Appointment[]): Promise<Store> {
  const store = await Store.load(":memory:");
  store.data.businesses = [BUSINESS];
  store.data.appointments = appointments;
  store.data.waitlist = [];
  store.data.events = [];
  return store;
}

describe("computeAnalytics", () => {
  it("aggregates bookings-by-hour, revenue-by-day, source split, and the no-show proxy on a known fixture", async () => {
    const nowMs = DateTime.fromISO("2026-10-20T12:00:00", { zone: TZ }).toMillis(); // Tuesday noon

    const appointments: Appointment[] = [
      appt({ id: "a1", start: "2026-10-19T10:00:00.000-07:00", status: "confirmed", source: "alexa" }),
      appt({ id: "a2", start: "2026-10-19T14:00:00.000-07:00", status: "confirmed", source: "phone" }),
      // Cancelled 10 minutes before start: a late cancellation, the no-show proxy.
      appt({
        id: "a3",
        start: "2026-10-20T09:00:00.000-07:00",
        status: "cancelled",
        source: "walk-in",
        updatedAt: DateTime.fromISO("2026-10-20T09:00:00.000-07:00").minus({ minutes: 10 }).toUTC().toISO()!,
      }),
      // Cancelled 4 days ahead of start: plenty of notice, not a no-show proxy.
      appt({
        id: "a4",
        start: "2026-10-14T10:00:00.000-07:00",
        status: "cancelled",
        source: "phone",
        updatedAt: DateTime.fromISO("2026-10-14T10:00:00.000-07:00").minus({ days: 4 }).toUTC().toISO()!,
      }),
      // Still held, in the past 7 days but not yet confirmed or cancelled.
      appt({ id: "a5", start: "2026-10-20T11:30:00.000-07:00", status: "held", holdKind: "customer", source: "alexa" }),
      // Expired hold: excluded from every bucket.
      appt({ id: "a6", start: "2026-10-15T10:00:00.000-07:00", status: "expired", source: "alexa" }),
      // Outside the 7-day window entirely.
      appt({ id: "a7", start: "2026-10-05T10:00:00.000-07:00", status: "confirmed", source: "alexa" }),
    ];

    const store = await freshStore(appointments);
    const result = computeAnalytics(store, "biz", nowMs, 7);

    assert.equal(result.bookingsByHour.length, 24);
    const byHour = new Map(result.bookingsByHour.map((h) => [h.hour, h.count]));
    assert.equal(byHour.get(10), 1); // a1 (a7 is out of window, a6 is expired)
    assert.equal(byHour.get(11), 1); // a5 (held, still counted)
    assert.equal(byHour.get(14), 1); // a2
    assert.equal(byHour.get(9), 0); // a3 cancelled, excluded

    assert.equal(result.revenueByDay.length, 8); // Oct 13..Oct 20 inclusive
    assert.equal(result.revenueByDay[0].date, "2026-10-13");
    assert.equal(result.revenueByDay[result.revenueByDay.length - 1].date, "2026-10-20");
    const revByDate = new Map(result.revenueByDay.map((r) => [r.date, r.revenueCents]));
    assert.equal(revByDate.get("2026-10-19"), 4000); // a1 + a2, both confirmed $20 cuts
    assert.equal(revByDate.get("2026-10-20"), 0); // a3 cancelled, a5 not confirmed yet

    const bySource = new Map(result.sourceSplit.map((s) => [s.source, s.count]));
    assert.equal(bySource.get("alexa"), 2); // a1, a5
    assert.equal(bySource.get("phone"), 1); // a2
    assert.equal(bySource.get("walk-in"), 0); // a3 cancelled, excluded

    assert.equal(result.noShowSampleSize, 4); // a1, a2, a3, a4 (confirmed or cancelled, start in the past)
    assert.equal(result.noShowRate, 0.25); // only a3 was a late cancellation
  });

  it("returns a zero no-show rate when there's no past confirmed/cancelled sample", async () => {
    const nowMs = DateTime.fromISO("2026-10-20T12:00:00", { zone: TZ }).toMillis();
    const store = await freshStore([]);
    const result = computeAnalytics(store, "biz", nowMs, 7);
    assert.equal(result.noShowRate, 0);
    assert.equal(result.noShowSampleSize, 0);
  });
});
