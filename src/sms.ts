import type { NotificationContext, NotificationSink } from "./reminders.js";

export interface SmsClient {
  send(params: { to: string; from: string; body: string }): Promise<void>;
}

let client: SmsClient | null = null;

/** Lets tests (and other callers) inject a stub instead of a real HTTP client. */
export function setSmsClient(c: SmsClient | null): void {
  client = c;
}

/** Minimal Twilio REST API client over the built-in `fetch` — no SDK dependency needed for one endpoint. */
class TwilioSmsClient implements SmsClient {
  constructor(
    private accountSid: string,
    private authToken: string,
  ) {}

  async send(params: { to: string; from: string; body: string }): Promise<void> {
    const url = `https://api.twilio.com/2010-04-01/Accounts/${this.accountSid}/Messages.json`;
    const auth = Buffer.from(`${this.accountSid}:${this.authToken}`).toString("base64");
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "content-type": "application/x-www-form-urlencoded",
        authorization: `Basic ${auth}`,
      },
      body: new URLSearchParams({ To: params.to, From: params.from, Body: params.body }).toString(),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(`Twilio SMS send failed: ${res.status} ${text}`);
    }
  }
}

function getClient(accountSid: string, authToken: string): SmsClient {
  if (!client) client = new TwilioSmsClient(accountSid, authToken);
  return client;
}

export interface SmsConfig {
  accountSid: string;
  authToken: string;
  fromNumber: string;
}

export function smsConfigured(config: SmsConfig): boolean {
  return Boolean(config.accountSid && config.authToken && config.fromNumber);
}

/** Sends a real SMS via Twilio. Throws a clear, documented error if not configured — same pattern as bedrock.ts's onboardBusiness without AWS credentials: implemented for real, failing cleanly without live credentials rather than being faked. */
export async function sendSms(to: string, body: string, config: SmsConfig): Promise<void> {
  if (!smsConfigured(config)) {
    throw new Error("SMS is not configured: set TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, and TWILIO_FROM_NUMBER.");
  }
  const c = getClient(config.accountSid, config.authToken);
  await c.send({ to, from: config.fromNumber, body });
}

/**
 * NotificationSink that sends a real SMS when the customer has a phone
 * number on file, falling back to a console log — not a throw — when SMS
 * isn't configured or the send fails. A notification is a side effect of a
 * booking/reminder/order flow that already succeeded; a notification
 * failure shouldn't take that flow down with it.
 *
 * Gated on `context.smsConsent`: unlike ConsoleNotificationSink (which
 * never leaves the server, so consent is moot), this sink actually texts
 * the customer, so it must not fire without their explicit opt-in — see
 * the set_sms_consent MCP tool.
 */
export class SmsNotificationSink implements NotificationSink {
  constructor(private config: SmsConfig) {}

  async notify(message: string, context: NotificationContext): Promise<void> {
    if (!context.smsConsent) {
      console.log(`[sms] no SMS consent on file for ${context.customerName}; not sending: ${message}`);
      return;
    }
    if (!context.customerPhone) {
      console.log(`[sms] no phone on file for ${context.customerName}; logging instead: ${message}`);
      return;
    }
    try {
      await sendSms(context.customerPhone, message, this.config);
    } catch (e) {
      console.error(`[sms] failed to send to ${context.customerPhone}: ${e instanceof Error ? e.message : e}`);
    }
  }
}
