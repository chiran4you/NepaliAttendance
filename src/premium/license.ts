export function validateLicenseCode(code: string): boolean {
  // Replace with server validation later.
  // For now: accept codes like PREMIUM-1234
  const normalized = code.trim().toUpperCase();
  return /^PREMIUM-\d{4}$/.test(normalized);
}
