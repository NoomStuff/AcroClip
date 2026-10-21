import type { DragEvent } from "react";

export const api = window.acroClip;
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
