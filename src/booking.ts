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
import type { Appointment, AppointmentSource, Business, Customer, RecurrenceFreq, RecurrenceSpec, Service, Staff, WaitlistEntry } from "./types.js";

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
  seriesAppointments?: Appointment[];
  seriesFreq?: RecurrenceFreq;
}

/** Same weekday/time (monthly keeps the same day-of-month), count occurrences including the first. */
function computeOccurrences(firstStartIso: string, freq: RecurrenceFreq, count: number, timezone: string): DateTime[] {
  const first = DateTime.fromISO(firstStartIso, { zone: timezone });
  const occurrences = [first];
  for (let i = 1; i < count; i++) {
    const prev = occurrences[i - 1];
    const next = freq === "weekly" ? prev.plus({ weeks: 1 }) : freq === "biweekly" ? prev.plus({ weeks: 2 }) : prev.plus({ months: 1 });
    occurrences.push(next);
  }
  return occurrences;
}

/** Validates every occurrence (optionally skipping the first, already checked by the caller) without mutating anything, so the whole series can be rejected atomically. */
function validateOccurrences(
  store: Store,
  nowMs: number,
  business: Business,
  service: Service,
  staff: Staff,
  occurrences: DateTime[],
  skipFirst: boolean,
): void {
  for (let i = skipFirst ? 1 : 0; i < occurrences.length; i++) {
    const startMs = occurrences[i].toMillis();
    if (!fitsBusinessHours(business, startMs, service.durationMin)) {
      throw new BookingError(
        `${business.name} is closed on ${occurrences[i].toFormat("cccc, LLL d")}, so the whole series can't be booked as requested.`,
      );
    }
    if (!isSlotFree(business, store.data.appointments, staff.id, startMs, service.durationMin, nowMs)) {
      throw new BookingError(
        `${staff.name} is already booked on ${occurrences[i].toFormat("cccc, LLL d")}, so the whole series can't be booked as requested.`,
      );
    }
  }
}

function validateRecurrence(recurrence: RecurrenceSpec): void {
  if (!Number.isInteger(recurrence.count) || recurrence.count < 1) {
    throw new BookingError("Recurrence count must be at least 1.");
  }
}

export function holdAppointment(
  store: Store,
  nowMs: number,
  customerId: string,
  params: { businessId: string; serviceId: string; startIso: string; staffHint?: string; notes?: string; recurrence?: RecurrenceSpec },
): HoldResult {
  const business = requireBusiness(store, params.businessId);
  const service = requireService(business, params.serviceId);
  const candidates = resolveStaff(business, service, params.staffHint);
  if (params.recurrence) validateRecurrence(params.recurrence);

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
    seriesId: params.recurrence ? newId("series") : null,
    pendingRecurrence: params.recurrence ?? null,
  };
  store.data.appointments.push(appointment);
  store.touch();
  store.addEvent(business.id, "held", `${appointment.customerName} is holding ${service.name} with ${chosenStaff.name}`);

  return { appointment, business, service, staff: chosenStaff };
}

function seriesSiblings(store: Store, seriesId: string): Appointment[] {
  return store.data.appointments.filter((a) => a.seriesId === seriesId).sort((a, b) => Date.parse(a.start) - Date.parse(b.start));
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
    const seriesAppointments = appointment.seriesId ? seriesSiblings(store, appointment.seriesId) : undefined;
    return { appointment, business, service, staff, seriesAppointments }; // idempotent
  }
  if (appointment.status !== "held") {
    throw new BookingError("That hold expired. Use find_availability for a new time.");
  }

  let seriesAppointments: Appointment[] | undefined;
  let seriesFreq: RecurrenceFreq | undefined;
  if (appointment.pendingRecurrence) {
    const { freq, count } = appointment.pendingRecurrence;
    seriesFreq = freq;
    const occurrences = computeOccurrences(appointment.start, freq, count, business.timezone);
    validateOccurrences(store, nowMs, business, service, staff, occurrences, true);

    const nowIso = isoUtc(nowMs);
    const created: Appointment[] = [];
    for (let i = 1; i < occurrences.length; i++) {
      const start = occurrences[i];
      const end = start.plus({ minutes: service.durationMin });
      const sibling: Appointment = {
        id: newId("appt"),
        code: randomCode(),
        businessId: business.id,
        serviceId: service.id,
        staffId: staff.id,
        customerId: appointment.customerId,
        customerName: appointment.customerName,
        start: start.toISO()!,
        end: end.toISO()!,
        status: "confirmed",
        holdExpiresAt: null,
        holdKind: null,
        source: appointment.source,
        notes: appointment.notes,
        createdAt: nowIso,
        updatedAt: nowIso,
        seriesId: appointment.seriesId,
      };
      store.data.appointments.push(sibling);
      created.push(sibling);
    }
    seriesAppointments = [appointment, ...created];
  }

  appointment.status = "confirmed";
  appointment.holdExpiresAt = null;
  appointment.pendingRecurrence = null;
  appointment.updatedAt = isoUtc(nowMs);
  store.touch();

  if (appointment.holdKind === "waitlist_offer") {
    const entry = store.data.waitlist.find((w) => w.offerAppointmentId === appointment.id);
    if (entry) entry.status = "fulfilled";
  }
  const seriesNote = seriesAppointments && seriesAppointments.length > 1 ? ` (series of ${seriesAppointments.length})` : "";
  store.addEvent(business.id, "booked", `${appointment.customerName} booked ${service.name} with ${staff.name}${seriesNote}, code ${appointment.code}`);

  return { appointment, business, service, staff, seriesAppointments, seriesFreq };
}

export interface ManualBookResult {
  appointment: Appointment;
  business: Business;
  service: Service;
  staff: Staff;
  seriesAppointments?: Appointment[];
}

/**
 * Creates a confirmed appointment directly, for a staff member taking a
 * phone call or walk-in — no hold step, since a human (not the 5-minute
 * voice hold) is doing the booking in real time. If `recurrence` is given,
 * every occurrence is validated before any of them are created, so the
 * whole series books atomically or not at all.
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
    recurrence?: RecurrenceSpec;
  },
): ManualBookResult {
  const business = requireBusiness(store, params.businessId);
  const service = requireService(business, params.serviceId);
  const staff = business.staff.find((s) => s.id === params.staffId);
  if (!staff) throw new BookingError(`I couldn't find that staff member at ${business.name}.`);
  if (!staffCanPerform(staff, service.id)) {
    throw new BookingError(`${staff.name} doesn't perform ${service.name} at ${business.name}.`);
  }
  if (params.recurrence) validateRecurrence(params.recurrence);

  const startMs = Date.parse(params.startIso);
  if (Number.isNaN(startMs)) throw new BookingError("I couldn't understand that start time.");
  if (!fitsBusinessHours(business, startMs, service.durationMin)) {
    throw new BookingError(`${business.name} is closed then.`);
  }
  if (!isSlotFree(business, store.data.appointments, staff.id, startMs, service.durationMin, nowMs)) {
    throw new BookingError("That slot is already booked for that staff member.");
  }

  const start = DateTime.fromMillis(startMs, { zone: business.timezone });
  const occurrences = params.recurrence ? computeOccurrences(start.toISO()!, params.recurrence.freq, params.recurrence.count, business.timezone) : [start];
  if (params.recurrence) validateOccurrences(store, nowMs, business, service, staff, occurrences, true);

  const customer: Customer = params.customerPhone
    ? store.upsertCustomerByPhone(params.customerName, params.customerPhone)
    : (() => {
        const c: Customer = { id: newId("cust"), name: params.customerName, phone: "" };
        store.data.customers.push(c);
        store.touch();
        return c;
      })();

  const seriesId = occurrences.length > 1 ? newId("series") : null;
  const nowIso = isoUtc(nowMs);
  const created: Appointment[] = occurrences.map((occStart) => {
    const end = occStart.plus({ minutes: service.durationMin });
    return {
      id: newId("appt"),
      code: randomCode(),
      businessId: business.id,
      serviceId: service.id,
      staffId: staff.id,
      customerId: customer.id,
      customerName: customer.name,
      start: occStart.toISO()!,
      end: end.toISO()!,
      status: "confirmed",
      holdExpiresAt: null,
      holdKind: null,
      source: params.source,
      notes: params.notes ?? "",
      createdAt: nowIso,
      updatedAt: nowIso,
      seriesId,
    };
  });
  store.data.appointments.push(...created);
  store.touch();
  const seriesNote = created.length > 1 ? ` (series of ${created.length})` : "";
  store.addEvent(
    business.id,
    "booked",
    `${created[0].customerName} booked ${service.name} with ${staff.name} by ${params.source}${seriesNote}, code ${created[0].code}`,
  );

  return { appointment: created[0], business, service, staff, seriesAppointments: created.length > 1 ? created : undefined };
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
  seriesCancelledCount?: number;
}

export function cancelAppointment(
  store: Store,
  nowMs: number,
  customerId: string,
  idOrCode: string,
  scope: "this" | "series" = "this",
): CancelResult {
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

  let seriesCancelledCount: number | undefined;
  if (scope === "series" && appointment.seriesId) {
    const futureSiblings = store.data.appointments.filter(
      (a) =>
        a.seriesId === appointment.seriesId &&
        a.id !== appointment.id &&
        (a.status === "held" || a.status === "confirmed") &&
        Date.parse(a.start) >= nowMs,
    );
    for (const sibling of futureSiblings) {
      sibling.status = "cancelled";
      sibling.updatedAt = isoUtc(nowMs);
      offerFreedSlotToWaitlist(store, nowMs, business, sibling);
    }
    if (futureSiblings.length > 0) {
      store.touch();
      store.addEvent(
        business.id,
        "cancelled",
        `${appointment.customerName} cancelled the rest of the ${service.name} series (${futureSiblings.length} more occurrence${futureSiblings.length === 1 ? "" : "s"})`,
      );
    }
    seriesCancelledCount = futureSiblings.length + 1;
  }

  return { appointment, business, service, lateFee, alreadyCancelled: false, waitlistOffered, seriesCancelledCount };
}

export interface RescheduleResult {
  appointment: Appointment;
  business: Business;
  service: Service;
  staff: Staff;
  waitlistOffered: Appointment | null;
  seriesShiftedCount?: number;
}

export function rescheduleAppointment(
  store: Store,
  nowMs: number,
  customerId: string,
  params: { idOrCode: string; newStartIso: string; staffHint?: string; scope?: "this" | "series" },
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

  // Shifting the whole series preserves the gap between occurrences: every
  // future sibling moves by the same delta as this one. Validate all of
  // them before mutating anything, so the whole move is atomic.
  const scope = params.scope ?? "this";
  const deltaMs = newStartMs - Date.parse(appointment.start);
  let futureSiblings: Appointment[] = [];
  if (scope === "series" && appointment.seriesId) {
    futureSiblings = store.data.appointments.filter(
      (a) =>
        a.seriesId === appointment.seriesId &&
        a.id !== appointment.id &&
        (a.status === "held" || a.status === "confirmed") &&
        Date.parse(a.start) >= nowMs,
    );
    for (const sibling of futureSiblings) {
      const siblingNewStartMs = Date.parse(sibling.start) + deltaMs;
      const siblingStaffId = params.staffHint ? newStaff.id : sibling.staffId;
      if (!fitsBusinessHours(business, siblingNewStartMs, service.durationMin)) {
        throw new BookingError(
          `${business.name} is closed on ${DateTime.fromMillis(siblingNewStartMs, { zone: business.timezone }).toFormat("cccc, LLL d")}, so the whole series can't move that way.`,
        );
      }
      if (!isSlotFree(business, store.data.appointments, siblingStaffId, siblingNewStartMs, service.durationMin, nowMs, sibling.id)) {
        throw new BookingError(
          `That staff member is already booked on ${DateTime.fromMillis(siblingNewStartMs, { zone: business.timezone }).toFormat("cccc, LLL d")}, so the whole series can't move that way.`,
        );
      }
    }
  }

  const freedSnapshot: Appointment = { ...appointment };

  const start = DateTime.fromMillis(newStartMs, { zone: business.timezone });
  const end = start.plus({ minutes: service.durationMin });
  appointment.start = start.toISO()!;
  appointment.end = end.toISO()!;
  appointment.staffId = newStaff.id;
  appointment.updatedAt = isoUtc(nowMs);

  for (const sibling of futureSiblings) {
    const siblingNewStartMs = Date.parse(sibling.start) + deltaMs;
    const siblingStart = DateTime.fromMillis(siblingNewStartMs, { zone: business.timezone });
    const siblingEnd = siblingStart.plus({ minutes: service.durationMin });
    sibling.start = siblingStart.toISO()!;
    sibling.end = siblingEnd.toISO()!;
    if (params.staffHint) sibling.staffId = newStaff.id;
    sibling.updatedAt = isoUtc(nowMs);
  }

  store.touch();
  store.addEvent(business.id, "rescheduled", `${appointment.customerName} moved ${service.name} to ${appointment.start}`);

  const waitlistOffered = offerFreedSlotToWaitlist(store, nowMs, business, freedSnapshot);

  return { appointment, business, service, staff: newStaff, waitlistOffered, seriesShiftedCount: futureSiblings.length > 0 ? futureSiblings.length + 1 : undefined };
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
