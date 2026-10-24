import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { DateTime } from "luxon";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { seedBusinesses, seedAppointments } from "../src/seed.js";
import { DEMO_CUSTOMER } from "../src/store.js";
import { spawnTestServer, FRONTDESK_NOW, type TestServer } from "./e2e-helpers.js";
import type { StoreData } from "../src/types.js";

/**
 * Drives the two newest seeded businesses (the hotel and the grocery store) through the
 * real MCP tools against the actual production seed data — not a synthetic fixture — so a
 * regression in how they're modeled (e.g. a service with no staff, a product typo) surfaces
 * here instead of live during a demo.
 */
function buildRealSeedFixture(): StoreData {
  const businesses = seedBusinesses();
  const { appointments, customers } = seedAppointments(businesses, DateTime.fromISO(FRONTDESK_NOW));
  return {
    businesses,
    customers: [DEMO_CUSTOMER, ...customers],
    appointments,
    orders: [],
    staffTimeOff: [],
    waitlist: [],
    events: [],
    oauthCodes: [],
    oauthTokens: [],
  };
}

async function newClient(baseUrl: string) {
  const client = new Client({ name: "e2e-test", version: "0.1.0" });
  const transport = new StreamableHTTPClientTransport(new URL(`${baseUrl}/mcp`));
  await client.connect(transport);
  return client;
}

async function callTool(client: Client, name: string, args: Record<string, unknown>) {
  const result = await client.callTool({ name, arguments: args });
  return result as { isError?: boolean; structuredContent?: Record<string, unknown>; content: { type: string; text: string }[] };
}

describe("real seed data: The Alder House Hotel and Corner Market Groceries", () => {
  let server: TestServer;
  let client: Client;

  before(async () => {
    server = await spawnTestServer({ port: 3915, fixture: buildRealSeedFixture(), authMode: "none" });
    client = await newClient(server.baseUrl);
  });

  after(async () => {
    await client.close();
    await server.stop();
  });

  it("find_businesses surfaces the hotel by category and the grocery store by keyword", async () => {
    const byCategory = await callTool(client, "find_businesses", { category: "hotel" });
    assert.equal(byCategory.isError, undefined);
    const hotelMatches = byCategory.structuredContent!.businesses as { business_id: string }[];
    assert.ok(hotelMatches.some((b) => b.business_id === "alder-house-hotel"));

    const byKeyword = await callTool(client, "find_businesses", { query: "curbside pickup" });
    assert.equal(byKeyword.isError, undefined);
    const groceryMatches = byKeyword.structuredContent!.businesses as { business_id: string }[];
    assert.ok(groceryMatches.some((b) => b.business_id === "corner-market-groceries"));
  });

  it("books a hotel concierge service end to end: find availability -> hold -> confirm", async () => {
    const details = await callTool(client, "get_business_details", { business_id: "alder-house-hotel" });
    assert.equal(details.isError, undefined);
    const services = details.structuredContent!.services as { id: string }[];
    assert.ok(services.some((s) => s.id === "late-checkout"));

    const avail = await callTool(client, "find_availability", { business_id: "alder-house-hotel", service_id: "late-checkout", date: "2026-10-20" });
    assert.equal(avail.isError, undefined);
    const slots = avail.structuredContent!.slots as { start: string; staff_name: string }[];
    assert.ok(slots.length > 0, "expected at least one open slot for late-checkout on a Tuesday");

    const hold = await callTool(client, "hold_appointment", { business_id: "alder-house-hotel", service_id: "late-checkout", start: slots[0].start, staff: slots[0].staff_name });
    assert.equal(hold.isError, undefined);

    const confirm = await callTool(client, "confirm_appointment", { hold_id: hold.structuredContent!.hold_id as string });
    assert.equal(confirm.isError, undefined);
    assert.match(confirm.structuredContent!.code as string, /^[A-Z0-9]{4}$/);
  });

  it("orders a grocery product end to end: check availability -> order -> stock decrements", async () => {
    const before = await callTool(client, "check_item_availability", { business_id: "corner-market-groceries", item: "Organic Bananas" });
    assert.equal(before.isError, undefined);
    const stockBefore = before.structuredContent!.stock_qty as number;
    assert.ok(stockBefore > 0, "bananas should be in stock in the seed data");

    const order = await callTool(client, "order_item", { business_id: "corner-market-groceries", item: "Organic Bananas", quantity: 2, pickup_when: "this afternoon" });
    assert.equal(order.isError, undefined);

    const after = await callTool(client, "check_item_availability", { business_id: "corner-market-groceries", item: "Organic Bananas" });
    assert.equal((after.structuredContent!.stock_qty as number), stockBefore - 2);
  });

  it("the out-of-stock avocados correctly reject an order", async () => {
    const avail = await callTool(client, "check_item_availability", { business_id: "corner-market-groceries", item: "Avocados" });
    assert.equal(avail.structuredContent!.stock_qty, 0);

    const order = await callTool(client, "order_item", { business_id: "corner-market-groceries", item: "Avocados", quantity: 1 });
    assert.equal(order.isError, true);
  });
});
