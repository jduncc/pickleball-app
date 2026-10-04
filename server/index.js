import express from "express";
import { createServer } from "http";
import { Server } from "socket.io";
import path from "path";
import fs from "fs";
import { fileURLToPath } from "url";
import { reducer, initialState } from "./reducer.js";
import passport from "passport";
import {
  db, DATA_DIR, DB_PATH, seedAdminEmails, migrateLegacyData, clearMigrationPlaceholderTitles,
  createSessionRow, getSessionById, getSessionBySlug, listSessionsForOwner,
  saveSessionState, endSessionRow, deleteSessionRow, overallStats,
  listUsers, addAllowedUser, revokeUser, findUserById,
} from "./db.js";
import { configurePassport, sessionMiddleware, requireLogin, requireAdmin as requireAdminAuth, PUBLIC_URL } from "./auth.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Seed configured admins and run the one-time legacy-data import (safe to
// call on every startup — both are no-ops once already done).
const seededAdmins = seedAdminEmails();
if (seededAdmins.length === 0) {
  console.warn("[startup] ADMIN_EMAILS is not set — no one can log in as admin yet, and legacy data import is on hold until it is.");
}
const migration = migrateLegacyData();
if (migration.ran) {
  console.log(`[startup] Legacy data migrated to ${migration.ownerEmail} (${migration.imported} session(s)).`);
}
const titleCleanup = clearMigrationPlaceholderTitles();
if (titleCleanup.ran && titleCleanup.cleared > 0) {
  console.log(`[startup] Cleared generic "Migrated session" title on ${titleCleanup.cleared} session(s) so the list can show the winner instead.`);
}

// Backfills fields added to the reducer's unit/court shape since a session
// row was last saved, so an old session loaded from disk doesn't crash the
// reducer. Applied per-session now (every row can be an arbitrarily old
// save), where it used to apply to the one singleton state.
function normalizeState(parsed) {
  const merged = { ...initialState, ...parsed };
  const courtNames = Array.isArray(merged.courtNames) ? [...merged.courtNames] : [];
  while (courtNames.length < merged.courtCount) courtNames.push(`Court ${courtNames.length + 1}`);
  merged.courtNames = courtNames;
  if (merged.units && typeof merged.units === "object") {
    const units = {};
    for (const [id, u] of Object.entries(merged.units)) {
      units[id] = {
        ...u,
        lastPlayedAt: typeof u.lastPlayedAt === "number" ? u.lastPlayedAt : 0,
        lastPlayedSeq: typeof u.lastPlayedSeq === "number" ? u.lastPlayedSeq : 0,
        missStreak: typeof u.missStreak === "number" ? u.missStreak : 0,
      };
    }
    merged.units = units;
  }
  return merged;
}

// Same ranking the client's standings tab uses (win % desc, point diff desc,
// points-for desc), so the top row here is exactly who the standings tab
// would call the winner. Returns null when there's no completed game to
// rank (e.g. a session ended before any score was entered).
function computeWinner(state) {
  const units = state && state.units ? Object.values(state.units) : [];
  const played = units.filter((u) => u.gamesPlayed > 0);
  if (played.length === 0) return null;
  played.sort((a, b) => {
    const aWinPct = a.wins / a.gamesPlayed, bWinPct = b.wins / b.gamesPlayed;
    if (bWinPct !== aWinPct) return bWinPct - aWinPct;
    const aDiff = a.pointsFor - a.pointsAgainst, bDiff = b.pointsFor - b.pointsAgainst;
    if (bDiff !== aDiff) return bDiff - aDiff;
    return b.pointsFor - a.pointsFor;
  });
  const top = played[0];
  return { name: top.name, wins: top.wins, losses: top.losses, diff: top.pointsFor - top.pointsAgainst };
}

/* --------------------------- Live session cache -------------------------- */
// Active sessions' reducer state lives in memory while in use (cheap, and
// avoids re-parsing JSON on every action) and is persisted to its row on
// every change. A session row not currently cached is loaded from disk on
// first touch. Ended sessions are evicted after their last write so this
// doesn't grow unbounded over a long server lifetime.
const liveSessions = new Map(); // sessionId -> reducer state

function loadLiveSession(sessionId) {
  if (liveSessions.has(sessionId)) return liveSessions.get(sessionId);
  const row = getSessionById(sessionId);
  if (!row) return null;
  let parsed;
  try { parsed = JSON.parse(row.state); } catch { parsed = { ...initialState }; }
  const state = normalizeState(parsed);
  liveSessions.set(sessionId, state);
  return state;
}

function persistLiveSession(sessionId, state) {
  liveSessions.set(sessionId, state);
  saveSessionState(sessionId, state);
}

const roomFor = (sessionId) => `session:${sessionId}`;

const app = express();
app.set("trust proxy", 1); // needed behind the Cloudflare Tunnel so secure cookies work
app.use(express.json());

configurePassport();
const sessionMw = sessionMiddleware();
app.use(sessionMw);
app.use(passport.initialize());
app.use(passport.session());

/* -------------------------------- Auth -------------------------------- */
app.get("/auth/google", passport.authenticate("google", { scope: ["profile", "email"] }));

app.get("/auth/google/callback", (req, res, next) => {
  passport.authenticate("google", (err, user, info) => {
    if (err) {
      console.error("[auth] Google callback error", err);
      return res.redirect("/?login=error");
    }
    if (!user) {
      return res.redirect(`/?login=denied&reason=${encodeURIComponent((info && info.message) || "unknown")}`);
    }
    req.logIn(user, (loginErr) => {
      if (loginErr) return next(loginErr);
      return res.redirect(user.is_admin ? "/admin" : "/app");
    });
  })(req, res, next);
});

app.get("/auth/logout", (req, res) => {
  req.logout(() => res.redirect("/"));
});

app.get("/api/me", (req, res) => {
  if (!(req.isAuthenticated && req.isAuthenticated())) {
    return res.json({ authenticated: false });
  }
  res.json({
    authenticated: true,
    email: req.user.email,
    name: req.user.name,
    isAdmin: Boolean(req.user.is_admin),
  });
});

// Defaults to this package's own version so the footer can't silently drift
// out of sync with a release — APP_VERSION only needs setting if you want
// to override that (e.g. a build/commit identifier instead).
const PACKAGE_VERSION = (() => {
  try { return JSON.parse(fs.readFileSync(path.join(__dirname, "package.json"), "utf8")).version; }
  catch { return "dev"; }
})();
app.get("/api/version", (req, res) => {
  res.json({
    version: process.env.APP_VERSION || PACKAGE_VERSION,
    // Set by the Docker build (see Dockerfile/CI) to the date the running
    // image was built. Null for a local, non-Docker run.
    buildDate: process.env.BUILD_DATE || null,
  });
});

// Test-only: logs in as an existing user by email, bypassing Google
// entirely, so integration tests can exercise real cookies/sessions without
// a live OAuth round-trip. Only mounted when TEST_AUTH_BYPASS=1 is set,
// which is never present in .env.example or docker-compose.yml — this must
// never be enabled in a real deployment.
if (process.env.TEST_AUTH_BYPASS === "1") {
  console.warn("[test] TEST_AUTH_BYPASS=1 — /__test/login is active. Never set this in production.");
  app.post("/__test/login", (req, res) => {
    const email = (req.body && req.body.email || "").toLowerCase();
    const user = db.prepare("SELECT * FROM users WHERE email = ?").get(email);
    if (!user) return res.status(404).json({ error: "no such user" });
    // Mirror the real allowlist check in auth.js's verifyGoogleProfile —
    // this bypass skips the Google round-trip, not the security boundary.
    if (!user.is_allowed) return res.status(403).json({ error: "not_allowed" });
    req.login(user, (err) => {
      if (err) return res.status(500).json({ error: "login failed" });
      res.json({ ok: true });
    });
  });
}

/* ----------------------------- Owner session API ---------------------------- */
// Starting, ending, and listing sessions is a plain authenticated REST API;
// playing out an active session (the reducer action stream) happens over
// Socket.IO, scoped to that one session's room (see below).
function serializeSessionRow(row, { includeState = false } = {}) {
  const out = {
    id: row.id,
    title: row.title,
    mode: row.mode,
    createdAt: row.created_at,
    endedAt: row.ended_at,
    shareUrl: `${PUBLIC_URL}/s/${row.share_slug}`,
    shareSlug: row.share_slug,
  };
  // Only ended sessions get a final winner — an active one's standings are
  // still changing, so the session list shows the mode instead (handled
  // client-side) until there's something final to report.
  if (row.ended_at) {
    try { out.winner = computeWinner(normalizeState(JSON.parse(row.state))); }
    catch { out.winner = null; }
  }
  if (includeState) {
    try { out.state = normalizeState(JSON.parse(row.state)); } catch { out.state = { ...initialState }; }
  }
  return out;
}

app.get("/api/sessions", requireLogin, (req, res) => {
  const rows = listSessionsForOwner(req.user.id);
  res.json({ sessions: rows.map((r) => serializeSessionRow(r)) });
});

app.post("/api/sessions", requireLogin, (req, res) => {
  const mode = req.body && req.body.mode === "fixed" ? "fixed" : "individual";
  const title = (req.body && req.body.title || "").trim() || null;
  const row = createSessionRow(req.user.id, mode, title);
  res.json({ session: serializeSessionRow(row, { includeState: true }) });
});

app.get("/api/sessions/:id", requireLogin, (req, res) => {
  const row = getSessionById(req.params.id);
  if (!row || row.owner_user_id !== req.user.id) return res.status(404).json({ error: "not_found" });
  res.json({ session: serializeSessionRow(row, { includeState: true }) });
});

app.post("/api/sessions/:id/end", requireLogin, (req, res) => {
  const row = getSessionById(req.params.id);
  if (!row || row.owner_user_id !== req.user.id) return res.status(404).json({ error: "not_found" });
  if (!row.ended_at) {
    // Flush whatever's currently live before marking it ended, so the
    // persisted row reflects the final state exactly.
    const liveState = liveSessions.get(row.id);
    if (liveState) saveSessionState(row.id, liveState);
    endSessionRow(row.id);
    io.to(roomFor(row.id)).emit("ended");
  }
  res.json({ ok: true });
});

app.delete("/api/sessions/:id", requireLogin, (req, res) => {
  const row = getSessionById(req.params.id);
  if (!row || row.owner_user_id !== req.user.id) return res.status(404).json({ error: "not_found" });
  deleteSessionRow(row.id);
  liveSessions.delete(row.id);
  io.to(roomFor(row.id)).emit("deleted");
  res.json({ ok: true });
});

app.use(express.static(path.join(__dirname, "public")));
app.get("/health", (req, res) => res.json({ ok: true }));

const httpServer = createServer(app);
const io = new Server(httpServer, { cors: { origin: "*" } });

// Share the same session/passport handling with Socket.IO's handshake, so a
// socket from an already-logged-in browser carries req.user — the standard
// express-session + socket.io integration (socket.io >=4.6's engine.use).
io.engine.use(sessionMw);
io.engine.use(passport.initialize());
io.engine.use(passport.session());

/* ------------------------------ Admin ------------------------------- */
app.use("/admin", express.static(path.join(__dirname, "admin")));

app.get("/admin/api/status", requireAdminAuth, (req, res) => {
  res.json({ ok: true, ...overallStats() });
});

function serializeUserRow(u) {
  return {
    id: u.id,
    email: u.email,
    name: u.name,
    isAdmin: Boolean(u.is_admin),
    isAllowed: Boolean(u.is_allowed),
    sessionCount: u.session_count,
    createdAt: u.created_at,
    lastLoginAt: u.last_login_at,
  };
}

app.get("/admin/api/users", requireAdminAuth, (req, res) => {
  res.json({ users: listUsers().map(serializeUserRow) });
});

app.post("/admin/api/users", requireAdminAuth, (req, res) => {
  const email = (req.body && req.body.email || "").trim().toLowerCase();
  if (!email || !email.includes("@")) return res.status(400).json({ error: "invalid_email" });
  const user = addAllowedUser(email);
  res.json({ user: serializeUserRow({ ...user, session_count: 0 }) });
});

app.post("/admin/api/users/:id/revoke", requireAdminAuth, (req, res) => {
  const user = findUserById(req.params.id);
  if (!user) return res.status(404).json({ error: "not_found" });
  if (user.is_admin) return res.status(400).json({ error: "cannot_revoke_admin" });
  revokeUser(user.id);
  res.json({ ok: true });
});

// Admin can inspect and delete any user's sessions (no global wipe — this
// stays scoped to one session at a time, chosen deliberately after the
// blanket "reset database" feature was dropped as too dangerous in a
// multi-tenant model).
app.get("/admin/api/users/:id/sessions", requireAdminAuth, (req, res) => {
  const user = findUserById(req.params.id);
  if (!user) return res.status(404).json({ error: "not_found" });
  const rows = listSessionsForOwner(user.id);
  res.json({ sessions: rows.map((r) => serializeSessionRow(r)) });
});

app.delete("/admin/api/sessions/:id", requireAdminAuth, (req, res) => {
  const row = getSessionById(req.params.id);
  if (!row) return res.status(404).json({ error: "not_found" });
  deleteSessionRow(row.id);
  liveSessions.delete(row.id);
  io.to(roomFor(row.id)).emit("deleted");
  res.json({ ok: true });
});

app.get("/admin/api/db", requireAdminAuth, (req, res) => {
  try {
    db.pragma("wal_checkpoint(FULL)"); // flush WAL so the file on disk is complete
  } catch (err) {
    console.error("WAL checkpoint failed before export", err);
  }
  const dateStr = new Date().toISOString().slice(0, 10);
  res.download(DB_PATH, `pickleball-backup-${dateStr}.db`);
});

// SPA fallback: the React client owns its own routing (/, /app,
// /app/sessions/:id, /s/:slug), so a direct browser navigation or refresh
// on one of those paths needs to still get index.html, not a 404 — Express
// has no route for them itself. Everything that should NOT fall through to
// the client (API routes, /admin, /auth, /health, /socket.io, static
// assets that genuinely don't exist) is registered above this, so by the
// time a GET reaches here it's always a client-side route.
app.get("*", (req, res, next) => {
  if (req.path.startsWith("/api/") || req.path.startsWith("/admin") || req.path.startsWith("/auth/") || req.path.startsWith("/socket.io/") || req.path === "/health") {
    return next();
  }
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

/* ------------------------------- Sockets -------------------------------- */
io.on("connection", (socket) => {
  // A socket must "join" exactly one session before doing anything else —
  // either as its authenticated owner ({ sessionId }) or as an
  // unauthenticated guest via the share link ({ slug }), never both.
  socket.on("join", ({ sessionId, slug } = {}) => {
    let row = null;
    let role = null;

    if (sessionId) {
      const req = socket.request;
      const user = req && req.user;
      row = getSessionById(sessionId);
      if (!row || !user || row.owner_user_id !== user.id) {
        socket.emit("join_error", { error: "not_authorized" });
        return;
      }
      role = "owner";
    } else if (slug) {
      row = getSessionBySlug(slug);
      if (!row) {
        socket.emit("join_error", { error: "not_found" });
        return;
      }
      role = "guest";
    } else {
      socket.emit("join_error", { error: "bad_request" });
      return;
    }

    socket.data.sessionId = row.id;
    socket.data.role = role;
    socket.join(roomFor(row.id));

    const state = loadLiveSession(row.id);
    socket.emit("state", state);
    socket.emit("session_meta", { endedAt: row.ended_at, role, title: row.title });
  });

  socket.on("action", (action) => {
    const sessionId = socket.data.sessionId;
    if (!sessionId || !action || typeof action.type !== "string") return;

    const row = getSessionById(sessionId);
    if (!row) return; // deleted out from under this socket
    if (row.ended_at) {
      socket.emit("action_rejected", { reason: "session_ended" });
      return;
    }
    // Guests connected via the public share link may only submit scores —
    // every other control (shuffle, roster, lineup swaps, ending the
    // session) stays host-only, enforced here regardless of what the
    // client sends.
    if (socket.data.role === "guest" && action.type !== "SUBMIT_SCORE") {
      socket.emit("action_rejected", { reason: "guest_not_allowed" });
      return;
    }
    // Starting a brand-new session is now a REST call (POST /api/sessions)
    // that creates its own row — the old "reset this row back to setup"
    // behavior no longer applies to an existing session.
    if (action.type === "NEW_SESSION") {
      socket.emit("action_rejected", { reason: "use_create_session_api" });
      return;
    }

    try {
      const current = loadLiveSession(sessionId);
      const next = reducer(current, action);
      persistLiveSession(sessionId, next);
      io.to(roomFor(sessionId)).emit("state", next);
    } catch (err) {
      console.error("Failed to apply action", action.type, "for session", sessionId, err);
    }
  });

  socket.on("disconnect", () => {
    // Nothing to clean up server-side — state lives in the DB/live cache
    // keyed by session, not by socket.
  });
});

const PORT = process.env.PORT || 3000;
httpServer.listen(PORT, () => {
  console.log(`Pickleball round robin server listening on port ${PORT}`);
  console.log(`Data directory: ${DATA_DIR}`);
});
