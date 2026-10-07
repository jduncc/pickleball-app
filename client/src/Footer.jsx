import React, { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { getVersion, getMe } from "./api.js";

// Small, unobtrusive footer for the bottom of a screen: links to the in-app
// manual and version history, plus the running version. Session views
// intentionally don't render this (the fixed tab bar already owns the bottom
// of the viewport there) — the Log tab shows it instead, see PickleballApp.jsx.
export default function Footer() {
  const [version, setVersion] = useState(null);
  const [buildDate, setBuildDate] = useState(null);
  const [isAdmin, setIsAdmin] = useState(false);

  useEffect(() => {
    getVersion()
      .then((v) => {
        setVersion(v.version);
        setBuildDate(v.buildDate || null);
      })
      .catch(() => setVersion(null));
  }, []);

  // Only signed-in admins see the Admin link (guests and logged-out visitors
  // get authenticated:false or an error, both leave it hidden).
  useEffect(() => {
    getMe()
      .then((me) => setIsAdmin(Boolean(me && me.authenticated && me.isAdmin)))
      .catch(() => setIsAdmin(false));
  }, []);

  return (
    <div className="pbr-footer">
      <div className="pbr-footer-links">
        <Link to="/help">User manual</Link> · <Link to="/help/history">Version history</Link>
        {isAdmin && (
          <>
            {" · "}
            {/* /admin is a server-rendered page, so a plain link (full page load). */}
            <a href="/admin">Admin</a>
          </>
        )}
      </div>
      {version && (
        <div>
          Pickleball Round Robin v{version}
          {buildDate ? ` (${buildDate})` : ""}
        </div>
      )}
    </div>
  );
}
