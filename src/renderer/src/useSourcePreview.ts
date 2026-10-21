import { useEffect, useRef, useState } from "react";
import { api, describeError } from "./desktop";

type PreviewStatus = "idle" | "connecting" | "live" | "error";

export function useSourcePreview(sourceId: string | undefined, visible: boolean, nativeScreen = false, scope = "") {
   const video = useRef<HTMLVideoElement>(null);
   const canvas = useRef<HTMLCanvasElement>(null);
   const [status, setStatus] = useState<PreviewStatus>("idle");
   const [error, setError] = useState("");
   const [retry, setRetry] = useState(0);
   const cacheKey = `${scope}\0${sourceId ?? ""}`;
   const [cachedSource, setCachedSource] = useState<string | null>(null);
   const cached = cachedSource === cacheKey;
   const images = useRef(new Map<string, { canvas: HTMLCanvasElement; at: number }>());
   const expiry = useRef<number | undefined>(undefined);
   useEffect(
      () => () => {
         window.clearTimeout(expiry.current);
         images.current.clear();
      },
      []
   );
   const previousScope = useRef(scope);
   const statusSource = useRef(cacheKey);

   useEffect(() => {
      statusSource.current = cacheKey;
      const owner = crypto.randomUUID();
      if (previousScope.current !== scope || !sourceId) images.current.clear();
      previousScope.current = scope;
      let disposed = false;
      let stream: MediaStream | undefined;
      let frame: number | undefined;
      const element = video.current;
      const snapshot = () => {
         if (!sourceId || !stream || element?.srcObject !== stream || !element.videoWidth || !element.videoHeight || element.readyState < 2) return;
         const surface = document.createElement("canvas");
         const scale = Math.min(1, 960 / element.videoWidth, 540 / element.videoHeight);
         surface.width = Math.max(1, Math.round(element.videoWidth * scale));
         surface.height = Math.max(1, Math.round(element.videoHeight * scale));
         surface
            .getContext("2d", { alpha: false })
            ?.drawImage(nativeScreen && canvas.current?.width ? canvas.current : element, 0, 0, surface.width, surface.height);
         images.current.delete(sourceId);
         images.current.set(sourceId, { canvas: surface, at: Date.now() });
         while (images.current.size > 2) images.current.delete(images.current.keys().next().value!);
         window.clearTimeout(expiry.current);
         const sweep = () => {
            const now = Date.now();
            for (const [id, image] of images.current) if (now - image.at >= 60_000) images.current.delete(id);
            setCachedSource((current) => (current && !images.current.has(current.split("\0").at(-1)!) ? null : current));
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
            images.current.clear();
            setCachedSource(null);
         }
      };
      const unsubscribe = api.onEvent((event) => {
         if (event.type === "visibility" && !event.visible) {
            cancel();
            images.current.clear();
            setCachedSource(null);
         }
      });
      document.addEventListener("visibilitychange", visibility);
      window.addEventListener("pagehide", cancel);
      const image = sourceId ? images.current.get(sourceId) : undefined;
      const reuse = !!image && Date.now() - image.at < 60_000;
      setCachedSource(reuse ? cacheKey : null);
      if (reuse && canvas.current && image) {
         canvas.current.width = image.canvas.width;
         canvas.current.height = image.canvas.height;
         canvas.current.getContext("2d", { alpha: false })?.drawImage(image.canvas, 0, 0);
      }
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
                     images.current.delete(sourceId);
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
               setCachedSource(null);
               setStatus("live");
               if (nativeScreen) frame = element.requestVideoFrameCallback(paint);
            };
            frame = element.requestVideoFrameCallback(paint);
            await element.play();
         } catch (reason) {
            stop(false);
            if (sourceId) images.current.delete(sourceId);
            setCachedSource(null);
            await api.previewSource(null, owner).catch(() => undefined);
            if (!disposed) {
               const message = describeError(reason);
               setError(message === "Permission denied" ? "Allow screen capture in your system settings, then retry." : message);
               setStatus("error");
            }
         }
      })();

      return () => {
         cancel();
         unsubscribe();
         document.removeEventListener("visibilitychange", visibility);
         window.removeEventListener("pagehide", cancel);
         void api.previewSource(null, owner).catch(() => undefined);
      };
   }, [sourceId, visible, retry, nativeScreen, scope, cacheKey]);

   return {
      video,
      canvas,
      status: statusSource.current === cacheKey ? status : sourceId && visible ? ("connecting" as const) : ("idle" as const),
      error: statusSource.current === cacheKey ? error : "",
      cached,
      retry: () => setRetry((value) => value + 1),
   };
}
