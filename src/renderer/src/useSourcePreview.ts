import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { api, describeError } from "./desktop";
import { useVideoReveal } from "./useVideoReveal";

type PreviewStatus = "idle" | "connecting" | "live" | "error";

export function useSourcePreview(sourceId: string | undefined, visible: boolean, nativeScreen = false, scope = "", identity = "") {
   const video = useRef<HTMLVideoElement>(null);
   const canvas = useRef<HTMLCanvasElement>(null);
   const still = useRef<HTMLCanvasElement>(null);
   const outgoing = useRef<HTMLCanvasElement>(null);
   const outgoingMotion = useRef<Animation | null>(null);
   const departing = useRef<{ key: string; scope: string; canvas: HTMLCanvasElement } | null>(null);
   const [status, setStatus] = useState<PreviewStatus>("idle");
   const [error, setError] = useState("");
   const [retry, setRetry] = useState(0);
   const [revealed, setRevealed] = useState(false);
   const cacheKey = `${scope}\0${identity}\0${sourceId ?? ""}`;
   const [cachedSource, setCachedSource] = useState<string | null>(null);
   const cached = cachedSource === cacheKey;
   const images = useRef(new Map<string, { canvas: HTMLCanvasElement; at: number }>());
   const expiry = useRef<number | undefined>(undefined);
   useEffect(
      () => () => {
         window.clearTimeout(expiry.current);
         images.current.clear();
         outgoingMotion.current?.cancel();
      },
      []
   );
   const previousScope = useRef(scope);
   const statusSource = useRef(cacheKey);

   useLayoutEffect(() => {
      statusSource.current = cacheKey;
      const owner = crypto.randomUUID();
      const scopeChanged = previousScope.current !== scope;
      if (scopeChanged) images.current.clear();
      previousScope.current = scope;
      const media = matchMedia("(prefers-reduced-motion: reduce)");
      const clearOutgoing = () => {
         outgoingMotion.current?.cancel();
         outgoingMotion.current = null;
         if (outgoing.current) outgoing.current.style.opacity = "0";
      };
      const previous = departing.current;
      departing.current = null;
      if (scopeChanged || !visible || document.hidden || media.matches) clearOutgoing();
      else if (previous && previous.key !== cacheKey && previous.scope === scope && outgoing.current) {
         clearOutgoing();
         const surface = outgoing.current;
         surface.width = previous.canvas.width;
         surface.height = previous.canvas.height;
         surface.getContext("2d", { alpha: false })?.drawImage(previous.canvas, 0, 0);
         const animation = surface.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 180, easing: "ease-out", fill: "forwards" });
         outgoingMotion.current = animation;
         void animation.finished.then(
            () => {
               if (outgoingMotion.current === animation) clearOutgoing();
            },
            () => undefined
         );
      }
      const reduce = () => {
         if (media.matches) clearOutgoing();
      };
      media.addEventListener("change", reduce);
      let disposed = false;
      let stream: MediaStream | undefined;
      let frame: number | undefined;
      let painted = false;
      const element = video.current;
      const snapshot = () => {
         if (!sourceId || !painted || !stream || element?.srcObject !== stream || !element.videoWidth || !element.videoHeight || element.readyState < 2) return;
         const surface = document.createElement("canvas");
         const scale = Math.min(1, 960 / element.videoWidth, 540 / element.videoHeight);
         surface.width = Math.max(1, Math.round(element.videoWidth * scale));
         surface.height = Math.max(1, Math.round(element.videoHeight * scale));
         const context = surface.getContext("2d", { alpha: false });
         if (!context) return;
         context.drawImage(nativeScreen && canvas.current?.width ? canvas.current : element, 0, 0, surface.width, surface.height);
         departing.current = { key: cacheKey, scope, canvas: surface };
         images.current.delete(cacheKey);
         images.current.set(cacheKey, { canvas: surface, at: Date.now() });
         while (images.current.size > 2) images.current.delete(images.current.keys().next().value!);
         window.clearTimeout(expiry.current);
         const sweep = () => {
            const now = Date.now();
            for (const [id, image] of images.current) if (now - image.at >= 60_000) images.current.delete(id);
            setCachedSource((current) => (current && !images.current.has(current) ? null : current));
            if (images.current.size)
               expiry.current = window.setTimeout(sweep, Math.max(1, Math.min(...[...images.current.values()].map((image) => 60_000 - (now - image.at)))));
         };
         expiry.current = window.setTimeout(sweep, Math.max(1, Math.min(...[...images.current.values()].map((image) => 60_000 - (Date.now() - image.at)))));
      };
      const stop = (remember = true) => {
         if (remember) snapshot();
         if (frame !== undefined) element?.cancelVideoFrameCallback(frame);
         stream?.getTracks().forEach((track) => track.stop());
         if (element && element.srcObject === stream) {
            element.pause();
            element.srcObject = null;
         }
      };
      const cancel = () => {
         disposed = true;
         stop();
      };
      const visibility = () => {
         if (document.hidden) {
            cancel();
            clearOutgoing();
         }
      };
      const unsubscribe = api.onEvent((event) => {
         if (event.type === "visibility" && !event.visible) {
            cancel();
            clearOutgoing();
         }
      });
      document.addEventListener("visibilitychange", visibility);
      const pagehide = () => {
         cancel();
         clearOutgoing();
      };
      window.addEventListener("pagehide", pagehide);
      const image = sourceId ? images.current.get(cacheKey) : undefined;
      const reuse = !!image && Date.now() - image.at < 60_000;
      setCachedSource(reuse ? cacheKey : null);
      if (reuse && still.current && image) {
         still.current.width = image.canvas.width;
         still.current.height = image.canvas.height;
         still.current.getContext("2d", { alpha: false })?.drawImage(image.canvas, 0, 0);
      }
      setRevealed(false);
      setError("");
      setStatus(sourceId && visible ? "connecting" : "idle");

      // Each request owns its permission arm. A stale acquisition cannot revoke or pause its successor.
      // A stream that arrives after navigation is stopped before reaching the player.
      void (async () => {
         try {
            if (disposed || !visible || !sourceId || document.hidden) return;
            await api.previewSource(sourceId, owner);
            if (disposed) {
               await api.previewSource(null, owner);
               return;
            }
            const captured = await navigator.mediaDevices.getDisplayMedia({
               audio: false,
               // Chromium's Windows screen downscaler introduces a chroma bias.
               // Keep the NV12 frame, then scale to bounded RGB in the preview canvas.
               video: nativeScreen
                  ? { frameRate: { ideal: 30, max: 30 } }
                  : { width: { ideal: 960, max: 960 }, height: { ideal: 540, max: 540 }, frameRate: { ideal: 15, max: 15 } },
            });
            stream = captured;
            if (disposed || document.hidden || !element) {
               stop();
               await api.previewSource(null, owner);
               return;
            }
            // Preview must never open another audio capture path.
            captured.getAudioTracks().forEach((track) => track.stop());
            captured.getVideoTracks().forEach((track) => {
               track.addEventListener(
                  "ended",
                  () => {
                     if (disposed) return;
                     stop(false);
                     images.current.delete(cacheKey);
                     setCachedSource(null);
                     setError("This source is no longer available.");
                     setStatus("error");
                  },
                  { once: true }
               );
            });
            element.srcObject = captured;
            const paint = () => {
               if (disposed) return;
               if (nativeScreen && canvas.current) {
                  const scale = Math.min(1, 960 / element.videoWidth, 540 / element.videoHeight);
                  const width = Math.max(1, Math.round(element.videoWidth * scale)),
                     height = Math.max(1, Math.round(element.videoHeight * scale));
                  const surface = canvas.current;
                  if (surface.width !== width || surface.height !== height) {
                     surface.width = width;
                     surface.height = height;
                  }
                  surface.getContext("2d", { alpha: false, desynchronized: true })?.drawImage(element, 0, 0, width, height);
               }
               if (!painted) {
                  painted = true;
                  setStatus("live");
               }
               if (nativeScreen) frame = element.requestVideoFrameCallback(paint);
            };
            frame = element.requestVideoFrameCallback(paint);
            await element.play();
         } catch (reason) {
            stop(false);
            await api.previewSource(null, owner).catch(() => undefined);
            if (!disposed) {
               images.current.delete(cacheKey);
               setCachedSource(null);
               const message = describeError(reason);
               const name = reason && typeof reason === "object" && "name" in reason ? reason.name : "";
               setError(
                  name === "NotAllowedError" || message === "Permission denied"
                     ? "Capture permission was denied or the source changed. Select the source again, then retry."
                     : name === "NotReadableError" || name === "AbortError"
                       ? "This window could not be captured. Keep it open and visible, then retry or capture its screen."
                       : message
               );
               setStatus("error");
            }
         }
      })();

      return () => {
         cancel();
         unsubscribe();
         document.removeEventListener("visibilitychange", visibility);
         window.removeEventListener("pagehide", pagehide);
         media.removeEventListener("change", reduce);
         void api.previewSource(null, owner).catch(() => undefined);
      };
   }, [sourceId, visible, retry, nativeScreen, scope, cacheKey]);

   const currentStatus: PreviewStatus = statusSource.current === cacheKey ? status : sourceId && visible ? "connecting" : "idle";
   useVideoReveal(nativeScreen ? canvas : video, currentStatus === "live", cacheKey, () => {
      if (statusSource.current !== cacheKey) return;
      setCachedSource(null);
      setRevealed(true);
   });

   return {
      video,
      canvas,
      still,
      outgoing,
      revealed: statusSource.current === cacheKey && revealed,
      status: currentStatus,
      error: statusSource.current === cacheKey ? error : "",
      cached,
      retry: () => setRetry((value) => value + 1),
   };
}
