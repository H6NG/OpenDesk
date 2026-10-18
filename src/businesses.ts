import type { Business } from "./types.js";

const WEEKDAY_SHORT = ["", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

function formatHHMM(hhmm: string): string {
  const [h, m] = hhmm.split(":").map(Number);
  const hour12 = h % 12 === 0 ? 12 : h % 12;
  const period = h < 12 ? "AM" : "PM";
  return m === 0 ? `${hour12} ${period}` : `${hour12}:${String(m).padStart(2, "0")} ${period}`;
}

function shiftsKey(shifts: [string, string][]): string {
  return shifts.map(([a, b]) => `${a}-${b}`).join("+");
}

function shiftsLabel(shifts: [string, string][]): string {
  if (shifts.length === 0) return "closed";
  return shifts.map(([a, b]) => `${formatHHMM(a)}-${formatHHMM(b)}`).join(" and ");
}

/** Compressed, speakable hours text, e.g. "Tue-Wed 10 AM-7 PM, Thu-Fri 10 AM-8 PM, Sat 9 AM-5 PM, closed Sun-Mon". */
export function formatHours(business: Business): string {
  const groups: { fromDay: number; toDay: number; key: string; label: string }[] = [];
  for (let weekday = 1; weekday <= 7; weekday++) {
    const shifts = business.hours[weekday] ?? [];
    const key = shiftsKey(shifts);
    const last = groups[groups.length - 1];
    if (last && last.key === key) {
      last.toDay = weekday;
    } else {
      groups.push({ fromDay: weekday, toDay: weekday, key, label: shiftsLabel(shifts) });
    }
  }
  return groups
    .map((g) => {
      const dayRange = g.fromDay === g.toDay ? WEEKDAY_SHORT[g.fromDay] : `${WEEKDAY_SHORT[g.fromDay]}-${WEEKDAY_SHORT[g.toDay]}`;
      return g.key === "" ? `closed ${dayRange}` : `${dayRange} ${g.label}`;
    })
    .join(", ");
}

export interface BusinessMatch {
  business: Business;
  score: number;
}

/** Simple keyword scoring over name/category/keywords for find_businesses. */
export function scoreBusinesses(businesses: Business[], query?: string, category?: string): BusinessMatch[] {
  const q = (query ?? "").trim().toLowerCase();
  const cat = (category ?? "").trim().toLowerCase();
  const terms = q.split(/\s+/).filter(Boolean);

  const matches: BusinessMatch[] = [];
  for (const business of businesses) {
    if (cat && !business.category.toLowerCase().includes(cat)) continue;
    let score = 0;
    const haystacks = [business.name.toLowerCase(), business.category.toLowerCase(), ...business.keywords.map((k) => k.toLowerCase())];
    if (terms.length === 0) {
      score = 1; // no query: everything matches equally, let caller decide order
    } else {
      for (const term of terms) {
        for (const h of haystacks) {
          if (h === term) score += 3;
          else if (h.includes(term)) score += 2;
        }
        if (business.name.toLowerCase().includes(term)) score += 1;
      }
    }
    if (score > 0) matches.push({ business, score });
  }
  matches.sort((a, b) => b.score - a.score || a.business.name.localeCompare(b.business.name));
  return matches;
}
