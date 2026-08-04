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

const db = new Database(path.join(DATA_DIR, "pickleball.db"));
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
    try { return JSON.parse(row.data); } catch { return { ...initialState }; }
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

function getHistory() {
  return db.prepare("SELECT id, ended_at, mode, data FROM session_history ORDER BY ended_at DESC LIMIT 25")
    .all()
    .map((r) => ({ id: r.id, endedAt: r.ended_at, mode: r.mode, state: JSON.parse(r.data) }));
}

let state = loadState();

const app = express();
app.use(express.static(path.join(__dirname, "public")));
app.get("/health", (req, res) => res.json({ ok: true }));

const httpServer = createServer(app);
const io = new Server(httpServer, { cors: { origin: "*" } });

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
