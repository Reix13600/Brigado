import {
  signInWithEmailAndPassword,
  signInWithPopup,
  signInAnonymously,
  signOut,
  GoogleAuthProvider,
  onAuthStateChanged,
  User,
} from "firebase/auth";
import { doc, getDoc } from "firebase/firestore";
import { auth, db, getRestaurantId } from "../firebase";

const googleProvider = new GoogleAuthProvider();

/**
 * Ensures every visitor has *some* Firebase Auth session, even staff who
 * never enter an email. This is what lets Firestore security rules tell
 * "a real visitor" from "no one" without staff needing accounts.
 * Safe to call multiple times — it's a no-op if already signed in.
 */
export async function ensureAnonymousSession(): Promise<void> {
  if (!auth.currentUser) {
    await signInAnonymously(auth);
  }
}

export async function signInManagerWithEmail(email: string, password: string): Promise<User> {
  const cred = await signInWithEmailAndPassword(auth, email, password);
  return cred.user;
}

export async function signInManagerWithGoogle(): Promise<User> {
  const cred = await signInWithPopup(auth, googleProvider);
  return cred.user;
}

export async function signOutManager(): Promise<void> {
  await signOut(auth);
  // Restore an anonymous session so staff-facing writes keep working
  // immediately after a manager logs out on a shared device.
  await ensureAnonymousSession();
}

/**
 * Checks the managers/{uid} lookup collection to confirm this signed-in
 * user is actually allowed to manage RESTAURANT_ID. This mirrors what the
 * Firestore rules check server-side — this client-side check is just for
 * UX (showing the right screen), not the actual security boundary.
 */
export async function isAuthorizedManager(uid: string): Promise<boolean> {
  const snap = await getDoc(doc(db, "managers", uid));
  if (!snap.exists()) return false;
  return snap.data().restaurantId === getRestaurantId();
}

/**
 * Looks up which restaurant (if any) this uid manages — unlike
 * isAuthorizedManager, this has no dependency on a currently-set
 * restaurant context, so it works from the public marketing pages
 * where no /{slug} has been resolved yet.
 */
export async function getManagerRestaurantId(uid: string): Promise<string | null> {
  const snap = await getDoc(doc(db, "managers", uid));
  if (!snap.exists()) return null;
  return snap.data().restaurantId ?? null;
}

export function watchAuthState(callback: (user: User | null) => void) {
  return onAuthStateChanged(auth, callback);
}
