import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import {
   AlertCircle,
   TriangleAlert,
   CircleAlert,
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
} from "lucide-react";
import type { AppState, Preferences } from "../../shared/types";
import { useSettingsAutosave } from "./useSettingsAutosave";
import { previewFilename, filenamePatterns, filenameTemplateError, filenameTemplateWarning } from "../../shared/filename";
import { SelectionIndicator } from "./SelectionIndicator";
import { HeaderActions, Button, Select, NumberInput } from "./ui";
import { Field, Toggle } from "./SettingsControls";
import { api } from "./desktop";
import type { Run } from "./desktop";
import { RecordingPresets, customQualityError } from "./RecordingPresets";
import { shortcutRegistry, bindingFor } from "../../shared/shortcuts";
import { ShortcutInput } from "./ShortcutInput";
import { GameManagement } from "./GameManagement";
import { PaneDivider, usePaneSize } from "./layout";
import { FolderPicker } from "./FolderPicker";
import { timeAgo } from "./format";
import { updateAction, updateDownloading, updateDownloadLabel } from "./update-action";

const sections = [
   { id: "recording", label: "Recording", icon: Video },
   { id: "collection", label: "Collection", icon: Folder },
   { id: "games", label: "Games", icon: Gamepad2 },
   { id: "notifications", label: "Notifications", icon: Bell },
   { id: "shortcuts", label: "Shortcuts", icon: Keyboard },
   { id: "general", label: "App & updates", icon: Settings2 },
] as const;
type Section = (typeof sections)[number]["id"];
function LastChecked({ timestamp }: { timestamp: number }) {
   const [now, setNow] = useState(Date.now);
   useEffect(() => {
      const timer = window.setInterval(() => setNow(Date.now()), 30_000);
      return () => window.clearInterval(timer);
   }, []);
   return <>Last checked {timeAgo(timestamp, now)}</>;
}
function FilenameWarning({ message, error }: { message: string; error: boolean }) {
   const [hasAppeared, setHasAppeared] = useState(!!message);
   useEffect(() => {
      if (message) setHasAppeared(true);
   }, [message]);
   return (
      <span
         className="filename-warning-icon"
         data-state={message ? "visible" : hasAppeared ? "leaving" : "hidden"}
         data-tone={error ? "danger" : "warning"}
         role="img"
         aria-label={message || undefined}
         aria-hidden={!message}
         tabIndex={message ? 0 : -1}
      >
         {error ? <TriangleAlert size={16} /> : <CircleAlert size={16} />}
         {message && (
            <span className="filename-warning-tooltip" role="tooltip" id="filename-pattern-message">
               {message}
            </span>
         )}
      </span>
   );
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
            <FilenameWarning message={message} error={!!error} />
         </div>
         <div className="filename-tokens">
            {[
               { token: "{source}", name: "Application" },
               { token: "{date}", name: "Date" },
               { token: "{time}", name: "Time" },
            ].map((item) => (
               <button key={item.token} title={item.token} onMouseDown={(event) => event.preventDefault()} onClick={() => insert(item.token)}>
                  {item.name}
                  <span>{item.token}</span>
               </button>
            ))}
         </div>
      </div>
   );
}
export interface SettingsTarget {
   section: "collection" | "games";
   request: number;
}
export function Settings({
   state,
   run,
   target,
}: {
   state: Pick<AppState, "preferences" | "recorder" | "jobs" | "update" | "version">;
   run: Run;
   target: SettingsTarget | null;
}) {
   const layout = useRef<HTMLDivElement>(null);
   const content = useRef<HTMLDivElement>(null);
   const sidebar = usePaneSize(layout, { key: "settings.sidebar", initial: 245, min: 210, max: 380, reserve: 520, axis: "x" });
   const [{ section, direction }, setNavigation] = useState<{ section: Section; direction: "up" | "down" | null }>({ section: "recording", direction: null });
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
   const { draft, write, status, error: saveError, retry } = useSettingsAutosave(state.preferences);
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
      const element = target.section === "collection" ? collectionFolder.current : gameSearch.current;
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
   const qualityError = customQualityError(draft);
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
               {sections.map((item) => (
                  <button
                     key={item.id}
                     className={`sidebar-item ${section === item.id ? "selected" : ""}`}
                     aria-current={section === item.id ? "page" : undefined}
                     onClick={() => void switchSection(item.id)}
                  >
                     <item.icon size={17} />
                     {item.label}
                  </button>
               ))}
            </div>
            <div className="settings-sidebar-bottom">
               <span>AcroClip {state.version}</span>
            </div>
         </aside>
         <PaneDivider label="Settings sidebar width" pane={sidebar} />
         <div className="settings-main" key={section} ref={content}>
            <header className="settings-heading">
               <h1>{title}</h1>
            </header>
            <div className="settings-scroll">
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
                           <Field label="Clip length" detail="Save this much recent footage when you clip.">
                              <NumberInput
                                 min={5}
                                 max={1800}
                                 value={draft.clipSeconds}
                                 aria-label="Clip length in seconds"
                                 onValueChange={(value) => change("clipSeconds", value)}
                                 unit="seconds"
                              />
                           </Field>
                           <Toggle
                              checked={draft.avoidOverlap}
                              onChange={(value) => change("avoidOverlap", value)}
                              label="Reduce clip overlap"
                              detail="Leave out footage already saved in the previous clip."
                           />
                        </section>
                     </>
                  )}
                  {section === "shortcuts" && (
                     <>
                        {[
                           {
                              title: "Recording",
                              detail: "Global shortcuts work in the tray. Stopping clears unsaved recent footage.",
                              items: shortcutRegistry.filter((item) => item.scope === "global"),
                           },
                           {
                              title: "Navigation",
                              detail: "While AcroClip is open.",
                              items: shortcutRegistry.filter((item) => item.scope === "local" && item.page === "all"),
                           },
                           { title: "Library", detail: "While browsing the Library.", items: shortcutRegistry.filter((item) => item.page === "library") },
                           { title: "Player", detail: "While a clip is open.", items: shortcutRegistry.filter((item) => item.page === "viewer") },
                        ].map((group) => (
                           <section className="settings-group" key={group.title}>
                              <h2>{group.title}</h2>
                              <p className="section-description">{group.detail}</p>
                              {group.items.map((item) => (
                                 <Field key={item.id} label={item.label}>
                                    <ShortcutInput
                                       label={item.id === "saveClip" ? "Clip shortcut" : `${item.label} shortcut`}
                                       value={bindingFor(draft, item.id)}
                                       onChange={(value) =>
                                          item.id === "saveClip" ? change("shortcut", value) : change("shortcuts", { ...draft.shortcuts, [item.id]: value })
                                       }
                                    />
                                 </Field>
                              ))}
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
                                       <code>{previewFilename(draft, "Desktop", new Date("2026-10-08T19:42:10Z"))}</code>
                                    </div>
                                 </>
                              )}
                           </div>
                        </fieldset>
                        <section className="settings-group">
                           <h2>Sharables</h2>
                           <Field label="Default maximum size" detail="You can choose a different limit for each clip.">
                              <NumberInput
                                 min={1}
                                 max={2000}
                                 value={draft.shareSizeMB}
                                 aria-label="Default shareable size in MB"
                                 onValueChange={(value) => change("shareSizeMB", value)}
                                 unit="MB"
                              />
                              <div className="size-presets">
                                 {[10, 20, 50, 100].map((size) => (
                                    <button
                                       className={draft.shareSizeMB === size ? "selected" : ""}
                                       aria-pressed={draft.shareSizeMB === size}
                                       key={size}
                                       onClick={() => change("shareSizeMB", size)}
                                    >
                                       {size} MB
                                    </button>
                                 ))}
                              </div>
                           </Field>
                           <Toggle
                              label="Automatically create shareables"
                              detail="Compress a copy after each save. Uses extra resources while recording."
                              checked={draft.autoShare}
                              onChange={(value) => change("autoShare", value)}
                           />
                        </section>
                     </>
                  )}
                  {section === "notifications" && (
                     <>
                        <section className="settings-group">
                           <Field label="Show notifications" detail="Choose when to show a saved clip notification.">
                              <Select
                                 label="Notification visibility"
                                 value={draft.notifications}
                                 onChange={(value) => change("notifications", value as Preferences["notifications"])}
                              >
                                 <option value="everywhere">Everywhere</option>
                                 <option value="outside-fullscreen">Outside fullscreen</option>
                                 <option value="off">Off</option>
                              </Select>
                           </Field>
                           <Toggle
                              checked={draft.sound}
                              onChange={(value) => change("sound", value)}
                              label="Play a sound"
                              detail="Play a confirmation even when visual notifications are off."
                           />
                        </section>
                     </>
                  )}
                  {section === "general" && (
                     <>
                        <section className="settings-group">
                           <h2>Startup</h2>
                           <p className="section-description">Closing the window keeps AcroClip running in the tray.</p>
                           <Toggle label="Start with your computer" checked={draft.startWithOS} onChange={(value) => change("startWithOS", value)} />
                           <Toggle
                              label="Start recording when AcroClip opens"
                              detail="Use your saved source, or wait for its application to open."
                              checked={draft.autoRecord}
                              onChange={(value) => change("autoRecord", value)}
                           />
                        </section>
                        <section className="settings-group">
                           <h2>Updates</h2>
                           <Toggle
                              label="Check for updates at startup"
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
                     </>
                  )}
               </fieldset>
            </div>
            {(qualityError || (!filenameError && saveError) || locked) && (
               <div className="settings-save-feedback" role="status">
                  <span>
                     {qualityError ||
                        saveError ||
                        (recording ? "Stop recording to change recording or collection settings." : "Finish pending work before changing the collection.")}
                  </span>
                  {saveError && !filenameError && <Button onClick={retry}>Retry save</Button>}
               </div>
            )}
         </div>
      </div>
   );
}
