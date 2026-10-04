import React, { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { getMe, listSessions, createSession } from "./api.js";
import { CourtMark, Styles } from "./PickleballApp.jsx";
import { Plus, Link as LinkIcon } from "lucide-react";
import Footer from "./Footer.jsx";

export default function Dashboard() {
  const navigate = useNavigate();
  const [me, setMe] = useState(null);
  const [sessions, setSessions] = useState(null);
  const [error, setError] = useState(null);
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    let cancelled = false;
    getMe()
      .then((m) => {
        if (cancelled) return;
        if (!m.authenticated) { navigate("/", { replace: true }); return; }
        setMe(m);
      })
      .catch(() => navigate("/", { replace: true }));
    return () => { cancelled = true; };
  }, [navigate]);

  useEffect(() => {
    if (!me) return;
    listSessions()
      .then((d) => setSessions(d.sessions))
      .catch(() => setError("Could not load your sessions."));
  }, [me]);

  const handleCreate = async () => {
    setCreating(true);
    try {
      const d = await createSession("individual", null);
      navigate(`/app/sessions/${d.session.id}`);
    } catch (e) {
      setError("Could not create a new session.");
      setCreating(false);
    }
  };

  const copyLink = async (url) => {
    try {
      await navigator.clipboard.writeText(url);
      alert("Share link copied.");
    } catch {
      prompt("Copy this share link:", url);
    }
  };

  if (!me) {
    return (
      <div className="pbr-app">
        <Styles />
        <div className="pbr-loading">Loading…</div>
      </div>
    );
  }

  const active = (sessions || []).filter((s) => !s.endedAt);
  const ended = (sessions || []).filter((s) => s.endedAt);

  return (
    <div className="pbr-app">
      <Styles />
      <div className="pbr-dash">
        <header className="pbr-dash-header">
          <CourtMark />
          <div>
            <h1>My sessions</h1>
            <p className="pbr-sub">Signed in as {me.email}</p>
          </div>
        </header>

        <button className="pbr-btn pbr-btn-primary pbr-btn-large" onClick={handleCreate} disabled={creating}>
          <Plus size={18} /> New session
        </button>

        {error && <p className="pbr-hint pbr-warn">{error}</p>}

        {sessions === null ? (
          <p className="pbr-hint">Loading sessions…</p>
        ) : (
          <>
            {active.length > 0 && (
              <section className="pbr-card">
                <h2>Active</h2>
                <div className="pbr-session-row-list">
                  {active.map((s) => (
                    <SessionRow key={s.id} session={s} onOpen={() => navigate(`/app/sessions/${s.id}`)} onCopyLink={copyLink} />
                  ))}
                </div>
              </section>
            )}

            {ended.length > 0 && (
              <section className="pbr-card">
                <h2>Past sessions</h2>
                <div className="pbr-session-row-list">
                  {ended.map((s) => (
                    <SessionRow key={s.id} session={s} onOpen={() => navigate(`/app/sessions/${s.id}`)} />
                  ))}
                </div>
              </section>
            )}

            {active.length === 0 && ended.length === 0 && (
              <p className="pbr-empty">No sessions yet — start one above.</p>
            )}
          </>
        )}

        <a className="pbr-link-btn" href="/auth/logout" style={{ alignSelf: "center", marginTop: 6 }}>Sign out</a>
      </div>
      <Footer />
    </div>
  );
}

function SessionRow({ session, onOpen, onCopyLink }) {
  const dt = new Date(session.createdAt);
  return (
    <div className="pbr-session-row" onClick={onOpen}>
      <div className="pbr-session-row-info">
        <span className="pbr-session-row-title">{session.title || (session.mode === "fixed" ? "Fixed partners" : "Individual")}</span>
        <span className="pbr-session-row-meta">{dt.toLocaleDateString()} · {session.mode === "fixed" ? "Fixed partners" : "Everyone for themselves"}</span>
        {onCopyLink && (
          <button className="pbr-copy-link-btn" onClick={(e) => { e.stopPropagation(); onCopyLink(session.shareUrl); }}>
            <LinkIcon size={11} style={{ verticalAlign: "-1px", marginRight: 3 }} /> Copy share link
          </button>
        )}
      </div>
      <span className={"pbr-badge " + (session.endedAt ? "pbr-badge-ended" : "pbr-badge-live")}>
        {session.endedAt ? "Ended" : "Live"}
      </span>
    </div>
  );
}
