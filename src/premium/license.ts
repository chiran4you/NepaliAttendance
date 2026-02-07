// src/premium/license.ts

/**
 * Validates user-entered license code format.
 */
export function validateLicenseCode(code: string): boolean {
  // Accept codes like: NA-22AB-339F-7896 (4-4-4 segments)
  const normalized = code.trim().toUpperCase();
  return /^NA-[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}$/.test(normalized);
}

/**
 * Minimal entitlement shape used across the app.
 * (Some fields may be absent depending on backend/app version.)
 */
export type PremiumEntitlementLike = {
  premium: boolean;
  expiresAt: number | null;
  lastVerifiedAt: number | null;
  graceUntil?: number | null;
};

/**
 * Single source of truth for premium validity.
 * Rules:
 *  - must have premium=true
 *  - if expiresAt is set and now > expiresAt => invalid
 *  - if graceUntil is set and now > graceUntil => invalid (stronger, explicit offline cutoff)
 *  - else if lastVerifiedAt is set and now-lastVerifiedAt > graceDays => invalid
 */
export function validatePremiumEntitlement(
  ent: PremiumEntitlementLike | null,
  opts?: { now?: number; graceDays?: number }
): { valid: boolean; reason: "inactive" | "expired" | "grace_expired" | "ok" } {
  if (!ent || !ent.premium) return { valid: false, reason: "inactive" };

  const now = opts?.now ?? Date.now();

  if (typeof ent.expiresAt === "number" && now > ent.expiresAt) {
    return { valid: false, reason: "expired" };
  }

  if (typeof ent.graceUntil === "number" && now > ent.graceUntil) {
    return { valid: false, reason: "grace_expired" };
  }

  const graceDays = opts?.graceDays ?? 14;
  if (typeof ent.lastVerifiedAt === "number") {
    const graceMs = graceDays * 24 * 60 * 60 * 1000;
    if (now - ent.lastVerifiedAt > graceMs) {
      return { valid: false, reason: "grace_expired" };
    }
  }

  return { valid: true, reason: "ok" };
}
