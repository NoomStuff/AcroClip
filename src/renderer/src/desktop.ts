import type { AppEvent, DesktopAPI, NoticeOptions } from "../../shared/types";
import type { DragEvent } from "react";
import { clipDragType } from "./clip-drag";
import type { ClipDrag } from "./clip-drag";

// The context bridge copies every event once per preload listener, so a state
// event carrying the whole library was cloned for each meter and page. One
// bridge subscription fans out here instead.
const listeners = new Set<(event: AppEvent) => void>();
let bridged = false;
function onEvent(listener: (event: AppEvent) => void): () => void {
   listeners.add(listener);
   if (!bridged) {
      bridged = true;
      window.acroClip.onEvent((event) => {
         for (const receive of [...listeners])
            try {
               receive(event);
            } catch (error) {
               // One failing view must not starve the others of updates.
               queueMicrotask(() => {
                  throw error;
               });
            }
      });
   }
   return () => {
      listeners.delete(listener);
   };
}
export const api: DesktopAPI = { ...window.acroClip, onEvent };
export type Run = (action: () => Promise<unknown>) => Promise<boolean>;
export function describeError(error: unknown): string {
   const message =
      typeof error === "string"
         ? error
         : error && typeof error === "object" && "message" in error && typeof error.message === "string" && error.message.trim()
           ? error.message
           : "Something went wrong. Try again.";
   return message.replace(/^Error invoking remote method '[^']+':\s*/, "").replace(/^Error:\s*/, "");
}

export type RendererFeedback = ({ kind: "notice"; message: string; error: boolean } & NoticeOptions) | { kind: "audio-status"; message: string };
export function reportFeedback(value: RendererFeedback): void {
   window.dispatchEvent(new CustomEvent<RendererFeedback>("acroclip-feedback", { detail: value }));
}
export function fileDragProps(path: string | undefined, clip?: ClipDrag) {
   return {
      draggable: !!path,
      onDragStart: (event: DragEvent) => {
         if (clip && event.shiftKey) {
            event.dataTransfer.clearData();
            event.dataTransfer.setData(clipDragType, JSON.stringify(clip));
            event.dataTransfer.effectAllowed = "move";
            const bounds = event.currentTarget.getBoundingClientRect();
            event.dataTransfer.setDragImage(event.currentTarget, event.clientX - bounds.left, event.clientY - bounds.top);
         } else {
            event.preventDefault();
            if (path) api.dragFile(path);
         }
      },
      onDragEnd: () => {
         for (const target of document.querySelectorAll(".clip-drop-active")) target.classList.remove("clip-drop-active");
      },
   };
}
