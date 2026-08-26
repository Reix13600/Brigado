// THE single time-of-day formatter for the whole app. Real bug found via
// a user report: times rendered inconsistently — 24h in some places,
// 12h AM/PM in others — because call sites passed toLocaleTimeString a
// locale string ("en-US" vs "fr-FR") without an explicit `hour12`
// option, silently relying on each locale's own DEFAULT: "en-US"
// defaults to 12h AM/PM, "fr-FR" defaults to 24h. Since most call sites
// picked the locale from the app's own lang toggle, the exact same
// component rendered different time formats depending only on which
// language was active — never intentional, just an unset option.
//
// French restaurant convention is 24h, unconditionally, regardless of
// which language toggle is active — this formatter hardcodes
// `hour12: false` so it can never regress the same way again.
export function formatTime24(value: string | Date): string {
  const date = typeof value === "string" ? new Date(value) : value;
  return date.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit", hour12: false });
}
