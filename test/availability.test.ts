import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { DateTime } from "luxon";
import { findAvailability, isOpenDuringWindow } from "../src/availability.js";
import type { Business, Appointment } from "../src/types.js";

const business: Business = {
  id: "biz",
  name: "Test Shop",
  category: "barber",
  keywords: [],
  address: "1 Main St",
  city: "LA",
  phone: "555",
  timezone: "America/Los_Angeles",
  hours: { 1: [["09:00", "17:00"]], 2: [], 3: [], 4: [], 5: [], 6: [], 7: [] },
  services: [{ id: "cut", name: "Cut", durationMin: 30, priceCents: 1000 }],
  staff: [{ id: "sam", name: "Sam", title: "Barber", serviceIds: ["cut"] }],
  bufferMin: 5,
  slotStepMin: 15,
  leadTimeMin: 30,
  cancelNoticeHours: 2,
  policyNote: "",
};

const nowBiz = DateTime.fromISO("2026-10-19T08:00:00", { zone: business.timezone }); // Monday

describe("findAvailability", () => {
  it("respects lead time and business hours", () => {
    const slots = findAvailability({
      business,
      service: business.services[0],
      window: { fromDay: "2026-10-19", toDay: "2026-10-19", label: "x" },
      limit: 3,
      nowMs: nowBiz.toMillis(),
      appointments: [],
    });
    assert.ok(slots.length > 0);
    for (const s of slots) {
      assert.ok(DateTime.fromISO(s.start).toMillis() >= nowBiz.toMillis() + 30 * 60_000);
    }
  });

  it("excludes busy intervals with buffer applied", () => {
    const busyAppt: Appointment = {
      id: "a1",
      code: "AAAA",
      businessId: "biz",
      serviceId: "cut",
      staffId: "sam",
      customerId: "c1",
      customerName: "C",
      start: "2026-10-19T09:00:00.000-07:00",
      end: "2026-10-19T09:30:00.000-07:00",
      status: "confirmed",
      holdExpiresAt: null,
      holdKind: null,
      source: "phone",
      notes: "",
      createdAt: "",
      updatedAt: "",
    };
    const slots = findAvailability({
      business,
      service: business.services[0],
      window: { fromDay: "2026-10-19", toDay: "2026-10-19", band: [540, 600], label: "x" },
      limit: 8,
      nowMs: nowBiz.toMillis(),
      appointments: [busyAppt],
    });
    // 9:00-9:30 booked + 5min buffer -> next slot must start at/after 9:35.
    for (const s of slots) {
      const d = DateTime.fromISO(s.start, { setZone: true });
      const startMin = d.hour * 60 + d.minute;
      assert.ok(startMin >= 9 * 60 + 35 || startMin + 30 <= 9 * 60);
    }
  });

  it("ignores expired holds", () => {
    const expiredHold: Appointment = {
      id: "a2",
      code: "BBBB",
      businessId: "biz",
      serviceId: "cut",
      staffId: "sam",
      customerId: "c1",
      customerName: "C",
      start: "2026-10-19T10:00:00.000-07:00",
      end: "2026-10-19T10:30:00.000-07:00",
      status: "held",
      holdExpiresAt: "2026-10-19T07:00:00.000-07:00",
      holdKind: "customer",
      source: "alexa",
      notes: "",
      createdAt: "",
      updatedAt: "",
    };
    const slots = findAvailability({
      business,
      service: business.services[0],
      window: { fromDay: "2026-10-19", toDay: "2026-10-19", band: [600, 630], label: "x" },
      limit: 8,
      nowMs: nowBiz.toMillis(),
      appointments: [expiredHold],
    });
    assert.ok(slots.some((s) => s.start.includes("T10:00:00")));
  });

  it("sorts exact-time requests by distance", () => {
    const exact = DateTime.fromISO("2026-10-19T12:00:00", { zone: business.timezone });
    const slots = findAvailability({
      business,
      service: business.services[0],
      window: { fromDay: "2026-10-19", toDay: "2026-10-19", exact, label: "x" },
      limit: 3,
      nowMs: nowBiz.toMillis(),
      appointments: [],
    });
    assert.ok(slots.length > 0);
    assert.equal(slots[0].start.includes("T12:00:00"), true);
  });

  it("does not cap a single-day search at 2 slots", () => {
    const slots = findAvailability({
      business,
      service: business.services[0],
      window: { fromDay: "2026-10-19", toDay: "2026-10-19", label: "x" },
      limit: 8,
      nowMs: nowBiz.toMillis(),
      appointments: [],
    });
    assert.ok(slots.length > 2);
  });

  it("caps multi-day searches at 2 per day with 30-minute spacing", () => {
    // Monday (10-19) is the only open day in this fixture within the range,
    // so the cap of 2-per-day should still apply even though just one day qualifies.
    const slots = findAvailability({
      business,
      service: business.services[0],
      window: { fromDay: "2026-10-19", toDay: "2026-10-25", label: "x" },
      limit: 8,
      nowMs: nowBiz.toMillis(),
      appointments: [],
    });
    assert.equal(slots.length, 2);
    const gapMin = DateTime.fromISO(slots[1].start).diff(DateTime.fromISO(slots[0].start), "minutes").minutes;
    assert.ok(gapMin >= 30);
  });

  it("isOpenDuringWindow is false for a fully closed day", () => {
    assert.equal(isOpenDuringWindow(business, "2026-10-20", "2026-10-20"), false); // Tuesday, closed in fixture
    assert.equal(isOpenDuringWindow(business, "2026-10-19", "2026-10-19"), true); // Monday, open
  });
});
