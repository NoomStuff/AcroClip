import { useState } from "react";
import { api } from "./desktop";
import { eventBinding } from "../../shared/shortcuts";

export function ShortcutInput({ value, onChange, label = "Clip shortcut" }: { value: string; onChange: (value: string) => void; label?: string }) {
   const [editing, setEditing] = useState(false);
   return (
      <button
         className={`shortcut-input ${editing ? "editing" : ""}`}
         onClick={() => {
            void api.captureShortcut(true).then(() => setEditing(true));
         }}
         onBlur={() => {
            setEditing(false);
            void api.captureShortcut(false);
         }}
         onKeyDown={(event) => {
            if (!editing) return;
            event.preventDefault();
            if (event.key === "Escape") {
               setEditing(false);
               void api.captureShortcut(false);
               return;
            }
            if (["Control", "Shift", "Alt", "Meta"].includes(event.key)) return;
            if (event.key === "Backspace" && label !== "Clip shortcut") {
               onChange("");
               setEditing(false);
               void api.captureShortcut(false);
               return;
            }
            onChange(eventBinding(event.nativeEvent));
            setEditing(false);
            void api.captureShortcut(false);
         }}
         aria-label={label}
      >
         {editing
            ? "Press a shortcut…"
            : (value || "Unassigned").replace("CommandOrControl", navigator.platform.includes("Mac") ? "⌘" : "Ctrl").replaceAll("+", " + ")}
      </button>
   );
}
