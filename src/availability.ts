import { DateTime } from "luxon";
import type { Appointment, Business, Service, Staff, StaffTimeOff } from "./types.js";
import type { SpokenWindow } from "./spokenTime.js";

export interface Slot {
  start: string; // ISO, business timezone
  end: string;
  staffId: string;
  staffName: string;
  serviceId: string;
  serviceName: string;
  durationMin: number;
  priceCents: number;
}

interface BusyInterval {
  startMs: number;
  endMs: number; // buffer already included
}

const EXACT_WINDOW_BEFORE_MS = 60 * 60_000;
const EXACT_WINDOW_AFTER_MS = 90 * 60_000;
const MIN_SPACING_MS = 30 * 60_000;
const MAX_PER_DAY_MULTI_DAY = 2;

export function staffCanPerform(staff: Staff, serviceId: string): boolean {
  return staff.serviceIds.includes(serviceId);
}

/** Per-request busy index: epoch-ms intervals per staff, buffer included, expired holds ignored. Staff time-off blocks (no buffer) are folded in as plain busy intervals, so every downstream check (dayCandidates, isSlotFree) automatically respects them without its own logic. */
export function buildBusyIndex(
  business: Business,
  appointments: Appointment[],
  nowMs: number,
  staffTimeOff: StaffTimeOff[] = [],
): Map<string, BusyInterval[]> {
  const bufferMs = business.bufferMin * 60_000;
  const byStaff = new Map<string, BusyInterval[]>();
  for (const appt of appointments) {
    if (appt.businessId !== business.id) continue;
    if (appt.status === "cancelled" || appt.status === "expired") continue;
    if (appt.status === "held" && appt.holdExpiresAt && Date.parse(appt.holdExpiresAt) <= nowMs) continue;

    const startMs = Date.parse(appt.start);
    const endMs = Date.parse(appt.end) + bufferMs;
    const list = byStaff.get(appt.staffId) ?? [];
    list.push({ startMs, endMs });
    byStaff.set(appt.staffId, list);
  }
  for (const off of staffTimeOff) {
    if (off.businessId !== business.id) continue;
    const list = byStaff.get(off.staffId) ?? [];
    list.push({ startMs: Date.parse(off.fromIso), endMs: Date.parse(off.toIso) });
    byStaff.set(off.staffId, list);
  }
  for (const list of byStaff.values()) list.sort((a, b) => a.startMs - b.startMs);
  return byStaff;
}

export function overlapsBusy(candidateStartMs: number, candidateBusyEndMs: number, busy: BusyInterval[]): boolean {
  // busy is sorted; a simple linear scan is fine since a day holds few appointments per staff.
  for (const interval of busy) {
    if (candidateStartMs < interval.endMs && interval.startMs < candidateBusyEndMs) return true;
  }
  return false;
}

/** One Luxon call per calendar day (handles DST correctly); everything else is epoch-ms arithmetic. */
function dayCandidates(
  business: Business,
  service: Service,
  staff: Staff,
  dateIso: string,
  band: [number, number] | undefined,
  leadTimeFloorMs: number,
  busy: BusyInterval[],
): number[] {
  const dayStart = DateTime.fromISO(`${dateIso}T00:00:00`, { zone: business.timezone });
  const dayStartMs = dayStart.toMillis();
  const weekday = dayStart.weekday;
  const shifts = business.hours[weekday] ?? [];
  const bufferMs = business.bufferMin * 60_000;
  const durationMs = service.durationMin * 60_000;
  const stepMs = business.slotStepMin * 60_000;

  const results: number[] = [];
  for (const [shiftStartStr, shiftEndStr] of shifts) {
    const [sh, sm] = shiftStartStr.split(":").map(Number);
    const [eh, em] = shiftEndStr.split(":").map(Number);
    let fromMin = sh * 60 + sm;
    let toMin = eh * 60 + em;
    if (band) {
      fromMin = Math.max(fromMin, band[0]);
      toMin = Math.min(toMin, band[1]);
    }
    if (fromMin >= toMin) continue;

    // Round the start up to the next slot step.
    const firstStepMin = Math.ceil(fromMin / business.slotStepMin) * business.slotStepMin;
    for (let min = firstStepMin; min + service.durationMin <= toMin; min += business.slotStepMin) {
      const candidateStartMs = dayStartMs + min * 60_000;
      if (candidateStartMs < leadTimeFloorMs) continue;
      const candidateBusyEndMs = candidateStartMs + durationMs + bufferMs;
      if (overlapsBusy(candidateStartMs, candidateBusyEndMs, busy)) continue;
      results.push(candidateStartMs);
    }
  }
  results.sort((a, b) => a - b);
  return results;
}

function isoRangeDays(fromDay: string, toDay: string): string[] {
  const days: string[] = [];
  let d = DateTime.fromISO(fromDay);
  const end = DateTime.fromISO(toDay);
  while (d <= end) {
    days.push(d.toISODate()!);
    d = d.plus({ days: 1 });
  }
  return days;
}

export interface FindAvailabilityParams {
  business: Business;
  service: Service;
  window: SpokenWindow;
  staffFilter?: string;
  limit: number;
  nowMs: number;
  appointments: Appointment[];
  staffTimeOff?: StaffTimeOff[];
}

/**
 * Whole-business "is it open at all during this window" check, used by the
 * find_availability tool to distinguish "closed" from "fully booked".
 */
export function isOpenDuringWindow(business: Business, fromDay: string, toDay: string): boolean {
  for (const dateIso of isoRangeDays(fromDay, toDay)) {
    const weekday = DateTime.fromISO(dateIso).weekday;
    if ((business.hours[weekday] ?? []).length > 0) return true;
  }
  return false;
}

export function findAvailability(params: FindAvailabilityParams): Slot[] {
  const { business, service, window, staffFilter, limit, nowMs, appointments, staffTimeOff } = params;
  const busyIndex = buildBusyIndex(business, appointments, nowMs, staffTimeOff);
  const leadTimeFloorMs = nowMs + business.leadTimeMin * 60_000;

  const staffList = business.staff.filter(
    (s) => staffCanPerform(s, service.id) && (!staffFilter || s.id === staffFilter || s.name.toLowerCase() === staffFilter.toLowerCase()),
  );
  if (staffList.length === 0) return [];

  function toSlot(startMs: number, staff: Staff): Slot {
    const start = DateTime.fromMillis(startMs, { zone: business.timezone });
    const end = start.plus({ minutes: service.durationMin });
    return {
      start: start.toISO()!,
      end: end.toISO()!,
      staffId: staff.id,
      staffName: staff.name,
      serviceId: service.id,
      serviceName: service.name,
      durationMin: service.durationMin,
      priceCents: service.priceCents,
    };
  }

  if (window.exact) {
    const exactMs = window.exact.toMillis();
    const windowStart = exactMs - EXACT_WINDOW_BEFORE_MS;
    const windowEnd = exactMs + EXACT_WINDOW_AFTER_MS;
    const dateIso = window.fromDay;
    const candidates: { startMs: number; staff: Staff }[] = [];
    for (const staff of staffList) {
      const busy = busyIndex.get(staff.id) ?? [];
      for (const startMs of dayCandidates(business, service, staff, dateIso, undefined, leadTimeFloorMs, busy)) {
        if (startMs >= windowStart && startMs <= windowEnd) candidates.push({ startMs, staff });
      }
    }
    candidates.sort((a, b) => Math.abs(a.startMs - exactMs) - Math.abs(b.startMs - exactMs));
    return candidates.slice(0, limit).map((c) => toSlot(c.startMs, c.staff));
  }

  const days = isoRangeDays(window.fromDay, window.toDay);
  const multiDay = days.length > 1;
  const picked: Slot[] = [];

  for (const dateIso of days) {
    if (picked.length >= limit) break;
    const dayCandidatesByStaff: { startMs: number; staff: Staff }[] = [];
    for (const staff of staffList) {
      const busy = busyIndex.get(staff.id) ?? [];
      for (const startMs of dayCandidates(business, service, staff, dateIso, window.band, leadTimeFloorMs, busy)) {
        dayCandidatesByStaff.push({ startMs, staff });
      }
    }
    dayCandidatesByStaff.sort((a, b) => a.startMs - b.startMs || a.staff.name.localeCompare(b.staff.name));

    if (!multiDay) {
      for (const c of dayCandidatesByStaff) {
        if (picked.length >= limit) break;
        picked.push(toSlot(c.startMs, c.staff));
      }
      continue;
    }

    let lastPickMs: number | null = null;
    let pickedThisDay = 0;
    for (const c of dayCandidatesByStaff) {
      if (picked.length >= limit || pickedThisDay >= MAX_PER_DAY_MULTI_DAY) break;
      if (lastPickMs !== null && c.startMs - lastPickMs < MIN_SPACING_MS) continue;
      picked.push(toSlot(c.startMs, c.staff));
      lastPickMs = c.startMs;
      pickedThisDay += 1;
    }
  }

  return picked;
}

export function meetsLeadTime(business: Business, startMs: number, nowMs: number): boolean {
  return startMs >= nowMs + business.leadTimeMin * 60_000;
}

/** Whether [startMs, startMs+durationMin) falls entirely within a single open shift. */
export function fitsBusinessHours(business: Business, startMs: number, durationMin: number): boolean {
  const start = DateTime.fromMillis(startMs, { zone: business.timezone });
  const weekday = start.weekday;
  const shifts = business.hours[weekday] ?? [];
  const startMin = start.hour * 60 + start.minute;
  const endMin = startMin + durationMin;
  for (const [s, e] of shifts) {
    const [sh, sm] = s.split(":").map(Number);
    const [eh, em] = e.split(":").map(Number);
    if (startMin >= sh * 60 + sm && endMin <= eh * 60 + em) return true;
  }
  return false;
}

export function isSlotFree(
  business: Business,
  appointments: Appointment[],
  staffId: string,
  startMs: number,
  durationMin: number,
  nowMs: number,
  excludeAppointmentId?: string,
  staffTimeOff: StaffTimeOff[] = [],
): boolean {
  const relevant = excludeAppointmentId ? appointments.filter((a) => a.id !== excludeAppointmentId) : appointments;
  const busyIndex = buildBusyIndex(business, relevant, nowMs, staffTimeOff);
  const busy = busyIndex.get(staffId) ?? [];
  const bufferMs = business.bufferMin * 60_000;
  const candidateBusyEnd = startMs + durationMin * 60_000 + bufferMs;
  return !overlapsBusy(startMs, candidateBusyEnd, busy);
}

/** Warms up JIT/caches at boot so the first real Alexa+ call is fast. */
export function warmUp(businesses: Business[], appointments: Appointment[], nowMs: number): void {
  for (let round = 0; round < 5; round++) {
    for (const business of businesses) {
      for (const service of business.services) {
        findAvailability({
          business,
          service,
          window: { fromDay: DateTime.fromMillis(nowMs).toISODate()!, toDay: DateTime.fromMillis(nowMs).plus({ days: 13 }).toISODate()!, label: "warmup" },
          limit: 3,
          nowMs,
          appointments,
        });
      }
    }
  }
}
