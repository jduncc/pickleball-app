// Database schema, migration, and small data-access helpers shared by the
// rest of the server. This module owns the SQLite connection; nothing else
// should open its own.
import path from "path";
import fs from "fs";
import { fileURLToPath } from "url";
import Database from "better-sqlite3";
import { randomUUID, randomBytes } from "crypto";
import { initialState } from "./reducer.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, "data");
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

export const DB_PATH = path.join(DATA_DIR, "pickleball.db");
export const db = new Database(DB_PATH);
db.pragma("journal_mode = WAL");

/* ------------------------------ Schema ------------------------------- */
// Legacy single-tenant tables (current_state, session_history) are left in
// place untouched — they're not written to by the new code, but they stay
// on disk as a safety net and remain downloadable from /admin.
db.exec(`
  CREATE TABLE IF NOT EXISTS current_state (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    data TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS session_history (
    id TEXT PRIMARY KEY,
    ended_at INTEGER NOT NULL,
    mode TEXT,
    data TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    google_sub TEXT UNIQUE,
    email TEXT UNIQUE NOT NULL,
    name TEXT,
    is_allowed INTEGER NOT NULL DEFAULT 0,
    is_admin INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL,
    last_login_at INTEGER
  );

  CREATE TABLE IF NOT EXISTS sessions (
    id TEXT PRIMARY KEY,
    owner_user_id TEXT NOT NULL REFERENCES users(id),
    share_slug TEXT UNIQUE NOT NULL,
    title TEXT,
    mode TEXT,
    created_at INTEGER NOT NULL,
    ended_at INTEGER,
    state TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_sessions_owner ON sessions(owner_user_id);
  CREATE INDEX IF NOT EXISTS idx_sessions_slug ON sessions(share_slug);

  CREATE TABLE IF NOT EXISTS schema_meta (
    key TEXT PRIMARY KEY,
    value TEXT
  );

  -- Backs the express-session store (see auth.js's SqliteSessionStore) so a
  -- logged-in browser stays logged in across server restarts/redeploys —
  -- previously this lived only in memory and was lost on every restart.
  CREATE TABLE IF NOT EXISTS http_sessions (
    sid TEXT PRIMARY KEY,
    sess TEXT NOT NULL,
    expires_at INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_http_sessions_expires ON http_sessions(expires_at);
`);

/* --------------------------- Small helpers ---------------------------- */
function newShareSlug() {
  return randomBytes(18).toString("base64url"); // 24 chars, unguessable
}

function getMeta(key) {
  const row = db.prepare("SELECT value FROM schema_meta WHERE key = ?").get(key);
  return row ? row.value : null;
}

function setMeta(key, value) {
  db.prepare(
    `INSERT INTO schema_meta (key, value) VALUES (?, ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value`
  ).run(key, value);
}

/* ------------------------- Admin-email seeding ------------------------- */
// Runs on every startup, not just migration: keeps the configured admin
// emails upserted as allowed + admin without clobbering a real user row
// (google_sub, name) once that person has actually logged in once.
export function seedAdminEmails() {
  const emails = (process.env.ADMIN_EMAILS || "")
    .split(",")
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);
  for (const email of emails) {
    const existing = db.prepare("SELECT id FROM users WHERE email = ?").get(email);
    if (existing) {
      db.prepare("UPDATE users SET is_allowed = 1, is_admin = 1 WHERE id = ?").run(existing.id);
    } else {
      db.prepare(
        "INSERT INTO users (id, email, is_allowed, is_admin, created_at) VALUES (?, ?, 1, 1, ?)"
      ).run(randomUUID(), email, Date.now());
    }
  }
  return emails;
}

/* ----------------------------- Migration ------------------------------- */
// One-time, idempotent: imports the old single-tenant current_state (if it
// held an in-progress session) and every session_history row into the new
// per-user `sessions` table, owned by the first configured admin email.
// Guarded by schema_meta so it only ever runs once, even across restarts.
export function migrateLegacyData() {
  if (getMeta("migrated_v2") === "1") return { ran: false };

  const adminEmails = seedAdminEmails();
  if (adminEmails.length === 0) {
    console.warn(
      "[migrate] No ADMIN_EMAILS configured yet — skipping legacy data import for now. " +
      "It will run automatically on a later startup once ADMIN_EMAILS is set."
    );
    return { ran: false, reason: "no-admin-emails" };
  }

  const ownerEmail = adminEmails[0];
  const owner = db.prepare("SELECT id FROM users WHERE email = ?").get(ownerEmail);
  if (!owner) return { ran: false, reason: "owner-lookup-failed" };

  let imported = 0;

  const currentRow = db.prepare("SELECT data FROM current_state WHERE id = 1").get();
  if (currentRow) {
    try {
      const state = JSON.parse(currentRow.data);
      if (state && state.phase === "session") {
        db.prepare(
          `INSERT INTO sessions (id, owner_user_id, share_slug, title, mode, created_at, ended_at, state)
           VALUES (?, ?, ?, ?, ?, ?, NULL, ?)`
        ).run(randomUUID(), owner.id, newShareSlug(), "Migrated active session", state.mode || null, Date.now(), currentRow.data);
        imported++;
      }
    } catch (err) {
      console.error("[migrate] Failed to parse legacy current_state, skipping it", err);
    }
  }

  const historyRows = db.prepare("SELECT id, ended_at, mode, data FROM session_history").all();
  for (const row of historyRows) {
    db.prepare(
      `INSERT INTO sessions (id, owner_user_id, share_slug, title, mode, created_at, ended_at, state)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(randomUUID(), owner.id, newShareSlug(), "Migrated session", row.mode || null, row.ended_at, row.ended_at, row.data);
    imported++;
  }

  setMeta("migrated_v2", "1");
  console.log(`[migrate] Imported ${imported} legacy session(s) into user ${ownerEmail}'s account.`);
  return { ran: true, imported, ownerEmail };
}

/* ------------------------------ Users ---------------------------------- */
export function findUserByGoogleSub(sub) {
  return db.prepare("SELECT * FROM users WHERE google_sub = ?").get(sub);
}

export function findUserByEmail(email) {
  return db.prepare("SELECT * FROM users WHERE email = ?").get(email.toLowerCase());
}

export function findUserById(id) {
  return db.prepare("SELECT * FROM users WHERE id = ?").get(id);
}

// Called on every successful Google login. The email must already be
// allowed (checked by the caller before this runs) — this just attaches the
// google_sub/name to that row the first time, and bumps last_login_at.
export function attachGoogleIdentity({ email, sub, name }) {
  const user = findUserByEmail(email);
  if (!user) return null;
  db.prepare(
    "UPDATE users SET google_sub = COALESCE(google_sub, ?), name = COALESCE(?, name), last_login_at = ? WHERE id = ?"
  ).run(sub, name || null, Date.now(), user.id);
  return findUserById(user.id);
}

export function listUsers() {
  return db.prepare(
    `SELECT u.*, (SELECT COUNT(*) FROM sessions s WHERE s.owner_user_id = u.id) AS session_count
     FROM users u ORDER BY u.created_at ASC`
  ).all();
}

export function addAllowedUser(email) {
  const existing = findUserByEmail(email);
  if (existing) {
    db.prepare("UPDATE users SET is_allowed = 1 WHERE id = ?").run(existing.id);
    return findUserById(existing.id);
  }
  const id = randomUUID();
  db.prepare("INSERT INTO users (id, email, is_allowed, is_admin, created_at) VALUES (?, ?, 1, 0, ?)")
    .run(id, email.toLowerCase(), Date.now());
  return findUserById(id);
}

export function revokeUser(userId) {
  db.prepare("UPDATE users SET is_allowed = 0 WHERE id = ?").run(userId);
}

/* ----------------------------- Sessions --------------------------------- */
export function createSessionRow(ownerUserId, mode, title) {
  const id = randomUUID();
  const state = { ...initialState, mode: mode || "individual" };
  db.prepare(
    `INSERT INTO sessions (id, owner_user_id, share_slug, title, mode, created_at, ended_at, state)
     VALUES (?, ?, ?, ?, ?, ?, NULL, ?)`
  ).run(id, ownerUserId, newShareSlug(), title || null, state.mode, Date.now(), JSON.stringify(state));
  return getSessionById(id);
}

export function getSessionById(id) {
  return db.prepare("SELECT * FROM sessions WHERE id = ?").get(id);
}

export function getSessionBySlug(slug) {
  return db.prepare("SELECT * FROM sessions WHERE share_slug = ?").get(slug);
}

export function listSessionsForOwner(ownerUserId, limit = 200) {
  return db.prepare(
    "SELECT * FROM sessions WHERE owner_user_id = ? ORDER BY created_at DESC LIMIT ?"
  ).all(ownerUserId, limit);
}

export function saveSessionState(id, state) {
  db.prepare("UPDATE sessions SET state = ?, mode = ? WHERE id = ?")
    .run(JSON.stringify(state), state.mode || null, id);
}

export function endSessionRow(id) {
  db.prepare("UPDATE sessions SET ended_at = ? WHERE id = ?").run(Date.now(), id);
}

export function deleteSessionRow(id) {
  return db.prepare("DELETE FROM sessions WHERE id = ?").run(id);
}

/* -------------------------- HTTP session store -------------------------- */
// Plain CRUD against http_sessions — see auth.js's SqliteSessionStore for
// how express-session actually uses these.
export function getHttpSession(sid) {
  const row = db.prepare("SELECT sess, expires_at FROM http_sessions WHERE sid = ?").get(sid);
  if (!row) return null;
  if (row.expires_at < Date.now()) {
    db.prepare("DELETE FROM http_sessions WHERE sid = ?").run(sid);
    return null;
  }
  return row.sess;
}

export function setHttpSession(sid, sessJson, expiresAt) {
  db.prepare(
    `INSERT INTO http_sessions (sid, sess, expires_at) VALUES (?, ?, ?)
     ON CONFLICT(sid) DO UPDATE SET sess = excluded.sess, expires_at = excluded.expires_at`
  ).run(sid, sessJson, expiresAt);
}

export function touchHttpSessionExpiry(sid, expiresAt) {
  db.prepare("UPDATE http_sessions SET expires_at = ? WHERE sid = ?").run(expiresAt, sid);
}

export function destroyHttpSession(sid) {
  db.prepare("DELETE FROM http_sessions WHERE sid = ?").run(sid);
}

export function pruneExpiredHttpSessions() {
  db.prepare("DELETE FROM http_sessions WHERE expires_at < ?").run(Date.now());
}

export function overallStats() {
  const userCount = db.prepare("SELECT COUNT(*) AS c FROM users WHERE is_allowed = 1").get().c;
  const sessionCount = db.prepare("SELECT COUNT(*) AS c FROM sessions").get().c;
  const activeSessionCount = db.prepare("SELECT COUNT(*) AS c FROM sessions WHERE ended_at IS NULL").get().c;
  let dbSizeBytes = 0;
  try { dbSizeBytes = fs.statSync(DB_PATH).size; } catch { /* ignore */ }
  return { userCount, sessionCount, activeSessionCount, dbSizeBytes };
}
