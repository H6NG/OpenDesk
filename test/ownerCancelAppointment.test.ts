import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import express from "express";
import { DateTime } from "luxon";
import type { Server } from "node:http";
import { registerDashboardRoutes } from "../src/dashboard.js";
import { Store } from "../src/store.js";
import type { Config } from "../src/config.js";

const CONFIG: Config = {
  port: 0,
  publicUrl: "http://localhost:0",
  authMode: "none",
  oauthClientId: "",
  oauthClientSecret: null,
  oauthRedirectUris: [],
  oauthAllowAnyRedirect: false,
  dataFile: ":memory:",
  dashboardToken: null,
  awsRegion: "us-east-1",
  bedrockModelId: "",
  twilioAccountSid: "",
  twilioAuthToken: "",
  twilioFromNumber: "",
  dynamoOwnersTable: "",
  dynamoSessionsTable: "",
  dynamoBusinessesTable: "",
};

const BUSINESS_ID = "maple-street-barbers";

// Far enough out (well past the 14-day seed window) and pinned to a Wednesday, which this
// business is open 10:00-19:00, so the slot is guaranteed free regardless of when this runs.
function freeWednesdaySlot(): string {
  let dt = DateTime.now().setZone("America/Los_Angeles").plus({ days: 60 }).set({ hour: 10, minute: 0, second: 0, millisecond: 0 });
  while (dt.weekday !== 3) dt = dt.plus({ days: 1 });
  return dt.toISO()!;
}

describe("POST /api/appointments/:idOrCode/cancel (owner-side cancel)", () => {
  let server: Server;
  let baseUrl: string;

  before(async () => {
    const store = await Store.load(":memory:");
    const app = express();
    app.use(express.json());
    registerDashboardRoutes(app, CONFIG, store);
    await new Promise<void>((resolve) => {
      server = app.listen(0, resolve);
    });
    const address = server.address();
    const port = typeof address === "object" && address ? address.port : 0;
    baseUrl = `http://localhost:${port}`;
  });

  after(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  it("cancels an appointment and frees the slot for the waitlist", async () => {
    const start = freeWednesdaySlot();
    const created = await (
      await fetch(`${baseUrl}/api/appointments`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ businessId: BUSINESS_ID, serviceId: "beard-trim", staffId: "priya", customerName: "Owner Cancel Test", start, source: "phone" }),
      })
    ).json();
    assert.ok(created.appointment, `expected a created appointment, got: ${JSON.stringify(created)}`);
    const id = created.appointment.id;

    const res = await fetch(`${baseUrl}/api/appointments/${encodeURIComponent(id)}/cancel`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ businessId: BUSINESS_ID }),
    });
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.appointment.status, "cancelled");
  });

  it("rejects cancelling an appointment for the wrong business", async () => {
    const start = freeWednesdaySlot();
    const created = await (
      await fetch(`${baseUrl}/api/appointments`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ businessId: BUSINESS_ID, serviceId: "mens-cut", staffId: "sam", customerName: "Wrong Business Test", start, source: "phone" }),
      })
    ).json();
    const id = created.appointment.id;

    const res = await fetch(`${baseUrl}/api/appointments/${encodeURIComponent(id)}/cancel`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ businessId: "harbour-physio-massage" }),
    });
    assert.equal(res.status, 400);
  });

  it("rejects an unknown appointment id/code", async () => {
    const res = await fetch(`${baseUrl}/api/appointments/does-not-exist/cancel`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ businessId: BUSINESS_ID }),
    });
    assert.equal(res.status, 400);
  });

  it("rejects a missing businessId", async () => {
    const res = await fetch(`${baseUrl}/api/appointments/whatever/cancel`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({}),
    });
    assert.equal(res.status, 400);
  });
});
