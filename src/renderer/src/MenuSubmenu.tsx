import { createContext, useCallback, useContext, useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { ReactNode } from "react";
import { Check, ChevronRight } from "lucide-react";
import { submenuPosition } from "./menu-position";

export const MenuFamilyContext = createContext({ id: "", closing: false, dismiss: () => {} });
export function MenuSubmenu({ label, icon, disabled = false, children }: { label: string; icon?: ReactNode; disabled?: boolean; children: ReactNode }) {
   const family = useContext(MenuFamilyContext);
   const id = useId();
   const trigger = useRef<HTMLButtonElement>(null);
   const panel = useRef<HTMLDivElement>(null);
   const keyboard = useRef(false);
   const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
   const [phase, setPhase] = useState<"closed" | "open" | "closing">("closed");
   const [position, setPosition] = useState({ left: 0, top: 0, transformOrigin: "top left" });
   const clearClose = useCallback(() => {
      if (closeTimer.current) clearTimeout(closeTimer.current);
      closeTimer.current = null;
   }, []);
   const close = useCallback(() => setPhase((current) => (current === "closed" ? current : "closing")), []);
   const scheduleClose = () => {
      clearClose();
      closeTimer.current = setTimeout(close, 180);
   };
   const open = (focus = false) => {
      if (disabled) return;
      clearClose();
      if (focus && phase === "open") {
         panel.current?.querySelector<HTMLButtonElement>("button:not(:disabled)")?.focus();
         return;
      }
      keyboard.current = focus;
      setPhase("open");
   };
   useEffect(() => clearClose, [clearClose]);
   useEffect(() => {
      if (disabled || family.closing) close();
   }, [disabled, family.closing, close]);
   useEffect(() => {
      if (phase !== "closing") return;
      const timer = window.setTimeout(() => setPhase("closed"), 150);
      return () => window.clearTimeout(timer);
   }, [phase]);
   useLayoutEffect(() => {
      if (phase !== "open" || !panel.current || !trigger.current) return;
      const place = () => {
         if (panel.current && trigger.current)
            setPosition(
               submenuPosition(
                  trigger.current.getBoundingClientRect(),
                  { width: panel.current.offsetWidth, height: panel.current.offsetHeight },
                  { width: innerWidth, height: innerHeight }
               )
            );
      };
      place();
      if (keyboard.current) {
         panel.current.querySelector<HTMLButtonElement>("button:not(:disabled)")?.focus();
         keyboard.current = false;
      }
      const observer = new ResizeObserver(place);
      observer.observe(panel.current);
      window.addEventListener("resize", place);
      return () => {
         observer.disconnect();
         window.removeEventListener("resize", place);
      };
   }, [phase]);
   return (
      <div className="menu-submenu" onPointerEnter={() => open()} onPointerLeave={scheduleClose}>
         <button
            ref={trigger}
            id={id}
            role="menuitem"
            className="menu-submenu-trigger"
            tabIndex={-1}
            disabled={disabled}
            aria-haspopup="menu"
            aria-expanded={phase === "open"}
            onClick={(event) => {
               event.stopPropagation();
               open(true);
            }}
            onBlur={(event) => {
               if (!panel.current?.contains(event.relatedTarget as Node | null)) close();
            }}
            onKeyDown={(event) => {
               if (event.key === "ArrowRight" || event.key === "Enter" || event.key === " ") {
                  event.preventDefault();
                  event.stopPropagation();
                  open(true);
               }
            }}
         >
            {icon}
            {label}
            <ChevronRight size={14} aria-hidden="true" />
         </button>
         {phase !== "closed" &&
            createPortal(
               <div
                  ref={panel}
                  className="menu floating-menu submenu"
                  style={position}
                  role="menu"
                  aria-labelledby={id}
                  data-menu-family={family.id}
                  data-closing={phase === "closing" ? true : undefined}
                  inert={phase !== "open" || family.closing}
                  aria-hidden={phase !== "open" || family.closing}
                  onPointerEnter={(event) => {
                     event.stopPropagation();
                     clearClose();
                  }}
                  onPointerLeave={(event) => {
                     event.stopPropagation();
                     scheduleClose();
                  }}
                  onAnimationEnd={(event) => {
                     if (phase === "closing" && event.target === event.currentTarget) setPhase("closed");
                  }}
                  onKeyDown={(event) => {
                     if (event.key === "Escape" || event.key === "ArrowLeft") {
                        event.preventDefault();
                        event.stopPropagation();
                        close();
                        trigger.current?.focus();
                        return;
                     }
                     if (event.key === "Tab") {
                        family.dismiss();
                        trigger.current?.focus();
                        return;
                     }
                     if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) return;
                     event.preventDefault();
                     event.stopPropagation();
                     const items = [...(panel.current?.querySelectorAll<HTMLButtonElement>("button:not(:disabled)") ?? [])];
                     const current = items.indexOf(document.activeElement as HTMLButtonElement);
                     const next =
                        event.key === "Home"
                           ? 0
                           : event.key === "End"
                             ? items.length - 1
                             : (current + (event.key === "ArrowDown" ? 1 : -1) + items.length) % items.length;
                     items[next]?.focus();
                  }}
               >
                  {children}
               </div>,
               document.fullscreenElement ?? document.body
            )}
      </div>
   );
}
export function MenuCheckboxItem({ checked, onClick, children }: { checked: boolean; onClick: () => void; children: ReactNode }) {
   return (
      <button
         role="menuitemcheckbox"
         aria-checked={checked}
         tabIndex={-1}
         onClick={(event) => {
            event.stopPropagation();
            onClick();
         }}
      >
         {children}
         {checked && <Check size={14} className="menu-item-check" aria-hidden="true" />}
      </button>
   );
}
