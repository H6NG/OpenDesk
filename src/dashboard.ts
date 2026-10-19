import path from "node:path";
import { fileURLToPath } from "node:url";
import express from "express";
import { DateTime } from "luxon";
import type { Config } from "./config.js";
import type { Store } from "./store.js";
import { now } from "./clock.js";
import { onboardBusiness, dailyBriefing } from "./bedrock.js";
import { BookingError, createManualAppointment } from "./booking.js";
import { computeAnalytics } from "./analytics.js";
import { addStaffTimeOff, removeStaffTimeOff, listStaffTimeOff } from "./staffTimeOff.js";
import { markOrderReady, markOrderPickedUp } from "./catalog.js";
import type { Business } from "./types.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = path.resolve(__dirname, "..", "public");

function dashboardAuth(config: Config) {
  return (req: express.Request, res: express.Response, next: express.NextFunction) => {
    if (!config.dashboardToken) return next();
    const provided = (req.query.token as string | undefined) ?? req.get("x-dashboard-token");
    if (provided !== config.dashboardToken) {
      res.status(401).json({ error: "Invalid or missing dashboard token." });
      return;
    }
    next();
  };
}

function isValidBusinessShape(b: unknown): b is Business {
  if (!b || typeof b !== "object") return false;
  const business = b as Record<string, unknown>;
  return (
    typeof business.id === "string" &&
    typeof business.name === "string" &&
    Array.isArray(business.services) &&
    Array.isArray(business.staff) &&
    typeof business.hours === "object"
  );
}

export function registerDashboardRoutes(app: express.Express, config: Config, store: Store): void {
  app.use(express.static(PUBLIC_DIR));

  app.get("/", (_req, res) => res.sendFile(path.join(PUBLIC_DIR, "dashboard.html")));
  app.get("/dashboard", (_req, res) => res.sendFile(path.join(PUBLIC_DIR, "dashboard.html")));

  const api = config.dashboardToken ? [dashboardAuth(config)] : [];

  app.get("/api/businesses", ...api, (_req, res) => {
    res.json({ businesses: store.data.businesses });
  });

  app.get("/api/state", ...api, (req, res) => {
    const businessId = req.query.business as string | undefined;
    const days = Math.max(1, Math.min(30, Number(req.query.days ?? 7) || 7));
    const business = businessId ? store.getBusiness(businessId) : store.data.businesses[0];
    if (!business) {
      res.status(404).json({ error: "Unknown business." });
      return;
    }

    const nowBiz = DateTime.fromMillis(now().toMillis(), { zone: business.timezone });
    const fromDay = nowBiz.startOf("day");
    const toDay = fromDay.plus({ days: days - 1 }).endOf("day");

    const appointments = store.data.appointments.filter((a) => {
      if (a.businessId !== business.id) return false;
      if (a.status === "cancelled" || a.status === "expired") return false;
      const start = DateTime.fromISO(a.start, { setZone: true });
      return start >= fromDay && start <= toDay;
    });

    const waitlist = store.data.waitlist.filter((w) => w.businessId === business.id && (w.status === "waiting" || w.status === "offered"));
    const orders = store.data.orders.filter((o) => o.businessId === business.id && (o.status === "placed" || o.status === "ready"));
    const staffTimeOff = listStaffTimeOff(store, business.id, now().toMillis());

    res.json({
      business,
      now: nowBiz.toISO(),
      appointments,
      waitlist,
      orders,
      staffTimeOff,
      mcpEndpoint: `${config.publicUrl.replace(/\/$/, "")}/mcp`,
    });
  });

  app.post("/api/staff-time-off", ...api, (req, res) => {
    const { businessId, staffId, fromIso, toIso, reason } = req.body ?? {};
    if (typeof businessId !== "string" || typeof staffId !== "string" || typeof fromIso !== "string" || typeof toIso !== "string") {
      res.status(400).json({ error: "businessId, staffId, fromIso, and toIso are required." });
      return;
    }
    try {
      const entry = addStaffTimeOff(store, now().toMillis(), { businessId, staffId, fromIso, toIso, reason: typeof reason === "string" ? reason : undefined });
      res.status(201).json({ timeOff: entry });
    } catch (e) {
      if (e instanceof BookingError) {
        res.status(400).json({ error: e.message });
        return;
      }
      res.status(500).json({ error: "Could not add the time-off block." });
    }
  });

  app.delete("/api/staff-time-off/:id", ...api, (req, res) => {
    try {
      removeStaffTimeOff(store, req.params.id as string);
      res.status(204).end();
    } catch (e) {
      if (e instanceof BookingError) {
        res.status(404).json({ error: e.message });
        return;
      }
      res.status(500).json({ error: "Could not remove the time-off block." });
    }
  });

  app.patch("/api/orders/:orderId", ...api, (req, res) => {
    const { status } = req.body ?? {};
    if (status !== "ready" && status !== "picked_up") {
      res.status(400).json({ error: "status must be 'ready' or 'picked_up'." });
      return;
    }
    try {
      const orderId = req.params.orderId as string;
      const result = status === "ready" ? markOrderReady(store, now().toMillis(), orderId) : markOrderPickedUp(store, now().toMillis(), orderId);
      res.json({ order: result.order });
    } catch (e) {
      if (e instanceof BookingError) {
        res.status(400).json({ error: e.message });
        return;
      }
      res.status(500).json({ error: "Could not update the order." });
    }
  });

  app.patch("/api/products/:productId", ...api, (req, res) => {
    const { productId } = req.params;
    const { businessId, stockQty } = req.body ?? {};
    if (typeof businessId !== "string" || !Number.isInteger(stockQty) || stockQty < 0) {
      res.status(400).json({ error: "businessId and a non-negative integer stockQty are required." });
      return;
    }
    const business = store.getBusiness(businessId);
    if (!business) {
      res.status(404).json({ error: "Unknown business." });
      return;
    }
    const product = (business.products ?? []).find((p) => p.id === productId);
    if (!product) {
      res.status(404).json({ error: "Unknown product." });
      return;
    }
    product.stockQty = stockQty;
    store.touch();
    res.json({ product });
  });

  app.post("/api/appointments", ...api, (req, res) => {
    const body = req.body ?? {};
    const { businessId, serviceId, staffId, customerName, customerPhone, start, source, notes, recurrence, party } = body;
    if (
      typeof businessId !== "string" ||
      typeof serviceId !== "string" ||
      typeof staffId !== "string" ||
      typeof customerName !== "string" ||
      !customerName.trim() ||
      typeof start !== "string" ||
      (source !== "phone" && source !== "walk-in")
    ) {
      res.status(400).json({ error: "businessId, serviceId, staffId, customerName, start, and source ('phone'|'walk-in') are required." });
      return;
    }
    const validRecurrence =
      recurrence && typeof recurrence === "object" && ["weekly", "biweekly", "monthly"].includes(recurrence.freq) && Number.isInteger(recurrence.count)
        ? { freq: recurrence.freq, count: recurrence.count }
        : undefined;
    const validParty =
      party && typeof party === "object" && Number.isInteger(party.count)
        ? { count: party.count, names: Array.isArray(party.names) ? party.names : undefined }
        : undefined;
    try {
      const { appointment, seriesAppointments, groupAppointments } = createManualAppointment(store, now().toMillis(), {
        businessId,
        serviceId,
        staffId,
        customerName,
        customerPhone: typeof customerPhone === "string" && customerPhone.trim() ? customerPhone : undefined,
        startIso: start,
        source,
        notes: typeof notes === "string" ? notes : undefined,
        recurrence: validRecurrence,
        party: validParty,
      });
      res.status(201).json({ appointment, seriesAppointments, groupAppointments });
    } catch (e) {
      if (e instanceof BookingError) {
        res.status(400).json({ error: e.message });
        return;
      }
      res.status(500).json({ error: "Could not create the appointment." });
    }
  });

  app.get("/api/analytics", ...api, (req, res) => {
    const businessId = (req.query.business as string | undefined) ?? store.data.businesses[0]?.id;
    const days = Math.max(1, Math.min(90, Number(req.query.days ?? 30) || 30));
    const business = businessId ? store.getBusiness(businessId) : undefined;
    if (!business) {
      res.status(404).json({ error: "Unknown business." });
      return;
    }
    res.json(computeAnalytics(store, business.id, now().toMillis(), days));
  });

  app.get("/api/events", ...api, (req, res) => {
    res.set({
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    });
    res.flushHeaders();

    const recent = store.data.events.slice(-20);
    for (const event of recent) {
      res.write(`data: ${JSON.stringify(event)}\n\n`);
    }

    const listener = (event: unknown) => {
      res.write(`data: ${JSON.stringify(event)}\n\n`);
    };
    store.onActivityEvent(listener);

    const keepAlive = setInterval(() => res.write(": keep-alive\n\n"), 25_000);

    req.on("close", () => {
      clearInterval(keepAlive);
      store.offActivityEvent(listener);
    });
  });

  app.post("/api/onboard", ...api, async (req, res) => {
    const description = typeof req.body?.description === "string" ? req.body.description : "";
    if (!description.trim()) {
      res.status(400).json({ error: "description is required." });
      return;
    }
    try {
      const business = await onboardBusiness(description);
      res.json({ business });
    } catch (e) {
      res.status(502).json({ error: e instanceof Error ? e.message : "Onboarding failed." });
    }
  });

  app.post("/api/businesses", ...api, (req, res) => {
    const business = req.body?.business;
    if (!isValidBusinessShape(business)) {
      res.status(400).json({ error: "Invalid business payload." });
      return;
    }
    if (store.getBusiness(business.id)) {
      res.status(409).json({ error: "A business with that id already exists." });
      return;
    }
    store.data.businesses.push(business);
    store.touch();
    store.addEvent(business.id, "onboarded", `${business.name} was published to Alexa+`);
    res.status(201).json({ business });
  });

  app.get("/api/briefing", ...api, (req, res) => {
    const businessId = (req.query.business as string | undefined) ?? store.data.businesses[0]?.id;
    if (!businessId) {
      res.status(404).json({ error: "No businesses yet." });
      return;
    }
    const briefing = dailyBriefing(store, businessId);
    res.json({ briefing });
  });

  app.post("/api/demo/reset", ...api, async (_req, res) => {
    await store.resetToSeed();
    res.json({ ok: true });
  });
}
