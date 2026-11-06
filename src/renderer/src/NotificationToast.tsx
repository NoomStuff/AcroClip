import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { AlertCircle, Check, ChevronDown, TriangleAlert, X } from "lucide-react";
import { closed, dismiss, expire, settle, useNotifications, type NotificationEntry, type NotificationTone } from "./notifications";
import { IconButton } from "./ui";

const NOTICE_MS = 4000;
const ERROR_MS = 6500;
/** Older toasts wait their turn rather than piling up the screen. */
const MAX_TOASTS = 3;
const MORPH_MS = 420;

export function NotificationIcon({ tone, size }: { tone: NotificationTone; size: number }) {
   if (tone === "error") return <AlertCircle size={size} />;
   if (tone === "warning") return <TriangleAlert size={size} />;
   return <Check size={size} />;
}

/** Chips and the overflow button list the ids they stand for, space separated. */
export const chipSelector = (id: number) => `[data-notification-chip~="${id}"]`;

const reducedMotion = () => window.matchMedia("(prefers-reduced-motion: reduce)").matches;

/**
 * Keyframes that carry the toast box onto the chip's box and colors, so the
 * swap at the end is invisible. Scaling keeps it on the compositor; the
 * radius is pre-divided by the scale so the end shape is an exact pill.
 */
function morphFrames(toast: DOMRect, chip: Element): Keyframe[] {
   const target = chip.getBoundingClientRect();
   const look = getComputedStyle(chip);
   const sx = target.width / toast.width;
   const sy = target.height / toast.height;
   const radius = target.height / 2;
   return [
      { transform: "none", borderRadius: "12px" },
      {
         transform: `translate(${target.left - toast.left}px, ${target.top - toast.top}px) scale(${sx}, ${sy})`,
         borderRadius: `${radius / sx}px / ${radius / sy}px`,
         backgroundColor: look.backgroundColor,
         borderColor: look.borderColor,
         boxShadow: "0 0 0 #0000",
      },
   ];
}

/** Morphs `element` into (or, reversed, out of) the entry's chip. Resolves when done or skipped. */
function morph(element: HTMLElement, id: number, direction: "into" | "from"): Promise<void> {
   const chip = document.querySelector(chipSelector(id));
   if (!chip || reducedMotion() || typeof element.animate !== "function") return Promise.resolve();
   const frames = morphFrames(element.getBoundingClientRect(), chip);
   const body = element.querySelector<HTMLElement>(".toast-body");
   const timing: KeyframeAnimationOptions = {
      duration: MORPH_MS,
      easing: "cubic-bezier(0.55, 0, 0.2, 1)",
      direction: direction === "into" ? "normal" : "reverse",
   };
   // Text would squash with the box, so it fades out before the shape gets small.
   body?.animate([{ opacity: 1 }, { opacity: 0, offset: 0.35 }, { opacity: 0 }], { ...timing, fill: direction === "into" ? "forwards" : "none" });
   element.style.transformOrigin = "top left";
   const done = () => {
      if (direction === "from") element.style.transformOrigin = "";
   };
   return element.animate(frames, { ...timing, fill: direction === "into" ? "forwards" : "none" }).finished.then(done, done);
}

/** The bottom-right stack. New entries bounce in; chipped ones morph into the status bar when their countdown ends. */
export function NotificationToast() {
   const { entries, open } = useNotifications();
   const pinned = open ? entries.find((entry) => entry.id === open.id) : undefined;
   const live = entries.filter((entry) => entry.phase !== "chip" && entry.id !== pinned?.id).slice(0, MAX_TOASTS);
   // Newest sits nearest the status bar.
   const stack = [...(pinned ? [pinned] : []), ...live].reverse();
   if (!stack.length) return null;
   return (
      <div className="toast-stack">
         {stack.map((entry) => (
            <Toast key={entry.id} entry={entry} pinned={entry === pinned} closing={entry === pinned && !!open?.closing} />
         ))}
      </div>
   );
}

function Toast({ entry, pinned, closing }: { entry: NotificationEntry; pinned: boolean; closing: boolean }) {
   const element = useRef<HTMLDivElement>(null);
   const [hovering, setHovering] = useState(false);
   const [expanded, setExpanded] = useState(false);
   const counting = !pinned && entry.phase === "toast" && !hovering && !expanded;

   useEffect(() => {
      if (!counting) return;
      const timer = window.setTimeout(() => expire(entry.id), entry.tone === "info" ? NOTICE_MS : ERROR_MS);
      return () => window.clearTimeout(timer);
   }, [counting, entry.id, entry.tone]);

   // The chip renders hidden during `collapsing`, so its box is there to aim at.
   useLayoutEffect(() => {
      if (entry.phase !== "collapsing" || pinned || !element.current) return;
      void morph(element.current, entry.id, "into").then(() => settle(entry.id));
   }, [entry.phase, entry.id, pinned]);

   useLayoutEffect(() => {
      if (pinned && !closing && element.current) void morph(element.current, entry.id, "from");
   }, [pinned, closing, entry.id]);

   useLayoutEffect(() => {
      if (closing && element.current) void morph(element.current, entry.id, "into").then(() => closed(entry.id));
   }, [closing, entry.id]);

   const alert = entry.tone !== "info";
   return (
      <div
         ref={element}
         className={`toast ${entry.tone}${pinned ? " pinned" : ""}${expanded ? " expanded" : ""}`}
         role={alert ? "alert" : "status"}
         onMouseEnter={() => setHovering(true)}
         onMouseLeave={() => setHovering(false)}
      >
         <div className="toast-body">
            <NotificationIcon tone={entry.tone} size={17} />
            <div className="toast-text">
               <span className="toast-title">{entry.title}</span>
               {expanded && entry.detail && <p className="toast-detail">{entry.detail}</p>}
            </div>
            {entry.detail && (
               <IconButton
                  label={expanded ? "Hide details" : "Show details"}
                  aria-expanded={expanded}
                  className="toast-expand"
                  onClick={() => setExpanded((value) => !value)}
               >
                  <ChevronDown size={15} />
               </IconButton>
            )}
            <IconButton label="Dismiss" onClick={() => dismiss(entry.id)}>
               <X size={15} />
            </IconButton>
         </div>
      </div>
   );
}
