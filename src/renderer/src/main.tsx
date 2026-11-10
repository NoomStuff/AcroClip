import React from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import { createErrorReporter } from "./error-reporting";
import "./styles.css";

// Errors reach the app log, so an exported bug report shows what broke in the window too.
const reportError = createErrorReporter((error) => window.acroClip.reportError(error));
window.addEventListener("error", (event) =>
   reportError("error", event.error ?? event.message, event.filename ? `${event.filename}:${event.lineno}:${event.colno}` : undefined)
);
window.addEventListener("unhandledrejection", (event) => reportError("rejection", event.reason));

document.addEventListener(
   "keydown",
   (event) => {
      if (!["Shift", "Control", "Alt", "Meta"].includes(event.key)) {
         document.documentElement.dataset["keyboard"] = "true";
      }
   },
   true
);
document.addEventListener(
   "pointerdown",
   () => {
      delete document.documentElement.dataset["keyboard"];
   },
   true
);

createRoot(document.getElementById("root")!, {
   onUncaughtError: (error, info) => reportError("react", error, info.componentStack ?? undefined),
   onCaughtError: (error, info) => reportError("react", error, info.componentStack ?? undefined),
}).render(
   <React.StrictMode>
      <App />
   </React.StrictMode>
);
