import { useLayoutEffect, useRef, useState } from "react";
import type { RefObject } from "react";
import { useVideoReveal } from "./useVideoReveal";

export function usePlaybackFade(
   video: RefObject<HTMLVideoElement | null>,
   identity: string,
   url: string,
   prepared: boolean,
   visible: boolean,
   generation: number
) {
   const outgoing = useRef<HTMLCanvasElement>(null);
   const motion = useRef<Animation | null>(null);
   const shown = useRef<{ identity: string; url: string } | null>(null);
   const [decoded, setDecoded] = useState("");
   const key = `${identity}\0${url}\0${generation}`;
   const ready = visible && prepared && decoded === key;

   useLayoutEffect(() => {
      const node = video.current,
         surface = outgoing.current;
      const clear = () => {
         motion.current?.cancel();
         motion.current = null;
         if (surface) surface.style.opacity = "0";
      };
      const media = matchMedia("(prefers-reduced-motion: reduce)");
      if (!visible || media.matches) clear();
      if (
         shown.current &&
         shown.current.identity !== identity &&
         node &&
         surface &&
         node.currentSrc === shown.current.url &&
         node.readyState >= 2 &&
         node.videoWidth &&
         node.videoHeight
      ) {
         shown.current = null;
         if (visible && !media.matches) {
            clear();
            const scale = Math.min(1, 960 / node.videoWidth, 540 / node.videoHeight);
            surface.width = Math.max(1, Math.round(node.videoWidth * scale));
            surface.height = Math.max(1, Math.round(node.videoHeight * scale));
            surface.getContext("2d", { alpha: false })?.drawImage(node, 0, 0, surface.width, surface.height);
            const animation = surface.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 180, easing: "ease-out", fill: "forwards" });
            motion.current = animation;
            void animation.finished.then(
               () => {
                  if (motion.current === animation) clear();
               },
               () => undefined
            );
         }
      }
      const reduce = () => {
         if (media.matches) clear();
      };
      media.addEventListener("change", reduce);
      return () => media.removeEventListener("change", reduce);
   }, [identity, visible, video]);
   useLayoutEffect(
      () => () => {
         motion.current?.cancel();
      },
      []
   );

   useLayoutEffect(() => {
      const node = video.current;
      if (!node || !visible || !prepared || !url) return;
      let disposed = false;
      let completed = false;
      let frame: number | undefined;
      const decodedFrame = () => {
         if (disposed || completed || node.currentSrc !== url || node.seeking || node.readyState < 2) return;
         completed = true;
         if (frame !== undefined) node.cancelVideoFrameCallback(frame);
         frame = undefined;
         shown.current = { identity, url };
         setDecoded(key);
      };
      const presented = () => {
         frame = undefined;
         decodedFrame();
         if (!completed && !disposed) frame = node.requestVideoFrameCallback(presented);
      };
      // A paused seek can finish after its only presentation callback. Media
      // readiness events also reveal that decoded frame without starting playback.
      const events = ["loadeddata", "canplay", "seeked"] as const;
      for (const event of events) node.addEventListener(event, decodedFrame);
      decodedFrame();
      if (!completed) frame = node.requestVideoFrameCallback(presented);
      return () => {
         disposed = true;
         if (frame !== undefined) node.cancelVideoFrameCallback(frame);
         for (const event of events) node.removeEventListener(event, decodedFrame);
      };
   }, [video, visible, prepared, url, key, identity]);
   useVideoReveal(video, ready, key);
   return { ready, outgoing };
}
