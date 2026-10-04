import React, { useEffect, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { useSession } from "./useSession.js";
import { getSession, endSession } from "./api.js";
import { SetupScreen, SessionScreen, ConnBadge, Styles } from "./PickleballApp.jsx";

export default function OwnerSession() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { state, connected, ended, title, joinError, dispatch } = useSession({ sessionId: id });
  const [shareUrl, setShareUrl] = useState(null);

  useEffect(() => {
    let cancelled = false;
    getSession(id)
      .then((d) => { if (!cancelled) setShareUrl(d.session.shareUrl); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [id]);

  const handleEndSession = async () => {
    try { await endSession(id); } catch { /* socket "ended" broadcast still covers the UI */ }
  };

  const copyLink = async () => {
    if (!shareUrl) return;
    try {
      await navigator.clipboard.writeText(shareUrl);
      alert("Share link copied.");
    } catch {
      prompt("Copy this share link:", shareUrl);
    }
  };

  if (joinError) {
    return (
      <div className="pbr-app">
        <Styles />
        <div className="pbr-loading">
          {joinError === "not_authorized" ? "You don't have access to this session." : "That session couldn't be found."}
          <br />
          <button className="pbr-btn pbr-btn-ghost" style={{ marginTop: 16 }} onClick={() => navigate("/app")}>Back to my sessions</button>
        </div>
      </div>
    );
  }

  return (
    <div className="pbr-app">
      <Styles />
      <ConnBadge connected={connected} />
      {!state ? (
        <div className="pbr-loading">Connecting to server…</div>
      ) : (
        <>
          {shareUrl && (
            <div className="pbr-info-banner" style={{ cursor: "pointer" }} onClick={copyLink}>
              Tap to copy the share link for this session
            </div>
          )}
          {state.phase === "setup" ? (
            <SetupScreen state={state} dispatch={dispatch} onBack={() => navigate("/app")} />
          ) : (
            <SessionScreen
              state={state}
              dispatch={dispatch}
              role="owner"
              ended={ended}
              title={title}
              onBack={() => navigate("/app")}
              onEndSession={handleEndSession}
            />
          )}
        </>
      )}
    </div>
  );
}
