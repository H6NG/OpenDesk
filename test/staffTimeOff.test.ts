import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { DateTime } from "luxon";
import { Store } from "../src/store.js";
import { BookingError } from "../src/booking.js";
import { addStaffTimeOff, removeStaffTimeOff, listStaffTimeOff } from "../src/staffTimeOff.js";
import { findAvailability, isSlotFree } from "../src/availability.js";

const BUSINESS_ID = "maple-street-barbers";
const STAFF_ID = "sam";
const SERVICE_ID = "mens-cut";

async function freshStore(): Promise<Store> {
  const store = await Store.load(":memory:");
  store.data.appointments = []; // isolate from the randomized demo seed
  store.data.staffTimeOff = [];
  store.data.events = [];
  return store;
}

describe("addStaffTimeOff / removeStaffTimeOff / listStaffTimeOff", () => {
  it("adds a block, lists only future/ongoing ones, and removes it", async () => {
    const store = await freshStore();
    const nowMs = DateTime.fromISO("2026-10-20T08:00:00", { zone: "America/Los_Angeles" }).toMillis();
    const entry = addStaffTimeOff(store, nowMs, {
      businessId: BUSINESS_ID,
      staffId: STAFF_ID,
      fromIso: "2026-10-22T09:00:00-07:00",
      toIso: "2026-10-22T17:00:00-07:00",
      reason: "sick",
    });
    assert.equal(entry.staffId, STAFF_ID);

    const listed = listStaffTimeOff(store, BUSINESS_ID, nowMs);
    assert.equal(listed.length, 1);
    assert.equal(listed[0].id, entry.id);

    removeStaffTimeOff(store, entry.id);
    assert.equal(listStaffTimeOff(store, BUSINESS_ID, nowMs).length, 0);
  });

  it("excludes blocks that have already ended", async () => {
    const store = await freshStore();
    const nowMs = DateTime.fromISO("2026-10-20T08:00:00", { zone: "America/Los_Angeles" }).toMillis();
    addStaffTimeOff(store, nowMs, { businessId: BUSINESS_ID, staffId: STAFF_ID, fromIso: "2026-10-10T09:00:00-07:00", toIso: "2026-10-10T17:00:00-07:00" });
    assert.equal(listStaffTimeOff(store, BUSINESS_ID, nowMs).length, 0);
  });

  it("rejects an unknown staff member and a backwards range", async () => {
    const store = await freshStore();
    const nowMs = Date.now();
    assert.throws(
      () => addStaffTimeOff(store, nowMs, { businessId: BUSINESS_ID, staffId: "nonexistent", fromIso: "2026-10-22T09:00:00-07:00", toIso: "2026-10-22T17:00:00-07:00" }),
      BookingError,
    );
    assert.throws(
      () => addStaffTimeOff(store, nowMs, { businessId: BUSINESS_ID, staffId: STAFF_ID, fromIso: "2026-10-22T17:00:00-07:00", toIso: "2026-10-22T09:00:00-07:00" }),
      BookingError,
    );
  });

  it("removing an unknown id throws", async () => {
    const store = await freshStore();
    assert.throws(() => removeStaffTimeOff(store, "nonexistent"), BookingError);
  });
});

describe("staff time-off integrated into availability", () => {
  it("excludes a blocked staff member from findAvailability during their time off", async () => {
    const store = await freshStore();
    const business = store.getBusiness(BUSINESS_ID)!;
    const service = business.services.find((s) => s.id === SERVICE_ID)!;
    const nowMs = DateTime.fromISO("2026-10-20T08:00:00", { zone: "America/Los_Angeles" }).toMillis(); // Tuesday

    addStaffTimeOff(store, nowMs, {
      businessId: BUSINESS_ID,
      staffId: STAFF_ID,
      fromIso: "2026-10-20T00:00:00-07:00",
      toIso: "2026-10-21T00:00:00-07:00",
    });

    const slots = findAvailability({
      business,
      service,
      window: { fromDay: "2026-10-20", toDay: "2026-10-20", label: "test" },
      staffFilter: STAFF_ID,
      limit: 5,
      nowMs,
      appointments: store.data.appointments,
      staffTimeOff: store.data.staffTimeOff,
    });
    assert.equal(slots.length, 0);

    // The same staff member is free again the next day.
    const nextDaySlots = findAvailability({
      business,
      service,
      window: { fromDay: "2026-10-21", toDay: "2026-10-21", label: "test" },
      staffFilter: STAFF_ID,
      limit: 5,
      nowMs,
      appointments: store.data.appointments,
      staffTimeOff: store.data.staffTimeOff,
    });
    assert.ok(nextDaySlots.length > 0);
  });

  it("isSlotFree returns false during a blocked staff member's time off", async () => {
    const store = await freshStore();
    const business = store.getBusiness(BUSINESS_ID)!;
    const nowMs = DateTime.fromISO("2026-10-20T08:00:00", { zone: "America/Los_Angeles" }).toMillis();
    addStaffTimeOff(store, nowMs, {
      businessId: BUSINESS_ID,
      staffId: STAFF_ID,
      fromIso: "2026-10-20T10:00:00-07:00",
      toIso: "2026-10-20T11:00:00-07:00",
    });
    const candidateStartMs = DateTime.fromISO("2026-10-20T10:15:00", { zone: "America/Los_Angeles" }).toMillis();
    const free = isSlotFree(business, store.data.appointments, STAFF_ID, candidateStartMs, 30, nowMs, undefined, store.data.staffTimeOff);
    assert.equal(free, false);
  });
});
