import { DateTime } from "luxon";
import { isoUtc } from "./clock.js";
import { newId, randomCode } from "./codes.js";
import { parseSpokenWindow } from "./spokenTime.js";
import { notify } from "./reminders.js";
import { BookingError, requireBusiness } from "./booking.js";
import type { Store } from "./store.js";
import type { Business, Locale, Order, Product } from "./types.js";

/** Finds a product by id, exact name, or substring name match (same leniency as staff-name lookups in booking.ts). */
export function requireProduct(business: Business, itemHint: string): Product {
  const products = business.products ?? [];
  const byId = products.find((p) => p.id === itemHint);
  if (byId) return byId;
  const lower = itemHint.toLowerCase();
  const byName = products.find((p) => p.name.toLowerCase() === lower) ?? products.find((p) => p.name.toLowerCase().includes(lower));
  if (!byName) {
    throw new BookingError(`I couldn't find an item called "${itemHint}" at ${business.name}. Use get_business_details to see what they carry.`);
  }
  return byName;
}

export function findOrderByIdOrCode(store: Store, idOrCode: string): Order | undefined {
  return store.data.orders.find((o) => o.id === idOrCode || o.code.toUpperCase() === idOrCode.toUpperCase());
}

export interface CheckItemResult {
  business: Business;
  product: Product;
}

export function checkItemAvailability(store: Store, businessId: string, item: string): CheckItemResult {
  const business = requireBusiness(store, businessId);
  const product = requireProduct(business, item);
  return { business, product };
}

export interface OrderResult {
  order: Order;
  business: Business;
  product: Product;
}

/**
 * Places an order for a stock-tracked Product and decrements stock
 * immediately — unlike appointments, there's no hold/confirm step, since an
 * in-stock item has no contention to race against (no two customers can
 * take the "same minute" the way they can with a time slot). `pickupWhen`
 * is purely informational: it is not checked against business hours, since
 * "ready for pickup" doesn't require a human to be free at that instant the
 * way a service appointment does.
 */
export function placeOrder(
  store: Store,
  nowMs: number,
  customerId: string,
  params: { businessId: string; item: string; quantity?: number; pickupWhen?: string; notes?: string },
): OrderResult {
  const business = requireBusiness(store, params.businessId);
  const product = requireProduct(business, params.item);
  const quantity = params.quantity ?? 1;
  if (!Number.isInteger(quantity) || quantity < 1) {
    throw new BookingError("Order quantity must be at least 1.");
  }
  if (product.stockQty < quantity) {
    throw new BookingError(
      product.stockQty === 0
        ? `${business.name} is out of ${product.name} right now.`
        : `${business.name} only has ${product.stockQty} ${product.name} left, not ${quantity}.`,
    );
  }

  const locale: Locale = business.locale ?? "en";
  const nowBiz = DateTime.fromMillis(nowMs, { zone: business.timezone });
  const window = parseSpokenWindow(params.pickupWhen ?? "", nowBiz, 14, locale);

  product.stockQty -= quantity;

  const customer = store.getCustomer(customerId);
  const nowIso = isoUtc(nowMs);
  const order: Order = {
    id: newId("order"),
    code: randomCode(),
    businessId: business.id,
    productId: product.id,
    productName: product.name,
    quantity,
    priceCents: product.priceCents * quantity,
    customerId,
    customerName: customer?.name ?? "Guest",
    pickupAt: window.exact ? window.exact.toISO() : null,
    pickupLabel: window.label,
    status: "placed",
    notes: params.notes ?? "",
    createdAt: nowIso,
    updatedAt: nowIso,
  };
  store.data.orders.push(order);
  store.touch();
  store.addEvent(business.id, "order_placed", `${order.customerName} ordered ${quantity} ${product.name}, code ${order.code}`);

  return { order, business, product };
}

export interface CancelOrderResult {
  order: Order;
  business: Business;
  alreadyCancelled: boolean;
}

/** Restocks the item when cancelling an active order. Idempotent on an already-cancelled order. */
export function cancelOrder(store: Store, nowMs: number, customerId: string, idOrCode: string): CancelOrderResult {
  const order = findOrderByIdOrCode(store, idOrCode);
  if (!order) throw new BookingError("I couldn't find that order. Use list_my_orders to check the code.");
  if (order.customerId !== customerId) throw new BookingError("That order belongs to a different customer.");

  const business = requireBusiness(store, order.businessId);

  if (order.status === "cancelled") {
    return { order, business, alreadyCancelled: true };
  }
  if (order.status === "picked_up") {
    throw new BookingError("That order was already picked up, so it can't be cancelled.");
  }

  const product = (business.products ?? []).find((p) => p.id === order.productId);
  if (product) product.stockQty += order.quantity;

  order.status = "cancelled";
  order.updatedAt = isoUtc(nowMs);
  store.touch();
  store.addEvent(business.id, "order_cancelled", `${order.customerName} cancelled the order for ${order.productName}, code ${order.code}`);

  return { order, business, alreadyCancelled: false };
}

export interface MarkOrderResult {
  order: Order;
  business: Business;
}

/**
 * Owner-side action (not an MCP voice tool): the business marks a placed
 * order ready for pickup once it's prepared, notifying the customer through
 * whichever NotificationSink is installed (console by default, real SMS
 * when configured — see server.ts/sms.ts). This is the piece that was
 * previously missing: `Order.status` already had a "ready" value in the
 * type, but nothing drove the placed -> ready transition or told the
 * customer it happened.
 */
export function markOrderReady(store: Store, nowMs: number, orderId: string): MarkOrderResult {
  const order = findOrderByIdOrCode(store, orderId);
  if (!order) throw new BookingError("I couldn't find that order.");
  if (order.status !== "placed") {
    throw new BookingError(`That order is ${order.status}, not placed, so it can't be marked ready.`);
  }
  const business = requireBusiness(store, order.businessId);

  order.status = "ready";
  order.updatedAt = isoUtc(nowMs);
  store.touch();
  const message = `Your order for ${order.quantity} ${order.productName} at ${business.name} is ready for pickup.`;
  store.addEvent(business.id, "order_ready", `${order.customerName}'s order for ${order.productName} is ready, code ${order.code}`);
  const orderCustomer = store.getCustomer(order.customerId);
  notify(message, {
    kind: "order_ready",
    orderId: order.id,
    customerPhone: orderCustomer?.phone || null,
    customerName: order.customerName,
    smsConsent: orderCustomer?.smsConsent === true,
  });

  return { order, business };
}

export function markOrderPickedUp(store: Store, nowMs: number, orderId: string): MarkOrderResult {
  const order = findOrderByIdOrCode(store, orderId);
  if (!order) throw new BookingError("I couldn't find that order.");
  if (order.status !== "ready" && order.status !== "placed") {
    throw new BookingError(`That order is ${order.status}, so it can't be marked picked up.`);
  }
  const business = requireBusiness(store, order.businessId);

  order.status = "picked_up";
  order.updatedAt = isoUtc(nowMs);
  store.touch();

  return { order, business };
}

export function listMyOrders(store: Store, customerId: string): Order[] {
  return store.data.orders
    .filter((o) => o.customerId === customerId && (o.status === "placed" || o.status === "ready"))
    .sort((a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt));
}
