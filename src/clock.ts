import { DateTime } from "luxon";

/**
 * Every time-dependent function must go through here so FRONTDESK_NOW can
 * freeze the clock for demos and tests.
 */
export function now(): DateTime {
  const frozen = process.env.FRONTDESK_NOW;
  if (frozen) {
    const dt = DateTime.fromISO(frozen);
    if (dt.isValid) return dt;
  }
  return DateTime.now();
}

export function nowMs(): number {
  return now().toMillis();
}
