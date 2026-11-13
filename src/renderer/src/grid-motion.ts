import type { FrameScheduler } from "./slider-motion";

export interface GridPoint {
   left: number;
   top: number;
}

export interface GridRect extends GridPoint {
   width: number;
   height: number;
}
export type GridCardStyle = Pick<CSSStyleDeclaration, "transform" | "width" | "height" | "removeProperty">;
export type GridThumbnailStyle = Pick<CSSStyleDeclaration, "width" | "height" | "flexBasis" | "removeProperty">;

export function paintGridThumbnail(style: GridThumbnailStyle, current?: GridRect, target?: GridRect) {
   if (current && target && (current.width !== target.width || current.height !== target.height)) {
      style.width = `${current.width}px`;
      style.height = `${current.height}px`;
      style.flexBasis = `${current.width}px`;
   } else {
      style.removeProperty("width");
      style.removeProperty("height");
      style.removeProperty("flex-basis");
   }
}

export function paintGridCard(style: GridCardStyle, offset: GridPoint, current?: GridRect, target?: GridRect) {
   style.removeProperty("transform-origin");
   if (offset.left === 0 && offset.top === 0) style.removeProperty("transform");
   else style.transform = `translate3d(${offset.left}px, ${offset.top}px, 0)`;
   if (current && target && (current.width !== target.width || current.height !== target.height)) {
      style.width = `${current.width}px`;
      style.height = `${current.height}px`;
   } else {
      style.removeProperty("width");
      style.removeProperty("height");
   }
}

export function createGridMotion<Key>(
   paint: (key: Key, offset: GridPoint, current?: GridRect, target?: GridRect) => void,
   scheduler: FrameScheduler,
   settled?: () => void
) {
   const items = new Map<Key, { current: GridRect; target: GridRect }>();
   let frame = 0;
   let lastTime: number | null = null;
   const offset = (item: { current: GridRect; target: GridRect }): GridPoint => ({
      left: item.current.left - item.target.left,
      top: item.current.top - item.target.top,
   });
   const moving = (item: { current: GridRect; target: GridRect }) =>
      item.current.left !== item.target.left ||
      item.current.top !== item.target.top ||
      item.current.width !== item.target.width ||
      item.current.height !== item.target.height;
   const step = (time: number) => {
      frame = 0;
      const dt = lastTime === null ? 0 : Math.max(0, Math.min(0.1, (time - lastTime) / 1000));
      lastTime = time;
      const amount = 1 - Math.exp(-24 * dt);
      let pending = false;
      for (const [key, item] of items) {
         if (!moving(item)) continue;
         item.current.left += (item.target.left - item.current.left) * amount;
         item.current.top += (item.target.top - item.current.top) * amount;
         item.current.width += (item.target.width - item.current.width) * amount;
         item.current.height += (item.target.height - item.current.height) * amount;
         if (
            Math.hypot(
               item.current.left - item.target.left,
               item.current.top - item.target.top,
               item.current.width - item.target.width,
               item.current.height - item.target.height
            ) < 0.2
         )
            item.current = { ...item.target };
         paint(key, offset(item), item.current, item.target);
         pending ||= moving(item);
      }
      if (pending) frame = scheduler.request(step);
      else {
         lastTime = null;
         settled?.();
      }
   };
   const clear = () => {
      scheduler.cancel(frame);
      frame = 0;
      lastTime = null;
      for (const key of items.keys()) paint(key, { left: 0, top: 0 });
      items.clear();
      settled?.();
   };
   return {
      get active() {
         return frame !== 0;
      },
      has(key: Key) {
         return items.has(key);
      },
      offset(key: Key): GridPoint {
         const item = items.get(key);
         return item ? offset(item) : { left: 0, top: 0 };
      },
      to(key: Key, target: GridRect, enter = false, immediate = false) {
         let item = items.get(key);
         if (!item) {
            item = { current: { ...target, top: target.top + (enter ? 6 : 0) }, target: { ...target } };
            items.set(key, item);
         } else item.target = { ...target };
         if (immediate) item.current = { ...target };
         // Compensate for the new DOM layout before paint, keeping the current visual position.
         paint(key, offset(item), item.current, item.target);
         if (!frame && moving(item)) frame = scheduler.request(step);
      },
      retain(keys: ReadonlySet<Key>) {
         for (const key of items.keys()) {
            if (keys.has(key)) continue;
            paint(key, { left: 0, top: 0 });
            items.delete(key);
         }
      },
      clear,
   };
}
