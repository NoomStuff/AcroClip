// Copyright (c) 2026 NoomStuff
// SPDX-License-Identifier: MIT
// Adapted from AttaCut's DropdownSelect. See licenses/AttaCut-MIT.txt.
import { useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import type { CSSProperties, KeyboardEvent, ReactNode } from "react";
import { createPortal } from "react-dom";
import { Check, ChevronDown } from "lucide-react";

export interface DropdownOption {
   value: string;
   label: string;
   disabled?: boolean;
}
export function DropdownSelect({
   label,
   options,
   value,
   onChange,
   disabled = false,
   className = "",
   triggerContent,
   placement,
   iconOnly = false,
}: {
   label: string;
   options: DropdownOption[];
   value: string;
   onChange: (value: string) => void;
   disabled?: boolean;
   className?: string;
   triggerContent?: ReactNode;
   placement?: "up";
   iconOnly?: boolean;
}) {
   const [open, setOpen] = useState(false);
   const [position, setPosition] = useState<CSSProperties>({});
   const root = useRef<HTMLDivElement>(null);
   const menu = useRef<HTMLDivElement>(null);
   const trigger = useRef<HTMLButtonElement>(null);
   const listId = useId();
   const search = useRef({ text: "", time: 0 });
   const selected = options.find((option) => option.value === value);
   const available = options.some((option) => !option.disabled);
   const shown = open && !disabled && available;
   useEffect(() => {
      if (disabled || !available) setOpen(false);
   }, [disabled, available]);
   const close = (restore = true) => {
      setOpen(false);
      if (restore) trigger.current?.focus();
   };
   const navigate = (event: KeyboardEvent<HTMLElement>) => {
      const buttons = Array.from(menu.current?.querySelectorAll<HTMLButtonElement>('[role="option"]:not(:disabled)') ?? []);
      const index = buttons.indexOf(document.activeElement as HTMLButtonElement);
      if (["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) {
         event.preventDefault();
         event.stopPropagation();
         buttons[
            event.key === "Home"
               ? 0
               : event.key === "End"
                 ? buttons.length - 1
                 : (index + (event.key === "ArrowDown" ? 1 : -1) + buttons.length) % buttons.length
         ]?.focus();
      } else if (event.key === "Escape") {
         event.preventDefault();
         event.stopPropagation();
         close();
      } else if (event.key === "Tab") {
         // Restore the anchor before the browser chooses the next tab stop, since the menu is portaled.
         close();
      } else if (event.key.length === 1 && !event.ctrlKey && !event.metaKey && event.key !== " ") {
         event.preventDefault();
         const now = Date.now();
         search.current.text = (now - search.current.time < 700 ? search.current.text : "") + event.key.toLocaleLowerCase();
         search.current.time = now;
         buttons.find((button) => button.textContent?.trim().toLocaleLowerCase().startsWith(search.current.text))?.focus();
      }
   };
   useLayoutEffect(() => {
      if (!shown) return;
      const place = () => {
         const anchor = trigger.current?.getBoundingClientRect();
         const popup = menu.current;
         if (!anchor || !popup) return;
         const below = window.innerHeight - anchor.bottom - 18;
         const above = anchor.top - 18;
         const height = Math.min(popup.scrollHeight, 280);
         const up = (placement === "up" && above >= height) || (below < height && above > below);
         const maxHeight = Math.max(40, Math.min(280, up ? above : below));
         const width = Math.min(Math.max(anchor.width, 220), window.innerWidth - 24);
         setPosition({
            width,
            maxHeight,
            left: Math.max(12, Math.min(anchor.left, window.innerWidth - width - 12)),
            top: up ? anchor.top - Math.min(height, maxHeight) - 6 : anchor.bottom + 6,
            transformOrigin: up ? "left bottom" : "left top",
         });
      };
      place();
      const option =
         menu.current?.querySelector<HTMLButtonElement>('[role="option"][aria-selected="true"]:not(:disabled)') ??
         menu.current?.querySelector<HTMLButtonElement>('[role="option"]:not(:disabled)');
      option?.focus({ preventScroll: true });
      option?.scrollIntoView({ block: "nearest" });
      const outside = (event: PointerEvent) => {
         if (!root.current?.contains(event.target as Node) && !menu.current?.contains(event.target as Node)) setOpen(false);
      };
      const escape = (event: globalThis.KeyboardEvent) => {
         if (event.key !== "Escape") return;
         event.preventDefault();
         event.stopPropagation();
         setOpen(false);
         trigger.current?.focus();
      };
      window.addEventListener("pointerdown", outside);
      window.addEventListener("keydown", escape, true);
      window.addEventListener("resize", place);
      window.addEventListener("scroll", place, true);
      const observer = new ResizeObserver(place);
      if (trigger.current) observer.observe(trigger.current);
      return () => {
         window.removeEventListener("pointerdown", outside);
         window.removeEventListener("keydown", escape, true);
         window.removeEventListener("resize", place);
         window.removeEventListener("scroll", place, true);
         observer.disconnect();
      };
   }, [placement, shown]);
   return (
      <div className={`custom-select ${className}`} ref={root}>
         <button
            ref={trigger}
            type="button"
            role="combobox"
            className={`select-trigger ${iconOnly ? "button icon-only" : ""}`}
            aria-label={label}
            title={label}
            aria-controls={shown ? listId : undefined}
            aria-haspopup="listbox"
            aria-expanded={shown}
            disabled={disabled || !available}
            data-value={value}
            onClick={() => setOpen((current) => !current)}
            onKeyDown={(event) => {
               if (["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) {
                  event.preventDefault();
                  setOpen(true);
               }
            }}
         >
            <span>{triggerContent ?? selected?.label ?? ""}</span>
            {!iconOnly && <ChevronDown size={14} className="select-chevron" aria-hidden="true" />}
         </button>
         {shown &&
            createPortal(
               <div
                  ref={menu}
                  id={listId}
                  role="listbox"
                  aria-label={label}
                  className={`select-menu ${className ? `${className}-menu` : ""}`}
                  style={position}
                  onKeyDown={navigate}
               >
                  {options.map((option) => (
                     <button
                        type="button"
                        key={option.value}
                        role="option"
                        aria-selected={option.value === value}
                        disabled={option.disabled}
                        data-value={option.value}
                        tabIndex={-1}
                        onClick={() => {
                           onChange(option.value);
                           close();
                        }}
                     >
                        <span>{option.label}</span>
                        <span className="select-check" aria-hidden="true">
                           {option.value === value && <Check size={14} />}
                        </span>
                     </button>
                  ))}
               </div>,
               document.fullscreenElement ?? document.body
            )}
      </div>
   );
}
