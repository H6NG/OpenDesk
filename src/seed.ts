import { DateTime } from "luxon";
import { mulberry32, hashStringToSeed } from "./prng.js";
import { newId } from "./codes.js";
import type { Appointment, Business, Customer } from "./types.js";

const LA = "America/Los_Angeles";

function hours(spec: Record<number, [string, string]>): Record<number, [string, string][]> {
  const out: Record<number, [string, string][]> = {};
  for (let d = 1; d <= 7; d++) out[d] = [];
  for (const [day, shift] of Object.entries(spec)) {
    out[Number(day)] = [shift];
  }
  return out;
}

export function seedBusinesses(): Business[] {
  const mapleStreetBarbers: Business = {
    id: "maple-street-barbers",
    name: "Maple Street Barbers",
    category: "barber",
    keywords: ["barber", "barbershop", "haircut", "men's cut", "beard", "shave"],
    address: "214 Maple Street",
    city: "Los Angeles",
    phone: "+1-213-555-0101",
    timezone: LA,
    hours: hours({
      2: ["10:00", "19:00"],
      3: ["10:00", "19:00"],
      4: ["10:00", "20:00"],
      5: ["10:00", "20:00"],
      6: ["09:00", "17:00"],
    }),
    services: [
      { id: "mens-cut", name: "Men's Cut", durationMin: 30, priceCents: 3500 },
      { id: "beard-trim", name: "Beard Trim", durationMin: 15, priceCents: 2000 },
      { id: "cut-and-beard", name: "Cut and Beard", durationMin: 45, priceCents: 5000 },
      { id: "kids-cut", name: "Kids' Cut", durationMin: 20, priceCents: 2500 },
    ],
    staff: [
      { id: "sam", name: "Sam", title: "Barber", serviceIds: ["mens-cut", "beard-trim", "cut-and-beard", "kids-cut"] },
      { id: "priya", name: "Priya", title: "Barber", serviceIds: ["mens-cut", "beard-trim", "cut-and-beard", "kids-cut"] },
    ],
    products: [
      { id: "pomade", name: "Matte Pomade", description: "Strong-hold, low-shine styling pomade", priceCents: 1800, stockQty: 6 },
      { id: "beard-oil", name: "Beard Oil", description: "Sandalwood beard conditioning oil", priceCents: 1500, stockQty: 4 },
    ],
    bufferMin: 5,
    slotStepMin: 15,
    leadTimeMin: 30,
    cancelNoticeHours: 2,
    policyNote: "Please arrive 5 minutes early. Cancellations within 2 hours of the appointment may incur a fee.",
    createdVia: "seed",
  };

  const harbourPhysioMassage: Business = {
    id: "harbour-physio-massage",
    name: "Harbour Physio and Massage",
    category: "physio",
    keywords: ["physio", "physiotherapy", "massage", "clinic", "injury", "sports massage"],
    address: "88 Harbour Way",
    city: "Los Angeles",
    phone: "+1-213-555-0102",
    timezone: LA,
    hours: {
      1: [["09:00", "17:00"]],
      2: [["09:00", "17:00"]],
      3: [["09:00", "12:00"], ["13:00", "17:00"]],
      4: [["09:00", "17:00"]],
      5: [["09:00", "17:00"]],
      6: [],
      7: [],
    },
    services: [
      { id: "physio-assessment", name: "Physio Assessment", durationMin: 45, priceCents: 11000 },
      { id: "physio-followup", name: "Physio Follow-up", durationMin: 30, priceCents: 8500 },
      { id: "massage-60", name: "60-Minute Massage", durationMin: 60, priceCents: 12000 },
      { id: "massage-30", name: "30-Minute Massage", durationMin: 30, priceCents: 7000 },
    ],
    staff: [
      { id: "lena", name: "Dr. Lena Okafor", title: "Physiotherapist", serviceIds: ["physio-assessment", "physio-followup"] },
      { id: "marco", name: "Marco", title: "Massage Therapist", serviceIds: ["massage-60", "massage-30"] },
    ],
    bufferMin: 10,
    slotStepMin: 15,
    leadTimeMin: 60,
    cancelNoticeHours: 24,
    policyNote: "24-hour cancellation notice is required to avoid a fee.",
    createdVia: "seed",
  };

  const pawsAndSudsGrooming: Business = {
    id: "paws-and-suds-grooming",
    name: "Paws and Suds Grooming",
    category: "pet grooming",
    keywords: ["dog groomer", "pet grooming", "dog bath", "nail trim", "grooming"],
    address: "5 Harbour Way",
    city: "Los Angeles",
    phone: "+1-213-555-0103",
    timezone: LA,
    hours: hours({
      1: ["09:00", "17:00"],
      2: ["09:00", "17:00"],
      3: ["09:00", "17:00"],
      4: ["09:00", "17:00"],
      5: ["09:00", "17:00"],
      6: ["09:00", "17:00"],
    }),
    services: [
      { id: "small-dog-groom", name: "Small Dog Groom", durationMin: 90, priceCents: 8500 },
      { id: "large-dog-groom", name: "Large Dog Groom", durationMin: 120, priceCents: 12000 },
      { id: "bath", name: "Bath", durationMin: 45, priceCents: 4500 },
      { id: "nail-trim", name: "Nail Trim", durationMin: 15, priceCents: 1800 },
    ],
    staff: [
      { id: "jess", name: "Jess", title: "Groomer", serviceIds: ["small-dog-groom", "large-dog-groom", "bath", "nail-trim"] },
    ],
    products: [
      { id: "oatmeal-shampoo", name: "Oatmeal Shampoo", description: "Sensitive-skin dog shampoo, 16oz", priceCents: 1600, stockQty: 5 },
      { id: "dental-chews", name: "Dental Chews (bag)", description: "Grain-free dental chew treats", priceCents: 1200, stockQty: 0 },
    ],
    bufferMin: 10,
    slotStepMin: 15,
    leadTimeMin: 60,
    cancelNoticeHours: 24,
    policyNote: "24-hour cancellation notice is required to avoid a fee.",
    createdVia: "seed",
  };

  return [mapleStreetBarbers, harbourPhysioMassage, pawsAndSudsGrooming];
}

const FAKE_CUSTOMER_NAMES = [
  "Jordan Lee", "Casey Nguyen", "Morgan Patel", "Riley Kim", "Avery Chen",
  "Taylor Brooks", "Jamie Ortiz", "Drew Sanders", "Rowan Diaz", "Quinn Foster",
  "Hayden Price", "Reese Morgan", "Sage Alvarez", "Emerson Hale", "Finley Cross",
];

/**
 * Pre-fills the next 14 days with deterministic fake bookings so the demo
 * looks alive. Booking probability is inversely proportional to service
 * duration, so long-service shops (grooming, physio) aren't fully booked.
 */
export function seedAppointments(
  businesses: Business[],
  fromDate: DateTime,
): { appointments: Appointment[]; customers: Customer[] } {
  const appointments: Appointment[] = [];
  const customers: Customer[] = [];
  const usedCodes = new Set<string>();

  function codeFor(rng: () => number): string {
    for (;;) {
      const code = randomCodeDeterministic(rng);
      if (!usedCodes.has(code)) {
        usedCodes.add(code);
        return code;
      }
    }
  }

  let customerSeq = 0;
  function fakeCustomer(rng: () => number): Customer {
    const name = FAKE_CUSTOMER_NAMES[Math.floor(rng() * FAKE_CUSTOMER_NAMES.length)];
    customerSeq += 1;
    const id = `fake-cust-${customerSeq}`;
    const phone = `+1-310-555-${String(1000 + customerSeq).slice(-4)}`;
    const customer: Customer = { id, name, phone };
    customers.push(customer);
    return customer;
  }

  for (const business of businesses) {
    const rng = mulberry32(hashStringToSeed(`frontdesk-seed:${business.id}`));

    for (let dayOffset = 0; dayOffset < 14; dayOffset++) {
      const day = fromDate.plus({ days: dayOffset }).setZone(business.timezone);
      const weekday = day.weekday;
      const shifts = business.hours[weekday] ?? [];
      if (shifts.length === 0) continue;

      for (const staff of business.staff) {
        const services = business.services.filter((s) => staff.serviceIds.includes(s.id));
        if (services.length === 0) continue;

        for (const [startStr, endStr] of shifts) {
          const [sh, sm] = startStr.split(":").map(Number);
          const [eh, em] = endStr.split(":").map(Number);
          let cursorMin = sh * 60 + sm;
          const shiftEndMin = eh * 60 + em;

          while (cursorMin + business.slotStepMin <= shiftEndMin) {
            const service = services[Math.floor(rng() * services.length)];
            // Booking probability inversely proportional to duration: a
            // quick 15-min service fills up much more than a 2-hour one.
            // Calibrated so a day ends up roughly 35-50% booked, not packed solid.
            const probability = Math.min(0.5, 8 / service.durationMin);
            const roll = rng();

            if (roll < probability && cursorMin + service.durationMin <= shiftEndMin) {
              const start = day.set({
                hour: Math.floor(cursorMin / 60),
                minute: cursorMin % 60,
                second: 0,
                millisecond: 0,
              });
              const end = start.plus({ minutes: service.durationMin });
              const customer = fakeCustomer(rng);

              appointments.push({
                id: newId("appt"),
                code: codeFor(rng),
                businessId: business.id,
                serviceId: service.id,
                staffId: staff.id,
                customerId: customer.id,
                customerName: customer.name,
                start: start.toISO()!,
                end: end.toISO()!,
                status: "confirmed",
                holdExpiresAt: null,
                holdKind: null,
                source: rng() < 0.6 ? "alexa" : rng() < 0.5 ? "phone" : "walk-in",
                notes: "",
                createdAt: start.minus({ days: 1 }).toISO()!,
                updatedAt: start.minus({ days: 1 }).toISO()!,
              });

              cursorMin += service.durationMin + business.bufferMin;
            } else {
              cursorMin += business.slotStepMin;
            }
          }
        }
      }
    }
  }

  return { appointments, customers };
}

const CODE_ALPHABET = "23456789ABCDEFGHJKMNPQRSTUVWXYZ";
function randomCodeDeterministic(rng: () => number): string {
  let out = "";
  for (let i = 0; i < 4; i++) {
    out += CODE_ALPHABET[Math.floor(rng() * CODE_ALPHABET.length)];
  }
  return out;
}
