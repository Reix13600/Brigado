// Slugs a restaurant may never register, because the router would send
// them somewhere else and the tenant would be permanently unreachable.
//
// ⚠️ MIRRORED in functions/src/reservedSlugs.ts — keep the two in sync.
// The client list is UX (fail fast in the form); the server list in
// functions is the real boundary, because the slug travels to the
// webhook inside Stripe's client_reference_id and never has to pass
// through this form at all.
//
// Covers three groups:
//   1. Every key of STATIC_PAGES in App.tsx. These were ALREADY routable
//      before this list existed, so a restaurant could have registered
//      "contact" or "register" and silently become unreachable.
//   2. The platform admin dashboard (/admin).
//   3. Infrastructure-ish names we may want later (api, www, app) plus
//      obvious footguns.
export const RESERVED_SLUGS: ReadonlySet<string> = new Set([
  // 1. existing static marketing/legal routes (App.tsx STATIC_PAGES)
  "mentions-legales",
  "cgv",
  "confidentialite",
  "contact",
  "features",
  "register",
  "welcome",
  // 2. platform admin
  "admin",
  // 3. infrastructure / future routes
  "api",
  "www",
  "app",
  "assets",
  "static",
  "public",
  "login",
  "logout",
  "signup",
  "billing",
  "support",
  "help",
  "status",
  "dashboard",
]);

export function isReservedSlug(slug: string): boolean {
  return RESERVED_SLUGS.has(slug.trim().toLowerCase());
}
