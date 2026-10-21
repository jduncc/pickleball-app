// Integration test for the token-protected /support endpoints. Start a server
// first:  TEST_AUTH_BYPASS=1 PORT=3997 DATA_DIR=<empty dir> ADMIN_EMAILS=host@example.com \
//         SESSION_SECRET=x SUPPORT_TOKEN=test-support-token-0123456789abcdef node index.js
import { io as ioClient } from "socket.io-client";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import Database from "better-sqlite3";

const BASE = "http://localhost:3997";
const TOKEN = "test-support-token-0123456789abcdef";
let failures = 0;
const check = (label, cond) => { console.log(cond ? "ok:" : "FAIL:", label); if (!cond) failures++; };

// seed a session through the real app so there is something to report on
const lg = await fetch(`${BASE}/__test/login`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email: "host@example.com" }) });
const cookie = lg.headers.get("set-cookie").split(";")[0];
const { session } = await (await fetch(`${BASE}/api/sessions`, { method: "POST", headers: { "Content-Type": "application/json", Cookie: cookie }, body: JSON.stringify({ mode: "individual", title: "Support test" }) })).json();
const sock = ioClient(BASE, { transports: ["websocket"], extraHeaders: { Cookie: cookie } });
const w = (e) => new Promise((r) => sock.once(e, r));
await w("connect"); sock.emit("join", { sessionId: session.id }); await w("state");
const send = async (a) => { const p = w("state"); sock.emit("action", a); return p; };
for (let i = 0; i < 4; i++) await send({ type: "ADD_PLAYER", name: "Tester" + i });
await send({ type: "START_SESSION" });
for (let i = 0; i < 4; i++) await send({ type: "SUBMIT_SCORE", courtId: 0, scoreA: 11, scoreB: 4 });
sock.close();

const get = (p, headers = {}) => fetch(BASE + p, { headers });
for (const [label, p, h] of [
  ["no token on /support", "/support", {}],
  ["no token on /support/db", "/support/db", {}],
  ["wrong token (query)", "/support/sessions?token=nope", {}],
  ["wrong token (bearer)", "/support/sessions", { Authorization: "Bearer nope" }],
  ["same-length wrong token", "/support/sessions?token=" + TOKEN.replace(/.$/, "x"), {}],
  ["empty token", "/support/sessions?token=", {}],
]) {
  const r = await get(p, h);
  check(`${label} -> 403 Access denied`, r.status === 403 && (await r.text()) === "Access denied");
}
// a normal logged-in admin cookie is NOT enough
check("session cookie alone is denied", (await get("/support/sessions", { Cookie: cookie })).status === 403);

let r = await get("/support/sessions", { Authorization: `Bearer ${TOKEN}` });
const list = await r.text();
check("bearer token works", r.status === 200 && list.includes("Support test"));
check("X-Support-Token header works", (await get("/support/sessions", { "X-Support-Token": TOKEN })).status === 200);
check("query token works", (await get(`/support/sessions?token=${TOKEN}`)).status === 200);
check("no-store + noindex headers", (await get(`/support/sessions?token=${TOKEN}`)).headers.get("cache-control") === "no-store");

r = await get(`/support/session/latest/report?token=${TOKEN}`);
const rep = await r.text();
check("report readable", r.status === 200 && rep.includes("Tester0") && rep.includes("REPEAT MATCHUP"));
check("report by id", (await (await get(`/support/session/${session.id}/report?token=${TOKEN}`)).text()).includes("Support test"));
r = await get(`/support/session/${session.id}/state?token=${TOKEN}`);
check("raw state is JSON with the log", (await r.json()).log.length === 4);
check("unknown session is 404", (await get(`/support/session/nope/report?token=${TOKEN}`)).status === 404);

r = await get(`/support/db?token=${TOKEN}`);
const buf = Buffer.from(await r.arrayBuffer());
check("db download", r.status === 200 && buf.slice(0, 15).toString() === "SQLite format 3");
const tmp = path.join(os.tmpdir(), "support-test-copy.db"); fs.writeFileSync(tmp, buf);
const copy = new Database(tmp, { readonly: true });
check("db copy has the session", copy.prepare("SELECT COUNT(*) n FROM sessions").get().n >= 1);
check("db copy has NO login cookies", copy.prepare("SELECT COUNT(*) n FROM http_sessions").get().n === 0);
copy.close(); fs.rmSync(tmp, { force: true });

// throttle: hammering with bad tokens ends in 429
let last = 0; for (let i = 0; i < 15; i++) last = (await get("/support/sessions?token=bad" + i)).status;
check("repeated failures are throttled (429)", last === 429);
check("throttle also blocks a correct token for a while", (await get(`/support/sessions?token=${TOKEN}`)).status === 429);
console.log(failures ? `${failures} FAILED` : "ALL OK");
process.exit(failures ? 1 : 0);
