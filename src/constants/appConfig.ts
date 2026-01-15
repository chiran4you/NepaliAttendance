// src/constants/appConfig.ts
/**
 * Central app config
 * - RTDB_URL is used for tenant activation + school header info (public read)
 * - API_BASE_URL is used for license activation (premium) on your backend (Render/VPS)
 */
export const APP_CONFIG = {
  // ✅ Firebase Realtime Database base URL (NO trailing /.json)
  RTDB_URL: "https://nepaliattendance-b1dd0-default-rtdb.firebaseio.com",

  // ✅ Your backend (Render) URL for premium activation
  // Example: "https://nepaliattendance.onrender.com"
  API_BASE_URL: "https://nepaliattendance.onrender.com",
  
  // NEW: SMS goes to VPS
  SMS_API_BASE_URL: "http://67.215.232.20:3001"
  
  APP_NAME: "NepaliAttendance",
};
