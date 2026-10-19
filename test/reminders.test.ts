import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { DateTime } from "luxon";
import { Store } from "../src/store.js";
import { sweepReminders, setNotificationSink, ConsoleNotificationSink } from "../src/reminders.js";
import type { Appointment } from "../src/types.js";

const BUSINESS_ID = "maple-street-barbers";
const STAFF_ID = "sam";
const SERVICE_ID = "mens-cut";

function baseAppointment(overrides: Partial<Appointment>): Appointment {
  return {
    id: "appt-1",
    code: "AAAA",
    businessId: BUSINESS_ID,
    serviceId: SERVICE_ID,
    staffId: STAFF_ID,
    customerId: "demo-customer",
    customerName: "Test Customer",
    start: "2026-10-20T12:00:00.000-07:00",
    end: "2026-10-20T12:30:00.000-07:00",
    status: "held",
    holdExpiresAt: null,
    holdKind: null,
    source: "alexa",
    notes: "",
    createdAt: "2026-10-20T10:00:00.000Z",
    updatedAt: "2026-10-20T10:00:00.000Z",
    ...overrides,
  };
}

interface Call {
  message: string;
  kind: string;
  appointmentId: string;
}

let calls: Call[];

beforeEach(() => {
  calls = [];
  setNotificationSink({
    notify: (message, context) => {
      calls.push({ message, kind: context.kind, appointmentId: context.appointmentId });
    },
  });
});

afterEach(() => {
  setNotificationSink(new ConsoleNotificationSink());
});

async function freshStore(): Promise<Store> {
  const store = await Store.load(":memory:");
  store.data.appointments = []; // isolate from the randomized demo seed
  store.data.waitlist = [];
  store.data.events = [];
  return store;
}

describe("sweepReminders: hold expiry", () => {
  it("fires exactly one reminder once a hold has used 80% of its 5-minute TTL", async () => {
    const store = await freshStore();
    const createdMs = DateTime.fromISO("2026-10-20T10:00:00Z").toMillis();
    const ttlMs = 5 * 60_000;
    store.data.appointments.push(
      baseAppointment({
        id: "hold-1",
        status: "held",
        holdKind: "customer",
        createdAt: new Date(createdMs).toISOString(),
        holdExpiresAt: new Date(createdMs + ttlMs).toISOString(),
      }),
    );

    sweepReminders(store, createdMs + ttlMs * 0.5); // 50% elapsed: too early
    assert.equal(calls.length, 0);

    sweepReminders(store, createdMs + ttlMs * 0.85); // 85% elapsed: fires
    assert.equal(calls.length, 1);
    assert.equal(calls[0].kind, "hold_expiring");
    assert.equal(calls[0].appointmentId, "hold-1");

    sweepReminders(store, createdMs + ttlMs * 0.95); // still held, same sweep window again: no double-send
    assert.equal(calls.length, 1);
  });

  it("does not remind an already-expired hold", async () => {
    const store = await freshStore();
    const createdMs = DateTime.fromISO("2026-10-20T10:00:00Z").toMillis();
    const ttlMs = 5 * 60_000;
    store.data.appointments.push(
      baseAppointment({
        id: "hold-2",
        status: "held",
        holdKind: "customer",
        createdAt: new Date(createdMs).toISOString(),
        holdExpiresAt: new Date(createdMs + ttlMs).toISOString(),
      }),
    );

    sweepReminders(store, createdMs + ttlMs + 60_000); // past expiry
    assert.equal(calls.length, 0);
  });

  it("does not remind an already-confirmed hold", async () => {
    const store = await freshStore();
    const createdMs = DateTime.fromISO("2026-10-20T10:00:00Z").toMillis();
    const ttlMs = 5 * 60_000;
    store.data.appointments.push(
      baseAppointment({
        id: "hold-3",
        status: "confirmed",
        holdKind: null,
        holdExpiresAt: null,
        createdAt: new Date(createdMs).toISOString(),
        start: new Date(createdMs + 10 * 60 * 60_000).toISOString(), // far in the future, not an upcoming-appointment reminder either
      }),
    );

    sweepReminders(store, createdMs + ttlMs * 0.9);
    assert.equal(calls.length, 0);
  });
});

describe("sweepReminders: upcoming appointment", () => {
  it("fires once ~2 hours before start and not again on a second sweep", async () => {
    const store = await freshStore();
    const startMs = DateTime.fromISO("2026-10-20T16:00:00Z").toMillis();
    store.data.appointments.push(
      baseAppointment({
        id: "appt-2",
        status: "confirmed",
        holdKind: null,
        holdExpiresAt: null,
        start: new Date(startMs).toISOString(),
        end: new Date(startMs + 30 * 60_000).toISOString(),
      }),
    );

    sweepReminders(store, startMs - 3 * 60 * 60_000); // 3 hours out: too early
    assert.equal(calls.length, 0);

    sweepReminders(store, startMs - 90 * 60_000); // 1.5 hours out: within the 2-hour window, fires
    assert.equal(calls.length, 1);
    assert.equal(calls[0].kind, "appointment_upcoming");
    assert.equal(calls[0].appointmentId, "appt-2");

    sweepReminders(store, startMs - 30 * 60_000); // 30 min out, still confirmed: no double-send
    assert.equal(calls.length, 1);
  });

  it("logs a reminder_sent activity event", async () => {
    const store = await freshStore();
    const startMs = DateTime.fromISO("2026-10-20T16:00:00Z").toMillis();
    store.data.appointments.push(
      baseAppointment({
        id: "appt-3",
        status: "confirmed",
        holdKind: null,
        holdExpiresAt: null,
        start: new Date(startMs).toISOString(),
      }),
    );

    sweepReminders(store, startMs - 60 * 60_000);
    const events = store.data.events.filter((e) => e.type === "reminder_sent");
    assert.equal(events.length, 1);
    assert.equal(events[0].businessId, BUSINESS_ID);
  });
});
