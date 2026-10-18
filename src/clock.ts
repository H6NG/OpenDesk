import { DateTime } from "luxon";

/**
 * Every time-dependent function must go through here so FRONTDESK_NOW can
 * freeze the clock for demos and tests.
 */
export function now(): DateTime {
  const frozen = process.env.FRONTDESK_NOW;
  if (frozen) {
    const dt = DateTime.fromISO(frozen, { setZone: true });
    if (dt.isValid) return dt;
  }
  return DateTime.now();
}

export function nowMs(): number {
  return now().toMillis();
}

/** Internal bookkeeping timestamps (createdAt/updatedAt/...) are stored in UTC, independent of any business's zone. */
export function isoUtc(ms: number): string {
  return DateTime.fromMillis(ms, { zone: "utc" }).toISO()!;
}
