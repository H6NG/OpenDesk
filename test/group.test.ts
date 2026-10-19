import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { DateTime } from "luxon";
import { Store } from "../src/store.js";
import { holdAppointment, confirmAppointment, createManualAppointment, BookingError } from "../src/booking.js";
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
  staff: [
    { id: "sam", name: "Sam", title: "Barber", serviceIds: ["cut"] },
    { id: "priya", name: "Priya", title: "Barber", serviceIds: ["cut"] },
    { id: "jess", name: "Jess", title: "Barber", serviceIds: ["cut"] },
  ],
  bufferMin: 0,
  slotStepMin: 15,
  leadTimeMin: 0,
  cancelNoticeHours: 2,
  policyNote: "",
};

const CUSTOMER_ID = "demo-customer";
const NOW_MS = DateTime.fromISO("2026-10-19T08:00:00", { zone: BUSINESS.timezone }).toMillis(); // Monday 8am
const START_ISO = DateTime.fromISO("2026-10-19T10:00:00", { zone: BUSINESS.timezone }).toISO()!; // Monday 10am

async function freshStore(): Promise<Store> {
  const store = await Store.load(":memory:");
  store.data.businesses = [BUSINESS];
  store.data.appointments = [];
  store.data.waitlist = [];
  store.data.customers = [{ id: CUSTOMER_ID, name: "Alex Rivera", phone: "+1-310-555-0100" }];
  store.data.events = [];
  return store;
}

function pushConfirmed(store: Store, overrides: Partial<Appointment> & { id: string; start: string; end: string; staffId: string }): void {
  store.data.appointments.push({
    code: overrides.id.toUpperCase().slice(0, 4),
    businessId: "biz",
    serviceId: "cut",
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

describe("group bookings: hold + confirm", () => {
  it("books a 3-person party atomically, each attendee with a different staff member", async () => {
    const store = await freshStore();
    const { appointment: hold } = holdAppointment(store, NOW_MS, CUSTOMER_ID, {
      businessId: "biz",
      serviceId: "cut",
      startIso: START_ISO,
      party: { count: 3, names: ["Mia", "Liam", "Noah"] },
    });
    assert.equal(hold.customerName, "Mia");

    const { groupAppointments } = confirmAppointment(store, NOW_MS, CUSTOMER_ID, hold.id);
    assert.equal(groupAppointments?.length, 3);
    assert.deepEqual(
      groupAppointments!.map((a) => a.customerName).sort(),
      ["Liam", "Mia", "Noah"],
    );
    const staffIds = groupAppointments!.map((a) => a.staffId);
    assert.equal(new Set(staffIds).size, 3); // each attendee got a distinct staff member
    for (const a of groupAppointments!) {
      assert.equal(a.status, "confirmed");
      assert.equal(a.start, hold.start);
      assert.equal(a.groupId, hold.groupId);
    }
  });

  it("defaults to the caller's own name plus 'Guest N' when no names are given", async () => {
    const store = await freshStore();
    const { appointment: hold } = holdAppointment(store, NOW_MS, CUSTOMER_ID, {
      businessId: "biz",
      serviceId: "cut",
      startIso: START_ISO,
      party: { count: 2 },
    });
    assert.equal(hold.customerName, "Alex Rivera");
    const { groupAppointments } = confirmAppointment(store, NOW_MS, CUSTOMER_ID, hold.id);
    assert.deepEqual(
      groupAppointments!.map((a) => a.customerName).sort(),
      ["Alex Rivera", "Guest 2"],
    );
  });

  it("rejects a group booking immediately if too few staff perform the service", async () => {
    const store = await freshStore();
    assert.throws(
      () =>
        holdAppointment(store, NOW_MS, CUSTOMER_ID, {
          businessId: "biz",
          serviceId: "cut",
          startIso: START_ISO,
          party: { count: 4 }, // only 3 staff can perform "cut"
        }),
      BookingError,
    );
  });

  it("rejects the whole group at confirm time if not enough staff are free, leaving the hold intact", async () => {
    const store = await freshStore();
    // Pre-book Priya and Jess at the same time, leaving only Sam free.
    pushConfirmed(store, { id: "pre-priya", staffId: "priya", start: START_ISO, end: DateTime.fromISO(START_ISO).plus({ minutes: 30 }).toISO()! });
    pushConfirmed(store, { id: "pre-jess", staffId: "jess", start: START_ISO, end: DateTime.fromISO(START_ISO).plus({ minutes: 30 }).toISO()! });

    const { appointment: hold } = holdAppointment(store, NOW_MS, CUSTOMER_ID, {
      businessId: "biz",
      serviceId: "cut",
      startIso: START_ISO,
      staffHint: "Sam",
      party: { count: 3, names: ["Mia", "Liam", "Noah"] },
    });

    assert.throws(() => confirmAppointment(store, NOW_MS, CUSTOMER_ID, hold.id), BookingError);
    const reloadedHold = store.data.appointments.find((a) => a.id === hold.id)!;
    assert.equal(reloadedHold.status, "held"); // confirm aborted entirely
    const groupMembers = store.data.appointments.filter((a) => a.groupId === hold.groupId);
    assert.equal(groupMembers.length, 1); // no partial group was created
  });

  it("rejects combining recurrence and party in the same booking", async () => {
    const store = await freshStore();
    assert.throws(
      () =>
        holdAppointment(store, NOW_MS, CUSTOMER_ID, {
          businessId: "biz",
          serviceId: "cut",
          startIso: START_ISO,
          recurrence: { freq: "weekly", count: 2 },
          party: { count: 2 },
        }),
      BookingError,
    );
  });

  it("confirming an already-confirmed group hold is idempotent and returns the same group", async () => {
    const store = await freshStore();
    const { appointment: hold } = holdAppointment(store, NOW_MS, CUSTOMER_ID, {
      businessId: "biz",
      serviceId: "cut",
      startIso: START_ISO,
      party: { count: 2, names: ["Mia", "Liam"] },
    });
    const first = confirmAppointment(store, NOW_MS, CUSTOMER_ID, hold.id);
    const second = confirmAppointment(store, NOW_MS, CUSTOMER_ID, hold.id);
    assert.equal(second.groupAppointments?.length, 2);
    assert.deepEqual(first.groupAppointments!.map((a) => a.id).sort(), second.groupAppointments!.map((a) => a.id).sort());
  });
});

describe("group bookings: manual booking", () => {
  it("createManualAppointment with party books every attendee as confirmed directly, each with a distinct staff member", async () => {
    const store = await freshStore();
    const { groupAppointments } = createManualAppointment(store, NOW_MS, {
      businessId: "biz",
      serviceId: "cut",
      staffId: "sam",
      customerName: "Mia",
      startIso: START_ISO,
      source: "walk-in",
      party: { count: 3, names: ["Mia", "Liam", "Noah"] },
    });
    assert.equal(groupAppointments?.length, 3);
    assert.ok(groupAppointments!.every((a) => a.status === "confirmed" && a.holdExpiresAt === null));
    assert.equal(new Set(groupAppointments!.map((a) => a.staffId)).size, 3);
  });
});
