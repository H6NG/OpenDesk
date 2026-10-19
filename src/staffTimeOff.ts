import { isoUtc } from "./clock.js";
import { newId } from "./codes.js";
import { BookingError, requireBusiness } from "./booking.js";
import type { Store } from "./store.js";
import type { StaffTimeOff } from "./types.js";

/**
 * Owner-side operation (not an MCP voice tool): a business marks a staff
 * member unavailable for a block of time, independent of the business's own
 * hours. Folded into `availability.ts`'s busy index, so every existing
 * availability/double-booking check already respects it with no extra
 * plumbing on the read side.
 */
export function addStaffTimeOff(
  store: Store,
  nowMs: number,
  params: { businessId: string; staffId: string; fromIso: string; toIso: string; reason?: string },
): StaffTimeOff {
  const business = requireBusiness(store, params.businessId);
  const staff = business.staff.find((s) => s.id === params.staffId);
  if (!staff) throw new BookingError(`I couldn't find that staff member at ${business.name}.`);

  const fromMs = Date.parse(params.fromIso);
  const toMs = Date.parse(params.toIso);
  if (Number.isNaN(fromMs) || Number.isNaN(toMs)) throw new BookingError("I couldn't understand that time-off range.");
  if (toMs <= fromMs) throw new BookingError("A time-off block's end must be after its start.");

  const entry: StaffTimeOff = {
    id: newId("timeoff"),
    businessId: business.id,
    staffId: staff.id,
    fromIso: params.fromIso,
    toIso: params.toIso,
    reason: params.reason ?? "",
    createdAt: isoUtc(nowMs),
  };
  store.data.staffTimeOff.push(entry);
  store.touch();
  store.addEvent(business.id, "staff_time_off", `${staff.name} marked unavailable ${params.fromIso} - ${params.toIso}${entry.reason ? ` (${entry.reason})` : ""}`);
  return entry;
}

export function removeStaffTimeOff(store: Store, id: string): void {
  const index = store.data.staffTimeOff.findIndex((t) => t.id === id);
  if (index === -1) throw new BookingError("I couldn't find that time-off block.");
  store.data.staffTimeOff.splice(index, 1);
  store.touch();
}

export function listStaffTimeOff(store: Store, businessId: string, nowMs: number): StaffTimeOff[] {
  return store.data.staffTimeOff
    .filter((t) => t.businessId === businessId && Date.parse(t.toIso) > nowMs)
    .sort((a, b) => Date.parse(a.fromIso) - Date.parse(b.fromIso));
}
