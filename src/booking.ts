import { DateTime } from "luxon";
import { isoUtc } from "./clock.js";
import {
  fitsBusinessHours,
  isSlotFree,
  meetsLeadTime,
  staffCanPerform,
} from "./availability.js";
import { newId, randomCode } from "./codes.js";
import type { Store } from "./store.js";
import type { Appointment, AppointmentSource, Business, Customer, Service, Staff, WaitlistEntry } from "./types.js";

export class BookingError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BookingError";
  }
}

const HOLD_TTL_MS = 5 * 60_000;
const WAITLIST_OFFER_TTL_MS = 2 * 60 * 60_000;

export function requireBusiness(store: Store, businessId: string): Business {
  const business = store.getBusiness(businessId);
  if (!business) throw new BookingError("I couldn't find that business. Use find_businesses to look it up.");
  return business;
}

export function requireService(business: Business, serviceId: string): Service {
  const service = business.services.find((s) => s.id === serviceId);
  if (!service) throw new BookingError(`I couldn't find that service at ${business.name}. Use get_business_details to see the services.`);
  return service;
}

function resolveStaff(business: Business, service: Service, staffHint?: string): Staff[] {
  const eligible = business.staff.filter((s) => staffCanPerform(s, service.id));
  if (!staffHint) return eligible;
  const match = eligible.filter((s) => s.id === staffHint || s.name.toLowerCase() === staffHint.toLowerCase());
  if (match.length === 0) {
    throw new BookingError(`I couldn't find a staff member named "${staffHint}" who does ${service.name}. Use get_business_details to see the staff.`);
  }
  return match;
}

/** Sweeps expired holds to "expired" and reopens any waitlist offer they were holding. */
export function sweepExpiredHolds(store: Store, nowMs: number): void {
  let changed = false;
  for (const appt of store.data.appointments) {
    if (appt.status === "held" && appt.holdExpiresAt && Date.parse(appt.holdExpiresAt) <= nowMs) {
      appt.status = "expired";
      appt.updatedAt = isoUtc(nowMs);
      changed = true;
      if (appt.holdKind === "waitlist_offer") {
        const entry = store.data.waitlist.find((w) => w.offerAppointmentId === appt.id);
        if (entry && entry.status === "offered") {
          entry.status = "waiting";
          delete entry.offerAppointmentId;
        }
      }
    }
  }
  if (changed) store.touch();
}

export function findAppointmentByIdOrCode(store: Store, idOrCode: string): Appointment | undefined {
  return store.data.appointments.find((a) => a.id === idOrCode || a.code.toUpperCase() === idOrCode.toUpperCase());
}

export interface HoldResult {
  appointment: Appointment;
  business: Business;
  service: Service;
  staff: Staff;
}

export function holdAppointment(
  store: Store,
  nowMs: number,
  customerId: string,
  params: { businessId: string; serviceId: string; startIso: string; staffHint?: string; notes?: string },
): HoldResult {
  const business = requireBusiness(store, params.businessId);
  const service = requireService(business, params.serviceId);
  const candidates = resolveStaff(business, service, params.staffHint);

  const startMs = Date.parse(params.startIso);
  if (Number.isNaN(startMs)) throw new BookingError("I couldn't understand that start time. Try find_availability to get a valid time.");
  if (!meetsLeadTime(business, startMs, nowMs)) {
    throw new BookingError(`${business.name} needs at least ${business.leadTimeMin} minutes' notice. Use find_availability for the next open time.`);
  }
  if (!fitsBusinessHours(business, startMs, service.durationMin)) {
    throw new BookingError(`${business.name} is closed then. Use find_availability to find an open time.`);
  }

  let chosenStaff: Staff | undefined;
  for (const staff of candidates) {
    if (isSlotFree(business, store.data.appointments, staff.id, startMs, service.durationMin, nowMs)) {
      chosenStaff = staff;
      break;
    }
  }
  if (!chosenStaff) {
    throw new BookingError("That slot just got taken. Use find_availability again for another time.");
  }

  const customer = store.getCustomer(customerId);
  const start = DateTime.fromMillis(startMs, { zone: business.timezone });
  const end = start.plus({ minutes: service.durationMin });
  const nowIso = isoUtc(nowMs);

  const appointment: Appointment = {
    id: newId("appt"),
    code: randomCode(),
    businessId: business.id,
    serviceId: service.id,
    staffId: chosenStaff.id,
    customerId,
    customerName: customer?.name ?? "Guest",
    start: start.toISO()!,
    end: end.toISO()!,
    status: "held",
    holdExpiresAt: isoUtc(nowMs + HOLD_TTL_MS),
    holdKind: "customer",
    source: "alexa",
    notes: params.notes ?? "",
    createdAt: nowIso,
    updatedAt: nowIso,
  };
  store.data.appointments.push(appointment);
  store.touch();
  store.addEvent(business.id, "held", `${appointment.customerName} is holding ${service.name} with ${chosenStaff.name}`);

  return { appointment, business, service, staff: chosenStaff };
}

export function confirmAppointment(store: Store, nowMs: number, customerId: string, holdId: string): HoldResult {
  sweepExpiredHolds(store, nowMs);
  const appointment = findAppointmentByIdOrCode(store, holdId);
  if (!appointment) throw new BookingError("I don't see that hold anymore. Try holding the appointment again.");
  if (appointment.customerId !== customerId) throw new BookingError("That hold belongs to a different customer.");

  const business = requireBusiness(store, appointment.businessId);
  const service = requireService(business, appointment.serviceId);
  const staff = business.staff.find((s) => s.id === appointment.staffId)!;

  if (appointment.status === "confirmed") {
    return { appointment, business, service, staff }; // idempotent
  }
  if (appointment.status !== "held") {
    throw new BookingError("That hold expired. Use find_availability for a new time.");
  }

  appointment.status = "confirmed";
  appointment.holdExpiresAt = null;
  appointment.updatedAt = isoUtc(nowMs);
  store.touch();

  if (appointment.holdKind === "waitlist_offer") {
    const entry = store.data.waitlist.find((w) => w.offerAppointmentId === appointment.id);
    if (entry) entry.status = "fulfilled";
  }
  store.addEvent(business.id, "booked", `${appointment.customerName} booked ${service.name} with ${staff.name}, code ${appointment.code}`);

  return { appointment, business, service, staff };
}

export interface ManualBookResult {
  appointment: Appointment;
  business: Business;
  service: Service;
  staff: Staff;
}

/**
 * Creates a confirmed appointment directly, for a staff member taking a
 * phone call or walk-in — no hold step, since a human (not the 5-minute
 * voice hold) is doing the booking in real time.
 */
export function createManualAppointment(
  store: Store,
  nowMs: number,
  params: {
    businessId: string;
    serviceId: string;
    staffId: string;
    customerName: string;
    customerPhone?: string;
    startIso: string;
    source: AppointmentSource;
    notes?: string;
  },
): ManualBookResult {
  const business = requireBusiness(store, params.businessId);
  const service = requireService(business, params.serviceId);
  const staff = business.staff.find((s) => s.id === params.staffId);
  if (!staff) throw new BookingError(`I couldn't find that staff member at ${business.name}.`);
  if (!staffCanPerform(staff, service.id)) {
    throw new BookingError(`${staff.name} doesn't perform ${service.name} at ${business.name}.`);
  }

  const startMs = Date.parse(params.startIso);
  if (Number.isNaN(startMs)) throw new BookingError("I couldn't understand that start time.");
  if (!fitsBusinessHours(business, startMs, service.durationMin)) {
    throw new BookingError(`${business.name} is closed then.`);
  }
  if (!isSlotFree(business, store.data.appointments, staff.id, startMs, service.durationMin, nowMs)) {
    throw new BookingError("That slot is already booked for that staff member.");
  }

  const customer: Customer = params.customerPhone
    ? store.upsertCustomerByPhone(params.customerName, params.customerPhone)
    : (() => {
        const c: Customer = { id: newId("cust"), name: params.customerName, phone: "" };
        store.data.customers.push(c);
        store.touch();
        return c;
      })();

  const start = DateTime.fromMillis(startMs, { zone: business.timezone });
  const end = start.plus({ minutes: service.durationMin });
  const nowIso = isoUtc(nowMs);

  const appointment: Appointment = {
    id: newId("appt"),
    code: randomCode(),
    businessId: business.id,
    serviceId: service.id,
    staffId: staff.id,
    customerId: customer.id,
    customerName: customer.name,
    start: start.toISO()!,
    end: end.toISO()!,
    status: "confirmed",
    holdExpiresAt: null,
    holdKind: null,
    source: params.source,
    notes: params.notes ?? "",
    createdAt: nowIso,
    updatedAt: nowIso,
  };
  store.data.appointments.push(appointment);
  store.touch();
  store.addEvent(
    business.id,
    "booked",
    `${appointment.customerName} booked ${service.name} with ${staff.name} by ${params.source}, code ${appointment.code}`,
  );

  return { appointment, business, service, staff };
}

function windowCoversStart(entry: WaitlistEntry, startIso: string, timezone: string): boolean {
  const start = DateTime.fromISO(startIso, { zone: timezone });
  const dateIso = start.toISODate()!;
  if (dateIso < entry.fromDay || dateIso > entry.toDay) return false;
  if (entry.band) {
    const minuteOfDay = start.hour * 60 + start.minute;
    if (minuteOfDay < entry.band[0] || minuteOfDay >= entry.band[1]) return false;
  }
  return true;
}

/** Offers a freshly-freed slot to the first matching waiting waitlist entry. */
function offerFreedSlotToWaitlist(store: Store, nowMs: number, business: Business, freed: Appointment): Appointment | null {
  const candidates = store.data.waitlist
    .filter(
      (w) =>
        w.status === "waiting" &&
        w.businessId === business.id &&
        w.serviceId === freed.serviceId &&
        (!w.staffId || w.staffId === freed.staffId) &&
        windowCoversStart(w, freed.start, business.timezone),
    )
    .sort((a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt));

  const entry = candidates[0];
  if (!entry) return null;

  const nowIso = isoUtc(nowMs);
  const offerAppointment: Appointment = {
    id: newId("appt"),
    code: randomCode(),
    businessId: business.id,
    serviceId: freed.serviceId,
    staffId: freed.staffId,
    customerId: entry.customerId,
    customerName: entry.customerName,
    start: freed.start,
    end: freed.end,
    status: "held",
    holdExpiresAt: isoUtc(nowMs + WAITLIST_OFFER_TTL_MS),
    holdKind: "waitlist_offer",
    source: "alexa",
    notes: "",
    createdAt: nowIso,
    updatedAt: nowIso,
  };
  store.data.appointments.push(offerAppointment);
  entry.status = "offered";
  entry.offerAppointmentId = offerAppointment.id;
  store.touch();
  store.addEvent(business.id, "waitlist_offer", `${entry.customerName} was offered the slot freed at ${freed.start}`);
  return offerAppointment;
}

export interface CancelResult {
  appointment: Appointment;
  business: Business;
  service: Service;
  lateFee: boolean;
  alreadyCancelled: boolean;
  waitlistOffered: Appointment | null;
}

export function cancelAppointment(store: Store, nowMs: number, customerId: string, idOrCode: string): CancelResult {
  sweepExpiredHolds(store, nowMs);
  const appointment = findAppointmentByIdOrCode(store, idOrCode);
  if (!appointment) throw new BookingError("I couldn't find that appointment. Use list_my_appointments to check the code.");
  if (appointment.customerId !== customerId) throw new BookingError("That appointment belongs to a different customer.");

  const business = requireBusiness(store, appointment.businessId);
  const service = requireService(business, appointment.serviceId);

  if (appointment.status === "cancelled" || appointment.status === "expired") {
    return { appointment, business, service, lateFee: false, alreadyCancelled: true, waitlistOffered: null };
  }

  const wasConfirmed = appointment.status === "confirmed";
  const noticeMs = business.cancelNoticeHours * 3_600_000;
  const lateFee = wasConfirmed && Date.parse(appointment.start) - nowMs < noticeMs;

  appointment.status = "cancelled";
  appointment.updatedAt = isoUtc(nowMs);
  store.touch();
  store.addEvent(business.id, "cancelled", `${appointment.customerName} cancelled ${service.name}, code ${appointment.code}`);

  const waitlistOffered = offerFreedSlotToWaitlist(store, nowMs, business, appointment);

  return { appointment, business, service, lateFee, alreadyCancelled: false, waitlistOffered };
}

export interface RescheduleResult {
  appointment: Appointment;
  business: Business;
  service: Service;
  staff: Staff;
  waitlistOffered: Appointment | null;
}

export function rescheduleAppointment(
  store: Store,
  nowMs: number,
  customerId: string,
  params: { idOrCode: string; newStartIso: string; staffHint?: string },
): RescheduleResult {
  sweepExpiredHolds(store, nowMs);
  const appointment = findAppointmentByIdOrCode(store, params.idOrCode);
  if (!appointment) throw new BookingError("I couldn't find that appointment. Use list_my_appointments to check the code.");
  if (appointment.customerId !== customerId) throw new BookingError("That appointment belongs to a different customer.");
  if (appointment.status === "cancelled" || appointment.status === "expired") {
    throw new BookingError("That appointment is no longer active, so it can't be rescheduled.");
  }

  const business = requireBusiness(store, appointment.businessId);
  const service = requireService(business, appointment.serviceId);
  const staffCandidates = params.staffHint
    ? resolveStaff(business, service, params.staffHint)
    : [business.staff.find((s) => s.id === appointment.staffId)!];
  const newStaff = staffCandidates[0];

  const newStartMs = Date.parse(params.newStartIso);
  if (Number.isNaN(newStartMs)) throw new BookingError("I couldn't understand that new time. Try find_availability to get a valid time.");
  if (!meetsLeadTime(business, newStartMs, nowMs)) {
    throw new BookingError(`${business.name} needs at least ${business.leadTimeMin} minutes' notice. Use find_availability for the next open time.`);
  }
  if (!fitsBusinessHours(business, newStartMs, service.durationMin)) {
    throw new BookingError(`${business.name} is closed then. Use find_availability to find an open time.`);
  }
  if (!isSlotFree(business, store.data.appointments, newStaff.id, newStartMs, service.durationMin, nowMs, appointment.id)) {
    throw new BookingError("That new time just got taken. Use find_availability again for another time.");
  }

  const freedSnapshot: Appointment = { ...appointment };

  const start = DateTime.fromMillis(newStartMs, { zone: business.timezone });
  const end = start.plus({ minutes: service.durationMin });
  appointment.start = start.toISO()!;
  appointment.end = end.toISO()!;
  appointment.staffId = newStaff.id;
  appointment.updatedAt = isoUtc(nowMs);
  store.touch();
  store.addEvent(business.id, "rescheduled", `${appointment.customerName} moved ${service.name} to ${appointment.start}`);

  const waitlistOffered = offerFreedSlotToWaitlist(store, nowMs, business, freedSnapshot);

  return { appointment, business, service, staff: newStaff, waitlistOffered };
}

export function listMyAppointments(store: Store, nowMs: number, customerId: string): Appointment[] {
  sweepExpiredHolds(store, nowMs);
  return store.data.appointments
    .filter((a) => a.customerId === customerId && (a.status === "held" || a.status === "confirmed"))
    .sort((a, b) => Date.parse(a.start) - Date.parse(b.start));
}

export function joinWaitlist(
  store: Store,
  nowMs: number,
  customerId: string,
  params: { businessId: string; serviceId: string; window: { fromDay: string; toDay: string; band?: [number, number]; label: string } },
): WaitlistEntry {
  const business = requireBusiness(store, params.businessId);
  requireService(business, params.serviceId);
  const customer = store.getCustomer(customerId);

  const existing = store.data.waitlist.find(
    (w) =>
      w.status === "waiting" &&
      w.customerId === customerId &&
      w.businessId === params.businessId &&
      w.serviceId === params.serviceId &&
      w.fromDay === params.window.fromDay &&
      w.toDay === params.window.toDay,
  );
  if (existing) return existing;

  const entry: WaitlistEntry = {
    id: newId("wait"),
    businessId: params.businessId,
    serviceId: params.serviceId,
    staffId: null,
    customerId,
    customerName: customer?.name ?? "Guest",
    windowLabel: params.window.label,
    fromDay: params.window.fromDay,
    toDay: params.window.toDay,
    band: params.window.band ?? null,
    createdAt: isoUtc(nowMs),
    status: "waiting",
  };
  store.data.waitlist.push(entry);
  store.touch();
  store.addEvent(business.id, "waitlist", `${entry.customerName} joined the waitlist for ${params.window.label}`);
  return entry;
}
