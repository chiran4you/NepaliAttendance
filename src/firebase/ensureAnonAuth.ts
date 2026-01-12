import { auth } from "./firebase";
import { signInAnonymously } from "firebase/auth";

export async function ensureAnonAuth() {
  if (auth.currentUser) return;
  await signInAnonymously(auth);
}
