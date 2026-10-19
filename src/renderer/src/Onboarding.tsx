import { useEffect, useRef, useState } from "react";
import { ArrowLeft, ArrowRight, Check, Clapperboard, Folder, LoaderCircle, Mic, Monitor, Share2, Video } from "lucide-react";
import type { AppState, CaptureSource, Preferences, RecordingCapabilities } from "../../shared/types";
import { api, Button, Field, Segmented, Select, Toggle, reportFeedback, describeError } from "./ui";
import type { Run } from "./ui";
import { ShortcutInput } from "./Settings";
import { RecordingPresets, customQualityError } from "./RecordingPresets";
import { applyRecordingPreset } from "../../shared/recording-presets";
import { portalScreenId, sourceChoices } from "../../shared/capture-policy";

const steps = [
   { name: "Capture", icon: Monitor },
   { name: "Audio", icon: Mic },
   { name: "Clipping", icon: Clapperboard },
   { name: "Recording presets", icon: Video },
   { name: "Shareables", icon: Share2 },
   { name: "Startup", icon: Check },
];
export function Onboarding({ state, run }: { state: AppState; run: Run }) {
   const [step, setStep] = useState(0);
   const [draft, setDraft] = useState(state.preferences);
   const [sourcePhase, setSourcePhase] = useState<"loading" | "ready" | "error">("loading");
   const [sourceRequest, setSourceRequest] = useState(0);
   const [sources, setSources] = useState<CaptureSource[]>([]);
   const [failedThumbnails, setFailedThumbnails] = useState<ReadonlySet<string>>(() => new Set());
   const [busy, setBusy] = useState(false);
   const [micPermission, setMicPermission] = useState("");
   const [audioDevices, setAudioDevices] = useState<{ id: string; name: string }[]>([]);
   const [capabilities, setCapabilities] = useState<RecordingCapabilities | null>(null);
   const qualityChosen = useRef(false);
   const body = useRef<HTMLDivElement>(null);
   useEffect(() => {
      body.current?.scrollTo({ top: 0 });
      body.current?.querySelector<HTMLHeadingElement>("h2")?.focus({ preventScroll: true });
   }, [step]);
   useEffect(() => {
      if (capabilities) return;
      let disposed = false;
      void api
         .recordingCapabilities()
         .then((result) => {
            if (disposed) return;
            setCapabilities(result);
            if (!qualityChosen.current && result.supported) setDraft((current) => applyRecordingPreset(current, result.recommended));
         })
         .catch((failure: unknown) => {
            if (!disposed)
               setCapabilities({
                  supported: false,
                  hardwareEncoders: [],
                  recommended: "standard",
                  message: failure instanceof Error ? failure.message : "The recorder could not initialize.",
               });
         });
      return () => {
         disposed = true;
      };
   }, [step, capabilities]);
   useEffect(() => {
      if (step === 1 && draft.microphone) void run(async () => setAudioDevices(await api.audioDevices()));
   }, [step, draft.microphone, run]);
   const source = sources.find((item) => item.id === draft.sourceId);
   const portal = sources.some((item) => item.id === portalScreenId);
   useEffect(() => {
      let disposed = false;
      setSourcePhase("loading");
      void api
         .sources()
         .then((choices) => {
            if (disposed) return;
            setSources(choices);
            setSourcePhase("ready");
            setDraft((current) => (current.sourceId ? current : { ...current, sourceId: choices.find((item) => item.kind === "screen")?.id ?? "" }));
         })
         .catch((error: unknown) => {
            if (disposed) return;
            setSourcePhase("error");
            reportFeedback({ kind: "notice", error: true, message: describeError(error) });
         });
      return () => {
         disposed = true;
      };
   }, [sourceRequest]);
   const change = <K extends keyof Preferences>(key: K, value: Preferences[K]) => setDraft((current) => ({ ...current, [key]: value }));
   const microphone = async (enabled: boolean) => {
      change("microphone", enabled);
      if (!enabled) return;
      try {
         const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
         stream.getTracks().forEach((track) => track.stop());
         setMicPermission("Microphone permission granted.");
      } catch {
         setMicPermission("Microphone access is unavailable. You can allow it later in system settings.");
      }
   };
   const choose = () =>
      void run(async () => {
         const folder = await api.chooseFolder();
         if (folder) change("collection", folder);
      });
   const finish = async () => {
      setBusy(true);
      const next = { ...draft, setupComplete: true };
      if (await run(() => api.savePreferences(next))) {
         if (next.autoRecord) await run(() => api.startRecording());
      }
      setBusy(false);
   };
   return (
      <div className="onboarding-backdrop">
         <div className="onboarding">
            <div className="onboarding-main">
               <ol className="setup-progress" aria-label="Setup progress">
                  {steps.map(({ name, icon: StepIcon }, index) => (
                     <li
                        key={name}
                        className={step === index ? "current" : step > index ? "complete" : ""}
                        aria-current={step === index ? "step" : undefined}
                        aria-label={`Step ${index + 1} of ${steps.length}: ${name}, ${step === index ? "current" : step > index ? "complete" : "upcoming"}`}
                     >
                        <span aria-hidden="true">
                           <StepIcon size={16} />
                        </span>
                     </li>
                  ))}
               </ol>
               <div className="onboarding-body" ref={body}>
                  {step === 0 && (
                     <>
                        <h2 tabIndex={-1}>Capture</h2>
                        {portal && (
                           <p>
                              {capabilities?.applicationBackend === "xwayland"
                                 ? "Choose a screen through the system picker, or capture an XWayland app. Native Wayland apps are unavailable."
                                 : "Choose a screen when recording starts. App and Auto capture are unavailable in this Wayland session."}
                           </p>
                        )}
                        <Segmented
                           label="Setup capture source"
                           value={draft.sourceKind}
                           values={sourceChoices(sources, capabilities)}
                           onChange={(kind) => {
                              change("sourceKind", kind);
                              change("sourceId", sources.find((item) => item.kind === kind)?.id ?? draft.sourceId);
                           }}
                        />
                        {draft.sourceKind !== "auto" ? (
                           <div
                              className="setup-source-grid"
                              aria-busy={sourcePhase === "loading"}
                              role="group"
                              aria-label={draft.sourceKind === "screen" ? "Screens" : "Applications"}
                           >
                              {sources
                                 .filter((item) => item.kind === draft.sourceKind)
                                 .map((item) => (
                                    <button
                                       key={item.id}
                                       type="button"
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
                                             <span className="setup-source-placeholder">
                                                <Monitor size={22} aria-hidden="true" />
                                                <span>{item.id === portalScreenId ? "System picker" : "Preview unavailable"}</span>
                                             </span>
                                          )}
                                       </span>
                                       <span className="setup-source-label">
                                          <span title={item.name}>{item.name}</span>
                                          {item.id === draft.sourceId && <Check size={15} aria-hidden="true" />}
                                       </span>
                                    </button>
                                 ))}
                              {sourcePhase === "loading" && !sources.length && <div className="source-placeholder" aria-label="Finding capture sources" />}
                              {sourcePhase === "error" && (
                                 <Button className="setup-source-retry" onClick={() => setSourceRequest((value) => value + 1)}>
                                    Retry sources
                                 </Button>
                              )}
                              {sourcePhase === "ready" && sources.filter((item) => item.kind === draft.sourceKind).length === 0 && (
                                 <p className="setup-source-empty">No sources available. Check capture permissions, or choose a screen.</p>
                              )}
                           </div>
                        ) : (
                           <>
                              <p className="setup-auto-detail">Follow the active game. Recording waits when no game is found.</p>
                              <Toggle
                                 label="Screen fallback"
                                 detail="Record a screen when no game is found."
                                 checked={draft.desktopFallback}
                                 onChange={(value) => change("desktopFallback", value)}
                              />
                              {draft.desktopFallback && (
                                 <Select label="Fallback screen" value={draft.sourceId} onChange={(value) => change("sourceId", value)}>
                                    {sources
                                       .filter((item) => item.kind === "screen")
                                       .map((item) => (
                                          <option value={item.id} key={item.id}>
                                             {item.name}
                                          </option>
                                       ))}
                                 </Select>
                              )}
                           </>
                        )}
                     </>
                  )}
                  {step === 1 && (
                     <>
                        <h2 tabIndex={-1}>Audio</h2>
                        <Toggle
                           label="Capture audio"
                           detail="Desktop audio for a screen, application audio for an app."
                           checked={draft.captureAudio}
                           onChange={(value) => change("captureAudio", value)}
                        />
                        <Toggle label="Microphone" checked={draft.microphone} onChange={(value) => void microphone(value)} />
                        {draft.microphone && (
                           <Field label="Microphone">
                              <Select label="Setup microphone device" value={draft.microphoneDevice} onChange={(value) => change("microphoneDevice", value)}>
                                 <option value="default">Default</option>
                                 {audioDevices
                                    .filter((item) => item.id !== "default")
                                    .map((item) => (
                                       <option key={item.id} value={item.id}>
                                          {item.name}
                                       </option>
                                    ))}
                              </Select>
                           </Field>
                        )}
                        {micPermission && <p className="permission-note">{micPermission}</p>}
                     </>
                  )}
                  {step === 2 && (
                     <>
                        <h2 tabIndex={-1}>Clipping</h2>
                        <p>Your shortcut saves recent footage while recording.</p>
                        <Field label="Clip length">
                           <div className="number-unit">
                              <input
                                 type="number"
                                 aria-label="Setup clip length in seconds"
                                 value={draft.clipSeconds}
                                 min={5}
                                 max={1800}
                                 onChange={(event) => change("clipSeconds", Number(event.target.value))}
                              />
                              <span>seconds</span>
                           </div>
                        </Field>
                        <Field label="Clip shortcut">
                           <ShortcutInput value={draft.shortcut} onChange={(value) => change("shortcut", value)} />
                        </Field>
                        <Field label="Collection folder" detail="Supported videos in this folder also appear in Library.">
                           <Button onClick={choose}>
                              <Folder size={15} />
                              Choose folder
                           </Button>
                        </Field>
                        <div className="setup-folder" title={draft.collection}>
                           {draft.collection}
                        </div>
                     </>
                  )}
                  {step === 3 && (
                     <>
                        <h2 tabIndex={-1}>Recording presets</h2>
                        <RecordingPresets
                           value={draft}
                           sources={sources}
                           capabilities={capabilities}
                           onChange={(next) => {
                              qualityChosen.current = true;
                              setDraft(next);
                           }}
                        />
                        {customQualityError(draft) && <p className="permission-note">{customQualityError(draft)}</p>}
                        {capabilities?.message && <p className="permission-note">{capabilities.message}</p>}
                     </>
                  )}
                  {step === 4 && (
                     <>
                        <h2 tabIndex={-1}>Shareables</h2>
                        <p>Shareables are smaller copies. Originals stay unchanged.</p>
                        <Field label="Default maximum size">
                           <div className="number-unit">
                              <input
                                 aria-label="Setup maximum shareable size in MB"
                                 type="number"
                                 min={1}
                                 max={2000}
                                 value={draft.shareSizeMB}
                                 onChange={(event) => change("shareSizeMB", Number(event.target.value))}
                              />
                              <span>MB</span>
                           </div>
                        </Field>
                        <div className="size-presets">
                           {[10, 20, 50, 100].map((size) => (
                              <button key={size} className={draft.shareSizeMB === size ? "selected" : ""} onClick={() => change("shareSizeMB", size)}>
                                 {size} MB
                              </button>
                           ))}
                        </div>
                        <Toggle
                           label="Automatically create shareables"
                           detail="Creates a copy after each save and uses extra resources."
                           checked={draft.autoShare}
                           onChange={(value) => change("autoShare", value)}
                        />
                     </>
                  )}
                  {step === 5 && (
                     <>
                        <h2 tabIndex={-1}>Startup</h2>
                        <p>Closing the window keeps AcroClip running in the tray.</p>
                        <div className="setup-summary">
                           <span>
                              <Monitor size={17} />
                              {source?.name ?? (draft.sourceKind === "auto" ? "Auto game capture" : "Selected source")}
                           </span>
                           <span>
                              <Clapperboard size={17} />
                              {draft.clipSeconds} seconds · {draft.quality}
                           </span>
                           <span>
                              <Share2 size={17} />
                              {draft.shareSizeMB} MB shareables
                           </span>
                        </div>
                        <Toggle label="Start with your computer" checked={draft.startWithOS} onChange={(value) => change("startWithOS", value)} />
                        <Toggle
                           label="Start recording when AcroClip opens"
                           detail="Applies to manual launches too."
                           checked={draft.autoRecord}
                           onChange={(value) => change("autoRecord", value)}
                        />
                     </>
                  )}
               </div>
               <footer className="onboarding-actions">
                  {step > 0 ? (
                     <Button className="quiet" onClick={() => setStep(step - 1)} disabled={busy}>
                        <ArrowLeft size={16} />
                        Back
                     </Button>
                  ) : (
                     <span />
                  )}
                  {step === steps.length - 1 ? (
                     <Button className="primary" busy={busy} onClick={() => void finish()}>
                        {busy ? <LoaderCircle size={16} className="spin" /> : <Check size={16} />}
                        {draft.autoRecord ? "Start recording" : "Open AcroClip"}
                     </Button>
                  ) : (
                     <Button className="primary" disabled={step === 3 && Boolean(customQualityError(draft))} onClick={() => setStep(step + 1)}>
                        Continue
                        <ArrowRight size={16} />
                     </Button>
                  )}
               </footer>
            </div>
         </div>
      </div>
   );
}
