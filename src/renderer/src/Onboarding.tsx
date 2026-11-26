import { useEffect, useRef, useState } from "react";
import {
   ArrowLeft,
   ArrowRight,
   Check,
   Clapperboard,
   Clock,
   FileVideo,
   Mic,
   Monitor,
   PanelBottomClose,
   Power,
   Scissors,
   SignalHigh,
   SignalLow,
   SignalMedium,
} from "lucide-react";
import type { AppState, OverlapClips, Preferences, RecordingCapabilities } from "../../shared/types";
import { api, describeError } from "./desktop";
import { Button, Select, NumberInput } from "./ui";
import { Field, Toggle as SettingToggle } from "./SettingsControls";
import type { Run } from "./desktop";
import { ShortcutInput } from "./ShortcutInput";
import { applyRecordingPreset } from "../../shared/recording-presets";
import { HardwareHint } from "./RecordingPresets";
import { FolderPicker } from "./FolderPicker";
import { WarningIcon } from "./WarningIcon";
import { clipLengthWarning, useInstalledMemory } from "./replay-estimate";
import { overlapDetail } from "./overlap-copy";
import { settingCopy, startWithOSDetail } from "./settings-catalog";
import { withToggleShortcut } from "../../shared/shortcuts";

const steps = [
   { label: "Record", icon: Monitor },
   { label: "Save", icon: Clapperboard },
   { label: "Start", icon: Power },
] as const;
// Custom is left to Settings, where the values behind it can be edited.
const qualityChoices = [
   { quality: "low", title: "Low", detail: "720p at 30 fps. Smallest files, easiest on your computer.", icon: SignalLow },
   { quality: "standard", title: "Standard", detail: "1080p at 60 fps. Balances detail and file size.", icon: SignalMedium },
   { quality: "high", title: "High", detail: "Full resolution at 60 fps with extra detail. Largest files.", icon: SignalHigh },
] as const satisfies readonly { quality: Preferences["quality"]; title: string; detail: string; icon: typeof Monitor }[];

export function Onboarding({ state, run }: { state: AppState; run: Run }) {
   const [step, setStep] = useState(0);
   const [direction, setDirection] = useState(1);
   const [transitioning, setTransitioning] = useState(false);
   const navigationPending = useRef(false);
   const [draft, setDraft] = useState(() => ({ ...state.preferences, microphone: true, microphoneMuted: false }));
   const [busy, setBusy] = useState(false);
   const [micPending, setMicPending] = useState(false);
   const [micMessage, setMicMessage] = useState("");
   const [audioDevices, setAudioDevices] = useState<{ id: string; name: string }[]>([]);
   const [capabilities, setCapabilities] = useState<RecordingCapabilities | null>(null);
   const [capabilityError, setCapabilityError] = useState("");
   const root = useRef<HTMLDivElement>(null);
   const heading = useRef<HTMLHeadingElement>(null);
   const qualityPicked = useRef(false);
   useEffect(() => {
      heading.current?.focus({ preventScroll: true });
   }, [step]);
   useEffect(() => {
      const trap = (event: KeyboardEvent) => {
         if (event.key !== "Tab") return;
         const controls = Array.from(root.current?.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled), [tabindex="0"]') ?? []).filter(
            (element) => element.getClientRects().length > 0
         );
         const first = controls[0],
            last = controls.at(-1);
         if (!first || !last) return;
         if (event.shiftKey && (document.activeElement === first || document.activeElement === heading.current)) {
            event.preventDefault();
            last.focus();
         } else if (!event.shiftKey && document.activeElement === last) {
            event.preventDefault();
            first.focus();
         }
      };
      const current = root.current;
      current?.addEventListener("keydown", trap);
      return () => current?.removeEventListener("keydown", trap);
   }, []);
   useEffect(() => {
      let disposed = false;
      void api
         .recordingCapabilities()
         .then((result) => {
            if (disposed) return;
            setCapabilities(result);
            if (result.supported && !qualityPicked.current)
               setDraft((current) => (current.quality === "custom" ? current : applyRecordingPreset(current, result.recommended)));
         })
         .catch((failure: unknown) => {
            if (!disposed) setCapabilityError(describeError(failure));
         });
      return () => {
         disposed = true;
      };
   }, []);
   useEffect(() => {
      let disposed = false;
      void api
         .audioDevices("input")
         .then((devices) => {
            if (!disposed) setAudioDevices(devices);
         })
         .catch(() => {
            if (!disposed) setMicMessage("Couldn't list microphones. Default is still available.");
         });
      return () => {
         disposed = true;
      };
   }, []);
   const change = <K extends keyof Preferences>(key: K, value: Preferences[K]) => setDraft((current) => ({ ...current, [key]: value }));
   const pickQuality = (quality: Preferences["quality"]) => {
      qualityPicked.current = true;
      setDraft((current) => applyRecordingPreset(current, quality));
   };
   const microphone = async (device: string) => {
      if (device === "none") {
         setDraft((current) => ({ ...current, microphone: false, microphoneDevice: "default", microphoneMuted: true }));
         setMicMessage("");
         return;
      }
      setMicPending(true);
      setMicMessage("");
      try {
         const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
         stream.getTracks().forEach((track) => track.stop());
         setDraft((current) => ({ ...current, microphone: true, microphoneDevice: device, microphoneMuted: false }));
      } catch {
         setDraft((current) => ({ ...current, microphone: false, microphoneDevice: "default", microphoneMuted: true }));
         setMicMessage("Microphone unavailable. Allow access in system settings, then try again.");
      } finally {
         setMicPending(false);
      }
   };
   const choose = () =>
      void run(async () => {
         const folder = await api.chooseFolder();
         if (folder) change("collection", folder);
      });
   // The recorder takes a few seconds to answer. Auto-capture stays on until it says it can't run.
   const canRecord = !capabilityError && capabilities?.supported !== false;
   const autoRecord = draft.autoRecord && canRecord;
   const lengthValid = Number.isInteger(draft.clipSeconds) && draft.clipSeconds >= 5 && draft.clipSeconds <= 1800;
   const memoryBytes = useInstalledMemory();
   const lengthWarning = lengthValid ? clipLengthWarning(draft, memoryBytes) : null;
   // Finishing never starts capture. The source is picked on the Capture page, which setup closes onto.
   const finish = async () => {
      if (busy || navigationPending.current || micPending || !lengthValid || !draft.collection) return;
      setBusy(true);
      const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      await root.current?.animate([{ opacity: 1 }, { opacity: 0, transform: "translateY(-8px)" }], {
         duration: reduced ? 0 : 200,
         fill: "forwards",
         easing: "ease-in",
      }).finished;
      const saved = await run(() =>
         api.savePreferences({ ...draft, shortcuts: withToggleShortcut(draft, state.platform === "darwin"), autoRecord, setupComplete: true })
      );
      if (!saved) root.current?.getAnimations().forEach((animation) => animation.cancel());
      setBusy(false);
   };
   const navigate = async (next: number) => {
      if (navigationPending.current || busy) return;
      navigationPending.current = true;
      setTransitioning(true);
      const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      await root.current?.querySelector(".setup-page")?.animate(
         [
            { opacity: 1, transform: "translateX(0)" },
            { opacity: 0, transform: `translateX(${next > step ? -24 : 24}px)` },
         ],
         { duration: reduced ? 0 : 130, easing: "ease-in" }
      ).finished;
      setDirection(next > step ? 1 : -1);
      setStep(next);
      setTransitioning(false);
      navigationPending.current = false;
   };
   return (
      <div className="onboarding-backdrop" role="dialog" aria-modal="true" aria-labelledby="setup-heading" ref={root}>
         <div className="onboarding" data-direction={direction}>
            <ol className="setup-progress" aria-label="Setup progress">
               {steps.map(({ label, icon: StepIcon }, index) => (
                  <li key={label} className={index < step ? "complete" : index === step ? "current" : ""} aria-current={index === step ? "step" : undefined}>
                     <button
                        aria-label={`${label}, step ${index + 1} of ${steps.length}`}
                        disabled={index >= step || busy || transitioning}
                        onClick={() => void navigate(index)}
                     >
                        <span aria-hidden="true">{index < step ? <Check size={13} /> : <StepIcon size={13} />}</span>
                        {label}
                     </button>
                     {index < steps.length - 1 && (
                        <span className="setup-progress-line" aria-hidden="true">
                           <span />
                        </span>
                     )}
                  </li>
               ))}
            </ol>
            <div className="setup-page" key={step} inert={transitioning || busy}>
               <h1 id="setup-heading" ref={heading} tabIndex={-1}>
                  {step === 0 ? "How should clips look and sound?" : step === 1 ? "Pick your clip shortcut" : "How should it start?"}
               </h1>
               <fieldset className="setup-fields" disabled={busy}>
                  {step === 0 ? (
                     <div className="settings-body setup-body">
                        <section className="settings-group">
                           <div className="setup-choices" role="radiogroup" aria-label="Quality">
                              {qualityChoices.map(({ quality, title, detail, icon: QualityIcon }, index) => {
                                 const selected = draft.quality === quality;
                                 return (
                                    <div
                                       key={quality}
                                       role="radio"
                                       tabIndex={selected || (draft.quality === "custom" && index === 0) ? 0 : -1}
                                       aria-checked={selected}
                                       className="settings-row settings-surface setup-choice"
                                       onClick={() => pickQuality(quality)}
                                       onKeyDown={(event) => {
                                          const forward = event.key === "ArrowDown" || event.key === "ArrowRight";
                                          const back = event.key === "ArrowUp" || event.key === "ArrowLeft";
                                          if (!forward && !back && event.key !== " " && event.key !== "Enter") return;
                                          event.preventDefault();
                                          const move = forward ? 1 : back ? -1 : 0;
                                          const target = (index + move + qualityChoices.length) % qualityChoices.length;
                                          pickQuality(qualityChoices[target]!.quality);
                                          const row = event.currentTarget.parentElement?.children[target];
                                          if (row instanceof HTMLElement) row.focus();
                                       }}
                                    >
                                       <QualityIcon className="settings-row-icon" size={21} aria-hidden="true" />
                                       <div className="settings-row-copy">
                                          <span className="field-label">
                                             {title}
                                             {capabilities?.supported && capabilities.recommended === quality && <HardwareHint />}
                                          </span>
                                          <p className="field-detail">{detail}</p>
                                       </div>
                                       <span className="setup-radio" aria-hidden="true">
                                          <Check size={13} strokeWidth={3} />
                                       </span>
                                    </div>
                                 );
                              })}
                           </div>
                        </section>
                        <section className="settings-group">
                           <Field
                              icon={Mic}
                              label="Microphone"
                              detail={micPending ? "Waiting for microphone permission…" : micMessage || "Your voice, recorded alongside the game."}
                           >
                              <Select
                                 label="Microphone input"
                                 value={draft.microphone && !draft.microphoneMuted ? draft.microphoneDevice : "none"}
                                 disabled={micPending}
                                 onChange={(value) => void microphone(value)}
                              >
                                 <option value="none">Off</option>
                                 <option value="default">Default device</option>
                                 {audioDevices
                                    .filter((device) => device.id !== "default")
                                    .map((device) => (
                                       <option key={device.id} value={device.id}>
                                          {device.name}
                                       </option>
                                    ))}
                                 {draft.microphoneDevice !== "default" && !audioDevices.some((device) => device.id === draft.microphoneDevice) && (
                                    <option value={draft.microphoneDevice}>Unavailable microphone</option>
                                 )}
                              </Select>
                           </Field>
                        </section>
                     </div>
                  ) : step === 1 ? (
                     <div className="settings-body setup-body">
                        <div className="setup-shortcut">
                           <ShortcutInput global value={draft.shortcut} onChange={(value) => change("shortcut", value)} />
                        </div>
                        <section className="settings-group">
                           <Field icon={Clock} label="Clip length" detail={lengthValid ? "How far back each clip reaches." : "Choose 5 to 1800 whole seconds."}>
                              <div className="clip-length-control">
                                 <WarningIcon message={lengthWarning?.message ?? ""} error={!!lengthWarning?.error} id="setup-length-message" />
                                 <NumberInput
                                    id="setup-length"
                                    aria-label="Clip length in seconds"
                                    min={5}
                                    max={1800}
                                    step={5}
                                    value={draft.clipSeconds}
                                    onValueChange={(value) => change("clipSeconds", value)}
                                    unit="seconds"
                                 />
                              </div>
                           </Field>
                           <Field icon={Scissors} label={settingCopy.overlap.label} detail={overlapDetail(draft.overlapClips, draft.clipSeconds)}>
                              <Select
                                 label={settingCopy.overlap.label}
                                 value={draft.overlapClips}
                                 onChange={(value) => change("overlapClips", value as OverlapClips)}
                              >
                                 <option value="keep">Save normally</option>
                                 <option value="trim">Save what's new</option>
                                 <option value="merge">Extend previous clip</option>
                              </Select>
                           </Field>
                           <FolderPicker path={draft.collection} onChoose={choose} className="settings-surface" />
                        </section>
                     </div>
                  ) : (
                     <div className="settings-body setup-body">
                        <section className="settings-group">
                           <SettingToggle
                              icon={Power}
                              label={settingCopy.startWithOS.label}
                              detail={startWithOSDetail(state.platform)}
                              checked={draft.startWithOS}
                              onChange={(value) => change("startWithOS", value)}
                           />
                           <SettingToggle
                              icon={PanelBottomClose}
                              label={settingCopy.startInTray.label}
                              detail={settingCopy.startInTray.detail}
                              checked={draft.startWithOS && draft.startInTray}
                              disabled={!draft.startWithOS}
                              onChange={(value) => change("startInTray", value)}
                           />
                           <SettingToggle
                              icon={FileVideo}
                              label={settingCopy.autoRecord.label}
                              detail={canRecord ? settingCopy.autoRecord.detail : "Capture isn't available yet. You can start it from the Capture page."}
                              checked={autoRecord}
                              disabled={!canRecord}
                              onChange={(value) => change("autoRecord", value)}
                           />
                        </section>
                     </div>
                  )}
               </fieldset>
            </div>
            {(capabilityError || (capabilities && !capabilities.supported)) && (
               <p className="setup-note" role="status">
                  {capabilityError || capabilities?.message || "Capture is unavailable. You can set it up later."}
               </p>
            )}
            <footer className="onboarding-actions">
               {step === 0 ? (
                  <Button className="quiet" disabled={busy || transitioning || micPending || !lengthValid || !draft.collection} onClick={() => void finish()}>
                     Skip setup
                  </Button>
               ) : (
                  <Button className="quiet" disabled={busy || transitioning} onClick={() => void navigate(step - 1)}>
                     <ArrowLeft size={15} />
                     Back
                  </Button>
               )}
               {step < steps.length - 1 ? (
                  <Button
                     className="primary"
                     disabled={transitioning || micPending || (step > 0 && (!lengthValid || !draft.collection))}
                     onClick={() => void navigate(step + 1)}
                  >
                     Continue
                     <ArrowRight size={15} />
                  </Button>
               ) : (
                  <Button
                     className="primary"
                     busy={busy}
                     disabled={transitioning || micPending || !lengthValid || !draft.collection}
                     onClick={() => void finish()}
                  >
                     Finish
                  </Button>
               )}
            </footer>
         </div>
      </div>
   );
}
