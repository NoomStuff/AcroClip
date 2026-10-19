import { useLayoutEffect, useRef } from "react";
import { createSliderMotion, createHoverMotion } from "./slider-motion";

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
   useLayoutEffect(() => {
      const node = element.current,
         control = node?.querySelector<HTMLElement>(".slider-control"),
         input = control?.querySelector<HTMLInputElement>("input");
      if (!node || !control || !input) return;
      const media = matchMedia("(prefers-reduced-motion: reduce)");
      let hovered = false,
         focused = false,
         pressed = false;
      const motion = createHoverMotion(0, (value) => node.style.setProperty("--slider-thumb-width", `${10 + value * 5}px`), {
         request: (callback) => requestAnimationFrame(callback),
         cancel: (frame) => cancelAnimationFrame(frame),
      });
      const update = () => motion.to(input.disabled ? 0 : pressed ? 1 : hovered || focused ? 0.6 : 0, media.matches || document.hidden);
      const enter = () => {
            hovered = true;
            update();
         },
         leave = () => {
            hovered = false;
            update();
         },
         focus = () => {
            focused = true;
            update();
         },
         blur = () => {
            focused = false;
            pressed = false;
            update();
         },
         down = () => {
            pressed = true;
            update();
         },
         up = () => {
            pressed = false;
            update();
         };
      control.addEventListener("pointerenter", enter);
      control.addEventListener("pointerleave", leave);
      input.addEventListener("focus", focus);
      input.addEventListener("blur", blur);
      input.addEventListener("pointerdown", down);
      window.addEventListener("pointerup", up);
      window.addEventListener("pointercancel", up);
      media.addEventListener("change", update);
      return () => {
         motion.dispose();
         control.removeEventListener("pointerenter", enter);
         control.removeEventListener("pointerleave", leave);
         input.removeEventListener("focus", focus);
         input.removeEventListener("blur", blur);
         input.removeEventListener("pointerdown", down);
         window.removeEventListener("pointerup", up);
         window.removeEventListener("pointercancel", up);
         media.removeEventListener("change", update);
      };
   }, []);
   return element;
}
