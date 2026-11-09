import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { Clip } from "../../shared/types";
import { api } from "./desktop";

type Strip = { url: string; frames: number } | null;
// One request per clip file for the whole session. A failed request may be retried on a later hover.
const requests = new Map<string, Promise<Strip>>();
function requestStrip(clip: Pick<Clip, "id" | "thumbnail">): Promise<Strip> {
   // The thumbnail URL changes with the file, so an edited clip asks again.
   const key = `${clip.id}\n${clip.thumbnail}`;
   let request = requests.get(key);
   if (!request) {
      request = api.keyframes(clip.id).catch(() => null);
      requests.set(key, request);
      void request.then((strip) => strip || requests.delete(key));
   }
   return request;
}

/** Which frame of a strip a pointer position shows. Positions run from 0 to 1 across the thumbnail. */
export function stripFrame(position: number, frames: number): number {
   return Math.min(frames - 1, Math.max(0, Math.floor(position * frames)));
}

/**
 * Scrubs a clip by pointer position over its thumbnail. Frames come from a keyframe strip that
 * main makes on first hover, so moving the pointer decodes nothing and cuts straight between
 * frames. The decoded strip is dropped shortly after the pointer leaves.
 */
export function useKeyframeScrub(clip: Pick<Clip, "id" | "thumbnail" | "width" | "height">, enabled: boolean) {
   const [position, setPosition] = useState<number | null>(null);
   const [strip, setStrip] = useState<{ image: HTMLImageElement; frames: number } | null>(null);
   const canvas = useRef<HTMLCanvasElement>(null);
   const hovering = position !== null && enabled;
   const { id, thumbnail, width, height } = clip;
   useEffect(() => {
      if (!hovering) {
         // Long enough for the fade out to finish on the last frame shown.
         const release = setTimeout(() => setStrip(null), 400);
         return () => clearTimeout(release);
      }
      if (strip) return;
      let current = true;
      // A short hover intent keeps a pointer sweeping across the grid from requesting every strip.
      const timer = setTimeout(() => {
         void requestStrip({ id, thumbnail }).then((result) => {
            if (!result || !current) return;
            const image = new Image();
            image.decoding = "async";
            image.src = result.url;
            void image.decode().then(
               () => current && setStrip({ image, frames: result.frames }),
               () => undefined
            );
         });
      }, 90);
      return () => {
         current = false;
         clearTimeout(timer);
      };
   }, [hovering, strip, id, thumbnail]);
   useLayoutEffect(() => {
      const target = canvas.current;
      const context = target?.getContext("2d");
      if (!target || !context || !strip || position === null) return;
      const bounds = target.getBoundingClientRect();
      const scale = window.devicePixelRatio || 1;
      const canvasWidth = Math.max(1, Math.round(bounds.width * scale));
      const canvasHeight = Math.max(1, Math.round(bounds.height * scale));
      if (target.width !== canvasWidth || target.height !== canvasHeight) {
         target.width = canvasWidth;
         target.height = canvasHeight;
      }
      const frameWidth = strip.image.naturalWidth / strip.frames;
      const frameHeight = strip.image.naturalHeight;
      const left = stripFrame(position, strip.frames) * frameWidth;
      context.clearRect(0, 0, canvasWidth, canvasHeight);
      // Same framing as the thumbnail: portrait clips fit inside, the rest fill the card.
      if (height > width) {
         const fit = Math.min(canvasWidth / frameWidth, canvasHeight / frameHeight);
         const drawWidth = frameWidth * fit;
         const drawHeight = frameHeight * fit;
         context.drawImage(
            strip.image,
            left,
            0,
            frameWidth,
            frameHeight,
            (canvasWidth - drawWidth) / 2,
            (canvasHeight - drawHeight) / 2,
            drawWidth,
            drawHeight
         );
      } else {
         const fill = Math.max(canvasWidth / frameWidth, canvasHeight / frameHeight);
         const sourceWidth = canvasWidth / fill;
         const sourceHeight = canvasHeight / fill;
         context.drawImage(
            strip.image,
            left + (frameWidth - sourceWidth) / 2,
            (frameHeight - sourceHeight) / 2,
            sourceWidth,
            sourceHeight,
            0,
            0,
            canvasWidth,
            canvasHeight
         );
      }
   }, [strip, position, width, height]);
   return { canvas, position: enabled ? position : null, shown: hovering && !!strip, setPosition };
}
