// src/tenant/TenantContext.tsx
import React, { createContext, useContext, useEffect, useMemo, useState } from "react";
import AsyncStorage from "@react-native-async-storage/async-storage";

export type TenantFeatures = {
  /** If false, hide/disable CSV export UI for this tenant even if premium exists */
  csvExportEnabled: boolean;
  /** If false, hide/disable SMS alerts UI for this tenant even if premium exists */
  smsAlertsEnabled: boolean;
};

export type TenantInfo = {
  tenantId: string;
  schoolName: string;
  schoolAddress: string;
  features: TenantFeatures;
};

type TenantContextValue = {
  loading: boolean;
  tenant: TenantInfo | null;
  setTenant: (t: TenantInfo) => Promise<void>;
  logoutTenant: () => Promise<void>;
};

const STORAGE_KEY = "tenantInfo_v2";

const DEFAULT_FEATURES: TenantFeatures = {
  csvExportEnabled: false,
  smsAlertsEnabled: false,
};

const TenantContext = createContext<TenantContextValue | null>(null);

function normalizeTenant(raw: any): TenantInfo | null {
  if (!raw || typeof raw !== "object") return null;

  const tenantId = String(raw.tenantId ?? "").trim();
  if (!tenantId) return null;

  const schoolName = String(raw.schoolName ?? "School").trim() || "School";
  const schoolAddress = String(raw.schoolAddress ?? "").trim();

  const f = raw.features ?? {};
  const features: TenantFeatures = {
    csvExportEnabled: Boolean(f.csvExportEnabled),
    smsAlertsEnabled: Boolean(f.smsAlertsEnabled),
  };

  return { tenantId, schoolName, schoolAddress, features };
}

export function TenantProvider({ children }: { children: React.ReactNode }) {
  const [loading, setLoading] = useState(true);
  const [tenant, setTenantState] = useState<TenantInfo | null>(null);

  useEffect(() => {
    let mounted = true;

    (async () => {
      try {
        // Prefer v2 key; fall back to old key (backward compatible)
        const rawV2 = await AsyncStorage.getItem(STORAGE_KEY);
        const rawV1 = rawV2 ? null : await AsyncStorage.getItem("tenantInfo");

        const raw = rawV2 ?? rawV1;
        if (!mounted) return;

        if (raw) {
          try {
            const parsed = JSON.parse(raw);
            const normalized = normalizeTenant(parsed);

            // If old data had no features, inject defaults
            if (normalized) {
              normalized.features = normalized.features ?? { ...DEFAULT_FEATURES };
              setTenantState(normalized);

              // Migrate old key -> new key
              await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(normalized));
              if (rawV1) await AsyncStorage.removeItem("tenantInfo");
            }
          } catch {
            // ignore bad json
          }
        }
      } finally {
        if (mounted) setLoading(false);
      }
    })();

    return () => {
      mounted = false;
    };
  }, []);

  const setTenant = async (t: TenantInfo) => {
    const normalized = normalizeTenant(t);
    if (!normalized) throw new Error("Invalid tenant info");
    await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(normalized));
    setTenantState(normalized);
  };

  const logoutTenant = async () => {
    await AsyncStorage.removeItem(STORAGE_KEY);
    await AsyncStorage.removeItem("tenantInfo");
    setTenantState(null);
  };

  const value = useMemo(
    () => ({
      loading,
      tenant,
      setTenant,
      logoutTenant,
    }),
    [loading, tenant]
  );

  return <TenantContext.Provider value={value}>{children}</TenantContext.Provider>;
}

export function useTenant() {
  const ctx = useContext(TenantContext);
  if (!ctx) throw new Error("useTenant must be used inside TenantProvider");
  return ctx;
}
