// ⚠️ MIRROR of src/utils/reservedSlugs.ts — keep the two in sync.
//
// This copy is the one that actually enforces. The registration form's
// check is only fail-fast UX: the slug reaches provisioning inside
// Stripe's client_reference_id, so it never has to pass through that
// form. provisionRestaurant rejects reserved slugs using this list.
//
// functions/ is a separate TS project with its own tsconfig and cannot
// import from src/, hence the duplication rather than a shared module.
export const RESERVED_SLUGS: ReadonlySet<string> = new Set([
  // existing static marketing/legal routes (App.tsx STATIC_PAGES)
  "mentions-legales",
  "cgv",
  "confidentialite",
  "contact",
  "features",
  "register",
  "welcome",
  // platform admin
  "admin",
  // infrastructure / future routes
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
