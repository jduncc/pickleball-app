// Integration test for step 3 (multi-session server rework). Exercises real
// HTTP + cookies + Socket.IO against a live server process, using the
// TEST_AUTH_BYPASS login route instead of real Google OAuth.
import { io as ioClient } from "socket.io-client";

const BASE = "http://localhost:3996";
let failures = 0;
function check(label, cond) {
  if (!cond) { console.log("FAIL:", label); failures++; }
  else console.log("ok:", label);
}

function extractCookie(res) {
  const raw = res.headers.get("set-cookie");
  if (!raw) return null;
  return raw.split(";")[0];
}

async function loginAs(email) {
  const res = await fetch(`${BASE}/__test/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email }),
  });
  const cookie = extractCookie(res);
  const body = await res.json();
  return { cookie, body };
}

function connectSocket(cookie) {
  return ioClient(BASE, {
    transports: ["websocket"],
    extraHeaders: cookie ? { Cookie: cookie } : {},
  });
}

function waitFor(socket, event, timeoutMs = 2000) {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`timeout waiting for ${event}`)), timeoutMs);
    socket.once(event, (payload) => { clearTimeout(t); resolve(payload); });
  });
}

async function main() {
  // --- owner login ---
  const owner = await loginAs("jonathan.desrochers@gmail.com");
  check("owner login succeeds", owner.body.ok === true);
  check("owner got a session cookie", Boolean(owner.cookie));

  // --- unknown user cannot log in ---
  const unknown = await loginAs("stranger@example.com");
  check("unknown user login rejected (404)", unknown.body.error === "no such user");

  // --- /api/me reflects owner identity ---
  const meRes = await fetch(`${BASE}/api/me`, { headers: { Cookie: owner.cookie } });
  const me = await meRes.json();
  check("/api/me shows authenticated owner", me.authenticated === true && me.email === "jonathan.desrochers@gmail.com");

  // --- /api/sessions requires login ---
  const noAuthRes = await fetch(`${BASE}/api/sessions`);
  check("sessions list without login -> 401", noAuthRes.status === 401);

  // --- create a session as owner ---
  const createRes = await fetch(`${BASE}/api/sessions`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Cookie: owner.cookie },
    body: JSON.stringify({ mode: "individual", title: "Test session" }),
  });
  const created = await createRes.json();
  const sessionId = created.session.id;
  const shareSlug = created.session.shareSlug;
  check("session created with id + share slug", Boolean(sessionId) && Boolean(shareSlug) && shareSlug.length >= 20);

  // --- a second, non-admin allowed user cannot see or touch this session ---
  // (self-seeded via the admin API so this test is self-contained against a
  // brand-new database, rather than depending on a user added out-of-band)
  await fetch(`${BASE}/admin/api/users`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Cookie: owner.cookie },
    body: JSON.stringify({ email: "plain-user@example.com" }),
  });
  const other = await loginAs("plain-user@example.com");
  check("seeded non-owner user can log in", other.body.ok === true);
  const otherGetRes = await fetch(`${BASE}/api/sessions/${sessionId}`, { headers: { Cookie: other.cookie } });
  check("non-owner GET /api/sessions/:id -> 404", otherGetRes.status === 404);

  // --- owner connects via socket, joins by sessionId ---
  const ownerSocket = connectSocket(owner.cookie);
  await waitFor(ownerSocket, "connect");
  ownerSocket.emit("join", { sessionId });
  const ownerState = await waitFor(ownerSocket, "state");
  check("owner join receives initial state (setup phase)", ownerState.phase === "setup");

  // --- a socket authenticated as a DIFFERENT user cannot join this session by id ---
  const otherSocket = connectSocket(other.cookie);
  await waitFor(otherSocket, "connect");
  otherSocket.emit("join", { sessionId });
  const joinErr = await waitFor(otherSocket, "join_error");
  check("non-owner socket join by sessionId rejected", joinErr.error === "not_authorized");
  otherSocket.close();

  // --- owner sets up and starts the session via actions (sequential —
  // each action's resulting "state" must be awaited before sending the
  // next, since the server emits one per action) ---
  async function sendAction(socket, action) {
    const p = waitFor(socket, "state");
    socket.emit("action", action);
    return p;
  }
  const names = ["A", "B", "C", "D"];
  for (const n of names) await sendAction(ownerSocket, { type: "ADD_PLAYER", name: n });
  await sendAction(ownerSocket, { type: "SET_MODE", mode: "individual" });
  await sendAction(ownerSocket, { type: "SET_COURTS", count: 1 });
  const afterStart = await sendAction(ownerSocket, { type: "START_SESSION" });
  check("session started, phase=session, one court filled", afterStart.phase === "session" && afterStart.courtsState[0].match);

  // --- guest connects via share slug, no login at all ---
  const guestSocket = connectSocket(null);
  await waitFor(guestSocket, "connect");
  guestSocket.emit("join", { slug: shareSlug });
  const guestState = await waitFor(guestSocket, "state");
  check("guest join via slug receives live state", guestState.phase === "session");

  // --- guest tries a host-only action: should be rejected server-side ---
  guestSocket.emit("action", { type: "ARM_SHUFFLE" });
  const rejected = await waitFor(guestSocket, "action_rejected");
  check("guest host-only action rejected", rejected.reason === "guest_not_allowed");

  // --- guest submits a score: should be allowed and broadcast to the owner too ---
  const court = afterStart.courtsState[0];
  const ownerStateP = waitFor(ownerSocket, "state");
  guestSocket.emit("action", { type: "SUBMIT_SCORE", courtId: court.id, scoreA: 11, scoreB: 7 });
  const guestStateAfterScore = await waitFor(guestSocket, "state");
  const ownerStateAfterScore = await ownerStateP;
  check("guest SUBMIT_SCORE accepted and broadcast to guest", guestStateAfterScore.log.length === 1);
  check("guest's score also broadcast to the owner's socket", ownerStateAfterScore.log.length === 1);

  // --- NEW_SESSION action is rejected while the session is still active
  // (replaced by POST /api/sessions) — must check this before ending the
  // session, since once ended every action is rejected for a different,
  // more general reason ("session_ended") that would mask this one. ---
  const newSessionRejectedP = waitFor(ownerSocket, "action_rejected");
  ownerSocket.emit("action", { type: "NEW_SESSION" });
  const newSessionRejected = await newSessionRejectedP;
  check("NEW_SESSION action rejected server-side", newSessionRejected.reason === "use_create_session_api");

  // --- owner ends the session via REST ---
  // Register the "ended" listener BEFORE firing the REST call — the guest
  // socket is already connected, so the broadcast can arrive before a
  // listener attached after awaiting the HTTP response would catch it.
  const endedPromise = waitFor(guestSocket, "ended");
  const endRes = await fetch(`${BASE}/api/sessions/${sessionId}/end`, { method: "POST", headers: { Cookie: owner.cookie } });
  check("end session REST call ok", (await endRes.json()).ok === true);
  await endedPromise; // resolving at all (vs. timing out) is the assertion
  check("guest socket notified session ended", true);

  // --- after ending, guest can no longer submit scores ---
  guestSocket.emit("action", { type: "SUBMIT_SCORE", courtId: court.id, scoreA: 11, scoreB: 9 });
  const rejectedAfterEnd = await waitFor(guestSocket, "action_rejected");
  check("action rejected after session ended", rejectedAfterEnd.reason === "session_ended");

  // --- guest can still view (reconnect/rejoin) after ended ---
  // Register both listeners BEFORE emitting "join" — the server emits
  // "state" and "session_meta" back to back, synchronously, in its join
  // handler, so attaching the second listener only after awaiting the
  // first event risks missing it (same race as the "ended" fix above).
  const guestSocket2 = connectSocket(null);
  await waitFor(guestSocket2, "connect");
  const guestStateAfterEndJoinP = waitFor(guestSocket2, "state");
  const metaP = waitFor(guestSocket2, "session_meta");
  guestSocket2.emit("join", { slug: shareSlug });
  const guestStateAfterEndJoin = await guestStateAfterEndJoinP;
  const meta = await metaP;
  check("guest can still view after session ended (read-only)", guestStateAfterEndJoin.log.length === 1 && meta.endedAt !== null);

  // --- owner's session list now shows the ended session ---
  const listRes = await fetch(`${BASE}/api/sessions`, { headers: { Cookie: owner.cookie } });
  const list = await listRes.json();
  check("owner session list includes the ended session", list.sessions.some((s) => s.id === sessionId && s.endedAt));

  // --- admin status endpoint works for an admin, rejected for a non-admin ---
  const adminStatusRes = await fetch(`${BASE}/admin/api/status`, { headers: { Cookie: owner.cookie } });
  check("admin status reachable by admin", adminStatusRes.status === 200);
  const nonAdminStatusRes = await fetch(`${BASE}/admin/api/status`, { headers: { Cookie: other.cookie } });
  check("admin status rejected for non-admin", nonAdminStatusRes.status === 403);

  ownerSocket.close(); guestSocket.close(); guestSocket2.close();

  console.log(failures === 0 ? "\nALL INTEGRATION CHECKS PASSED" : `\n${failures} FAILURE(S)`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((err) => { console.error("Test crashed:", err); process.exit(1); });
