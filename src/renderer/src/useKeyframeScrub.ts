import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { Clip, DesktopAPI } from "../../shared/types";
import { api } from "./desktop";

type Strip = Awaited<ReturnType<DesktopAPI["keyframes"]>>;
type Loaded = { key: string; image: HTMLImageElement; frames: number; columns: number };
// One request per clip file for the whole session. A failed request may be retried on a later hover.
const requests = new Map<string, Promise<Strip>>();
const stripKey = (clip: Pick<Clip, "id" | "thumbnail">) => `${clip.id}\n${clip.thumbnail}`;
function requestStrip(clip: Pick<Clip, "id" | "thumbnail">): Promise<Strip> {
   // The thumbnail URL changes with the file, so an edited clip asks again.
   const key = stripKey(clip);
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
 * Scrubs a clip by pointer position. Frames come from a keyframe strip that main makes on first
 * hover, so moving the pointer decodes nothing and cuts straight between frames. A card drops the
 * decoded strip shortly after the pointer leaves; the player keeps it while the clip is open.
 */
export function useKeyframeScrub(clip: Pick<Clip, "id" | "thumbnail" | "width" | "height">, enabled: boolean, { eager = false }: { eager?: boolean } = {}) {
   const [position, setPosition] = useState<number | null>(null);
   const [loaded, setLoaded] = useState<Loaded | null>(null);
   const canvas = useRef<HTMLCanvasElement>(null);
   const { id, thumbnail, width, height } = clip;
   const key = stripKey({ id, thumbnail });
   const strip = loaded?.key === key ? loaded : null;
   const hovering = position !== null && enabled;
   const wanted = enabled && (eager || hovering);
   useEffect(() => {
      if (!wanted) {
         // Long enough for the thumbnail to fade back over the last frame shown.
         const release = setTimeout(() => setLoaded(null), 400);
         return () => clearTimeout(release);
      }
      if (strip) return;
      let current = true;
      // A short hover intent keeps a pointer sweeping across the grid from requesting every strip.
      const timer = setTimeout(
         () => {
            void requestStrip({ id, thumbnail }).then((result) => {
               if (!result || !current) return;
               const image = new Image();
               image.decoding = "async";
               image.src = result.url;
               void image.decode().then(
                  () => current && setLoaded({ key, image, frames: result.frames, columns: result.columns }),
                  () => undefined
               );
            });
         },
         eager ? 0 : 90
      );
      return () => {
         current = false;
         clearTimeout(timer);
      };
   }, [wanted, strip, eager, key, id, thumbnail]);
   const frame = strip && position !== null ? stripFrame(position, strip.frames) : null;
   useLayoutEffect(() => {
      const target = canvas.current;
      const context = target?.getContext("2d");
      if (!target || !context || !strip || frame === null) return;
      // Layout size, not the on-screen box, so an entrance or hover zoom doesn't shrink the canvas.
      const scale = window.devicePixelRatio || 1;
      const canvasWidth = Math.max(1, Math.round(target.clientWidth * scale));
      const canvasHeight = Math.max(1, Math.round(target.clientHeight * scale));
      if (target.width !== canvasWidth || target.height !== canvasHeight) {
         target.width = canvasWidth;
         target.height = canvasHeight;
      }
      const frameWidth = strip.image.naturalWidth / strip.columns;
      const frameHeight = strip.image.naturalHeight / Math.ceil(strip.frames / strip.columns);
      const left = (frame % strip.columns) * frameWidth;
      const top = Math.floor(frame / strip.columns) * frameHeight;
      context.clearRect(0, 0, canvasWidth, canvasHeight);
      // Same framing as the thumbnail: portrait clips fit inside, the rest fill the frame.
      if (height > width) {
         const fit = Math.min(canvasWidth / frameWidth, canvasHeight / frameHeight);
         const drawWidth = frameWidth * fit;
         const drawHeight = frameHeight * fit;
         context.drawImage(
            strip.image,
            left,
            top,
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
            top + (frameHeight - sourceHeight) / 2,
            sourceWidth,
            sourceHeight,
            0,
            0,
            canvasWidth,
            canvasHeight
         );
      }
   }, [strip, frame, width, height]);
   return {
      canvas,
      position: enabled ? position : null,
      // The frame on the canvas and how many the strip has, while one is shown.
      frame: hovering ? frame : null,
      frames: strip?.frames ?? 0,
      shown: hovering && !!strip,
      setPosition,
   };
}
