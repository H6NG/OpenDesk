import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { DateTime } from "luxon";
import { Store } from "../src/store.js";
import { BookingError } from "../src/booking.js";
import { checkItemAvailability, placeOrder, cancelOrder, listMyOrders, requireProduct, markOrderReady, markOrderPickedUp } from "../src/catalog.js";
import { DEMO_CUSTOMER } from "../src/store.js";
import { setNotificationSink, ConsoleNotificationSink, type NotificationContext } from "../src/reminders.js";

const BUSINESS_ID = "maple-street-barbers";
const NOW_MS = DateTime.fromISO("2026-10-20T10:00:00", { zone: "America/Los_Angeles" }).toMillis();

async function freshStore(): Promise<Store> {
  const store = await Store.load(":memory:");
  store.data.appointments = []; // isolate from the randomized demo seed
  store.data.orders = [];
  store.data.events = [];
  return store;
}

describe("requireProduct", () => {
  it("finds a product by id, exact name, or substring name, case-insensitively", async () => {
    const store = await freshStore();
    const business = store.getBusiness(BUSINESS_ID)!;
    assert.equal(requireProduct(business, "pomade").id, "pomade");
    assert.equal(requireProduct(business, "Matte Pomade").id, "pomade");
    assert.equal(requireProduct(business, "matte").id, "pomade");
  });

  it("throws a BookingError for an unknown item", async () => {
    const store = await freshStore();
    const business = store.getBusiness(BUSINESS_ID)!;
    assert.throws(() => requireProduct(business, "nonexistent widget"), BookingError);
  });
});

describe("checkItemAvailability", () => {
  it("reports current stock and price without mutating anything", async () => {
    const store = await freshStore();
    const { product } = checkItemAvailability(store, BUSINESS_ID, "pomade");
    assert.equal(product.stockQty, 6);
    assert.equal(product.priceCents, 1800);
  });
});

describe("placeOrder", () => {
  it("decrements stock, computes the total price, and logs an order_placed event", async () => {
    const store = await freshStore();
    const { order, product } = placeOrder(store, NOW_MS, DEMO_CUSTOMER.id, { businessId: BUSINESS_ID, item: "pomade", quantity: 2 });
    assert.equal(product.stockQty, 4);
    assert.equal(order.quantity, 2);
    assert.equal(order.priceCents, 3600);
    assert.equal(order.status, "placed");
    assert.equal(order.customerName, DEMO_CUSTOMER.name);
    assert.ok(store.data.events.some((e) => e.type === "order_placed"));
  });

  it("defaults quantity to 1 and resolves a spoken pickup phrase into a label", async () => {
    const store = await freshStore();
    const { order } = placeOrder(store, NOW_MS, DEMO_CUSTOMER.id, { businessId: BUSINESS_ID, item: "beard oil", pickupWhen: "tomorrow morning" });
    assert.equal(order.quantity, 1);
    assert.match(order.pickupLabel, /morning/);
  });

  it("rejects ordering more than is in stock", async () => {
    const store = await freshStore();
    assert.throws(() => placeOrder(store, NOW_MS, DEMO_CUSTOMER.id, { businessId: BUSINESS_ID, item: "pomade", quantity: 99 }), BookingError);
  });

  it("rejects ordering an item with zero stock", async () => {
    const store = await freshStore();
    // paws-and-suds-grooming's dental-chews is seeded at 0 stock.
    assert.throws(
      () => placeOrder(store, NOW_MS, DEMO_CUSTOMER.id, { businessId: "paws-and-suds-grooming", item: "dental chews" }),
      BookingError,
    );
  });
});

describe("cancelOrder", () => {
  it("restocks the item and marks the order cancelled", async () => {
    const store = await freshStore();
    const { order } = placeOrder(store, NOW_MS, DEMO_CUSTOMER.id, { businessId: BUSINESS_ID, item: "pomade", quantity: 2 });
    const result = cancelOrder(store, NOW_MS, DEMO_CUSTOMER.id, order.code);
    assert.equal(result.alreadyCancelled, false);
    assert.equal(result.order.status, "cancelled");
    const { product } = checkItemAvailability(store, BUSINESS_ID, "pomade");
    assert.equal(product.stockQty, 6); // back to the original seeded stock
  });

  it("is idempotent on an already-cancelled order", async () => {
    const store = await freshStore();
    const { order } = placeOrder(store, NOW_MS, DEMO_CUSTOMER.id, { businessId: BUSINESS_ID, item: "pomade" });
    cancelOrder(store, NOW_MS, DEMO_CUSTOMER.id, order.code);
    const second = cancelOrder(store, NOW_MS, DEMO_CUSTOMER.id, order.code);
    assert.equal(second.alreadyCancelled, true);
  });

  it("rejects cancelling an order belonging to a different customer", async () => {
    const store = await freshStore();
    const { order } = placeOrder(store, NOW_MS, DEMO_CUSTOMER.id, { businessId: BUSINESS_ID, item: "pomade" });
    assert.throws(() => cancelOrder(store, NOW_MS, "some-other-customer", order.code), BookingError);
  });
});

describe("listMyOrders", () => {
  it("lists only the customer's active (placed/ready) orders, oldest first", async () => {
    const store = await freshStore();
    const first = placeOrder(store, NOW_MS, DEMO_CUSTOMER.id, { businessId: BUSINESS_ID, item: "pomade" }).order;
    const second = placeOrder(store, NOW_MS + 1000, DEMO_CUSTOMER.id, { businessId: BUSINESS_ID, item: "beard oil" }).order;
    cancelOrder(store, NOW_MS, DEMO_CUSTOMER.id, first.code);

    const active = listMyOrders(store, DEMO_CUSTOMER.id);
    assert.equal(active.length, 1);
    assert.equal(active[0].id, second.id);
  });
});

describe("markOrderReady / markOrderPickedUp", () => {
  let notifications: { message: string; context: NotificationContext }[];

  beforeEach(() => {
    notifications = [];
    setNotificationSink({
      notify: (message, context) => {
        notifications.push({ message, context });
      },
    });
  });
  afterEach(() => {
    setNotificationSink(new ConsoleNotificationSink());
  });

  it("transitions placed -> ready and notifies the customer", async () => {
    const store = await freshStore();
    const { order } = placeOrder(store, NOW_MS, DEMO_CUSTOMER.id, { businessId: BUSINESS_ID, item: "pomade", quantity: 2 });
    const result = markOrderReady(store, NOW_MS, order.id);
    assert.equal(result.order.status, "ready");
    assert.equal(notifications.length, 1);
    assert.equal(notifications[0].context.kind, "order_ready");
    assert.equal(notifications[0].context.orderId, order.id);
    assert.equal(notifications[0].context.customerPhone, DEMO_CUSTOMER.phone);
    assert.match(notifications[0].message, /ready for pickup/);
    assert.ok(store.data.events.some((e) => e.type === "order_ready"));
  });

  it("rejects marking ready an order that isn't placed", async () => {
    const store = await freshStore();
    const { order } = placeOrder(store, NOW_MS, DEMO_CUSTOMER.id, { businessId: BUSINESS_ID, item: "pomade" });
    markOrderReady(store, NOW_MS, order.id);
    assert.throws(() => markOrderReady(store, NOW_MS, order.id), BookingError);
  });

  it("transitions ready -> picked_up without sending another notification", async () => {
    const store = await freshStore();
    const { order } = placeOrder(store, NOW_MS, DEMO_CUSTOMER.id, { businessId: BUSINESS_ID, item: "pomade" });
    markOrderReady(store, NOW_MS, order.id);
    const before = notifications.length;
    const result = markOrderPickedUp(store, NOW_MS, order.id);
    assert.equal(result.order.status, "picked_up");
    assert.equal(notifications.length, before);
  });
});
