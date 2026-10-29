import { Children, Fragment, isValidElement, useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { ButtonHTMLAttributes, InputHTMLAttributes, ReactNode } from "react";
import { LoaderCircle } from "lucide-react";

import { SelectionIndicator } from "./SelectionIndicator";
import { DropdownSelect } from "./DropdownSelect";
import type { DropdownOption } from "./DropdownSelect";

export function HeaderActions({ children, className = "" }: { children: ReactNode; className?: string }) {
   return <div className={`header-actions ${className}`}>{children}</div>;
}
export function ContextHeader({
   label,
   title,
   icon,
   actions,
   onTitleClick,
   hint,
   className = "",
   status = false,
}: {
   label: string;
   title: string;
   icon: ReactNode;
   actions?: ReactNode;
   onTitleClick?: () => void;
   hint?: string;
   className?: string;
   status?: boolean;
}) {
   const content = (
      <>
         {icon}
         <span>{title}</span>
      </>
   );
   return (
      <div
         className={`context-header ${actions ? "action-header" : ""} ${className}`}
         data-has-actions={!!actions || undefined}
         role={status ? "status" : undefined}
      >
         <span className="context-header-label">{label}</span>
         {onTitleClick ? (
            <button className="context-header-title" title={hint ?? title} onClick={onTitleClick}>
               {content}
            </button>
         ) : (
            <div className="context-header-title" title={hint ?? title}>
               {content}
            </div>
         )}
         {actions && <HeaderActions className="context-header-actions">{actions}</HeaderActions>}
      </div>
   );
}

export function Button({
   children,
   className = "",
   busy = false,
   busyIndicator = "spinner",
   progress,
   ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { busy?: boolean; busyIndicator?: "spinner" | "content"; progress?: number }) {
   return (
      <button {...props} disabled={props.disabled || busy} className={`button ${className}`} data-progress={progress} aria-busy={busy || undefined}>
         {progress !== undefined && <span className="button-progress" aria-hidden="true" style={{ width: `${Math.max(0, Math.min(1, progress)) * 100}%` }} />}
         {busy && busyIndicator === "spinner" && <LoaderCircle size={16} className="spin" />}
         {children}
      </button>
   );
}
export function IconButton({ children, label, className = "", ...props }: ButtonHTMLAttributes<HTMLButtonElement> & { label: string }) {
   return (
      <button type="button" {...props} title={label} aria-label={label} className={`icon-button ${className}`}>
         {children}
      </button>
   );
}
export function Segmented<T extends string>({
   value,
   values,
   onChange,
   label,
}: {
   value: T;
   values: { value: T; label: string; disabled?: boolean }[];
   onChange: (value: T) => void;
   label: string;
}) {
   return (
      <div className="segmented moving-selection" role="group" aria-label={label}>
         <SelectionIndicator value={value} />
         {values.map((item) => (
            <button
               key={item.value}
               className={value === item.value ? "selected" : ""}
               aria-pressed={value === item.value}
               disabled={item.disabled}
               onClick={() => onChange(item.value)}
            >
               {item.label}
            </button>
         ))}
      </div>
   );
}
export function Toggle({
   checked,
   onChange,
   label,
   detail,
   disabled = false,
}: {
   checked: boolean;
   onChange: (value: boolean) => void;
   label: string;
   detail?: string;
   disabled?: boolean;
}) {
   const detailId = useId();
   return (
      <label className={`toggle-row ${disabled ? "disabled" : ""}`}>
         <span>
            <span className="field-label">{label}</span>
            {detail && (
               <span className="field-detail" id={detailId}>
                  {detail}
               </span>
            )}
         </span>
         <input
            type="checkbox"
            aria-label={label}
            aria-describedby={detail ? detailId : undefined}
            checked={checked}
            onChange={(event) => onChange(event.target.checked)}
            disabled={disabled}
         />
         <span className="switch" aria-hidden="true">
            <span className="switch-thumb">
               <span className="switch-mark" />
            </span>
         </span>
      </label>
   );
}
export function Field({ label, detail, children, stacked = false }: { label: string; detail?: string; children: ReactNode; stacked?: boolean }) {
   return (
      <div className={`field ${stacked ? "field-stacked" : ""}`}>
         <div>
            <span className="field-label">{label}</span>
            {detail && <p className="field-detail">{detail}</p>}
         </div>
         <div className="field-control">{children}</div>
      </div>
   );
}
export function NumberInput({
   value,
   unit,
   onValueChange,
   ...props
}: Omit<InputHTMLAttributes<HTMLInputElement>, "type" | "value" | "onChange"> & {
   value: number;
   unit: string;
   onValueChange: (value: number) => void;
}) {
   return (
      <div className="number-unit">
         <input {...props} type="number" value={Number.isNaN(value) ? "" : value} onChange={(event) => onValueChange(event.currentTarget.valueAsNumber)} />
         <span>{unit}</span>
      </div>
   );
}
export function Empty({ icon, title, detail, children }: { icon: ReactNode; title: string; detail?: string; children?: ReactNode }) {
   return (
      <div className="empty">
         <div className="empty-icon">{icon}</div>
         <h2>{title}</h2>
         {detail && <p>{detail}</p>}
         {children}
      </div>
   );
}
export interface ContextMenuRequest {
   left: number;
   top: number;
   restoreFocus: HTMLElement;
}
export function Menu({
   trigger,
   children,
   label,
   className = "",
   columns = 1,
   contextRequest,
   onContextClose,
}: {
   trigger: ReactNode;
   children: ReactNode;
   label: string;
   className?: string;
   columns?: number;
   contextRequest?: ContextMenuRequest | undefined;
   onContextClose?: (() => void) | undefined;
}) {
   const [open, setOpen] = useState(false);
   const [contextAnchor, setContextAnchor] = useState<ContextMenuRequest | null>(null);
   const contextClose = useRef(onContextClose);
   contextClose.current = onContextClose;
   const dismiss = useCallback(() => {
      setOpen(false);
      if (contextAnchor) contextClose.current?.();
   }, [contextAnchor]);
   useEffect(() => {
      if (contextRequest) {
         setContextAnchor(contextRequest);
         setOpen(true);
      } else {
         setContextAnchor(null);
         setOpen(false);
      }
   }, [contextRequest]);
   const ref = useRef<HTMLDivElement>(null);
   const menu = useRef<HTMLDivElement>(null);
   const [position, setPosition] = useState({ top: 0, left: 0 });
   useLayoutEffect(() => {
      if (!open || !ref.current || !menu.current) return;
      const place = () => {
         if (!ref.current || !menu.current) return;
         const anchor = ref.current.getBoundingClientRect();
         const width = menu.current.offsetWidth;
         const height = menu.current.offsetHeight;
         setPosition({
            left: Math.max(8, Math.min(window.innerWidth - width - 8, contextAnchor?.left ?? anchor.right - width)),
            top: contextAnchor
               ? Math.max(8, Math.min(window.innerHeight - height - 8, contextAnchor.top))
               : anchor.bottom + height + 8 > window.innerHeight
                 ? Math.max(8, anchor.top - height - 5)
                 : anchor.bottom + 5,
         });
      };
      place();
      menu.current.querySelector<HTMLButtonElement>("button:not(:disabled)")?.focus();
      const scroll = (event: Event) => {
         if (contextAnchor && !menu.current?.contains(event.target as Node)) dismiss();
         else place();
      };
      window.addEventListener("resize", place);
      window.addEventListener("scroll", scroll, true);
      const observer = new ResizeObserver(place);
      observer.observe(menu.current);
      observer.observe(ref.current);
      return () => {
         observer.disconnect();
         window.removeEventListener("resize", place);
         window.removeEventListener("scroll", scroll, true);
      };
   }, [open, contextAnchor, dismiss]);
   const restoreFocus = useCallback(
      () => (contextAnchor?.restoreFocus.isConnected ? contextAnchor.restoreFocus : ref.current?.querySelector("button"))?.focus(),
      [contextAnchor]
   );
   useEffect(() => {
      if (!open) return;
      const close = (event: PointerEvent) => {
         if (!ref.current?.contains(event.target as Node) && !menu.current?.contains(event.target as Node)) dismiss();
      };
      const key = (event: KeyboardEvent) => {
         if (event.key === "Escape") {
            dismiss();
            restoreFocus();
         }
      };
      window.addEventListener("pointerdown", close);
      window.addEventListener("keydown", key);
      return () => {
         window.removeEventListener("pointerdown", close);
         window.removeEventListener("keydown", key);
      };
   }, [open, restoreFocus, dismiss]);
   return (
      <div className={`menu-wrap ${className}`} ref={ref}>
         <IconButton
            label={label}
            aria-expanded={open}
            aria-haspopup="menu"
            onClick={() => {
               setContextAnchor(null);
               if (open) dismiss();
               else setOpen(true);
            }}
            onKeyDown={(event) => {
               if (event.key === "ArrowDown") {
                  event.preventDefault();
                  setContextAnchor(null);
                  setOpen(true);
               }
            }}
         >
            {trigger}
         </IconButton>
         {open &&
            createPortal(
               <div
                  ref={menu}
                  className={`menu floating-menu ${className ? `${className}-popup` : ""}`}
                  style={position}
                  role="menu"
                  aria-label={label}
                  onClick={() => {
                     dismiss();
                     restoreFocus();
                  }}
                  onKeyDown={(event) => {
                     if (event.key === "Tab") {
                        // Restore the anchor so Tab continues in the original document order.
                        dismiss();
                        restoreFocus();
                        return;
                     }
                     if (event.key === "Escape") {
                        event.preventDefault();
                        event.stopPropagation();
                        dismiss();
                        restoreFocus();
                        return;
                     }
                     if (!["ArrowDown", "ArrowUp", "ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
                     event.preventDefault();
                     event.stopPropagation();
                     const items = Array.from(menu.current?.querySelectorAll<HTMLButtonElement>("button:not(:disabled)") ?? []);
                     const index = items.indexOf(document.activeElement as HTMLButtonElement);
                     const next =
                        event.key === "Home"
                           ? 0
                           : event.key === "End"
                             ? items.length - 1
                             : (index +
                                  (event.key === "ArrowDown" ? columns : event.key === "ArrowUp" ? -columns : event.key === "ArrowRight" ? 1 : -1) +
                                  items.length) %
                               items.length;
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
export function MenuItem({
   children,
   onClick,
   danger = false,
   disabled = false,
}: {
   children: ReactNode;
   onClick: () => void;
   danger?: boolean;
   disabled?: boolean;
}) {
   return (
      <button role="menuitem" tabIndex={-1} className={danger ? "danger" : ""} onClick={onClick} disabled={disabled}>
         {children}
      </button>
   );
}
export function Select({
   value,
   onChange,
   label,
   children,
   disabled = false,
   className = "",
}: {
   value: string;
   onChange: (value: string) => void;
   label: string;
   children: ReactNode;
   disabled?: boolean;
   className?: string;
}) {
   const options: DropdownOption[] = [];
   const collect = (nodes: ReactNode) =>
      Children.forEach(nodes, (child) => {
         if (!isValidElement<{ value?: string | number; disabled?: boolean; children?: ReactNode }>(child)) return;
         if (child.type === Fragment) collect(child.props.children);
         else if (child.type === "option")
            options.push({
               value: String(child.props.value ?? ""),
               label: Children.toArray(child.props.children).join(""),
               ...(child.props.disabled === undefined ? {} : { disabled: child.props.disabled }),
            });
      });
   collect(children);
   return <DropdownSelect value={value} onChange={onChange} label={label} options={options} disabled={disabled} className={className} />;
}
