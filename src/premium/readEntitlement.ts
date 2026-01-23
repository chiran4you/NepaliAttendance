// src/premium/readEntitlement.ts
import AsyncStorage from "@react-native-async-storage/async-storage";
import type { PremiumEntitlementLike } from "./license";

/**
 * Reads premium entitlement from AsyncStorage.
 * Supports current and legacy keys so all screens behave consistently offline.
 */
export async function readPremiumEntitlement(): Promise<PremiumEntitlementLike | null> {
  const keys = [
    "premiumEntitlement",
    "premium_entitlement",
    "entitlement",
    "license_entitlement",
  ];

  for (const k of keys) {
    const raw = await AsyncStorage.getItem(k);
    if (!raw) continue;

    try {
      const obj = JSON.parse(raw);

      const expiresAt =
        obj?.expiresAt === null || obj?.expiresAt === undefined ? null : Number(obj?.expiresAt);

      const graceUntil =
        obj?.graceUntil === null || obj?.graceUntil === undefined ? null : Number(obj?.graceUntil);

      const lastVerifiedAtRaw = obj?.lastVerifiedAt ?? obj?.lastVerified ?? null;
      const lastVerifiedAt =
        lastVerifiedAtRaw === null || lastVerifiedAtRaw === undefined ? null : Number(lastVerifiedAtRaw);

      return {
        premium: Boolean(obj?.premium),
        expiresAt: Number.isFinite(expiresAt) ? expiresAt : null,
        lastVerifiedAt: Number.isFinite(lastVerifiedAt) ? lastVerifiedAt : null,
        graceUntil: Number.isFinite(graceUntil) ? graceUntil : null,
      };
    } catch {
      // ignore invalid json
    }
  }

  return null;
}
