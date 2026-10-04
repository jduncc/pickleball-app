import React from "react";
import { useParams } from "react-router-dom";
import { useSession } from "./useSession.js";
import { SessionScreen, ConnBadge, CourtMark, Styles } from "./PickleballApp.jsx";

export default function GuestSession() {
  const { slug } = useParams();
  const { state, connected, ended, title, joinError, dispatch } = useSession({ slug });

  if (joinError) {
    return (
      <div className="pbr-app">
        <Styles />
        <div className="pbr-loading">This link isn't valid, or the session has been removed.</div>
      </div>
    );
  }

  return (
    <div className="pbr-app">
      <Styles />
      <ConnBadge connected={connected} />
      {!state ? (
        <div className="pbr-loading">Connecting to server…</div>
      ) : state.phase === "setup" ? (
        <div className="pbr-login">
          <CourtMark />
          <h1>Waiting for the host</h1>
          <p className="pbr-sub">The host hasn't started this session yet — check back in a moment.</p>
        </div>
      ) : (
        <SessionScreen state={state} dispatch={dispatch} role="guest" ended={ended} title={title} />
      )}
    </div>
  );
}
