import { useEffect, useRef, useState } from "react";
import { io } from "socket.io-client";

// Connects one Socket.IO socket to one session, either as its authenticated
// owner ({ sessionId }, cookie carries identity) or as an unauthenticated
// guest via the public share link ({ slug }). Mirrors the server's
// join/state/session_meta/ended/join_error/action_rejected protocol from
// server/index.js.
export function useSession({ sessionId, slug }) {
  const [state, setState] = useState(null);
  const [connected, setConnected] = useState(false);
  const [role, setRole] = useState(null);
  const [ended, setEnded] = useState(false);
  const [title, setTitle] = useState(null);
  const [joinError, setJoinError] = useState(null);
  const [actionError, setActionError] = useState(null);
  const socketRef = useRef(null);

  useEffect(() => {
    setState(null);
    setJoinError(null);
    setEnded(false);

    const socket = io({ path: "/socket.io" });
    socketRef.current = socket;

    socket.on("connect", () => {
      setConnected(true);
      socket.emit("join", sessionId ? { sessionId } : { slug });
    });
    socket.on("disconnect", () => setConnected(false));
    socket.on("state", (s) => setState(s));
    socket.on("session_meta", (m) => { setRole(m.role); setEnded(Boolean(m.endedAt)); setTitle(m.title || null); });
    socket.on("join_error", (e) => setJoinError(e.error));
    socket.on("ended", () => setEnded(true));
    socket.on("action_rejected", (e) => {
      if (e.reason === "session_ended") setEnded(true);
      else setActionError(e.reason);
    });

    return () => socket.disconnect();
  }, [sessionId, slug]);

  const dispatch = (action) => {
    if (socketRef.current) socketRef.current.emit("action", action);
  };

  return { state, connected, role, ended, title, joinError, actionError, dispatch };
}
