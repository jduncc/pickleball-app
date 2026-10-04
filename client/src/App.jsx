import React from "react";
import { Routes, Route, Navigate } from "react-router-dom";
import Login from "./Login.jsx";
import Dashboard from "./Dashboard.jsx";
import OwnerSession from "./OwnerSession.jsx";
import GuestSession from "./GuestSession.jsx";

// /admin is a separate, server-rendered static page (server/admin/index.html)
// and isn't part of this router — the server serves it directly, outside
// this SPA, so there's no React route for it here.
export default function App() {
  return (
    <Routes>
      <Route path="/" element={<Login />} />
      <Route path="/app" element={<Dashboard />} />
      <Route path="/app/sessions/:id" element={<OwnerSession />} />
      <Route path="/s/:slug" element={<GuestSession />} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
