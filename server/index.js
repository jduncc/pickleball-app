import express from "express";
import { createServer } from "http";
import { Server } from "socket.io";
import path from "path";
import fs from "fs";
import { fileURLToPath } from "url";
import Database from "better-sqlite3";
import { randomUUID } from "crypto";
import { reducer, initialState } from "./reducer.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, "data");
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

const DB_PATH = path.join(DATA_DIR, "pickleball.db");
const db = new Database(DB_PATH);
db.pragma("journal_mode = WAL");
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
`);

function loadState() {
  const row = db.prepare("SELECT data FROM current_state WHERE id = 1").get();
  if (row) {
    try {
      const parsed = JSON.parse(row.data);
      // Merge onto initialState so fields added in later versions of the app
      // (like courtNames) are backfilled for sessions saved by an older
      // version, instead of being missing and crashing the reducer.
      const merged = { ...initialState, ...parsed };
      // Keep courtNames in sync with courtCount for old data that predates
      // named courts (e.g. courtCount: 2 but no courtNames array at all).
      const courtNames = Array.isArray(merged.courtNames) ? [...merged.courtNames] : [];
      while (courtNames.length < merged.courtCount) courtNames.push(`Court ${courtNames.length + 1}`);
      merged.courtNames = courtNames;
      return merged;
    } catch {
      return { ...initialState };
    }
  }
  return { ...initialState };
}

function persistState(state) {
  db.prepare(
    `INSERT INTO current_state (id, data) VALUES (1, ?)
     ON CONFLICT(id) DO UPDATE SET data = excluded.data`
  ).run(JSON.stringify(state));
}

function archiveCurrent(state) {
  if (state.phase !== "session" || state.log.length === 0) return;
  db.prepare("INSERT INTO session_history (id, ended_at, mode, data) VALUES (?, ?, ?, ?)")
    .run(randomUUID(), Date.now(), state.mode, JSON.stringify(state));
}

function getHistoryList(limit) {
  return db.prepare("SELECT id, ended_at, mode, data FROM session_history ORDER BY ended_at DESC LIMIT ?")
    .all(limit)
    .map((r) => ({ id: r.id, endedAt: r.ended_at, mode: r.mode, state: JSON.parse(r.data) }));
}

function getHistory() {
  return getHistoryList(25);
}

function resetDatabase() {
  db.exec("DELETE FROM current_state; DELETE FROM session_history;");
  state = { ...initialState };
  persistState(state);
  io.emit("state", state);
  io.emit("history", []);
}

let state = loadState();

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));
app.get("/health", (req, res) => res.json({ ok: true }));

const httpServer = createServer(app);
const io = new Server(httpServer, { cors: { origin: "*" } });

/* ------------------------------ Admin ------------------------------- */
// Optional shared-secret protection. Set ADMIN_TOKEN in the environment to
// require it; if unset, the admin route is left open (fine on a private
// LAN/tailnet, but you should set a token if this box is reachable more
// broadly).
const ADMIN_TOKEN = process.env.ADMIN_TOKEN || "";
if (!ADMIN_TOKEN) {
  console.warn("[admin] ADMIN_TOKEN is not set — /admin is unprotected. Set ADMIN_TOKEN to require a token.");
}

function requireAdmin(req, res, next) {
  if (!ADMIN_TOKEN) return next();
  const supplied = req.get("x-admin-token") || req.query.token || "";
  if (supplied === ADMIN_TOKEN) return next();
  return res.status(401).json({ error: "Invalid or missing admin token" });
}

app.use("/admin", express.static(path.join(__dirname, "admin")));

app.get("/admin/api/status", requireAdmin, (req, res) => {
  let dbSizeBytes = 0;
  try { dbSizeBytes = fs.statSync(DB_PATH).size; } catch { /* ignore */ }
  const historyCount = db.prepare("SELECT COUNT(*) AS c FROM session_history").get().c;
  res.json({
    ok: true,
    tokenRequired: Boolean(ADMIN_TOKEN),
    dbSizeBytes,
    phase: state.phase,
    mode: state.mode,
    activeUnitCount: Object.keys(state.units).length,
    gamesInCurrentSession: state.log.length,
    archivedSessions: historyCount,
  });
});

app.get("/admin/api/db", requireAdmin, (req, res) => {
  try {
    db.pragma("wal_checkpoint(FULL)"); // flush WAL so the file on disk is complete
  } catch (err) {
    console.error("WAL checkpoint failed before export", err);
  }
  const dateStr = new Date().toISOString().slice(0, 10);
  res.download(DB_PATH, `pickleball-backup-${dateStr}.db`);
});

app.post("/admin/api/reset", requireAdmin, (req, res) => {
  try {
    resetDatabase();
    res.json({ ok: true });
  } catch (err) {
    console.error("Reset failed", err);
    res.status(500).json({ error: "Reset failed" });
  }
});

app.get("/admin/api/sessions", requireAdmin, (req, res) => {
  res.json({ ok: true, sessions: getHistoryList(200) });
});

app.delete("/admin/api/sessions/:id", requireAdmin, (req, res) => {
  try {
    const info = db.prepare("DELETE FROM session_history WHERE id = ?").run(req.params.id);
    if (info.changes === 0) return res.status(404).json({ error: "Session not found" });
    io.emit("history", getHistory()); // keep connected clients' "past sessions" lists in sync
    res.json({ ok: true });
  } catch (err) {
    console.error("Delete session failed", err);
    res.status(500).json({ error: "Delete failed" });
  }
});

io.on("connection", (socket) => {
  socket.emit("state", state);
  socket.emit("history", getHistory());

  socket.on("action", (action) => {
    if (!action || typeof action.type !== "string") return;
    try {
      if (action.type === "NEW_SESSION") archiveCurrent(state);
      const next = reducer(state, action);
      state = next;
      persistState(state);
      io.emit("state", state);
      if (action.type === "NEW_SESSION") io.emit("history", getHistory());
    } catch (err) {
      console.error("Failed to apply action", action.type, err);
    }
  });

  socket.on("request_history", () => socket.emit("history", getHistory()));
});

const PORT = process.env.PORT || 3000;
httpServer.listen(PORT, () => {
  console.log(`Pickleball round robin server listening on port ${PORT}`);
  console.log(`Data directory: ${DATA_DIR}`);
});
