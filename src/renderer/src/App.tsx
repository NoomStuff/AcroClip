import { useCallback, useEffect, useState } from "react";
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
const pageOrder: readonly Page[] = ["recording", "library", "viewer", "settings"];
import type { Ask } from "./Dialog";
export function App() {
   const [state, setState] = useState<AppState | null>(null);
   const [{ page, direction }, setNavigation] = useState<{ page: Page; direction: "up" | "down" }>({ page: "recording", direction: "down" });
   const setPage = useCallback((next: Page) => {
      setNavigation((current) =>
         current.page === next
            ? current
            : {
                 page: next,
                 direction: pageOrder.indexOf(next) < pageOrder.indexOf(current.page) ? "up" : "down",
              }
      );
   }, []);
   const [settingsTarget, setSettingsTarget] = useState<SettingsTarget | null>(null);
   const openSettings = (section: SettingsTarget["section"]) => {
      setSettingsTarget((current) => ({ section, request: (current?.request ?? 0) + 1 }));
      setPage("settings");
   };
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
   const [elapsed, setElapsed] = useState(0);
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
      void run(async () => {
         const loaded = await api.state();
         if (receivedState) return;
         setState(recorder ? { ...loaded, recorder } : loaded);
         setWindowVisible(loaded.windowVisible);
      });
      const unsubscribe = api.onEvent((event) => {
         if (event.type === "state") {
            receivedState = true;
            setState(event.state);
            setWindowVisible(event.state.windowVisible);
         }
         if (event.type === "visibility") setWindowVisible(event.visible);
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
      const started = state?.recorder.startedAt;
      const update = () => setElapsed(started ? Math.max(0, (Date.now() - started) / 1000) : 0);
      update();
      const timer = window.setInterval(update, 1000);
      return () => window.clearInterval(timer);
   }, [state?.recorder.startedAt]);
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
   const clip = state?.clips.find((item) => item.id === selected) ?? (selected === null ? state?.clips[0] : undefined);
   useEffect(() => {
      // An empty viewer may receive its first clip after opening. Retain that
      // clip once it exists, just as when choosing an existing clip from the rail.
      if (page === "viewer" && selected === null && clip) setSelected(clip.id);
   }, [page, selected, clip]);
   const openClip = (value: Clip) => {
      setSelected(value.id);
      setPage("viewer");
   };
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
            {state ? (
               <>
                  <section className="page" hidden={page !== "recording"}>
                     <Recording
                        state={state}
                        visible={page === "recording" && windowVisible && state.preferences.setupComplete}
                        run={run}
                        pulse={clipPulse}
                        openGames={() => openSettings("games")}
                     />
                  </section>
                  <section className="page" hidden={page !== "library"}>
                     <Library
                        state={state}
                        visible={page === "library" && windowVisible}
                        run={run}
                        ask={ask}
                        openClip={openClip}
                        openSettings={() => openSettings("collection")}
                     />
                  </section>
                  <section className="page" hidden={page !== "viewer"}>
                     <Viewer
                        ask={ask}
                        state={state}
                        clip={clip}
                        visible={page === "viewer" && windowVisible}
                        run={run}
                        openLibrary={() => setPage("library")}
                     />
                  </section>
                  <section className="page" hidden={page !== "settings"}>
                     <Settings state={state} run={run} target={settingsTarget} />
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
         <RecordingStatus state={state} elapsed={elapsed} audioMessage={page === "recording" ? audioStatus : ""} />
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
