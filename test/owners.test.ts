import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import express from "express";
import type { Server } from "node:http";
import { GetCommand, PutCommand, DeleteCommand } from "@aws-sdk/lib-dynamodb";
import { signUpOwner, loginOwner, getSessionOwner, logoutOwner, setDynamoClient, OwnerAuthError } from "../src/owners.js";
import { registerDashboardRoutes } from "../src/dashboard.js";
import { Store } from "../src/store.js";
import type { Config } from "../src/config.js";

const OWNERS_TABLE = "test-owners";
const SESSIONS_TABLE = "test-sessions";

const BASE_CONFIG: Config = {
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
  dynamoOwnersTable: OWNERS_TABLE,
  dynamoSessionsTable: SESSIONS_TABLE,
  dynamoBusinessesTable: "",
};

/** In-memory stand-in for DynamoDBDocumentClient, good enough for Get/Put/Delete by primary key — exactly what owners.ts uses. */
function makeStubDynamoClient() {
  const tables = new Map<string, Map<string, unknown>>([
    [OWNERS_TABLE, new Map()],
    [SESSIONS_TABLE, new Map()],
  ]);
  function tableFor(name: string): Map<string, unknown> {
    const t = tables.get(name);
    if (!t) throw new Error(`Unknown table in stub: ${name}`);
    return t;
  }
  return {
    send: async (command: GetCommand | PutCommand | DeleteCommand) => {
      const input = command.input as { TableName: string; Key?: Record<string, string>; Item?: Record<string, unknown> };
      const table = tableFor(input.TableName);
      if (command instanceof GetCommand) {
        const key = Object.values(input.Key!)[0];
        return { Item: table.get(key) as Record<string, unknown> | undefined };
      }
      if (command instanceof PutCommand) {
        const item = input.Item!;
        const pk = input.TableName === OWNERS_TABLE ? (item.email as string) : (item.tokenHash as string);
        table.set(pk, item);
        return {};
      }
      if (command instanceof DeleteCommand) {
        const key = Object.values(input.Key!)[0];
        table.delete(key);
        return {};
      }
      throw new Error("Unsupported command in stub");
    },
  };
}

beforeEach(() => {
  setDynamoClient(makeStubDynamoClient());
});
afterEach(() => {
  setDynamoClient(null);
});

describe("signUpOwner / loginOwner / getSessionOwner / logoutOwner", () => {
  it("signs up, logs in, resolves the session, and logs out", async () => {
    const owner = await signUpOwner(BASE_CONFIG, { email: "Jess@Shop.com", password: "correct-horse", businessId: "shop-a" });
    assert.equal(owner.email, "jess@shop.com"); // lowercased
    assert.equal(owner.businessId, "shop-a");
    assert.notEqual(owner.passwordHash, "correct-horse"); // never stored in plaintext

    const { token, owner: loggedIn } = await loginOwner(BASE_CONFIG, "Jess@Shop.com", "correct-horse");
    assert.equal(loggedIn.id, owner.id);

    const identity = await getSessionOwner(BASE_CONFIG, token);
    assert.deepEqual(identity, { ownerId: owner.id, businessId: "shop-a", role: "owner" });

    await logoutOwner(BASE_CONFIG, token);
    assert.equal(await getSessionOwner(BASE_CONFIG, token), null);
  });

  it("rejects a duplicate email", async () => {
    await signUpOwner(BASE_CONFIG, { email: "dup@shop.com", password: "correct-horse", businessId: "shop-a" });
    await assert.rejects(() => signUpOwner(BASE_CONFIG, { email: "dup@shop.com", password: "another-password", businessId: "shop-b" }), OwnerAuthError);
  });

  it("rejects a password under 8 characters", async () => {
    await assert.rejects(() => signUpOwner(BASE_CONFIG, { email: "short@shop.com", password: "short", businessId: "shop-a" }), OwnerAuthError);
  });

  it("rejects the wrong password", async () => {
    await signUpOwner(BASE_CONFIG, { email: "wrong@shop.com", password: "correct-horse", businessId: "shop-a" });
    await assert.rejects(() => loginOwner(BASE_CONFIG, "wrong@shop.com", "incorrect-horse"), OwnerAuthError);
  });

  it("rejects login for an unknown email", async () => {
    await assert.rejects(() => loginOwner(BASE_CONFIG, "nobody@shop.com", "whatever1"), OwnerAuthError);
  });

  it("getSessionOwner returns null for a missing or garbage token", async () => {
    assert.equal(await getSessionOwner(BASE_CONFIG, undefined), null);
    assert.equal(await getSessionOwner(BASE_CONFIG, "not-a-real-token"), null);
  });
});

describe("dashboard routes with owner-auth enabled (in-process, stub Dynamo client)", () => {
  let server: Server;
  let baseUrl: string;

  beforeEach(async () => {
    const store = await Store.load(":memory:");
    store.data.businesses = [
      { ...store.data.businesses[0], id: "shop-a", name: "Shop A" },
      { ...store.data.businesses[0], id: "shop-b", name: "Shop B" },
    ];
    const app = express();
    app.use(express.json());
    registerDashboardRoutes(app, BASE_CONFIG, store);
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

  function cookieFrom(res: Response): string {
    const setCookie = res.headers.get("set-cookie") ?? "";
    const match = setCookie.match(/fd_session=[^;]+/);
    assert.ok(match, "expected a fd_session cookie in the response");
    return match![0];
  }

  it("GET /api/me reports ownerAuthEnabled and unauthenticated before login", async () => {
    const res = await fetch(`${baseUrl}/api/me`);
    const data = await res.json();
    assert.equal(data.ownerAuthEnabled, true);
    assert.equal(data.authenticated, false);
    assert.equal(data.businessId, undefined); // JSON drops the key entirely when undefined, so this still holds
  });

  it("signup sets a session cookie that GET /api/state honors, scoped to that owner's business only", async () => {
    const signupRes = await fetch(`${baseUrl}/api/signup`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: "owner@shop-a.com", password: "correct-horse", businessId: "shop-a" }),
    });
    assert.equal(signupRes.status, 201);
    const cookie = cookieFrom(signupRes);

    const stateRes = await fetch(`${baseUrl}/api/state`, { headers: { cookie } });
    const state = await stateRes.json();
    assert.equal(state.business.id, "shop-a");

    // Even if the client tries to ask for a different business via the query string, the session wins.
    const spoofRes = await fetch(`${baseUrl}/api/state?business=shop-b`, { headers: { cookie } });
    const spoofed = await spoofRes.json();
    assert.equal(spoofed.business.id, "shop-a");
  });

  it("rejects mutating a different business's data even with a valid session for another business", async () => {
    const signupRes = await fetch(`${baseUrl}/api/signup`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: "owner2@shop-a.com", password: "correct-horse", businessId: "shop-a" }),
    });
    const cookie = cookieFrom(signupRes);

    const res = await fetch(`${baseUrl}/api/staff-time-off`, {
      method: "POST",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify({ businessId: "shop-b", staffId: "whoever", fromIso: "2026-10-20T09:00:00-07:00", toIso: "2026-10-20T17:00:00-07:00" }),
    });
    assert.equal(res.status, 403);
  });

  it("rejects /api/state with no cookie at all", async () => {
    const res = await fetch(`${baseUrl}/api/state`);
    assert.equal(res.status, 401);
  });

  it("logout clears the session so the cookie no longer works", async () => {
    const signupRes = await fetch(`${baseUrl}/api/signup`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: "owner3@shop-a.com", password: "correct-horse", businessId: "shop-a" }),
    });
    const cookie = cookieFrom(signupRes);

    await fetch(`${baseUrl}/api/logout`, { method: "POST", headers: { cookie } });
    const res = await fetch(`${baseUrl}/api/state`, { headers: { cookie } });
    assert.equal(res.status, 401);
  });

  it("rejects an invalid role at signup", async () => {
    const res = await fetch(`${baseUrl}/api/signup`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: "bad-role@shop-a.com", password: "correct-horse", businessId: "shop-a", role: "superadmin" }),
    });
    assert.equal(res.status, 400);
  });

  it("an employee session is blocked from adding staff or products; a manager session is allowed", async () => {
    const employeeSignup = await fetch(`${baseUrl}/api/signup`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: "employee@shop-a.com", password: "correct-horse", businessId: "shop-a", role: "employee" }),
    });
    const employeeCookie = cookieFrom(employeeSignup);

    const blockedStaff = await fetch(`${baseUrl}/api/staff`, {
      method: "POST",
      headers: { "content-type": "application/json", cookie: employeeCookie },
      body: JSON.stringify({ businessId: "shop-a", name: "New Hire", title: "Barber", serviceIds: ["mens-cut"] }),
    });
    assert.equal(blockedStaff.status, 403);

    const blockedProduct = await fetch(`${baseUrl}/api/products`, {
      method: "POST",
      headers: { "content-type": "application/json", cookie: employeeCookie },
      body: JSON.stringify({ businessId: "shop-a", name: "Pomade", priceCents: 1500, stockQty: 5 }),
    });
    assert.equal(blockedProduct.status, 403);

    const managerSignup = await fetch(`${baseUrl}/api/signup`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: "manager@shop-a.com", password: "correct-horse", businessId: "shop-a", role: "manager" }),
    });
    const managerCookie = cookieFrom(managerSignup);

    const allowedProduct = await fetch(`${baseUrl}/api/products`, {
      method: "POST",
      headers: { "content-type": "application/json", cookie: managerCookie },
      body: JSON.stringify({ businessId: "shop-a", name: "Pomade", priceCents: 1500, stockQty: 5 }),
    });
    assert.equal(allowedProduct.status, 201);
  });
});
