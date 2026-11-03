import { useLayoutEffect, useRef } from "react";
import type { RefObject } from "react";

export function useVideoReveal(target: RefObject<HTMLElement | null>, ready: boolean, identity: string, onComplete?: () => void) {
   const complete = useRef(onComplete);
   complete.current = onComplete;
   useLayoutEffect(() => {
      const node = target.current;
      if (!node || !ready) return;
      const callback = complete.current;
      const media = matchMedia("(prefers-reduced-motion: reduce)");
      if (media.matches || document.hidden) {
         callback?.();
         return;
      }
      let disposed = false;
      // Explicit keyframes also run when the first decoded frame arrives before
      // the browser has painted the element's initial transparent state.
      const animation = node.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 140, easing: "ease-out" });
      void animation.finished.then(
         () => {
            if (!disposed) callback?.();
         },
         () => undefined
      );
      const finish = () => {
         if (media.matches || document.hidden) animation.finish();
      };
      media.addEventListener("change", finish);
      document.addEventListener("visibilitychange", finish);
      return () => {
         disposed = true;
         media.removeEventListener("change", finish);
         document.removeEventListener("visibilitychange", finish);
         animation.cancel();
      };
   }, [target, ready, identity]);
}
