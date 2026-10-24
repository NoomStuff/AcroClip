import { useEffect, useState } from "react";
import { Check, Cpu } from "lucide-react";
import type { Preferences, RecordingCapabilities } from "../../shared/types";
import { applyRecordingPreset } from "../../shared/recording-presets";
import { api } from "./desktop";
import { Field, Select, Toggle } from "./ui";
import { Slider } from "./Slider";
function QualityPicker({
   value,
   onChange,
   recommended,
}: {
   value: Preferences["quality"];
   onChange: (value: Preferences["quality"]) => void;
   recommended?: "low" | "standard";
}) {
   return (
      <div className="quality-options">
         {(
            [
               { value: "low", title: "Low", detail: "720p · 30 fps" },
               { value: "standard", title: "Standard", detail: "1080p · 60 fps" },
               { value: "high", title: "High", detail: "1440p · 60 fps" },
               { value: "custom", title: "Custom", detail: "" },
            ] as const
         ).map((item) => (
            <button
               key={item.value}
               className={`quality-option ${value === item.value ? "selected" : ""}`}
               onClick={() => onChange(item.value)}
               aria-pressed={value === item.value}
            >
               <span className="quality-dot">{value === item.value && <Check size={12} />}</span>
               <strong>
                  {item.title}
                  {item.value === recommended && (
                     <span className="quality-hardware-hint" role="img" aria-label="Suggested for your hardware" title="Suggested for your hardware">
                        <Cpu size={14} aria-hidden="true" />
                     </span>
                  )}
               </strong>
               {item.detail && <span>{item.detail}</span>}
            </button>
         ))}
      </div>
   );
}
export function customQualityError(value: Preferences): string {
   if (!Number.isInteger(value.customFPS) || value.customFPS < 1 || value.customFPS > 120) return "Frame rate must be between 1 and 120 fps.";
   return "";
}
function CustomQualityControls({ value, onChange }: { value: Preferences; onChange: (patch: Partial<Preferences>) => void }) {
   return (
      <div className="custom-quality">
         <Field label="Resolution limit">
            <Select label="Resolution limit" value={String(value.resolutionLimit)} onChange={(limit) => onChange({ resolutionLimit: Number(limit) })}>
               <option value="0">Original</option>
               {[720, 1080, 1440, 2160].map((limit) => (
                  <option key={limit} value={limit}>
                     {limit === 2160 ? "4K" : `${limit}p`}
                  </option>
               ))}
               {value.resolutionLimit !== 0 && ![720, 1080, 1440, 2160].includes(value.resolutionLimit) && (
                  <option value={value.resolutionLimit}>{value.resolutionLimit}p</option>
               )}
            </Select>
         </Field>
         <Field label="Frame rate">
            <Select label="Recording frame rate" value={String(value.customFPS)} onChange={(fps) => onChange({ customFPS: Number(fps) })}>
               {[30, 60, 120].map((fps) => (
                  <option key={fps} value={fps}>
                     {fps} fps
                  </option>
               ))}
               {![30, 60, 120].includes(value.customFPS) && <option value={Number.isNaN(value.customFPS) ? "" : value.customFPS}>{value.customFPS} fps</option>}
            </Select>
         </Field>
         <Field label="Compression" detail="Lower values keep more detail and use more space.">
            <div className="compression-slider">
               <div>
                  <span>More detail</span>
                  <span>Smaller files</span>
               </div>
               <Slider
                  aria-label="Recording compression"
                  min={12}
                  max={35}
                  step={1}
                  value={value.customCQ}
                  numeric
                  defaultValue={23}
                  snapPoints={[12, 18, 23, 35]}
                  onValueChange={(next) => onChange({ customCQ: next })}
               />
            </div>
         </Field>
         <div className="quality-advanced">
            <Toggle
               label="Allow software encoding"
               detail="Uses your CPU if no supported hardware encoder is available."
               checked={value.allowSoftwareEncoder}
               onChange={(enabled) => onChange({ allowSoftwareEncoder: enabled })}
            />
         </div>
      </div>
   );
}

export function RecordingPresets({
   value,
   onChange,
   capabilities: providedCapabilities,
}: {
   value: Preferences;
   onChange: (value: Preferences) => void;
   capabilities?: RecordingCapabilities | null;
}) {
   const [capabilities, setCapabilities] = useState<RecordingCapabilities | null>(providedCapabilities ?? null);
   useEffect(() => {
      if (!providedCapabilities)
         void api
            .recordingCapabilities()
            .then(setCapabilities)
            .catch(() => undefined);
   }, [providedCapabilities]);
   const detected = providedCapabilities ?? capabilities;
   return (
      <>
         <QualityPicker
            value={value.quality}
            {...(detected?.supported ? { recommended: detected.recommended } : {})}
            onChange={(quality) => onChange(applyRecordingPreset(value, quality))}
         />
         <p className="preset-source-note">Screen capture uses the resolution limit. Applications keep their original size.</p>
         <CustomQualityControls value={value} onChange={(patch) => onChange({ ...value, ...patch, quality: "custom" })} />
      </>
   );
}
