// Regenerates the screenshots used by the in-app manual (client/public/manual-img).
//
// What it does: starts a throwaway local server (temp database, fake sign-in
// that only exists when TEST_AUTH_BYPASS=1), fills it with a fictional
// "Alex, Blake, Casey..." session history, then drives a headless browser at
// phone size and saves one PNG per screen. No real data is ever involved.
//
// Usage (from the repo root, with Playwright available — run from the folder
// that has it installed, or set PLAYWRIGHT_DIR):
//   (cd client && npm run build) && rm -rf server/public && cp -r client/dist server/public
//   node docs/make-screenshots.mjs
//   rm -rf server/public        # build artifact, not committed
//
// Optional env: CHROMIUM_PATH (browser binary), PLAYWRIGHT_DIR (where to
// resolve "playwright" from), PORT (default 4020).

import { createRequire } from "node:module";
import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "..");
const serverDir = path.join(root, "server");
const outDir = path.join(root, "client", "public", "manual-img");
const PORT = Number(process.env.PORT || 4020);
const BASE = `http://localhost:${PORT}`;
const HOST_EMAIL = "host@example.com";

const reqPW = createRequire(path.join(process.env.PLAYWRIGHT_DIR || process.cwd(), "noop.js"));
const { chromium } = reqPW("playwright");
const reqServer = createRequire(path.join(serverDir, "noop.js"));
const { io: ioClient } = reqServer("socket.io-client");
const Database = reqServer("better-sqlite3");

if (!fs.existsSync(path.join(serverDir, "public", "index.html"))) {
  console.error("server/public is missing — build the client and copy client/dist to server/public first (see top of this file).");
  process.exit(1);
}
fs.mkdirSync(outDir, { recursive: true });

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "pbr-shots-"));
const server = spawn("node", ["index.js"], {
  cwd: serverDir,
  env: {
    ...process.env, DATA_DIR: dataDir, PORT: String(PORT), SESSION_SECRET: "screens",
    ADMIN_EMAILS: HOST_EMAIL, GOOGLE_CLIENT_ID: "x", GOOGLE_CLIENT_SECRET: "x",
    PUBLIC_URL: BASE, TEST_AUTH_BYPASS: "1", APP_VERSION: process.env.APP_VERSION || "1.1.0",
  },
  stdio: "ignore",
});
const cleanup = () => { try { server.kill("SIGKILL"); } catch {} try { fs.rmSync(dataDir, { recursive: true, force: true }); } catch {} };
process.on("exit", cleanup);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
for (let i = 0; i < 50; i++) { try { if ((await fetch(`${BASE}/api/version`)).ok) break; } catch {} await sleep(200); }

/* ------------------------------ seeding helpers ------------------------------ */
const jsonHeaders = (cookie) => ({ "Content-Type": "application/json", ...(cookie ? { Cookie: cookie } : {}) });
const login = async (email) => {
  const r = await fetch(`${BASE}/__test/login`, { method: "POST", headers: jsonHeaders(), body: JSON.stringify({ email }) });
  return r.headers.get("set-cookie").split(";")[0];
};
const cookie = await login(HOST_EMAIL);
const api = async (method, url, body) => (await fetch(`${BASE}${url}`, { method, headers: jsonHeaders(cookie), body: body ? JSON.stringify(body) : undefined })).json().catch(() => ({}));

async function openSession(title) {
  const { session } = await api("POST", "/api/sessions", { mode: "individual", title });
  const sock = ioClient(BASE, { transports: ["websocket"], extraHeaders: { Cookie: cookie } });
  const waitFor = (e) => new Promise((res) => sock.once(e, res));
  await waitFor("connect");
  sock.emit("join", { sessionId: session.id });
  let state = await waitFor("state");
  const send = async (action) => { const p = waitFor("state"); sock.emit("action", action); state = await p; return state; };
  return { id: session.id, slug: session.shareSlug, send, close: () => sock.close(), get state() { return state; } };
}
const NAMES = ["Alex", "Blake", "Casey", "Drew", "Emery", "Frankie", "Gray", "Harper"];
const SCORES = [[11, 7], [9, 11], [11, 4], [11, 9], [8, 11], [11, 6], [11, 8], [10, 11]];
async function startSession(s, n, courts = 1) {
  for (const name of NAMES.slice(0, n)) await s.send({ type: "ADD_PLAYER", name });
  if (courts !== 1) await s.send({ type: "SET_COURTS", count: courts });
  await s.send({ type: "START_SESSION" });
}
async function playGames(s, count, courts = 1) {
  for (let i = 0; i < count; i++) {
    const [a, b] = SCORES[i % SCORES.length];
    for (let c = 0; c < courts; c++) await s.send({ type: "SUBMIT_SCORE", courtId: c, scoreA: a, scoreB: b });
  }
}

/* ------------------------------ seed: history ------------------------------ */
const past = [];
for (const [title, n, games] of [["RR 9/27/2026", 5, 7], ["RR 10/4/2026", 6, 8]]) {
  const s = await openSession(title);
  await startSession(s, n); await playGames(s, games);
  await api("POST", `/api/sessions/${s.id}/end`);
  s.close(); past.push({ id: s.id, title });
}
const live = await openSession("RR 10/7/2026");
await startSession(live, 6); await playGames(live, 5);

// Backdate the finished sessions so the list shows sensible dates.
{
  const db = new Database(path.join(dataDir, "pickleball.db"));
  const day = 86400000, now = Date.now();
  db.prepare("UPDATE sessions SET created_at = ? WHERE id = ?").run(now - 10 * day, past[0].id);
  db.prepare("UPDATE sessions SET created_at = ? WHERE id = ?").run(now - 3 * day, past[1].id);
  db.close();
}

/* ------------------------------ browser ------------------------------ */
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || "/opt/pw-browsers/chromium-1194/chrome-linux/chrome" });
const phone = { viewport: { width: 390, height: 800 }, deviceScaleFactor: 2 };
const ownerCtx = await browser.newContext(phone);
await ownerCtx.request.post(`${BASE}/__test/login`, { data: { email: HOST_EMAIL }, headers: { "Content-Type": "application/json" } });
const p = await ownerCtx.newPage();
const shot = (name, target) => (target || p).screenshot({ path: path.join(outDir, name + ".png") });
const tab = async (label) => { await p.click(`.pbr-tabbar >> text=${label}`); await p.waitForTimeout(250); };

// Sign-in page (logged-out visitor)
{
  const anon = await browser.newPage(phone);
  await anon.goto(`${BASE}/`); await anon.waitForSelector("#cta");
  await shot("signin", anon); await anon.close();
}

// Dashboard
await p.goto(`${BASE}/app`); await p.waitForSelector(".pbr-session-row");
await p.waitForTimeout(300); await shot("dashboard");

// Setup: players + format, play order + courts, fixed-partner teams
{
  const s = await openSession("Setup demo");
  for (const name of NAMES.slice(0, 6)) await s.send({ type: "ADD_PLAYER", name });
  await p.goto(`${BASE}/app/sessions/${s.id}`); await p.waitForSelector(".pbr-setup");
  await shot("setup-players");
  await s.send({ type: "SET_COURTS", count: 2 }); await p.waitForTimeout(300);
  await p.locator("text=Courts available").scrollIntoViewIfNeeded(); await p.evaluate(() => window.scrollTo(0, document.body.scrollHeight)); await p.waitForTimeout(200);
  await shot("setup-courts");
  // fixed partners
  await s.send({ type: "SET_MODE", mode: "fixed" });
  const ids = s.state.players.map((x) => x.id);
  await s.send({ type: "CREATE_TEAM", playerIds: [ids[0], ids[1]] });
  await s.send({ type: "CREATE_TEAM", playerIds: [ids[2], ids[3]] });
  await p.reload(); await p.waitForSelector(".pbr-setup");
  await p.locator("text=Teams").first().scrollIntoViewIfNeeded(); await p.waitForTimeout(300);
  await shot("setup-teams");
  s.close();
}

// Live session screens
await p.goto(`${BASE}/app/sessions/${live.id}`); await p.waitForSelector(".pbr-court-card");
// half-entered score so the stepper looks alive: trophy = 11 for side A, then 7 for B
await p.locator(".pbr-side-a .pbr-btn-trophy").click();
for (let i = 0; i < 7; i++) await p.locator(".pbr-side-b .pbr-stepper button").last().click();
await p.waitForTimeout(300); await shot("courts");
await p.locator("text=Edit lineup").click(); await p.waitForTimeout(300); await shot("courts-edit-lineup");
await p.locator("button:has-text('Done')").click();
await tab("Queue"); await shot("queue");
await tab("Standings"); await shot("standings");
await tab("Log"); await p.waitForSelector(".pbr-log-row");
await shot("log");
await p.locator(".pbr-log-row").nth(1).locator(".pbr-log-edit").click();
await p.waitForSelector(".pbr-log-editor"); await shot("log-edit");

// Guest view through the share link (no sign-in)
{
  const g = await browser.newPage(phone);
  await g.goto(`${BASE}/s/${live.slug}`); await g.waitForSelector(".pbr-court-card"); await g.waitForTimeout(300);
  await shot("guest", g); await g.close();
}

// Two-court session with the shuffle banner
{
  const m = await openSession("RR multi-court");
  await startSession(m, 8, 2); await playGames(m, 1, 2);
  const mp = await ownerCtx.newPage(); await mp.setViewportSize({ width: 390, height: 1000 });
  await mp.goto(`${BASE}/app/sessions/${m.id}`); await mp.waitForSelector(".pbr-shuffle-banner"); await mp.waitForTimeout(300);
  await shot("multi-court", mp); await mp.close(); m.close();
}

// Admin page
for (const email of ["casey@example.com", "drew@example.com", "emery@example.com"]) await api("POST", "/admin/api/users", { email });
{
  const ap = await ownerCtx.newPage(); await ap.setViewportSize({ width: 390, height: 900 });
  await ap.goto(`${BASE}/admin`); await ap.waitForSelector("text=Add an instance user"); await ap.waitForTimeout(500);
  await shot("admin", ap); await ap.close();
}

await browser.close(); live.close();

// Shrink the PNGs (flat UI colours compress very well when quantised). Optional.
const py = `
import sys, glob
from PIL import Image
for f in glob.glob(sys.argv[1] + "/*.png"):
    im = Image.open(f).convert("RGB").quantize(colors=128, method=Image.Quantize.MEDIANCUT, dither=Image.Dither.NONE)
    im.save(f, optimize=True)
`;
const r = spawnSync("python3", ["-c", py, outDir], { stdio: "inherit" });
if (r.status !== 0) console.log("(skipped PNG shrinking — Pillow not available)");
console.log("Screenshots written to", outDir);
cleanup();
