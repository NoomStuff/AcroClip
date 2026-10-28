import { memo, useCallback, useEffect, useMemo, useState } from "react";
import { AlertCircle, Check, Clapperboard, Film, Folder, Minus, Settings2, Square, Video, X } from "lucide-react";
import { AppLogo } from "./AppLogo";
import type { AppState, Clip, RecorderState } from "../../shared/types";
import { SelectionIndicator, TabMarker } from "./SelectionIndicator";
import { api, describeError } from "./desktop";
import { Dialog } from "./Dialog";
import { RecordingStatus } from "./RecordingStatus";
import { IconButton } from "./ui";
import type { DialogRequest } from "./Dialog";
import type { RendererFeedback, Run } from "./desktop";
import { shortcutRegistry, bindingFor, eventBinding, normalizeBinding } from "../../shared/shortcuts";
import { Recording } from "./Recording";
import { Library } from "./Library";
import { Viewer } from "./Viewer";
import { Settings } from "./Settings";
import type { SettingsTarget } from "./Settings";
import { UpdateChip } from "./UpdateChip";
import { Onboarding } from "./Onboarding";

type Page = "recording" | "library" | "viewer" | "settings";
const LibraryPage = memo(Library);
const RecordingPage = memo(Recording);
const ViewerPage = memo(Viewer);
const SettingsPage = memo(Settings);
const pageOrder: readonly Page[] = ["recording", "library", "viewer", "settings"];
import type { Ask } from "./Dialog";
export function App() {
   const [state, setState] = useState<AppState | null>(null);
   const [{ page, direction, visited }, setNavigation] = useState<{ page: Page; direction: "up" | "down"; visited: Page[] }>({
      page: "recording",
      direction: "down",
      visited: ["recording"],
   });
   const setPage = useCallback((next: Page) => {
      setNavigation((current) =>
         current.page === next
            ? current
            : {
                 page: next,
                 direction: pageOrder.indexOf(next) < pageOrder.indexOf(current.page) ? "up" : "down",
                 visited: current.visited.includes(next) ? current.visited : [...current.visited, next],
              }
      );
   }, []);
   const [settingsTarget, setSettingsTarget] = useState<SettingsTarget | null>(null);
   const openSettings = useCallback(
      (section: SettingsTarget["section"]) => {
         setSettingsTarget((current) => ({ section, request: (current?.request ?? 0) + 1 }));
         setPage("settings");
      },
      [setPage]
   );
   const openGames = useCallback(() => openSettings("games"), [openSettings]);
   const openCollectionSettings = useCallback(() => openSettings("collection"), [openSettings]);
   const openLibrary = useCallback(() => setPage("library"), [setPage]);
   const [windowVisible, setWindowVisible] = useState(!document.hidden);
   useEffect(() => {
      const update = () => setWindowVisible(!document.hidden);
      document.addEventListener("visibilitychange", update);
      return () => document.removeEventListener("visibilitychange", update);
   }, []);
   const [selected, setSelected] = useState<string | null>(null);
   const [audioStatus, setAudioStatus] = useState("");
   const [notice, setNotice] = useState<{ message: string; error: boolean } | null>(null);
   const [dialog, setDialog] = useState<DialogRequest | null>(null);
   const [clipPulse, setClipPulse] = useState(0);
   const run: Run = useCallback(async (action) => {
      try {
         await action();
         return true;
      } catch (error) {
         setNotice({ message: describeError(error), error: true });
         return false;
      }
   }, []);
   const ask: Ask = useCallback((request) => new Promise((resolve) => setDialog({ ...request, resolve })), []);
   useEffect(() => {
      let receivedState = false;
      let recorder: RecorderState | undefined;
      let pendingPatch: Partial<AppState> = {};
      void run(async () => {
         const loaded = await api.state();
         if (receivedState) return;
         const current = { ...loaded, ...pendingPatch, ...(recorder ? { recorder } : {}) };
         setState(current);
         setWindowVisible(current.windowVisible);
      });
      const unsubscribe = api.onEvent((event) => {
         if (event.type === "state") {
            receivedState = true;
            setState(event.state);
            setWindowVisible(event.state.windowVisible);
         }
         if (event.type === "visibility") setWindowVisible(event.visible);
         if (event.type === "state-patch") {
            pendingPatch = { ...pendingPatch, ...event.patch };
            setState((current) => (current ? { ...current, ...event.patch } : current));
            if (event.patch.windowVisible !== undefined) setWindowVisible(event.patch.windowVisible);
         }
         if (event.type === "recorder") {
            recorder = event.recorder;
            setState((current) => (current ? { ...current, recorder: event.recorder } : current));
         }
         if (event.type === "clip-action") setClipPulse((value) => value + 1);
         if (event.type === "notice" && event.message) setNotice({ message: event.message, error: event.error });
      });
      const feedback = (event: Event) => {
         const value = (event as CustomEvent<RendererFeedback>).detail;
         if (value.kind === "audio-status") setAudioStatus(value.message);
         else setNotice({ message: value.message, error: value.error });
      };
      window.addEventListener("acroclip-feedback", feedback);
      return () => {
         unsubscribe();
         window.removeEventListener("acroclip-feedback", feedback);
      };
   }, [run]);
   useEffect(() => {
      if (!notice || notice.error) return;
      const timer = window.setTimeout(() => setNotice(null), 5000);
      return () => window.clearTimeout(timer);
   }, [notice]);
   useEffect(() => {
      if (!state) return;
      const key = (event: KeyboardEvent) => {
         const target = event.target instanceof HTMLElement ? event.target : null;
         if (
            event.defaultPrevented ||
            event.repeat ||
            target?.closest("input,textarea,select,[contenteditable=true],[role=textbox],[role=slider],[role=combobox],.shortcut-input.editing") ||
            document.querySelector('[role="dialog"]')
         )
            return;
         const mac = state.platform === "darwin",
            pressed = normalizeBinding(eventBinding(event), mac);
         const action = shortcutRegistry.find(
            (item) =>
               item.scope === "local" &&
               (item.page === "all" || item.page === page) &&
               bindingFor(state.preferences, item.id) &&
               normalizeBinding(bindingFor(state.preferences, item.id), mac) === pressed
         );
         if (
            !action ||
            (target?.closest('button,a[href],[role="button"],[role="menuitem"],[role="menuitemradio"],[role="option"]') &&
               !event.ctrlKey &&
               !event.metaKey &&
               !event.altKey)
         )
            return;
         event.preventDefault();
         if (["recording", "library", "viewer", "settings"].includes(action.id)) setPage(action.id as Page);
         else window.dispatchEvent(new CustomEvent("acroclip-shortcut", { detail: action.id }));
      };
      window.addEventListener("keydown", key);
      return () => window.removeEventListener("keydown", key);
   }, [state, page, setPage]);
   const clip = useMemo(() => (selected === null ? state?.clips[0] : state?.clips.find((item) => item.id === selected)), [state?.clips, selected]);
   useEffect(() => {
      // An empty viewer may receive its first clip after opening. Retain that
      // clip once it exists, just as when choosing an existing clip from the rail.
      if (page === "viewer" && selected === null && clip) setSelected(clip.id);
   }, [page, selected, clip]);
   const openClip = useCallback(
      (value: Clip) => {
         setSelected(value.id);
         setPage("viewer");
      },
      [setPage]
   );
   const clips = state?.clips,
      folders = state?.folders,
      applicationIcons = state?.applicationIcons,
      categories = state?.categories,
      collectionStatus = state?.collectionStatus,
      jobs = state?.jobs,
      preferences = state?.preferences,
      recorder = state?.recorder,
      platform = state?.platform,
      update = state?.update,
      version = state?.version;
   const libraryState = useMemo(
      () =>
         clips && folders && applicationIcons && categories && collectionStatus && jobs && preferences
            ? { clips, folders, applicationIcons, categories, collectionStatus, jobs, preferences }
            : null,
      [clips, folders, applicationIcons, categories, collectionStatus, jobs, preferences]
   );
   const recordingState = useMemo(() => (preferences && recorder && platform ? { preferences, recorder, platform } : null), [preferences, recorder, platform]);
   const viewerState = useMemo(
      () => (applicationIcons && jobs && preferences ? { applicationIcons, jobs, preferences } : null),
      [applicationIcons, jobs, preferences]
   );
   const settingsState = useMemo(
      () => (preferences && recorder && jobs && update && version ? { preferences, recorder, jobs, update, version } : null),
      [preferences, recorder, jobs, update, version]
   );
   const pages = [
      { id: "recording", title: "Recording", icon: Video },
      { id: "library", title: "Library", icon: Folder },
      { id: "viewer", title: "Player", icon: Film },
   ] as const;
   return (
      <div className="app-shell">
         <header className="titlebar">
            <div className="wordmark">
               <Clapperboard size={17} aria-hidden="true" />
               <span>AcroClip</span>
            </div>
            <span className="window-page">
               {page === "viewer" ? "Player" : page[0]?.toUpperCase()}
               {page === "viewer" ? "" : page.slice(1)}
            </span>
            <div className="titlebar-drag" />
            {state?.update.version && state.update.mode && !["idle", "checking"].includes(state.update.state) && (
               <UpdateChip
                  state={state.update}
                  onDownload={() => void run(() => api.downloadUpdate())}
                  onRestart={() => void run(() => api.installUpdate())}
                  onRelease={() => void run(() => api.openUpdateRelease())}
                  onReveal={() => void run(() => api.revealUpdate())}
               />
            )}
            {state?.platform !== "darwin" && (
               <div className="window-controls">
                  <IconButton label="Minimize" onClick={() => api.window("minimize")}>
                     <Minus size={15} />
                  </IconButton>
                  <IconButton label="Maximize" onClick={() => api.window("maximize")}>
                     <Square size={12} />
                  </IconButton>
                  <IconButton label="Close to tray" className="window-close" onClick={() => api.window("close")}>
                     <X size={16} />
                  </IconButton>
               </div>
            )}
         </header>
         <nav className="moving-selection rail" aria-label="Main navigation" inert={!state || !state.preferences.setupComplete}>
            <SelectionIndicator value={page} />
            <div className="rail-main">
               {pages.map((item) => (
                  <button
                     key={item.id}
                     title={item.title}
                     aria-label={item.title}
                     aria-current={page === item.id ? "page" : undefined}
                     className={`rail-button ${page === item.id ? "selected" : ""}`}
                     onClick={() => {
                        if (item.id === "viewer" && selected === null && clip) setSelected(clip.id);
                        setPage(item.id);
                     }}
                  >
                     {page === item.id && <TabMarker />}
                     <item.icon size={23} strokeWidth={1.65} />
                     <span>{item.title}</span>
                  </button>
               ))}
            </div>
            <button
               title="Settings"
               aria-label="Settings"
               aria-current={page === "settings" ? "page" : undefined}
               className={`rail-button ${page === "settings" ? "selected" : ""}`}
               onClick={() => setPage("settings")}
            >
               {page === "settings" && <TabMarker />}
               <Settings2 size={23} strokeWidth={1.65} />
               <span>Settings</span>
            </button>
         </nav>
         <main className="workspace" data-direction={direction} inert={!!state && !state.preferences.setupComplete}>
            {state && libraryState && recordingState && viewerState && settingsState ? (
               <>
                  <section className="page" hidden={page !== "recording"}>
                     <RecordingPage
                        state={recordingState}
                        visible={page === "recording" && windowVisible && state.preferences.setupComplete}
                        run={run}
                        pulse={clipPulse}
                        openGames={openGames}
                     />
                  </section>
                  <section className="page" hidden={page !== "library"}>
                     {visited.includes("library") && (
                        <LibraryPage
                           state={libraryState}
                           visible={page === "library" && windowVisible}
                           run={run}
                           ask={ask}
                           openClip={openClip}
                           openSettings={openCollectionSettings}
                        />
                     )}
                  </section>
                  <section className="page" hidden={page !== "viewer"}>
                     {visited.includes("viewer") && (
                        <ViewerPage
                           ask={ask}
                           state={viewerState}
                           clip={clip}
                           visible={page === "viewer" && windowVisible}
                           run={run}
                           openLibrary={openLibrary}
                        />
                     )}
                  </section>
                  <section className="page" hidden={page !== "settings"}>
                     {visited.includes("settings") && <SettingsPage state={settingsState} run={run} target={settingsTarget} />}
                  </section>
               </>
            ) : (
               <div className="loading-app" role="status" aria-label="Opening AcroClip">
                  <div className="startup-brand">
                     <AppLogo size={64} />
                     <p>Loading...</p>
                  </div>
               </div>
            )}
         </main>
         <RecordingStatus state={state} visible={windowVisible} audioMessage={page === "recording" ? audioStatus : ""} />
         {notice && (
            <div className={`toast ${notice.error ? "error" : ""}`} role={notice.error ? "alert" : "status"}>
               {notice.error ? <AlertCircle size={18} /> : <Check size={18} />}
               <span>{notice.message}</span>
               <IconButton label="Dismiss" onClick={() => setNotice(null)}>
                  <X size={15} />
               </IconButton>
            </div>
         )}
         {dialog && <Dialog key={dialog.title} request={dialog} close={() => setDialog(null)} />}
         {state && !state.preferences.setupComplete && <Onboarding state={state} run={run} />}
      </div>
   );
}
