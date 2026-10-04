// Google login + session middleware. Owns all Passport config; nothing else
// should touch passport directly.
import session from "express-session";
import passport from "passport";
import { Strategy as GoogleStrategy } from "passport-google-oauth20";
import {
  findUserById, findUserByEmail, attachGoogleIdentity,
  getHttpSession, setHttpSession, touchHttpSessionExpiry, destroyHttpSession, pruneExpiredHttpSessions,
} from "./db.js";

const DEFAULT_SESSION_MAX_AGE_MS = 1000 * 60 * 60 * 24 * 30; // 30 days

// Persists express-session data to the same SQLite file as everything
// else, so a signed-in browser stays signed in across server
// restarts/redeploys — previously sessions lived only in the process's
// RAM (MemoryStore) and everyone was logged out on every restart.
class SqliteSessionStore extends session.Store {
  constructor() {
    super();
    // Expired rows are also skipped/deleted lazily on read (see
    // db.js#getHttpSession), but a periodic sweep keeps the table from
    // accumulating rows for sessions nobody ever revisits. unref() so this
    // timer never keeps the process alive on its own.
    this._pruneTimer = setInterval(() => {
      try { pruneExpiredHttpSessions(); } catch (err) { console.error("[session-store] prune failed", err); }
    }, 1000 * 60 * 60);
    this._pruneTimer.unref();
  }

  _expiresAt(sess) {
    const expires = sess.cookie && sess.cookie.expires;
    return expires ? new Date(expires).getTime() : Date.now() + DEFAULT_SESSION_MAX_AGE_MS;
  }

  get(sid, cb) {
    try {
      const sessJson = getHttpSession(sid);
      cb(null, sessJson ? JSON.parse(sessJson) : null);
    } catch (err) { cb(err); }
  }

  set(sid, sess, cb) {
    try {
      setHttpSession(sid, JSON.stringify(sess), this._expiresAt(sess));
      cb(null);
    } catch (err) { cb(err); }
  }

  destroy(sid, cb) {
    try { destroyHttpSession(sid); cb(null); } catch (err) { cb(err); }
  }

  // Called instead of set() when only the expiry moved (resave: false +
  // rolling: true) — avoids rewriting the whole session row on every request.
  touch(sid, sess, cb) {
    try { touchHttpSessionExpiry(sid, this._expiresAt(sess)); cb(null); } catch (err) { cb(err); }
  }
}

const PUBLIC_URL = (process.env.PUBLIC_URL || "http://localhost:3000").replace(/\/$/, "");
const CALLBACK_URL = `${PUBLIC_URL}/auth/google/callback`;

// Pulled out of the GoogleStrategy callback so the allowlist logic can be
// exercised directly in tests without a real Google round-trip.
export function verifyGoogleProfile(profile, done) {
  const email = (profile.emails && profile.emails[0] && profile.emails[0].value || "").toLowerCase();
  if (!email) return done(null, false, { message: "no_email" });

  const existing = findUserByEmail(email);
  // Allowlist check happens here, at login time, not at signup — there is
  // no self-serve signup. An email must already have been added by an
  // admin (is_allowed = 1) before Google login does anything but reject.
  if (!existing || !existing.is_allowed) {
    return done(null, false, { message: "not_allowed" });
  }

  const user = attachGoogleIdentity({ email, sub: profile.id, name: profile.displayName });
  return done(null, user);
}

export function configurePassport() {
  const clientID = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  if (!clientID || !clientSecret) {
    console.warn("[auth] GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET not set — Google login will fail until both are configured.");
  }

  passport.use(new GoogleStrategy(
    {
      clientID: clientID || "missing-client-id",
      clientSecret: clientSecret || "missing-client-secret",
      callbackURL: CALLBACK_URL,
    },
    (accessToken, refreshToken, profile, done) => verifyGoogleProfile(profile, done)
  ));

  passport.serializeUser((user, done) => done(null, user.id));
  passport.deserializeUser((id, done) => {
    try {
      const user = findUserById(id);
      done(null, user || false);
    } catch (err) {
      done(err);
    }
  });
}

// SQLite-backed session store (see SqliteSessionStore above): a logged-in
// device stays logged in across server restarts, and `rolling: true` means
// the 30-day expiry resets on every request, so a device used at least
// once a month effectively never gets logged out.
// `trust proxy` + secure cookies rely on the Cloudflare Tunnel in front of
// this forwarding X-Forwarded-Proto, which Cloudflare's edge does by
// default for proxied traffic (including through a Tunnel) — see
// .env.example for the deployment env vars this depends on.
export function sessionMiddleware() {
  const secret = process.env.SESSION_SECRET;
  if (!secret) {
    console.warn("[auth] SESSION_SECRET not set — using an insecure default. Set SESSION_SECRET in production.");
  }
  return session({
    store: new SqliteSessionStore(),
    secret: secret || "dev-only-insecure-secret",
    resave: false,
    saveUninitialized: false,
    rolling: true,
    cookie: {
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      maxAge: DEFAULT_SESSION_MAX_AGE_MS,
    },
  });
}

export function requireLogin(req, res, next) {
  if (req.isAuthenticated && req.isAuthenticated()) return next();
  return res.status(401).json({ error: "not_authenticated" });
}

export function requireAdmin(req, res, next) {
  if (req.isAuthenticated && req.isAuthenticated() && req.user && req.user.is_admin) return next();
  return res.status(403).json({ error: "not_admin" });
}

export { CALLBACK_URL, PUBLIC_URL };
