"use strict";
const express = require("express"), cors = require("cors"), crypto = require("crypto"), fs = require("fs"), path = require("path");
const PORT = process.env.PORT || 3000;
const ORIGIN = process.env.ALLOW_ORIGIN || "https://celebrated-panda-731718.netlify.app";
const DATA = process.env.DATA_FILE || path.join(__dirname, "data.json");
const SID = process.env.TWILIO_SID, TOK = process.env.TWILIO_TOKEN, VER = process.env.TWILIO_VERIFY_SID;
const DEV = process.env.DEV_OTP === "1";

/* ---------- تخزين بسيط في ملف ---------- */
let db = { accounts: {}, keys: {}, msgs: {}, tokens: {} };
try { db = Object.assign(db, JSON.parse(fs.readFileSync(DATA, "utf8"))); } catch (e) {}
let timer = null;
function save() {
  clearTimeout(timer);
  timer = setTimeout(() => { const tmp = DATA + ".tmp"; fs.writeFileSync(tmp, JSON.stringify(db)); fs.renameSync(tmp, DATA); }, 300);
}

/* ---------- حماية من الإغراق ---------- */
const hits = new Map();
function hit(key, max, ms) {
  const n = Date.now(), a = (hits.get(key) || []).filter(x => n - x < ms);
  if (a.length >= max) return false;
  a.push(n); hits.set(key, a); return true;
}
setInterval(() => hits.clear(), 3600e3).unref();
const ipLimit = (name, max, ms) => (req, res, next) =>
  hit(name + ":" + req.ip, max, ms) ? next() : res.status(429).json({ error: "too_many" });

/* ---------- أدوات ---------- */
const localPhone = p => String(p || "").replace(/\D/g, "");
const validPhone = p => /^0[567]\d{8}$/.test(p);
const e164 = p => "+213" + p.slice(1);
const validEmail = e => /^[^\s@]+@gmail\.com$/i.test(e) && e.length <= 80;
const isHex32 = s => typeof s === "string" && /^[0-9a-f]{32}$/.test(s);
const str = (v, n) => String(v == null ? "" : v).slice(0, n);
const sha = s => crypto.createHash("sha256").update(s).digest("hex");

/* ---------- رمز SMS ---------- */
const devCodes = {};
async function twilio(pathName, body) {
  const r = await fetch("https://verify.twilio.com/v2/Services/" + VER + pathName, {
    method: "POST",
    headers: { Authorization: "Basic " + Buffer.from(SID + ":" + TOK).toString("base64"), "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(body)
  });
  return { ok: r.ok, j: await r.json().catch(() => ({})) };
}
async function sendCode(phone) {
  if (DEV) { const c = String(crypto.randomInt(100000, 999999)); devCodes[phone] = { c, exp: Date.now() + 600e3, tries: 0 }; console.log("[DEV] رمز", phone, "=", c); return true; }
  if (!SID || !TOK || !VER) throw new Error("twilio_not_configured");
  const r = await twilio("/Verifications", { To: e164(phone), Channel: "sms", Locale: "ar" });
  return r.ok;
}
async function checkCode(phone, code) {
  if (DEV) { const d = devCodes[phone]; if (!d || d.exp < Date.now() || ++d.tries > 5) return false; const ok = d.c === code; if (ok) delete devCodes[phone]; return ok; }
  const r = await twilio("/VerificationCheck", { To: e164(phone), Code: code });
  return r.ok && r.j.status === "approved";
}

/* ---------- التطبيق ---------- */
const app = express();
app.set("trust proxy", 1);
app.disable("x-powered-by");
app.use(cors({ origin: ORIGIN, methods: ["GET", "POST", "PUT"], allowedHeaders: ["Content-Type", "Authorization"] }));
app.use(express.json({ limit: "20kb" }));
app.use((req, res, next) => { res.set({ "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" }); next(); });

function auth(req, res, next) {
  const m = /^Bearer (.+)$/.exec(req.headers.authorization || "");
  const t = m && db.tokens[sha(m[1])];
  if (!t || t.exp < Date.now()) return res.sendStatus(401);
  req.phone = t.phone; next();
}
function optAuth(req, res, next) {
  const m = /^Bearer (.+)$/.exec(req.headers.authorization || "");
  const t = m && db.tokens[sha(m[1])];
  if (t && t.exp > Date.now()) req.phone = t.phone;
  next();
}

app.get("/", (req, res) => res.json({ ok: true }));

/* 1) طلب رمز SMS */
app.post("/auth/request", ipLimit("req", 20, 3600e3), async (req, res) => {
  const phone = localPhone(req.body.phone), email = str(req.body.email, 80).toLowerCase();
  if (!validPhone(phone) || !validEmail(email)) return res.status(400).json({ error: "bad_input" });
  if (!hit("ph:" + phone, 3, 600e3)) return res.status(429).json({ error: "too_many" });
  try { (await sendCode(phone)) ? res.json({ ok: true }) : res.status(502).json({ error: "sms_failed" }); }
  catch (e) { console.error(e.message); res.status(500).json({ error: "server" }); }
});

/* 2) تأكيد الرمز وإصدار توكن */
app.post("/auth/verify", ipLimit("ver", 30, 3600e3), async (req, res) => {
  const phone = localPhone(req.body.phone), email = str(req.body.email, 80).toLowerCase(), code = localPhone(req.body.code);
  if (!validPhone(phone) || !validEmail(email) || code.length < 4 || code.length > 8) return res.status(400).json({ error: "bad_input" });
  if (!hit("vp:" + phone, 8, 600e3)) return res.status(429).json({ error: "too_many" });
  try {
    if (!(await checkCode(phone, code))) return res.status(401).json({ error: "wrong_code" });
    const acc = db.accounts[phone] || (db.accounts[phone] = { phone });
    acc.email = email;
    const token = crypto.randomBytes(32).toString("hex");
    db.tokens[sha(token)] = { phone, exp: Date.now() + 90 * 864e5 };
    save(); res.json({ token });
  } catch (e) { console.error(e.message); res.status(500).json({ error: "server" }); }
});

/* مفاتيح التشفير العامة */
app.post("/keys", ipLimit("key", 60, 3600e3), optAuth, (req, res) => {
  const id = req.body.id, pub = req.body.pub;
  if (!isHex32(id) || !pub || pub.kty !== "EC" || pub.crv !== "P-256" || typeof pub.x !== "string" || typeof pub.y !== "string" || pub.x.length > 64 || pub.y.length > 64) return res.status(400).json({ error: "bad_input" });
  const clean = { kty: "EC", crv: "P-256", x: pub.x, y: pub.y, ext: true };
  const old = db.keys[id];
  if (old && JSON.stringify(old.pub) !== JSON.stringify(clean)) return res.status(409).json({ error: "key_exists" });
  const k = old || (db.keys[id] = { pub: clean });
  if (req.phone) {
    if (k.phone && k.phone !== req.phone) return res.status(409).json({ error: "key_bound" });
    k.phone = req.phone; (db.accounts[req.phone] = db.accounts[req.phone] || { phone: req.phone }).keyId = id;
  }
  save(); res.json({ ok: true });
});
app.get("/keys/:id", (req, res) => {
  const k = isHex32(req.params.id) && db.keys[req.params.id];
  k ? res.json({ pub: k.pub }) : res.sendStatus(404);
});

/* رسائل مشفرة: الخادم يرى نصًا مشفرًا فقط */
app.post("/msgs", ipLimit("msg", 120, 3600e3), (req, res) => {
  const { to, from, iv, ct } = req.body;
  if (!isHex32(to) || !isHex32(from) || !db.keys[to]) return res.status(400).json({ error: "bad_input" });
  if (typeof iv !== "string" || typeof ct !== "string" || iv.length > 32 || ct.length > 8192) return res.status(400).json({ error: "bad_input" });
  const q = db.msgs[to] || (db.msgs[to] = []);
  if (q.length >= 200) return res.status(429).json({ error: "inbox_full" });
  q.push({ from, iv, ct, t: Date.now() }); save(); res.json({ ok: true });
});
app.get("/msgs", ipLimit("poll", 1200, 3600e3), optAuth, (req, res) => {
  const to = req.query.to, k = isHex32(to) && db.keys[to];
  if (!k) return res.json([]);
  if (k.phone && k.phone !== req.phone) return res.sendStatus(401);   // صندوق الحرفي الموثَّق: لصاحبه فقط
  const list = db.msgs[to] || []; delete db.msgs[to]; if (list.length) save();
  res.json(list);
});

/* ملف الحرفي: لا يعدّله إلا صاحبه الموثَّق */
app.put("/me", auth, (req, res) => {
  const acc = db.accounts[req.phone], b = req.body || {};
  if (!acc) return res.sendStatus(404);
  const lat = +b.lat, lng = +b.lng, hasLoc = lat > 18 && lat < 38 && lng > -9 && lng < 12;
  acc.profile = {
    n: str(b.n, 60), c: str(b.c, 40), w: str(b.w, 40),
    p: Math.max(0, Math.min(1e7, +b.p || 0)), a: b.a ? 1 : 0,
    d: str(b.d, 300), hours: str(b.hours, 100), hide: b.hide ? 1 : 0,
    r: 0, j: 0, ph: req.phone, u: acc.keyId || ""
  };
  if (hasLoc) { acc.profile.lat = lat; acc.profile.lng = lng; }
  save(); res.json({ ok: true });
});
app.get("/pros", ipLimit("pros", 600, 3600e3), (req, res) => {
  res.json(Object.values(db.accounts).filter(a => a.profile && a.profile.n && a.profile.c).map(a => Object.assign({}, a.profile, { u: a.keyId || "" })));
});

app.listen(PORT, () => console.log("Herfi Lak server on :" + PORT + (DEV ? " (DEV_OTP)" : "")));
