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

/** Luxon weekday: 1 = Monday ... 7 = Sunday. Each shift is ["HH:MM","HH:MM"). */
export type HoursByWeekday = Record<number, [string, string][]>;

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
  bufferMin: number;
  slotStepMin: number;
  leadTimeMin: number;
  cancelNoticeHours: number;
  policyNote: string;
  createdVia?: "seed" | "bedrock-onboarding";
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
  | "account_linked";

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

export const OnboardingSchema = z.object({
  name: z.string(),
  category: z.string(),
  keywords: z.array(z.string()).default([]),
  address: z.string(),
  city: z.string(),
  phone: z.string(),
  timezone: z.string(),
  hours_text: z.string(),
  services: z.array(OnboardingServiceSchema).min(1),
  staff: z.array(OnboardingStaffSchema).min(1),
  policy_note: z.string().default(""),
});

export type OnboardingInput = z.infer<typeof OnboardingSchema>;
