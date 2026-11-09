import { useLayoutEffect, useRef } from "react";
import { createSliderMotion } from "./slider-motion";

export function useSliderMotion<T extends HTMLElement>(position: number) {
   const element = useRef<T>(null);
   const initial = useRef(position);
   const controller = useRef<ReturnType<typeof createSliderMotion> | null>(null);
   useLayoutEffect(() => {
      const node = element.current;
      if (!node) return;
      const media = window.matchMedia("(prefers-reduced-motion: reduce)");
      const paint = (next: number) => node.style.setProperty("--slider-position", `${next}%`);
      paint(initial.current);
      const motion = createSliderMotion(initial.current, paint, {
         request: (callback) => requestAnimationFrame(callback),
         cancel: (frame) => cancelAnimationFrame(frame),
      });
      controller.current = motion;
      const finish = () => {
         if (media.matches || document.hidden) motion.finish();
      };
      media.addEventListener("change", finish);
      document.addEventListener("visibilitychange", finish);
      return () => {
         motion.dispose();
         controller.current = null;
         media.removeEventListener("change", finish);
         document.removeEventListener("visibilitychange", finish);
      };
   }, []);
   useLayoutEffect(() => {
      controller.current?.to(position, document.hidden || window.matchMedia("(prefers-reduced-motion: reduce)").matches);
   }, [position]);
   return element;
}
