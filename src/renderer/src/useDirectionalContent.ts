import { useLayoutEffect, useRef } from "react";
import type { RefObject } from "react";

// Animate the existing content. Media elements keep their playback state.
export function useDirectionalContent(
   root: RefObject<HTMLElement | null>,
   value: string,
   index: number,
   visible: boolean,
   identity = "",
   motion: "slide" | "fade" = "slide"
) {
   const previous = useRef({ value, index, identity });
   useLayoutEffect(() => {
      const before = previous.current;
      previous.current = { value, index, identity };
      const node = root.current;
      const media = matchMedia("(prefers-reduced-motion: reduce)");
      if (!node || !visible || media.matches || before.value === value || before.identity !== identity) return;
      const animation = node.animate(
         [
            { opacity: 0, ...(motion === "slide" ? { transform: `translateX(${index < before.index ? -16 : 16}px)` } : {}) },
            { opacity: 1, ...(motion === "slide" ? { transform: "translateX(0)" } : {}) },
         ],
         { duration: motion === "slide" ? 280 : 140, easing: "cubic-bezier(.22,.8,.3,1)" }
      );
      const reduce = () => {
         if (media.matches) animation.cancel();
      };
      media.addEventListener("change", reduce);
      return () => {
         media.removeEventListener("change", reduce);
         animation.cancel();
      };
   }, [root, value, index, visible, identity, motion]);
}
