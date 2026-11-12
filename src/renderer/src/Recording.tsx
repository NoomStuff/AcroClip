import { useEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties } from "react";
import { useApplicationColors } from "./useApplicationColors";
import { Clapperboard, Circle, CircleStop, Gamepad2, LoaderCircle, Monitor, RefreshCw } from "lucide-react";
import type { AppState, CaptureSource, GameCandidate, Preferences, RecordingCapabilities, SourceKind } from "../../shared/types";
import { api, describeError, reportFeedback } from "./desktop";
import { Button, ContextHeader, Empty, Field, Segmented, Select } from "./ui";
import type { Run } from "./desktop";
import { PaneDivider, usePaneSize } from "./layout";
import { useSourcePreview } from "./useSourcePreview";
import { bindingFor, formatBinding } from "../../shared/shortcuts";
import { SelectionIndicator } from "./SelectionIndicator";
import { MotionList } from "./MotionList";
import { useDirectionalContent } from "./useDirectionalContent";
import { ApplicationIcon } from "./ApplicationIcon";
import { AudioListening } from "./AudioListening";
import { AdditionalAudio } from "./AdditionalAudio";
import { portalScreenId, sourceChoices, previewCaptureSource } from "../../shared/capture-policy";
import { autoCapturePresentation } from "./auto-capture-presentation";

export function Recording({
   state,
   visible,
   run,
   pulse,
   openGames,
}: {
   state: Pick<AppState, "preferences" | "recorder" | "platform">;
   visible: boolean;
   run: Run;
   pulse: number;
   openGames: () => void;
}) {
   const layout = useRef<HTMLDivElement>(null);
   const sourceContent = useRef<HTMLDivElement>(null);
   const sourceIndex = ["screen", "app", "auto"].indexOf(state.preferences.sourceKind);
   useDirectionalContent(sourceContent, state.preferences.sourceKind, sourceIndex, visible);
   const controls = usePaneSize(layout, { key: "recording.controls", initial: 340, min: 260, max: 460, reserve: 420, axis: "x", fromEnd: true });
   const lower = usePaneSize(layout, { key: "recording.lower", initial: 250, min: 170, max: 380, reserve: 200, axis: "y", fromEnd: true });
   const [sourcePhase, setSourcePhase] = useState<"loading" | "ready" | "error">("loading");
   const [sourceRequest, setSourceRequest] = useState(0);
   const [sources, setSources] = useState<CaptureSource[]>([]);
   const knownSources = useRef<CaptureSource[]>([]);
   const [capabilities, setCapabilities] = useState<RecordingCapabilities | null>(null);
   const gameScope = JSON.stringify([state.preferences.sourceKind, visible, state.preferences.customGames]);
   const [gameScan, setGameScan] = useState<{ scope: string; games: GameCandidate[]; loaded: boolean }>({ scope: gameScope, games: [], loaded: false });
   if (gameScan.scope !== gameScope) setGameScan({ scope: gameScope, games: [], loaded: false });
   const games = gameScan.scope === gameScope ? gameScan.games : [];
   const gamesLoaded = gameScan.scope === gameScope && gameScan.loaded;
   const [saving, setSaving] = useState(false);
   const [pulsing, setPulsing] = useState(false);
   const latestPreferences = useRef(state.preferences);
   latestPreferences.current = state.preferences;
   const writes = useRef(Promise.resolve());
   const pendingPreferences = useRef<Array<Partial<Preferences> | ((current: Preferences) => Partial<Preferences>)>>([]);
   const writingPreferences = useRef(false);
   const [monitorError, setMonitorError] = useState("");
   const [monitorSetupError, setMonitorSetupError] = useState("");
   const active = state.recorder.state === "recording" || state.recorder.state === "waiting";
   const auto = autoCapturePresentation(games, state.recorder, gamesLoaded);
   const findingGames = auto.finding;
   useEffect(() => {
      if (!visible) return;
      return api.onEvent((event) => {
         if (event.type === "capture-sources") {
            knownSources.current = event.sources;
            setSources(event.sources);
         }
         if (event.type === "audio-monitor") {
            setMonitorError(event.monitorError);
         }
      });
   }, [visible, active]);
   const detectedGame = auto.game;
   const detectedSource = detectedGame ? sources.find((item) => item.id.split(":")[1] === detectedGame.id.split(":")[1]) : undefined;
   const detectedName = auto.name;
   const captureAudioKind =
      state.preferences.sourceKind === "auto"
         ? active
            ? (state.recorder.bufferedSourceKind ?? state.recorder.sourceKind)
            : detectedGame
              ? "app"
              : state.preferences.desktopFallback
                ? "screen"
                : "waiting"
         : state.preferences.sourceKind;
   const source =
      state.preferences.sourceKind === "auto" && (findingGames || (state.recorder.sourceKind === "app" && !auto.previewApplication))
         ? undefined
         : previewCaptureSource(sources, state.preferences, state.recorder);
   const sourceIcons = useMemo(
      () => Object.fromEntries(sources.filter((item) => item.applicationId && item.appIcon).map((item) => [item.applicationId!, item.appIcon!])),
      [sources]
   );
   const sourceColors = useApplicationColors(sourceIcons, visible);
   const sourceColor = sourceColors[source?.applicationId ?? ""];
   const selectableSources = useMemo(() => sources.filter((item) => item.kind === state.preferences.sourceKind), [sources, state.preferences.sourceKind]);
   const captureAvailable = state.preferences.sourceKind === "auto" || !!source;
   const recordShortcut = bindingFor(state.preferences, active ? "stopRecording" : "startRecording") || bindingFor(state.preferences, "toggleRecording");
   const portal = sources.some((item) => item.id === portalScreenId);
   const previewUnavailable = capabilities?.captureBackend === "wayland-portal" || source?.id === portalScreenId;
   const nativeScreenPreview = state.platform === "win32" && source?.kind === "screen";
   const preview = useSourcePreview(
      previewUnavailable ? undefined : source?.id,
      visible && state.preferences.setupComplete,
      nativeScreenPreview,
      state.preferences.collection,
      String(source?.processId ?? "")
   );
   useEffect(() => {
      if (!visible || state.preferences.sourceKind !== "auto" || !state.recorder.supported) return;
      let disposed = false;
      const update = async () => {
         try {
            const candidates = await api.games();
            if (!disposed) {
               // The same answer keeps the same list, so a quiet poll renders nothing.
               setGameScan((current) =>
                  current.scope !== gameScope || (current.loaded && JSON.stringify(current.games) === JSON.stringify(candidates))
                     ? current
                     : { scope: gameScope, games: candidates, loaded: true }
               );
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
   }, [visible, state.preferences.sourceKind, state.preferences.customGames, state.recorder.supported, gameScope]);
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
               setSources((current) => (JSON.stringify(current) === JSON.stringify(result) ? current : result));
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
      if (!visible || active || state.recorder.state === "starting" || (sourcePhase !== "ready" && !knownSources.current.length)) return;
      let disposed = false;
      let timer: number | undefined;
      setMonitorSetupError("");
      setMonitorError("");
      const configure = async (attempt: number) => {
         try {
            await api.monitorAudio(true);
            if (!disposed) setMonitorSetupError("");
         } catch (error) {
            if (disposed) return;
            if (attempt < 2) timer = window.setTimeout(() => void configure(attempt + 1), attempt === 0 ? 500 : 1500);
            else setMonitorSetupError(describeError(error));
         }
      };
      void configure(0);
      return () => {
         disposed = true;
         window.clearTimeout(timer);
      };
   }, [visible, active, state.recorder.state, monitorConfiguration, captureAvailable, sourcePhase]);
   useEffect(() => {
      const message = visible && !active && state.recorder.state !== "starting" ? monitorSetupError || monitorError : "";
      reportFeedback({ kind: "audio-status", message });
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
      await run(() => api.saveClip(), { feedback: "external" });
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
               <div className="preview-surface" data-preview={source ? preview.status : undefined}>
                  <canvas ref={preview.outgoing} className="preview-outgoing" aria-hidden="true" />
                  {source && previewUnavailable ? (
                     <Empty
                        icon={<Monitor size={38} />}
                        title={source.kind === "screen" ? "Screen capture" : source.name}
                        detail={
                           source.kind === "screen"
                              ? "Choose a screen in the system picker when you start capturing. Live preview is unavailable in this session."
                              : "This application is captured directly. Live preview is unavailable in this Wayland session."
                        }
                     />
                  ) : source ? (
                     <>
                        <canvas ref={preview.still} className={`preview-still ${preview.cached ? "cached" : ""}`} aria-hidden="true" />
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
                           className={`preview-canvas ${nativeScreenPreview && preview.status === "live" ? "ready" : ""}`}
                           aria-label={`Live preview of ${source.name}`}
                        />
                        {(preview.status === "connecting" || (preview.status === "live" && !preview.revealed)) && (
                           <div
                              key={`${source.id}:${source.processId ?? ""}`}
                              className={`preview-loading ${preview.status === "live" ? "complete" : ""}`}
                              role={preview.status === "connecting" ? "status" : undefined}
                              aria-label={preview.status === "connecting" ? "Loading preview" : undefined}
                              aria-hidden={preview.status === "live" || undefined}
                           >
                              {!preview.cached && source.thumbnail.length > 30 && <img className="preview-poster" src={source.thumbnail} alt="" />}
                              <div className="preview-placeholder">
                                 <ApplicationIcon src={source.appIcon} size={48} />
                              </div>
                           </div>
                        )}
                        {preview.status === "error" && (
                           <div className="preview-message">
                              <Monitor size={30} />
                              <h3>Preview unavailable</h3>
                              <p>{preview.error}</p>
                              <Button onClick={preview.retry}>
                                 <RefreshCw size={14} />
                                 Retry preview
                              </Button>
                           </div>
                        )}
                     </>
                  ) : (state.preferences.sourceKind !== "auto" && sourcePhase === "loading") || (state.preferences.sourceKind === "auto" && findingGames) ? (
                     <div className="preview-message preview-discovery" role="status">
                        <LoaderCircle size={30} className="preview-loading-spinner" />
                        <p>{state.preferences.sourceKind === "auto" ? "Finding games" : "Finding capture sources"}</p>
                     </div>
                  ) : (
                     <Empty
                        icon={<Monitor size={38} />}
                        title={state.preferences.sourceKind === "auto" ? (active ? "Waiting for game" : "Auto capture") : "Choose what to capture"}
                        detail={
                           state.preferences.sourceKind === "auto"
                              ? detectedGame
                                 ? "Start capturing to save detected games."
                                 : "Open a game, or add an application to your games."
                              : "Select a screen or application from the list."
                        }
                     />
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
                              captureKind={captureAudioKind}
                              captureAvailable={captureAvailable}
                              preferences={state.preferences}
                              active={active || state.recorder.state === "starting"}
                              visible={visible}
                              save={preferences}
                           />
                        </AudioListening>
                     </div>
                  </div>
                  <div className="capture-actions">
                     <button
                        className={`record-action ${active ? "is-recording" : ""}`}
                        aria-label={active ? "Stop capturing" : state.recorder.state === "starting" ? "Starting capture" : "Start capturing"}
                        aria-busy={state.recorder.state === "starting"}

                        aria-description={active ? "Stopping clears unsaved history." : undefined}
                        disabled={state.recorder.state === "starting" || !state.recorder.supported || (!active && !captureAvailable)}
                        onClick={() => void run(active ? () => api.stopRecording() : () => api.startRecording(), { feedback: "external" })}
                     >
                        {active ? (
                           <CircleStop size={50} strokeWidth={1.7} />
                        ) : state.recorder.state === "starting" ? (
                           <LoaderCircle className="spin" size={32} />
                        ) : (
                           <Circle size={50} strokeWidth={1.7} />
                        )}
                        <span>{active ? "Stop capturing" : state.recorder.state === "starting" ? "Starting…" : "Start capturing"}</span>
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
               <div className="capture-source-content" ref={sourceContent}>
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
                           label={auto.label}
                           title={auto.title}
                           icon={
                              detectedName ? (
                                 <ApplicationIcon size={28} src={detectedSource?.appIcon} />
                              ) : findingGames ? (
                                 <LoaderCircle size={28} className="spin" />
                              ) : (
                                 <Gamepad2 size={28} />
                              )
                           }
                        />
                        <div className="auto-game-help">
                           <span>Not seeing your game?</span>
                           <button aria-label="Add game" onClick={openGames}>
                              Add it
                           </button>
                        </div>
                        <div className="auto-fallback">
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
                     <div
                        className="source-list moving-selection"
                        aria-busy={sourcePhase === "loading"}
                        style={
                           sourceColor
                              ? ({ "--accent": sourceColor, "--selection-background": `color-mix(in srgb, ${sourceColor} 14%, transparent)` } as CSSProperties)
                              : undefined
                        }
                     >
                        <SelectionIndicator value={source?.id ?? ""} />
                        <MotionList items={selectableSources} identity={state.preferences.sourceKind}>
                           {(item) => (
                              <button
                                 data-list-control=""
                                 className={`source-row ${item.id === source?.id ? "selected" : ""}`}
                                 aria-pressed={item.id === source?.id}
                                 key={item.id}
                                 onClick={() => preferences({ sourceId: item.id })}
                              >
                                 {item.kind === "screen" ? <Monitor size={18} /> : <ApplicationIcon size={18} src={item.appIcon} />}
                                 <span>{item.name}</span>
                              </button>
                           )}
                        </MotionList>
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
               </div>
            </aside>
            <PaneDivider label="Capture controls width" pane={controls} className="recording-width-divider" />
            <PaneDivider label="Capture lower panels height" pane={lower} className="recording-height-divider" />
         </div>
      </div>
   );
}
