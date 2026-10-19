import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { sendSms, smsConfigured, setSmsClient, SmsNotificationSink, type SmsClient, type SmsConfig } from "../src/sms.js";

const CONFIGURED: SmsConfig = { accountSid: "ACxxx", authToken: "token", fromNumber: "+15550001111" };
const UNCONFIGURED: SmsConfig = { accountSid: "", authToken: "", fromNumber: "" };

afterEach(() => {
  setSmsClient(null);
});

describe("smsConfigured", () => {
  it("is true only when all three fields are set", () => {
    assert.equal(smsConfigured(CONFIGURED), true);
    assert.equal(smsConfigured(UNCONFIGURED), false);
    assert.equal(smsConfigured({ ...CONFIGURED, fromNumber: "" }), false);
  });
});

describe("sendSms", () => {
  it("throws a clear error when not configured, without touching the client", async () => {
    let called = false;
    setSmsClient({ send: async () => { called = true; } });
    await assert.rejects(() => sendSms("+15551234567", "hi", UNCONFIGURED), /not configured/);
    assert.equal(called, false);
  });

  it("calls the injected client with to/from/body when configured", async () => {
    const calls: { to: string; from: string; body: string }[] = [];
    const stub: SmsClient = { send: async (params) => { calls.push(params); } };
    setSmsClient(stub);
    await sendSms("+15551234567", "your order is ready", CONFIGURED);
    assert.equal(calls.length, 1);
    assert.equal(calls[0].to, "+15551234567");
    assert.equal(calls[0].from, CONFIGURED.fromNumber);
    assert.equal(calls[0].body, "your order is ready");
  });

  it("propagates a client failure", async () => {
    setSmsClient({ send: async () => { throw new Error("carrier rejected"); } });
    await assert.rejects(() => sendSms("+15551234567", "hi", CONFIGURED), /carrier rejected/);
  });
});

describe("SmsNotificationSink", () => {
  let logs: string[];
  const originalLog = console.log;
  const originalError = console.error;

  beforeEach(() => {
    logs = [];
    console.log = (msg: string) => logs.push(msg);
    console.error = (msg: string) => logs.push(msg);
  });
  afterEach(() => {
    console.log = originalLog;
    console.error = originalError;
  });

  it("sends via the configured client when the customer has a phone on file", async () => {
    const calls: { to: string }[] = [];
    setSmsClient({ send: async (params) => { calls.push({ to: params.to }); } });
    const sink = new SmsNotificationSink(CONFIGURED);
    await sink.notify("your pomade order is ready", { kind: "order_ready", orderId: "order-1", customerPhone: "+15559876543", customerName: "Jordan" });
    assert.equal(calls.length, 1);
    assert.equal(calls[0].to, "+15559876543");
  });

  it("logs instead of sending when the customer has no phone on file", async () => {
    const sink = new SmsNotificationSink(CONFIGURED);
    await sink.notify("your pomade order is ready", { kind: "order_ready", orderId: "order-1", customerPhone: null, customerName: "Jordan" });
    assert.ok(logs.some((l) => l.includes("no phone on file")));
  });

  it("logs rather than throwing when the send fails", async () => {
    setSmsClient({ send: async () => { throw new Error("boom"); } });
    const sink = new SmsNotificationSink(CONFIGURED);
    await sink.notify("hi", { kind: "order_ready", orderId: "order-1", customerPhone: "+15559876543", customerName: "Jordan" });
    assert.ok(logs.some((l) => l.includes("failed to send")));
  });
});
