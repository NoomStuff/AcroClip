import { useCallback, useEffect, useState } from "react";

// Thumbnails this window has shown. The grid unmounts cards scrolled out of view, so one coming back
// shows its thumbnail at once instead of fading it in again.
const shown = new Set<string>();
// Matches the opacity transition on `.clip-thumbnail img`, so the clapperboard leaves once it's covered.
const fadeMs = 420;

export interface ThumbnailImage {
   /** The image to show. A replacement keeps the earlier one here until it has loaded. */
   src: string;
   /** `src` has loaded, so it fades in. */
   ready: boolean;
   /** The clapperboard belongs on show: there's no thumbnail, or a new one is still fading in over it. */
   fallback: boolean;
   onLoad: () => void;
}

/**
 * A card's thumbnail as it loads. A first thumbnail fades in, over the clapperboard if the card was
 * showing one. A replacement, like a regenerated thumbnail, loads out of sight and then takes over,
 * so the card never goes blank in between.
 */
export function useThumbnailImage(url: string): ThumbnailImage {
   const [src, setSrc] = useState(url);
   const [ready, setReady] = useState(() => shown.has(url));
   const [covering, setCovering] = useState(!url);
   // Gaining a first thumbnail or losing one needs no preload, so it changes during render.
   if (url !== src && (!src || !url)) {
      setSrc(url);
      setReady(shown.has(url));
      if (!url) setCovering(true);
   }
   useEffect(() => {
      if (!src || !url || url === src) return;
      let live = true;
      const image = new Image();
      image.src = url;
      void image
         .decode()
         .catch(() => undefined)
         .then(() => {
            if (!live) return;
            shown.add(url);
            setSrc(url);
            setReady(true);
         });
      return () => {
         live = false;
      };
   }, [url, src]);
   useEffect(() => {
      if (!covering || !ready || !src) return;
      const timer = window.setTimeout(() => setCovering(false), fadeMs);
      return () => window.clearTimeout(timer);
   }, [covering, ready, src]);
   const onLoad = useCallback(() => {
      shown.add(src);
      setReady(true);
   }, [src]);
   return { src, ready, fallback: !src || covering, onLoad };
}
