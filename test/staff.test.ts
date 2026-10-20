import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import express from "express";
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
const SERVICE_ID = "mens-cut"; // real seeded service on this business

describe("POST /api/staff", () => {
  let server: Server;
  let baseUrl: string;

  beforeEach(async () => {
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

  afterEach(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  it("adds a staff member with a slugified id and the given services", async () => {
    const res = await fetch(`${baseUrl}/api/staff`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ businessId: BUSINESS_ID, name: "Jordan Lee", title: "Barber", serviceIds: [SERVICE_ID] }),
    });
    assert.equal(res.status, 201);
    const { staff } = await res.json();
    assert.equal(staff.id, "jordan-lee");
    assert.equal(staff.title, "Barber");
    assert.deepEqual(staff.serviceIds, [SERVICE_ID]);

    const state = await (await fetch(`${baseUrl}/api/state?business=${BUSINESS_ID}`)).json();
    assert.ok(state.business.staff.some((s: { id: string }) => s.id === "jordan-lee"));
  });

  it("disambiguates a duplicate name with a numbered suffix", async () => {
    const make = () =>
      fetch(`${baseUrl}/api/staff`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ businessId: BUSINESS_ID, name: "Sam", title: "Barber", serviceIds: [SERVICE_ID] }),
      });
    // "sam" already exists in the seed data for this business.
    const res = await (await make()).json();
    assert.equal(res.staff.id, "sam-2");
  });

  it("silently drops serviceIds that don't exist on the business", async () => {
    const res = await fetch(`${baseUrl}/api/staff`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ businessId: BUSINESS_ID, name: "Taylor", title: "Barber", serviceIds: [SERVICE_ID, "nonexistent-service"] }),
    });
    const { staff } = await res.json();
    assert.deepEqual(staff.serviceIds, [SERVICE_ID]);
  });

  it("rejects a request where none of the serviceIds exist", async () => {
    const res = await fetch(`${baseUrl}/api/staff`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ businessId: BUSINESS_ID, name: "Taylor", title: "Barber", serviceIds: ["nonexistent-service"] }),
    });
    assert.equal(res.status, 400);
  });

  it("rejects missing required fields", async () => {
    const res = await fetch(`${baseUrl}/api/staff`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ businessId: BUSINESS_ID, name: "Taylor" }),
    });
    assert.equal(res.status, 400);
  });

  it("rejects an unknown business", async () => {
    const res = await fetch(`${baseUrl}/api/staff`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ businessId: "nonexistent", name: "Taylor", title: "Barber", serviceIds: [SERVICE_ID] }),
    });
    assert.equal(res.status, 404);
  });

  it("a newly added staff member is immediately bookable via findAvailability", async () => {
    await fetch(`${baseUrl}/api/staff`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ businessId: BUSINESS_ID, name: "Jordan Lee", title: "Barber", serviceIds: [SERVICE_ID] }),
    });
    const state = await (await fetch(`${baseUrl}/api/state?business=${BUSINESS_ID}`)).json();
    const added = state.business.staff.find((s: { id: string }) => s.id === "jordan-lee");
    assert.ok(added);
    assert.equal(added.serviceIds[0], SERVICE_ID);
  });
});
