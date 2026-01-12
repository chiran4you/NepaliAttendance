// src/constants/appConfig.ts
/**
 * Public backend base URL (Render).
 * Example: "https://nepaliattendance.onrender.com"
 *
 * IMPORTANT: Do NOT include a trailing slash.
 *
 * This is used for premium licensing endpoints like:
 *   POST {API_BASE_URL}/api/license/activate
 */
export const APP_CONFIG = {
  API_BASE_URL: "https://nepaliattendance.onrender.com",

  /**
   * Firebase Realtime Database base URL (for tenant config, etc.)
   * NOTE: This is NOT your API server.
   * If you ever access RTDB via REST manually, you must append ".json".
   * (Your app using the Firebase SDK does not need ".json".)
   */
  RTDB_URL: "https://nepaliattendance-b1dd0-default-rtdb.firebaseio.com",

  // How long premium stays valid offline after last successful online verification (days)
  PREMIUM_GRACE_DAYS: 14,
} as const;
