import { useFieldDescription } from "./field-accessibility";
import { useRef, useState } from "react";
import type { KeyboardEvent } from "react";
import { api } from "./desktop";
import { eventBinding } from "../../shared/shortcuts";
import type { ShortcutModifier } from "../../shared/shortcuts";

const mac = navigator.platform.includes("Mac");
// Bindings store the meta key as Command, which is the Windows key outside macOS.
const keyNames: Record<string, string> = { Control: "Ctrl", Command: mac ? "⌘" : "Win" };
const modifierCodes: Record<string, ShortcutModifier> = {
   ControlLeft: "Control",
   ControlRight: "Control",
   MetaLeft: "Command",
   MetaRight: "Command",
   AltLeft: "Alt",
   AltRight: "Alt",
   ShiftLeft: "Shift",
   ShiftRight: "Shift",
};
const modifierOrder: ShortcutModifier[] = ["Control", "Command", "Alt", "Shift"];

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
   // Modifiers are tracked from their own key presses too. With AltGr, Windows drops Ctrl and Alt
   // from the final key's flags, so the preview and the saved binding could disagree without this.
   const pressed = useRef(new Set<ShortcutModifier>());
   const track = (event: KeyboardEvent<HTMLElement>, down: boolean) => {
      const modifier = modifierCodes[event.code];
      if (modifier && down) pressed.current.add(modifier);
      else if (modifier) pressed.current.delete(modifier);
   };
   const heldKeys = (event: KeyboardEvent<HTMLElement>) => {
      const altGraph = event.getModifierState("AltGraph");
      const flags: Record<ShortcutModifier, boolean> = {
         Control: event.ctrlKey || altGraph,
         Command: event.metaKey,
         Alt: event.altKey || altGraph,
         Shift: event.shiftKey,
      };
      return modifierOrder.filter((key) => flags[key] || pressed.current.has(key)).map((key) => keyNames[key] ?? key);
   };
   const stop = () => {
      pressed.current.clear();
      setHeld([]);
      setEditing(false);
      void api.captureShortcut(false);
   };
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
         onBlur={stop}
         onKeyDown={(event) => {
            if (!editing) return;
            event.preventDefault();
            track(event, true);
            setHeld(heldKeys(event));
            if (event.key === "Escape") {
               stop();
               return;
            }
            if (modifierCodes[event.code] || ["Control", "Shift", "Alt", "Meta", "AltGraph"].includes(event.key)) return;
            if (event.key === "Backspace" && clearable) {
               onChange("");
               stop();
               return;
            }
            onChange(eventBinding(event.nativeEvent, pressed.current));
            stop();
         }}
         onKeyUp={(event) => {
            if (!editing) return;
            track(event, false);
            setHeld(heldKeys(event));
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
