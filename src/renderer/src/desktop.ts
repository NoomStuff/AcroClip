import type { DragEvent } from "react";
import { clipDragType } from "./clip-drag";
import type { ClipDrag } from "./clip-drag";

export const api = window.acroClip;
export type Run = (action: () => Promise<unknown>, options?: { feedback: "external" }) => Promise<boolean>;
export function describeError(error: unknown): string {
   const message =
      typeof error === "string"
         ? error
         : error && typeof error === "object" && "message" in error && typeof error.message === "string" && error.message.trim()
           ? error.message
           : "Something went wrong. Try again.";
   return message.replace(/^Error invoking remote method '[^']+':\s*/, "").replace(/^Error:\s*/, "");
}

export type RendererFeedback = { kind: "notice"; message: string; error: boolean } | { kind: "audio-status"; message: string };
export function reportFeedback(value: RendererFeedback): void {
   window.dispatchEvent(new CustomEvent<RendererFeedback>("acroclip-feedback", { detail: value }));
}
export function fileDragProps(path: string | undefined, clip?: ClipDrag) {
   return {
      draggable: !!path,
      onDragStart: (event: DragEvent) => {
         if (clip && event.shiftKey) {
            event.dataTransfer.setData(clipDragType, JSON.stringify(clip));
            event.dataTransfer.effectAllowed = "move";
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
