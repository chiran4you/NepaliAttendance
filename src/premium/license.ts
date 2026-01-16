export function validateLicenseCode(code: string): boolean {
  // Accept codes like: NA-22AB-339F-7896 (4-4-4 segments)
  const normalized = code.trim().toUpperCase();
  return /^NA-[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}$/.test(normalized);
}
