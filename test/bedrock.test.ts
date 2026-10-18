import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { ConverseCommand } from "@aws-sdk/client-bedrock-runtime";
import { onboardBusiness, setBedrockClient, dailyBriefing } from "../src/bedrock.js";
import { findAvailability } from "../src/availability.js";
import { Store } from "../src/store.js";
import { parseSpokenWindow } from "../src/spokenTime.js";
import { DateTime } from "luxon";

const NAIL_SALON_PAYLOAD = {
  name: "Lotus Nails",
  category: "nail salon",
  keywords: ["nails", "manicure", "pedicure"],
  address: "12 Lotus Ave",
  city: "Los Angeles",
  phone: "+1-213-555-0199",
  timezone: "America/Los_Angeles",
  hours: [
    { weekday: 1, shifts: [["10:00", "18:00"]] },
    { weekday: 2, shifts: [["10:00", "18:00"]] },
    { weekday: 3, shifts: [["10:00", "18:00"]] },
    { weekday: 4, shifts: [["10:00", "18:00"]] },
    { weekday: 5, shifts: [["10:00", "18:00"]] },
    { weekday: 6, shifts: [["10:00", "16:00"]] },
    { weekday: 7, shifts: [] },
  ],
  buffer_min: 10,
  lead_time_min: 60,
  cancel_notice_hours: 24,
  services: [
    { name: "Gel Manicure", duration_min: 45, price_cents: 4000 },
    { name: "Acrylic Set", duration_min: 75, price_cents: 6500 },
  ],
  staff: [
    { name: "Mai", title: "Nail Technician", service_names: ["Gel Manicure"] },
    { name: "Tran", title: "Nail Technician", service_names: ["Gel Manicure", "Acrylic Set"] },
  ],
  policy_note: "24-hour cancellation notice required.",
};

function toolUseResponse(input: unknown) {
  return {
    output: { message: { role: "assistant", content: [{ toolUse: { toolUseId: "t1", name: "save_business", input } }] } },
    stopReason: "tool_use",
    usage: { inputTokens: 10, outputTokens: 10, totalTokens: 20 },
    metrics: { latencyMs: 5 },
  };
}

let capturedCommand: ConverseCommand | undefined;

function stubClient(responseInput: unknown) {
  return {
    send: async (command: ConverseCommand) => {
      capturedCommand = command;
      return toolUseResponse(responseInput);
    },
  };
}

beforeEach(() => {
  capturedCommand = undefined;
});

afterEach(() => {
  setBedrockClient(null);
});

describe("onboardBusiness", () => {
  it("forces save_business, strips $schema, and sets temperature 0", async () => {
    setBedrockClient(stubClient(NAIL_SALON_PAYLOAD));
    await onboardBusiness("Lotus Nails is a nail salon with Mai and Tran.");

    assert.ok(capturedCommand);
    const input = capturedCommand!.input;
    assert.equal(input.toolConfig?.toolChoice && "tool" in input.toolConfig.toolChoice ? input.toolConfig.toolChoice.tool?.name : undefined, "save_business");
    assert.equal(input.inferenceConfig?.temperature, 0);

    const toolSpec = input.toolConfig?.tools?.[0];
    const jsonSchema = toolSpec && "toolSpec" in toolSpec ? (toolSpec.toolSpec?.inputSchema as { json?: Record<string, unknown> })?.json : undefined;
    assert.ok(jsonSchema);
    assert.equal("$schema" in (jsonSchema as object), false);
  });

  it("converts output correctly: an acrylic set only bookable with Tran", async () => {
    setBedrockClient(stubClient(NAIL_SALON_PAYLOAD));
    const business = await onboardBusiness("Lotus Nails is a nail salon with Mai and Tran.");

    assert.equal(business.createdVia, "bedrock-onboarding");
    const acrylic = business.services.find((s) => s.name === "Acrylic Set");
    assert.ok(acrylic);
    const staffWhoCanDoAcrylic = business.staff.filter((s) => s.serviceIds.includes(acrylic!.id));
    assert.equal(staffWhoCanDoAcrylic.length, 1);
    assert.equal(staffWhoCanDoAcrylic[0].name, "Tran");

    const gel = business.services.find((s) => s.name === "Gel Manicure");
    const staffWhoCanDoGel = business.staff.filter((s) => s.serviceIds.includes(gel!.id));
    assert.equal(staffWhoCanDoGel.length, 2);
  });

  it("the new business is immediately bookable", async () => {
    setBedrockClient(stubClient(NAIL_SALON_PAYLOAD));
    const business = await onboardBusiness("Lotus Nails is a nail salon with Mai and Tran.");

    const store = await Store.load(":memory:");
    store.data.businesses.push(business);

    const acrylic = business.services.find((s) => s.name === "Acrylic Set")!;
    const nowBiz = DateTime.fromISO("2026-10-18T09:00:00", { zone: business.timezone }); // Sunday, closed
    const window = parseSpokenWindow("", nowBiz); // asap -> horizon search

    const slots = findAvailability({
      business,
      service: acrylic,
      window,
      limit: 3,
      nowMs: nowBiz.toMillis(),
      appointments: store.data.appointments,
    });
    assert.ok(slots.length > 0);
    assert.equal(slots[0].staffId, business.staff.find((s) => s.name === "Tran")!.id);
  });

  it("rejects invalid output with a clear error", async () => {
    setBedrockClient(stubClient({ name: "Incomplete Biz" }));
    await assert.rejects(() => onboardBusiness("A vague description."), /Invalid onboarding output/);
  });

  it("rejects output where a service has no staff who can perform it", async () => {
    const badPayload = {
      ...NAIL_SALON_PAYLOAD,
      staff: [{ name: "Mai", title: "Nail Technician", service_names: ["Gel Manicure"] }], // nobody does Acrylic Set
    };
    setBedrockClient(stubClient(badPayload));
    await assert.rejects(() => onboardBusiness("desc"), /no staff member can perform/);
  });
});

describe("dailyBriefing", () => {
  it("stays within 90 words and mentions the business", async () => {
    const store = await Store.load(":memory:");
    const nowMs = DateTime.fromISO("2026-10-20T12:00:00", { zone: "America/Los_Angeles" }).toMillis();
    const briefing = dailyBriefing(store, "maple-street-barbers", nowMs);
    assert.ok(briefing.includes("Maple Street Barbers"));
    assert.ok(briefing.split(/\s+/).length <= 91); // allow the trailing "..." token
  });
});
