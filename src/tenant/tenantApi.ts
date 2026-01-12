import type { TenantConfig } from "./tenantTypes";

// Change this to your backend URL later:
const API_BASE = "https://YOUR_DOMAIN_OR_IP_HERE";

export async function fetchTenantBySchoolCode(code: string): Promise<TenantConfig> {
  const res = await fetch(`${API_BASE}/tenant/by-code/${encodeURIComponent(code.trim())}`);
  if (!res.ok) {
    const msg = await safeText(res);
    throw new Error(msg || "Invalid school code or server error.");
  }
  return (await res.json()) as TenantConfig;
}

async function safeText(res: Response) {
  try {
    return await res.text();
  } catch {
    return "";
  }
}
