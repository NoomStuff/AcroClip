import React from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import "./styles.css";

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

createRoot(document.getElementById("root")!).render(
   <React.StrictMode>
      <App />
   </React.StrictMode>
);
