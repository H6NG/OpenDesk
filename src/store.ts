import { promises as fs } from "node:fs";
import path from "node:path";
import { now } from "./clock.js";
import { seedBusinesses, seedAppointments } from "./seed.js";
import type { ActivityEvent, ActivityEventType, Customer, StoreData } from "./types.js";

export const DEMO_CUSTOMER: Customer = {
  id: "demo-customer",
  name: "Alex Rivera",
  phone: "+1-310-555-0100",
};

const MAX_EVENTS = 300;
const SAVE_DEBOUNCE_MS = 250;

function freshData(): StoreData {
  const businesses = seedBusinesses();
  const { appointments, customers } = seedAppointments(businesses, now());
  return {
    businesses,
    customers: [DEMO_CUSTOMER, ...customers],
    appointments,
    waitlist: [],
    events: [],
    oauthCodes: [],
    oauthTokens: [],
  };
}

/**
 * Holds all server state in memory and debounces atomic writes to disk.
 * Business logic modules mutate `store.data` directly and call
 * `store.touch()`; this keeps the hot path (availability, booking) free of
 * indirection.
 */
export class Store {
  data: StoreData;
  private filePath: string | null;
  private saveTimer: NodeJS.Timeout | null = null;
  private pendingSave: Promise<void> | null = null;

  private constructor(data: StoreData, filePath: string | null) {
    this.data = data;
    this.filePath = filePath;
  }

  static async load(dataFile: string): Promise<Store> {
    if (dataFile === ":memory:") {
      return new Store(freshData(), null);
    }
    const abs = path.resolve(dataFile);
    try {
      const raw = await fs.readFile(abs, "utf8");
      const data = JSON.parse(raw) as StoreData;
      return new Store(data, abs);
    } catch {
      const store = new Store(freshData(), abs);
      await store.flush();
      return store;
    }
  }

  /** Marks state dirty and schedules a debounced atomic write. */
  touch(): void {
    if (!this.filePath) return;
    if (this.saveTimer) return;
    this.saveTimer = setTimeout(() => {
      this.saveTimer = null;
      this.pendingSave = this.flush();
    }, SAVE_DEBOUNCE_MS);
  }

  async flush(): Promise<void> {
    if (!this.filePath) return;
    const dir = path.dirname(this.filePath);
    await fs.mkdir(dir, { recursive: true });
    const tmp = `${this.filePath}.${process.pid}.${Date.now()}.tmp`;
    await fs.writeFile(tmp, JSON.stringify(this.data), "utf8");
    await fs.rename(tmp, this.filePath);
  }

  /** Waits for any pending debounced write to finish (used by tests/shutdown). */
  async waitForIdle(): Promise<void> {
    if (this.saveTimer) {
      clearTimeout(this.saveTimer);
      this.saveTimer = null;
      await this.flush();
    }
    if (this.pendingSave) await this.pendingSave;
  }

  async resetToSeed(): Promise<void> {
    this.data = freshData();
    await this.flush();
  }

  addEvent(businessId: string, type: ActivityEventType, message: string): ActivityEvent {
    const event: ActivityEvent = {
      id: `evt_${this.data.events.length}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      businessId,
      type,
      message,
      at: now().toISO()!,
    };
    this.data.events.push(event);
    if (this.data.events.length > MAX_EVENTS) {
      this.data.events.splice(0, this.data.events.length - MAX_EVENTS);
    }
    this.touch();
    return event;
  }

  getBusiness(id: string) {
    return this.data.businesses.find((b) => b.id === id);
  }

  getCustomer(id: string) {
    return this.data.customers.find((c) => c.id === id);
  }

  findCustomerByPhone(phone: string) {
    return this.data.customers.find((c) => c.phone === phone);
  }

  upsertCustomerByPhone(name: string, phone: string): Customer {
    const existing = this.findCustomerByPhone(phone);
    if (existing) {
      existing.name = name;
      this.touch();
      return existing;
    }
    const customer: Customer = { id: `cust_${Math.random().toString(36).slice(2, 10)}`, name, phone };
    this.data.customers.push(customer);
    this.touch();
    return customer;
  }
}
