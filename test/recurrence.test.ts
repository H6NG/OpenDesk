import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { DateTime } from "luxon";
import { Store } from "../src/store.js";
import { holdAppointment, confirmAppointment, cancelAppointment, rescheduleAppointment, createManualAppointment, BookingError } from "../src/booking.js";
import type { Appointment, Business } from "../src/types.js";

const BUSINESS: Business = {
  id: "biz",
  name: "Test Shop",
  category: "barber",
  keywords: [],
  address: "1 Main St",
  city: "LA",
  phone: "555",
  timezone: "America/Los_Angeles",
  hours: {
    1: [["09:00", "17:00"]],
    2: [["09:00", "17:00"]],
    3: [["09:00", "17:00"]],
    4: [["09:00", "17:00"]],
    5: [["09:00", "17:00"]],
    6: [],
    7: [],
  },
  services: [{ id: "cut", name: "Cut", durationMin: 30, priceCents: 2000 }],
  staff: [{ id: "sam", name: "Sam", title: "Barber", serviceIds: ["cut"] }],
  bufferMin: 0,
  slotStepMin: 15,
  leadTimeMin: 0,
  cancelNoticeHours: 2,
  policyNote: "",
};

const CUSTOMER_ID = "demo-customer";
const NOW_MS = DateTime.fromISO("2026-10-19T08:00:00", { zone: BUSINESS.timezone }).toMillis(); // Monday 8am
const FIRST_START_ISO = DateTime.fromISO("2026-10-19T10:00:00", { zone: BUSINESS.timezone }).toISO()!; // Monday 10am

async function freshStore(): Promise<Store> {
  const store = await Store.load(":memory:");
  store.data.businesses = [BUSINESS];
  store.data.appointments = [];
  store.data.waitlist = [];
  store.data.customers = [{ id: CUSTOMER_ID, name: "Alex Rivera", phone: "+1-310-555-0100" }];
  store.data.events = [];
  return store;
}

function pushConfirmed(store: Store, overrides: Partial<Appointment> & { id: string; start: string; end: string }): void {
  store.data.appointments.push({
    code: overrides.id.toUpperCase().slice(0, 4),
    businessId: "biz",
    serviceId: "cut",
    staffId: "sam",
    customerId: "other-customer",
    customerName: "Other Customer",
    status: "confirmed",
    holdExpiresAt: null,
    holdKind: null,
    source: "phone",
    notes: "",
    createdAt: "2026-10-01T00:00:00.000Z",
    updatedAt: "2026-10-01T00:00:00.000Z",
    ...overrides,
  });
}

describe("recurring appointments: hold + confirm", () => {
  it("books a 4-occurrence weekly series atomically, every Monday", async () => {
    const store = await freshStore();
    const { appointment: hold } = holdAppointment(store, NOW_MS, CUSTOMER_ID, {
      businessId: "biz",
      serviceId: "cut",
      startIso: FIRST_START_ISO,
      recurrence: { freq: "weekly", count: 4 },
    });
    const { seriesAppointments, seriesFreq } = confirmAppointment(store, NOW_MS, CUSTOMER_ID, hold.id);

    assert.equal(seriesFreq, "weekly");
    assert.equal(seriesAppointments?.length, 4);
    for (const a of seriesAppointments!) {
      assert.equal(a.status, "confirmed");
      assert.equal(DateTime.fromISO(a.start, { setZone: true }).weekday, 1); // Monday
      assert.equal(a.seriesId, hold.seriesId);
    }
    const confirmedInStore = store.data.appointments.filter((a) => a.seriesId === hold.seriesId && a.status === "confirmed");
    assert.equal(confirmedInStore.length, 4);
  });

  it("rejects the whole series if any occurrence conflicts, booking none of it", async () => {
    const store = await freshStore();
    // Occurrence index 2 of a weekly series starting Oct 19 would land on Nov 2.
    const conflictStart = DateTime.fromISO("2026-11-02T10:00:00", { zone: BUSINESS.timezone });
    pushConfirmed(store, {
      id: "pre-existing",
      start: conflictStart.toISO()!,
      end: conflictStart.plus({ minutes: 30 }).toISO()!,
    });

    const { appointment: hold } = holdAppointment(store, NOW_MS, CUSTOMER_ID, {
      businessId: "biz",
      serviceId: "cut",
      startIso: FIRST_START_ISO,
      recurrence: { freq: "weekly", count: 4 },
    });

    assert.throws(() => confirmAppointment(store, NOW_MS, CUSTOMER_ID, hold.id), BookingError);

    const reloadedHold = store.data.appointments.find((a) => a.id === hold.id)!;
    assert.equal(reloadedHold.status, "held"); // confirm aborted entirely
    const seriesMembers = store.data.appointments.filter((a) => a.seriesId === hold.seriesId);
    assert.equal(seriesMembers.length, 1); // no partial series was created
  });
});

describe("recurring appointments: cancel / reschedule scope", () => {
  it("cancel scope:'series' cancels the target and future occurrences but leaves past ones alone", async () => {
    const store = await freshStore();
    const { appointment: hold } = holdAppointment(store, NOW_MS, CUSTOMER_ID, {
      businessId: "biz",
      serviceId: "cut",
      startIso: FIRST_START_ISO,
      recurrence: { freq: "weekly", count: 4 },
    });
    const { seriesAppointments } = confirmAppointment(store, NOW_MS, CUSTOMER_ID, hold.id);
    const byStart = [...seriesAppointments!].sort((a, b) => Date.parse(a.start) - Date.parse(b.start));
    // byStart: [Oct19, Oct26, Nov2, Nov9]

    const laterNowMs = DateTime.fromISO("2026-10-28T08:00:00", { zone: BUSINESS.timezone }).toMillis();
    const result = cancelAppointment(store, laterNowMs, CUSTOMER_ID, byStart[2].code, "series"); // cancel Nov2 + future

    assert.equal(store.data.appointments.find((a) => a.id === byStart[0].id)!.status, "confirmed"); // past, untouched
    assert.equal(store.data.appointments.find((a) => a.id === byStart[1].id)!.status, "confirmed"); // past, untouched
    assert.equal(store.data.appointments.find((a) => a.id === byStart[2].id)!.status, "cancelled"); // target
    assert.equal(store.data.appointments.find((a) => a.id === byStart[3].id)!.status, "cancelled"); // future sibling
    assert.equal(result.seriesCancelledCount, 2);
  });

  it("reschedule scope:'series' shifts future occurrences by the same delta", async () => {
    const store = await freshStore();
    const { appointment: hold } = holdAppointment(store, NOW_MS, CUSTOMER_ID, {
      businessId: "biz",
      serviceId: "cut",
      startIso: FIRST_START_ISO,
      recurrence: { freq: "weekly", count: 3 },
    });
    const { seriesAppointments } = confirmAppointment(store, NOW_MS, CUSTOMER_ID, hold.id);
    const byStart = [...seriesAppointments!].sort((a, b) => Date.parse(a.start) - Date.parse(b.start));

    const newStart = DateTime.fromISO("2026-10-19T11:00:00", { zone: BUSINESS.timezone }).toISO()!; // 1 hour later
    const result = rescheduleAppointment(store, NOW_MS, CUSTOMER_ID, { idOrCode: byStart[0].code, newStartIso: newStart, scope: "series" });

    assert.equal(result.seriesShiftedCount, 3);
    const second = store.data.appointments.find((a) => a.id === byStart[1].id)!;
    const third = store.data.appointments.find((a) => a.id === byStart[2].id)!;
    assert.equal(DateTime.fromISO(second.start, { setZone: true }).hour, 11);
    assert.equal(DateTime.fromISO(third.start, { setZone: true }).hour, 11);
  });

  it("reschedule scope:'this' (default) leaves siblings untouched", async () => {
    const store = await freshStore();
    const { appointment: hold } = holdAppointment(store, NOW_MS, CUSTOMER_ID, {
      businessId: "biz",
      serviceId: "cut",
      startIso: FIRST_START_ISO,
      recurrence: { freq: "weekly", count: 2 },
    });
    const { seriesAppointments } = confirmAppointment(store, NOW_MS, CUSTOMER_ID, hold.id);
    const byStart = [...seriesAppointments!].sort((a, b) => Date.parse(a.start) - Date.parse(b.start));
    const originalSecondStart = byStart[1].start;

    const newStart = DateTime.fromISO("2026-10-19T11:00:00", { zone: BUSINESS.timezone }).toISO()!;
    rescheduleAppointment(store, NOW_MS, CUSTOMER_ID, { idOrCode: byStart[0].code, newStartIso: newStart });

    const second = store.data.appointments.find((a) => a.id === byStart[1].id)!;
    assert.equal(second.start, originalSecondStart);
  });
});

describe("recurring appointments: manual booking", () => {
  it("createManualAppointment with recurrence books every occurrence as confirmed directly", async () => {
    const store = await freshStore();
    const { seriesAppointments } = createManualAppointment(store, NOW_MS, {
      businessId: "biz",
      serviceId: "cut",
      staffId: "sam",
      customerName: "Walk-in Wendy",
      startIso: FIRST_START_ISO,
      source: "walk-in",
      recurrence: { freq: "weekly", count: 3 },
    });
    assert.equal(seriesAppointments?.length, 3);
    assert.ok(seriesAppointments!.every((a) => a.status === "confirmed" && a.holdExpiresAt === null));
  });
});
