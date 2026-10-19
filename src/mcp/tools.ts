import { z } from "zod";
import { DateTime } from "luxon";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import type { Store } from "../store.js";
import { formatHours, scoreBusinesses } from "../businesses.js";
import { findAvailability, isOpenDuringWindow, staffCanPerform, type Slot } from "../availability.js";
import { parseSpokenWindow, relativeDayLabel } from "../spokenTime.js";
import { speakAvailability, speakConfirmation, speakHold, speakSeriesSummary, speakGroupSummary, speakOrderConfirmation, formatMoney } from "./speech.js";
import {
  sayServicePriceList,
  sayBusinessSummary,
  sayBusinessClosed,
  sayFullyBooked,
  sayNoAppointments,
  sayAppointmentLine,
  sayWaitlistOfferLine,
  sayAppointmentSummary,
  sayRescheduled,
  sayCancelled,
  sayAlreadyCancelled,
  sayWaitlistJoined,
  sayItemAvailable,
  sayItemOutOfStock,
  sayNoOrders,
  sayOrderLine,
  sayOrderSummary,
  sayOrderCancelled,
  sayOrderAlreadyCancelled,
} from "../i18n.js";
import type { Locale } from "../types.js";
import {
  BookingError,
  cancelAppointment,
  confirmAppointment,
  holdAppointment,
  joinWaitlist,
  listMyAppointments,
  rescheduleAppointment,
  requireBusiness,
  requireService,
} from "../booking.js";
import { checkItemAvailability, cancelOrder, placeOrder, listMyOrders } from "../catalog.js";

export interface RequestContext {
  store: Store;
  customerId: string;
  nowMs: number;
}

export const SERVER_INSTRUCTIONS = `Front Desk books appointments for small local businesses over voice.

Flow: find_businesses -> get_business_details -> find_availability -> hold_appointment -> read the hold back to the customer and get an explicit yes -> confirm_appointment.

Never call confirm_appointment without the customer explicitly saying yes to the hold you read back. Holds expire after 5 minutes, so confirm promptly once the customer agrees. Use list_my_appointments, reschedule_appointment, cancel_appointment and join_waitlist for managing existing bookings. All times in tool inputs/outputs are ISO 8601 with the business's local offset.

For a group (e.g. "3 kids' haircuts" or "me and a friend"), pass party on hold_appointment: every attendee gets their own linked appointment at the same start time, usually with a different staff member, booked atomically (all or none). Mutually exclusive with recurrence.

Some businesses also sell stock-tracked physical items or dishes (not appointment slots). Use check_item_availability to see if something's in stock, order_item to place an order for pickup (no hold/confirm step needed — it's not time-slotted), and list_my_orders/cancel_order to manage existing orders.

Text reminders and order-ready alerts are opt-in. The first time a customer confirms a booking or places an order, ask if they'd like text updates, and call set_sms_consent with their answer. Never assume consent just because a phone number is on file. If a customer asks to stop getting texts at any point, call set_sms_consent with opt_in: false right away.`;

function ok(speech: string, data: Record<string, unknown>): CallToolResult {
  return {
    content: [{ type: "text", text: speech }],
    structuredContent: { speech, ...data },
  };
}

function fail(message: string): CallToolResult {
  return {
    isError: true,
    content: [{ type: "text", text: message }],
  };
}

async function guarded(fn: () => CallToolResult): Promise<CallToolResult> {
  try {
    return fn();
  } catch (e) {
    if (e instanceof BookingError) return fail(e.message);
    return fail(e instanceof Error ? e.message : "Something went wrong. Please try again.");
  }
}

const recurrenceInputSchema = z
  .object({
    freq: z.enum(["weekly", "biweekly", "monthly"]).describe("How often the appointment repeats"),
    count: z.number().int().min(1).max(52).describe("Total number of occurrences in the series, including this first one"),
  })
  .optional()
  .describe("Book a recurring series at the same weekday/time, staff, and service. Omit for a one-off appointment.");

const partyInputSchema = z
  .object({
    count: z.number().int().min(2).max(8).describe("Total people in the group, including the person speaking"),
    names: z
      .array(z.string())
      .optional()
      .describe("One name per person in the group, length must equal count. Omit to use the caller's own name for the first slot and 'Guest 2'..'Guest N' for the rest."),
  })
  .optional()
  .describe(
    "Book several linked appointments at the same start time with different staff members (e.g. 3 kids' haircuts at once). Mutually exclusive with recurrence. Omit for a single booking.",
  );

function slotFromAppointment(store: Store, appointment: { serviceId: string; staffId: string; businessId: string; start: string; end: string }): Slot {
  const business = store.getBusiness(appointment.businessId)!;
  const service = business.services.find((s) => s.id === appointment.serviceId)!;
  const staff = business.staff.find((s) => s.id === appointment.staffId)!;
  return {
    start: appointment.start,
    end: appointment.end,
    staffId: staff.id,
    staffName: staff.name,
    serviceId: service.id,
    serviceName: service.name,
    durationMin: service.durationMin,
    priceCents: service.priceCents,
  };
}

export function registerTools(server: McpServer, ctx: RequestContext): void {
  const { store } = ctx;

  server.registerTool(
    "find_businesses",
    {
      title: "Find businesses",
      description:
        "Search the directory of local businesses by name, service keyword, or category (e.g. barber, physio, pet grooming). Use this first to find the business_id needed by other tools.",
      inputSchema: {
        query: z.string().optional().describe("Free-text search, e.g. 'dog groomer' or 'maple street'"),
        category: z.string().optional().describe("Category filter, e.g. 'barber', 'physio', 'pet grooming'"),
      },
      outputSchema: {
        speech: z.string(),
        businesses: z.array(
          z.object({ business_id: z.string(), name: z.string(), category: z.string(), city: z.string(), address: z.string() }),
        ),
      },
      annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
    },
    async ({ query, category }) =>
      guarded(() => {
        const matches = scoreBusinesses(store.data.businesses, query, category);
        if (matches.length === 0) {
          return fail("I couldn't find a business matching that. Try a different name or category.");
        }
        const names = matches.map((m) => m.business.name);
        const speech =
          names.length === 1
            ? `I found ${names[0]}.`
            : `I found ${names.length}: ${names.slice(0, -1).join(", ")}, and ${names[names.length - 1]}.`;
        return ok(speech, {
          businesses: matches.map((m) => ({
            business_id: m.business.id,
            name: m.business.name,
            category: m.business.category,
            city: m.business.city,
            address: m.business.address,
          })),
        });
      }),
  );

  server.registerTool(
    "get_business_details",
    {
      title: "Get business details",
      description: "Get full details for one business: services with prices, staff, hours, and cancellation policy. Use the business_id from find_businesses.",
      inputSchema: {
        business_id: z.string(),
      },
      outputSchema: {
        speech: z.string(),
        business_id: z.string(),
        name: z.string(),
        hours_text: z.string(),
        policy_note: z.string(),
        services: z.array(z.object({ id: z.string(), name: z.string(), duration_min: z.number(), price_cents: z.number() })),
        staff: z.array(z.object({ id: z.string(), name: z.string(), title: z.string() })),
      },
      annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
    },
    async ({ business_id }) =>
      guarded(() => {
        const business = requireBusiness(store, business_id);
        const locale: Locale = business.locale ?? "en";
        const hoursText = formatHours(business);
        const serviceNames = sayServicePriceList(business.services, formatMoney, locale);
        const speech = sayBusinessSummary(business.name, serviceNames, hoursText, business.policyNote, locale);
        return ok(speech, {
          business_id: business.id,
          name: business.name,
          hours_text: hoursText,
          policy_note: business.policyNote,
          services: business.services.map((s) => ({ id: s.id, name: s.name, duration_min: s.durationMin, price_cents: s.priceCents })),
          staff: business.staff.map((s) => ({ id: s.id, name: s.name, title: s.title })),
        });
      }),
  );

  server.registerTool(
    "find_availability",
    {
      title: "Find availability",
      description:
        "Find open appointment slots for a service at a business. 'when' accepts natural spoken phrases like 'thursday after work', 'tomorrow morning', 'asap'. Returns at most `limit` slots; if none are open, returns `alternatives` for the following week and whether the customer can join a waitlist.",
      inputSchema: {
        business_id: z.string(),
        service_id: z.string(),
        when: z.string().optional().describe("Spoken time phrase, e.g. 'thursday after work', 'tomorrow morning', 'asap'"),
        date: z.string().optional().describe("Explicit date YYYY-MM-DD, used instead of 'when' if provided"),
        staff: z.string().optional().describe("Staff name or id to restrict the search to"),
        limit: z.number().int().min(1).max(8).optional().describe("Max slots to return, default 3"),
      },
      outputSchema: {
        speech: z.string(),
        slots: z.array(
          z.object({ start: z.string(), end: z.string(), staff_id: z.string(), staff_name: z.string(), price_cents: z.number() }),
        ),
        alternatives: z
          .array(z.object({ start: z.string(), end: z.string(), staff_id: z.string(), staff_name: z.string(), price_cents: z.number() }))
          .optional(),
        can_join_waitlist: z.boolean(),
      },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async ({ business_id, service_id, when, date, staff, limit }) =>
      guarded(() => {
        const business = requireBusiness(store, business_id);
        const service = requireService(business, service_id);
        const locale: Locale = business.locale ?? "en";
        const nowBiz = DateTime.fromMillis(ctx.nowMs, { zone: business.timezone });

        let staffId: string | undefined;
        if (staff) {
          const found = business.staff.find((s) => s.id === staff || s.name.toLowerCase() === staff.toLowerCase());
          if (!found || !staffCanPerform(found, service.id)) {
            return fail(`I couldn't find a staff member named "${staff}" who does ${service.name}. Use get_business_details to see the staff.`);
          }
          staffId = found.id;
        }

        const window = date
          ? { fromDay: date, toDay: date, label: date }
          : parseSpokenWindow(when ?? "", nowBiz, 14, locale);
        const effectiveLimit = limit ?? 3;

        const slots = findAvailability({
          business,
          service,
          window,
          staffFilter: staffId,
          limit: effectiveLimit,
          nowMs: ctx.nowMs,
          appointments: store.data.appointments,
          staffTimeOff: store.data.staffTimeOff,
        });

        const toOutputSlot = (s: Slot) => ({ start: s.start, end: s.end, staff_id: s.staffId, staff_name: s.staffName, price_cents: s.priceCents });

        if (slots.length > 0) {
          return ok(speakAvailability(slots, nowBiz, locale), { slots: slots.map(toOutputSlot), can_join_waitlist: false });
        }

        // Whether closed or just fully booked for the requested window, search
        // the following week for the next opening so the customer always gets
        // an actionable alternative instead of a dead end.
        const altFrom = DateTime.fromISO(window.toDay).plus({ days: 1 }).toISODate()!;
        const altTo = DateTime.fromISO(window.toDay).plus({ days: 7 }).toISODate()!;
        let alternatives = findAvailability({
          business,
          service,
          window: { fromDay: altFrom, toDay: altTo, band: window.band, label: "alternatives" },
          staffFilter: staffId,
          limit: effectiveLimit,
          nowMs: ctx.nowMs,
          appointments: store.data.appointments,
          staffTimeOff: store.data.staffTimeOff,
        });
        if (alternatives.length === 0 && window.band) {
          alternatives = findAvailability({
            business,
            service,
            window: { fromDay: altFrom, toDay: altTo, label: "alternatives-any-time" },
            staffFilter: staffId,
            limit: effectiveLimit,
            nowMs: ctx.nowMs,
            appointments: store.data.appointments,
            staffTimeOff: store.data.staffTimeOff,
          });
        }
        const alternativesSpeech = alternatives.length > 0 ? speakAvailability(alternatives, nowBiz, locale) : null;

        const open = isOpenDuringWindow(business, window.fromDay, window.toDay);
        if (!open) {
          const label =
            window.fromDay === window.toDay
              ? relativeDayLabel(DateTime.fromISO(window.fromDay, { zone: business.timezone }), nowBiz, locale)
              : null;
          // Not offering the waitlist here: it only makes sense when a slot
          // might free up from a cancellation, which can't happen in a window
          // the business was never open during.
          return ok(sayBusinessClosed(business.name, label, alternativesSpeech, locale), { slots: [], alternatives: alternatives.map(toOutputSlot), can_join_waitlist: false });
        }

        const speech = sayFullyBooked(business.name, alternativesSpeech, locale);

        return ok(speech, { slots: [], alternatives: alternatives.map(toOutputSlot), can_join_waitlist: true });
      }),
  );

  server.registerTool(
    "hold_appointment",
    {
      title: "Hold an appointment",
      description:
        "Place a 5-minute hold on a specific slot (from find_availability) so the customer can confirm. Does not book the appointment yet. Read the hold back to the customer and get an explicit yes before calling confirm_appointment.",
      inputSchema: {
        business_id: z.string(),
        service_id: z.string(),
        start: z.string().describe("ISO 8601 start time, e.g. from a find_availability slot"),
        staff: z.string().optional(),
        notes: z.string().optional(),
        recurrence: recurrenceInputSchema,
        party: partyInputSchema,
      },
      outputSchema: {
        speech: z.string(),
        hold_id: z.string(),
        expires_at: z.string(),
        start: z.string(),
        end: z.string(),
        staff_name: z.string(),
        price_cents: z.number(),
      },
      annotations: { readOnlyHint: false, idempotentHint: false, openWorldHint: false },
    },
    async ({ business_id, service_id, start, staff, notes, recurrence, party }) =>
      guarded(() => {
        const { appointment, business, staff: chosenStaff } = holdAppointment(store, ctx.nowMs, ctx.customerId, {
          businessId: business_id,
          serviceId: service_id,
          startIso: start,
          staffHint: staff,
          notes,
          recurrence,
          party,
        });
        const slot = slotFromAppointment(store, appointment);
        const nowBiz = DateTime.fromMillis(ctx.nowMs, { zone: business.timezone });
        const speech = speakHold(slot, business.name, nowBiz, business.locale ?? "en");
        return ok(speech, {
          hold_id: appointment.id,
          expires_at: appointment.holdExpiresAt,
          start: appointment.start,
          end: appointment.end,
          staff_name: chosenStaff.name,
          price_cents: slot.priceCents,
        });
      }),
  );

  server.registerTool(
    "confirm_appointment",
    {
      title: "Confirm a held appointment",
      description: "Confirm a hold created by hold_appointment, after the customer has explicitly said yes. Idempotent: confirming an already-confirmed hold just reads back the same confirmation.",
      inputSchema: {
        hold_id: z.string(),
      },
      outputSchema: {
        speech: z.string(),
        code: z.string(),
        start: z.string(),
        end: z.string(),
        series_codes: z.array(z.string()).optional(),
        group_codes: z.array(z.string()).optional(),
      },
      annotations: { readOnlyHint: false, idempotentHint: true, openWorldHint: false },
    },
    async ({ hold_id }) =>
      guarded(() => {
        const { appointment, business, service, staff, seriesAppointments, seriesFreq, groupAppointments } = confirmAppointment(store, ctx.nowMs, ctx.customerId, hold_id);
        const locale: Locale = business.locale ?? "en";
        const nowBiz = DateTime.fromMillis(ctx.nowMs, { zone: business.timezone });
        let speech = speakConfirmation(appointment.code, service.name, staff.name, appointment.start, nowBiz, locale);
        if (seriesAppointments && seriesAppointments.length > 1 && seriesFreq) {
          speech += speakSeriesSummary(seriesFreq, seriesAppointments.length - 1, locale);
        }
        if (groupAppointments && groupAppointments.length > 1) {
          speech += speakGroupSummary(groupAppointments.slice(1).map((a) => a.customerName), locale);
        }
        return ok(speech, {
          code: appointment.code,
          start: appointment.start,
          end: appointment.end,
          series_codes: seriesAppointments && seriesAppointments.length > 1 ? seriesAppointments.map((a) => a.code) : undefined,
          group_codes: groupAppointments && groupAppointments.length > 1 ? groupAppointments.map((a) => a.code) : undefined,
        });
      }),
  );

  server.registerTool(
    "list_my_appointments",
    {
      title: "List my appointments",
      description: "List the customer's upcoming held and confirmed appointments, including any waitlist spots that just opened up.",
      inputSchema: {},
      outputSchema: {
        speech: z.string(),
        appointments: z.array(
          z.object({
            id: z.string(),
            code: z.string(),
            business_name: z.string(),
            service_name: z.string(),
            staff_name: z.string(),
            start: z.string(),
            status: z.string(),
            is_waitlist_offer: z.boolean(),
            series_id: z.string().nullable(),
            series_count: z.number(),
            group_id: z.string().nullable(),
            group_count: z.number(),
          }),
        ),
      },
      annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
    },
    async () =>
      guarded(() => {
        const appts = listMyAppointments(store, ctx.nowMs, ctx.customerId);
        // No single business to key a locale off of; use the first appointment's business (see PROGRESS_DEV.md).
        const overallLocale: Locale = appts.length > 0 ? store.getBusiness(appts[0].businessId)?.locale ?? "en" : "en";
        if (appts.length === 0) {
          return ok(sayNoAppointments(overallLocale), { appointments: [] });
        }
        const seriesCounts = new Map<string, number>();
        const groupCounts = new Map<string, number>();
        for (const a of appts) {
          if (a.seriesId) seriesCounts.set(a.seriesId, (seriesCounts.get(a.seriesId) ?? 0) + 1);
          if (a.groupId) groupCounts.set(a.groupId, (groupCounts.get(a.groupId) ?? 0) + 1);
        }
        const seenSeries = new Set<string>();
        const seenGroups = new Set<string>();
        const rows = appts.map((a) => {
          const business = store.getBusiness(a.businessId)!;
          const locale: Locale = business.locale ?? "en";
          const service = business.services.find((s) => s.id === a.serviceId)!;
          const staff = business.staff.find((s) => s.id === a.staffId)!;
          const nowBiz = DateTime.fromMillis(ctx.nowMs, { zone: business.timezone });
          const isOffer = a.holdKind === "waitlist_offer";
          const when = relativeDayLabel(DateTime.fromISO(a.start, { setZone: true }), nowBiz, locale);
          const seriesCount = a.seriesId ? seriesCounts.get(a.seriesId)! : 1;
          const groupCount = a.groupId ? groupCounts.get(a.groupId)! : 1;
          const isFirstOfSeries = !a.seriesId || !seenSeries.has(a.seriesId);
          const isFirstOfGroup = !a.groupId || !seenGroups.has(a.groupId);
          if (a.seriesId) seenSeries.add(a.seriesId);
          if (a.groupId) seenGroups.add(a.groupId);
          return {
            id: a.id,
            code: a.code,
            business_name: business.name,
            service_name: service.name,
            staff_name: staff.name,
            start: a.start,
            status: a.status,
            is_waitlist_offer: isOffer,
            series_id: a.seriesId ?? null,
            series_count: seriesCount,
            group_id: a.groupId ?? null,
            group_count: groupCount,
            _speechLine: !isFirstOfSeries || !isFirstOfGroup
              ? null
              : isOffer
                ? sayWaitlistOfferLine(service.name, business.name, when, staff.name, locale)
                : a.groupId
                  ? sayAppointmentLine(service.name, business.name, staff.name, when, a.code, groupCount > 1 ? groupCount - 1 : 0, locale, "group")
                  : sayAppointmentLine(service.name, business.name, staff.name, when, a.code, seriesCount > 1 ? seriesCount - 1 : 0, locale, "series"),
          };
        });
        const speechLines = rows.map((r) => r._speechLine).filter((l): l is string => l !== null);
        const speech = sayAppointmentSummary(rows.length, speechLines, overallLocale);
        return ok(speech, { appointments: rows.map(({ _speechLine, ...rest }) => rest) });
      }),
  );

  server.registerTool(
    "reschedule_appointment",
    {
      title: "Reschedule an appointment",
      description: "Move an existing held or confirmed appointment to a new start time. Identify the appointment by appointment_id or its 4-character code. The freed original slot is automatically offered to the waitlist.",
      inputSchema: {
        appointment_id: z.string().optional(),
        code: z.string().optional(),
        new_start: z.string().describe("ISO 8601 new start time"),
        staff: z.string().optional(),
        scope: z.enum(["this", "series"]).optional().describe("'series' also shifts every future occurrence of a recurring series by the same amount. Defaults to 'this'."),
      },
      outputSchema: {
        speech: z.string(),
        start: z.string(),
        end: z.string(),
        staff_name: z.string(),
        series_shifted_count: z.number().optional(),
      },
      annotations: { readOnlyHint: false, idempotentHint: false, openWorldHint: false },
    },
    async ({ appointment_id, code, new_start, staff, scope }) =>
      guarded(() => {
        const idOrCode = appointment_id ?? code;
        if (!idOrCode) return fail("I need either the appointment id or the confirmation code to reschedule it.");
        const { appointment, business, staff: newStaff, seriesShiftedCount } = rescheduleAppointment(store, ctx.nowMs, ctx.customerId, {
          idOrCode,
          newStartIso: new_start,
          staffHint: staff,
          scope,
        });
        const locale: Locale = business.locale ?? "en";
        const nowBiz = DateTime.fromMillis(ctx.nowMs, { zone: business.timezone });
        const when = relativeDayLabel(DateTime.fromISO(appointment.start, { setZone: true }), nowBiz, locale);
        const speech = sayRescheduled(when, newStaff.name, seriesShiftedCount, locale);
        return ok(speech, { start: appointment.start, end: appointment.end, staff_name: newStaff.name, series_shifted_count: seriesShiftedCount });
      }),
  );

  server.registerTool(
    "cancel_appointment",
    {
      title: "Cancel an appointment",
      description: "Cancel an existing held or confirmed appointment, identified by appointment_id or its 4-character code. Idempotent: cancelling an already-cancelled appointment just confirms it's cancelled. Warns about a late cancellation fee inside the business's notice window, and automatically offers the freed slot to the waitlist.",
      inputSchema: {
        appointment_id: z.string().optional(),
        code: z.string().optional(),
        scope: z.enum(["this", "series"]).optional().describe("'series' also cancels every future occurrence of a recurring series. Past occurrences are left alone. Defaults to 'this'."),
      },
      outputSchema: {
        speech: z.string(),
        cancelled: z.boolean(),
        late_fee_warning: z.boolean(),
        series_cancelled_count: z.number().optional(),
      },
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false },
    },
    async ({ appointment_id, code, scope }) =>
      guarded(() => {
        const idOrCode = appointment_id ?? code;
        if (!idOrCode) return fail("I need either the appointment id or the confirmation code to cancel it.");
        const { alreadyCancelled, lateFee, business, seriesCancelledCount } = cancelAppointment(store, ctx.nowMs, ctx.customerId, idOrCode, scope);
        const locale: Locale = business.locale ?? "en";
        if (alreadyCancelled) {
          return ok(sayAlreadyCancelled(locale), { cancelled: true, late_fee_warning: false });
        }
        const speech = sayCancelled(lateFee, business.cancelNoticeHours, seriesCancelledCount, locale);
        return ok(speech, { cancelled: true, late_fee_warning: lateFee, series_cancelled_count: seriesCancelledCount });
      }),
  );

  server.registerTool(
    "join_waitlist",
    {
      title: "Join the waitlist",
      description: "Join the waitlist for a service at a business during a spoken time window (e.g. 'thursday after work'). Idempotent: joining again for the same window just confirms the existing entry.",
      inputSchema: {
        business_id: z.string(),
        service_id: z.string(),
        when: z.string().optional(),
      },
      outputSchema: {
        speech: z.string(),
        waitlist_id: z.string(),
      },
      annotations: { readOnlyHint: false, idempotentHint: true, openWorldHint: false },
    },
    async ({ business_id, service_id, when }) =>
      guarded(() => {
        const business = requireBusiness(store, business_id);
        const service = requireService(business, service_id);
        const locale: Locale = business.locale ?? "en";
        const nowBiz = DateTime.fromMillis(ctx.nowMs, { zone: business.timezone });
        const window = parseSpokenWindow(when ?? "", nowBiz, 14, locale);
        const entry = joinWaitlist(store, ctx.nowMs, ctx.customerId, {
          businessId: business.id,
          serviceId: service.id,
          window,
        });
        const speech = sayWaitlistJoined(service.name, business.name, window.label, locale);
        return ok(speech, { waitlist_id: entry.id });
      }),
  );

  server.registerTool(
    "check_item_availability",
    {
      title: "Check item availability",
      description:
        "Check whether a business has a specific stock-tracked item or dish available right now, and how many are left. Use get_business_details first if you need to see what a business carries.",
      inputSchema: {
        business_id: z.string(),
        item: z.string().describe("Item or dish name, e.g. 'beard oil' or 'salmon tacos'"),
      },
      outputSchema: {
        speech: z.string(),
        available: z.boolean(),
        stock_qty: z.number(),
        price_cents: z.number(),
      },
      annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
    },
    async ({ business_id, item }) =>
      guarded(() => {
        const { business, product } = checkItemAvailability(store, business_id, item);
        const locale: Locale = business.locale ?? "en";
        const speech =
          product.stockQty > 0
            ? sayItemAvailable(product.name, business.name, product.stockQty, product.priceCents, formatMoney, locale)
            : sayItemOutOfStock(product.name, business.name, locale);
        return ok(speech, { available: product.stockQty > 0, stock_qty: product.stockQty, price_cents: product.priceCents });
      }),
  );

  server.registerTool(
    "order_item",
    {
      title: "Order an item",
      description:
        "Order a stock-tracked item or dish for pickup. Decrements stock immediately; unlike appointments, there's no hold/confirm step since an in-stock item has nothing to race against. 'pickup_when' accepts natural phrases like 'tomorrow morning'; omit it for as-soon-as-possible pickup.",
      inputSchema: {
        business_id: z.string(),
        item: z.string(),
        quantity: z.number().int().min(1).max(50).optional().describe("Defaults to 1"),
        pickup_when: z.string().optional().describe("Spoken time phrase, e.g. 'tomorrow morning'. Omit for as soon as possible."),
        notes: z.string().optional(),
      },
      outputSchema: {
        speech: z.string(),
        order_id: z.string(),
        code: z.string(),
        quantity: z.number(),
        total_price_cents: z.number(),
        pickup_label: z.string(),
      },
      annotations: { readOnlyHint: false, idempotentHint: false, openWorldHint: false },
    },
    async ({ business_id, item, quantity, pickup_when, notes }) =>
      guarded(() => {
        const { order, business } = placeOrder(store, ctx.nowMs, ctx.customerId, {
          businessId: business_id,
          item,
          quantity,
          pickupWhen: pickup_when,
          notes,
        });
        const locale: Locale = business.locale ?? "en";
        const speech = speakOrderConfirmation(order.quantity, order.productName, business.name, order.priceCents, order.pickupLabel, order.code, locale);
        return ok(speech, {
          order_id: order.id,
          code: order.code,
          quantity: order.quantity,
          total_price_cents: order.priceCents,
          pickup_label: order.pickupLabel,
        });
      }),
  );

  server.registerTool(
    "list_my_orders",
    {
      title: "List my orders",
      description: "List the customer's active (placed or ready) item orders.",
      inputSchema: {},
      outputSchema: {
        speech: z.string(),
        orders: z.array(
          z.object({
            id: z.string(),
            code: z.string(),
            business_name: z.string(),
            product_name: z.string(),
            quantity: z.number(),
            status: z.string(),
            pickup_label: z.string(),
          }),
        ),
      },
      annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
    },
    async () =>
      guarded(() => {
        const orders = listMyOrders(store, ctx.customerId);
        // No single business to key a locale off of; same approach as list_my_appointments.
        const overallLocale: Locale = orders.length > 0 ? store.getBusiness(orders[0].businessId)?.locale ?? "en" : "en";
        if (orders.length === 0) {
          return ok(sayNoOrders(overallLocale), { orders: [] });
        }
        const rows = orders.map((o) => {
          const business = store.getBusiness(o.businessId)!;
          const locale: Locale = business.locale ?? "en";
          return {
            id: o.id,
            code: o.code,
            business_name: business.name,
            product_name: o.productName,
            quantity: o.quantity,
            status: o.status,
            pickup_label: o.pickupLabel,
            _speechLine: sayOrderLine(o.productName, business.name, o.quantity, o.pickupLabel, o.code, locale),
          };
        });
        const speech = sayOrderSummary(rows.length, rows.map((r) => r._speechLine), overallLocale);
        return ok(speech, { orders: rows.map(({ _speechLine, ...rest }) => rest) });
      }),
  );

  server.registerTool(
    "cancel_order",
    {
      title: "Cancel an order",
      description:
        "Cancel an existing item order, identified by order_id or its 4-character code. Idempotent: cancelling an already-cancelled order just confirms it. Restocks the item.",
      inputSchema: {
        order_id: z.string().optional(),
        code: z.string().optional(),
      },
      outputSchema: {
        speech: z.string(),
        cancelled: z.boolean(),
      },
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false },
    },
    async ({ order_id, code }) =>
      guarded(() => {
        const idOrCode = order_id ?? code;
        if (!idOrCode) return fail("I need either the order id or the confirmation code to cancel it.");
        const { alreadyCancelled, business } = cancelOrder(store, ctx.nowMs, ctx.customerId, idOrCode);
        const locale: Locale = business.locale ?? "en";
        const speech = alreadyCancelled ? sayOrderAlreadyCancelled(locale) : sayOrderCancelled(locale);
        return ok(speech, { cancelled: true });
      }),
  );

  server.registerTool(
    "set_sms_consent",
    {
      title: "Set SMS notification consent",
      description:
        "Record whether the customer wants text message notifications (hold-expiring reminders, upcoming-appointment reminders, order-ready alerts). Ask explicitly before opting someone in — never assume consent from a phone number alone. Also use this if the customer asks to stop getting texts.",
      inputSchema: {
        opt_in: z.boolean().describe("true to opt into SMS notifications, false to opt out / unsubscribe"),
      },
      outputSchema: {
        speech: z.string(),
        sms_consent: z.boolean(),
      },
      // No single business is in play here (consent is per-customer, not per-business), so — same reasoning as
      // find_businesses — this stays English-only; see PROGRESS_DEV.md.
      annotations: { readOnlyHint: false, idempotentHint: true, openWorldHint: false },
    },
    async ({ opt_in }) =>
      guarded(() => {
        const customer = store.setSmsConsent(ctx.customerId, opt_in, ctx.nowMs);
        if (!customer) return fail("I couldn't find your account.");
        const speech = opt_in ? "Got it, I'll text you reminders and order updates." : "Got it, I won't text you anymore.";
        return ok(speech, { sms_consent: customer.smsConsent === true });
      }),
  );
}
