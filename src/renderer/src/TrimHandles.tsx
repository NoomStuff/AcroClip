import { useState } from "react";
import type { KeyboardEvent, PointerEvent } from "react";
import { formatTrimTime, minimumTrimLength, moveTrimEdge, trimStep } from "./trim-range";
import type { TrimEdge, TrimRange } from "./trim-range";

export interface TrimControls {
   range: TrimRange;
   frameRate: number | undefined;
   // While a trim is saving, the handles stay where they are.
   disabled: boolean;
   onRange: (range: TrimRange, edge: TrimEdge) => void;
}

/**
 * The trim handles and the playhead, on top of the seek bar. The handles sit just outside the kept
 * part, so the playhead between them never ends up underneath one. All three grab before the bar.
 */
export function TrimHandles({
   range,
   frameRate,
   disabled,
   onRange,
   duration,
   time,
   shownTime,
   onSeek,
   onDrag,
}: TrimControls & {
   duration: number;
   time: number;
   // Where the playhead is drawn. The transport smooths it the same way as the seek bar's.
   shownTime: number;
   onSeek: (time: number) => void;
   onDrag: (target: TrimEdge | "playhead" | null) => void;
}) {
   const [dragging, setDraggingState] = useState<TrimEdge | "playhead" | null>(null);
   const setDragging = (target: TrimEdge | "playhead" | null) => {
      setDraggingState(target);
      onDrag(target);
   };
   const shown = Math.min(range.end, Math.max(range.start, shownTime));
   const minimum = minimumTrimLength(frameRate);
   const percent = (value: number) => `${duration > 0 ? Math.min(1, Math.max(0, value / duration)) * 100 : 0}%`;
   // The seek bar is the parent, so positions follow it.
   const timeAt = (element: HTMLElement, clientX: number) => {
      const bounds = element.parentElement!.getBoundingClientRect();
      return Math.min(1, Math.max(0, (clientX - bounds.left) / Math.max(1, bounds.width))) * duration;
   };
   const update = (target: TrimEdge | "playhead", value: number) => {
      if (target === "playhead") onSeek(Math.min(range.end, Math.max(range.start, value)));
      else onRange(moveTrimEdge(range, target, value, duration, minimum), target);
   };
   const grab = (target: TrimEdge | "playhead") => ({
      onPointerDown: (event: PointerEvent<HTMLElement>) => {
         if (disabled || event.button !== 0) return;
         // The seek bar underneath doesn't seek.
         event.preventDefault();
         event.stopPropagation();
         // Without taking focus, so Space still plays and pauses after a drag.
         event.currentTarget.setPointerCapture(event.pointerId);
         setDragging(target);
      },
      onPointerMove: (event: PointerEvent<HTMLElement>) => {
         if (dragging === target && event.currentTarget.hasPointerCapture(event.pointerId)) update(target, timeAt(event.currentTarget, event.clientX));
      },
      onPointerUp: (event: PointerEvent<HTMLElement>) => {
         if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
         setDragging(null);
      },
      onPointerCancel: () => setDragging(null),
      onClick: (event: { preventDefault: () => void }) => event.preventDefault(),
   });
   const keys = (value: number, target: TrimEdge | "playhead") => (event: KeyboardEvent<HTMLElement>) => {
      if (event.altKey || event.ctrlKey || event.metaKey) return;
      const step = event.shiftKey ? 1 : trimStep(frameRate);
      const next = ["ArrowLeft", "ArrowDown"].includes(event.key)
         ? value - step
         : ["ArrowRight", "ArrowUp"].includes(event.key)
           ? value + step
           : event.key === "Home"
             ? 0
             : event.key === "End"
               ? duration
               : null;
      if (next === null) return;
      event.preventDefault();
      event.stopPropagation();
      update(target, next);
   };
   const slider = (label: string, value: number) => ({
      role: "slider",
      "aria-label": label,
      "aria-valuemin": 0,
      "aria-valuemax": Math.round(duration * 10) / 10,
      "aria-valuenow": Math.round(value * 10) / 10,
      "aria-valuetext": formatTrimTime(value),
   });
   const handle = (edge: TrimEdge) => {
      const value = edge === "start" ? range.start : range.end;
      return (
         <button
            type="button"
            className="trim-handle"
            data-edge={edge}
            data-active={dragging === edge || undefined}
            style={{ left: percent(value) }}
            disabled={disabled}
            {...slider(edge === "start" ? "Trim start" : "Trim end", value)}
            {...grab(edge)}
            onKeyDown={keys(value, edge)}
         />
      );
   };
   return (
      <>
         <span
            className="trim-playhead"
            data-active={dragging === "playhead" || undefined}
            data-disabled={disabled || undefined}
            style={{ left: percent(shown) }}
            tabIndex={disabled ? -1 : 0}
            {...slider("Playback position", time)}
            {...grab("playhead")}
            onKeyDown={keys(time, "playhead")}
         />
         {handle("start")}
         {handle("end")}
      </>
   );
}
