import { useEffect, useRef, useState } from "react";
import { sampleApplicationColor } from "./application-color";

const cache = new Map<string, Promise<string | null>>();
function colorForIcon(src: string): Promise<string | null> {
   const cached = cache.get(src);
   if (cached) return cached;
   if (!src.startsWith("data:image/")) return Promise.resolve(null);
   const result = new Promise<string | null>((resolve) => {
      const image = new Image();
      image.onload = () => {
         // Read a bounded sample once, after the browser has had a chance to paint.
         requestIdleCallback(
            () => {
               try {
                  const canvas = document.createElement("canvas");
                  canvas.width = canvas.height = 32;
                  const context = canvas.getContext("2d", { willReadFrequently: true });
                  if (!context) return resolve(null);
                  context.drawImage(image, 0, 0, 32, 32);
                  resolve(sampleApplicationColor(context.getImageData(0, 0, 32, 32).data));
               } catch {
                  resolve(null);
               }
            },
            { timeout: 1000 }
         );
      };
      image.onerror = () => resolve(null);
      image.src = src;
   });
   cache.set(src, result);
   if (cache.size > 128) cache.delete(cache.keys().next().value!);
   return result;
}
export function useApplicationColors(icons: Record<string, string>, visible: boolean) {
   const [colors, setColors] = useState<Record<string, string>>({});
   const resolved = useRef(new Map<string, { src: string; color: string | null }>());
   useEffect(() => {
      if (!visible) return;
      let cancelled = false;
      for (const id of resolved.current.keys()) if (!(id in icons)) resolved.current.delete(id);
      void Promise.all(
         Object.entries(icons).map(async ([id, src]) => {
            const previous = resolved.current.get(id);
            const color = previous?.src === src ? previous.color : await colorForIcon(src);
            if (!cancelled) resolved.current.set(id, { src, color });
            return [id, color] as const;
         })
      ).then((entries) => {
         if (!cancelled) setColors(Object.fromEntries(entries.filter((entry): entry is readonly [string, string] => entry[1] !== null)));
      });
      return () => {
         cancelled = true;
      };
   }, [icons, visible]);
   return colors;
}
