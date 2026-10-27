import { useEffect, useRef, useState } from "react";
import { Clapperboard, Circle, CircleStop, Gamepad2, LoaderCircle, Monitor, RefreshCw } from "lucide-react";
import type { AppState, AudioLevels, CaptureSource, GameCandidate, Preferences, RecordingCapabilities, SourceKind } from "../../shared/types";
import { api, reportFeedback } from "./desktop";
import { Button, ContextHeader, Empty, Field, Segmented, Select } from "./ui";
import type { Run } from "./desktop";
import { PaneDivider, usePaneSize } from "./layout";
import { useSourcePreview } from "./useSourcePreview";
import { bindingFor, formatBinding } from "../../shared/shortcuts";
import { ApplicationIcon } from "./ApplicationIcon";
import { AudioListening } from "./AudioListening";
import { AdditionalAudio } from "./AdditionalAudio";
import { portalScreenId, sourceChoices, selectedCaptureSource } from "../../shared/capture-policy";

export function Recording({ state, visible, run, pulse, openGames }: { state: AppState; visible: boolean; run: Run; pulse: number; openGames: () => void }) {
   const layout = useRef<HTMLDivElement>(null);
   const controls = usePaneSize(layout, { key: "recording.controls", initial: 310, min: 260, max: 440, reserve: 420, axis: "x", fromEnd: true });
   const lower = usePaneSize(layout, { key: "recording.lower", initial: 250, min: 210, max: 380, reserve: 200, axis: "y", fromEnd: true });
   const [sourcePhase, setSourcePhase] = useState<"loading" | "ready" | "error">("loading");
   const [sourceRequest, setSourceRequest] = useState(0);
   const [sources, setSources] = useState<CaptureSource[]>([]);
   const knownSources = useRef<CaptureSource[]>([]);
   const [capabilities, setCapabilities] = useState<RecordingCapabilities | null>(null);
   const [games, setGames] = useState<GameCandidate[]>([]);
   const [gamesLoaded, setGamesLoaded] = useState(false);
   const [saving, setSaving] = useState(false);
   const [pulsing, setPulsing] = useState(false);
   const [nativeLevels, setNativeLevels] = useState<AudioLevels>({ capture: 0, microphone: 0 });
   const latestPreferences = useRef(state.preferences);
   latestPreferences.current = state.preferences;
   const writes = useRef(Promise.resolve());
   const pendingPreferences = useRef<Array<Partial<Preferences> | ((current: Preferences) => Partial<Preferences>)>>([]);
   const writingPreferences = useRef(false);
   const [monitorError, setMonitorError] = useState("");
   const [monitorSetupError, setMonitorSetupError] = useState("");
   const active = state.recorder.state === "recording" || state.recorder.state === "waiting";
   const findingGames = !active && state.recorder.supported && !gamesLoaded;
   useEffect(() => {
      if (!visible) {
         setNativeLevels({ capture: 0, microphone: 0 });
         return;
      }
      return api.onEvent((event) => {
         if (event.type === "capture-sources") {
            knownSources.current = event.sources;
            setSources(event.sources);
         }
         if (event.type === "audio-monitor") {
            setMonitorError(event.monitorError);
            if (event.monitorError) setNativeLevels({ capture: 0, microphone: 0 });
         }
         if (event.type === "audio-levels") {
            const levels = event.levels;
            setNativeLevels((previous) => {
               const additional = { ...previous.additional, ...levels.additional };
               if (
                  previous.capture === levels.capture &&
                  previous.microphone === levels.microphone &&
                  Object.entries(additional).every(([id, value]) => previous.additional?.[id] === value)
               )
                  return previous;
               return { ...levels, additional };
            });
         }
      });
   }, [visible, active]);
   const detectedGames = games.filter((game) => game.gameName);
   const detectedGame = active
      ? detectedGames.find((game) => game.id.split(":")[1] === state.recorder.sourceId?.split(":")[1])
      : (detectedGames.find((game) => game.foreground) ?? detectedGames[0]);
   const detectedSource = sources.find((item) => item.id.split(":")[1] === (detectedGame?.id ?? state.recorder.sourceId)?.split(":")[1]);
   const detectedName = active && state.recorder.sourceKind === "app" ? state.recorder.sourceName : detectedGame?.gameName;
   const source =
      state.preferences.sourceKind === "auto"
         ? active && (state.recorder.sourceKind === "app" || state.preferences.desktopFallback)
            ? sources.find(
                 (item) =>
                    item.id === state.recorder.sourceId || (item.id.startsWith("window:") && item.id.split(":")[1] === state.recorder.sourceId?.split(":")[1])
              )
            : undefined
         : selectedCaptureSource(sources, state.preferences);
   const captureAvailable = state.preferences.sourceKind === "auto" || !!source;
   const recordShortcut = bindingFor(state.preferences, active ? "stopRecording" : "startRecording") || bindingFor(state.preferences, "toggleRecording");
   const portal = sources.some((item) => item.id === portalScreenId);
   const previewUnavailable = capabilities?.captureBackend === "wayland-portal" || source?.id === portalScreenId;
   const nativeScreenPreview = state.platform === "win32" && source?.kind === "screen";
   const preview = useSourcePreview(
      previewUnavailable ? undefined : source?.id,
      visible && state.preferences.setupComplete,
      nativeScreenPreview,
      `${state.preferences.collection}\0${source?.processId ?? ""}`
   );
   useEffect(() => {
      if (!visible || state.preferences.sourceKind !== "auto" || !state.recorder.supported) return;
      let disposed = false;
      const update = async () => {
         try {
            const candidates = await api.games();
            if (!disposed) {
               setGames(candidates);
               setGamesLoaded(true);
            }
         } catch {
            /* The recorder reports connection failures separately. */
         }
      };
      void update();
      const timer = window.setInterval(() => void update(), 1000);
      return () => {
         disposed = true;
         window.clearInterval(timer);
      };
   }, [visible, state.preferences.sourceKind, state.preferences.customGames, state.recorder.supported]);
   useEffect(() => {
      if (!visible) return;
      let gone = false;
      void api
         .recordingCapabilities()
         .then((result) => {
            if (!gone) setCapabilities(result);
         })
         .catch(() => undefined);
      return () => {
         gone = true;
      };
   }, [visible, sourceRequest]);
   useEffect(() => {
      if (!visible) return;
      let gone = false;
      let fetching = false;
      const fetch = async () => {
         if (fetching) return;
         fetching = true;
         if (!knownSources.current.length) setSourcePhase("loading");
         try {
            const result = await api.sources();
            if (!gone) {
               knownSources.current = result;
               setSources(result);
               setSourcePhase("ready");
            }
         } catch {
            if (!gone) setSourcePhase("error");
            /* Keep the last successful list while source refresh retries. */
         } finally {
            fetching = false;
         }
      };
      void fetch();
      const focus = () => void fetch();
      window.addEventListener("focus", focus);
      const timer = window.setInterval(() => {
         if (!document.hidden) void fetch();
      }, 2000);
      return () => {
         gone = true;
         window.removeEventListener("focus", focus);
         window.clearInterval(timer);
      };
   }, [visible, sourceRequest]);
   useEffect(() => {
      if (!pulse) return;
      setPulsing(true);
      const timer = window.setTimeout(() => setPulsing(false), 550);
      return () => window.clearTimeout(timer);
   }, [pulse]);
   useEffect(() => {
      if (!visible) return;
      return () => {
         void api.monitorAudio(false).catch(() => undefined);
      };
   }, [visible]);
   const monitorConfiguration = JSON.stringify([
      state.preferences.captureAudio,
      state.preferences.sourceKind,
      state.preferences.sourceId,
      state.preferences.desktopFallback,
      state.preferences.captureVolume,
      state.preferences.captureMuted,
      state.preferences.microphone,
      state.preferences.microphoneDevice,
      state.preferences.microphoneVolume,
      state.preferences.microphoneMuted,
      state.preferences.audioSources,
   ]);
   useEffect(() => {
      if (!visible || active || state.recorder.state === "starting") return;
      let disposed = false;
      setMonitorSetupError("");
      void api
         .monitorAudio(true)
         .then(() => {
            if (!disposed) setMonitorSetupError("");
         })
         .catch((error: unknown) => {
            if (!disposed)
               setMonitorSetupError(
                  error instanceof Error ? error.message.replace(/^Error invoking remote method '[^']+': /, "") : "Audio monitoring unavailable"
               );
         });
      return () => {
         disposed = true;
      };
   }, [visible, active, state.recorder.state, monitorConfiguration, captureAvailable, sourcePhase]);
   useEffect(() => {
      const message = visible && !active && state.recorder.state !== "starting" ? monitorSetupError || monitorError : "";
      // Source creation and device changes settle asynchronously. Clear recovered
      // errors immediately, and only show a failure that survives the transition.
      if (!message) {
         reportFeedback({ kind: "audio-status", message: "" });
         return;
      }
      const timer = window.setTimeout(() => reportFeedback({ kind: "audio-status", message }), 1200);
      return () => window.clearTimeout(timer);
   }, [visible, active, state.recorder.state, monitorError, monitorSetupError]);
   const preferences = (patch: Partial<Preferences> | ((current: Preferences) => Partial<Preferences>)) => {
      pendingPreferences.current.push(patch);
      if (!writingPreferences.current) {
         writingPreferences.current = true;
         writes.current = (async () => {
            try {
               while (pendingPreferences.current.length) {
                  const patches = pendingPreferences.current.splice(0);
                  await run(async () => {
                     let value = latestPreferences.current;
                     for (const patch of patches) value = { ...value, ...(typeof patch === "function" ? patch(value) : patch) };
                     const next = await api.savePreferences(value);
                     latestPreferences.current = next.preferences;
                  });
               }
            } finally {
               writingPreferences.current = false;
            }
         })();
      }
      return writes.current;
   };
   const switchKind = (kind: SourceKind) => {
      const first = sources.find((item) => item.kind === (kind === "auto" ? "screen" : kind));
      preferences({ sourceKind: kind, sourceId: first?.id ?? "" });
   };
   const save = async () => {
      setSaving(true);
      setPulsing(true);
      await run(() => api.saveClip());
      setSaving(false);
      window.setTimeout(() => setPulsing(false), 550);
   };
   return (
      <div className="recording-page">
         <div
            className="recording-layout"
            ref={layout}
            style={{ gridTemplateColumns: `minmax(0, 1fr) 12px ${controls.size}px`, gridTemplateRows: `minmax(0, 1fr) 12px ${lower.size}px` }}
         >
            <div className="recording-main">
               <div className="preview-surface">
                  {source && previewUnavailable ? (
                     <Empty
                        icon={<Monitor size={38} />}
                        title={source.kind === "screen" ? "Screen capture" : source.name}
                        detail={
                           source.kind === "screen"
                              ? "Choose a screen in the system picker when you start recording. Live preview is unavailable in this session."
                              : "This application records directly. Live preview is unavailable in this Wayland session."
                        }
                     />
                  ) : source ? (
                     <>
                        <video
                           ref={preview.video}
                           muted
                           autoPlay
                           playsInline
                           aria-label={`Live preview of ${source.name}`}
                           className={`source-preview preview-stream ${nativeScreenPreview ? "preview-decoder" : ""} ${preview.status === "live" ? "ready" : ""}`}
                        />
                        <canvas
                           ref={preview.canvas}
                           className={`preview-canvas ${nativeScreenPreview && preview.status === "live" ? "ready" : ""} ${preview.cached && preview.status !== "live" ? "cached" : ""}`}
                           aria-label={`${preview.cached ? "Last frame" : "Live preview"} of ${source.name}`}
                        />
                        {preview.status !== "live" && (
                           <div className={`preview-message ${preview.cached ? "preview-cached-message" : ""}`}>
                              {preview.cached ? (
                                 <p>{preview.status === "error" ? "Preview unavailable. Last frame shown." : "Reconnecting preview. Last frame shown."}</p>
                              ) : preview.status === "error" ? (
                                 <>
                                    <Monitor size={30} />
                                    <h3>Preview unavailable</h3>
                                    <p>{preview.error}</p>
                                    <Button onClick={preview.retry}>
                                       <RefreshCw size={14} />
                                       Retry preview
                                    </Button>
                                 </>
                              ) : (
                                 <>
                                    <Monitor size={30} />
                                    <p>Opening preview…</p>
                                 </>
                              )}
                           </div>
                        )}
                     </>
                  ) : (state.preferences.sourceKind !== "auto" && sourcePhase === "loading") || (state.preferences.sourceKind === "auto" && findingGames) ? (
                     <div className="preview-message" role="status">
                        <LoaderCircle size={30} className="spin" />
                        <p>{state.preferences.sourceKind === "auto" ? "Finding games" : "Finding capture sources"}</p>
                     </div>
                  ) : (
                     <Empty
                        icon={<Monitor size={38} />}
                        title={state.preferences.sourceKind === "auto" ? (active ? "Waiting for game" : "Auto capture") : "Choose what to capture"}
                        detail={
                           state.preferences.sourceKind === "auto"
                              ? detectedGame
                                 ? "Start recording to capture detected games."
                                 : "Open a game, or add an application to your games."
                              : "Select a screen or application from the list."
                        }
                     />
                  )}
                  {source && (
                     <div className="preview-caption">
                        <span className={preview.status === "live" ? "preview-dot live" : "preview-dot"} />
                        {source.name}
                        <span className="preview-note">{preview.status === "live" ? "Live preview" : "Preview"}</span>
                     </div>
                  )}
               </div>
               <div className="recording-bottom">
                  <div className="mixer">
                     <div className="mixer-scroll">
                        <AudioListening
                           active={active || state.recorder.state === "starting"}
                           visible={visible}
                           preferences={state.preferences}
                           platform={state.platform}
                        >
                           <AdditionalAudio
                              captureAvailable={captureAvailable}
                              preferences={state.preferences}
                              active={active || state.recorder.state === "starting"}
                              visible={visible}
                              levels={{
                                 ...nativeLevels.additional,
                                 ...Object.fromEntries(
                                    state.preferences.audioSources
                                       .filter((source) => source.kind === "source")
                                       .map((source) => [source.id, nativeLevels.capture])
                                 ),
                              }}
                              save={preferences}
                           />
                        </AudioListening>
                     </div>
                  </div>
                  <div className="capture-actions">
                     <button
                        className={`record-action ${active ? "is-recording" : ""}`}
                        aria-label={active ? "Stop recording" : state.recorder.state === "starting" ? "Starting recording" : "Start recording"}
                        aria-busy={state.recorder.state === "starting"}
                        title={active ? "Stop recording. Unsaved history will clear." : undefined}
                        aria-description={active ? "Stopping clears unsaved history." : undefined}
                        disabled={state.recorder.state === "starting" || !state.recorder.supported || (!active && !captureAvailable)}
                        onClick={() => void run(active ? () => api.stopRecording() : () => api.startRecording())}
                     >
                        {active ? (
                           <CircleStop size={50} strokeWidth={1.7} />
                        ) : state.recorder.state === "starting" ? (
                           <LoaderCircle className="spin" size={32} />
                        ) : (
                           <Circle size={50} strokeWidth={1.7} />
                        )}
                        <span>{active ? "Stop recording" : state.recorder.state === "starting" ? "Starting…" : "Start recording"}</span>
                        {recordShortcut && <kbd>{formatBinding(recordShortcut, state.platform === "darwin")}</kbd>}
                     </button>
                     <button
                        className={`clip-action ${pulsing ? "shortcut-pulse" : ""}`}
                        aria-label={saving ? "Saving clip" : "Save clip"}
                        aria-busy={saving}
                        disabled={!active || state.recorder.availableSeconds < 1 || saving}
                        onClick={() => void save()}
                     >
                        {saving ? <LoaderCircle className="spin" size={30} /> : <Clapperboard size={48} strokeWidth={1.65} />}
                        <span>{saving ? "Saving…" : "Save clip"}</span>
                        <kbd>{formatBinding(state.preferences.shortcut, state.platform === "darwin")}</kbd>
                     </button>
                  </div>
               </div>
            </div>
            <aside className="source-panel">
               <Segmented label="Source type" value={state.preferences.sourceKind} values={sourceChoices(sources, capabilities)} onChange={switchKind} />
               {portal && (
                  <p className="source-empty">
                     {capabilities?.applicationBackend === "xwayland"
                        ? "App and Auto support XWayland applications. Native Wayland apps are unavailable."
                        : "Application and Auto capture are unavailable in this Wayland session."}
                  </p>
               )}
               {state.preferences.sourceKind === "auto" ? (
                  <div className="auto-source">
                     <ContextHeader
                        className="detected-game"
                        status
                        label={
                           detectedName
                              ? active
                                 ? state.recorder.state === "recording"
                                    ? "Recording game"
                                    : "Capture paused"
                                 : "Detected game"
                              : "Auto capture"
                        }
                        title={detectedName || (findingGames ? "Finding games" : "No game detected")}
                        icon={
                           detectedName ? (
                              <ApplicationIcon size={20} src={detectedSource?.appIcon} />
                           ) : findingGames ? (
                              <LoaderCircle size={20} className="spin" />
                           ) : (
                              <Gamepad2 size={20} />
                           )
                        }
                     />
                     <div className="auto-game-help">
                        <span>Not seeing your game?</span>
                        <button aria-label="Add game" onClick={openGames}>
                           Add it
                        </button>
                     </div>
                     <div className="auto-fallback" title="Record this screen when no game is detected. Off keeps Auto waiting.">
                        <Field label="Screen fallback" stacked>
                           <Select
                              label="Screen fallback"
                              value={state.preferences.desktopFallback ? state.preferences.sourceId : ""}
                              onChange={(id) => preferences(id ? { desktopFallback: true, sourceId: id } : { desktopFallback: false })}
                           >
                              <option value="">Off</option>
                              {state.preferences.desktopFallback &&
                                 !sources.some((item) => item.kind === "screen" && item.id === state.preferences.sourceId) && (
                                    <option value={state.preferences.sourceId} disabled>
                                       Screen unavailable
                                    </option>
                                 )}
                              {sources
                                 .filter((item) => item.kind === "screen")
                                 .map((item) => (
                                    <option key={item.id} value={item.id}>
                                       {item.name}
                                    </option>
                                 ))}
                           </Select>
                        </Field>
                     </div>
                  </div>
               ) : (
                  <div className="source-list" aria-busy={sourcePhase === "loading"}>
                     {sources
                        .filter((item) => item.kind === state.preferences.sourceKind)
                        .map((item) => (
                           <button
                              className={`source-row ${item.id === source?.id ? "selected" : ""}`}
                              aria-pressed={item.id === source?.id}
                              key={item.id}
                              onClick={() => preferences({ sourceId: item.id })}
                           >
                              {item.kind === "screen" ? <Monitor size={18} /> : <ApplicationIcon size={18} src={item.appIcon} />}
                              <span>{item.name}</span>
                              {item.id === source?.id && <span className="source-selected" />}
                           </button>
                        ))}
                     {sourcePhase === "loading" && !sources.length && (
                        <div className="source-loading" role="status" aria-label="Finding capture sources">
                           {[0, 1].map((row) => (
                              <div key={row} className="source-row source-skeleton" aria-hidden="true">
                                 <span className="source-skeleton-icon" />
                                 <span className="source-skeleton-name" />
                              </div>
                           ))}
                        </div>
                     )}
                     {sourcePhase === "error" && (
                        <Button className="source-retry" onClick={() => setSourceRequest((value) => value + 1)}>
                           Retry sources
                        </Button>
                     )}
                     {sourcePhase === "ready" && sources.filter((item) => item.kind === state.preferences.sourceKind).length === 0 && (
                        <p className="source-empty">
                           {state.preferences.sourceKind === "app" ? "Open an application to capture." : "No screens available. Check capture permissions."}
                        </p>
                     )}
                  </div>
               )}
            </aside>
            <PaneDivider label="Recording controls width" pane={controls} className="recording-width-divider" />
            <PaneDivider label="Recording lower panels height" pane={lower} className="recording-height-divider" />
         </div>
      </div>
   );
}
