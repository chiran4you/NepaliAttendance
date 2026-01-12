import React, {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import AsyncStorage from "@react-native-async-storage/async-storage";

/**
 * Tenant configuration returned by Realtime Database
 */
export type TenantConfig = {
  tenantId: string;
  schoolName: string;
  schoolAddress?: string;
  features: {
    csvExportEnabled: boolean;
    smsAlertsEnabled: boolean;
  };
};

type TenantContextType = {
  tenant: TenantConfig | null;
  isReady: boolean;
  activateWithSchoolCode: (code: string) => Promise<void>;
  logoutTenant: () => Promise<void>;
};

const TenantContext = createContext<TenantContextType | null>(null);

const STORAGE_KEY = "tenant_config_v1";

/**
 * Firebase Realtime Database base URL
 */
const RTDB_BASE_URL =
  "https://nepaliattendance-b1dd0-default-rtdb.firebaseio.com";

export function TenantProvider({ children }: { children: React.ReactNode }) {
  const [tenant, setTenant] = useState<TenantConfig | null>(null);
  const [isReady, setIsReady] = useState(false);

  /**
   * Load tenant from local storage on app start (offline-first)
   */
  useEffect(() => {
    (async () => {
      try {
        const raw = await AsyncStorage.getItem(STORAGE_KEY);
        if (raw) setTenant(JSON.parse(raw));
      } catch {
        // ignore corrupted storage
      } finally {
        setIsReady(true);
      }
    })();
  }, []);

  /**
   * Activate tenant using School Code
   * Realtime Database read:
   *   /tenant_codes/{SCHOOL_CODE}.json
   */
  const activateWithSchoolCode = async (schoolCode: string) => {
    const code = schoolCode.trim().toUpperCase();
    if (!code) throw new Error("School code is required.");

    const url = `${RTDB_BASE_URL}/tenant_codes/${encodeURIComponent(
      code
    )}.json`;

    const res = await fetch(url);
    if (!res.ok) {
      throw new Error("Network error while activating school.");
    }

    const data = await res.json();

    // RTDB returns null if path doesn't exist
    if (!data) {
      throw new Error("Invalid school code.");
    }

    if (data.active === false) {
      throw new Error("This school code is inactive.");
    }

    const cfg: TenantConfig = {
      tenantId: String(data.tenantId ?? ""),
      schoolName: String(data.schoolName ?? ""),
      schoolAddress: data.schoolAddress
        ? String(data.schoolAddress)
        : "",
      features: {
        csvExportEnabled: Boolean(data.features?.csvExportEnabled),
        smsAlertsEnabled: Boolean(data.features?.smsAlertsEnabled),
      },
    };

    if (!cfg.tenantId || !cfg.schoolName) {
      throw new Error("Tenant configuration is incomplete.");
    }

    await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(cfg));
    setTenant(cfg);
  };

  /**
   * Clear tenant from this device (admin/reset only)
   */
  const logoutTenant = async () => {
    await AsyncStorage.removeItem(STORAGE_KEY);
    setTenant(null);
  };

  const value = useMemo(
    () => ({
      tenant,
      isReady,
      activateWithSchoolCode,
      logoutTenant,
    }),
    [tenant, isReady]
  );

  return (
    <TenantContext.Provider value={value}>
      {children}
    </TenantContext.Provider>
  );
}

/**
 * Hook to access tenant safely
 */
export function useTenant() {
  const ctx = useContext(TenantContext);
  if (!ctx) throw new Error("useTenant must be used inside TenantProvider");
  return ctx;
}
