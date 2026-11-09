import { useRef } from "react";
import type { MouseEvent } from "react";

// A little slack around the handle, so a double-click on its edge still counts.
const slack = 6;

/**
 * Double-click resets a slider only when the first click landed on its handle.
 * A click on the track moves the handle under the pointer first, so the check has to happen on that click.
 */
export function useHandleReset(thumbSelector: string, reset: () => void) {
   const onHandle = useRef(false);
   return {
      onMouseDown(event: MouseEvent<HTMLInputElement>) {
         if (event.detail > 1) return;
         const thumb = event.currentTarget.parentElement?.querySelector(thumbSelector)?.getBoundingClientRect();
         onHandle.current =
            !!thumb &&
            event.clientX >= thumb.left - slack &&
            event.clientX <= thumb.right + slack &&
            event.clientY >= thumb.top - slack &&
            event.clientY <= thumb.bottom + slack;
      },
      onDoubleClick() {
         if (onHandle.current) reset();
      },
   };
}
