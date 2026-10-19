import { Children, Fragment, isValidElement, useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { ButtonHTMLAttributes, DragEvent, ReactNode } from "react";
import { Check, LoaderCircle, X } from "lucide-react";

import { createSliderMotion } from "./slider-motion";
import { createSelectionMotion } from "./selection-motion";
import { DropdownSelect } from "./DropdownSelect";
import type { DropdownOption } from "./DropdownSelect";

export const api = window.acroClip;
export const formatSize = (bytes: number): string => (bytes >= 1e9 ? `${(bytes / 1e9).toFixed(2)} GB` : `${(bytes / 1e6).toFixed(1)} MB`);
export const formatTime = (seconds: number): string => {
   const whole = Math.max(0, Math.floor(seconds));
   return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, "0")}`;
};
export const folderName = (path: string): string => path.split(/[\\/]/).filter(Boolean).at(-1) ?? "Choose a folder";
export const age = (timestamp: number): string => {
   const minutes = Math.max(0, (Date.now() - timestamp) / 60000);
   if (minutes < 1) return "Just now";
   if (minutes < 60) return `${Math.floor(minutes)}m ago`;
   if (minutes < 1440) return `${Math.floor(minutes / 60)}h ago`;
   return new Date(timestamp).toLocaleDateString(undefined, { month: "short", day: "numeric" });
};
export type Run = (action: () => Promise<unknown>) => Promise<boolean>;
export function describeError(error: unknown): string {
   const message = error instanceof Error ? error.message : typeof error === "string" ? error : "Something went wrong. Try again.";
   return message.replace(/^Error invoking remote method '[^']+':\s*/, "").replace(/^Error:\s*/, "");
}

export type RendererFeedback = { kind: "notice"; message: string; error: boolean } | { kind: "audio-status"; message: string };
export function reportFeedback(value: RendererFeedback): void {
   window.dispatchEvent(new CustomEvent<RendererFeedback>("acroclip-feedback", { detail: value }));
}
export function fileDragProps(path: string | undefined) {
   return {
      draggable: !!path,
      onDragStart: (event: DragEvent) => {
         event.preventDefault();
         if (path) api.dragFile(path);
      },
   };
}
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
export function TabMarker() {
   const marker = useRef<HTMLSpanElement>(null);
   useLayoutEffect(() => {
      const node = marker.current;
      if (!node) return;
      const media = matchMedia("(prefers-reduced-motion: reduce)");
      const motion = createSliderMotion(
         0,
         (position) => {
            node.style.transform = `scaleY(${position / 100})`;
         },
         { request: (callback) => requestAnimationFrame(callback), cancel: (frame) => cancelAnimationFrame(frame) }
      );
      node.style.transform = "scaleY(0)";
      motion.to(100, media.matches);
      const reduce = () => {
         if (media.matches) motion.finish();
      };
      media.addEventListener("change", reduce);
      return () => {
         motion.dispose();
         media.removeEventListener("change", reduce);
      };
   }, []);
   return <span ref={marker} className="rail-marker" aria-hidden="true" />;
}
export function SelectionIndicator({ value, selector = "button.selected" }: { value: string; selector?: string }) {
   const marker = useRef<HTMLSpanElement>(null);
   const refresh = useRef<((resize: boolean) => void) | null>(null);
   useLayoutEffect(() => {
      const element = marker.current,
         parent = element?.parentElement;
      if (!element || !parent) return;
      let selectedBefore: HTMLElement | null = null,
         shown = false;
      let lastTarget = { x: 0, y: 0 },
         lastSize = { width: 0, height: 0 };
      const media = window.matchMedia("(prefers-reduced-motion: reduce)");
      const motion = createSelectionMotion(
         ({ x, y }) => {
            element.style.transform = `translate(${x}px, ${y}px)`;
         },
         { request: (callback) => requestAnimationFrame(callback), cancel: (frame) => cancelAnimationFrame(frame) }
      );
      const update = (resize: boolean) => {
         const selected = parent.querySelector<HTMLElement>(selector);
         if (!selected || !parent.getClientRects().length) {
            element.style.opacity = "0";
            shown = false;
            motion.to({ x: 0, y: 0 }, { x: 0, y: 0 }, true);
            return;
         }
         const bounds = parent.getBoundingClientRect(),
            rect = selected.getBoundingClientRect();
         const target = { x: rect.left - bounds.left - parent.clientLeft + parent.scrollLeft, y: rect.top - bounds.top - parent.clientTop + parent.scrollTop };
         element.style.width = `${rect.width}px`;
         element.style.height = `${rect.height}px`;
         const changed = selected !== selectedBefore;
         const layoutChanged =
            !changed && (target.x !== lastTarget.x || target.y !== lastTarget.y || rect.width !== lastSize.width || rect.height !== lastSize.height);
         // Layout changes never trail the selected control. Only selection changes bounce.
         if (resize || layoutChanged || changed || !shown || media.matches)
            motion.to(
               target,
               { x: Math.max(0, parent.scrollWidth - rect.width), y: Math.max(0, parent.scrollHeight - rect.height) },
               resize || layoutChanged || !shown || media.matches
            );
         element.style.opacity = "1";
         lastTarget = target;
         lastSize = { width: rect.width, height: rect.height };
         selectedBefore = selected;
         shown = true;
      };
      refresh.current = update;
      const resize = new ResizeObserver(() => update(true));
      const observe = () => {
         resize.observe(parent);
         for (const child of parent.querySelectorAll("button")) resize.observe(child);
      };
      observe();
      update(true);
      const mutations = new MutationObserver(() => {
         observe();
         update(false);
      });
      mutations.observe(parent, { subtree: true, attributes: true, attributeFilter: ["class", "hidden"], childList: true, characterData: true });
      const layout = () => update(true);
      parent.addEventListener("scroll", layout, { passive: true });
      media.addEventListener("change", layout);
      document.fonts.addEventListener("loadingdone", layout);
      return () => {
         motion.dispose();
         refresh.current = null;
         resize.disconnect();
         mutations.disconnect();
         parent.removeEventListener("scroll", layout);
         media.removeEventListener("change", layout);
         document.fonts.removeEventListener("loadingdone", layout);
      };
   }, [selector]);
   useLayoutEffect(() => {
      refresh.current?.(false);
   }, [value]);
   return <span ref={marker} className="selection-indicator" aria-hidden="true" />;
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
export function Menu({
   trigger,
   children,
   label,
   className = "",
   columns = 1,
}: {
   trigger: ReactNode;
   children: ReactNode;
   label: string;
   className?: string;
   columns?: number;
}) {
   const [open, setOpen] = useState(false);
   const ref = useRef<HTMLDivElement>(null);
   const menu = useRef<HTMLDivElement>(null);
   const [position, setPosition] = useState({ top: 0, left: 0 });
   useLayoutEffect(() => {
      if (!open || !ref.current || !menu.current) return;
      const anchor = ref.current.getBoundingClientRect();
      const bounds = menu.current.getBoundingClientRect();
      setPosition({
         left: Math.max(8, Math.min(window.innerWidth - bounds.width - 8, anchor.right - bounds.width)),
         top: anchor.bottom + bounds.height + 8 > window.innerHeight ? Math.max(8, anchor.top - bounds.height - 5) : anchor.bottom + 5,
      });
      menu.current.querySelector<HTMLButtonElement>("button:not(:disabled)")?.focus();
   }, [open]);
   useEffect(() => {
      if (!open) return;
      const close = (event: PointerEvent) => {
         if (!ref.current?.contains(event.target as Node) && !menu.current?.contains(event.target as Node)) setOpen(false);
      };
      const key = (event: KeyboardEvent) => {
         if (event.key === "Escape") {
            setOpen(false);
            ref.current?.querySelector("button")?.focus();
         }
      };
      window.addEventListener("pointerdown", close);
      window.addEventListener("keydown", key);
      return () => {
         window.removeEventListener("pointerdown", close);
         window.removeEventListener("keydown", key);
      };
   }, [open]);
   return (
      <div className={`menu-wrap ${className}`} ref={ref}>
         <IconButton
            label={label}
            aria-expanded={open}
            aria-haspopup="menu"
            onClick={() => setOpen(!open)}
            onKeyDown={(event) => {
               if (event.key === "ArrowDown") {
                  event.preventDefault();
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
                     setOpen(false);
                     ref.current?.querySelector("button")?.focus();
                  }}
                  onKeyDown={(event) => {
                     if (event.key === "Escape") {
                        event.preventDefault();
                        event.stopPropagation();
                        setOpen(false);
                        ref.current?.querySelector("button")?.focus();
                        return;
                     }
                     if (!["ArrowDown", "ArrowUp", "ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
                     event.preventDefault();
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
               document.body
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
      <button role="menuitem" className={danger ? "danger" : ""} onClick={onClick} disabled={disabled}>
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
export { Slider } from "./Slider";

export interface DialogRequest {
   title: string;
   detail?: string;
   confirm: string;
   initial?: string;
   danger?: boolean;
   resolve: (value: string | boolean | null) => void;
}
export function Dialog({ request, close }: { request: DialogRequest; close: () => void }) {
   const [value, setValue] = useState(request.initial ?? "");
   const input = useRef<HTMLInputElement>(null);
   const card = useRef<HTMLDivElement>(null);
   const cancel = () => {
      request.resolve(null);
      close();
   };
   const submit = () => {
      request.resolve(request.initial === undefined ? true : value.trim());
      close();
   };
   useEffect(() => {
      input.current?.focus();
      if (!input.current) card.current?.querySelector<HTMLButtonElement>("button")?.focus();
   }, []);
   return (
      <div className="modal-backdrop" onClick={cancel}>
         <div
            className="dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="dialog-title"
            ref={card}
            onClick={(event) => event.stopPropagation()}
            onKeyDown={(event) => {
               if (event.key === "Escape") cancel();
               if (event.key === "Tab") {
                  const nodes = card.current?.querySelectorAll<HTMLElement>("button,input");
                  const first = nodes?.[0];
                  const last = nodes?.[nodes.length - 1];
                  if (event.shiftKey && document.activeElement === first) {
                     event.preventDefault();
                     last?.focus();
                  } else if (!event.shiftKey && document.activeElement === last) {
                     event.preventDefault();
                     first?.focus();
                  }
               }
            }}
         >
            <IconButton label="Close" className="dialog-close" onClick={cancel}>
               <X size={18} />
            </IconButton>
            <h2 id="dialog-title">{request.title}</h2>
            {request.detail && <p>{request.detail}</p>}
            <form
               onSubmit={(event) => {
                  event.preventDefault();
                  submit();
               }}
            >
               {request.initial !== undefined && (
                  <input ref={input} aria-label={request.title} value={value} onChange={(event) => setValue(event.target.value)} maxLength={150} />
               )}
               <div className="dialog-actions">
                  <Button type="button" onClick={cancel}>
                     Cancel
                  </Button>
                  <Button className={request.danger ? "destructive" : "primary"} disabled={request.initial !== undefined && !value.trim()}>
                     <Check size={16} />
                     {request.confirm}
                  </Button>
               </div>
            </form>
         </div>
      </div>
   );
}

export function DialogPanel({ title, close, children }: { title: string; close: () => void; children: ReactNode }) {
   const card = useRef<HTMLDivElement>(null),
      titleId = useId();
   useLayoutEffect(() => {
      const previous = document.activeElement;
      card.current?.querySelector<HTMLElement>('[role="combobox"]:not(:disabled),input:not(:disabled),button:not(:disabled)')?.focus();
      return () => {
         if (previous instanceof HTMLElement && previous.isConnected) previous.focus({ preventScroll: true });
      };
   }, []);
   return createPortal(
      <div className="modal-backdrop" onClick={close}>
         <div
            ref={card}
            className="dialog dialog-panel"
            role="dialog"
            aria-modal="true"
            aria-labelledby={titleId}
            onClick={(event) => event.stopPropagation()}
            onKeyDown={(event) => {
               if (event.key === "Escape") {
                  event.stopPropagation();
                  close();
               }
               if (event.key === "Tab") {
                  const nodes = [...(card.current?.querySelectorAll<HTMLElement>('button:not(:disabled),input:not(:disabled),[tabindex="0"]') ?? [])].filter(
                     (node) => node.getClientRects().length
                  );
                  const first = nodes[0],
                     last = nodes.at(-1);
                  if (event.shiftKey && document.activeElement === first) {
                     event.preventDefault();
                     last?.focus();
                  } else if (!event.shiftKey && document.activeElement === last) {
                     event.preventDefault();
                     first?.focus();
                  }
               }
            }}
         >
            <h2 id={titleId}>{title}</h2>
            {children}
            <IconButton label={`Close ${title.toLowerCase()}`} className="dialog-close" onClick={close}>
               <X size={17} />
            </IconButton>
         </div>
      </div>,
      document.body
   );
}
