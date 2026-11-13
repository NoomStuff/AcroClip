import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import {
   AlertCircle,
   Info,
   Bell,
   Check,
   Download,
   FileText,
   Folder,
   FolderOpen,
   Gamepad2,
   Keyboard,
   LoaderCircle,
   RefreshCw,
   Settings2,
   Video,
   Clock3,
   Copy,
   FileVideo,
   FolderTree,
   Power,
   Scissors,
   History,
   Trash2,
   Bug,
   FileArchive,
   RotateCcw,
   Eraser,
} from "lucide-react";
import type { AppState, OverlapClips, Preferences } from "../../shared/types";
import { useSettingsAutosave } from "./useSettingsAutosave";
import { previewFilename, filenameFields, filenamePatterns, filenameTemplateError, filenameTemplateWarning } from "../../shared/filename";
import { SelectionIndicator } from "./SelectionIndicator";
import { SidebarTab } from "./SidebarTab";
import { MotionList } from "./MotionList";
import { HeaderActions, Button, Select } from "./ui";
import { PresetNumberInput } from "./PresetNumberInput";
import { Field, Toggle } from "./SettingsControls";
import { NotificationSettings } from "./NotificationSettings";
import { api, reportFeedback } from "./desktop";
import type { Ask, DialogRequest } from "./Dialog";
import { preferenceResetCopy, resetPartCopy, resetParts } from "../../shared/maintenance";
import type { Run } from "./desktop";
import { RecordingPresets, customQualityError } from "./RecordingPresets";
import { shortcutRegistry, shortcutGroup, bindingFor, shortcutClashes, shortcutConflict, formatBinding } from "../../shared/shortcuts";
import { ShortcutInput } from "./ShortcutInput";
import { GameManagement } from "./GameManagement";
import { PaneDivider, usePaneSize } from "./layout";
import { FolderPicker } from "./FolderPicker";
import { timeAgo } from "./format";
import { overlapDetail } from "./overlap-copy";
import { TimeInput } from "./TimeInput";
import { initialLocation, reportLocation } from "./navigation-history";
import type { NavigationLocation } from "./navigation-history";
import { updateAction, updateDownloading, updateDownloadLabel } from "./update-action";
import { clipLengthWarning, useInstalledMemory } from "./replay-estimate";
import { WarningIcon } from "./WarningIcon";

const sections = [
   { id: "recording", label: "Capture", icon: Video },
   { id: "collection", label: "Collection", icon: Folder },
   { id: "games", label: "Games", icon: Gamepad2 },
   { id: "notifications", label: "Notifications", icon: Bell },
   { id: "shortcuts", label: "Shortcuts", icon: Keyboard },
   { id: "general", label: "App & updates", icon: Settings2 },
] as const;
type Section = (typeof sections)[number]["id"];
const shareSizes = [10, 20, 50, 100];
function LastChecked({ timestamp }: { timestamp: number }) {
   const [now, setNow] = useState(Date.now);
   useEffect(() => {
      const timer = window.setInterval(() => setNow(Date.now()), 30_000);
      return () => window.clearInterval(timer);
   }, []);
   return <>Last checked {timeAgo(timestamp, now)}</>;
}
function FilenameEditor({
   value,
   preset,
   onChange,
   onPreset,
}: {
   value: string;
   preset: Preferences["filenamePreset"];
   onChange: (value: string) => void;
   onPreset: (value: Preferences["filenamePreset"]) => void;
}) {
   const input = useRef<HTMLInputElement>(null);
   const error = filenameTemplateError(value);
   const warning = filenameTemplateWarning(value);
   const message = error || warning;
   useEffect(() => {
      if (input.current && document.activeElement !== input.current && input.current.value !== value) input.current.value = value;
   }, [value]);
   const insert = (token: string) => {
      const element = input.current;
      if (!element) return;
      element.focus();
      const start = element.selectionStart ?? element.value.length;
      const end = element.selectionEnd ?? start;
      if (!document.execCommand("insertText", false, token)) {
         element.setRangeText(token, start, end, "end");
         onChange(element.value);
      }
   };
   return (
      <div className="filename-editor">
         <div className="filename-heading">
            <FileText className="settings-row-icon" size={21} aria-hidden="true" />
            <label htmlFor="filename-pattern">File name</label>
            <Select label="Filename preset" value={preset} onChange={(next) => onPreset(next as Preferences["filenamePreset"])}>
               <option value="source-date">App + date</option>
               <option value="date-source">Date + app</option>
               <option value="replay">Replay + date</option>
               <option value="compact">Compact</option>
               <option value="custom">Custom</option>
            </Select>
         </div>
         <div className="filename-pattern-input" data-invalid={!!error || undefined}>
            <input
               id="filename-pattern"
               aria-invalid={!!error || undefined}
               aria-describedby={message ? "filename-pattern-message" : undefined}
               aria-label="Name pattern"
               ref={input}
               defaultValue={value}
               onInput={(event) => onChange(event.currentTarget.value)}
               onBlur={(event) => {
                  const trimmed = event.currentTarget.value.trim();
                  if (trimmed !== event.currentTarget.value) onChange(trimmed);
               }}
               maxLength={160}
               spellCheck={false}
            />
            <WarningIcon message={message} error={!!error} id="filename-pattern-message" />
         </div>
         <div className="filename-tokens">
            {filenameFields.map((item) => (
               <button key={item.token} data-tooltip={item.token} onMouseDown={(event) => event.preventDefault()} onClick={() => insert(item.token)}>
                  {item.name}
                  <span>{item.token}</span>
               </button>
            ))}
         </div>
      </div>
   );
}
/**
 * Save problems and waiting changes float over the bottom of the page, so showing one never moves
 * the settings under the pointer. The last message stays while it fades out.
 */
function SaveFeedback({ message, tone, action }: { message: string; tone: "error" | "info"; action: ReactNode }) {
   const [last, setLast] = useState({ message, tone, action });
   useLayoutEffect(() => {
      if (message) setLast({ message, tone, action });
   }, [message, tone, action]);
   const shown = message ? { message, tone, action } : last;
   return (
      <div className="settings-save-feedback" role="status" aria-hidden={!message || undefined} data-shown={!!message || undefined} data-tone={shown.tone}>
         <span>{shown.message}</span>
         {message && shown.action}
      </div>
   );
}
export interface SettingsTarget {
   section: "collection" | "games" | "shortcuts";
   request: number;
}
export function Settings({
   state,
   run,
   ask,
   target,
   showShortcuts,
}: {
   state: Pick<AppState, "preferences" | "pendingPreferences" | "recorder" | "jobs" | "update" | "version" | "platform">;
   run: Run;
   ask: Ask;
   target: SettingsTarget | null;
   showShortcuts: () => void;
}) {
   const layout = useRef<HTMLDivElement>(null);
   const content = useRef<HTMLDivElement>(null);
   const sidebar = usePaneSize(layout, { key: "settings.sidebar", initial: 270, min: 210, max: 400, reserve: 520, axis: "x" });
   const [{ section, direction }, setNavigation] = useState<{ section: Section; direction: "up" | "down" | null }>(() => ({
      section: sections.find((item) => item.id === initialLocation("settings", "recording"))?.id ?? "recording",
      direction: null,
   }));
   const setSection = useCallback((next: Section) => {
      setNavigation((current) =>
         current.section === next
            ? current
            : {
                 section: next,
                 direction: sections.findIndex((item) => item.id === next) < sections.findIndex((item) => item.id === current.section) ? "up" : "down",
              }
      );
   }, []);
   useEffect(() => reportLocation("settings", section), [section]);
   useEffect(() => {
      const restore = (event: Event) => {
         const next = (event as CustomEvent<NavigationLocation>).detail.settings;
         const found = sections.find((item) => item.id === next);
         if (found) setSection(found.id);
      };
      window.addEventListener("acroclip-restore-location", restore);
      return () => window.removeEventListener("acroclip-restore-location", restore);
   }, [setSection]);
   useLayoutEffect(() => {
      const node = content.current;
      const reducedMotion = matchMedia("(prefers-reduced-motion: reduce)");
      if (!node || !direction || reducedMotion.matches) return;
      const animation = node.animate(
         [
            { opacity: 0, transform: `translateY(${direction === "up" ? -16 : 16}px)` },
            { opacity: 1, transform: "translateY(0)" },
         ],
         { duration: 280, easing: getComputedStyle(node).getPropertyValue("--ease").trim() }
      );
      const reduce = () => {
         if (reducedMotion.matches) animation.cancel();
      };
      reducedMotion.addEventListener("change", reduce);
      return () => {
         animation.cancel();
         reducedMotion.removeEventListener("change", reduce);
      };
   }, [section, direction]);
   const { draft, write, status, error: saveError, retrying, retry, flush } = useSettingsAutosave(state.preferences, state.pendingPreferences);
   const waiting = Object.keys(state.pendingPreferences) as Array<keyof Preferences>;
   const recording = ["recording", "waiting", "starting"].includes(state.recorder.state);
   const captureSettings = section === "recording";
   const collectionSettings = section === "collection";
   const pendingWork = state.recorder.pendingSaves > 0 || state.jobs.some((job) => job.state === "running" || job.state === "queued");
   const locked = (recording && (captureSettings || collectionSettings)) || (collectionSettings && pendingWork);
   const collectionFolder = useRef<HTMLDivElement>(null);
   const gameSearch = useRef<HTMLInputElement>(null);
   const handledNavigationRequest = useRef(0);
   const highlightTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
   const [collectionHighlighted, setCollectionHighlighted] = useState(false);
   useLayoutEffect(() => {
      if (target && target.request !== handledNavigationRequest.current) setSection(target.section);
   }, [target, setSection]);
   useLayoutEffect(() => {
      if (!target || section !== target.section || target.request === handledNavigationRequest.current) return;
      const element = target.section === "collection" ? collectionFolder.current : target.section === "games" ? gameSearch.current : null;
      if (!element) return;
      handledNavigationRequest.current = target.request;
      element.scrollIntoView({ block: "center" });
      const button = target.section === "collection" ? element.querySelector<HTMLButtonElement>("button[data-choose-folder]") : null;
      (button && !button.disabled ? button : element).focus({ preventScroll: true });
      clearTimeout(highlightTimer.current);
      setCollectionHighlighted(target.section === "collection");
      highlightTimer.current = setTimeout(() => setCollectionHighlighted(false), 1600);
   }, [target, section]);
   useEffect(() => () => clearTimeout(highlightTimer.current), []);
   const mac = state.platform === "darwin";
   // Clashing shortcuts are marked on their rows, so the footer does not repeat them.
   const inlineClash = section === "shortcuts" && shortcutConflict(draft, mac) !== null;
   const qualityError = customQualityError(draft);
   const memoryBytes = useInstalledMemory();
   const lengthWarning = clipLengthWarning(draft, memoryBytes);
   const filenamePattern = draft.filenamePreset === "custom" ? draft.filenameTemplate : filenamePatterns[draft.filenamePreset];
   const filenameError = filenameTemplateError(filenamePattern);
   const change = <K extends keyof Preferences>(key: K, value: Preferences[K]) => write({ ...draft, [key]: value });
   const switchSection = (id: Section) => setSection(id);
   const chooseFolder = async () => {
      await run(async () => {
         const path = await api.chooseFolder();
         if (path) change("collection", path);
      });
   };
   const [exporting, setExporting] = useState<"report" | "export" | null>(null);
   const exportLogs = (kind: "report" | "export") =>
      void run(async () => {
         setExporting(kind);
         try {
            if (kind === "report") {
               await api.reportBug();
               reportFeedback({ kind: "notice", message: "Logs saved to Downloads. Attach the zip to your report.", error: false, tone: "success" });
            } else if (await api.exportLogs()) reportFeedback({ kind: "notice", message: "Logs exported", error: false, tone: "success" });
         } finally {
            setExporting(null);
         }
      });
   const [maintaining, setMaintaining] = useState<"settings" | "cache" | "history" | "factory" | null>(null);
   /** Every maintenance action confirms first. A checklist answers with the ticked IDs. */
   const maintain = (task: NonNullable<typeof maintaining>, request: Omit<DialogRequest, "resolve" | "danger">, act: (ticked: string[]) => Promise<void>) =>
      void run(async () => {
         const answer = await ask({ ...request, danger: true });
         if (!answer) return;
         setMaintaining(task);
         try {
            await act(Array.isArray(answer) ? answer : []);
         } finally {
            setMaintaining(null);
         }
      });
   const resetSettings = () =>
      maintain(
         "settings",
         {
            title: "Reset settings?",
            detail: "Your clip folder, clips, tags and stats stay. This can't be undone.",
            confirm: "Reset",
            choices: [
               { id: "settings", ...preferenceResetCopy.settings, checked: true },
               { id: "setup", ...preferenceResetCopy.setup, checked: false },
            ],
         },
         async (ticked) => {
            const parts = { settings: ticked.includes("settings"), setup: ticked.includes("setup") };
            // A change still waiting to save would land on top of the defaults.
            await flush();
            await api.resetPreferences(parts);
            const reset = parts.settings && parts.setup ? "Settings and recording setup" : parts.settings ? "Settings" : "Recording setup";
            reportFeedback({ kind: "notice", message: `${reset} reset`, error: false, tone: "success" });
         }
      );
   const clearCache = () =>
      maintain(
         "cache",
         {
            title: "Clear the cache?",
            detail:
               "Removes this collection's thumbnails, hover previews and playback copies. They rebuild in the background, which keeps the computer busy for a while on a big library. Clips, tags and shareables stay.",
            confirm: "Clear cache",
         },
         async () => {
            await api.clearCache();
            reportFeedback({ kind: "notice", message: "Cache cleared. Thumbnails are rebuilding.", error: false, tone: "success" });
         }
      );
   const clearHistory = () =>
      maintain(
         "history",
         {
            title: "Clear usage history?",
            detail: "This can't be undone.",
            confirm: "Clear",
            choices: [
               { id: "logs", ...resetPartCopy.logs, checked: true },
               { id: "stats", ...resetPartCopy.stats, checked: false },
            ],
         },
         async (ticked) => {
            const parts = { logs: ticked.includes("logs"), stats: ticked.includes("stats") };
            await api.clearHistory(parts);
            const cleared = parts.logs && parts.stats ? "Logs and usage stats" : parts.logs ? "Logs" : "Usage stats";
            reportFeedback({ kind: "notice", message: `${cleared} cleared`, error: false, tone: "success" });
         }
      );
   const factoryReset = () =>
      maintain(
         "factory",
         {
            title: "Factory reset",
            detail: "Choose what to remove. AcroClip asks once more, then restarts. Your clips, tags and shareables stay where they are.",
            confirm: "Factory reset",
            choices: resetParts.map((id) => ({ id, ...resetPartCopy[id], checked: true })),
         },
         async (ticked) => {
            await flush();
            await api.factoryReset(resetParts.filter((part) => ticked.includes(part)));
         }
      );
   const update = updateAction(state.update);
   const downloading = updateDownloading(state.update);
   const title = sections.find((item) => item.id === section)?.label;
   return (
      <div className="settings-page" ref={layout}>
         <aside className="settings-sidebar" style={{ width: sidebar.size }}>
            <div className="settings-sidebar-heading action-header">
               <h1>Settings</h1>
               <HeaderActions>
                  <span
                     role="status"
                     aria-label={
                        status === "saving" ? "Saving settings" : status === "saved" ? "Settings saved" : status === "error" ? "Settings not saved" : undefined
                     }
                  >
                     {status === "saving" ? (
                        <LoaderCircle size={17} className="spin" />
                     ) : status === "saved" ? (
                        <Check size={17} />
                     ) : status === "error" ? (
                        <AlertCircle size={17} />
                     ) : null}
                  </span>
               </HeaderActions>
            </div>
            <div className="settings-nav moving-selection">
               <SelectionIndicator value={section} />
               <MotionList items={sections}>
                  {(item) => (
                     <SidebarTab
                        key={item.id}
                        icon={<item.icon size={17} />}
                        label={item.label}
                        selection="page"
                        selected={section === item.id}
                        onSelect={() => void switchSection(item.id)}
                     />
                  )}
               </MotionList>
            </div>
            <div className="settings-sidebar-bottom">
               <span>AcroClip {state.version}</span>
            </div>
         </aside>
         <PaneDivider label="Settings sidebar width" pane={sidebar} />
         <div className="settings-main" key={section} ref={content}>
            <div className="settings-scroll">
               <header className="settings-heading">
                  <h1>{title}</h1>
               </header>
               <fieldset className="settings-body" disabled={captureSettings && locked}>
                  {section === "recording" && (
                     <>
                        <section className="settings-group">
                           <h2>Quality</h2>
                           <RecordingPresets
                              compact
                              value={draft}
                              onChange={(next) => {
                                 if (!locked) write(next);
                              }}
                           />
                        </section>
                        <section className="settings-group">
                           <h2>Clip</h2>
                           <Field icon={Clock3} label="Clip length" detail="Save this much recent footage when you clip.">
                              <div className="clip-length-control">
                                 <WarningIcon message={lengthWarning?.message ?? ""} error={!!lengthWarning?.error} id="clip-length-message" />
                                 <TimeInput
                                    min={5}
                                    max={1800}
                                    value={draft.clipSeconds}
                                    label="Clip length"
                                    onValueChange={(value) => change("clipSeconds", value)}
                                 />
                              </div>
                           </Field>
                           <Field icon={Scissors} label="Overlapping clips" detail={overlapDetail(draft.overlapClips, draft.clipSeconds)}>
                              <Select label="Overlapping clips" value={draft.overlapClips} onChange={(value) => change("overlapClips", value as OverlapClips)}>
                                 <option value="keep">Save normally</option>
                                 <option value="trim">Save what's new</option>
                                 <option value="merge">Extend previous clip</option>
                              </Select>
                           </Field>
                        </section>
                     </>
                  )}
                  {section === "shortcuts" && (
                     <>
                        <section className="settings-group">
                           <Field
                              icon={Keyboard}
                              label="Shortcut sheet"
                              detail={`Every shortcut on one screen. Press ${formatBinding(bindingFor(draft, "shortcutHelp"), state.platform === "darwin")} to open it from anywhere.`}
                           >
                              <Button onClick={showShortcuts}>Show all</Button>
                           </Field>
                        </section>
                        {[
                           {
                              title: "Capture",
                              detail: "Global shortcuts work in every app and from the tray.",
                              items: shortcutRegistry.filter((item) => item.scope === "global"),
                           },
                           {
                              title: "Navigation",
                              detail: "While AcroClip is open.",
                              items: shortcutRegistry.filter((item) => item.scope === "local" && shortcutGroup(item) === "all"),
                           },
                           {
                              title: "Library",
                              detail: "Search clips while browsing, or create a tag or folder from any page.",
                              items: shortcutRegistry.filter((item) => shortcutGroup(item) === "library"),
                           },
                           { title: "Player", detail: "While a clip is open.", items: shortcutRegistry.filter((item) => item.page === "viewer") },
                        ].map((group) => (
                           <section className="settings-group" key={group.title}>
                              <h2>{group.title}</h2>
                              <p className="section-description">{group.detail}</p>
                              {group.items.map((item) => {
                                 const clashes = shortcutClashes(draft, item.id, mac);
                                 return (
                                    <Field
                                       icon={Keyboard}
                                       key={item.id}
                                       label={item.label}
                                       className={clashes.length ? "shortcut-clash" : ""}
                                       {...(clashes.length ? { detail: `Also used by ${clashes.join(" and ")}` } : {})}
                                    >
                                       <ShortcutInput
                                          clash={clashes.length > 0}
                                          global={item.scope === "global"}
                                          label={item.id === "saveClip" ? "Clip shortcut" : `${item.label} shortcut`}
                                          value={bindingFor(draft, item.id)}
                                          onChange={(value) =>
                                             item.id === "saveClip" ? change("shortcut", value) : change("shortcuts", { ...draft.shortcuts, [item.id]: value })
                                          }
                                       />
                                    </Field>
                                 );
                              })}
                           </section>
                        ))}
                     </>
                  )}
                  {section === "games" && (
                     <>
                        <section className="settings-group">
                           <h2>Known games</h2>
                           <GameManagement preferences={draft} searchRef={gameSearch} change={(customGames) => write({ ...draft, customGames })} />
                        </section>
                     </>
                  )}
                  {section === "collection" && (
                     <>
                        <fieldset className="settings-group" disabled={locked}>
                           <h2>Location</h2>
                           <FolderPicker
                              path={draft.collection}
                              ref={collectionFolder}
                              navigationHighlighted={collectionHighlighted}
                              onChoose={() => void chooseFolder()}
                              revealDisabled={draft.collection !== state.preferences.collection}
                              onReveal={() => void run(() => api.reveal(state.preferences.collection))}
                           />
                        </fieldset>
                        <fieldset className="settings-group" disabled={locked}>
                           <h2>New clips</h2>
                           <Toggle
                              icon={FolderTree}
                              label="Group clips by application"
                              detail="Save new clips in application folders. Existing files stay where they are."
                              checked={draft.folderLayout === "application"}
                              onChange={(enabled) => change("folderLayout", enabled ? "application" : "flat")}
                           />
                           <div className="settings-filename-row">
                              <FilenameEditor
                                 preset={draft.filenamePreset}
                                 value={filenamePattern}
                                 onChange={(value) => write({ ...draft, filenamePreset: "custom", filenameTemplate: value })}
                                 onPreset={(preset) =>
                                    write({
                                       ...draft,
                                       filenamePreset: preset,
                                       filenameTemplate:
                                          preset === "custom"
                                             ? draft.filenamePreset === "custom"
                                                ? draft.filenameTemplate
                                                : filenamePatterns[draft.filenamePreset]
                                             : filenamePatterns[preset],
                                    })
                                 }
                              />
                              {!filenameError && (
                                 <>
                                    <div className="filename-preview">
                                       <span>Example</span>
                                       <code>{previewFilename(draft, "Desktop", new Date(2026, 9, 8, 19, 42, 10))}</code>
                                    </div>
                                 </>
                              )}
                           </div>
                        </fieldset>
                        <section className="settings-group">
                           <h2>Shareables</h2>
                           <Field icon={FileVideo} label="Default maximum size" detail="You can choose a different limit for each clip.">
                              <PresetNumberInput
                                 label="Default maximum size"
                                 inputLabel="Default shareable size in MB"
                                 presets={shareSizes}
                                 presetLabel={(size) => `${size} MB`}
                                 min={1}
                                 max={2000}
                                 value={draft.shareSizeMB}
                                 unit="MB"
                                 onValueChange={(value) => change("shareSizeMB", value)}
                              />
                           </Field>
                           <Toggle
                              icon={Copy}
                              label="Automatically create shareables"
                              detail="Compress a copy after each save. Uses extra resources while capturing."
                              checked={draft.autoShare}
                              onChange={(value) => change("autoShare", value)}
                           />
                        </section>
                     </>
                  )}
                  {section === "notifications" && <NotificationSettings value={draft} onChange={(key, enabled) => change(key, enabled)} />}
                  {section === "general" && (
                     <>
                        <section className="settings-group">
                           <h2>Startup</h2>
                           <p className="section-description">
                              {state.platform === "linux"
                                 ? "Closing the window exits AcroClip and stops capturing."
                                 : "Closing the window keeps AcroClip running in the tray."}
                           </p>
                           <Toggle
                              icon={Power}
                              label="Start with your computer"
                              checked={draft.startWithOS}
                              onChange={(value) => change("startWithOS", value)}
                           />
                           <Toggle
                              icon={FileVideo}
                              label="Start capturing when AcroClip opens"
                              detail="Use your saved source, or wait for its application to open."
                              checked={draft.autoRecord}
                              onChange={(value) => change("autoRecord", value)}
                           />
                        </section>
                        <section className="settings-group">
                           <h2>Updates</h2>
                           <Toggle
                              icon={RefreshCw}
                              label="Check for updates automatically"
                              checked={draft.updateCheck}
                              onChange={(updateCheck) => change("updateCheck", updateCheck)}
                           />

                           <Field
                              className="update-panel"
                              icon={Info}
                              label={`AcroClip ${state.version}`}
                              detail={
                                 state.update.state === "idle" && state.update.lastChecked ? (
                                    <LastChecked timestamp={state.update.lastChecked} />
                                 ) : (
                                    state.update.message || "Not checked yet"
                                 )
                              }
                           >
                              {update ? (
                                 <Button className="primary" onClick={() => void run(() => api[update.method]())}>
                                    {update.method === "revealUpdate" ? <FolderOpen size={16} /> : <Download size={16} />}
                                    {update.label}
                                 </Button>
                              ) : (
                                 <Button
                                    busy={state.update.state === "checking" || downloading}
                                    busyIndicator="content"
                                    onClick={() => void run(() => api.checkUpdate())}
                                 >
                                    <RefreshCw size={15} className={state.update.state === "checking" ? "spin" : undefined} />
                                    {downloading ? updateDownloadLabel(state.update) : "Check for updates"}
                                 </Button>
                              )}
                           </Field>
                        </section>
                        <section className="settings-group">
                           <h2>Troubleshooting</h2>
                           <p className="section-description">AcroClip keeps local logs. You can export them to help diagnose problems.</p>
                           <Field icon={Bug} label="Report a bug" detail="Saves your logs to Downloads and opens a bug report on GitHub.">
                              <Button busy={exporting === "report"} disabled={!!exporting} onClick={() => exportLogs("report")}>
                                 Report a bug
                              </Button>
                           </Field>
                           <Field icon={FileArchive} label="Export logs" detail="Save logs and system details as a zip.">
                              <Button busy={exporting === "export"} disabled={!!exporting} onClick={() => exportLogs("export")}>
                                 Export logs
                              </Button>
                           </Field>
                        </section>
                        <section className="settings-group settings-danger">
                           <h2>Maintenance</h2>
                           <p className="section-description">Clean up your installation and reset settings. Your files are untouched.</p>
                           <Field icon={RotateCcw} label="Reset settings & setup" detail="Reset settings, recording setup or both.">
                              <Button className="destructive" busy={maintaining === "settings"} disabled={!!maintaining} onClick={resetSettings}>
                                 Reset settings
                              </Button>
                           </Field>
                           <Field icon={Eraser} label="Clear cache" detail="Thumbnails and playback copies rebuild in the background.">
                              <Button className="destructive" busy={maintaining === "cache"} disabled={!!maintaining} onClick={clearCache}>
                                 Clear cache
                              </Button>
                           </Field>
                           <Field icon={History} label="Clear usage history" detail="Remove logs, usage stats or both.">
                              <Button className="destructive" busy={maintaining === "history"} disabled={!!maintaining} onClick={clearHistory}>
                                 Clear history
                              </Button>
                           </Field>
                           <Field icon={Trash2} label="Factory reset" detail="Choose what to remove, then AcroClip restarts.">
                              <Button className="destructive" busy={maintaining === "factory"} disabled={!!maintaining} onClick={factoryReset}>
                                 Factory reset
                              </Button>
                           </Field>
                        </section>
                     </>
                  )}
               </fieldset>
            </div>
            <SaveFeedback
               message={
                  qualityError ||
                  (!filenameError && !inlineClash && saveError ? `${saveError}${retrying ? " Retrying…" : ""}` : "") ||
                  (waiting.length
                     ? waiting.includes("collection") && waiting.length === 1
                        ? "The new collection folder applies once capture stops and shareables finish."
                        : "Your capture changes are saved and apply when capture stops."
                     : "") ||
                  (locked
                     ? recording
                        ? "Stop capturing to change capture or collection settings."
                        : "Finish pending work before changing the collection."
                     : "")
               }
               tone={qualityError || (saveError && !filenameError && !inlineClash) ? "error" : "info"}
               action={saveError && !filenameError && !retrying ? <Button onClick={retry}>Retry save</Button> : null}
            />
         </div>
      </div>
   );
}
