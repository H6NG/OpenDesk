import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { promises as fs } from "node:fs";
import path from "node:path";
import os from "node:os";
import { fileURLToPath } from "node:url";
import type { StoreData } from "../src/types.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..");
export const FRONTDESK_NOW = "2026-10-18T09:00:00-07:00"; // Sunday, per SPEC.md

export const DEMO_CUSTOMER_ID = "demo-customer";

function emptyStoreData(): StoreData {
  return {
    businesses: [],
    customers: [{ id: DEMO_CUSTOMER_ID, name: "Alex Rivera", phone: "+1-310-555-0100" }],
    appointments: [],
    waitlist: [],
    events: [],
    oauthCodes: [],
    oauthTokens: [],
  };
}

/**
 * Fixture business for none-mode e2e tests, giving full deterministic
 * control instead of relying on the randomized demo seed:
 *  - Sunday (10-18, "today"): closed all day -> tests the "closed" message.
 *  - Monday (10-19): a single 9:00-9:30 shift, pre-booked solid for both
 *    staff -> tests "fully booked" + alternatives + waitlist + cancel-frees-slot.
 *  - Tuesday (10-20) onward: normal 9:00-17:00 hours for general flow,
 *    double-booking, and reschedule tests.
 */
export function buildNoneModeFixture(): StoreData {
  const data = emptyStoreData();
  data.businesses.push({
    id: "shop-a",
    name: "Shop A",
    category: "test shop",
    keywords: ["test"],
    address: "1 Test St",
    city: "Los Angeles",
    phone: "+1-310-555-0200",
    timezone: "America/Los_Angeles",
    hours: {
      1: [["09:00", "09:30"]],
      2: [["09:00", "17:00"]],
      3: [["09:00", "17:00"]],
      4: [["09:00", "17:00"]],
      5: [["09:00", "17:00"]],
      6: [["09:00", "17:00"]],
      7: [],
    },
    services: [{ id: "cut", name: "Cut", durationMin: 30, priceCents: 2000 }],
    staff: [
      { id: "sam", name: "Sam", title: "Stylist", serviceIds: ["cut"] },
      { id: "priya", name: "Priya", title: "Stylist", serviceIds: ["cut"] },
    ],
    bufferMin: 0,
    slotStepMin: 15,
    leadTimeMin: 0,
    cancelNoticeHours: 2,
    policyNote: "2-hour cancellation notice.",
    createdVia: "seed",
  });
  data.appointments.push(
    {
      id: "appt-mon-sam",
      code: "MON1",
      businessId: "shop-a",
      serviceId: "cut",
      staffId: "sam",
      customerId: DEMO_CUSTOMER_ID,
      customerName: "Alex Rivera",
      start: "2026-10-19T09:00:00.000-07:00",
      end: "2026-10-19T09:30:00.000-07:00",
      status: "confirmed",
      holdExpiresAt: null,
      holdKind: null,
      source: "phone",
      notes: "",
      createdAt: "2026-10-17T00:00:00.000Z",
      updatedAt: "2026-10-17T00:00:00.000Z",
    },
    {
      id: "appt-mon-priya",
      code: "MON2",
      businessId: "shop-a",
      serviceId: "cut",
      staffId: "priya",
      customerId: DEMO_CUSTOMER_ID,
      customerName: "Alex Rivera",
      start: "2026-10-19T09:00:00.000-07:00",
      end: "2026-10-19T09:30:00.000-07:00",
      status: "confirmed",
      holdExpiresAt: null,
      holdKind: null,
      source: "phone",
      notes: "",
      createdAt: "2026-10-17T00:00:00.000Z",
      updatedAt: "2026-10-17T00:00:00.000Z",
    },
  );
  return data;
}

/**
 * Fixture for oauth-mode e2e tests: a single staff member with exactly one
 * bookable slot on Tuesday (10-20), so customer A can fill the only slot and
 * customer B is guaranteed to find the business fully booked.
 */
export function buildOAuthModeFixture(): StoreData {
  const data = emptyStoreData();
  data.businesses.push({
    id: "shop-b",
    name: "Shop B",
    category: "test shop",
    keywords: ["test"],
    address: "2 Test St",
    city: "Los Angeles",
    phone: "+1-310-555-0300",
    timezone: "America/Los_Angeles",
    hours: {
      1: [],
      2: [["09:00", "09:30"]],
      3: [["09:00", "17:00"]],
      4: [["09:00", "17:00"]],
      5: [["09:00", "17:00"]],
      6: [["09:00", "17:00"]],
      7: [],
    },
    services: [{ id: "groom", name: "Groom", durationMin: 30, priceCents: 5000 }],
    staff: [{ id: "jess", name: "Jess", title: "Groomer", serviceIds: ["groom"] }],
    bufferMin: 0,
    slotStepMin: 15,
    leadTimeMin: 0,
    cancelNoticeHours: 2,
    policyNote: "2-hour cancellation notice.",
    createdVia: "seed",
  });
  return data;
}

/**
 * Fixture for the Phase 15 Spanish-locale e2e test: one business with
 * `locale: "es"`, open all week, so a customer can be found/booked/
 * confirmed/cancelled entirely through Spanish spoken phrases.
 */
export function buildSpanishLocaleFixture(): StoreData {
  const data = emptyStoreData();
  data.businesses.push({
    id: "shop-es",
    name: "Peluquería Sol",
    category: "barber",
    keywords: ["corte", "pelo"],
    address: "3 Test St",
    city: "Los Angeles",
    phone: "+1-310-555-0400",
    timezone: "America/Los_Angeles",
    hours: {
      1: [["09:00", "17:00"]],
      2: [["09:00", "17:00"]],
      3: [["09:00", "17:00"]],
      4: [["09:00", "17:00"]],
      5: [["09:00", "17:00"]],
      6: [["09:00", "17:00"]],
      7: [],
    },
    services: [{ id: "corte", name: "Corte de Pelo", durationMin: 30, priceCents: 2500 }],
    staff: [{ id: "maria", name: "Maria", title: "Estilista", serviceIds: ["corte"] }],
    bufferMin: 0,
    slotStepMin: 15,
    leadTimeMin: 0,
    cancelNoticeHours: 2,
    policyNote: "Se requiere 2 horas de aviso para cancelar.",
    createdVia: "seed",
    locale: "es",
  });
  return data;
}

export const OAUTH_CLIENT_ID = "e2e-test-client";
export const OAUTH_CLIENT_SECRET = "e2e-test-secret";
export const OAUTH_REDIRECT_URI = "https://client.example/callback";

export interface TestServer {
  baseUrl: string;
  dataFile: string;
  stop: () => Promise<void>;
}

async function waitForHealth(baseUrl: string, timeoutMs = 15_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    try {
      const res = await fetch(`${baseUrl}/health`);
      if (res.ok) return;
    } catch {
      // not up yet
    }
    if (Date.now() > deadline) throw new Error(`Server at ${baseUrl} did not become healthy in time`);
    await new Promise((r) => setTimeout(r, 150));
  }
}

export async function spawnTestServer(options: {
  port: number;
  fixture: StoreData;
  authMode: "none" | "oauth";
  extraEnv?: Record<string, string>;
}): Promise<TestServer> {
  const dataFile = path.join(os.tmpdir(), `frontdesk-e2e-${options.port}-${Date.now()}.json`);
  await fs.writeFile(dataFile, JSON.stringify(options.fixture), "utf8");

  const baseUrl = `http://127.0.0.1:${options.port}`;
  const child: ChildProcessWithoutNullStreams = spawn(
    process.execPath,
    [path.join(REPO_ROOT, "node_modules", "tsx", "dist", "cli.mjs"), path.join(REPO_ROOT, "src", "server.ts")],
    {
      cwd: REPO_ROOT,
      env: {
        ...process.env,
        PORT: String(options.port),
        PUBLIC_URL: baseUrl,
        DATA_FILE: dataFile,
        AUTH_MODE: options.authMode,
        FRONTDESK_NOW,
        ...options.extraEnv,
      },
      stdio: ["ignore", "pipe", "pipe"],
    },
  );

  let stderrBuf = "";
  child.stderr.on("data", (d) => {
    stderrBuf += d.toString();
  });

  const exitPromise = new Promise<number | null>((resolve) => {
    child.on("exit", (code) => resolve(code));
  });

  try {
    await waitForHealth(baseUrl);
  } catch (e) {
    child.kill();
    throw new Error(`${(e as Error).message}\nstderr:\n${stderrBuf}`);
  }

  return {
    baseUrl,
    dataFile,
    stop: async () => {
      child.kill("SIGTERM");
      await Promise.race([exitPromise, new Promise((r) => setTimeout(r, 3000))]);
      await fs.rm(dataFile, { force: true });
    },
  };
}
