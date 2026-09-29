// Appointment booking app — server
// Clients book on the public page; the owner gets a WhatsApp message for every booking.
const express = require("express");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const PORT = process.env.PORT || 3000;
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || "change-me";
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, "data");
const DATA_FILE = path.join(DATA_DIR, "data.json");
const APPT_MINUTES = 60; // every appointment is 1 hour, offered on the hour
const SECRET = crypto.createHash("sha256").update("appt:" + ADMIN_PASSWORD + ":" + (process.env.SESSION_SECRET || "")).digest("hex");

if (ADMIN_PASSWORD === "change-me") console.warn("WARNING: set the ADMIN_PASSWORD environment variable before going live.");

/* ---------------- Storage (one JSON file, safe writes) ---------------- */
const DEFAULT_DATA = {
  settings: {
    businessName: "",
    tagline: "",
    providerName: "",
    address: "",
    phone: "",
    brandColor: "#0F7C77",
    timezone: "America/Santo_Domingo",
    whatsappNumber: "",          // owner's WhatsApp, with country code, e.g. +18095550100
    callmebotKey: "",            // API key from CallMeBot
    settingsVersion: 2,
    samplesCleared: true,
    slotStep: 60,                // one start time per hour
    leadMinutes: 120,            // earliest booking = now + this
    horizonDays: 30,             // how far ahead clients can book
    breakStart: "",              // optional break, e.g. "12:00" to "13:00"
    breakEnd: "",
    // 0 = Sunday ... 6 = Saturday. null = closed. [first start, closing time]: 08:00–16:00 gives 8 AM, 9 AM ... 3 PM.
    hours: { 0: null, 1: ["08:00", "16:00"], 2: ["08:00", "16:00"], 3: ["08:00", "16:00"], 4: ["08:00", "16:00"], 5: ["08:00", "16:00"], 6: ["08:00", "16:00"] },
    closedDates: [],             // ["2026-12-25", ...]
    services: [],                // added by the owner in Settings
    policy: ""
  },
  appointments: []
};

function load() {
  try {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    if (!fs.existsSync(DATA_FILE)) { fs.writeFileSync(DATA_FILE, JSON.stringify(DEFAULT_DATA, null, 2)); }
    const d = JSON.parse(fs.readFileSync(DATA_FILE, "utf8"));
    const needsSampleCleanup = !(d.settings && d.settings.samplesCleared);
    if (!d.settings || d.settings.settingsVersion !== 2) {
      // Upgrade older data to the 1-hour schedule (keeps business info and appointments)
      const keep = d.settings || {};
      d.settings = { ...DEFAULT_DATA.settings, ...keep, settingsVersion: 2, slotStep: 60, breakStart: "", breakEnd: "", hours: DEFAULT_DATA.settings.hours };
    }
    d.settings = { ...DEFAULT_DATA.settings, ...d.settings, slotStep: 60 };
    if (needsSampleCleanup) {
      // Remove the example content shipped with earlier versions; keep anything the owner typed.
      const SAMPLE = { businessName: "Clínica Dental Sonrisa", tagline: "Reserve su cita en línea · Book your appointment online", providerName: "Dra. Ana Rosario",
        address: "Av. Juan Pablo Duarte 112, Santiago, República Dominicana", phone: "+1 809 555 0100",
        policy: "Llegue 10 minutos antes. Traiga su cédula y carnet del seguro. Cancele con 24 horas de anticipación." };
      for (const k in SAMPLE) if (d.settings[k] === SAMPLE[k]) d.settings[k] = "";
      const sampleSvc = ["Consulta / Evaluación", "Limpieza dental", "Emergencia / Dolor", "Seguimiento"];
      d.settings.services = (d.settings.services || []).filter((x) => !sampleSvc.includes(x.name));
      d.settings.samplesCleared = true;
    }
    d.settings.services = (d.settings.services || []).map((x) => ({ ...x, minutes: APPT_MINUTES }));
    d.appointments = d.appointments || [];
    return d;
  } catch (e) {
    console.error("Could not read data file, starting fresh:", e.message);
    return JSON.parse(JSON.stringify(DEFAULT_DATA));
  }
}
let DB = load();
let writing = Promise.resolve();
function save() {
  const snapshot = JSON.stringify(DB, null, 2);
  writing = writing.then(() => new Promise((resolve) => {
    const tmp = DATA_FILE + ".tmp";
    fs.writeFile(tmp, snapshot, (err) => {
      if (err) { console.error("Save failed:", err.message); return resolve(); }
      fs.rename(tmp, DATA_FILE, (err2) => { if (err2) console.error("Save failed:", err2.message); resolve(); });
    });
  }));
  return writing;
}

/* ---------------- Time helpers (business time zone) ---------------- */
const pad = (n) => String(n).padStart(2, "0");
const toMin = (t) => { const [h, m] = t.split(":").map(Number); return h * 60 + m; };
const toHHMM = (m) => pad(Math.floor(m / 60)) + ":" + pad(m % 60);
const isDate = (s) => /^\d{4}-\d{2}-\d{2}$/.test(s);
const isTime = (s) => /^\d{2}:\d{2}$/.test(s);
function nowIn(tz) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false }).formatToParts(new Date()).map((p) => [p.type, p.value]));
  const hour = parts.hour === "24" ? "00" : parts.hour;
  return { date: `${parts.year}-${parts.month}-${parts.day}`, minutes: Number(hour) * 60 + Number(parts.minute) };
}
function weekday(date) { const [y, m, d] = date.split("-").map(Number); return new Date(Date.UTC(y, m - 1, d)).getUTCDay(); }
function addDays(date, n) { const [y, m, d] = date.split("-").map(Number); const x = new Date(Date.UTC(y, m - 1, d + n)); return `${x.getUTCFullYear()}-${pad(x.getUTCMonth() + 1)}-${pad(x.getUTCDate())}`; }
function fmt12(t) { let [h, m] = t.split(":").map(Number); const ap = h >= 12 ? "PM" : "AM"; h = h % 12 || 12; return `${h}:${pad(m)} ${ap}`; }
function fmtDateEs(date) {
  const [y, m, d] = date.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString("es-DO", { weekday: "long", day: "numeric", month: "long", timeZone: "UTC" });
}

function freeSlots(date) {
  const minutes = APPT_MINUTES;
  const s = DB.settings;
  const now = nowIn(s.timezone);
  if (!isDate(date) || date < now.date || date > addDays(now.date, s.horizonDays)) return [];
  if ((s.closedDates || []).includes(date)) return [];
  const h = s.hours[weekday(date)];
  if (!h) return [];
  const start = toMin(h[0]), end = toMin(h[1]);
  const busy = DB.appointments.filter((a) => a.date === date && a.status !== "cancelled").map((a) => [toMin(a.time), toMin(a.time) + a.minutes]);
  if (s.breakStart && s.breakEnd) busy.push([toMin(s.breakStart), toMin(s.breakEnd)]);
  const minStart = date === now.date ? now.minutes + Number(s.leadMinutes || 0) : -1;
  const out = [];
  for (let t = start; t + minutes <= end; t += APPT_MINUTES) {
    if (t < minStart) continue;
    if (busy.some(([b0, b1]) => t < b1 && t + minutes > b0)) continue;
    out.push(toHHMM(t));
  }
  return out;
}

/* ---------------- WhatsApp (CallMeBot) ---------------- */
async function notifyOwner(text) {
  const s = DB.settings;
  if (!s.whatsappNumber || !s.callmebotKey) return { sent: false, reason: "WhatsApp is not set up yet (Settings → WhatsApp alerts)." };
  const phone = s.whatsappNumber.replace(/[^\d+]/g, "");
  const url = `https://api.callmebot.com/whatsapp.php?phone=${encodeURIComponent(phone)}&text=${encodeURIComponent(text)}&apikey=${encodeURIComponent(s.callmebotKey)}`;
  try {
    const ctrl = new AbortController(); const timer = setTimeout(() => ctrl.abort(), 15000);
    const r = await fetch(url, { signal: ctrl.signal }); clearTimeout(timer);
    const body = (await r.text()).replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
    const failed = !r.ok || /APIKey is invalid|not valid|error/i.test(body);
    if (failed) console.error("WhatsApp alert failed:", r.status, body.slice(0, 200));
    return { sent: !failed, reason: failed ? `WhatsApp service said: ${body.slice(0, 160) || r.status}` : "" };
  } catch (e) {
    console.error("WhatsApp alert failed:", e.message);
    return { sent: false, reason: "Could not reach the WhatsApp service." };
  }
}
function bookingMessage(a, kind) {
  const s = DB.settings;
  const title = kind === "cancel" ? "❌ CITA CANCELADA / CANCELLED" : "📅 NUEVA CITA / NEW BOOKING";
  return [
    title,
    s.businessName || null,
    ``,
    `👤 ${a.name}`,
    `📞 ${a.phone}`,
    a.email ? `✉️ ${a.email}` : null,
    `🩺 ${a.serviceName} (${a.minutes} min)`,
    `🗓️ ${fmtDateEs(a.date)} · ${fmt12(a.time)}`,
    a.visitType ? `• ${a.visitType}` : null,
    a.insurance ? `• Seguro: ${a.insurance}` : null,
    a.notes ? `📝 ${a.notes}` : null,
    ``,
    `Ref: ${a.ref}`
  ].filter((x) => x !== null).join("\n");
}

/* ---------------- App ---------------- */
const app = express();
app.set("trust proxy", 1);
app.use(express.json({ limit: "100kb" }));
app.use((req, res, next) => { res.set("X-Content-Type-Options", "nosniff"); res.set("Referrer-Policy", "same-origin"); next(); });

// Simple rate limit for public writes (per IP)
const hits = new Map();
function limit(max, windowMs) {
  return (req, res, next) => {
    const key = req.ip + req.path; const now = Date.now();
    const arr = (hits.get(key) || []).filter((t) => now - t < windowMs);
    if (arr.length >= max) return res.status(429).json({ error: "Too many attempts. Please wait a few minutes and try again." });
    arr.push(now); hits.set(key, arr); next();
  };
}

const clean = (v, max = 200) => String(v ?? "").replace(/[\u0000-\u001f]/g, " ").trim().slice(0, max);
function newRef() {
  const a = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; let r;
  do { r = "C-" + Array.from(crypto.randomBytes(5)).map((b) => a[b % a.length]).join(""); } while (DB.appointments.some((x) => x.ref === r));
  return r;
}
function publicSettings() {
  const { callmebotKey, ...rest } = DB.settings;
  return { ...rest, whatsappReady: !!(DB.settings.whatsappNumber && DB.settings.callmebotKey), whatsappNumber: DB.settings.whatsappNumber, today: nowIn(DB.settings.timezone).date };
}

/* ---- Public API ---- */
app.get("/api/public/config", (req, res) => res.json(publicSettings()));

app.get("/api/public/availability", (req, res) => {
  const svc = DB.settings.services.find((x) => x.id === req.query.serviceId);
  if (!svc) return res.status(400).json({ error: "Choose a service first." });
  const today = nowIn(DB.settings.timezone).date; const days = [];
  for (let i = 0; i <= DB.settings.horizonDays; i++) { const d = addDays(today, i); days.push({ date: d, open: freeSlots(d).length }); }
  res.json({ days });
});

app.get("/api/public/slots", (req, res) => {
  const svc = DB.settings.services.find((x) => x.id === req.query.serviceId);
  if (!svc) return res.status(400).json({ error: "Choose a service first." });
  res.json({ date: req.query.date, slots: freeSlots(String(req.query.date || "")) });
});

app.post("/api/public/book", limit(8, 60 * 60 * 1000), async (req, res) => {
  const b = req.body || {};
  if (b.website) return res.json({ ok: true, ref: "C-OK" }); // spam trap (hidden field)
  const svc = DB.settings.services.find((x) => x.id === b.serviceId);
  const name = clean(b.name, 80), phone = clean(b.phone, 30), email = clean(b.email, 120), notes = clean(b.notes, 500);
  const errors = {};
  if (!svc) errors.service = "Choose a service.";
  if (!isDate(b.date) || !isTime(b.time)) errors.time = "Choose a date and time.";
  if (name.length < 3) errors.name = "Enter your full name.";
  if (phone.replace(/\D/g, "").length < 10) errors.phone = "Enter a phone number with at least 10 digits.";
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) errors.email = "Check the email address.";
  if (Object.keys(errors).length) return res.status(400).json({ error: "Please fix the highlighted fields.", errors });
  if (!freeSlots(b.date).includes(b.time)) return res.status(409).json({ error: "That time was just taken. Please choose another time." });

  const a = {
    ref: newRef(), serviceId: svc.id, serviceName: svc.name, minutes: APPT_MINUTES, price: svc.price || "",
    date: b.date, time: b.time, name, phone, email, notes,
    visitType: clean(b.visitType, 40), insurance: clean(b.insurance, 80), lang: b.lang === "en" ? "en" : "es",
    status: "booked", createdAt: new Date().toISOString(), whatsapp: null
  };
  DB.appointments.push(a); await save();
  const r = await notifyOwner(bookingMessage(a, "new"));
  a.whatsapp = r.sent ? "sent" : "failed"; await save();
  res.json({ ok: true, ref: a.ref, appointment: pub(a) });
});

function pub(a) { return { ref: a.ref, serviceName: a.serviceName, minutes: a.minutes, date: a.date, time: a.time, name: a.name, status: a.status }; }
function findByRefPhone(ref, phone) {
  const r = clean(ref, 20).toUpperCase(), p = String(phone || "").replace(/\D/g, "");
  return DB.appointments.find((x) => x.ref === r && x.phone.replace(/\D/g, "").slice(-7) === p.slice(-7) && p.length >= 7);
}
app.post("/api/public/lookup", limit(20, 60 * 60 * 1000), (req, res) => {
  const a = findByRefPhone(req.body.ref, req.body.phone);
  if (!a) return res.status(404).json({ error: "No appointment matches that reference and phone number." });
  res.json({ appointment: pub(a) });
});
app.post("/api/public/cancel", limit(10, 60 * 60 * 1000), async (req, res) => {
  const a = findByRefPhone(req.body.ref, req.body.phone);
  if (!a) return res.status(404).json({ error: "No appointment matches that reference and phone number." });
  if (a.status !== "booked" && a.status !== "confirmed") return res.status(400).json({ error: "This appointment can no longer be cancelled online. Please call us." });
  a.status = "cancelled"; a.cancelledBy = "client"; a.cancelledAt = new Date().toISOString(); await save();
  notifyOwner(bookingMessage(a, "cancel"));
  res.json({ appointment: pub(a) });
});

/* ---- Admin auth (cookie) ---- */
function sign(v) { return v + "." + crypto.createHmac("sha256", SECRET).update(v).digest("hex"); }
function readCookie(req, name) { const m = (req.headers.cookie || "").match(new RegExp("(?:^|; )" + name + "=([^;]+)")); return m ? decodeURIComponent(m[1]) : null; }
function isAdmin(req) {
  const c = readCookie(req, "admin"); if (!c) return false;
  const i = c.lastIndexOf("."); const v = c.slice(0, i);
  const good = sign(v);
  if (good.length !== c.length || !crypto.timingSafeEqual(Buffer.from(good), Buffer.from(c))) return false;
  return Number(v) > Date.now();
}
function requireAdmin(req, res, next) { if (!isAdmin(req)) return res.status(401).json({ error: "Please sign in." }); next(); }

app.post("/api/admin/login", limit(10, 15 * 60 * 1000), (req, res) => {
  const pw = String((req.body || {}).password || "");
  const a = crypto.createHash("sha256").update(pw).digest(), b = crypto.createHash("sha256").update(ADMIN_PASSWORD).digest();
  if (!crypto.timingSafeEqual(a, b)) return res.status(401).json({ error: "Wrong password." });
  const exp = String(Date.now() + 30 * 24 * 3600 * 1000);
  const secure = req.secure ? "; Secure" : "";
  res.set("Set-Cookie", `admin=${encodeURIComponent(sign(exp))}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${30 * 24 * 3600}${secure}`);
  res.json({ ok: true });
});
app.post("/api/admin/logout", (req, res) => { res.set("Set-Cookie", "admin=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0"); res.json({ ok: true }); });
app.get("/api/admin/me", (req, res) => res.json({ signedIn: isAdmin(req) }));

app.get("/api/admin/appointments", requireAdmin, (req, res) => {
  res.json({ today: nowIn(DB.settings.timezone).date, appointments: [...DB.appointments].sort((x, y) => (x.date + x.time).localeCompare(y.date + y.time)) });
});
app.patch("/api/admin/appointments/:ref", requireAdmin, async (req, res) => {
  const a = DB.appointments.find((x) => x.ref === req.params.ref);
  if (!a) return res.status(404).json({ error: "Appointment not found." });
  const allowed = ["booked", "confirmed", "completed", "no_show", "cancelled"];
  if (req.body.status && allowed.includes(req.body.status)) { a.status = req.body.status; a.updatedAt = new Date().toISOString(); }
  if (typeof req.body.adminNote === "string") a.adminNote = clean(req.body.adminNote, 500);
  await save(); res.json({ appointment: a });
});
app.delete("/api/admin/appointments/:ref", requireAdmin, async (req, res) => {
  const n = DB.appointments.length; DB.appointments = DB.appointments.filter((x) => x.ref !== req.params.ref);
  if (DB.appointments.length === n) return res.status(404).json({ error: "Appointment not found." });
  await save(); res.json({ ok: true });
});
// Owner adds a booking by hand (phone call / walk-in) — also blocks the time for online clients
app.post("/api/admin/appointments", requireAdmin, async (req, res) => {
  const b = req.body || {}; const svc = DB.settings.services.find((x) => x.id === b.serviceId);
  if (!svc || !isDate(b.date) || !isTime(b.time) || clean(b.name).length < 2) return res.status(400).json({ error: "Service, date, time and name are required." });
  const t0 = toMin(b.time);
  const clash = DB.appointments.find((x) => x.date === b.date && x.status !== "cancelled" && t0 < toMin(x.time) + x.minutes && t0 + APPT_MINUTES > toMin(x.time));
  if (clash) return res.status(409).json({ error: `That hour is already taken by ${clash.name} (${clash.time}).` });
  const a = { ref: newRef(), serviceId: svc.id, serviceName: svc.name, minutes: APPT_MINUTES, price: svc.price || "", date: b.date, time: b.time,
    name: clean(b.name, 80), phone: clean(b.phone, 30), email: "", notes: clean(b.notes, 500), visitType: "", insurance: "", lang: "es",
    status: "confirmed", createdAt: new Date().toISOString(), source: "admin", whatsapp: null };
  DB.appointments.push(a); await save(); res.json({ appointment: a });
});

app.get("/api/admin/settings", requireAdmin, (req, res) => res.json(DB.settings));
app.put("/api/admin/settings", requireAdmin, async (req, res) => {
  const b = req.body || {}; const s = DB.settings;
  for (const k of ["businessName", "tagline", "providerName", "address", "phone", "policy", "whatsappNumber", "callmebotKey", "timezone", "breakStart", "breakEnd"]) if (k in b) s[k] = clean(b[k], k === "policy" ? 600 : 160);
  if (/^#[0-9a-fA-F]{6}$/.test(b.brandColor || "")) s.brandColor = b.brandColor;
  for (const k of ["leadMinutes", "horizonDays"]) if (k in b && Number.isFinite(+b[k]) && +b[k] >= 0) s[k] = Math.min(+b[k], k === "horizonDays" ? 365 : 1440);
  if (b.hours && typeof b.hours === "object") {
    const h = {}; for (let d = 0; d < 7; d++) { const v = b.hours[d]; h[d] = Array.isArray(v) && isTime(v[0]) && isTime(v[1]) && v[0] < v[1] ? [v[0], v[1]] : null; } s.hours = h;
  }
  if (Array.isArray(b.closedDates)) s.closedDates = b.closedDates.filter(isDate).slice(0, 200);
  if (Array.isArray(b.services)) {
    const list = b.services.map((x) => ({ id: clean(x.id, 20) || "s" + crypto.randomBytes(3).toString("hex"), name: clean(x.name, 80), minutes: APPT_MINUTES, price: clean(x.price, 30) })).filter((x) => x.name);
    s.services = list;
  }
  if (s.timezone) { try { new Intl.DateTimeFormat("en", { timeZone: s.timezone }); } catch { s.timezone = "America/Santo_Domingo"; } }
  await save(); res.json(s);
});
app.post("/api/admin/test-whatsapp", requireAdmin, async (req, res) => {
  const r = await notifyOwner(`✅ ${DB.settings.businessName}: WhatsApp alerts are working. You will get a message like this for every new appointment.`);
  res.status(r.sent ? 200 : 400).json(r.sent ? { ok: true } : { error: r.reason });
});
app.get("/api/admin/export.csv", requireAdmin, (req, res) => {
  const cols = ["ref", "date", "time", "serviceName", "minutes", "name", "phone", "email", "visitType", "insurance", "notes", "status", "createdAt"];
  const q = (v) => `"${String(v ?? "").replace(/"/g, '""')}"`;
  const csv = [cols.join(","), ...DB.appointments.map((a) => cols.map((c) => q(a[c])).join(","))].join("\n");
  res.set("Content-Type", "text/csv; charset=utf-8"); res.set("Content-Disposition", "attachment; filename=appointments.csv"); res.send("﻿" + csv);
});

/* ---- Pages ---- */
app.use(express.static(path.join(__dirname, "public"), { extensions: ["html"] }));
app.get("/admin", (req, res) => res.sendFile(path.join(__dirname, "public", "admin.html")));
app.get("/health", (req, res) => res.json({ ok: true }));

app.listen(PORT, () => console.log(`Booking app running on port ${PORT}  →  booking page: /   owner dashboard: /admin`));
