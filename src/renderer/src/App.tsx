import { memo, Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Clapperboard, LibraryBig, Play, Minus, Settings2, Square, Video, X } from "lucide-react";
import { AppLogo } from "./AppLogo";
import type { AppEvent, AppState, Clip, NoticeOptions } from "../../shared/types";
import { applyStatePatch } from "../../shared/state-patch";
import { SelectionIndicator, TabMarker } from "./SelectionIndicator";
import { api, describeError } from "./desktop";
import { Dialog } from "./Dialog";
import { RecordingStatus } from "./RecordingStatus";
import { IconButton } from "./ui";
import type { DialogRequest } from "./Dialog";
import type { RendererFeedback, Run } from "./desktop";
import { shortcutRegistry, bindingFor, eventBinding, normalizeBinding, physicalBinding } from "../../shared/shortcuts";
import { Recording } from "./Recording";
import type { SettingsTarget } from "./Settings";
import { UpdateChip } from "./UpdateChip";
import { clearNotification, notify, type NotificationInput } from "./notifications";
import { NotificationToast } from "./NotificationToast";
import { TooltipLayer } from "./Tooltip";
import { useNavigationHistory } from "./navigation-history";
import type { Ask } from "./Dialog";
import { preloadedPage } from "./preloaded-page";
import { ShortcutSheet } from "./ShortcutSheet";
import { queuePosition } from "./play-queue";
import type { PlayQueue } from "./play-queue";
import { readLibraryView } from "./library-view";

type Page = "recording" | "library" | "viewer" | "settings";
// Capture is the first screen. Other pages load after it paints and preload
// while the window is idle, so switching to them never waits.
const library = preloadedPage(() => import("./Library").then((module) => module.Library));
const viewer = preloadedPage(() => import("./Viewer").then((module) => module.Viewer));
const settings = preloadedPage(() => import("./Settings").then((module) => module.Settings));
const onboarding = preloadedPage(() => import("./Onboarding").then((module) => module.Onboarding));
const LibraryPage = library.Page;
const ViewerPage = viewer.Page;
const SettingsPage = settings.Page;
const Onboarding = onboarding.Page;
const RecordingPage = memo(Recording);
const pageOrder: readonly Page[] = ["recording", "library", "viewer", "settings"];
function noticeInput({ message, error, tone, ...options }: { message: string; error: boolean } & NoticeOptions): NotificationInput {
   return { ...options, message, tone: tone ?? (error ? "error" : "success") };
}

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
   const loaded = !!state;
   useEffect(() => {
      if (!loaded) return;
      const idle = requestIdleCallback(() => [library, viewer, settings].forEach((page) => void page.preload()), { timeout: 1500 });
      return () => cancelIdleCallback(idle);
   }, [loaded]);
   const [selected, setSelected] = useState<string | null>(null);
   const pendingLibraryAction = useRef<string | null>(null);
   useEffect(() => {
      if (page !== "library" || !pendingLibraryAction.current) return;
      const action = pendingLibraryAction.current;
      pendingLibraryAction.current = null;
      window.dispatchEvent(new CustomEvent("acroclip-shortcut", { detail: action }));
   }, [page]);
   useNavigationHistory(page, selected, (location) => {
      setPage(location.page);
      setSelected(location.clipId);
   });
   const [audioStatus, setAudioStatus] = useState("");
   const [dialog, setDialog] = useState<DialogRequest | null>(null);
   const [shortcutSheet, setShortcutSheet] = useState(false);
   const [clipPulse, setClipPulse] = useState(0);
   const run: Run = useCallback(async (action, options) => {
      try {
         await action();
         return true;
      } catch (error) {
         // Capture actions answer through main, which shows the banner and leaves a chip here.
         if (options?.feedback !== "external") notify({ message: describeError(error), tone: "error", chip: true });
         return false;
      }
   }, []);
   const ask: Ask = useCallback((request) => new Promise((resolve) => setDialog({ ...request, resolve })), []);
   useEffect(() => {
      // Events can arrive before the first snapshot. They are replayed onto it.
      let current: AppState | null = null;
      let receivedState = false;
      let disposed = false;
      let early: Array<Extract<AppEvent, { type: "state-patch" | "recorder" }>> = [];
      const publish = (next: AppState, visible: boolean | undefined = next.windowVisible) => {
         if (disposed) return;
         current = next;
         setState(next);
         if (visible !== undefined) setWindowVisible(visible);
      };
      const apply = (base: AppState, event: (typeof early)[number]) =>
         event.type === "recorder" ? { ...base, recorder: event.recorder } : applyStatePatch(base, event);
      void run(async () => {
         const loaded = await api.state();
         if (receivedState) return;
         let next = loaded;
         for (const event of early) next = apply(next, event) ?? next;
         early = [];
         publish(next);
      });
      const unsubscribe = api.onEvent((event) => {
         if (event.type === "state") {
            receivedState = true;
            publish(event.state);
         }
         if (event.type === "visibility") setWindowVisible(event.visible);
         if (event.type === "state-patch" || event.type === "recorder") {
            if (!current) {
               early.push(event);
               return;
            }
            const next = apply(current, event);
            // A library change for a clip this window never received needs a fresh snapshot.
            if (next) publish(next, event.type === "state-patch" ? event.patch.windowVisible : undefined);
            else void api.state().then(publish, () => undefined);
         }
         if (event.type === "clip-action") setClipPulse((value) => value + 1);
         if (event.type === "notice" && event.message) notify(noticeInput(event));
         if (event.type === "notice-clear") clearNotification(event.key);
      });
      const feedback = (event: Event) => {
         const value = (event as CustomEvent<RendererFeedback>).detail;
         if (value.kind === "audio-status") setAudioStatus(value.message);
         else notify(noticeInput(value));
      };
      window.addEventListener("acroclip-feedback", feedback);
      return () => {
         disposed = true;
         unsubscribe();
         window.removeEventListener("acroclip-feedback", feedback);
      };
   }, [run]);
   // Local shortcuts depend on bindings and the page, not on status updates.
   const shortcutPreferences = state?.preferences;
   const mac = state?.platform === "darwin";
   useEffect(() => {
      if (!shortcutPreferences) return;
      const key = (event: KeyboardEvent) => {
         const target = event.target instanceof HTMLElement ? event.target : null;
         const editing = target?.closest("input,textarea,select,[contenteditable=true],[role=textbox],[role=slider],[role=combobox],.shortcut-input.editing");
         if (event.defaultPrevented || event.repeat || document.querySelector('[role="dialog"]')) return;
         const candidates = shortcutRegistry.filter(
            (item) => item.scope === "local" && (item.page === "all" || item.page === page) && bindingFor(shortcutPreferences, item.id)
         );
         const matches = (binding: string | null) =>
            binding === null
               ? undefined
               : candidates.find((item) => normalizeBinding(bindingFor(shortcutPreferences, item.id), mac) === normalizeBinding(binding, mac));
         // The typed character wins. The physical key lets Ctrl+/ work where / needs Shift.
         const action = matches(eventBinding(event)) ?? matches(physicalBinding(event));
         if (
            !action ||
            (editing && action.id !== "newCategory" && action.id !== "newFolder") ||
            (target?.closest('button,a[href],[role="button"],[role="menuitem"],[role="menuitemradio"],[role="option"]') &&
               !event.ctrlKey &&
               !event.metaKey &&
               !event.altKey) ||
            // Copying selected text stays the usual copy.
            ((action.id === "copyFile" || action.id === "copyClipFile") && !!window.getSelection()?.toString())
         )
            return;
         event.preventDefault();
         if (action.id === "shortcutHelp") setShortcutSheet(true);
         else if (["recording", "library", "viewer", "settings"].includes(action.id)) setPage(action.id as Page);
         else if ((action.id === "newCategory" || action.id === "newFolder") && page !== "library") {
            pendingLibraryAction.current = action.id === "newFolder" ? "newFolderRoot" : action.id;
            setPage("library");
         } else window.dispatchEvent(new CustomEvent("acroclip-shortcut", { detail: action.id }));
      };
      window.addEventListener("keydown", key);
      return () => window.removeEventListener("keydown", key);
   }, [shortcutPreferences, mac, page, setPage]);
   const clip = useMemo(() => (selected === null ? state?.clips[0] : state?.clips.find((item) => item.id === selected)), [state?.clips, selected]);
   // The library view a clip was opened from, frozen for previous and next.
   const [queue, setQueue] = useState<PlayQueue | null>(null);
   // A clip the player should start playing as soon as it loads, such as the next one in a queue.
   const [autoplay, setAutoplay] = useState<string | null>(null);
   const allClips = state?.clips;
   const position = useMemo(() => (clip && allClips ? queuePosition(clip, allClips, queue, readLibraryView().sort) : null), [clip, allClips, queue]);
   const stepClip = useCallback((value: Clip, play: boolean) => {
      setSelected(value.id);
      setAutoplay(play ? value.id : null);
   }, []);
   useEffect(() => {
      // An empty viewer may receive its first clip after opening. Retain that
      // clip once it exists, just as when choosing an existing clip from the rail.
      if (page === "viewer" && selected === null && clip) setSelected(clip.id);
   }, [page, selected, clip]);
   // A request the player answers by trimming the clip it names, once.
   const [trimRequest, setTrimRequest] = useState<{ clipId: string; at: number } | null>(null);
   const openClip = useCallback(
      (value: Clip, from?: PlayQueue, options?: { trim: true }) => {
         setSelected(value.id);
         setQueue(from ?? null);
         setAutoplay(null);
         if (options?.trim) setTrimRequest({ clipId: value.id, at: Date.now() });
         setPage("viewer");
      },
      [setPage]
   );
   const showClip = useCallback((id: string) => {
      setSelected(id);
      setAutoplay(null);
   }, []);
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
            ? { clips, folders, applicationIcons, categories, collectionStatus, jobs, preferences, platform: state?.platform ?? "" }
            : null,
      [clips, folders, applicationIcons, categories, collectionStatus, jobs, preferences, state?.platform]
   );
   const recordingState = useMemo(() => (preferences && recorder && platform ? { preferences, recorder, platform } : null), [preferences, recorder, platform]);
   const viewerState = useMemo(
      () => (applicationIcons && jobs && preferences && categories ? { applicationIcons, jobs, preferences, categories } : null),
      [applicationIcons, jobs, preferences, categories]
   );
   const settingsState = useMemo(
      () => (preferences && recorder && jobs && update && version ? { preferences, recorder, jobs, update, version, platform: state?.platform ?? "" } : null),
      [preferences, recorder, jobs, update, version, state?.platform]
   );
   const pages = [
      { id: "recording", title: "Capture", icon: Video },
      { id: "library", title: "Library", icon: LibraryBig },
      { id: "viewer", title: "Player", icon: Play },
   ] as const;
   return (
      <div className="app-shell">
         <header className={`titlebar${state?.platform === "linux" ? " native-titlebar" : ""}`}>
            <div className="wordmark">
               <Clapperboard size={17} aria-hidden="true" />
               <span>AcroClip</span>
            </div>
            <span className="window-page">{pages.find((item) => item.id === page)?.title ?? page}</span>
            <div className="titlebar-drag" />
            {state?.update.version && state.update.mode && !["idle", "checking"].includes(state.update.state) && <UpdateChip state={state.update} run={run} />}
            {state?.platform === "win32" && (
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
                     data-tooltip={item.title}
                     data-tooltip-side="right"
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
               data-tooltip="Settings"
               data-tooltip-side="right"
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
                        <Suspense fallback={null}>
                           <LibraryPage
                              state={libraryState}
                              visible={page === "library" && windowVisible}
                              run={run}
                              ask={ask}
                              openClip={openClip}
                              openSettings={openCollectionSettings}
                              openGames={openGames}
                           />
                        </Suspense>
                     )}
                  </section>
                  <section className="page" hidden={page !== "viewer"}>
                     {visited.includes("viewer") && (
                        <Suspense fallback={null}>
                           <ViewerPage
                              ask={ask}
                              state={viewerState}
                              clip={clip}
                              queue={position}
                              autoplay={!!clip && autoplay === clip.id}
                              stepClip={stepClip}
                              visible={page === "viewer" && windowVisible}
                              run={run}
                              openLibrary={openLibrary}
                              trimRequest={trimRequest}
                              showClip={showClip}
                           />
                        </Suspense>
                     )}
                  </section>
                  <section className="page" hidden={page !== "settings"}>
                     {visited.includes("settings") && (
                        <Suspense fallback={null}>
                           <SettingsPage state={settingsState} run={run} ask={ask} target={settingsTarget} showShortcuts={() => setShortcutSheet(true)} />
                        </Suspense>
                     )}
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
         <RecordingStatus state={state} audioMessage={page === "recording" ? audioStatus : ""} />
         <NotificationToast />
         <TooltipLayer />
         {dialog && <Dialog key={dialog.title} request={dialog} close={() => setDialog(null)} />}
         {shortcutSheet && state && (
            <ShortcutSheet
               preferences={state.preferences}
               page={page}
               mac={mac}
               close={() => setShortcutSheet(false)}
               openSettings={() => openSettings("shortcuts")}
            />
         )}
         {state && !state.preferences.setupComplete && (
            <Suspense fallback={null}>
               <Onboarding state={state} run={run} />
            </Suspense>
         )}
      </div>
   );
}
