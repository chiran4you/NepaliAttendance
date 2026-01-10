// server.js (Render-ready, secure)
// Admin backend for NepaliAttendance
// - Tenant code creation (school info for AppHeader)
// - Premium license activation (B1)
// - Firebase Admin via ENV (no local serviceAccount.json)

import express from "express";
import cookieParser from "cookie-parser";
import cors from "cors";
import admin from "firebase-admin";
import crypto from "crypto";

// ===============================
// Firebase Admin Initialization
// ===============================
if (!admin.apps.length) {
  if (!process.env.FIREBASE_SERVICE_ACCOUNT_JSON) {
    throw new Error("FIREBASE_SERVICE_ACCOUNT_JSON is not set");
  }
  if (!process.env.FIREBASE_DATABASE_URL) {
    throw new Error("FIREBASE_DATABASE_URL is not set");
  }

  const serviceAccount = JSON.parse(
    process.env.FIREBASE_SERVICE_ACCOUNT_JSON
  );

  admin.initializeApp({
    credential: admin.credential.cert(serviceAccount),
    databaseURL: process.env.FIREBASE_DATABASE_URL,
  });
}

const db = admin.database();

// ===============================
// Express setup
// ===============================
const app = express();
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());

// ===============================
// Simple admin auth (unchanged)
// ===============================
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

  if (req.cookies && req.cookies.auth === ADMIN_PASSWORD) {
    return next();
  }
  return res.redirect("/login");
}

// ===============================
// Routes
// ===============================
app.get("/login", (req, res) => {
  res.send(`
    <form method="POST" action="/login">
      <h2>Admin Login</h2>
      <input name="password" type="password" placeholder="Password" />
      <button type="submit">Login</button>
    </form>
  `);
});

app.post("/login", (req, res) => {
  if (req.body.password === ADMIN_PASSWORD) {
    res.cookie("auth", ADMIN_PASSWORD, { httpOnly: true });
    return res.redirect("/");
  }
  return res.send("Invalid password");
});

app.get("/logout", (req, res) => {
  res.clearCookie("auth");
  res.redirect("/login");
});

app.use(requireAuth);

// ===============================
// Admin dashboard
// ===============================
app.get("/", (req, res) => {
  res.send(`
    <h1>NepaliAttendance Admin</h1>
    <ul>
      <li><a href="/admin/create-tenant">Create Tenant Code</a></li>
      <li><a href="/logout">Logout</a></li>
    </ul>
  `);
});

// ===============================
// Tenant code creation
// ===============================
app.get("/admin/create-tenant", (req, res) => {
  res.send(`
    <form method="POST" action="/admin/create-tenant">
      <h3>Create Tenant Code</h3>
      <input name="schoolName" placeholder="School Name" /><br/>
      <input name="schoolAddress" placeholder="School Address" /><br/>
      <button type="submit">Create</button>
    </form>
  `);
});

app.post("/admin/create-tenant", async (req, res) => {
  const { schoolName, schoolAddress } = req.body;
  if (!schoolName) return res.send("School name required");

  const code = crypto.randomBytes(3).toString("hex").toUpperCase();
  const tenantId = crypto.randomUUID();

  await db.ref(`tenant_codes/${code}`).set({
    tenantId,
    schoolName,
    schoolAddress: schoolAddress || "",
    createdAt: Date.now(),
  });

  res.send(`
    <p>Tenant Code: <b>${code}</b></p>
    <p>Tenant ID: ${tenantId}</p>
    <a href="/">Back</a>
  `);
});

// ===============================
// Premium License Activation (B1)
// ===============================
app.post("/api/license/activate", async (req, res) => {
  try {
    const { tenantId, deviceId, licenseKey } = req.body || {};
    if (!tenantId || !deviceId || !licenseKey) {
      return res.status(400).send("Missing tenantId, deviceId, or licenseKey");
    }

    const licRef = db.ref(`licenses/${String(licenseKey).trim()}`);
    const licSnap = await licRef.get();
    if (!licSnap.exists()) return res.status(404).send("Invalid license key");

    const lic = licSnap.val();
    if (!lic.active) return res.status(403).send("License is not active");

    // Bind license to tenant on first activation
    if (lic.tenantId && String(lic.tenantId) !== String(tenantId)) {
      return res.status(403).send("License belongs to a different tenant");
    }
    if (!lic.tenantId) {
      await licRef.child("tenantId").set(String(tenantId));
    }

    const maxDevices = Number(lic.maxDevices || 1);
    const usedRef = licRef.child("usedDevices");
    const usedSnap = await usedRef.get();
    const used = usedSnap.val() || {};

    if (!used[deviceId] && Object.keys(used).length >= maxDevices) {
      return res.status(403).send("Device limit reached");
    }

    if (!used[deviceId]) {
      await usedRef.child(deviceId).set({ activatedAt: Date.now() });
    }

    const entitlement = {
      premium: true,
      plan: "premium",
      expiresAt: lic.expiresAt ?? null,
      lastVerifiedAt: Date.now(),
    };

    await db.ref(`entitlements/${tenantId}/${deviceId}`).set(entitlement);
    return res.json(entitlement);
  } catch (e) {
    return res.status(500).send(e?.message || "Server error");
  }
});

// ===============================
// Start server (Render-compatible)
// ===============================
const PORT = process.env.PORT || 3001;
app.listen(PORT, "0.0.0.0", () => {
  console.log(`Admin server running on port ${PORT}`);
});
