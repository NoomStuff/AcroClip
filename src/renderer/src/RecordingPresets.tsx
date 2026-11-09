import { useEffect, useId, useState } from "react";
import { Check, ChevronDown, Cpu, Monitor, Gauge, MemoryStick, Settings2, SlidersHorizontal } from "lucide-react";
import type { Preferences, RecordingCapabilities } from "../../shared/types";
import { applyRecordingPreset } from "../../shared/recording-presets";
import { automaticReplayMemoryMB, memoryLabel, replayMemoryChoicesFor } from "../../shared/replay-memory";
import { replayEstimate } from "./replay-estimate";
import { durationText } from "./TimeInput";
import { api } from "./desktop";
import { Field, Select, Toggle } from "./ui";
import { PresetNumberInput } from "./PresetNumberInput";
import { Field as SettingsField, Toggle as SettingsToggle } from "./SettingsControls";
import { Slider } from "./Slider";
function QualityPicker({
   value,
   onChange,
   recommended,
   customSummary,
}: {
   value: Preferences["quality"];
   onChange: (value: Preferences["quality"]) => void;
   recommended?: "low" | "standard";
   customSummary: string;
}) {
   return (
      <div className="quality-options">
         {(
            [
               { value: "low", title: "Low", detail: "720p · 30 fps" },
               { value: "standard", title: "Standard", detail: "1080p · 60 fps" },
               { value: "high", title: "High", detail: "Source · 60 fps" },
               { value: "custom", title: "Custom", detail: customSummary },
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
                     <span className="quality-hardware-hint" role="img" aria-label="Suggested for your hardware" data-tooltip="Suggested for your hardware">
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
function compressionLevel(cq: number): string {
   if (cq <= 16) return "Near lossless";
   if (cq <= 21) return "High detail";
   if (cq <= 25) return "Balanced";
   if (cq <= 30) return "Compact";
   return "Smallest";
}
function replayMemoryDetail(value: Preferences, memoryBytes: number | undefined): string {
   const base = "Holds recent footage for clips.";
   if (!memoryBytes) return base;
   const estimate = replayEstimate(value, memoryBytes);
   return `${base} Keeps full quality up to about ${durationText(estimate.fullQualitySeconds)} at this quality.`;
}
function AdvancedQualityControls({
   value,
   onChange,
   compact,
   memoryBytes,
}: {
   value: Preferences;
   onChange: (patch: Partial<Preferences>) => void;
   compact: boolean;
   memoryBytes: number | undefined;
}) {
   const [open, setOpen] = useState(false);
   const id = useId();
   const ControlField = compact ? SettingsField : Field;
   const ControlToggle = compact ? SettingsToggle : Toggle;
   const choices = memoryBytes ? replayMemoryChoicesFor(memoryBytes) : [];
   // A saved size this PC no longer offers stays selectable.
   if (value.replayMemoryMB !== 0 && !choices.includes(value.replayMemoryMB)) choices.push(value.replayMemoryMB);
   choices.sort((a, b) => a - b);
   return (
      <div className="quality-advanced" data-open={open || undefined}>
         <button
            type="button"
            className={`quality-advanced-toggle ${compact ? "settings-row" : ""}`}
            aria-expanded={open}
            aria-controls={id}
            aria-describedby={compact ? `${id}-detail` : undefined}
            onClick={() => setOpen(!open)}
         >
            {compact && <Settings2 className="settings-row-icon" size={21} aria-hidden="true" />}
            <span className="quality-advanced-copy">
               Advanced
               {compact && (
                  <span className="field-detail" id={`${id}-detail`} aria-hidden="true">
                     Replay memory and software encoding
                  </span>
               )}
            </span>
            <ChevronDown size={compact ? 18 : 14} aria-hidden="true" />
         </button>
         <div className="quality-advanced-fold" id={id} inert={!open} aria-hidden={!open}>
            <div className="quality-advanced-body">
               <ControlField {...(compact ? { icon: MemoryStick } : {})} label="Replay memory" detail={replayMemoryDetail(value, memoryBytes)}>
                  <Select label="Replay memory" value={String(value.replayMemoryMB)} onChange={(next) => onChange({ replayMemoryMB: Number(next) })}>
                     <option value="0">{memoryBytes ? `Automatic (${memoryLabel(automaticReplayMemoryMB(memoryBytes))})` : "Automatic"}</option>
                     {choices.map((megabytes) => (
                        <option key={megabytes} value={megabytes}>
                           {memoryLabel(megabytes)}
                        </option>
                     ))}
                  </Select>
               </ControlField>
               <ControlToggle
                  {...(compact ? { icon: Cpu } : {})}
                  label="Allow software encoding"
                  detail="Uses your CPU if no supported hardware encoder is available."
                  checked={value.allowSoftwareEncoder}
                  onChange={(enabled) => onChange({ allowSoftwareEncoder: enabled })}
               />
            </div>
         </div>
      </div>
   );
}
const frameRates = [30, 60, 120];
function CustomQualityControls({
   value,
   onChange,
   compact = false,
   memoryBytes,
}: {
   value: Preferences;
   onChange: (patch: Partial<Preferences>) => void;
   compact?: boolean;
   memoryBytes: number | undefined;
}) {
   const ControlField = compact ? SettingsField : Field;
   return (
      <div className="custom-quality">
         <ControlField
            {...(compact ? { icon: Monitor } : {})}
            label="Resolution limit"
            {...(compact ? { detail: "Screens scale to this limit. Apps keep their original size." } : {})}
         >
            <Select label="Resolution limit" value={String(value.resolutionLimit)} onChange={(limit) => onChange({ resolutionLimit: Number(limit) })}>
               {[720, 1080, 1440, 2160].map((limit) => (
                  <option key={limit} value={limit}>
                     {limit === 2160 ? "4K" : `${limit}p`}
                  </option>
               ))}
               {value.resolutionLimit !== 0 && ![720, 1080, 1440, 2160].includes(value.resolutionLimit) && (
                  <option value={value.resolutionLimit}>{value.resolutionLimit}p</option>
               )}
               <option value="0">Source</option>
            </Select>
         </ControlField>
         <ControlField {...(compact ? { icon: Gauge } : {})} label="Frame rate">
            <PresetNumberInput
               label="Frame rate"
               inputLabel="Capture frame rate"
               presets={frameRates}
               presetLabel={String}
               min={1}
               max={120}
               value={value.customFPS}
               unit="fps"
               onValueChange={(customFPS) => onChange({ customFPS })}
            />
         </ControlField>
         <ControlField {...(compact ? { icon: SlidersHorizontal } : {})} label="Compression" detail="Lower values keep more detail and use more space.">
            <div className="compression-slider">
               <Slider
                  aria-label="Capture compression"
                  min={12}
                  max={35}
                  step={1}
                  value={value.customCQ}
                  numeric
                  numberSide="start"
                  defaultValue={23}
                  snapPoints={[12, 20, 23, 35]}
                  onValueChange={(next) => onChange({ customCQ: next })}
               />
               <div className="compression-scale" aria-hidden="true">
                  <span>More detail</span>
                  <strong>{compressionLevel(value.customCQ)}</strong>
                  <span>Smaller files</span>
               </div>
            </div>
         </ControlField>
         <AdvancedQualityControls compact={compact} value={value} onChange={onChange} memoryBytes={memoryBytes} />
      </div>
   );
}

export function RecordingPresets({ value, onChange, compact = false }: { value: Preferences; onChange: (value: Preferences) => void; compact?: boolean }) {
   const [capabilities, setCapabilities] = useState<RecordingCapabilities | null>(null);
   useEffect(() => {
      void api
         .recordingCapabilities()
         .then(setCapabilities)
         .catch(() => undefined);
   }, []);
   return (
      <>
         <QualityPicker
            value={value.quality}
            customSummary={`${value.resolutionLimit === 0 ? "Source" : value.resolutionLimit === 2160 ? "4K" : `${value.resolutionLimit}p`} · ${value.customFPS} fps`}
            {...(capabilities?.supported ? { recommended: capabilities.recommended } : {})}
            onChange={(quality) => onChange(applyRecordingPreset(value, quality))}
         />
         {!compact && (
            <p className="preset-source-note">
               Screens use the resolution limit. Apps use their original size. The capture size is set when a source starts and stays fixed while it is
               captured.
            </p>
         )}
         <CustomQualityControls
            compact={compact}
            value={value}
            memoryBytes={capabilities?.memoryBytes}
            onChange={(patch) =>
               // Advanced settings apply to every preset rather than making it custom.
               onChange({ ...value, ...patch, quality: "replayMemoryMB" in patch || "allowSoftwareEncoder" in patch ? value.quality : "custom" })
            }
         />
      </>
   );
}
