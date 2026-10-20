import { z } from "zod";
import { BedrockRuntimeClient, ConverseCommand, type ConverseResponse } from "@aws-sdk/client-bedrock-runtime";
import { OnboardingSchema, type Business, type OnboardingInput } from "./types.js";
import type { Store } from "./store.js";
import { now } from "./clock.js";

const SAVE_BUSINESS_TOOL = "save_business";

const SYSTEM_PROMPT = `You help onboard small local businesses onto the OpenDesk voice booking platform.
Given a free-text description of a business, extract a complete, consistent structured catalog by calling save_business: services with realistic durations and prices, staff with the services each one can perform, weekly hours, address, and policy.
Every service must be assignable to at least one staff member. Use 24-hour "HH:MM" strings for hours. Always call save_business; never reply with plain text.`;

type MinimalBedrockClient = { send: (command: ConverseCommand) => Promise<ConverseResponse> };

let client: MinimalBedrockClient | null = null;

/** Lets tests (and other callers) inject a stub instead of a real AWS client. */
export function setBedrockClient(c: MinimalBedrockClient | null): void {
  client = c;
}

function getClient(region: string): MinimalBedrockClient {
  if (!client) client = new BedrockRuntimeClient({ region });
  return client;
}

function buildToolInputSchema(): Record<string, unknown> {
  const schema = z.toJSONSchema(OnboardingSchema, { io: "input" }) as Record<string, unknown>;
  delete schema.$schema;
  return schema;
}

function extractToolInput(response: ConverseResponse): unknown {
  const content = response.output && "message" in response.output ? response.output.message?.content : undefined;
  if (!content) return undefined;
  for (const block of content) {
    if ("toolUse" in block && block.toolUse?.name === SAVE_BUSINESS_TOOL) {
      return block.toolUse.input;
    }
  }
  return undefined;
}

function extractJsonFromText(response: ConverseResponse): unknown {
  const content = response.output && "message" in response.output ? response.output.message?.content : undefined;
  if (!content) return undefined;
  for (const block of content) {
    if ("text" in block && typeof block.text === "string") {
      const match = block.text.match(/\{[\s\S]*\}/);
      if (match) {
        try {
          return JSON.parse(match[0]);
        } catch {
          // fall through
        }
      }
    }
  }
  return undefined;
}

function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function uniqueSlug(base: string, used: Set<string>): string {
  let slug = base || "item";
  let i = 2;
  while (used.has(slug)) {
    slug = `${base}-${i}`;
    i += 1;
  }
  used.add(slug);
  return slug;
}

/** Converts validated onboarding output into a bookable Business. Throws with a clear message if any service ends up unbookable. */
export function convertToBusiness(input: OnboardingInput): Business {
  const usedServiceSlugs = new Set<string>();
  const services = input.services.map((s) => ({
    id: uniqueSlug(slugify(s.name), usedServiceSlugs),
    name: s.name,
    durationMin: s.duration_min,
    priceCents: s.price_cents,
  }));
  const serviceIdByName = new Map(services.map((s, i) => [input.services[i].name.toLowerCase(), s.id]));

  const usedStaffSlugs = new Set<string>();
  const staff = input.staff.map((st) => {
    const serviceIds = st.service_names
      .map((name) => serviceIdByName.get(name.toLowerCase()))
      .filter((id): id is string => Boolean(id));
    return {
      id: uniqueSlug(slugify(st.name), usedStaffSlugs),
      name: st.name,
      title: st.title,
      serviceIds,
    };
  });

  const bookableServiceIds = new Set(staff.flatMap((st) => st.serviceIds));
  const unbookable = services.filter((s) => !bookableServiceIds.has(s.id));
  if (unbookable.length > 0) {
    throw new Error(`Invalid onboarding output: no staff member can perform ${unbookable.map((s) => s.name).join(", ")}.`);
  }

  const hours: Business["hours"] = { 1: [], 2: [], 3: [], 4: [], 5: [], 6: [], 7: [] };
  for (const entry of input.hours) {
    hours[entry.weekday] = entry.shifts;
  }

  return {
    id: uniqueSlug(slugify(input.name), new Set()),
    name: input.name,
    category: input.category,
    keywords: input.keywords,
    address: input.address,
    city: input.city,
    phone: input.phone,
    timezone: input.timezone,
    hours,
    services,
    staff,
    bufferMin: input.buffer_min,
    slotStepMin: 15,
    leadTimeMin: input.lead_time_min,
    cancelNoticeHours: input.cancel_notice_hours,
    policyNote: input.policy_note,
    createdVia: "bedrock-onboarding",
  };
}

export async function onboardBusiness(description: string, options: { region?: string; modelId?: string } = {}): Promise<Business> {
  const modelId = options.modelId ?? process.env.BEDROCK_MODEL_ID ?? "us.amazon.nova-lite-v1:0";
  const region = options.region ?? process.env.AWS_REGION ?? "us-east-1";

  const command = new ConverseCommand({
    modelId,
    system: [{ text: SYSTEM_PROMPT }],
    messages: [{ role: "user", content: [{ text: description }] }],
    toolConfig: {
      tools: [
        {
          toolSpec: {
            name: SAVE_BUSINESS_TOOL,
            description: "Save the structured business catalog extracted from the description.",
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            inputSchema: { json: buildToolInputSchema() as any },
          },
        },
      ],
      toolChoice: { tool: { name: SAVE_BUSINESS_TOOL } },
    },
    inferenceConfig: { temperature: 0 },
  });

  const response = await getClient(region).send(command);

  const raw = extractToolInput(response) ?? extractJsonFromText(response);
  if (raw === undefined) {
    throw new Error("Bedrock did not return a save_business payload.");
  }

  const parsed = OnboardingSchema.safeParse(raw);
  if (!parsed.success) {
    throw new Error(`Invalid onboarding output: ${parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ")}`);
  }

  return convertToBusiness(parsed.data);
}

function capWords(text: string, maxWords: number): string {
  const words = text.trim().split(/\s+/);
  if (words.length <= maxWords) return text.trim();
  return `${words.slice(0, maxWords).join(" ")}...`;
}

/** A briefing of at most 90 words, built from today's bookings, revenue, waitlist and recent events. */
export function dailyBriefing(store: Store, businessId: string, nowMs: number = now().toMillis()): string {
  const business = store.getBusiness(businessId);
  if (!business) return "I couldn't find that business.";

  const todayIso = new Date(nowMs).toISOString().slice(0, 10);
  const todays = store.data.appointments.filter(
    (a) => a.businessId === businessId && a.start.slice(0, 10) === todayIso && (a.status === "confirmed" || a.status === "held"),
  );
  const confirmedToday = todays.filter((a) => a.status === "confirmed");
  const revenueCents = confirmedToday.reduce((sum, a) => {
    const service = business.services.find((s) => s.id === a.serviceId);
    return sum + (service?.priceCents ?? 0);
  }, 0);
  const waitlistCount = store.data.waitlist.filter((w) => w.businessId === businessId && w.status === "waiting").length;
  const recentEvents = store.data.events.filter((e) => e.businessId === businessId).slice(-3);

  const parts: string[] = [];
  parts.push(
    confirmedToday.length === 0
      ? `No confirmed bookings yet today at ${business.name}.`
      : `${business.name} has ${confirmedToday.length} confirmed booking${confirmedToday.length === 1 ? "" : "s"} today, bringing in about $${(revenueCents / 100).toFixed(0)}.`,
  );
  if (todays.length > confirmedToday.length) {
    parts.push(`${todays.length - confirmedToday.length} more are still on hold.`);
  }
  parts.push(waitlistCount > 0 ? `${waitlistCount} customer${waitlistCount === 1 ? " is" : "s are"} on the waitlist.` : "The waitlist is empty.");
  if (recentEvents.length > 0) {
    parts.push(`Recent activity: ${recentEvents.map((e) => e.message).join("; ")}.`);
  }

  return capWords(parts.join(" "), 90);
}
