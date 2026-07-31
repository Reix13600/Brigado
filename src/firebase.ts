import { initializeApp } from "firebase/app";
import { getAuth } from "firebase/auth";
import { getFirestore } from "firebase/firestore";
import { getFunctions } from "firebase/functions";

// Firebase Web config. This is safe to keep in client code —
// access control happens via Firestore Security Rules, not by hiding this object.
const firebaseConfig = {
  apiKey: "AIzaSyAeOPFvw7LNH-SRTJsLOIyvJbh1sDeuqlI",
  authDomain: "brigado-a33b1.firebaseapp.com",
  projectId: "brigado-a33b1",
  storageBucket: "brigado-a33b1.firebasestorage.app",
  messagingSenderId: "410627697214",
  appId: "1:410627697214:web:86da9910cf1f641ecfff6f",
  measurementId: "G-L9TR4JKQ19",
};

export const firebaseApp = initializeApp(firebaseConfig);
export const auth = getAuth(firebaseApp);
export const db = getFirestore(firebaseApp);
export const functions = getFunctions(firebaseApp);

// ── MULTI-RESTAURANT ROUTING ────────────────────────────────────────
// Each restaurant lives at brigado.app/{slug} — e.g. /la-vague. The slug
// IS the Firestore document ID under restaurants/{slug}, so there's no
// separate lookup table: uniqueness is just "can I create this doc."
//
// The root path "/" has no restaurant context at all — that's the
// public landing/registration page (see Landing.tsx), not this app.

let _restaurantId: string | null = null;

/** Reads the restaurant slug out of the current URL path. Returns null
 * on the root path (marketing/registration page, no restaurant yet). */
export function getSlugFromUrl(): string | null {
  const segments = window.location.pathname.split("/").filter(Boolean);
  return segments[0] || null;
}

export function setRestaurantId(slug: string): void {
  _restaurantId = slug;
}

/** Throws if called before setRestaurantId — every data-fetching call
 * site runs after App.tsx has resolved the slug, so this should never
 * actually fire; it's a loud failure instead of a silent wrong-tenant bug. */
export function getRestaurantId(): string {
  if (!_restaurantId) {
    throw new Error("getRestaurantId() called before a restaurant context was set — this is a bug, not a user error.");
  }
  return _restaurantId;
}
