import express from "express";
import cors from "cors";
import admin from "firebase-admin";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import cookieParser from "cookie-parser";
import crypto from "crypto";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// 1) Load service account key (keep private)
const serviceAccount = JSON.parse(fs.readFileSync("./serviceAccount.json", "utf8"));

// 2) Firebase Admin init (replace with your RTDB URL)
admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
  databaseURL: "https://nepaliattendance-b1dd0-default-rtdb.firebaseio.com",
});

const db = admin.database();
const app = express();
app.use(cors());

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());

// ✅ Change these!
const ADMIN_USER = "admin";
const ADMIN_PASS = "pass";

// In-memory sessions (local only)
const sessions = new Map(); // token -> { user, createdAt }
const COOKIE_NAME = "na_admin_session";

function isAuthed(req) {
  const token = req.cookies?.[COOKIE_NAME];
  return token && sessions.has(token);
}

function requireAuth(req, res, next) {
  // Allow access to login routes without auth
  if (req.path === "/login" || req.path === "/logout" || req.path === "/api/license/activate") return next();

  if (!isAuthed(req)) {
    return res.redirect("/login");
  }
  next();
}

// Protect everything except login/logout
app.use(requireAuth);

// Serve the HTML admin page
app.use(express.static(path.join(__dirname, "public")));

// ---------- Login UI ----------
app.get("/login", (req, res) => {
  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.end(`<!doctype html>
<html>
<head>
  <meta charset="utf-8"/>
  <meta name="viewport" content="width=device-width,initial-scale=1"/>
  <title>Login — NepaliAttendance Admin</title>
  <style>
    body { font-family: system-ui, -apple-system, Segoe UI, Roboto, Arial; background:#f6f7f9; margin:0; }
    .wrap { max-width: 420px; margin: 10vh auto; background:#fff; border:1px solid #e5e7eb; border-radius: 14px; padding: 16px; }
    h1 { font-size: 18px; margin: 0 0 10px; }
    label { display:block; font-size:12px; color:#6b7280; margin-top:10px; margin-bottom:6px; }
    input { width:100%; padding:10px 12px; border:1px solid #d1d5db; border-radius:12px; font-size:14px; }
    button { margin-top: 14px; width:100%; padding:10px 12px; border-radius:12px; border:1px solid #111827; background:#111827; color:#fff; cursor:pointer; }
    .muted { margin-top:10px; font-size:12px; color:#6b7280; }
    .err { color:#991b1b; font-size:13px; margin-top:8px; }
  </style>
</head>
<body>
  <div class="wrap">
    <h1>NepaliAttendance — Admin Login</h1>
    <form method="POST" action="/login">
      <label>Username</label>
      <input name="username" autocomplete="username" required />
      <label>Password</label>
      <input name="password" type="password" autocomplete="current-password" required />
      <button type="submit">Sign in</button>
    </form>
    ${req.query.err ? `<div class="err">Invalid credentials</div>` : ""}
    <div class="muted">Local-only admin tool. Keep your password private.</div>
  </div>
</body>
</html>`);
});

app.post("/login", (req, res) => {
  const u = String(req.body.username || "");
  const p = String(req.body.password || "");

  if (u !== ADMIN_USER || p !== ADMIN_PASS) {
    return res.redirect("/login?err=1");
  }

  const token = crypto.randomBytes(24).toString("hex");
  sessions.set(token, { user: u, createdAt: Date.now() });

  res.cookie(COOKIE_NAME, token, {
    httpOnly: true,
    sameSite: "lax",
  });

  return res.redirect("/");
});

app.get("/logout", (req, res) => {
  const token = req.cookies?.[COOKIE_NAME];
  if (token) sessions.delete(token);
  res.clearCookie(COOKIE_NAME);
  res.redirect("/login");
});

// ---------- Admin API ----------
function generateCode(prefix = "NPL") {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const block = (n) =>
    Array.from({ length: n }, () => chars[Math.floor(Math.random() * chars.length)]).join("");
  return `${prefix}-${block(4)}-${block(4)}`;
}

app.get("/admin/health", (req, res) => res.json({ ok: true }));

app.post("/admin/create-tenant-code", async (req, res) => {
  const { tenantId, schoolName, schoolAddress, features, codePrefix } = req.body;

  if (!tenantId || !schoolName) {
    return res.status(400).json({ ok: false, message: "tenantId and schoolName are required" });
  }

  const prefix =
    String(codePrefix || "NPL").trim().toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 6) || "NPL";

  let code = generateCode(prefix);
  for (let i = 0; i < 10; i++) {
    const snap = await db.ref(`tenant_codes/${code}`).get();
    if (!snap.exists()) break;
    code = generateCode(prefix);
  }

  const payload = {
    active: true,
    tenantId: String(tenantId),
    schoolName: String(schoolName),
    schoolAddress: schoolAddress ? String(schoolAddress) : "",
    features: {
      csvExportEnabled: !!features?.csvExportEnabled,
      smsAlertsEnabled: !!features?.smsAlertsEnabled,
    },
    createdAt: Date.now(),
  };

  await db.ref(`tenant_codes/${code}`).set(payload);
  return res.json({ ok: true, code, payload });
});

// Fallback to UI
app.use((req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

app.listen(3001, "0.0.0.0", () => {
  console.log("Local admin running at http://localhost:3001");
});
