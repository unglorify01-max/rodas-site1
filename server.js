import express from "express";
import session from "express-session";
import Database from "better-sqlite3";
import dotenv from "dotenv";
import path from "path";
import { fileURLToPath } from "url";
import fs from "fs";

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3000;

const dbPath = path.join(__dirname, "data", "app.db");
fs.mkdirSync(path.dirname(dbPath), { recursive: true });
const db = new Database(dbPath);

// Tables
db.exec(`
CREATE TABLE IF NOT EXISTS contact_messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  email TEXT NOT NULL,
  message TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS site_content (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
`);

// Default content values
const upsertContent = db.prepare(`
INSERT INTO site_content (key, value) VALUES (?, ?)
ON CONFLICT(key) DO UPDATE SET value=excluded.value
`);
upsertContent.run("site_title", "Rodas Trial Consulting");

// Middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.use(
  session({
    secret: process.env.SESSION_SECRET || "dev-secret",
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
      sameSite: "lax",
      // secure: true, // turn on once you have HTTPS
    },
  })
);

// Serve static files
app.use(express.static(path.join(__dirname, "public")));
app.use("/admin", express.static(path.join(__dirname, "admin")));

// Auth helper
function requireAdmin(req, res, next) {
  if (req.session?.isAdmin) return next();
  return res.status(401).json({ error: "Not logged in" });
}

/* -------------------------
   CONTENT API
--------------------------*/
app.get("/api/content", (req, res) => {
  const rows = db.prepare("SELECT key, value FROM site_content").all();
  const content = Object.fromEntries(rows.map((r) => [r.key, r.value]));
  res.json(content);
});

app.post("/api/content", requireAdmin, (req, res) => {
  const { site_title } = req.body;
  if (typeof site_title !== "string" || !site_title.trim()) {
    return res.status(400).json({ error: "Invalid site_title" });
  }
  upsertContent.run("site_title", site_title.trim());
  res.json({ ok: true });
});

/* -------------------------
   CONTACT FORM API
--------------------------*/
app.post("/api/contact", (req, res) => {
  const name = (req.body.name || "").trim();
  const email = (req.body.email || "").trim();
  const message = (req.body.message || "").trim();

  if (!name || !email || !message) {
    return res.status(400).json({ error: "Missing fields" });
  }

  db.prepare(
    `INSERT INTO contact_messages (name, email, message, created_at)
     VALUES (?, ?, ?, ?)`
  ).run(name, email, message, new Date().toISOString());

  res.json({ ok: true });
});

// Admin: view messages
app.get("/api/admin/messages", requireAdmin, (req, res) => {
  const msgs = db
    .prepare("SELECT * FROM contact_messages ORDER BY id DESC LIMIT 200")
    .all();
  res.json(msgs);
});

/* -------------------------
   ADMIN AUTH
--------------------------*/
app.post("/api/admin/login", (req, res) => {
  const { username, password } = req.body;
  if (username === process.env.ADMIN_USER && password === process.env.ADMIN_PASS) {
    req.session.isAdmin = true;
    return res.json({ ok: true });
  }
  res.status(401).json({ error: "Invalid login" });
});

app.post("/api/admin/logout", (req, res) => {
  req.session.destroy(() => res.json({ ok: true }));
});

app.listen(PORT, () => {
  console.log(`Running: http://localhost:${PORT}`);
});
