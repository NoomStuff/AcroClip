import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { AlertCircle, Bell, Check, Download, Folder, Gamepad2, Keyboard, LoaderCircle, RefreshCw, Settings2, Share2, Video } from "lucide-react";
import type { AppState, Preferences } from "../../shared/types";
import { useSettingsAutosave } from "./useSettingsAutosave";
import { previewFilename, validFilenameTemplate } from "../../shared/filename";
import { SelectionIndicator } from "./SelectionIndicator";
import { HeaderActions, Button, Field, Select, Toggle } from "./ui";
import { api } from "./desktop";
import type { Run } from "./desktop";
import { RecordingPresets, customQualityError } from "./RecordingPresets";
import { shortcutRegistry, bindingFor } from "../../shared/shortcuts";
import { ShortcutInput } from "./ShortcutInput";
import { GameManagement } from "./GameManagement";
import { PaneDivider, usePaneSize } from "./layout";
import { FolderPicker } from "./FolderPicker";

const sections = [
   { id: "recording", label: "Recording", icon: Video },
   { id: "shortcuts", label: "Shortcuts", icon: Keyboard },
   { id: "games", label: "Games", icon: Gamepad2 },
   { id: "collection", label: "Collection", icon: Folder },
   { id: "sharing", label: "Sharing", icon: Share2 },
   { id: "notifications", label: "Notifications", icon: Bell },
   { id: "general", label: "App & updates", icon: Settings2 },
] as const;
type Section = (typeof sections)[number]["id"];
const filenamePatterns = { "source-date": "{source} {date}T{time}", "date-source": "{date}T{time} {source}" } as const;
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
            <label htmlFor="filename-pattern">File name</label>
            <Select label="Filename preset" value={preset} onChange={(next) => onPreset(next as Preferences["filenamePreset"])}>
               <option value="source-date">App + date</option>
               <option value="date-source">Date + app</option>
               <option value="custom">Custom</option>
            </Select>
         </div>
         <input
            id="filename-pattern"
            aria-label="Name pattern"
            ref={input}
            defaultValue={value}
            onInput={(event) => onChange(event.currentTarget.value)}
            maxLength={160}
            spellCheck={false}
         />
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
export function Settings({ state, run, target }: { state: AppState; run: Run; target: SettingsTarget | null }) {
   const layout = useRef<HTMLDivElement>(null);
   const sidebar = usePaneSize(layout, { key: "settings.sidebar", initial: 245, min: 210, max: 380, reserve: 520, axis: "x" });
   const [section, setSection] = useState<Section>("recording");
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
   }, [target]);
   useLayoutEffect(() => {
      if (!target || section !== target.section || target.request === handledNavigationRequest.current) return;
      const element = target.section === "collection" ? collectionFolder.current : gameSearch.current;
      if (!element) return;
      handledNavigationRequest.current = target.request;
      element.scrollIntoView({ block: "center" });
      const button = target.section === "collection" ? element.querySelector<HTMLButtonElement>("button") : null;
      (button && !button.disabled ? button : element).focus({ preventScroll: true });
      clearTimeout(highlightTimer.current);
      setCollectionHighlighted(target.section === "collection");
      highlightTimer.current = setTimeout(() => setCollectionHighlighted(false), 1600);
   }, [target, section]);
   useEffect(() => () => clearTimeout(highlightTimer.current), []);
   const qualityError = customQualityError(draft);
   const filenameError =
      draft.filenamePreset === "custom" && !validFilenameTemplate(draft.filenameTemplate)
         ? draft.filenameTemplate.trim()
            ? "Use supported fields and leave out folder paths."
            : "Enter a filename pattern."
         : "";
   const change = <K extends keyof Preferences>(key: K, value: Preferences[K]) => write({ ...draft, [key]: value });
   const switchSection = (id: Section) => setSection(id);
   const chooseFolder = async () => {
      await run(async () => {
         const path = await api.chooseFolder();
         if (path) change("collection", path);
      });
   };
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
         <div className="settings-main">
            <header className="settings-heading">
               <h1>{title}</h1>
            </header>
            <div className="settings-scroll">
               <fieldset className="settings-body" disabled={locked}>
                  {section === "recording" && (
                     <>
                        <h2>Recording presets</h2>
                        <RecordingPresets
                           value={draft}
                           onChange={(next) => {
                              if (!locked) write(next);
                           }}
                        />
                        <h2>Recent footage</h2>
                        <Field label="Clip length">
                           <div className="number-unit">
                              <input
                                 type="number"
                                 min={5}
                                 max={1800}
                                 value={Number.isNaN(draft.clipSeconds) ? "" : draft.clipSeconds}
                                 aria-label="Clip length in seconds"
                                 onChange={(event) => change("clipSeconds", event.target.value === "" ? Number.NaN : Number(event.target.value))}
                              />
                              <span>seconds</span>
                           </div>
                        </Field>
                        <Toggle checked={draft.avoidOverlap} onChange={(value) => change("avoidOverlap", value)} label="Reduce clip overlap" />
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
                           { title: "Clip viewer", detail: "While a clip is open.", items: shortcutRegistry.filter((item) => item.page === "viewer") },
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
                        <h2>Known games</h2>
                        <GameManagement preferences={draft} searchRef={gameSearch} change={(customGames) => write({ ...draft, customGames })} />
                     </>
                  )}
                  {section === "collection" && (
                     <>
                        <h2>Collection folder</h2>
                        <FolderPicker
                           path={draft.collection}
                           ref={collectionFolder}
                           navigationHighlighted={collectionHighlighted}
                           onChoose={() => void chooseFolder()}
                           revealDisabled={draft.collection !== state.preferences.collection}
                           onReveal={() => void run(() => api.reveal(state.preferences.collection))}
                        />
                        <h2>New recordings</h2>
                        <Field label="Folder layout" detail="Only affects future clips. Existing files aren't reorganized.">
                           <Select
                              label="Folder layout"
                              value={draft.folderLayout}
                              onChange={(value) => change("folderLayout", value as Preferences["folderLayout"])}
                           >
                              <option value="flat">Single folder</option>
                              <option value="application">Application folders</option>
                           </Select>
                        </Field>
                        <FilenameEditor
                           preset={draft.filenamePreset}
                           value={draft.filenamePreset === "custom" ? draft.filenameTemplate : filenamePatterns[draft.filenamePreset]}
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
                        <div className="filename-preview">
                           <span>{filenameError ? "Check pattern" : "Example"}</span>
                           {filenameError ? (
                              <span className="filename-error">{filenameError}</span>
                           ) : (
                              <code>{previewFilename(draft, "Desktop", new Date("2026-10-08T19:42:10Z"))}</code>
                           )}
                        </div>
                     </>
                  )}
                  {section === "sharing" && (
                     <>
                        <p className="section-description">Shareables use the full clip and master audio mix.</p>
                        <Field label="Default maximum size" detail="Override this for individual clips in the viewer.">
                           <div className="number-unit">
                              <input
                                 type="number"
                                 min={1}
                                 max={2000}
                                 value={Number.isNaN(draft.shareSizeMB) ? "" : draft.shareSizeMB}
                                 aria-label="Default shareable size in MB"
                                 onChange={(event) => change("shareSizeMB", event.target.value === "" ? Number.NaN : Number(event.target.value))}
                              />
                              <span>MB</span>
                           </div>
                        </Field>
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
                        <Toggle
                           label="Automatically create shareables"
                           detail="Create a copy after each clip saves. Compression uses extra resources during recording."
                           checked={draft.autoShare}
                           onChange={(value) => change("autoShare", value)}
                        />
                     </>
                  )}
                  {section === "notifications" && (
                     <>
                        <h2>When a clip saves</h2>
                        <Field label="Show notifications">
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
                           detail="Independent of visual notifications."
                        />
                     </>
                  )}
                  {section === "general" && (
                     <>
                        <h2>Startup</h2>
                        <p className="section-description">Closing the window keeps AcroClip running in the tray.</p>
                        <Toggle label="Start with your computer" checked={draft.startWithOS} onChange={(value) => change("startWithOS", value)} />
                        <Toggle
                           label="Start recording when AcroClip opens"
                           detail="Uses your saved source. Application capture waits if its target is unavailable."
                           checked={draft.autoRecord}
                           onChange={(value) => change("autoRecord", value)}
                        />
                        <h2>Updates</h2>
                        <Toggle
                           label="Check for updates at startup"
                           detail="Look for new releases when AcroClip starts. You can check manually below."
                           checked={draft.updateCheck}
                           onChange={(updateCheck) => change("updateCheck", updateCheck)}
                        />

                        <div className="update-panel">
                           <div>
                              <strong>AcroClip {state.version}</strong>
                              <span className="update-message" title={state.update.message}>
                                 {state.update.state === "idle" && state.update.lastChecked
                                    ? `Last checked ${new Date(state.update.lastChecked).toLocaleString([], { dateStyle: "short", timeStyle: "short" })}`
                                    : state.update.message || "Not checked yet"}
                              </span>
                           </div>
                           {["ready", "available", "downloaded"].includes(state.update.state) ||
                           (state.update.state === "error" && state.update.mode && state.update.version) ? (
                              <Button
                                 className="primary"
                                 onClick={() =>
                                    void run(() =>
                                       state.update.state === "ready"
                                          ? api.installUpdate()
                                          : state.update.state === "downloaded"
                                            ? api.revealUpdate()
                                            : state.update.mode === "download"
                                              ? api.downloadUpdate()
                                              : api.openUpdateRelease()
                                    )
                                 }
                              >
                                 <Download size={16} />
                                 {state.update.state === "ready"
                                    ? "Apply and restart"
                                    : state.update.state === "downloaded"
                                      ? "Show in Downloads"
                                      : state.update.mode === "download"
                                        ? state.update.state === "error"
                                           ? "Retry download"
                                           : "Download update"
                                        : "View release"}
                              </Button>
                           ) : (
                              <Button
                                 busy={["checking", "downloading"].includes(state.update.state)}
                                 busyIndicator="content"
                                 onClick={() => void run(() => api.checkUpdate())}
                              >
                                 <RefreshCw size={15} className={state.update.state === "checking" ? "spin" : undefined} />
                                 {state.update.state === "downloading"
                                    ? state.update.indeterminate
                                       ? "Downloading"
                                       : `${Math.round(state.update.progress)}%`
                                    : "Check for updates"}
                              </Button>
                           )}
                        </div>
                     </>
                  )}
               </fieldset>
            </div>
            {(qualityError || filenameError || saveError || locked) && (
               <div className="settings-save-feedback" role="status">
                  <span>
                     {qualityError ||
                        filenameError ||
                        saveError ||
                        (recording ? "Stop recording to change recording or collection settings." : "Finish pending work before changing the collection.")}
                  </span>
                  {saveError && <Button onClick={retry}>Retry save</Button>}
               </div>
            )}
         </div>
      </div>
   );
}
