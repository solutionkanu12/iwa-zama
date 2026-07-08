import "./lib/polyfills.ts";
import { StrictMode, useCallback, useState } from "react";
import { createRoot } from "react-dom/client";
import "./styles/global.css";
import { App } from "./App.tsx";
import { LandingPage } from "./landing/LandingPage.tsx";

// The single entry for both the marketing landing page and the app (Circle /
// Browse / My standing). "Enter the circle" navigates to the app, where the
// connect gate handles wallet selection (the EIP-6963 wallet picker lives
// there, so the member chooses which wallet to connect rather than the landing
// page silently grabbing window.ethereum).
//
// "/" shows the landing page. "/app" shows the app and its connect gate.
// Litepaper and roadmap remain separate, untouched entries.
function AppRoot() {
  const [view, setView] = useState<"landing" | "app">(() =>
    window.location.pathname.startsWith("/app") ? "app" : "landing",
  );

  const onEnterCircle = useCallback(() => {
    setView("app");
    window.history.pushState(null, "", "/app");
  }, []);

  if (view === "app") return <App />;
  return <LandingPage onEnterCircle={onEnterCircle} />;
}

const rootEl = document.getElementById("root");
if (!rootEl) throw new Error("root element not found");

createRoot(rootEl).render(
  <StrictMode>
    <AppRoot />
  </StrictMode>,
);
