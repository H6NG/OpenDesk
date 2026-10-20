import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import express from "express";
import type { Server } from "node:http";
import { PutCommand, ScanCommand } from "@aws-sdk/lib-dynamodb";
import { putBusiness, listBusinesses, loadBusinessesIntoStore, setBusinessDynamoClient } from "../src/businessDirectory.js";
import { registerDashboardRoutes } from "../src/dashboard.js";
import { Store } from "../src/store.js";
import type { Config } from "../src/config.js";
import type { Business } from "../src/types.js";

const BUSINESSES_TABLE = "test-businesses";

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
  dynamoBusinessesTable: BUSINESSES_TABLE,
};

function makeBusiness(overrides: Partial<Business> = {}): Business {
  return {
    id: "test-shop",
    name: "Test Shop",
    category: "barber",
    keywords: [],
    address: "1 Main St",
    city: "Nowhere",
    phone: "+1-555-0100",
    timezone: "America/Los_Angeles",
    hours: {},
    services: [],
    staff: [],
    bufferMin: 0,
    slotStepMin: 15,
    leadTimeMin: 0,
    cancelNoticeHours: 0,
    policyNote: "",
    ...overrides,
  };
}

/** In-memory stand-in for DynamoDBDocumentClient, good enough for Put/Scan by primary key. */
function makeStubDynamoClient() {
  const table = new Map<string, Record<string, unknown>>();
  return {
    send: async (command: PutCommand | ScanCommand) => {
      if (command instanceof PutCommand) {
        const item = command.input.Item as Record<string, unknown>;
        table.set(item.id as string, item);
        return {};
      }
      if (command instanceof ScanCommand) {
        return { Items: Array.from(table.values()) };
      }
      throw new Error("Unsupported command in stub");
    },
  };
}

beforeEach(() => {
  setBusinessDynamoClient(makeStubDynamoClient());
});
afterEach(() => {
  setBusinessDynamoClient(null);
});

describe("putBusiness / listBusinesses", () => {
  it("round-trips a business through the stub table", async () => {
    const business = makeBusiness();
    await putBusiness(CONFIG, business);
    const businesses = await listBusinesses(CONFIG);
    assert.equal(businesses.length, 1);
    assert.equal(businesses[0].id, "test-shop");
  });
});

describe("loadBusinessesIntoStore", () => {
  it("appends a Dynamo business not already in the store", async () => {
    await putBusiness(CONFIG, makeBusiness({ id: "dynamo-only" }));
    const store = await Store.load(":memory:");
    const before = store.data.businesses.length;
    await loadBusinessesIntoStore(CONFIG, store);
    assert.equal(store.data.businesses.length, before + 1);
    assert.ok(store.data.businesses.some((b) => b.id === "dynamo-only"));
  });

  it("overwrites a store business that shares an id with a Dynamo one", async () => {
    const store = await Store.load(":memory:");
    const seededId = store.data.businesses[0].id;
    await putBusiness(CONFIG, makeBusiness({ id: seededId, name: "Overwritten Name" }));
    await loadBusinessesIntoStore(CONFIG, store);
    const match = store.data.businesses.find((b) => b.id === seededId);
    assert.equal(match?.name, "Overwritten Name");
  });
});

describe("POST /api/businesses with a configured directory", () => {
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

  it("persists the published business to the Dynamo stub, not just in-memory", async () => {
    const res = await fetch(`${baseUrl}/api/businesses`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ business: makeBusiness({ id: "published-shop" }) }),
    });
    assert.equal(res.status, 201);

    const persisted = await listBusinesses(CONFIG);
    assert.ok(persisted.some((b) => b.id === "published-shop"));
  });
});
