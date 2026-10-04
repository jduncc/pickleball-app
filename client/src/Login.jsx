import React, { useEffect, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { getMe } from "./api.js";
import { CourtMark, Styles } from "./PickleballApp.jsx";
import Footer from "./Footer.jsx";

const DENIAL_MESSAGES = {
  not_allowed: "That Google account isn't on the allowed list yet. Ask the admin to add your email address.",
  no_email: "Google didn't share an email address for that account, so it can't be matched to the allowed list.",
};

export default function Login() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const [checking, setChecking] = useState(true);

  useEffect(() => {
    let cancelled = false;
    getMe()
      .then((me) => {
        if (cancelled) return;
        if (me.authenticated) {
          // /admin is a separate static page outside this SPA's router.
          if (me.isAdmin) window.location.href = "/admin";
          else navigate("/app", { replace: true });
          return;
        }
        setChecking(false);
      })
      .catch(() => setChecking(false));
    return () => { cancelled = true; };
  }, [navigate]);

  const loginParam = searchParams.get("login");
  const reason = searchParams.get("reason");
  const denialMessage =
    loginParam === "denied" ? (DENIAL_MESSAGES[reason] || "That Google account isn't allowed to sign in.")
    : loginParam === "error" ? "Something went wrong signing in with Google. Please try again."
    : null;

  if (checking) {
    return (
      <div className="pbr-app">
        <Styles />
        <div className="pbr-loading">Loading…</div>
      </div>
    );
  }

  return (
    <div className="pbr-app">
      <Styles />
      <div className="pbr-login">
        <CourtMark />
        <h1>Pickleball Round Robin</h1>
        <p className="pbr-sub">Sign in to create and run your own round-robin sessions.</p>
        {denialMessage && <p className="pbr-login-error">{denialMessage}</p>}
        <a className="pbr-btn pbr-btn-primary pbr-btn-large pbr-google-btn" href="/auth/google">
          Sign in with Google
        </a>
      </div>
      <Footer />
    </div>
  );
}
