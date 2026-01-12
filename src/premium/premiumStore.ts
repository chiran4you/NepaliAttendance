// src/premium/premiumStore.ts
import AsyncStorage from "@react-native-async-storage/async-storage";
import { randomUUID } from "expo-crypto";
import type { PremiumEntitlement } from "./types";

const DEVICE_ID_KEY = "na.deviceId.v1";
const ENTITLEMENT_PREFIX = "na.entitlement.v1:"; // + tenantId

export async function getOrCreateDeviceId(): Promise<string> {
  const existing = await AsyncStorage.getItem(DEVICE_ID_KEY);
  if (existing) return existing;
  const id = randomUUID();
  await AsyncStorage.setItem(DEVICE_ID_KEY, id);
  return id;
}

export async function getCachedEntitlement(
  tenantId: string
): Promise<PremiumEntitlement | null> {
  const raw = await AsyncStorage.getItem(ENTITLEMENT_PREFIX + tenantId);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as PremiumEntitlement;
  } catch {
    return null;
  }
}

export async function setCachedEntitlement(ent: PremiumEntitlement) {
  await AsyncStorage.setItem(ENTITLEMENT_PREFIX + ent.tenantId, JSON.stringify(ent));
}

export async function clearCachedEntitlement(tenantId: string) {
  await AsyncStorage.removeItem(ENTITLEMENT_PREFIX + tenantId);
}
