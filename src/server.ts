import express from "express";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { LATEST_PROTOCOL_VERSION } from "@modelcontextprotocol/sdk/types.js";
import { loadConfig } from "./config.js";
import { Store, DEMO_CUSTOMER } from "./store.js";
import { now } from "./clock.js";
import { warmUp } from "./availability.js";
import { registerTools, SERVER_INSTRUCTIONS } from "./mcp/tools.js";
import { LatencyTracker } from "./latency.js";
import { bearerAuthMiddleware, registerOAuthRoutes } from "./oauth.js";
import { registerDashboardRoutes } from "./dashboard.js";
import { sweepReminders, setNotificationSink } from "./reminders.js";
import { SmsNotificationSink, smsConfigured } from "./sms.js";

const REMINDER_SWEEP_INTERVAL_MS = 30_000;

export async function createApp() {
  const config = loadConfig();
  const store = await Store.load(config.dataFile);

  warmUp(store.data.businesses, store.data.appointments, now().toMillis());

  const smsConfig = { accountSid: config.twilioAccountSid, authToken: config.twilioAuthToken, fromNumber: config.twilioFromNumber };
  if (smsConfigured(smsConfig)) {
    setNotificationSink(new SmsNotificationSink(smsConfig));
  }
  // Else: the default ConsoleNotificationSink from reminders.ts stays installed.

  const reminderInterval = setInterval(() => sweepReminders(store, now().toMillis()), REMINDER_SWEEP_INTERVAL_MS);
  reminderInterval.unref?.();

  const latency = new LatencyTracker();
  const app = express();
  app.disable("x-powered-by");
  app.use(express.urlencoded({ extended: true }));
  app.use(express.json({ limit: "1mb" }));

  if (config.authMode === "oauth") {
    registerOAuthRoutes(app, config, store);
  }
  registerDashboardRoutes(app, config, store);

  const mcpAuth = config.authMode === "oauth" ? [bearerAuthMiddleware(store)] : [];

  app.post("/mcp", ...mcpAuth, async (req, res) => {
    const startedAt = Date.now();

    const effectiveCustomerId = (req as express.Request & { customerId?: string }).customerId ?? DEMO_CUSTOMER.id;

    const mcpServer = new McpServer(
      { name: "front-desk", version: "0.1.0" },
      { instructions: SERVER_INSTRUCTIONS, capabilities: { tools: {} } },
    );
    registerTools(mcpServer, { store, customerId: effectiveCustomerId, nowMs: now().toMillis() });

    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
      enableJsonResponse: true,
    });

    res.on("close", () => {
      void mcpServer.close();
      void transport.close();
    });

    try {
      await mcpServer.connect(transport);
      await transport.handleRequest(req, res, req.body);
    } catch (error) {
      if (!res.headersSent) {
        res.status(500).json({
          jsonrpc: "2.0",
          error: { code: -32603, message: "Internal server error" },
          id: null,
        });
      }
    } finally {
      latency.record(Date.now() - startedAt);
    }
  });

  app.get("/mcp", (req, res) => {
    res.set("Allow", "POST").status(405).json({ error: "Method not allowed. Use POST." });
  });
  app.delete("/mcp", (req, res) => {
    res.set("Allow", "POST").status(405).json({ error: "Method not allowed. Use POST." });
  });

  app.get("/health", (req, res) => {
    res.json({
      status: "ok",
      protocol: LATEST_PROTOCOL_VERSION,
      transport: "streamable-http",
      authMode: config.authMode,
      latency: latency.stats(),
    });
  });

  return { app, config, store, latency, reminderInterval };
}

async function main() {
  const { app, config, store, reminderInterval } = await createApp();
  const server = app.listen(config.port, () => {
    console.log(`Front Desk listening on port ${config.port} (auth mode: ${config.authMode})`);
  });

  async function shutdown() {
    clearInterval(reminderInterval);
    await store.waitForIdle();
    server.close(() => process.exit(0));
  }
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

const isMain = process.argv[1] && import.meta.url === `file://${process.argv[1]}`;
if (isMain) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
