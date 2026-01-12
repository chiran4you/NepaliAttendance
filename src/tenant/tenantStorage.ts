import AsyncStorage from "@react-native-async-storage/async-storage";
import type { TenantConfig } from "./tenantTypes";

const KEY = "tenant_config_v1";

export async function loadTenant(): Promise<TenantConfig | null> {
  const raw = await AsyncStorage.getItem(KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as TenantConfig;
  } catch {
    return null;
  }
}

export async function saveTenant(cfg: TenantConfig) {
  await AsyncStorage.setItem(KEY, JSON.stringify(cfg));
}

export async function clearTenant() {
  await AsyncStorage.removeItem(KEY);
}
