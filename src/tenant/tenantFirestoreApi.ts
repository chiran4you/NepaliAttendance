import { doc, getDoc } from "firebase/firestore";
import { db } from "../firebase/firebase";
import type { TenantConfig } from "./TenantContext";

export async function fetchTenantBySchoolCodeFirestore(code: string): Promise<TenantConfig> {
  const normalized = code.trim().toUpperCase();
  if (!normalized) throw new Error("School code is required.");

  const ref = doc(db, "tenant_codes", normalized);
  const snap = await getDoc(ref);

  if (!snap.exists()) throw new Error("Invalid school code.");

  const data = snap.data() as any;
  if (!data.active) throw new Error("This school code is inactive.");

  return {
    tenantId: data.tenantId,
    schoolName: data.schoolName,
    schoolAddress: data.schoolAddress ?? "",
    features: data.features ?? { csvExportEnabled: false, smsAlertsEnabled: false },
  };
}
