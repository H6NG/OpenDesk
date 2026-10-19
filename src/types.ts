import { z } from "zod";

// ---------------------------------------------------------------------------
// Core catalog types
// ---------------------------------------------------------------------------

export interface Service {
  id: string;
  name: string;
  durationMin: number;
  priceCents: number;
}

export interface Staff {
  id: string;
  name: string;
  title: string;
  serviceIds: string[];
}

/** A stock-tracked physical item or dish a business sells, separate from the time-slot Services above. */
export interface Product {
  id: string;
  name: string;
  description: string;
  priceCents: number;
  stockQty: number;
}

/** Luxon weekday: 1 = Monday ... 7 = Sunday. Each shift is ["HH:MM","HH:MM"). */
export type HoursByWeekday = Record<number, [string, string][]>;

export type Locale = "en" | "es" | "fr";

export interface Business {
  id: string;
  name: string;
  category: string;
  keywords: string[];
  address: string;
  city: string;
  phone: string;
  timezone: string;
  hours: HoursByWeekday;
  services: Service[];
  staff: Staff[];
  /** Stock-tracked physical items/dishes, independent of the appointment-booking Services. Defaults to none. */
  products?: Product[];
  bufferMin: number;
  slotStepMin: number;
  leadTimeMin: number;
  cancelNoticeHours: number;
  policyNote: string;
  createdVia?: "seed" | "bedrock-onboarding";
  /** When "es" or "fr", every tool's speech and spoken-time parsing for this business render in that language. Defaults to "en". */
  locale?: Locale;
}

// ---------------------------------------------------------------------------
// Customers & appointments
// ---------------------------------------------------------------------------

export interface Customer {
  id: string;
  name: string;
  phone: string;
}

export type AppointmentStatus = "held" | "confirmed" | "cancelled" | "expired";
export type HoldKind = "customer" | "waitlist_offer";
export type AppointmentSource = "alexa" | "phone" | "walk-in";
export type RecurrenceFreq = "weekly" | "biweekly" | "monthly";
export interface RecurrenceSpec {
  freq: RecurrenceFreq;
  /** Total number of occurrences in the series, including this one. */
  count: number;
}

/** Books several linked appointments at the same start time (e.g. 3 kids' haircuts), each with its own, usually distinct, staff member. */
export interface PartySpec {
  /** Total people in the group, including the person booking. Must be at least 2. */
  count: number;
  /** One name per person, length must equal `count`. Omit to default to the booking customer's own name for the first slot and "Guest 2".."Guest N" for the rest. */
  names?: string[];
}

export interface Appointment {
  id: string;
  code: string;
  businessId: string;
  serviceId: string;
  staffId: string;
  customerId: string;
  customerName: string;
  start: string; // ISO
  end: string; // ISO
  status: AppointmentStatus;
  holdExpiresAt: string | null;
  holdKind: HoldKind | null;
  source: AppointmentSource;
  notes: string;
  createdAt: string;
  updatedAt: string;
  /** Idempotency markers for reminders.ts; absent/null means not yet sent. */
  holdReminderSentAt?: string | null;
  apptReminderSentAt?: string | null;
  /** Shared by every occurrence of a recurring series, including this one. */
  seriesId?: string | null;
  /** Set on a held appointment that requested recurrence; materialized into sibling appointments at confirm time, then cleared. */
  pendingRecurrence?: RecurrenceSpec | null;
  /** Shared by every appointment in a group/party booking, including this one. */
  groupId?: string | null;
  /** Set on a held appointment that requested a party; materialized into sibling appointments (one per name, each with a distinct staff member) at confirm time, then cleared. */
  pendingParty?: { attendeeNames: string[] } | null;
}

export type OrderStatus = "placed" | "ready" | "picked_up" | "cancelled";

/** An order for a stock-tracked Product, independent of the Appointment/time-slot model above. */
export interface Order {
  id: string;
  code: string;
  businessId: string;
  productId: string;
  productName: string;
  quantity: number;
  /** Total price captured at order time (unit price * quantity), so later price changes don't retroactively change it. */
  priceCents: number;
  customerId: string;
  customerName: string;
  /** Exact pickup time if the customer gave one that resolved to a specific instant; null otherwise (see pickupLabel). */
  pickupAt: string | null;
  /** Human-readable pickup window/time for speech, e.g. "tomorrow morning" or "as soon as possible". */
  pickupLabel: string;
  status: OrderStatus;
  notes: string;
  createdAt: string;
  updatedAt: string;
}

/** A block of time a staff member is unavailable, independent of the business's own hours (e.g. "Sam is out sick Thursday"). */
export interface StaffTimeOff {
  id: string;
  businessId: string;
  staffId: string;
  fromIso: string;
  toIso: string;
  reason: string;
  createdAt: string;
}

export interface WaitlistEntry {
  id: string;
  businessId: string;
  serviceId: string;
  staffId: string | null;
  customerId: string;
  customerName: string;
  windowLabel: string;
  fromDay: string;
  toDay: string;
  band: [number, number] | null;
  createdAt: string;
  status: "waiting" | "offered" | "fulfilled" | "cancelled";
  offerAppointmentId?: string;
}

export type ActivityEventType =
  | "held"
  | "booked"
  | "rescheduled"
  | "cancelled"
  | "waitlist"
  | "waitlist_offer"
  | "onboarded"
  | "account_linked"
  | "reminder_sent"
  | "order_placed"
  | "order_cancelled"
  | "order_ready"
  | "staff_time_off";

export interface ActivityEvent {
  id: string;
  businessId: string;
  type: ActivityEventType;
  message: string;
  at: string;
}

// ---------------------------------------------------------------------------
// OAuth
// ---------------------------------------------------------------------------

export interface OAuthCode {
  code: string;
  clientId: string;
  redirectUri: string;
  codeChallenge: string;
  codeChallengeMethod: "S256";
  scope: string;
  resource: string;
  customerId: string;
  expiresAt: string;
  usedAt: string | null;
  createdAt: string;
}

export interface OAuthToken {
  tokenHash: string;
  kind: "access" | "refresh";
  clientId: string;
  customerId: string;
  scope: string;
  expiresAt: string;
  createdAt: string;
  revokedAt: string | null;
  rotatedToHash?: string | null;
}

// ---------------------------------------------------------------------------
// Persisted store shape
// ---------------------------------------------------------------------------

export interface StoreData {
  businesses: Business[];
  customers: Customer[];
  appointments: Appointment[];
  orders: Order[];
  staffTimeOff: StaffTimeOff[];
  waitlist: WaitlistEntry[];
  events: ActivityEvent[];
  oauthCodes: OAuthCode[];
  oauthTokens: OAuthToken[];
}

// ---------------------------------------------------------------------------
// Bedrock onboarding schema
// ---------------------------------------------------------------------------

export const OnboardingServiceSchema = z.object({
  name: z.string(),
  duration_min: z.number().int().positive(),
  price_cents: z.number().int().nonnegative(),
});

export const OnboardingStaffSchema = z.object({
  name: z.string(),
  title: z.string(),
  service_names: z.array(z.string()).min(1),
});

export const OnboardingHoursEntrySchema = z.object({
  weekday: z.number().int().min(1).max(7).describe("1=Monday ... 7=Sunday"),
  shifts: z.array(z.tuple([z.string(), z.string()])).describe('[["09:00","17:00"]]; empty array means closed that day'),
});

export const OnboardingSchema = z.object({
  name: z.string(),
  category: z.string(),
  keywords: z.array(z.string()).default([]),
  address: z.string(),
  city: z.string(),
  phone: z.string(),
  timezone: z.string(),
  hours: z.array(OnboardingHoursEntrySchema).min(1),
  buffer_min: z.number().int().nonnegative().default(10),
  lead_time_min: z.number().int().nonnegative().default(60),
  cancel_notice_hours: z.number().int().nonnegative().default(24),
  services: z.array(OnboardingServiceSchema).min(1),
  staff: z.array(OnboardingStaffSchema).min(1),
  policy_note: z.string().default(""),
});

export type OnboardingInput = z.infer<typeof OnboardingSchema>;
