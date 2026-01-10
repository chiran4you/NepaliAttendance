// server.js (Render-ready + Modern Admin UI)
// Admin backend for NepaliAttendance
// - Tenant code creation (school info for AppHeader) in RTDB
// - License creation + activation API in RTDB
// - Admin UI served from / (after login)
// - Firebase Admin via ENV (no local serviceAccount.json)

import express from "express";
import cookieParser from "cookie-parser";
import cors from "cors";
import admin from "firebase-admin";
import crypto from "crypto";
import path from "path";
import { fileURLToPath } from "url";

// -------------------------------
// Firebase Admin Initialization
// -------------------------------
if (!admin.apps.length) {
  if (!process.env.FIREBASE_SERVICE_ACCOUNT_JSON) {
    throw new Error("FIREBASE_SERVICE_ACCOUNT_JSON is not set");
  }
  if (!process.env.FIREBASE_DATABASE_URL) {
    throw new Error("FIREBASE_DATABASE_URL is not set");
  }

  const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_JSON);

  admin.initializeApp({
    credential: admin.credential.cert(serviceAccount),
    databaseURL: process.env.FIREBASE_DATABASE_URL,
  });
}
const db = admin.database();

// -------------------------------
// Express setup
// -------------------------------
const app = express();
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true })); // ✅ needed for HTML form posts
app.use(cookieParser());

// Resolve __dirname for ES modules
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Serve static admin UI
app.use("/public", express.static(path.join(__dirname, "public")));

// -------------------------------
// Admin auth
// -------------------------------
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || "admin123";

function requireAuth(req, res, next) {
  // Public routes
  if (
    req.path === "/login" ||
    req.path === "/logout" ||
    req.path === "/api/license/activate"
  ) {
    return next();
  }

  // Allow public assets
  if (req.path.startsWith("/public/")) return next();

  if (req.cookies && req.cookies.auth === ADMIN_PASSWORD) return next();
  return res.redirect("/login");
}

// -------------------------------
// Login UI
// -------------------------------
app.get("/login", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "login.html"));
});

app.post("/login", (req, res) => {
  const password = String(req.body?.password || "");
  if (password === ADMIN_PASSWORD) {
    res.cookie("auth", ADMIN_PASSWORD, { httpOnly: true });
    return res.redirect("/");
  }
  return res.status(401).send("Invalid password");
});

app.get("/logout", (req, res) => {
  res.clearCookie("auth");
  res.redirect("/login");
});

// Apply auth to everything else
app.use(requireAuth);

// -------------------------------
// Admin UI (modern page)
// -------------------------------
app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

// -------------------------------
// Admin APIs (protected)
// -------------------------------
function now() {
  return Date.now();
}

function generateTenantCode() {
  // 6 chars, easy to type
  return crypto.randomBytes(3).toString("hex").toUpperCase();
}

function generateLicenseKey() {
  // Example: NA-AB12-CD34-EF56
  const chunk = () => crypto.randomBytes(2).toString("hex").toUpperCase();
  return `NA-${chunk()}-${chunk()}-${chunk()}`;
}

app.post("/admin/create-tenant-code", async (req, res) => {
  try {
    const schoolName = String(req.body?.schoolName || "").trim();
    const schoolAddress = String(req.body?.schoolAddress || "").trim();

    // optional feature flags
    const csvExportEnabled = String(req.body?.csvExportEnabled || "") === "on";
    const smsAlertsEnabled = String(req.body?.smsAlertsEnabled || "") === "on";

    if (!schoolName) return res.status(400).send("School name is required");

    const code = generateTenantCode();
    const tenantId = crypto.randomUUID();

    await db.ref(`tenant_codes/${code}`).set({
      tenantId,
      schoolName,
      schoolAddress,
      features: {
        csvExportEnabled,
        smsAlertsEnabled,
      },
      createdAt: now(),
    });

    return res.json({ ok: true, code, tenantId });
  } catch (e) {
    return res.status(500).send(e?.message || "Server error");
  }
});

app.get("/admin/list-tenant-codes", async (req, res) => {
  try {
    const snap = await db.ref("tenant_codes").get();
    const val = snap.val() || {};
    const items = Object.entries(val).map(([code, obj]) => ({
      code,
      ...obj,
    }));

    // newest first
    items.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
    return res.json({ ok: true, items });
  } catch (e) {
    return res.status(500).send(e?.message || "Server error");
  }
});

app.post("/admin/create-license", async (req, res) => {
  try {
    const tenantId = String(req.body?.tenantId || "").trim(); // optional bind
    const maxDevices = Number(req.body?.maxDevices || 1);

    // optional expiry: empty => null
    const expiresAtRaw = String(req.body?.expiresAt || "").trim();
    const expiresAt = expiresAtRaw ? Number(expiresAtRaw) : null;
    if (expiresAtRaw && Number.isNaN(expiresAt)) {
      return res.status(400).send("expiresAt must be epoch milliseconds or empty");
    }

    const licenseKey = generateLicenseKey();

    await db.ref(`licenses/${licenseKey}`).set({
      active: true,
      tenantId: tenantId || null,
      plan: "premium",
      maxDevices: Number.isFinite(maxDevices) && maxDevices > 0 ? maxDevices : 1,
      expiresAt: expiresAt ?? null,
      usedDevices: {},
      createdAt: now(),
    });

    return res.json({ ok: true, licenseKey });
  } catch (e) {
    return res.status(500).send(e?.message || "Server error");
  }
});

app.get("/admin/list-licenses", async (req, res) => {
  try {
    const snap = await db.ref("licenses").get();
    const val = snap.val() || {};
    const items = Object.entries(val).map(([licenseKey, obj]) => ({
      licenseKey,
      ...obj,
      usedCount: obj?.usedDevices ? Object.keys(obj.usedDevices).length : 0,
    }));
    items.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
    return res.json({ ok: true, items });
  } catch (e) {
    return res.status(500).send(e?.message || "Server error");
  }
});

app.post("/admin/toggle-license", async (req, res) => {
  try {
    const licenseKey = String(req.body?.licenseKey || "").trim();
    const active = String(req.body?.active || "") === "true";
    if (!licenseKey) return res.status(400).send("licenseKey required");

    await db.ref(`licenses/${licenseKey}/active`).set(active);
    return res.json({ ok: true });
  } catch (e) {
    return res.status(500).send(e?.message || "Server error");
  }
});

// -------------------------------
// PUBLIC API: Premium License Activation (B1)
// -------------------------------
app.post("/api/license/activate", async (req, res) => {
  try {
    const tenantId = String(req.body?.tenantId || "").trim();
    const deviceId = String(req.body?.deviceId || "").trim();
    const licenseKey = String(req.body?.licenseKey || "").trim();

    if (!tenantId || !deviceId || !licenseKey) {
      return res.status(400).send("Missing tenantId, deviceId, or licenseKey");
    }

    const licRef = db.ref(`licenses/${licenseKey}`);
    const licSnap = await licRef.get();
    if (!licSnap.exists()) return res.status(404).send("Invalid license key");

    const lic = licSnap.val();
    if (!lic.active) return res.status(403).send("License is not active");

    // Bind license to tenant (first activation assigns)
    if (lic.tenantId && String(lic.tenantId) !== tenantId) {
      return res.status(403).send("License belongs to a different tenant");
    }
    if (!lic.tenantId) await licRef.child("tenantId").set(tenantId);

    const maxDevices = Number(lic.maxDevices || 1);
    const usedRef = licRef.child("usedDevices");
    const usedSnap = await usedRef.get();
    const used = usedSnap.val() || {};

    if (!used[deviceId] && Object.keys(used).length >= maxDevices) {
      return res.status(403).send("Device limit reached");
    }
    if (!used[deviceId]) {
      await usedRef.child(deviceId).set({ activatedAt: now() });
    }

    const entitlement = {
      premium: true,
      plan: "premium",
      expiresAt: lic.expiresAt ?? null,
      lastVerifiedAt: now(),
    };

    await db.ref(`entitlements/${tenantId}/${deviceId}`).set(entitlement);
    return res.json(entitlement);
  } catch (e) {
    return res.status(500).send(e?.message || "Server error");
  }
});

// -------------------------------
// Start server (Render-compatible)
// -------------------------------
const PORT = process.env.PORT || 3001;
app.listen(PORT, "0.0.0.0", () => {
  console.log(`Admin server running on port ${PORT}`);
});
