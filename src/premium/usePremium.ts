// src/premium/usePremium.ts
import { useCallback, useEffect, useMemo, useState } from "react";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { Platform } from "react-native";
import { randomUUID } from "expo-crypto";
import Constants from "expo-constants";

import { APP_CONFIG } from "../constants/appConfig";
import { validateLicenseCode, validatePremiumEntitlement } from "./license";

export type PremiumEntitlement = {
  premium: boolean;
  tenantId: string;
  deviceId: string;

  // Epoch ms (number) or null for no expiry
  expiresAt: number | null;

  // When we last verified online (epoch ms)
  lastVerifiedAt: number;

  // Optional grace period end (epoch ms). If provided, allow premium until graceUntil.
  graceUntil?: number | null;

  // Optional raw info from server for debugging
  plan?: string;
  note?: string;
};

const STORAGE_KEY = "premiumEntitlement";
const DEVICE_ID_KEY = "deviceId";

function nowMs() {
  return Date.now();
}

function safeNumber(x: any): number | null {
  const n = Number(x);
  return Number.isFinite(n) ? n : null;
}

function normalizeEntitlement(input: any, tenantId: string, deviceId: string): PremiumEntitlement {
  const premium =
    Boolean(input?.premium) || Boolean(input?.active) || Boolean(input?.enabled);

  const expiresAt =
    input?.expiresAt === null || input?.expiresAt === undefined
      ? null
      : safeNumber(input?.expiresAt ?? input?.expiry ?? input?.expires_at);

  const graceUntil =
    input?.graceUntil === null || input?.graceUntil === undefined
      ? null
      : safeNumber(input?.graceUntil ?? input?.grace_until);

  const lastVerifiedAt = safeNumber(input?.lastVerifiedAt) ?? nowMs();

  return {
    premium,
    tenantId,
    deviceId,
    expiresAt,
    graceUntil,
    lastVerifiedAt,
    plan: typeof input?.plan === "string" ? input.plan : undefined,
    note: typeof input?.note === "string" ? input.note : undefined,
  };
}

function isPremiumActive(ent: PremiumEntitlement | null): boolean {
  const { valid } = validatePremiumEntitlement(ent, {
    now: nowMs(),
    graceDays: APP_CONFIG.PREMIUM_GRACE_DAYS ?? 14,
  });
  return valid;
}


async function getOrCreateDeviceId(): Promise<string> {
  const existing = await AsyncStorage.getItem(DEVICE_ID_KEY);
  if (existing) return existing;

  const id = randomUUID();
  await AsyncStorage.setItem(DEVICE_ID_KEY, id);
  return id;
}

async function fetchWithTimeout(url: string, options: RequestInit, timeoutMs = 15000) {
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { ...options, signal: controller.signal });
    return res;
  } finally {
    clearTimeout(t);
  }
}

/**
 * Premium hook used by Settings, Reports, Attendance.
 * - Stores entitlement in AsyncStorage under key: "premiumEntitlement"
 * - Other screens can read this same key offline.
 */
export function usePremium(tenantId: string | null) {
  const [loading, setLoading] = useState(false);
  const [deviceId, setDeviceId] = useState<string>("");
  const [entitlement, setEntitlement] = useState<PremiumEntitlement | null>(null);

  const premiumEnabled = useMemo(() => isPremiumActive(entitlement), [entitlement]);

  const statusText = useMemo(() => {
    if (!tenantId) return "No tenant";
    if (!entitlement) return "Not activated";
    if (premiumEnabled) {
      if (entitlement.expiresAt == null) return "Active (no expiry)";
      return "Active";
    }
    // expired
    if (entitlement.expiresAt != null) return "Expired";
    return "Locked";
  }, [tenantId, entitlement, premiumEnabled]);

  const loadFromStorage = useCallback(async () => {
    if (!tenantId) return;

    const id = await getOrCreateDeviceId();
    setDeviceId(id);

    const raw = await AsyncStorage.getItem(STORAGE_KEY);
    if (!raw) {
      setEntitlement(null);
      return;
    }

    try {
      const obj = JSON.parse(raw);
      // If entitlement belongs to another tenant, treat as not activated
      if (obj?.tenantId && obj.tenantId !== tenantId) {
        setEntitlement(null);
        return;
      }
      // Ensure deviceId matches (optional)
      const normalized = normalizeEntitlement(obj, tenantId, id);
      setEntitlement(normalized);
    } catch {
      setEntitlement(null);
    }
  }, [tenantId]);

  useEffect(() => {
    loadFromStorage();
  }, [loadFromStorage]);

  const clear = useCallback(async () => {
    await AsyncStorage.removeItem(STORAGE_KEY);
    setEntitlement(null);
  }, []);

  const activate = useCallback(
    async (licenseKey: string) => {
      if (!tenantId) throw new Error("Tenant not ready");
      const id = await getOrCreateDeviceId();
      setDeviceId(id);

      const normalizedKey = licenseKey.trim().toUpperCase();
      if (!normalizedKey) throw new Error("Please enter a license code.");
      if (!validateLicenseCode(normalizedKey)) {
        throw new Error("Invalid license code format.");
      }

      const apiBase = APP_CONFIG.API_BASE_URL?.replace(/\/+$/, "");
      if (!apiBase) throw new Error("API_BASE_URL is empty");

      const appVersion =
        (Constants.expoConfig as any)?.version ??
        (Constants as any)?.nativeAppVersion ??
        "";

      const payload = {
        tenantId,
        licenseKey: normalizedKey,
        deviceId: id,
        platform: Platform.OS,
        appVersion,
      };

      // ✅ Try multiple endpoints so your server can change without breaking app.
      const candidates = [
        `${apiBase}/api/license/activate`,
        `${apiBase}/license/activate`,
        `${apiBase}/api/activate`,
        `${apiBase}/activate`,
      ];

      setLoading(true);
      try {
        let lastErr: any = null;

        for (const url of candidates) {
          try {
            const res = await fetchWithTimeout(
              url,
              {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(payload),
              },
              90000
            );

            const text = await res.text();
            let json: any = null;
            try {
              json = text ? JSON.parse(text) : null;
            } catch {
              // non-json response
            }

            if (!res.ok) {
              const msg =
                json?.error ||
                json?.message ||
                `${res.status} ${res.statusText}` ||
                "Activation failed";
              throw new Error(msg);
            }

            const normalized = normalizeEntitlement(json ?? {}, tenantId, id);
            const now = Date.now();
            const expired = normalized.expiresAt != null && now > normalized.expiresAt;
            if (!normalized.premium) {
              throw new Error(json?.error || json?.message || "License invalid or inactive");
            }
            if (expired) {
              // Cache entitlement so UI can show expiry, but reject activation
              const expiredEnt = { ...normalized, premium: false, note: "Expired" };
              await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(expiredEnt));
              setEntitlement(expiredEnt);
              throw new Error("License expired");
            }

            const saveObj = {
              ...normalized,
              // always store tenantId/deviceId and verification time
              tenantId,
              deviceId: id,
              lastVerifiedAt: nowMs(),
            };

            await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(saveObj));
            setEntitlement(saveObj);
            return saveObj;
          } catch (e: any) {
            lastErr = e;
            // Try next endpoint
          }
        }

        throw lastErr ?? new Error("Activation failed");
      } finally {
        setLoading(false);
      }
    },
    [tenantId]
  );

  return {
    loading,
    premiumEnabled,
    statusText,
    deviceId,
    entitlement,
    activate,
    clear,
    reload: loadFromStorage,
  };
}
