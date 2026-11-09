import { useFieldDescription } from "./field-accessibility";
import { useState } from "react";
import { api } from "./desktop";
import { eventBinding } from "../../shared/shortcuts";

const mac = navigator.platform.includes("Mac");
// Bindings store the meta key as Command, which is the Windows key outside macOS.
const keyNames: Record<string, string> = { Control: "Ctrl", Command: mac ? "⌘" : "Win" };

export function ShortcutInput({
   value,
   onChange,
   label = "Clip shortcut",
   clash = false,
}: {
   value: string;
   onChange: (value: string) => void;
   label?: string;
   clash?: boolean;
}) {
   const description = useFieldDescription();
   const [editing, setEditing] = useState(false);
   // Modifiers show as they are pressed, so you can see the combination build before it commits.
   const [held, setHeld] = useState<string[]>([]);
   const heldKeys = (event: { ctrlKey: boolean; metaKey: boolean; altKey: boolean; shiftKey: boolean }) =>
      [event.ctrlKey && "Control", event.metaKey && "Command", event.altKey && "Alt", event.shiftKey && "Shift"]
         .filter((key): key is string => !!key)
         .map((key) => keyNames[key] ?? key);
   // The clip shortcut is required. Every other shortcut can be left unassigned.
   const clearable = label !== "Clip shortcut";
   const keys = value
      ? value
           .replace("CommandOrControl", mac ? "Command" : "Control")
           .split("+")
           .map((key) => keyNames[key] ?? key)
      : [];
   return (
      <button
         data-row-target=""
         data-clash={clash || undefined}
         className={`shortcut-input ${editing ? "editing" : ""}`}
         onClick={() => {
            void api.captureShortcut(true).then(() => setEditing(true));
         }}
         onBlur={() => {
            setHeld([]);
            setEditing(false);
            void api.captureShortcut(false);
         }}
         onKeyDown={(event) => {
            if (!editing) return;
            event.preventDefault();
            setHeld(heldKeys(event));
            if (event.key === "Escape") {
               setEditing(false);
               void api.captureShortcut(false);
               return;
            }
            if (["Control", "Shift", "Alt", "Meta"].includes(event.key)) return;
            setHeld([]);
            if (event.key === "Backspace" && clearable) {
               onChange("");
               setEditing(false);
               void api.captureShortcut(false);
               return;
            }
            onChange(eventBinding(event.nativeEvent));
            setEditing(false);
            void api.captureShortcut(false);
         }}
         onKeyUp={(event) => {
            if (editing) setHeld(heldKeys(event));
         }}
         aria-label={label}
         aria-describedby={description}
      >
         {editing && held.length ? (
            <>
               {held.map((key) => (
                  <kbd key={key}>{key}</kbd>
               ))}
               <span className="shortcut-next">+ key</span>
            </>
         ) : editing ? (
            <>
               Press a shortcut…
               {/* Without this, clearing an optional shortcut is undiscoverable. */}
               {clearable && value && <span className="shortcut-hint">Backspace clears</span>}
            </>
         ) : keys.length ? (
            keys.map((key) => <kbd key={key}>{key}</kbd>)
         ) : (
            <span className="shortcut-empty">Unassigned</span>
         )}
      </button>
   );
}
