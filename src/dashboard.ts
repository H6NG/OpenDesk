import path from "node:path";
import { fileURLToPath } from "node:url";
import express from "express";
import { DateTime } from "luxon";
import type { Config } from "./config.js";
import { ownerAuthConfigured, businessDirectoryConfigured } from "./config.js";
import type { Store } from "./store.js";
import { now } from "./clock.js";
import { onboardBusiness, dailyBriefing } from "./bedrock.js";
import { BookingError, createManualAppointment, cancelAppointmentAsOwner } from "./booking.js";
import { computeAnalytics } from "./analytics.js";
import { addStaffTimeOff, removeStaffTimeOff, listStaffTimeOff } from "./staffTimeOff.js";
import { markOrderReady, markOrderPickedUp, findOrderByIdOrCode } from "./catalog.js";
import { signUpOwner, loginOwner, logoutOwner, getSessionOwner, OwnerAuthError } from "./owners.js";
import { putBusiness } from "./businessDirectory.js";
import type { Business, OwnerRole } from "./types.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = path.resolve(__dirname, "..", "public");

const SESSION_COOKIE = "fd_session";

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      ownerBusinessId?: string;
      ownerRole?: OwnerRole;
    }
  }
}

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

/** No cookie-parser dependency — this is the one header we need. */
function readCookie(req: express.Request, name: string): string | undefined {
  const header = req.get("cookie");
  if (!header) return undefined;
  for (const part of header.split(";")) {
    const i = part.indexOf("=");
    if (i === -1) continue;
    if (part.slice(0, i).trim() === name) return decodeURIComponent(part.slice(i + 1).trim());
  }
  return undefined;
}

function setSessionCookie(req: express.Request, res: express.Response, token: string, expiresAt: string): void {
  const secure = req.secure || req.get("x-forwarded-proto") === "https";
  const maxAgeSec = Math.max(0, Math.floor((Date.parse(expiresAt) - Date.now()) / 1000));
  res.append(
    "Set-Cookie",
    `${SESSION_COOKIE}=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAgeSec}${secure ? "; Secure" : ""}`,
  );
}

function clearSessionCookie(req: express.Request, res: express.Response): void {
  const secure = req.secure || req.get("x-forwarded-proto") === "https";
  res.append("Set-Cookie", `${SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${secure ? "; Secure" : ""}`);
}

/** Owner-session gate for /api/* routes: 401 JSON on failure. Only installed when ownerAuthConfigured(config). */
function requireOwnerSessionApi(config: Config) {
  return async (req: express.Request, res: express.Response, next: express.NextFunction) => {
    const identity = await getSessionOwner(config, readCookie(req, SESSION_COOKIE));
    if (!identity) {
      res.status(401).json({ error: "Not logged in." });
      return;
    }
    req.ownerBusinessId = identity.businessId;
    req.ownerRole = identity.role;
    next();
  };
}

/** Owner-session gate for the dashboard HTML page itself: redirects to /login on failure, since this is a browser navigation, not a fetch(). */
function requireOwnerSessionPage(config: Config) {
  return async (req: express.Request, res: express.Response, next: express.NextFunction) => {
    const identity = await getSessionOwner(config, readCookie(req, SESSION_COOKIE));
    if (!identity) {
      res.redirect(302, "/login");
      return;
    }
    req.ownerBusinessId = identity.businessId;
    req.ownerRole = identity.role;
    next();
  };
}

/** businessId resolution: session-scoped when owner-auth is on (the whole point — no cross-business visibility), the legacy ?business= query param otherwise. */
function resolveBusinessId(req: express.Request, ownerAuthOn: boolean): string | undefined {
  return ownerAuthOn ? req.ownerBusinessId : (req.query.business as string | undefined);
}

/** Guard for routes where the target business comes from the request body/params rather than a query filter (creating/mutating something for a specific business) — true if the caller may proceed, false if a response was already sent. */
function assertOwnsBusiness(req: express.Request, res: express.Response, ownerAuthOn: boolean, businessId: string | undefined): boolean {
  if (!ownerAuthOn) return true;
  if (businessId !== req.ownerBusinessId) {
    res.status(403).json({ error: "That business isn't linked to your account." });
    return false;
  }
  return true;
}

/** Role gate for routes an employee shouldn't reach (pricing, staff roster). No-op when owner-auth is off — roles only exist inside real sessions. */
function assertRole(req: express.Request, res: express.Response, ownerAuthOn: boolean, allowed: OwnerRole[]): boolean {
  if (!ownerAuthOn) return true;
  if (req.ownerRole && !allowed.includes(req.ownerRole)) {
    res.status(403).json({ error: "Your role doesn't have access to this action." });
    return false;
  }
  return true;
}

function uniqueSlug(name: string, existingIds: Set<string>, fallback = "item"): string {
  const base = name.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || fallback;
  let slug = base;
  let i = 2;
  while (existingIds.has(slug)) {
    slug = `${base}-${i}`;
    i += 1;
  }
  return slug;
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

  const ownerAuthOn = ownerAuthConfigured(config);
  const pageAuth = ownerAuthOn ? [requireOwnerSessionPage(config)] : [];
  const api = ownerAuthOn ? [requireOwnerSessionApi(config)] : config.dashboardToken ? [dashboardAuth(config)] : [];

  app.get("/login", (_req, res) => res.sendFile(path.join(PUBLIC_DIR, "login.html")));
  app.get("/", ...pageAuth, (_req, res) => res.sendFile(path.join(PUBLIC_DIR, "dashboard.html")));
  app.get("/dashboard", ...pageAuth, (_req, res) => res.sendFile(path.join(PUBLIC_DIR, "dashboard.html")));

  // Always reachable, regardless of auth mode — lets the frontend detect which mode it's in without guessing.
  app.get("/api/me", async (req, res) => {
    if (!ownerAuthOn) {
      res.json({ ownerAuthEnabled: false, authenticated: false });
      return;
    }
    const identity = await getSessionOwner(config, readCookie(req, SESSION_COOKIE));
    res.json({ ownerAuthEnabled: true, authenticated: Boolean(identity), businessId: identity?.businessId, role: identity?.role });
  });

  // Unauthenticated by design: name + id only, same info the public find_businesses MCP tool already exposes. Used to populate the signup page's business picker.
  app.get("/api/public/businesses", (_req, res) => {
    res.json({ businesses: store.data.businesses.map((b) => ({ id: b.id, name: b.name })) });
  });

  app.post("/api/signup", async (req, res) => {
    if (!ownerAuthOn) {
      res.status(503).json({ error: "Owner accounts aren't configured on this server." });
      return;
    }
    const { email, password, businessId, role } = req.body ?? {};
    if (typeof email !== "string" || typeof password !== "string" || typeof businessId !== "string") {
      res.status(400).json({ error: "email, password, and businessId are required." });
      return;
    }
    if (role !== undefined && role !== "owner" && role !== "manager" && role !== "employee") {
      res.status(400).json({ error: "role must be owner, manager, or employee." });
      return;
    }
    if (!store.getBusiness(businessId)) {
      res.status(404).json({ error: "Unknown business." });
      return;
    }
    try {
      await signUpOwner(config, { email, password, businessId, role });
      const { token, expiresAt } = await loginOwner(config, email, password);
      setSessionCookie(req, res, token, expiresAt);
      res.status(201).json({ ok: true, businessId });
    } catch (e) {
      if (e instanceof OwnerAuthError) {
        res.status(400).json({ error: e.message });
        return;
      }
      res.status(500).json({ error: "Could not create the account." });
    }
  });

  app.post("/api/login", async (req, res) => {
    if (!ownerAuthOn) {
      res.status(503).json({ error: "Owner accounts aren't configured on this server." });
      return;
    }
    const { email, password } = req.body ?? {};
    if (typeof email !== "string" || typeof password !== "string") {
      res.status(400).json({ error: "email and password are required." });
      return;
    }
    try {
      const { token, expiresAt, owner } = await loginOwner(config, email, password);
      setSessionCookie(req, res, token, expiresAt);
      res.json({ ok: true, businessId: owner.businessId });
    } catch (e) {
      if (e instanceof OwnerAuthError) {
        res.status(401).json({ error: e.message });
        return;
      }
      res.status(500).json({ error: "Could not log in." });
    }
  });

  app.post("/api/logout", async (req, res) => {
    if (ownerAuthOn) await logoutOwner(config, readCookie(req, SESSION_COOKIE));
    clearSessionCookie(req, res);
    res.json({ ok: true });
  });

  app.get("/api/businesses", ...api, (req, res) => {
    const businesses = ownerAuthOn ? store.data.businesses.filter((b) => b.id === req.ownerBusinessId) : store.data.businesses;
    res.json({ businesses });
  });

  app.get("/api/state", ...api, (req, res) => {
    const businessId = resolveBusinessId(req, ownerAuthOn);
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
    if (!assertOwnsBusiness(req, res, ownerAuthOn, businessId)) return;
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
    const id = req.params.id as string;
    const existing = store.data.staffTimeOff.find((t) => t.id === id);
    if (existing && !assertOwnsBusiness(req, res, ownerAuthOn, existing.businessId)) return;
    try {
      removeStaffTimeOff(store, id);
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
    const orderId = req.params.orderId as string;
    const existingOrder = findOrderByIdOrCode(store, orderId);
    if (existingOrder && !assertOwnsBusiness(req, res, ownerAuthOn, existingOrder.businessId)) return;
    try {
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

  app.post("/api/staff", ...api, (req, res) => {
    const { businessId, name, title, serviceIds } = req.body ?? {};
    if (typeof businessId !== "string" || typeof name !== "string" || !name.trim() || typeof title !== "string" || !Array.isArray(serviceIds) || serviceIds.length === 0) {
      res.status(400).json({ error: "businessId, name, title, and at least one serviceId are required." });
      return;
    }
    if (!assertOwnsBusiness(req, res, ownerAuthOn, businessId)) return;
    if (!assertRole(req, res, ownerAuthOn, ["owner", "manager"])) return;
    const business = store.getBusiness(businessId);
    if (!business) {
      res.status(404).json({ error: "Unknown business." });
      return;
    }
    const validServiceIds: string[] = serviceIds.filter((id: unknown) => typeof id === "string" && business.services.some((s) => s.id === id));
    if (validServiceIds.length === 0) {
      res.status(400).json({ error: "None of the given serviceIds exist on this business." });
      return;
    }
    const existingIds = new Set(business.staff.map((s) => s.id));
    const staff = { id: uniqueSlug(name, existingIds, "staff"), name: name.trim(), title: title.trim(), serviceIds: validServiceIds };
    business.staff.push(staff);
    store.touch();
    res.status(201).json({ staff });
  });

  app.post("/api/products", ...api, (req, res) => {
    const { businessId, name, description, priceCents, stockQty } = req.body ?? {};
    if (typeof businessId !== "string" || typeof name !== "string" || !name.trim() || !Number.isInteger(priceCents) || priceCents < 0 || !Number.isInteger(stockQty) || stockQty < 0) {
      res.status(400).json({ error: "businessId, name, a non-negative integer priceCents, and a non-negative integer stockQty are required." });
      return;
    }
    if (!assertOwnsBusiness(req, res, ownerAuthOn, businessId)) return;
    if (!assertRole(req, res, ownerAuthOn, ["owner", "manager"])) return;
    const business = store.getBusiness(businessId);
    if (!business) {
      res.status(404).json({ error: "Unknown business." });
      return;
    }
    business.products ??= [];
    const existingIds = new Set(business.products.map((p) => p.id));
    const product = {
      id: uniqueSlug(name, existingIds),
      name: name.trim(),
      description: typeof description === "string" ? description.trim() : "",
      priceCents,
      stockQty,
    };
    business.products.push(product);
    store.touch();
    res.status(201).json({ product });
  });

  app.patch("/api/products/:productId", ...api, (req, res) => {
    const { productId } = req.params;
    const { businessId, stockQty } = req.body ?? {};
    if (typeof businessId !== "string" || !Number.isInteger(stockQty) || stockQty < 0) {
      res.status(400).json({ error: "businessId and a non-negative integer stockQty are required." });
      return;
    }
    if (!assertOwnsBusiness(req, res, ownerAuthOn, businessId)) return;
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
    if (!assertOwnsBusiness(req, res, ownerAuthOn, businessId)) return;
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

  app.post("/api/appointments/:idOrCode/cancel", ...api, (req, res) => {
    const { businessId } = req.body ?? {};
    const idOrCode = req.params.idOrCode;
    if (typeof businessId !== "string" || typeof idOrCode !== "string") {
      res.status(400).json({ error: "businessId is required." });
      return;
    }
    if (!assertOwnsBusiness(req, res, ownerAuthOn, businessId)) return;
    try {
      const result = cancelAppointmentAsOwner(store, now().toMillis(), businessId, idOrCode);
      res.json({ appointment: result.appointment, lateFee: result.lateFee, waitlistOffered: Boolean(result.waitlistOffered) });
    } catch (e) {
      if (e instanceof BookingError) {
        res.status(400).json({ error: e.message });
        return;
      }
      res.status(500).json({ error: "Could not cancel the appointment." });
    }
  });

  app.get("/api/analytics", ...api, (req, res) => {
    const businessId = resolveBusinessId(req, ownerAuthOn) ?? store.data.businesses[0]?.id;
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

  app.post("/api/businesses", ...api, async (req, res) => {
    if (ownerAuthOn) {
      // An owner account is scoped to exactly one (already-existing) business — publishing a brand new
      // business doesn't fit that model and isn't something a single-business session should be able to do.
      res.status(403).json({ error: "Publishing a new business isn't available from a logged-in owner session." });
      return;
    }
    const business = req.body?.business;
    if (!isValidBusinessShape(business)) {
      res.status(400).json({ error: "Invalid business payload." });
      return;
    }
    if (store.getBusiness(business.id)) {
      res.status(409).json({ error: "A business with that id already exists." });
      return;
    }
    if (businessDirectoryConfigured(config)) {
      try {
        await putBusiness(config, business);
      } catch (e) {
        res.status(502).json({ error: "Failed to save the business to the directory: " + (e instanceof Error ? e.message : "unknown error") });
        return;
      }
    }
    store.data.businesses.push(business);
    store.touch();
    store.addEvent(business.id, "onboarded", `${business.name} was published to Alexa+`);
    res.status(201).json({ business });
  });

  app.get("/api/briefing", ...api, (req, res) => {
    const businessId = resolveBusinessId(req, ownerAuthOn) ?? store.data.businesses[0]?.id;
    if (!businessId) {
      res.status(404).json({ error: "No businesses yet." });
      return;
    }
    const briefing = dailyBriefing(store, businessId);
    res.json({ briefing });
  });

  app.post("/api/demo/reset", ...api, async (_req, res) => {
    if (ownerAuthOn) {
      // Resets every business's data, not just the caller's own — far too broad for a single-business owner session.
      res.status(403).json({ error: "Demo reset isn't available from a logged-in owner session." });
      return;
    }
    await store.resetToSeed();
    res.json({ ok: true });
  });
}
