import React, { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { getVersion } from "./api.js";

// Small, unobtrusive footer for the bottom of a screen: links to the in-app
// manual and version history, plus the running version. Session views
// intentionally don't render this (the fixed tab bar already owns the bottom
// of the viewport there) — the Log tab shows it instead, see PickleballApp.jsx.
export default function Footer() {
  const [version, setVersion] = useState(null);
  const [buildDate, setBuildDate] = useState(null);

  useEffect(() => {
    getVersion()
      .then((v) => {
        setVersion(v.version);
        setBuildDate(v.buildDate || null);
      })
      .catch(() => setVersion(null));
  }, []);

  return (
    <div className="pbr-footer">
      <div className="pbr-footer-links">
        <Link to="/help">User manual</Link> · <Link to="/help/history">Version history</Link>
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
