// src/premium/premiumApi.ts
import { APP_CONFIG } from "../constants/appConfig";
import type { PremiumEntitlement } from "./types";

type ActivateResponse = {
  premium?: boolean;
  plan?: "free" | "premium";
  expiresAt?: number | null;
  lastVerifiedAt?: number;
  tenantId?: string;
  error?: string;
  message?: string;
  ok?: boolean;
};

export async function activateLicenseOnline(params: {
  tenantId: string;
  deviceId: string;
  licenseKey: string;
}): Promise<PremiumEntitlement> {
  const base = APP_CONFIG.API_BASE_URL?.replace(/\/+$/, "");
  if (!base) throw new Error("API_BASE_URL is empty");

  const url = `${base}/api/license/activate`;

  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      tenantId: params.tenantId,
      deviceId: params.deviceId,
      licenseKey: params.licenseKey,
    }),
  });

  const txt = await res.text();
  let data: ActivateResponse | null = null;
  try {
    data = txt ? (JSON.parse(txt) as ActivateResponse) : null;
  } catch {
    data = null;
  }

  if (data && data.ok === false) {
    throw new Error(data.error || data.message || "Activation rejected");
  }

  if (!res.ok) {
    throw new Error((data?.error || data?.message || txt || `Activation failed (${res.status})`).toString());
  }

  if (data?.tenantId && String(data.tenantId) !== String(params.tenantId)) {
    throw new Error("License does not belong to this school (tenant mismatch)");
  }

  const premium = Boolean(data?.premium);
  const expiresAt = data?.expiresAt ?? null;
  const lastVerifiedAt = typeof data?.lastVerifiedAt === "number" ? data.lastVerifiedAt : Date.now();
  const plan = (data?.plan ?? (premium ? "premium" : "free")) as "free" | "premium";

  return {
    tenantId: params.tenantId,
    deviceId: params.deviceId,
    premium,
    plan,
    expiresAt,
    lastVerifiedAt,
  };
}
