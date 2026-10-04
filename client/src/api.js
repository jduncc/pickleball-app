// Thin REST helpers for the owner-facing session API (src/index.js on the
// server). All calls rely on the browser's existing session cookie — no
// token or header plumbing needed here.

async function request(path, options) {
  const res = await fetch(path, {
    headers: { "Content-Type": "application/json" },
    ...options,
  });
  let body = null;
  try { body = await res.json(); } catch { /* no body */ }
  if (!res.ok) {
    const err = new Error((body && body.error) || `Request failed (${res.status})`);
    err.status = res.status;
    err.body = body;
    throw err;
  }
  return body;
}

export const getMe = () => request("/api/me");
export const getVersion = () => request("/api/version");
export const listSessions = () => request("/api/sessions");
export const createSession = (mode, title) =>
  request("/api/sessions", { method: "POST", body: JSON.stringify({ mode, title }) });
export const getSession = (id) => request(`/api/sessions/${id}`);
export const endSession = (id) => request(`/api/sessions/${id}/end`, { method: "POST" });
export const deleteSession = (id) => request(`/api/sessions/${id}`, { method: "DELETE" });
