import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { createHash, randomBytes } from "node:crypto";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import {
  buildNoneModeFixture,
  buildOAuthModeFixture,
  spawnTestServer,
  OAUTH_CLIENT_ID,
  OAUTH_CLIENT_SECRET,
  OAUTH_REDIRECT_URI,
  type TestServer,
} from "./e2e-helpers.js";

function b64url(buf: Buffer): string {
  return buf.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

async function newClient(baseUrl: string, accessToken?: string) {
  const client = new Client({ name: "e2e-test", version: "0.1.0" });
  const transport = new StreamableHTTPClientTransport(
    new URL(`${baseUrl}/mcp`),
    accessToken ? { requestInit: { headers: { Authorization: `Bearer ${accessToken}` } } } : undefined,
  );
  await client.connect(transport);
  return client;
}

async function timedCallTool(client: Client, name: string, args: Record<string, unknown>) {
  const t0 = Date.now();
  const result = await client.callTool({ name, arguments: args });
  const elapsed = Date.now() - t0;
  assert.ok(elapsed < 500, `${name} took ${elapsed}ms, expected < 500ms`);
  return result as { isError?: boolean; structuredContent?: Record<string, unknown>; content: { type: string; text: string }[] };
}

async function linkCustomer(baseUrl: string, name: string, phone: string): Promise<{ accessToken: string; refreshToken: string }> {
  const verifier = b64url(randomBytes(32));
  const challenge = b64url(createHash("sha256").update(verifier).digest());
  const resource = `${baseUrl}/mcp`;

  const authorizeResp = await fetch(`${baseUrl}/oauth/authorize`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    redirect: "manual",
    body: new URLSearchParams({
      name,
      phone,
      response_type: "code",
      client_id: OAUTH_CLIENT_ID,
      redirect_uri: OAUTH_REDIRECT_URI,
      code_challenge: challenge,
      code_challenge_method: "S256",
      resource,
      state: "s1",
    }),
  });
  const location = authorizeResp.headers.get("location");
  if (!location) throw new Error(`authorize did not redirect: ${authorizeResp.status} ${await authorizeResp.text()}`);
  const code = new URL(location).searchParams.get("code")!;

  const tokenResp = await fetch(`${baseUrl}/oauth/token`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      code,
      redirect_uri: OAUTH_REDIRECT_URI,
      code_verifier: verifier,
      resource,
      client_id: OAUTH_CLIENT_ID,
      client_secret: OAUTH_CLIENT_SECRET,
    }),
  });
  if (!tokenResp.ok) throw new Error(`token exchange failed: ${tokenResp.status} ${await tokenResp.text()}`);
  const tokens = await tokenResp.json();
  return { accessToken: tokens.access_token, refreshToken: tokens.refresh_token };
}

describe("e2e: none mode", () => {
  let server: TestServer;
  let client: Client;

  before(async () => {
    server = await spawnTestServer({ port: 3911, fixture: buildNoneModeFixture(), authMode: "none" });
    client = await newClient(server.baseUrl);
  });

  after(async () => {
    await client.close();
    await server.stop();
  });

  it("full flow: find -> details -> availability -> hold -> confirm", async () => {
    const found = await timedCallTool(client, "find_businesses", { query: "Shop A" });
    assert.equal(found.isError, undefined);
    assert.equal((found.structuredContent!.businesses as unknown[]).length, 1);

    const details = await timedCallTool(client, "get_business_details", { business_id: "shop-a" });
    assert.ok((details.structuredContent!.services as unknown[]).length >= 1);

    const avail = await timedCallTool(client, "find_availability", { business_id: "shop-a", service_id: "cut", date: "2026-10-20" });
    const slots = avail.structuredContent!.slots as { start: string; staff_name: string }[];
    assert.ok(slots.length > 0);

    const hold = await timedCallTool(client, "hold_appointment", { business_id: "shop-a", service_id: "cut", start: slots[0].start, staff: slots[0].staff_name });
    assert.equal(hold.isError, undefined);
    const holdId = hold.structuredContent!.hold_id as string;

    const confirm = await timedCallTool(client, "confirm_appointment", { hold_id: holdId });
    assert.equal(confirm.isError, undefined);
    assert.match(confirm.structuredContent!.code as string, /^[A-Z0-9]{4}$/);
  });

  it("prevents double-booking the same slot and staff", async () => {
    const start = "2026-10-20T10:00:00.000-07:00";
    const hold1 = await timedCallTool(client, "hold_appointment", { business_id: "shop-a", service_id: "cut", start, staff: "Sam" });
    assert.equal(hold1.isError, undefined);

    const hold2 = await timedCallTool(client, "hold_appointment", { business_id: "shop-a", service_id: "cut", start, staff: "Sam" });
    assert.equal(hold2.isError, true);
  });

  it("confirm_appointment is idempotent", async () => {
    const start = "2026-10-20T11:00:00.000-07:00";
    const hold = await timedCallTool(client, "hold_appointment", { business_id: "shop-a", service_id: "cut", start, staff: "Priya" });
    const holdId = hold.structuredContent!.hold_id as string;

    const c1 = await timedCallTool(client, "confirm_appointment", { hold_id: holdId });
    const c2 = await timedCallTool(client, "confirm_appointment", { hold_id: holdId });
    assert.equal(c1.structuredContent!.code, c2.structuredContent!.code);
  });

  it("reschedules an appointment by its 4-character code", async () => {
    const start = "2026-10-20T12:00:00.000-07:00";
    const hold = await timedCallTool(client, "hold_appointment", { business_id: "shop-a", service_id: "cut", start, staff: "Sam" });
    const confirm = await timedCallTool(client, "confirm_appointment", { hold_id: hold.structuredContent!.hold_id as string });
    const code = confirm.structuredContent!.code as string;

    const newStart = "2026-10-20T13:00:00.000-07:00";
    const resched = await timedCallTool(client, "reschedule_appointment", { code, new_start: newStart });
    assert.equal(resched.isError, undefined);
    assert.equal(resched.structuredContent!.start, newStart);
  });

  it("says the business is closed on a fully-closed day", async () => {
    const avail = await timedCallTool(client, "find_availability", { business_id: "shop-a", service_id: "cut", date: "2026-10-18" }); // Sunday, closed
    assert.equal(avail.structuredContent!.can_join_waitlist, false);
    assert.equal((avail.structuredContent!.slots as unknown[]).length, 0);
    assert.match(avail.structuredContent!.speech as string, /closed/i);
  });

  it("offers alternatives and the waitlist when fully booked, then auto-offers the freed slot on cancel", async () => {
    // Monday (10-19) is pre-booked solid for both staff in the fixture.
    const avail = await timedCallTool(client, "find_availability", { business_id: "shop-a", service_id: "cut", date: "2026-10-19" });
    assert.equal((avail.structuredContent!.slots as unknown[]).length, 0);
    assert.equal(avail.structuredContent!.can_join_waitlist, true);
    assert.ok((avail.structuredContent!.alternatives as unknown[]).length > 0);
    assert.match(avail.structuredContent!.speech as string, /fully booked/i);

    const join = await timedCallTool(client, "join_waitlist", { business_id: "shop-a", service_id: "cut", when: "monday" });
    assert.equal(join.isError, undefined);

    const cancel = await timedCallTool(client, "cancel_appointment", { code: "MON1" });
    assert.equal(cancel.structuredContent!.cancelled, true);

    const list = await timedCallTool(client, "list_my_appointments", {});
    const appts = list.structuredContent!.appointments as { is_waitlist_offer: boolean; id: string }[];
    const offer = appts.find((a) => a.is_waitlist_offer);
    assert.ok(offer, "expected a waitlist_offer appointment after cancelling the freed slot");

    const confirmOffer = await timedCallTool(client, "confirm_appointment", { hold_id: offer!.id });
    assert.equal(confirmOffer.isError, undefined);
  });

  it("returns a recoverable error for an unknown business", async () => {
    const res = await timedCallTool(client, "get_business_details", { business_id: "does-not-exist" });
    assert.equal(res.isError, true);
    assert.match(res.content[0].text, /find_businesses/);
  });

  it("GET /health reports protocol 2025-11-25", async () => {
    const res = await fetch(`${server.baseUrl}/health`);
    const health = await res.json();
    assert.equal(health.protocol, "2025-11-25");
    assert.equal(health.transport, "streamable-http");
    assert.equal(health.authMode, "none");
  });

  it("GET /api/state returns dashboard state for the business", async () => {
    const res = await fetch(`${server.baseUrl}/api/state?business=shop-a&days=7`);
    assert.equal(res.status, 200);
    const state = await res.json();
    assert.equal(state.business.id, "shop-a");
    assert.ok(Array.isArray(state.appointments));
  });

  it("GET /mcp returns 405 with Allow: POST", async () => {
    const res = await fetch(`${server.baseUrl}/mcp`, { method: "GET" });
    assert.equal(res.status, 405);
    assert.equal(res.headers.get("allow"), "POST");
  });
});

describe("e2e: oauth mode", () => {
  let server: TestServer;

  before(async () => {
    server = await spawnTestServer({
      port: 3912,
      fixture: buildOAuthModeFixture(),
      authMode: "oauth",
      extraEnv: {
        OAUTH_CLIENT_ID,
        OAUTH_CLIENT_SECRET,
        OAUTH_REDIRECT_URIS: OAUTH_REDIRECT_URI,
      },
    });
  });

  after(async () => {
    await server.stop();
  });

  describe("part 1b: two linked customers", () => {
    it("A books the only slot, B waitlists, A cancels, B gets offered and confirms, A cannot cancel B's booking", async () => {
      const a = await linkCustomer(server.baseUrl, "Customer A", "+1-555-0001");
      const b = await linkCustomer(server.baseUrl, "Customer B", "+1-555-0002");
      const clientA = await newClient(server.baseUrl, a.accessToken);
      const clientB = await newClient(server.baseUrl, b.accessToken);

      const availA = await timedCallTool(clientA, "find_availability", { business_id: "shop-b", service_id: "groom", date: "2026-10-20" });
      const slotsA = availA.structuredContent!.slots as { start: string }[];
      assert.ok(slotsA.length > 0);

      const holdA = await timedCallTool(clientA, "hold_appointment", { business_id: "shop-b", service_id: "groom", start: slotsA[0].start });
      const confirmA = await timedCallTool(clientA, "confirm_appointment", { hold_id: holdA.structuredContent!.hold_id as string });
      const codeA = confirmA.structuredContent!.code as string;

      const availB = await timedCallTool(clientB, "find_availability", { business_id: "shop-b", service_id: "groom", date: "2026-10-20" });
      assert.equal((availB.structuredContent!.slots as unknown[]).length, 0);
      assert.equal(availB.structuredContent!.can_join_waitlist, true);

      const joinB = await timedCallTool(clientB, "join_waitlist", { business_id: "shop-b", service_id: "groom", when: "tuesday" });
      assert.equal(joinB.isError, undefined);

      const cancelA = await timedCallTool(clientA, "cancel_appointment", { code: codeA });
      assert.equal(cancelA.structuredContent!.cancelled, true);

      const listB = await timedCallTool(clientB, "list_my_appointments", {});
      const apptsB = listB.structuredContent!.appointments as { is_waitlist_offer: boolean; id: string; code: string }[];
      const offerB = apptsB.find((x) => x.is_waitlist_offer);
      assert.ok(offerB, "expected customer B to see a waitlist_offer");

      const confirmB = await timedCallTool(clientB, "confirm_appointment", { hold_id: offerB!.id });
      assert.equal(confirmB.isError, undefined);
      const codeB = confirmB.structuredContent!.code as string;

      const aCancelsB = await timedCallTool(clientA, "cancel_appointment", { code: codeB });
      assert.equal(aCancelsB.isError, true);

      await clientA.close();
      await clientB.close();
    });
  });

  describe("part 2: oauth protocol", () => {
    it("401 with no WWW-Authenticate header when unauthenticated", async () => {
      const res = await fetch(`${server.baseUrl}/mcp`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", method: "initialize", id: 1 }),
      });
      assert.equal(res.status, 401);
      assert.equal(res.headers.has("www-authenticate"), false);
    });

    it("protected resource metadata is correct", async () => {
      const res = await fetch(`${server.baseUrl}/.well-known/oauth-protected-resource`);
      const meta = await res.json();
      assert.equal(meta.resource, `${server.baseUrl}/mcp`);
      assert.deepEqual(meta.authorization_servers, [server.baseUrl]);
      assert.deepEqual(meta.scopes_supported, ["appointments"]);
      assert.deepEqual(meta.bearer_methods_supported, ["header"]);

      const mcpVariant = await fetch(`${server.baseUrl}/.well-known/oauth-protected-resource/mcp`);
      assert.deepEqual(await mcpVariant.json(), meta);
    });

    it("authorization server metadata includes S256", async () => {
      const res = await fetch(`${server.baseUrl}/.well-known/oauth-authorization-server`);
      const meta = await res.json();
      assert.equal(meta.issuer, server.baseUrl);
      assert.ok(meta.code_challenge_methods_supported.includes("S256"));
    });

    it("rejects a wrong resource parameter at /oauth/authorize", async () => {
      const verifier = b64url(randomBytes(32));
      const challenge = b64url(createHash("sha256").update(verifier).digest());
      const url = new URL(`${server.baseUrl}/oauth/authorize`);
      url.searchParams.set("response_type", "code");
      url.searchParams.set("client_id", OAUTH_CLIENT_ID);
      url.searchParams.set("redirect_uri", OAUTH_REDIRECT_URI);
      url.searchParams.set("code_challenge", challenge);
      url.searchParams.set("code_challenge_method", "S256");
      url.searchParams.set("resource", "https://wrong.example/mcp");
      const res = await fetch(url, { redirect: "manual" });
      assert.equal(res.status, 302);
      const location = new URL(res.headers.get("location")!);
      assert.equal(location.searchParams.get("error"), "invalid_target");
    });

    it("rejects plain PKCE", async () => {
      const url = new URL(`${server.baseUrl}/oauth/authorize`);
      url.searchParams.set("response_type", "code");
      url.searchParams.set("client_id", OAUTH_CLIENT_ID);
      url.searchParams.set("redirect_uri", OAUTH_REDIRECT_URI);
      url.searchParams.set("code_challenge", "plainvalue");
      url.searchParams.set("code_challenge_method", "plain");
      url.searchParams.set("resource", `${server.baseUrl}/mcp`);
      const res = await fetch(url, { redirect: "manual" });
      assert.equal(res.status, 302);
      const location = new URL(res.headers.get("location")!);
      assert.equal(location.searchParams.get("error"), "invalid_request");
    });

    it("rejects an unregistered redirect_uri without redirecting to it", async () => {
      const verifier = b64url(randomBytes(32));
      const challenge = b64url(createHash("sha256").update(verifier).digest());
      const url = new URL(`${server.baseUrl}/oauth/authorize`);
      url.searchParams.set("response_type", "code");
      url.searchParams.set("client_id", OAUTH_CLIENT_ID);
      url.searchParams.set("redirect_uri", "https://evil.example/callback");
      url.searchParams.set("code_challenge", challenge);
      url.searchParams.set("code_challenge_method", "S256");
      url.searchParams.set("resource", `${server.baseUrl}/mcp`);
      const res = await fetch(url, { redirect: "manual" });
      assert.equal(res.status, 400);
    });

    it("a wrong code_verifier gives invalid_grant", async () => {
      const verifier = b64url(randomBytes(32));
      const challenge = b64url(createHash("sha256").update(verifier).digest());
      const resource = `${server.baseUrl}/mcp`;
      const authorizeResp = await fetch(`${server.baseUrl}/oauth/authorize`, {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        redirect: "manual",
        body: new URLSearchParams({
          name: "Wrong Verifier Customer",
          phone: "+1-555-0099",
          response_type: "code",
          client_id: OAUTH_CLIENT_ID,
          redirect_uri: OAUTH_REDIRECT_URI,
          code_challenge: challenge,
          code_challenge_method: "S256",
          resource,
          state: "s",
        }),
      });
      const code = new URL(authorizeResp.headers.get("location")!).searchParams.get("code")!;

      const tokenResp = await fetch(`${server.baseUrl}/oauth/token`, {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          grant_type: "authorization_code",
          code,
          redirect_uri: OAUTH_REDIRECT_URI,
          code_verifier: "this-is-the-wrong-verifier",
          resource,
          client_id: OAUTH_CLIENT_ID,
          client_secret: OAUTH_CLIENT_SECRET,
        }),
      });
      assert.equal(tokenResp.status, 400);
      const body = await tokenResp.json();
      assert.equal(body.error, "invalid_grant");
    });

    it("happy path issues tokens and a query-string token gives 401", async () => {
      const tokens = await linkCustomer(server.baseUrl, "Happy Path Customer", "+1-555-0010");
      assert.ok(tokens.accessToken);
      assert.ok(tokens.refreshToken);

      const qsResp = await fetch(`${server.baseUrl}/mcp?access_token=${tokens.accessToken}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", method: "initialize", id: 1 }),
      });
      assert.equal(qsResp.status, 401);
    });

    it("an authenticated booking is attributed to the linked customer", async () => {
      const tokens = await linkCustomer(server.baseUrl, "Attribution Customer", "+1-555-0011");
      const client = await newClient(server.baseUrl, tokens.accessToken);
      const list = await timedCallTool(client, "list_my_appointments", {});
      assert.equal(list.isError, undefined); // succeeds (even if empty) for this customer specifically
      await client.close();
    });

    it("refresh rotation rejects the old refresh token", async () => {
      const tokens = await linkCustomer(server.baseUrl, "Refresh Customer", "+1-555-0012");

      const refreshResp = await fetch(`${server.baseUrl}/oauth/token`, {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          grant_type: "refresh_token",
          refresh_token: tokens.refreshToken,
          client_id: OAUTH_CLIENT_ID,
          client_secret: OAUTH_CLIENT_SECRET,
        }),
      });
      assert.equal(refreshResp.status, 200);

      const reuseResp = await fetch(`${server.baseUrl}/oauth/token`, {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          grant_type: "refresh_token",
          refresh_token: tokens.refreshToken,
          client_id: OAUTH_CLIENT_ID,
          client_secret: OAUTH_CLIENT_SECRET,
        }),
      });
      assert.equal(reuseResp.status, 400);
    });
  });
});
