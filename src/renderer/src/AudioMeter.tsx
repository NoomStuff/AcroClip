import { useEffect, useRef } from "react";
import { advanceMeter } from "./audio-meter";
import type { MeterReading } from "./audio-meter";
export function AudioMeter({ name, level, muted, enabled, visible }: { name: string; level: number; muted: boolean; enabled: boolean; visible: boolean }) {
   const meter = useRef<HTMLDivElement>(null),
      target = useRef(level);
   target.current = level;
   useEffect(() => {
      const node = meter.current;
      if (!node) return;
      let painted = "";
      let frame = 0,
         previous = performance.now();
      let reading: MeterReading = { level: 0, peak: 0, holdUntil: 0, clipUntil: 0 };
      const paint = (now: number) => {
         const live = visible && enabled && !muted;
         reading = live ? advanceMeter(reading, target.current, now, Math.max(0, now - previous)) : { level: 0, peak: 0, holdUntil: 0, clipUntil: 0 };
         previous = now;
         const signature = `${reading.level.toFixed(2)}:${reading.peak.toFixed(2)}:${live && reading.clipUntil > now}`;
         if (signature !== painted) {
            painted = signature;
            node.style.setProperty("--meter-level", `${reading.level}%`);
            node.style.setProperty("--meter-peak", `${reading.peak}%`);
            node.dataset["clipping"] = live && reading.clipUntil > now ? "true" : "false";
            node.dataset["peakVisible"] = reading.peak > 0 ? "true" : "false";
            node.setAttribute("aria-valuenow", String(Math.round(reading.level * 0.6 - 60)));
            node.setAttribute(
               "aria-valuetext",
               !enabled
                  ? "Disabled"
                  : muted
                    ? "Muted"
                    : reading.level <= 0
                      ? "Below -60 dB"
                      : `${(reading.level * 0.6 - 60).toFixed(1)} dB, held peak ${(reading.peak * 0.6 - 60).toFixed(1)} dB${reading.clipUntil > now ? ", clipping" : ""}`
            );
         }
         if (live) frame = requestAnimationFrame(paint);
      };
      paint(previous);
      return () => cancelAnimationFrame(frame);
   }, [enabled, muted, visible]);
   return (
      <div
         ref={meter}
         className="audio-db-meter"
         role="meter"
         aria-label={`${name} peak`}
         aria-valuemin={-60}
         aria-valuemax={0}
         aria-valuenow={-60}
         data-muted={muted || !enabled || undefined}
      >
         <div className="audio-db-track">
            <div className="audio-db-fill" />
            <span className="audio-db-peak" />
            <span className="audio-db-clip" title="Peak reached 0 dBFS" />
         </div>
         <div className="audio-db-scale" aria-hidden="true">
            {[-60, -48, -36, -24, -12, 0].map((db) => (
               <span key={db}>{db}</span>
            ))}
         </div>
      </div>
   );
}
