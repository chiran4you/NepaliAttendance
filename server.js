// server.js (Render-ready + Modern Admin UI)
// Admin backend for NepaliAttendance
// - Tenant code creation (school info for AppHeader) in RTDB
// - License creation + activation API in RTDB
// - Admin UI served from / (after login)
// - Firebase Admin via ENV (no local serviceAccount.json)

import express from "express";
import dotenv from "dotenv";
import cookieParser from "cookie-parser";
import cors from "cors";
import admin from "firebase-admin";
import crypto from "crypto";
import path from "path";
import fs from "fs";
import { fileURLToPath } from "url";
import sqlite3 from "sqlite3";
import { open } from "sqlite";

dotenv.config();

// -------------------------------
// Firebase Admin Initialization
// -------------------------------
if (!admin.apps.length) {
  if (!process.env.FIREBASE_DATABASE_URL) {
    throw new Error("FIREBASE_DATABASE_URL is not set");
  }

  let serviceAccount;

  if (process.env.FIREBASE_SERVICE_ACCOUNT_JSON) {
    serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_JSON);
  } else if (process.env.GOOGLE_APPLICATION_CREDENTIALS) {
    const raw = fs.readFileSync(process.env.GOOGLE_APPLICATION_CREDENTIALS, "utf8");
    serviceAccount = JSON.parse(raw);
  } else {
    throw new Error("Set FIREBASE_SERVICE_ACCOUNT_JSON or GOOGLE_APPLICATION_CREDENTIALS");
  }

  admin.initializeApp({
    credential: admin.credential.cert(serviceAccount),
    databaseURL: process.env.FIREBASE_DATABASE_URL,
  });
}
const db = admin.database();


// -------------------------------
// SMS (VPS) local DB (Option A)
// Stores per-tenant SMS provider credentials locally to reduce RTDB traffic.
// -------------------------------
const SMS_DB_PATH = process.env.SMS_DB_PATH || path.join(process.cwd(), "data", "sms.db");
let smsDb;

async function initSmsDb() {
  // Ensure parent folder exists (best-effort)
  try {
    const fs = await import("fs");
    const dataDir = path.dirname(SMS_DB_PATH);
    if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });
  } catch {}

  smsDb = await open({ filename: SMS_DB_PATH, driver: sqlite3.Database });

  await smsDb.exec(`
    CREATE TABLE IF NOT EXISTS sms_tenants (
      tenantId TEXT PRIMARY KEY,
      provider TEXT NOT NULL DEFAULT 'aakash',
      authToken TEXT NOT NULL,
      senderId TEXT,
      enabled INTEGER NOT NULL DEFAULT 1,
      createdAt INTEGER NOT NULL,
      updatedAt INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS sms_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      tenantId TEXT NOT NULL,
      deviceId TEXT,
      toNumber TEXT NOT NULL,
      text TEXT NOT NULL,
      ok INTEGER NOT NULL,
      provider TEXT NOT NULL,
      providerResponse TEXT,
      error TEXT,
      createdAt INTEGER NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_sms_logs_tenant_createdAt ON sms_logs (tenantId, createdAt);
  `);
}

function toFormBody(obj) {
  const params = new URLSearchParams();
  Object.entries(obj).forEach(([k, v]) => {
    if (v === undefined || v === null) return;
    params.append(k, String(v));
  });
  return params.toString();
}

function normalizeNepalNumber(raw) {
  const n = String(raw || "").replace(/\s+/g, "");
  // Accept 10-digit numbers, optionally prefixed with +977 or 977
  if (/^\d{10}$/.test(n)) return n;
  if (/^\+977\d{10}$/.test(n)) return n.slice(4);
  if (/^977\d{10}$/.test(n)) return n.slice(3);
  return null;
}


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
const ADMIN_API_TOKEN = process.env.ADMIN_API_TOKEN || "";

function hasValidAdminToken(req) {
  if (!ADMIN_API_TOKEN) return false;
  const headerToken = String(req.headers["x-admin-token"] || "").trim();
  const auth = String(req.headers["authorization"] || "").trim();
  const bearer = auth.toLowerCase().startsWith("bearer ") ? auth.slice(7).trim() : "";
  return (headerToken && headerToken === ADMIN_API_TOKEN) || (bearer && bearer === ADMIN_API_TOKEN);
}


function requireAuth(req, res, next) {
  // Public routes
  if (
    req.path === "/login" ||
    req.path === "/logout" ||
    req.path === "/api/license/activate" ||
    req.path === "/api/sms/queueBatch"
  ) {
    return next();
  }

  // Allow public assets
  if (req.path.startsWith("/public/")) return next();

  if (req.cookies && req.cookies.auth === ADMIN_PASSWORD) return next();
  if (hasValidAdminToken(req)) return next();
  // For API clients, return 401 JSON instead of redirect
  const wantsJson = String(req.headers["accept"] || "").includes("application/json") || req.path.startsWith("/admin/sms/");
  if (wantsJson) return res.status(401).json({ error: "Unauthorized" });
  return res.redirect("/login");
}

// -------------------------------
// Login UI
// -------------------------------
const LOGIN_HTML_INLINE = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8"/>
  <meta name="viewport" content="width=device-width, initial-scale=1"/>
  <title>NepaliAttendance Admin - Login</title>
  <style>
    body{font-family:system-ui,-apple-system,Segoe UI,Roboto,Ubuntu,Cantarell,Noto Sans,sans-serif;background:#0b1220;color:#e5e7eb;margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;padding:24px;}
    .card{width:100%;max-width:420px;background:#111827;border:1px solid #1f2937;border-radius:14px;box-shadow:0 10px 30px rgba(0,0,0,.35);padding:22px;}
    h1{font-size:20px;margin:0 0 10px;}
    p{margin:0 0 18px;color:#9ca3af;font-size:13px;line-height:1.4;}
    label{display:block;font-size:12px;color:#cbd5e1;margin:0 0 6px;}
    input{width:100%;padding:12px 12px;border-radius:10px;border:1px solid #374151;background:#0b1220;color:#e5e7eb;outline:none;}
    input:focus{border-color:#60a5fa;box-shadow:0 0 0 3px rgba(96,165,250,.15)}
    button{width:100%;margin-top:12px;padding:12px;border-radius:10px;border:0;background:#2563eb;color:white;font-weight:600;cursor:pointer;}
    button:hover{background:#1d4ed8}
    .foot{margin-top:12px;color:#6b7280;font-size:12px;text-align:center;}
  </style>
</head>
<body>
  <div class="card">
    <h1>Admin Login</h1>
    <p>Enter your admin password to access tenant & license tools and SMS configuration.</p>
    <form method="POST" action="/login">
      <label>Password</label>
      <input type="password" name="password" placeholder="Admin password" autocomplete="current-password" required />
      <button type="submit">Login</button>
    </form>
    <div class="foot">NepaliAttendance VPS Admin</div>
  </div>
</body>
</html>`;

app.get("/login", (req, res) => {
  const loginPath = path.join(__dirname, "public", "login.html");
  if (fs.existsSync(loginPath)) return res.sendFile(loginPath);
  return res.status(200).type("html").send(LOGIN_HTML_INLINE);
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
const INDEX_HTML_INLINE = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8"/>
  <meta name="viewport" content="width=device-width, initial-scale=1"/>
  <title>NepaliAttendance Admin</title>
  <style>
    body{font-family:system-ui,-apple-system,Segoe UI,Roboto,Ubuntu,Cantarell,Noto Sans,sans-serif;background:#0b1220;color:#e5e7eb;margin:0;min-height:100vh;padding:24px;}
    .wrap{max-width:980px;margin:0 auto;}
    header{display:flex;align-items:center;justify-content:space-between;gap:12px;margin-bottom:18px;}
    h1{font-size:20px;margin:0;}
    a.btn{display:inline-block;padding:10px 12px;border-radius:10px;background:#111827;border:1px solid #1f2937;color:#e5e7eb;text-decoration:none;}
    a.btn:hover{border-color:#334155}
    .grid{display:grid;grid-template-columns:1fr;gap:14px;}
    @media(min-width:900px){.grid{grid-template-columns:1fr 1fr;}}
    .card{background:#111827;border:1px solid #1f2937;border-radius:14px;padding:16px;}
    .card h2{font-size:16px;margin:0 0 10px;}
    .row{display:flex;gap:10px;flex-wrap:wrap;}
    input{flex:1;min-width:200px;padding:10px;border-radius:10px;border:1px solid #374151;background:#0b1220;color:#e5e7eb;}
    button{padding:10px 12px;border-radius:10px;border:0;background:#2563eb;color:white;font-weight:600;cursor:pointer;}
    button:hover{background:#1d4ed8}
    .muted{color:#9ca3af;font-size:12px;line-height:1.4;}
    pre{background:#0b1220;border:1px solid #1f2937;border-radius:12px;padding:12px;overflow:auto;}
    code{color:#e5e7eb}
  </style>
</head>
<body>
  <div class="wrap">
    <header>
      <h1>NepaliAttendance Admin</h1>
      <a class="btn" href="/logout">Logout</a>
    </header>

    <div class="grid">
      <div class="card">
        <h2>SMS Tenant Config</h2>
        <div class="muted">This simple UI appears because <code>/public/index.html</code> is missing. It still lets you configure SMS.</div>
        <div class="row" style="margin-top:10px;">
          <input id="tenantId" placeholder="tenantId" />
          <input id="authToken" placeholder="Aakash auth token" />
        </div>
        <div class="row" style="margin-top:10px;">
          <input id="senderId" placeholder="senderId (optional)" />
          <button onclick="saveSms()">Save</button>
          <button onclick="loadSms()" style="background:#111827;border:1px solid #1f2937;">Refresh</button>
        </div>
        <pre id="smsOut" class="muted" style="margin-top:12px;">Click Refresh to load configs.</pre>
      </div>

      <div class="card">
        <h2>Quick Links</h2>
        <div class="muted">Your backend APIs are ready:</div>
        <pre class="muted">POST /api/license/activate
POST /api/sms/queueBatch
POST /admin/sms/save-tenant-config (requires login)
GET  /admin/sms/list-tenant-config</pre>
        <div class="muted">If you want the full modern UI, later upload real HTML files into <code>public/</code>.</div>
      </div>
    </div>
  </div>

<script>
  async function saveSms(){
    const tenantId = document.getElementById('tenantId').value.trim();
    const authToken = document.getElementById('authToken').value.trim();
    const senderId = document.getElementById('senderId').value.trim();
    const out = document.getElementById('smsOut');
    out.textContent = 'Saving...';
    const res = await fetch('/admin/sms/save-tenant-config', {
      method:'POST',
      headers:{'Content-Type':'application/json'},
      body: JSON.stringify({ tenantId, provider:'aakash', authToken, senderId, enabled:true })
    });
    const txt = await res.text();
    out.textContent = 'HTTP ' + res.status + "\n" + txt;
  }
  async function loadSms(){
    const out = document.getElementById('smsOut');
    out.textContent = 'Loading...';
    const res = await fetch('/admin/sms/list-tenant-config');
    const txt = await res.text();
    out.textContent = 'HTTP ' + res.status + "\n" + txt;
  }
  loadSms();
</script>
</body>
</html>`;

app.get("/", (req, res) => {
  const indexPath = path.join(__dirname, "public", "index.html");
  if (fs.existsSync(indexPath)) return res.sendFile(indexPath);
  return res.status(200).type("html").send(INDEX_HTML_INLINE);
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


app.post("/admin/delete-tenant-code", async (req, res) => {
  try {
    const code = String(req.body?.code || "").trim().toUpperCase();
    if (!code) return res.status(400).send("code required");

    await db.ref(`tenant_codes/${code}`).remove();
    return res.json({ ok: true });
  } catch (e) {
    return res.status(500).send(e?.message || "Server error");
  }
});

app.post("/admin/delete-license", async (req, res) => {
  try {
    const licenseKey = String(req.body?.licenseKey || "").trim();
    if (!licenseKey) return res.status(400).send("licenseKey required");

    await db.ref(`licenses/${licenseKey}`).remove();
    return res.json({ ok: true });
  } catch (e) {
    return res.status(500).send(e?.message || "Server error");
  }
});


// -------------------------------
// ADMIN API: SMS tenant config (Option A - stored on VPS)
// -------------------------------
app.post("/admin/sms/save-tenant-config", async (req, res) => {
  try {
    if (!smsDb) return res.status(500).send("SMS DB not initialized");
    const tenantId = String(req.body?.tenantId || "").trim();
    const provider = String(req.body?.provider || "aakash").trim() || "aakash";
    const authToken = String(req.body?.authToken || "").trim();
    const senderId = String(req.body?.senderId || "").trim() || null;
    const enabled = String(req.body?.enabled || "true") === "true";

    if (!tenantId) return res.status(400).send("tenantId required");
    if (!authToken) return res.status(400).send("authToken required");

    const ts = now();
    await smsDb.run(
      `
      INSERT INTO sms_tenants (tenantId, provider, authToken, senderId, enabled, createdAt, updatedAt)
      VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(tenantId) DO UPDATE SET
        provider=excluded.provider,
        authToken=excluded.authToken,
        senderId=excluded.senderId,
        enabled=excluded.enabled,
        updatedAt=excluded.updatedAt
      `,
      [tenantId, provider, authToken, senderId, enabled ? 1 : 0, ts, ts]
    );

    return res.json({ ok: true });
  } catch (e) {
    return res.status(500).send(e?.message || "Server error");
  }
});

app.get("/admin/sms/list-tenant-config", async (req, res) => {
  try {
    if (!smsDb) return res.status(500).send("SMS DB not initialized");
    const rows = await smsDb.all(
      "SELECT tenantId, provider, senderId, enabled, createdAt, updatedAt FROM sms_tenants ORDER BY updatedAt DESC"
    );
    return res.json({ ok: true, items: rows });
  } catch (e) {
    return res.status(500).send(e?.message || "Server error");
  }
});

app.post("/admin/sms/delete-tenant-config", async (req, res) => {
  try {
    if (!smsDb) return res.status(500).send("SMS DB not initialized");
    const tenantId = String(req.body?.tenantId || "").trim();
    if (!tenantId) return res.status(400).send("tenantId required");
    await smsDb.run("DELETE FROM sms_tenants WHERE tenantId = ?", [tenantId]);
    return res.json({ ok: true });
  } catch (e) {
    return res.status(500).send(e?.message || "Server error");
  }
});


// -------------------------------
// PUBLIC API: SMS queueBatch (Option A - VPS sends via tenant config)
// - App sends tenantId + deviceId + items[{to,text}]
// - Server looks up tenant's Aakash token in sms_tenants
// - Sends SMS via Aakash API and logs results in sms_logs
// -------------------------------
async function sendViaAakash(authToken, toNumber, text) {
  // Aakash examples show multipart (-F) with field name "token"
  // Some docs also reference "auth_token" — we send both for compatibility.
  const url = "https://sms.aakashsms.com/sms/v3/send/";

  const form = new FormData();
  form.append("token", authToken);
  form.append("auth_token", authToken);
  form.append("to", toNumber);
  form.append("text", text);

  const resp = await fetch(url, { method: "POST", body: form });
  const bodyText = await resp.text();
  let bodyJson = null;
  try { bodyJson = JSON.parse(bodyText); } catch {}
  return { ok: resp.ok, status: resp.status, bodyText, bodyJson };
}

app.post("/api/sms/queueBatch", async (req, res) => {
  try {
    if (!smsDb) return res.status(500).json({ error: "SMS DB not initialized" });

    const tenantId = String(req.body?.tenantId || "").trim();
    const deviceId = String(req.body?.deviceId || "").trim();
    const items = Array.isArray(req.body?.items) ? req.body.items : [];

    if (!tenantId) return res.status(400).json({ error: "tenantId required" });
    if (!items.length) return res.status(400).json({ error: "items required" });

    const tenant = await smsDb.get(
      "SELECT tenantId, provider, authToken, senderId, enabled FROM sms_tenants WHERE tenantId = ?",
      [tenantId]
    );
    if (!tenant) return res.status(403).json({ error: "SMS not configured for tenant" });
    if (!tenant.enabled) return res.status(403).json({ error: "SMS disabled for tenant" });

    const provider = String(tenant.provider || "aakash");
    const authToken = String(tenant.authToken || "").trim();
    if (!authToken) return res.status(403).json({ error: "Missing provider auth token" });

    const results = [];
    for (const it of items) {
      const rawTo = it?.to;
      const text = String(it?.text || "").trim();

      const toNumber = normalizeNepalNumber(rawTo);
      if (!toNumber) {
        results.push({ to: rawTo, ok: false, error: "Invalid phone number" });
        continue;
      }
      if (!text) {
        results.push({ to: toNumber, ok: false, error: "Empty text" });
        continue;
      }

      let ok = false;
      let providerResp = null
      let error = null
      try {
        if (provider === "aakash") {
          const r = await sendViaAakash(authToken, toNumber, text);
          ok = !!r.ok;
          providerResp = r.bodyText;
          if (!ok) error = `Provider error (${r.status})`;
        } else {
          ok = false;
          error = "Unsupported provider";
        }
      } catch (e) {
        ok = false;
        error = String(e?.message || e);
      }

      // Log
      try {
        await smsDb.run(
          `INSERT INTO sms_logs (tenantId, deviceId, toNumber, text, ok, provider, providerResponse, error, createdAt)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [tenantId, deviceId || null, toNumber, text, ok ? 1 : 0, provider, providerResp, error, now()]
        );
      } catch {}

      results.push({ to: toNumber, ok, error });
    }

    return res.json({ ok: true, results });
  } catch (e) {
    return res.status(500).json({ error: e?.message || "Server error" });
  }
});


// -------------------------------
// PUBLIC API: Premium License Activation (B1)
// -------------------------------
app.post("/api/license/activate", async (req, res) => {
  try {
    const tenantId = String(req.body?.tenantId || "").trim();
    const deviceId = String(req.body?.deviceId || "").trim();
    const licenseKeyRaw = String(req.body?.licenseKey || "").trim();
    const licenseKey = licenseKeyRaw.toUpperCase();

    if (!tenantId || !deviceId || !licenseKey) {
      return res.status(400).json({ ok: false, error: "Missing tenantId, deviceId, or licenseKey" });
    }

    // Basic format guard (matches NA-032C-24D3-5B3A)
    if (!/^NA-[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}$/.test(licenseKey)) {
      return res.status(400).json({ ok: false, error: "Invalid license code format" });
    }

    const licRef = db.ref(`licenses/${licenseKey}`);
    const licSnap = await licRef.get();
    if (!licSnap.exists()) return res.status(404).json({ ok: false, error: "Invalid license key" });

    const lic = licSnap.val();
    if (!lic?.active) return res.status(403).json({ ok: false, error: "License is not active" });

    // Validate expiry online too (offline expiry still handled by the app using expiresAt)
    const rawExpiresAt = lic?.expiresAt;
    const expiresAtNum =
      rawExpiresAt === null || rawExpiresAt === undefined ? null : Number(rawExpiresAt);
    const expiresAt = Number.isFinite(expiresAtNum) && expiresAtNum > 0 ? expiresAtNum : null;

    if (expiresAt !== null && now() > expiresAt) {
      return res.status(403).json({ ok: false, error: "License has expired", expiresAt });
    }

    // Validate tenant binding (DO NOT auto-bind to avoid abuse)
    if (!lic?.tenantId) {
      return res.status(403).json({ ok: false, error: "License is not bound to a tenant" });
    }
    if (String(lic.tenantId) !== tenantId) {
      return res.status(403).json({ ok: false, error: "License belongs to a different tenant" });
    }

    const maxDevicesNum = Number(lic.maxDevices || 1);
    const maxDevices = Number.isFinite(maxDevicesNum) && maxDevicesNum > 0 ? maxDevicesNum : 1;

    const usedRef = licRef.child("usedDevices");
    const usedSnap = await usedRef.get();
    const used = usedSnap.val() || {};

    if (!used[deviceId] && Object.keys(used).length >= maxDevices) {
      return res.status(403).json({
        ok: false,
        error: "Device limit reached",
        used: Object.keys(used).length,
        maxDevices,
      });
    }

    // Register device (idempotent)
    if (!used[deviceId]) {
      await usedRef.child(deviceId).set({ activatedAt: now() });
    }

    const entitlement = {
      ok: true,
      premium: true,
      plan: String(lic?.plan || "premium"),
      tenantId,
      deviceId,
      licenseKey,
      expiresAt, // epoch ms or null
      lastVerifiedAt: now(),
    };

    await db.ref(`entitlements/${tenantId}/${deviceId}`).set(entitlement);
    return res.json(entitlement);
  } catch (e) {
    return res.status(500).json({ ok: false, error: e?.message || "Server error" });
  }
});


// -------------------------------
// Start server (Render-compatible)
// -------------------------------
const PORT = process.env.PORT || 3001;

(async () => {
  await initSmsDb();

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Admin server running on port ${PORT}`);
  });
})();
