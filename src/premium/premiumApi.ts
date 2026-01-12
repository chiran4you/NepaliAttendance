// src/premium/premiumApi.ts
import { APP_CONFIG } from "../constants/appConfig";
import type { PremiumEntitlement } from "./types";

type ActivateResponse = {
  premium: boolean;
  plan: "free" | "premium";
  expiresAt: number | null;
  lastVerifiedAt: number;
};

export async function activateLicenseOnline(params: {
  tenantId: string;
  deviceId: string;
  licenseKey: string;
}): Promise<PremiumEntitlement> {
  const url = `${APP_CONFIG.API_BASE_URL}/api/license/activate`;

  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(params),
  });

  if (!res.ok) {
    const txt = await res.text().catch(() => "");
    throw new Error(txt || `Activation failed (${res.status})`);
  }

  const data = (await res.json()) as ActivateResponse;

  return {
    tenantId: params.tenantId,
    deviceId: params.deviceId,
    premium: data.premium,
    plan: data.plan,
    expiresAt: data.expiresAt,
    lastVerifiedAt: data.lastVerifiedAt,
  };
}
