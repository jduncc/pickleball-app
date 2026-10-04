import React, { useEffect, useState } from "react";
import { getVersion } from "./api.js";

// Small, unobtrusive version string for the bottom of a screen. Session
// views intentionally don't render this (the fixed tab bar already owns
// the bottom of the viewport there) — the Log tab shows the version
// instead, see PickleballApp.jsx.
export default function Footer() {
  const [version, setVersion] = useState(null);

  useEffect(() => {
    getVersion().then((v) => setVersion(v.version)).catch(() => setVersion(null));
  }, []);

  if (!version) return null;
  return <div className="pbr-footer">Pickleball Round Robin v{version}</div>;
}
