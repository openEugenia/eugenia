import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { registerSW } from "virtual:pwa-register";
import "./vendor/graphic-charter/openeugenia.css";
import "./styles/app.css";
import { App } from "./App.tsx";

// Application installable et utilisable hors ligne (§10.3).
if ("serviceWorker" in navigator && import.meta.env.PROD) {
  registerSW({ immediate: true });
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
