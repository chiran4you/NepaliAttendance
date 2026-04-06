// src/premium/license.ts

/**
 * Validates user-entered license code format.
 */
export function validateLicenseCode(code: string): boolean {
  // Accept codes like: NA-22AB-339F-7896
  const normalized = code.trim().toUpperCase();
  return /^NA-[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}$/.test(normalized);
}

/**
 * Minimal entitlement shape used across the app.
 *
 * Notes:
 * - expiresAt is the only field used for expiry validation.
 * - lastVerifiedAt and graceUntil are kept only for backward compatibility
 *   with older cached/server payloads.
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
 *  - otherwise valid
 */
export function validatePremiumEntitlement(
  ent: PremiumEntitlementLike | null
): { valid: boolean; reason: "inactive" | "expired" | "ok" } {
  if (!ent || !ent.premium) {
    return { valid: false, reason: "inactive" };
  }

  const now = Date.now();

  if (typeof ent.expiresAt === "number" && now > ent.expiresAt) {
    return { valid: false, reason: "expired" };
  }

  return { valid: true, reason: "ok" };
}
