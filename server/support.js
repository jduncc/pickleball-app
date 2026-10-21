// Token-protected read-only support endpoints (/support/...), meant for
// troubleshooting by whoever holds SUPPORT_TOKEN (e.g. Claude, on request).
//
//  * Disabled unless SUPPORT_TOKEN is set to something long (24+ chars).
//  * Every request must present the token, as "Authorization: Bearer <token>",
//    an "X-Support-Token" header, or ?token=<token> (for tools that can only
//    fetch a URL). Missing, wrong or "feature off" all get the same 403
//    "Access denied", and repeated failures from one address are throttled.
//  * Read-only. The database copy has the login-cookie table emptied, so a
//    leaked copy can't be used to impersonate anyone.
//  * Rotate by changing SUPPORT_TOKEN and restarting; remove it to turn it off.
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import express from "express";
import Database from "better-sqlite3";

const MIN_TOKEN_LENGTH = 24;
const MAX_FAILURES = 10;          // per address...
const FAILURE_WINDOW_MS = 10 * 60 * 1000; // ...per 10 minutes

const sha = (s) => crypto.createHash("sha256").update(String(s)).digest();

function givenToken(req) {
  const auth = req.get("authorization") || "";
  if (/^Bearer\s+/i.test(auth)) return auth.replace(/^Bearer\s+/i, "").trim();
  const h = req.get("x-support-token");
  if (h) return h;
  const q = req.query && req.query.token;
  return typeof q === "string" ? q : null;
}

export function registerSupportRoutes(app, { db, DB_PATH }) {
  const token = process.env.SUPPORT_TOKEN || "";
  const enabled = token.length >= MIN_TOKEN_LENGTH;
  if (token && !enabled) console.warn(`[support] SUPPORT_TOKEN is shorter than ${MIN_TOKEN_LENGTH} characters — support endpoints stay disabled.`);
  if (enabled) console.log("[support] Support endpoints are enabled (token required).");

  const failures = new Map(); // ip -> { count, resetAt }
  const deny = (req, res) => {
    const now = Date.now();
    const f = failures.get(req.ip);
    if (!f || f.resetAt < now) failures.set(req.ip, { count: 1, resetAt: now + FAILURE_WINDOW_MS });
    else f.count++;
    res.status(403).type("text/plain").send("Access denied");
  };

  const router = express.Router();
  router.use((req, res, next) => {
    res.set({ "Cache-Control": "no-store", "X-Robots-Tag": "noindex, nofollow", "Referrer-Policy": "no-referrer" });
    const f = failures.get(req.ip);
    if (f && f.resetAt >= Date.now() && f.count >= MAX_FAILURES) {
      return res.status(429).type("text/plain").send("Access denied");
    }
    const given = givenToken(req);
    // Compare hashes so the check is constant-time and length-independent.
    const ok = enabled && typeof given === "string" && crypto.timingSafeEqual(sha(given), sha(token));
    if (!ok) return deny(req, res);
    next();
  });

  router.get("/", (req, res) => {
    res.type("text/plain").send([
      "Support endpoints (read-only)",
      "  /support/db                   SQLite copy of the database (login cookies removed)",
      "  /support/sessions             list of sessions",
      "  /support/session/<id|latest>/report   readable game-by-game report",
      "  /support/session/<id|latest>/state    raw session state (JSON)",
      "",
    ].join("\n"));
  });

  router.get("/db", async (req, res) => {
    const tmp = path.join(os.tmpdir(), `pb-support-${crypto.randomUUID()}.db`);
    const cleanup = () => { for (const f of [tmp, tmp + "-wal", tmp + "-shm"]) fs.rm(f, { force: true }, () => {}); };
    try {
      await db.backup(tmp);
      const copy = new Database(tmp);
      copy.prepare("DELETE FROM http_sessions").run();
      copy.exec("VACUUM");
      copy.close();
      const dateStr = new Date().toISOString().slice(0, 10);
      res.download(tmp, `pickleball-support-${dateStr}.db`, cleanup);
    } catch (err) {
      console.error("[support] db copy failed", err);
      cleanup();
      res.status(500).type("text/plain").send("Could not copy the database");
    }
  });

  router.get("/sessions", (req, res) => {
    const rows = db.prepare(
      `SELECT s.id, s.title, s.mode, s.created_at, s.ended_at, s.state, u.email
         FROM sessions s LEFT JOIN users u ON u.id = s.owner_user_id
        ORDER BY s.created_at DESC LIMIT 200`
    ).all();
    const lines = rows.map((r) => {
      let games = "?";
      try { games = JSON.parse(r.state).log.length; } catch { /* leave ? */ }
      return [r.id, iso(r.created_at), r.ended_at ? "ended " + iso(r.ended_at) : "active", r.mode || "-", `${games} games`, r.email || "-", r.title || "(untitled)"].join(" | ");
    });
    res.type("text/plain").send(lines.join("\n") + "\n");
  });

  const findSession = (id) => (id === "latest"
    ? db.prepare("SELECT * FROM sessions ORDER BY created_at DESC LIMIT 1").get()
    : db.prepare("SELECT * FROM sessions WHERE id = ?").get(id));

  router.get("/session/:id/state", (req, res) => {
    const row = findSession(req.params.id);
    if (!row) return res.status(404).type("text/plain").send("No such session");
    res.type("application/json").send(row.state);
  });

  router.get("/session/:id/report", (req, res) => {
    const row = findSession(req.params.id);
    if (!row) return res.status(404).type("text/plain").send("No such session");
    let state;
    try { state = JSON.parse(row.state); } catch { return res.status(500).type("text/plain").send("Unreadable state"); }
    res.type("text/plain").send(buildReport(row, state));
  });

  app.use("/support", router);
}

const iso = (ms) => new Date(ms).toISOString().replace("T", " ").slice(0, 16) + "Z";

// Readable, game-by-game summary of a session, written so a person (or an AI
// reading it as text) can see who played whom, who sat, and what repeated.
export function buildReport(row, state) {
  const nm = (id) => (state.units && state.units[id] ? state.units[id].name : id);
  const side = (ids) => ids.map(nm).join("/");
  const out = [];
  out.push(`SESSION ${row.id}`);
  out.push(`title: ${row.title || "(untitled)"} | mode: ${state.mode} | created ${iso(row.created_at)} | ${row.ended_at ? "ended " + iso(row.ended_at) : "active"}`);
  out.push(`courts: ${state.courtCount} | shuffleArmed: ${state.shuffleArmed} | games logged: ${state.log.length}`);
  out.push("");
  out.push("PLAYERS (name: games, sits, missStreak, firstServes, active)");
  Object.values(state.units).forEach((u) => out.push(`  ${u.name}: gp ${u.gamesPlayed}, sits ${u.sits || 0}, miss ${u.missStreak || 0}, firstServes ${u.firstServes || 0}, ${u.active === false ? "inactive" : "active"}${u.onCourt ? ", on court" : ""}`));
  out.push("");
  out.push("GAMES (n | court | start min | length | sideA v sideB | score | sat out | flags)");
  const t0 = state.log.length ? state.log[0].startedAt : 0;
  const matchSeen = new Map();
  const partnered = new Map();
  const key = (ids) => [...ids].sort().join(",");
  state.log.forEach((e, i) => {
    const flags = [];
    const sig = [key(e.sideA), key(e.sideB)].sort().join("|");
    if (matchSeen.has(sig)) flags.push(`REPEAT MATCHUP of game ${matchSeen.get(sig)}`);
    matchSeen.set(sig, i + 1);
    if (state.mode !== "fixed") {
      [e.sideA, e.sideB].forEach((s) => {
        if (s.length !== 2) return;
        const k = key(s);
        if (partnered.get(k)) flags.push(`partners ${side(s)} (${partnered.get(k)}x before)`);
        partnered.set(k, (partnered.get(k) || 0) + 1);
      });
    }
    if (typeof e.durationMs === "number" && e.durationMs < 60000) flags.push(`SHORT GAME ${Math.round(e.durationMs / 1000)}s`);
    const sat = (e.sittingOut && e.sittingOut.length ? e.sittingOut : []).map(nm);
    out.push([
      i + 1, `c${e.courtId + 1}`,
      `+${Math.round((e.startedAt - t0) / 600) / 100}m`,
      typeof e.durationMs === "number" ? `${Math.floor(e.durationMs / 60000)}:${String(Math.floor(e.durationMs / 1000) % 60).padStart(2, "0")}` : "?",
      `${side(e.sideA)} v ${side(e.sideB)}`, `${e.scoreA}-${e.scoreB}`,
      sat.length ? sat.join(",") : "-",
      flags.join("; ") || "-",
    ].join(" | "));
  });
  out.push("");
  out.push("ON COURTS NOW");
  (state.courtsState || []).forEach((c) => out.push(`  ${c.name || "Court " + (c.id + 1)}: ${c.match ? `${side(c.match.sideA)} v ${side(c.match.sideB)}` : "(empty)"}`));
  out.push("");
  const pairs = [...partnered.entries()].filter(([, n]) => n > 1).map(([k, n]) => `${side(k.split(","))} x${n}`);
  out.push(`PARTNER PAIRS USED MORE THAN ONCE: ${pairs.length ? pairs.join(", ") : "none"}`);
  return out.join("\n") + "\n";
}
