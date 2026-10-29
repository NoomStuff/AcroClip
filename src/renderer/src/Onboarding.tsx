import { useEffect, useRef, useState } from "react";
import { ArrowLeft, ArrowRight, Check, Clapperboard, Monitor } from "lucide-react";
import type { AppState, CaptureSource, Preferences, RecordingCapabilities, SourceKind } from "../../shared/types";
import { api, describeError } from "./desktop";
import { Button, Segmented, Select, Toggle, NumberInput } from "./ui";
import type { Run } from "./desktop";
import { ShortcutInput } from "./ShortcutInput";
import { applyRecordingPreset } from "../../shared/recording-presets";
import { portalScreenId, sourceChoices } from "../../shared/capture-policy";
import { FolderPicker } from "./FolderPicker";

const steps = [
   { label: "Capture", icon: Monitor },
   { label: "Clipping", icon: Clapperboard },
   { label: "Ready", icon: Check },
] as const;

export function Onboarding({ state, run }: { state: AppState; run: Run }) {
   const [step, setStep] = useState(0);
   const [direction, setDirection] = useState(1);
   const [transitioning, setTransitioning] = useState(false);
   const navigationPending = useRef(false);
   const [failedThumbnails, setFailedThumbnails] = useState<ReadonlySet<string>>(() => new Set());
   const [draft, setDraft] = useState(() => ({ ...state.preferences, microphone: true, microphoneMuted: false }));
   const [sourcePhase, setSourcePhase] = useState<"loading" | "ready" | "error">("loading");
   const [sourceRequest, setSourceRequest] = useState(0);
   const [sources, setSources] = useState<CaptureSource[]>([]);
   const [busy, setBusy] = useState(false);
   const [error, setError] = useState("");
   const [micPending, setMicPending] = useState(false);
   const [micMessage, setMicMessage] = useState("");
   const [audioDevices, setAudioDevices] = useState<{ id: string; name: string }[]>([]);
   const [capabilities, setCapabilities] = useState<RecordingCapabilities | null>(null);
   const [capabilityError, setCapabilityError] = useState("");
   const root = useRef<HTMLDivElement>(null);
   const heading = useRef<HTMLHeadingElement>(null);
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
            if (result.supported) setDraft((current) => (current.quality === "custom" ? current : applyRecordingPreset(current, result.recommended)));
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
      setSourcePhase("loading");
      void api
         .sources()
         .then((choices) => {
            if (disposed) return;
            setSources(choices);
            setSourcePhase("ready");
            setDraft((current) => (current.sourceId ? current : { ...current, sourceId: choices.find((item) => item.kind === current.sourceKind)?.id ?? "" }));
            // Source choices are usable before their optional thumbnail images.
            void api
               .sources({ thumbnails: true })
               .then((images) => {
                  if (!disposed) setSources(images);
               })
               .catch(() => undefined);
         })
         .catch((failure: unknown) => {
            if (!disposed) {
               setSourcePhase("error");
               setError(describeError(failure));
            }
         });
      return () => {
         disposed = true;
      };
   }, [sourceRequest]);
   useEffect(
      () =>
         api.onEvent((event) => {
            if (event.type === "capture-sources") setSources(event.sources);
         }),
      []
   );
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
   const switchSource = (kind: SourceKind) =>
      setDraft((current) => ({
         ...current,
         sourceKind: kind,
         desktopFallback: kind === "auto" ? false : current.desktopFallback,
         sourceId: kind === "auto" ? current.sourceId : (sources.find((item) => item.kind === kind)?.id ?? ""),
      }));
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
   const source = sources.find((item) => item.kind === draft.sourceKind && item.id === draft.sourceId);
   const sourceReady =
      draft.sourceKind === "auto"
         ? (!draft.desktopFallback || sources.some((item) => item.kind === "screen" && item.id === draft.sourceId)) &&
           !sourceChoices(sources, capabilities).find((item) => item.value === "auto")?.disabled
         : !!source;
   const lengthValid = Number.isInteger(draft.clipSeconds) && draft.clipSeconds >= 5 && draft.clipSeconds <= 1800;
   const finish = async (skip = false) => {
      const record = !skip && draft.autoRecord;
      if (busy || navigationPending.current || micPending || !lengthValid || !draft.collection || (record && (!sourceReady || !capabilities?.supported)))
         return;
      setBusy(true);
      const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      await root.current?.animate([{ opacity: 1 }, { opacity: 0, transform: "translateY(-8px)" }], {
         duration: reduced ? 0 : 200,
         fill: "forwards",
         easing: "ease-in",
      }).finished;
      const saved = await run(() => api.savePreferences({ ...draft, setupComplete: true }));
      if (saved && record) await run(() => api.startRecording());
      if (!saved) root.current?.getAnimations().forEach((animation) => animation.cancel());
      setBusy(false);
   };
   const portal = sources.some((item) => item.id === portalScreenId);
   const choices = sources.filter((item) => item.kind === draft.sourceKind);
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
            <div className="setup-page" key={step} inert={transitioning || busy} data-ready={step === steps.length - 1 || undefined}>
               <h1 id="setup-heading" ref={heading} tabIndex={-1}>
                  {step === 0 ? "What do you want to capture?" : step === 1 ? "Save a moment" : "You're good to go"}
               </h1>
               <fieldset className="setup-fields" disabled={busy}>
                  {step === 0 ? (
                     <>
                        <div className="setup-capture">
                           <Segmented
                              label="Setup capture source"
                              value={draft.sourceKind}
                              values={sourceChoices(sources, capabilities)}
                              onChange={switchSource}
                           />
                           <div className="setup-source" key={draft.sourceKind}>
                              {draft.sourceKind === "auto" ? (
                                 <p className="setup-auto">
                                    {draft.desktopFallback
                                       ? "Follows your game. Uses your screen when no game is open."
                                       : "Follows your game. Waits when no game is open."}
                                 </p>
                              ) : (
                                 <>
                                    {sourcePhase === "ready" && choices.length > 0 && (
                                       <div className="setup-source-grid" role="group" aria-label="Capture sources">
                                          {choices.map((item) => (
                                             <button
                                                key={item.id}
                                                className="setup-source-tile"
                                                aria-pressed={item.id === draft.sourceId}
                                                onClick={() => change("sourceId", item.id)}
                                             >
                                                <span className="setup-source-preview">
                                                   {item.thumbnail && !failedThumbnails.has(item.id) ? (
                                                      <img
                                                         src={item.thumbnail}
                                                         alt=""
                                                         onError={() => setFailedThumbnails((current) => new Set([...current, item.id]))}
                                                      />
                                                   ) : (
                                                      <Monitor size={28} strokeWidth={1.3} />
                                                   )}
                                                </span>
                                                <span className="setup-source-name">
                                                   <span>{item.name}</span>
                                                   <Check size={14} />
                                                </span>
                                             </button>
                                          ))}
                                       </div>
                                    )}
                                    {sourcePhase === "loading" && <p role="status">Finding capture sources...</p>}
                                    {sourcePhase === "ready" && !choices.length && (
                                       <div className="setup-source-empty">
                                          <p>
                                             {draft.sourceKind === "app" ? "Open an app to select it here." : "No screens found. Check capture permissions."}
                                          </p>
                                          <Button className="quiet" onClick={() => setSourceRequest((value) => value + 1)}>
                                             Refresh sources
                                          </Button>
                                       </div>
                                    )}
                                    {sourcePhase === "error" && (
                                       <div className="setup-source-empty">
                                          <p role="alert">{error}</p>
                                          <Button className="quiet" onClick={() => setSourceRequest((value) => value + 1)}>
                                             Retry sources
                                          </Button>
                                       </div>
                                    )}
                                 </>
                              )}
                              {portal && draft.sourceKind === "screen" && <p className="setup-note">The system picker opens when recording starts.</p>}
                           </div>
                        </div>
                        <div className="setup-audio">
                           <span>Microphone</span>
                           <Select
                              label="Microphone input"
                              value={draft.microphone && !draft.microphoneMuted ? draft.microphoneDevice : "none"}
                              disabled={micPending}
                              onChange={(value) => void microphone(value)}
                           >
                              <option value="none">None</option>
                              <option value="default">Default</option>
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
                        </div>
                        {(micPending || micMessage) && (
                           <p className="setup-note" role="status">
                              {micPending ? "Waiting for microphone permission..." : micMessage}
                           </p>
                        )}
                     </>
                  ) : step === 1 ? (
                     <>
                        <p className="setup-description">Your shortcut saves recent footage while recording.</p>
                        <div className="setup-shortcut">
                           <ShortcutInput value={draft.shortcut} onChange={(value) => change("shortcut", value)} />
                        </div>
                        <div className="setup-row">
                           <label htmlFor="setup-length">Save the last</label>
                           <NumberInput
                              id="setup-length"

                              aria-label="Setup clip length in seconds"
                              min={5}
                              max={1800}
                              value={draft.clipSeconds}
                              onValueChange={(value) => change("clipSeconds", value)}
                              unit="seconds"
                           />
                        </div>
                        {!lengthValid && (
                           <p className="setup-validation" role="alert">
                              Choose 5 to 1800 whole seconds.
                           </p>
                        )}
                        <p className="setup-folder-label">Save clips to</p>
                        <FolderPicker path={draft.collection} onChoose={choose} />
                     </>
                  ) : (
                     <>
                        <div className="setup-ready-space" aria-hidden="true">
                           <span className="setup-ready-check">
                              <Check size={48} strokeWidth={1.8} />
                           </span>
                        </div>
                        <div className="setup-startup">
                           <Toggle label="Start with your computer" checked={draft.startWithOS} onChange={(value) => change("startWithOS", value)} />
                           <Toggle
                              label="Start recording when AcroClip opens"
                              checked={draft.autoRecord}
                              onChange={(value) => change("autoRecord", value)}
                              disabled={!draft.autoRecord && (!sourceReady || !capabilities?.supported)}
                           />
                        </div>
                     </>
                  )}
               </fieldset>
            </div>
            {(capabilityError || (capabilities && !capabilities.supported)) && (
               <p className="setup-note" role="status">
                  {capabilityError || capabilities?.message || "Recording is unavailable. You can set it up later."}
               </p>
            )}
            <footer className="onboarding-actions">
               {step === 0 ? (
                  <Button
                     className="quiet"
                     disabled={busy || transitioning || micPending || !lengthValid || !draft.collection}
                     onClick={() => void finish(true)}
                  >
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
                     disabled={transitioning || micPending || (step === 0 ? sourcePhase === "loading" : !lengthValid || !draft.collection)}
                     onClick={() => void navigate(step + 1)}
                  >
                     Continue
                     <ArrowRight size={15} />
                  </Button>
               ) : (
                  <Button
                     className="primary"
                     busy={busy}
                     disabled={
                        transitioning || micPending || !lengthValid || !draft.collection || (draft.autoRecord && (!sourceReady || !capabilities?.supported))
                     }
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
