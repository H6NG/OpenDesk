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
  dynamoOwnersTable: "", // owner-auth off — plain dashboard behavior
  dynamoSessionsTable: "",
};

const BUSINESS_ID = "maple-street-barbers";

describe("POST /api/products, PATCH /api/products/:id", () => {
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

  it("creates a product with a slugified id and the given price/stock", async () => {
    const res = await fetch(`${baseUrl}/api/products`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ businessId: BUSINESS_ID, name: "Styling Gel", description: "Medium hold", priceCents: 1200, stockQty: 5 }),
    });
    assert.equal(res.status, 201);
    const { product } = await res.json();
    assert.equal(product.id, "styling-gel");
    assert.equal(product.priceCents, 1200);
    assert.equal(product.stockQty, 5);

    const state = await (await fetch(`${baseUrl}/api/state?business=${BUSINESS_ID}`)).json();
    assert.ok(state.business.products.some((p: { id: string }) => p.id === "styling-gel"));
  });

  it("disambiguates a duplicate product name with a numbered suffix", async () => {
    const make = () =>
      fetch(`${baseUrl}/api/products`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ businessId: BUSINESS_ID, name: "Wax", priceCents: 1000, stockQty: 3 }),
      });
    const first = await (await make()).json();
    const second = await (await make()).json();
    assert.equal(first.product.id, "wax");
    assert.equal(second.product.id, "wax-2");
  });

  it("rejects missing required fields", async () => {
    const res = await fetch(`${baseUrl}/api/products`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ businessId: BUSINESS_ID, name: "" }),
    });
    assert.equal(res.status, 400);
  });

  it("rejects an unknown business", async () => {
    const res = await fetch(`${baseUrl}/api/products`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ businessId: "nonexistent", name: "Wax", priceCents: 1000, stockQty: 3 }),
    });
    assert.equal(res.status, 404);
  });

  it("PATCH restocks the newly created product", async () => {
    const created = await (
      await fetch(`${baseUrl}/api/products`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ businessId: BUSINESS_ID, name: "Combs", priceCents: 500, stockQty: 10 }),
      })
    ).json();

    const res = await fetch(`${baseUrl}/api/products/${created.product.id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ businessId: BUSINESS_ID, stockQty: 2 }),
    });
    assert.equal(res.status, 200);
    const { product } = await res.json();
    assert.equal(product.stockQty, 2);
  });
});
