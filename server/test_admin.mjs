const BASE = "http://localhost:3995";
let failures = 0;
function check(label, cond) { if (!cond) { console.log("FAIL:", label); failures++; } else console.log("ok:", label); }
function extractCookie(res) { const raw = res.headers.get("set-cookie"); return raw ? raw.split(";")[0] : null; }
async function loginAs(email) {
  const res = await fetch(`${BASE}/__test/login`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email }) });
  return { cookie: extractCookie(res), body: await res.json() };
}

async function main() {
  const admin = await loginAs("jonathan.desrochers@gmail.com");
  check("admin login ok", admin.body.ok === true);

  // self-seed a plain non-admin user via the admin API, so this test is
  // self-contained against a brand-new database rather than depending on a
  // user added out-of-band before the server started.
  await fetch(`${BASE}/admin/api/users`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Cookie: admin.cookie },
    body: JSON.stringify({ email: "plain-user@example.com" }),
  });
  const plain = await loginAs("plain-user@example.com");
  check("plain user login ok", plain.body.ok === true);

  // non-admin cannot list users
  const forbidden = await fetch(`${BASE}/admin/api/users`, { headers: { Cookie: plain.cookie } });
  check("non-admin GET /admin/api/users -> 403", forbidden.status === 403);

  // admin lists users, sees both seeded users
  const listRes = await fetch(`${BASE}/admin/api/users`, { headers: { Cookie: admin.cookie } });
  const listBody = await listRes.json();
  check("admin lists users including seeded ones", listBody.users.some(u => u.email === "jonathan.desrochers@gmail.com" && u.isAdmin) && listBody.users.some(u => u.email === "plain-user@example.com" && !u.isAdmin));

  // admin adds a brand new allowed user
  const addRes = await fetch(`${BASE}/admin/api/users`, { method: "POST", headers: { "Content-Type": "application/json", Cookie: admin.cookie }, body: JSON.stringify({ email: "NewFriend@Example.com" }) });
  const addBody = await addRes.json();
  check("admin adds new user, email lowercased", addBody.user.email === "newfriend@example.com" && addBody.user.isAllowed === true && addBody.user.isAdmin === false);

  // that new user can now log in via bypass (proves is_allowed actually took effect)
  const newFriendLogin = await loginAs("newfriend@example.com");
  check("newly-added user can now log in", newFriendLogin.body.ok === true);

  // invalid email rejected
  const badRes = await fetch(`${BASE}/admin/api/users`, { method: "POST", headers: { "Content-Type": "application/json", Cookie: admin.cookie }, body: JSON.stringify({ email: "not-an-email" }) });
  check("invalid email rejected with 400", badRes.status === 400);

  // admin revokes the new user
  const revokeRes = await fetch(`${BASE}/admin/api/users/${addBody.user.id}/revoke`, { method: "POST", headers: { Cookie: admin.cookie } });
  check("revoke succeeds", (await revokeRes.json()).ok === true);

  // revoked user can no longer log in (bypass route enforces is_allowed too)
  const revokedLoginAttempt = await loginAs("newfriend@example.com");
  check("revoked user can no longer log in", revokedLoginAttempt.body.error === "not_allowed");

  // cannot revoke an admin
  const usersNow = await (await fetch(`${BASE}/admin/api/users`, { headers: { Cookie: admin.cookie } })).json();
  const adminUser = usersNow.users.find(u => u.email === "jonathan.desrochers@gmail.com");
  const revokeAdminRes = await fetch(`${BASE}/admin/api/users/${adminUser.id}/revoke`, { method: "POST", headers: { Cookie: admin.cookie } });
  check("cannot revoke an admin user", revokeAdminRes.status === 400);

  console.log(failures === 0 ? "\nALL ADMIN CHECKS PASSED" : `\n${failures} FAILURE(S)`);
  process.exit(failures === 0 ? 0 : 1);
}
main().catch((err) => { console.error("Test crashed:", err); process.exit(1); });
