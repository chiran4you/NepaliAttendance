// src/tenant/TenantContext.tsx
import React, { createContext, useContext, useEffect, useMemo, useState } from "react";
import AsyncStorage from "@react-native-async-storage/async-storage";

export type TenantInfo = {
  tenantId: string;
  schoolName: string;
  schoolAddress: string;
};

type TenantContextValue = {
  loading: boolean;
  tenant: TenantInfo | null;
  setTenant: (t: TenantInfo) => Promise<void>;
  logoutTenant: () => Promise<void>;
};

const STORAGE_KEY = "tenantInfo";

const TenantContext = createContext<TenantContextValue | null>(null);

export function TenantProvider({ children }: { children: React.ReactNode }) {
  const [loading, setLoading] = useState(true);
  const [tenant, setTenantState] = useState<TenantInfo | null>(null);

  useEffect(() => {
    let mounted = true;

    (async () => {
      try {
        const raw = await AsyncStorage.getItem(STORAGE_KEY);
        if (!mounted) return;

        if (raw) {
          try {
            const parsed = JSON.parse(raw);
            if (parsed?.tenantId) setTenantState(parsed);
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
    await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(t));
    setTenantState(t);
  };

  const logoutTenant = async () => {
    await AsyncStorage.removeItem(STORAGE_KEY);
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
