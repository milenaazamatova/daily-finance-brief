export const CATEGORIES: Record<string, string> = {
  rates_macro: "Rates & macro",
  markets: "Markets",
  earnings: "Earnings",
  deals_ipos: "Deals & IPOs",
  banking: "Banking",
  oil_energy: "Oil & energy",
  companies: "Companies",
  other: "Other",
};

// Order used for the regional sections on the Today page.
export const REGIONS: Record<string, string> = {
  uae: "UAE",
  us: "US",
  china: "China",
  russia: "Russia",
  global: "Global",
};

export const IMPACT: Record<string, { label: string; icon: string }> = {
  positive: { label: "Positive", icon: "▲" },
  negative: { label: "Negative", icon: "▼" },
  mixed: { label: "Mixed", icon: "◆" },
};

/** "2026-09-27" -> "Sunday, 27 September 2026" (dates are calendar days, so format in UTC). */
export function formatDate(isoDate: string, withWeekday = true) {
  return new Date(`${isoDate}T00:00:00Z`).toLocaleDateString("en-GB", {
    timeZone: "UTC",
    weekday: withWeekday ? "long" : undefined,
    day: "numeric",
    month: "long",
    year: "numeric",
  });
}
