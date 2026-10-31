import { useLayoutEffect, useRef, useState } from "react";
import type { RefObject } from "react";
import { createSliderMotion } from "./slider-motion";

export function useThumbnailSize(root: RefObject<HTMLElement | null>, target: number, active: boolean) {
   const [moving, setMoving] = useState(false);
   const motion = useRef<ReturnType<typeof createSliderMotion> | null>(null);
   const initial = useRef(target);
   const currentSize = useRef(target);
   const latest = useRef(target);
   latest.current = target;
   useLayoutEffect(() => {
      const element = root.current;
      const paint = (size: number) => {
         currentSize.current = size;
         element?.style.setProperty("--list-thumbnail-size", `${size}px`);
         if (Math.abs(size - latest.current) < 0.005) setMoving(false);
      };
      paint(initial.current);
      const controller = createSliderMotion(((initial.current - 80) / 112) * 100, (value) => paint(80 + (value / 100) * 112), {
         request: (callback) => requestAnimationFrame(callback),
         cancel: (frame) => cancelAnimationFrame(frame),
      });
      motion.current = controller;
      const media = matchMedia("(prefers-reduced-motion: reduce)");
      const finish = () => {
         if (media.matches || document.hidden) controller.finish();
      };
      media.addEventListener("change", finish);
      document.addEventListener("visibilitychange", finish);
      return () => {
         controller.dispose();
         motion.current = null;
         element?.style.removeProperty("--list-thumbnail-size");
         media.removeEventListener("change", finish);
         document.removeEventListener("visibilitychange", finish);
      };
   }, [root]);
   useLayoutEffect(() => {
      const immediate = !active || document.hidden || matchMedia("(prefers-reduced-motion: reduce)").matches;
      setMoving(!immediate && Math.abs(currentSize.current - target) > 0.005);
      motion.current?.to(((target - 80) / 112) * 100, immediate);
   }, [target, active]);
   return moving;
}
