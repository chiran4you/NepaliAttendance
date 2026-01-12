import React, { createContext, useContext, useEffect, useMemo, useState } from "react";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { validateLicenseCode } from "./license";

type PremiumState = {
  isPremium: boolean;
  licenseCode: string | null;
  activate: (code: string) => Promise<{ ok: boolean; message: string }>;
  deactivate: () => Promise<void>;
};

const PremiumContext = createContext<PremiumState | null>(null);

const STORAGE_KEY = "premium_state_v1";

export function PremiumProvider({ children }: { children: React.ReactNode }) {
  const [licenseCode, setLicenseCode] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const raw = await AsyncStorage.getItem(STORAGE_KEY);
        if (!raw) return;
        const parsed = JSON.parse(raw) as { licenseCode: string | null };
        setLicenseCode(parsed.licenseCode ?? null);
      } catch {
        // ignore corrupted storage
      }
    })();
  }, []);

  const isPremium = !!licenseCode;

  const activate: PremiumState["activate"] = async (code) => {
    const normalized = code.trim().toUpperCase();

    if (!normalized) return { ok: false, message: "Please enter a license code." };
    if (!validateLicenseCode(normalized)) return { ok: false, message: "Invalid license code." };

    setLicenseCode(normalized);
    await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify({ licenseCode: normalized }));
    return { ok: true, message: "Premium activated ✅" };
  };

  const deactivate: PremiumState["deactivate"] = async () => {
    setLicenseCode(null);
    await AsyncStorage.removeItem(STORAGE_KEY);
  };

  const value = useMemo(
    () => ({ isPremium, licenseCode, activate, deactivate }),
    [isPremium, licenseCode]
  );

  return <PremiumContext.Provider value={value}>{children}</PremiumContext.Provider>;
}

export function usePremium() {
  const ctx = useContext(PremiumContext);
  if (!ctx) throw new Error("usePremium must be used inside PremiumProvider");
  return ctx;
}
