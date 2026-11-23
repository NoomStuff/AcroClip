import { createContext, useCallback, useContext, useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useMenuHighlight } from "./MenuHighlight";
import type { CSSProperties, ReactNode } from "react";
import { Check, ChevronRight } from "lucide-react";
import { insidePolygon, submenuAimArea, submenuPosition } from "./menu-position";

/** Shared by one menu's submenus, so only one is open and a pointer aiming at it does not open the ones it crosses. */
export type SubmenuCoordinator = {
   active: { id: string; dismiss: () => void; aiming: () => boolean } | null;
   waiting: { id: string; open: () => void } | null;
};
export const createSubmenuCoordinator = (): SubmenuCoordinator => ({ active: null, waiting: null });
export const MenuFamilyContext = createContext({ id: "", closing: false, dismiss: () => {}, submenus: createSubmenuCoordinator() });

// How long a pointer may rest on the way to a submenu before it counts as having stopped aiming.
const aimPause = 260;
export function MenuSubmenu({
   label,
   icon,
   disabled = false,
   danger = false,
   children,
}: {
   label: string;
   icon?: ReactNode;
   disabled?: boolean;
   danger?: boolean;
   children: ReactNode;
}) {
   const family = useContext(MenuFamilyContext);
   const id = useId();
   const trigger = useRef<HTMLButtonElement>(null);
   const panel = useRef<HTMLDivElement>(null);
   const keyboard = useRef(false);
   const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
   const [phase, setPhase] = useState<"closed" | "open" | "closing">("closed");
   const [position, setPosition] = useState({ left: 0, top: 0, transformOrigin: "top left" });
   const highlight = useMenuHighlight();
   const clearHighlight = highlight.clear;
   useEffect(() => {
      if (phase === "closed") clearHighlight();
   }, [phase, clearHighlight]);
   const clearClose = useCallback(() => {
      if (closeTimer.current) clearTimeout(closeTimer.current);
      closeTimer.current = null;
   }, []);
   const close = useCallback(() => setPhase((current) => (current === "closed" ? current : "closing")), []);
   const coordinator = family.submenus;
   const aim = useRef<(() => void) | null>(null);
   const stopAim = useCallback(() => {
      aim.current?.();
      aim.current = null;
   }, []);
   const closeNow = useCallback(() => {
      stopAim();
      clearClose();
      close();
      if (coordinator.active?.id === id) coordinator.active = null;
      const waiting = coordinator.waiting;
      coordinator.waiting = null;
      waiting?.open();
   }, [stopAim, clearClose, close, coordinator, id]);
   const scheduleClose = () => {
      clearClose();
      closeTimer.current = setTimeout(closeNow, 180);
   };
   const open = (focus = false) => {
      if (disabled) return;
      clearClose();
      stopAim();
      if (coordinator.waiting?.id === id) coordinator.waiting = null;
      const active = coordinator.active;
      if (active && active.id !== id) active.dismiss();
      coordinator.active = { id, dismiss: closeNow, aiming: () => aim.current !== null };
      if (focus && phase === "open") {
         panel.current?.querySelector<HTMLButtonElement>("button:not(:disabled)")?.focus({ preventScroll: true });
         return;
      }
      keyboard.current = focus;
      setPhase("open");
   };
   const hover = () => {
      const active = coordinator.active;
      // Another submenu is still being aimed at, so this one waits until that aim ends.
      if (active && active.id !== id && active.aiming()) {
         coordinator.waiting = { id, open: () => open() };
         return;
      }
      open();
   };
   const startAim = (x: number, y: number) => {
      if (!panel.current || !trigger.current) return scheduleClose();
      stopAim();
      clearClose();
      const area = submenuAimArea({ x, y }, trigger.current.getBoundingClientRect(), panel.current.getBoundingClientRect());
      let pause = setTimeout(closeNow, aimPause);
      const move = (event: PointerEvent) => {
         const target = event.target instanceof Node ? event.target : null;
         if (panel.current?.contains(target) || trigger.current?.contains(target)) return stopAim();
         if (!insidePolygon({ x: event.clientX, y: event.clientY }, area)) return closeNow();
         clearTimeout(pause);
         pause = setTimeout(closeNow, aimPause);
      };
      document.addEventListener("pointermove", move, true);
      aim.current = () => {
         clearTimeout(pause);
         document.removeEventListener("pointermove", move, true);
      };
   };
   useEffect(() => {
      if (phase === "open") return;
      stopAim();
      if (coordinator.active?.id === id) coordinator.active = null;
   }, [phase, stopAim, coordinator, id]);
   useEffect(
      () => () => {
         stopAim();
         if (coordinator.active?.id === id) coordinator.active = null;
         if (coordinator.waiting?.id === id) coordinator.waiting = null;
      },
      [stopAim, coordinator, id]
   );
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
         panel.current.querySelector<HTMLButtonElement>("button:not(:disabled)")?.focus({ preventScroll: true });
         keyboard.current = false;
      }
      const observer = new ResizeObserver(place);
      observer.observe(panel.current);
      window.addEventListener("resize", place);
      // Opened while the parent menu still scales in, the trigger's rect was mid-animation. Place again once it lands.
      const parent = trigger.current.closest<HTMLElement>(".floating-menu");
      const landed = (event: AnimationEvent) => {
         if (event.target === parent) place();
      };
      parent?.addEventListener("animationend", landed);
      return () => {
         observer.disconnect();
         window.removeEventListener("resize", place);
         parent?.removeEventListener("animationend", landed);
      };
   }, [phase]);
   return (
      <div className="menu-submenu">
         <button
            ref={trigger}
            id={id}
            role="menuitem"
            className={danger ? "menu-submenu-trigger danger" : "menu-submenu-trigger"}
            tabIndex={-1}
            disabled={disabled}
            aria-haspopup="menu"
            aria-expanded={phase === "open"}
            onPointerEnter={hover}
            onPointerLeave={(event) => {
               if (coordinator.waiting?.id === id) coordinator.waiting = null;
               if (phase !== "open") return;
               if (panel.current?.contains(event.relatedTarget as Node | null)) return;
               startAim(event.clientX, event.clientY);
            }}
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
                  onPointerOver={highlight.handlers.onPointerOver}
                  onFocus={highlight.handlers.onFocus}
                  onPointerEnter={(event) => {
                     event.stopPropagation();
                     stopAim();
                     clearClose();
                  }}
                  onPointerLeave={(event) => {
                     event.stopPropagation();
                     highlight.handlers.onPointerLeave(event);
                     if (!trigger.current?.contains(event.relatedTarget as Node | null)) scheduleClose();
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
                  {highlight.highlight}
                  {children}
               </div>,
               document.fullscreenElement ?? document.body
            )}
      </div>
   );
}
/** A `--category-color` in `style` colors the item and its check while checked. */
export function MenuCheckboxItem({ checked, onClick, style, children }: { checked: boolean; onClick: () => void; style?: CSSProperties; children: ReactNode }) {
   return (
      <button
         role="menuitemcheckbox"
         style={style}
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

/** A labelled set of choices that stays open, so related choices can be made in one visit. */
export function MenuRadioGroup({ label, children }: { label: string; children: ReactNode }) {
   return (
      <div role="group" aria-label={label}>
         <div className="menu-label" aria-hidden="true">
            {label}
         </div>
         {children}
      </div>
   );
}
export function MenuRadioItem({ checked, onClick, children }: { checked: boolean; onClick: () => void; children: ReactNode }) {
   return (
      <button
         role="menuitemradio"
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
