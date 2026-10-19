import { useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { Slider } from "../../../../src/renderer/src/Slider";
import { Segmented } from "../../../../src/renderer/src/ui";
import "../../../../src/renderer/src/ui.css";
import { MixerFader } from "../../../../src/renderer/src/MixerFader";
import "../../../../src/renderer/src/global.css";
import "../../../../src/renderer/src/Slider.css";
import "../../../../src/renderer/src/Recording.css";
export interface MotionSample {
   kind: string;
   time: number;
   position: number;
   target: number;
   fill: number;
   thumb: number;
}
export interface MotionProbe {
   pending: Set<number>;
   samples: MotionSample[];
   resizeSamples: MotionProbe["selectionSamples"];
   selectionSamples: Array<{ x: number; target: number; width: number; targetWidth: number; height: number; targetHeight: number; parentWidth: number }>;
}
declare global {
   interface Window {
      motionProbe: MotionProbe;
   }
}
const request = window.requestAnimationFrame.bind(window),
   cancel = window.cancelAnimationFrame.bind(window);
window.motionProbe = { pending: new Set(), samples: [], selectionSamples: [], resizeSamples: [] };
window.requestAnimationFrame = (callback) => {
   const frame = request((time) => {
      window.motionProbe.pending.delete(frame);
      callback(time);
   });
   window.motionProbe.pending.add(frame);
   return frame;
};
window.cancelAnimationFrame = (frame) => {
   window.motionProbe.pending.delete(frame);
   cancel(frame);
};
new MutationObserver((changes) => {
   for (const root of new Set(changes.map((change) => change.target))) {
      if (!(root instanceof HTMLElement)) continue;
      if (root.matches(".selection-indicator")) {
         const parent = root.parentElement!,
            selected = parent.querySelector("button.selected")!;
         const rect = root.getBoundingClientRect(),
            target = selected.getBoundingClientRect(),
            bounds = parent.getBoundingClientRect();
         window.motionProbe.selectionSamples.push({
            x: rect.left - bounds.left,
            target: target.left - bounds.left,
            width: rect.width,
            targetWidth: target.width,
            height: rect.height,
            targetHeight: target.height,
            parentWidth: bounds.width,
         });
         continue;
      }
      if (!root.matches(".slider,.mixer-fader")) continue;
      const input = root.querySelector<HTMLInputElement>('input[type="range"]')!,
         track = root.querySelector<HTMLElement>(".slider-track,.mixer-fader-track")!;
      const fill = track.querySelector<HTMLElement>(".slider-fill,.mixer-fader-fill")!,
         thumb = track.querySelector<HTMLElement>(".slider-thumb,.mixer-fader-thumb")!;
      const rect = track.getBoundingClientRect(),
         knob = thumb.getBoundingClientRect();
      window.motionProbe.samples.push({
         kind: input.getAttribute("aria-label")!,
         time: Number(document.timeline.currentTime),
         position: parseFloat(root.style.getPropertyValue("--slider-position")),
         target: ((Number(input.value) - Number(input.min)) / (Number(input.max) - Number(input.min))) * 100,
         fill: (fill.getBoundingClientRect().width / rect.width) * 100,
         thumb: ((knob.x + knob.width / 2 - rect.x) / rect.width) * 100,
      });
   }
   for (const element of document.querySelectorAll(".segmented,.segmented button")) resizeProbe.observe(element);
}).observe(document.getElementById("root")!, { subtree: true, attributes: true, attributeFilter: ["style"] });
function Fixture() {
   const [tab, setTab] = useState("a"),
      [barWidth, setBarWidth] = useState(900),
      [delayed, setDelayed] = useState(false);
   const writes = useRef(Promise.resolve());
   const [generic, setGeneric] = useState(0),
      [gain, setGain] = useState(0),
      [mounted, setMounted] = useState(true);
   return (
      <main style={{ padding: 40, display: "grid", gap: 20 }}>
         <div style={{ width: barWidth, maxWidth: "100%" }}>
            <Segmented
               label="Motion tabs"
               value={tab}
               onChange={setTab}
               values={[
                  { value: "a", label: "First" },
                  { value: "b", label: "Middle" },
                  { value: "c", label: "Last" },
               ]}
            />
         </div>
         <input type="range" min="300" max="900" value={barWidth} aria-label="Bar width" onChange={(event) => setBarWidth(Number(event.target.value))} />
         <label>
            <input type="checkbox" checked={delayed} onChange={(event) => setDelayed(event.target.checked)} />
            Delayed preferences
         </label>
         <button onClick={() => setMounted(!mounted)}>Toggle controls</button>
         <button
            onClick={() => {
               setGeneric(75);
               setGain(0.8);
            }}
         >
            External update
         </button>
         {mounted && (
            <>
               <Slider
                  aria-label="Generic"
                  min={0}
                  max={100}
                  step={1}
                  value={generic}
                  onValueChange={setGeneric}
                  numeric
                  defaultValue={50}
                  snapPoints={[0, 25, 50, 75, 100]}
               />
               <MixerFader
                  label="Gain"
                  value={gain}
                  onCommit={(next) => {
                     if (!delayed) {
                        setGain(next);
                        return;
                     }
                     writes.current = writes.current.then(async () => {
                        await new Promise((resolve) => setTimeout(resolve, 120));
                        setGain(next);
                     });
                     return writes.current;
                  }}
                  disabled={false}
               />
            </>
         )}
         <output id="values">
            {generic},{gain}
         </output>
      </main>
   );
}
createRoot(document.getElementById("root")!).render(<Fixture />);
const resizeProbe = new ResizeObserver(() =>
   request(() =>
      setTimeout(() => {
         for (const root of document.querySelectorAll<HTMLElement>(".selection-indicator")) {
            const parent = root.parentElement!,
               selected = parent.querySelector("button.selected")!;
            const rect = root.getBoundingClientRect(),
               target = selected.getBoundingClientRect(),
               bounds = parent.getBoundingClientRect();
            window.motionProbe.resizeSamples.push({
               x: rect.left - bounds.left,
               target: target.left - bounds.left,
               width: rect.width,
               targetWidth: target.width,
               height: rect.height,
               targetHeight: target.height,
               parentWidth: bounds.width,
            });
         }
      }, 0)
   )
);
