// src/premium/types.ts
export type PremiumEntitlement = {
  tenantId: string;
  deviceId: string;
  premium: boolean;
  plan: "free" | "premium";
  expiresAt: number | null; // epoch ms, or null = lifetime
  lastVerifiedAt: number; // epoch ms
};
