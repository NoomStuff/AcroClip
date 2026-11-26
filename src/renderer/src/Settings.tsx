import {
   AlertCircle,
   AudioLines,
   Bug,
   Check,
   ChevronRight,
   Clock3,
   Copy,
   Download,
   Eraser,
   FileArchive,
   FileText,
   FileVideo,
   FolderOpen,
   FolderTree,
   History,
   Info,
   Keyboard,
   LoaderCircle,
   PanelBottomClose,
   Power,
   Radio,
   RefreshCw,
   RotateCcw,
   Scissors,
   SearchX,
   Trash2,
} from "lucide-react";
import type { ReactNode } from "react";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { filenameFields, filenamePatterns, filenameTemplateError, filenameTemplateWarning, previewFilename } from "../../shared/filename";
import { preferenceResetCopy, resetPartCopy, resetParts } from "../../shared/maintenance";
import type { ShortcutAction } from "../../shared/shortcuts";
import { bindingFor, formatBinding, shortcutClashes, shortcutConflict, shortcutRegistry } from "../../shared/shortcuts";
import type { AppState, DiscordPresenceLevel, OverlapClips, Preferences } from "../../shared/types";
import type { Run } from "./desktop";
import { api, reportFeedback } from "./desktop";
import type { Ask, DialogRequest } from "./Dialog";
import { FolderPicker } from "./FolderPicker";
import { formatTime, timeAgo } from "./format";
import { GameManagement } from "./GameManagement";
import { PaneDivider, usePaneSize } from "./layout";
import { MotionList } from "./MotionList";
import type { NavigationLocation } from "./navigation-history";
import { initialLocation, reportLocation } from "./navigation-history";
import { NotificationSettings } from "./NotificationSettings";
import { overlapDetail } from "./overlap-copy";
import { PresetNumberInput } from "./PresetNumberInput";
import { customQualityError, QualityPresets, RecordingPresets } from "./RecordingPresets";
import { clipLengthWarning, useInstalledMemory } from "./replay-estimate";
import { SelectionIndicator } from "./SelectionIndicator";
import type { SettingGroup, SettingId, SettingSection } from "./settings-catalog";
import { searchableText, searchSettings, searchWords, sectionLabel, settingCopy, settingGroups, settingSections, startWithOSDetail } from "./settings-catalog";
import { Field, Lock, Toggle } from "./SettingsControls";
import { ShortcutInput } from "./ShortcutInput";
import { SidebarTab } from "./SidebarTab";
import { TimeInput } from "./TimeInput";
import { Button, Empty, SearchInput, Select } from "./ui";
import { noMatchTitle } from "./empty-flavor";
import { updateAction, updateDownloading, updateDownloadLabel } from "./update-action";
import { useSettingsAutosave } from "./useSettingsAutosave";
import { WarningIcon } from "./WarningIcon";

const shareSizes = [10, 20, 50, 100];
const discordPresenceDetail: Record<DiscordPresenceLevel, string> = {
   off: "Your rich presence stays untouched.",
   minimal: "Adds AcroClip rich presence to the game you're capturing.",
   full: "Oh wow! you wanna do free advertising for me? Thanks :)",
};
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
   section: "clips" | "games" | "shortcuts";
   request: number;
}
const sectionOrder = settingSections.map((item) => item.id);
const captureLockedSettings: ReadonlySet<SettingId> = new Set(["clip", "overlap", "quality", "qualityPreset"]);
const fileLockedSettings: ReadonlySet<SettingId> = new Set(["folder", "grouping", "filename"]);
export function Settings({
   state,
   run,
   ask,
   target,
   showShortcuts,
   openCapture,
}: {
   state: Pick<AppState, "preferences" | "pendingPreferences" | "recorder" | "jobs" | "update" | "version" | "platform">;
   run: Run;
   ask: Ask;
   target: SettingsTarget | null;
   showShortcuts: () => void;
   openCapture: () => void;
}) {
   const layout = useRef<HTMLDivElement>(null);
   const content = useRef<HTMLDivElement>(null);
   const searchInput = useRef<HTMLInputElement>(null);
   const sidebar = usePaneSize(layout, { key: "settings.sidebar", initial: 270, min: 210, max: 400, reserve: 520, axis: "x" });
   const [{ section, direction }, setNavigation] = useState<{ section: SettingSection; direction: "up" | "down" | null }>(() => ({
      section: settingSections.find((item) => item.id === initialLocation("settings", "essentials"))?.id ?? "essentials",
      direction: null,
   }));
   const [query, setQuery] = useState("");
   const results = useMemo(() => searchSettings(query), [query]);
   const searching = query.trim() !== "";
   const setSection = useCallback((next: SettingSection) => {
      setQuery("");
      setNavigation((current) =>
         current.section === next ? current : { section: next, direction: sectionOrder.indexOf(next) < sectionOrder.indexOf(current.section) ? "up" : "down" }
      );
   }, []);
   useEffect(() => reportLocation("settings", section), [section]);
   useEffect(() => {
      const restore = (event: Event) => {
         const next = (event as CustomEvent<NavigationLocation>).detail.settings;
         const found = settingSections.find((item) => item.id === next);
         if (found) setSection(found.id);
      };
      window.addEventListener("acroclip-restore-location", restore);
      return () => window.removeEventListener("acroclip-restore-location", restore);
   }, [setSection]);
   useEffect(() => {
      const command = (event: Event) => {
         if ((event as CustomEvent<string>).detail !== "searchSettings") return;
         searchInput.current?.focus();
         searchInput.current?.select();
      };
      window.addEventListener("acroclip-shortcut", command);
      return () => window.removeEventListener("acroclip-shortcut", command);
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
   const { draft, write, status, error: saveError, retrying, retry, flush } = useSettingsAutosave(state.preferences, state.pendingPreferences);
   const waiting = Object.keys(state.pendingPreferences) as Array<keyof Preferences>;
   const recording = ["recording", "waiting", "starting"].includes(state.recorder.state);
   const pendingWork = state.recorder.pendingSaves > 0 || state.jobs.some((job) => job.state === "running" || job.state === "queued");
   const filesLocked = recording || pendingWork;
   const locked = (id: SettingId) => (captureLockedSettings.has(id) ? recording : fileLockedSettings.has(id) ? filesLocked : false);
   // Search shows each matching group whole, so a match keeps its neighbours for context. Only the matches stay at full strength.
   const matched = searching ? new Set(results.flatMap(({ items }) => items)) : null;
   // Tabs with nothing to find fade back. Essentials counts when one of the settings it repeats matched.
   const hitSections = matched
      ? new Set<SettingSection>([
           ...results.map(({ group }) => group.section),
           ...settingGroups.filter((group) => group.items.some((id) => matched.has(id))).map((group) => group.section),
        ])
      : null;
   const shown: { id: string; group: SettingGroup; items: readonly SettingId[] }[] = (
      searching ? results.map(({ group }) => group) : settingGroups.filter((group) => group.section === section)
   ).map((group) => ({ id: group.id, group, items: group.items }));
   const lockedShown = shown.some(({ items }) => items.some(locked));
   const collectionFolder = useRef<HTMLDivElement>(null);
   const gameSearch = useRef<HTMLInputElement>(null);
   const handledNavigationRequest = useRef(0);
   const highlightTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
   const [collectionHighlighted, setCollectionHighlighted] = useState(false);
   useLayoutEffect(() => {
      if (target && target.request !== handledNavigationRequest.current) setSection(target.section);
   }, [target, setSection]);
   useLayoutEffect(() => {
      if (!target || searching || section !== target.section || target.request === handledNavigationRequest.current) return;
      const element = target.section === "clips" ? collectionFolder.current : target.section === "games" ? gameSearch.current : null;
      if (!element) return;
      handledNavigationRequest.current = target.request;
      element.scrollIntoView({ block: "center" });
      const button = target.section === "clips" ? element.querySelector<HTMLButtonElement>("button[data-choose-folder]") : null;
      (button && !button.disabled ? button : element).focus({ preventScroll: true });
      clearTimeout(highlightTimer.current);
      setCollectionHighlighted(target.section === "clips");
      highlightTimer.current = setTimeout(() => setCollectionHighlighted(false), 1600);
   }, [target, section, searching]);
   useEffect(() => () => clearTimeout(highlightTimer.current), []);
   const mac = state.platform === "darwin";
   // Clashing shortcuts are marked on their rows, so the footer does not repeat them.
   const inlineClash = shown.some(({ items }) => items.some((id) => id.startsWith("shortcut:") || id === "clip")) && shortcutConflict(draft, mac) !== null;
   const qualityError = customQualityError(draft);
   const memoryBytes = useInstalledMemory();
   const lengthWarning = clipLengthWarning(draft, memoryBytes);
   const filenamePattern = draft.filenamePreset === "custom" ? draft.filenameTemplate : filenamePatterns[draft.filenamePreset];
   const filenameError = filenameTemplateError(filenamePattern);
   const change = <K extends keyof Preferences>(key: K, value: Preferences[K]) => write({ ...draft, [key]: value });
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
            detail: "Your collection folder, clips, tags and stats stay. This can't be undone.",
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
            const reset = parts.settings && parts.setup ? "Settings and capture setup" : parts.settings ? "Settings" : "Capture setup";
            reportFeedback({ kind: "notice", message: `${reset} reset`, error: false, tone: "success" });
         }
      );
   const clearCache = () =>
      maintain(
         "cache",
         {
            title: "Clear the cache?",
            detail: "Thumbnails, hover previews and playback copies rebuild in the background. On a big library that takes a while.",
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
            detail: "AcroClip restarts afterwards. Your clips, tags and shareables aren't touched.",
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
   const shortcutRow = (id: ShortcutAction) => {
      const item = shortcutRegistry.find((entry) => entry.id === id)!;
      const clashes = shortcutClashes(draft, id, mac);
      return (
         <Field
            icon={Keyboard}
            label={item.label}
            className={clashes.length ? "shortcut-clash" : ""}
            {...(clashes.length ? { detail: `Also used by ${clashes.join(" and ")}` } : {})}
         >
            <ShortcutInput
               clash={clashes.length > 0}
               global={item.scope === "global"}
               label={id === "saveClip" ? "Clip shortcut" : `${item.label} shortcut`}
               value={bindingFor(draft, id)}
               onChange={(value) => (id === "saveClip" ? change("shortcut", value) : change("shortcuts", { ...draft.shortcuts, [id]: value }))}
            />
         </Field>
      );
   };
   const clipDetail = () => {
      const clashes = shortcutClashes(draft, "saveClip", mac);
      if (clashes.length) return `The shortcut is also used by ${clashes.join(" and ")}.`;
      const length = formatTime(draft.clipSeconds);
      return draft.shortcut
         ? `Press ${formatBinding(draft.shortcut, mac)} in any app to save the last ${length}.`
         : `Set a shortcut to save the last ${length} from any app.`;
   };
   const setting = (id: SettingId): ReactNode => {
      if (id.startsWith("shortcut:")) return shortcutRow(id.slice("shortcut:".length) as ShortcutAction);
      switch (id as Exclude<SettingId, `shortcut:${string}`>) {
         case "clip": {
            const clashes = shortcutClashes(draft, "saveClip", mac);
            return (
               <Field icon={Clock3} label={settingCopy.clip.label} detail={clipDetail()} className={clashes.length ? "shortcut-clash" : ""}>
                  <div className="clip-combo">
                     <Lock locked={recording}>
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
                     </Lock>
                     <ShortcutInput
                        global
                        clash={clashes.length > 0}
                        label="Clip shortcut"
                        value={draft.shortcut}
                        onChange={(value) => change("shortcut", value)}
                     />
                  </div>
               </Field>
            );
         }
         case "overlap":
            return (
               <Field icon={Scissors} label={settingCopy.overlap.label} detail={overlapDetail(draft.overlapClips, draft.clipSeconds)} disabled={recording}>
                  <Select label={settingCopy.overlap.label} value={draft.overlapClips} onChange={(value) => change("overlapClips", value as OverlapClips)}>
                     <option value="keep">Save normally</option>
                     <option value="trim">Save what's new</option>
                     <option value="merge">Extend previous clip</option>
                  </Select>
               </Field>
            );
         case "quality":
            return (
               <Lock locked={recording}>
                  <div className="settings-quality">
                     <RecordingPresets
                        compact
                        value={draft}
                        onChange={(next) => {
                           if (!recording) write(next);
                        }}
                     />
                  </div>
               </Lock>
            );
         case "qualityPreset":
            return (
               <Lock locked={recording}>
                  <div className="settings-quality">
                     <QualityPresets
                        value={draft}
                        onChange={(next) => {
                           if (!recording) write(next);
                        }}
                     />
                  </div>
               </Lock>
            );
         case "sources":
            return (
               <Field icon={AudioLines} label={settingCopy.sources.label} detail={settingCopy.sources.detail}>
                  <Button onClick={openCapture}>
                     Open
                     <ChevronRight size={15} aria-hidden="true" />
                  </Button>
               </Field>
            );
         case "autoRecord":
            return (
               <Toggle
                  icon={FileVideo}
                  label={settingCopy.autoRecord.label}
                  detail={settingCopy.autoRecord.detail}
                  checked={draft.autoRecord}
                  onChange={(value) => change("autoRecord", value)}
               />
            );
         case "games":
            return <GameManagement preferences={draft} searchRef={gameSearch} change={(customGames) => write({ ...draft, customGames })} />;
         case "folder":
            return (
               <FolderPicker
                  path={draft.collection}
                  ref={collectionFolder}
                  className="settings-surface"
                  disabled={filesLocked}
                  navigationHighlighted={collectionHighlighted}
                  onChoose={() => void chooseFolder()}
                  revealDisabled={draft.collection !== state.preferences.collection}
                  onReveal={() => void run(() => api.reveal(state.preferences.collection))}
               />
            );
         case "grouping":
            return (
               <Toggle
                  icon={FolderTree}
                  label={settingCopy.grouping.label}
                  detail={settingCopy.grouping.detail}
                  checked={draft.folderLayout === "application"}
                  disabled={filesLocked}
                  onChange={(enabled) => change("folderLayout", enabled ? "application" : "flat")}
               />
            );
         case "filename":
            return (
               <fieldset className="settings-surface settings-filename-row" disabled={filesLocked}>
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
                     <div className="filename-preview">
                        <span>Example</span>
                        <code>{previewFilename(draft, "Desktop", new Date(2026, 9, 8, 19, 42, 10))}</code>
                     </div>
                  )}
               </fieldset>
            );
         case "shareSize":
            return (
               <Field icon={FileVideo} label={settingCopy.shareSize.label} detail={settingCopy.shareSize.detail}>
                  <PresetNumberInput
                     label={settingCopy.shareSize.label}
                     inputLabel="Shareable size in MB"
                     presets={shareSizes}
                     presetLabel={(size) => `${size} MB`}
                     min={1}
                     max={2000}
                     value={draft.shareSizeMB}
                     unit="MB"
                     onValueChange={(value) => change("shareSizeMB", value)}
                  />
               </Field>
            );
         case "autoShare":
            return (
               <Toggle
                  icon={Copy}
                  label={settingCopy.autoShare.label}
                  detail={settingCopy.autoShare.detail}
                  checked={draft.autoShare}
                  onChange={(value) => change("autoShare", value)}
               />
            );
         case "discord":
            return (
               <Field icon={Radio} label={settingCopy.discord.label} detail={discordPresenceDetail[draft.discordPresence]}>
                  <Select
                     label={settingCopy.discord.label}
                     value={draft.discordPresence}
                     onChange={(value) => change("discordPresence", value as DiscordPresenceLevel)}
                  >
                     <option value="off">Off</option>
                     <option value="minimal">Minimal</option>
                     <option value="full">Full</option>
                  </Select>
               </Field>
            );
         case "notifications":
            return <NotificationSettings value={draft} onChange={(key, enabled) => change(key, enabled)} />;
         case "startWithOS":
            return (
               <Toggle
                  icon={Power}
                  label={settingCopy.startWithOS.label}
                  detail={startWithOSDetail(state.platform)}
                  checked={draft.startWithOS}
                  onChange={(value) => change("startWithOS", value)}
               />
            );
         case "startInTray":
            return (
               <Toggle
                  icon={PanelBottomClose}
                  label={settingCopy.startInTray.label}
                  detail={settingCopy.startInTray.detail}
                  checked={draft.startInTray}
                  disabled={!draft.startWithOS}
                  onChange={(value) => change("startInTray", value)}
               />
            );
         case "updates":
            return (
               <>
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
               </>
            );
         case "reportBug":
            return (
               <Field icon={Bug} label={settingCopy.reportBug.label} detail={settingCopy.reportBug.detail}>
                  <Button busy={exporting === "report"} disabled={!!exporting} onClick={() => exportLogs("report")}>
                     Open report
                  </Button>
               </Field>
            );
         case "exportLogs":
            return (
               <Field icon={FileArchive} label={settingCopy.exportLogs.label} detail={settingCopy.exportLogs.detail}>
                  <Button busy={exporting === "export"} disabled={!!exporting} onClick={() => exportLogs("export")}>
                     Export
                  </Button>
               </Field>
            );
         case "resetSettings":
            return (
               <Field icon={RotateCcw} label={settingCopy.resetSettings.label} detail={settingCopy.resetSettings.detail}>
                  <Button className="destructive" busy={maintaining === "settings"} disabled={!!maintaining} onClick={resetSettings}>
                     Reset settings
                  </Button>
               </Field>
            );
         case "clearCache":
            return (
               <Field icon={Eraser} label={settingCopy.clearCache.label} detail={settingCopy.clearCache.detail}>
                  <Button className="destructive" busy={maintaining === "cache"} disabled={!!maintaining} onClick={clearCache}>
                     Clear cache
                  </Button>
               </Field>
            );
         case "clearHistory":
            return (
               <Field icon={History} label={settingCopy.clearHistory.label} detail={settingCopy.clearHistory.detail}>
                  <Button className="destructive" busy={maintaining === "history"} disabled={!!maintaining} onClick={clearHistory}>
                     Clear history
                  </Button>
               </Field>
            );
         case "factoryReset":
            return (
               <Field icon={Trash2} label={settingCopy.factoryReset.label} detail={settingCopy.factoryReset.detail}>
                  <Button className="destructive" busy={maintaining === "factory"} disabled={!!maintaining} onClick={factoryReset}>
                     Reset…
                  </Button>
               </Field>
            );
         case "shortcutSheet":
            return (
               <Field
                  icon={Keyboard}
                  label={settingCopy.shortcutSheet.label}
                  detail={`Every shortcut on one screen. Press ${formatBinding(bindingFor(draft, "shortcutHelp"), mac)} to open it from anywhere.`}
               >
                  <Button onClick={showShortcuts}>Show all</Button>
               </Field>
            );
      }
   };
   const group = ({ group, items }: { group: SettingGroup; items: readonly SettingId[] }) => {
      const title = searching ? [sectionLabel(group.section), group.title].filter(Boolean).join(" · ") : group.title;
      const more = searching ? group.section : group.more;
      return (
         <section className={`settings-group${group.danger ? " settings-danger" : ""}`} key={group.id}>
            {(title || more) && (
               <div className="settings-group-heading">
                  {title && <h2>{title}</h2>}
                  {more && (
                     <button type="button" className="settings-more" onClick={() => setSection(more)}>
                        {searching ? `Open ${sectionLabel(more)}` : `More in ${sectionLabel(more)}`}
                        <ChevronRight size={14} aria-hidden="true" />
                     </button>
                  )}
               </div>
            )}
            {group.detail && <p className="section-description">{group.detail}</p>}
            {items.map((id) => (
               <div className="settings-item" key={id} data-setting={id} data-unmatched={(matched && !matched.has(id)) || undefined}>
                  {setting(id)}
               </div>
            ))}
         </section>
      );
   };
   // Marks what was typed without touching the DOM React owns. Only text search actually read lights up, so a word in a
   // heading or a button that only shares the letters stays plain.
   useLayoutEffect(() => {
      const body = content.current?.querySelector(".settings-body");
      const words = searchWords(query);
      if (!words.length || !body) {
         CSS.highlights.delete("settings-search");
         return;
      }
      const ranges: Range[] = [];
      for (const item of body.querySelectorAll<HTMLElement>('.settings-item:not([data-unmatched]):not([aria-hidden="true"] *)')) {
         const id = item.dataset["setting"] as SettingId | undefined;
         if (!id) continue;
         const known = new Set(searchableText(id).map((text) => text.toLowerCase()));
         const walker = document.createTreeWalker(item, NodeFilter.SHOW_TEXT);
         for (let node = walker.nextNode(); node; node = walker.nextNode()) {
            const text = (node.textContent ?? "").toLowerCase();
            if (!known.has(text.trim())) continue;
            for (const word of words)
               for (let index = text.indexOf(word); index >= 0; index = text.indexOf(word, index + word.length)) {
                  // Search matches the start of words, so the highlight does too.
                  if (index > 0 && /[\p{L}\p{N}]/u.test(text[index - 1]!)) continue;
                  const range = new Range();
                  range.setStart(node, index);
                  range.setEnd(node, index + word.length);
                  ranges.push(range);
               }
         }
      }
      CSS.highlights.set("settings-search", new Highlight(...ranges));
   });
   useEffect(
      () => () => {
         CSS.highlights.delete("settings-search");
      },
      []
   );
   const title = searching ? "Search" : sectionLabel(section);
   return (
      <div className="settings-page" ref={layout}>
         <aside className="settings-sidebar" style={{ width: sidebar.size }}>
            <div className="settings-sidebar-heading">
               <SearchInput
                  label="Search settings"
                  className="settings-search"
                  value={query}
                  onChange={setQuery}
                  inputRef={searchInput}
                  onKeyDown={(event) => {
                     if (event.key === "Escape" && query) {
                        event.preventDefault();
                        setQuery("");
                     } else if (event.key === "Enter" && searching) {
                        event.preventDefault();
                        content.current
                           ?.querySelector<HTMLElement>(".settings-item:not([data-unmatched]) :is(input, button, [tabindex='0']):not(:disabled)")
                           ?.focus();
                     }
                  }}
               />
            </div>
            <div className="settings-nav moving-selection">
               <SelectionIndicator value={searching ? "search" : section} />
               <MotionList items={settingSections}>
                  {(item) => (
                     <SidebarTab
                        key={item.id}
                        icon={<item.icon size={17} />}
                        label={item.label}
                        selection="page"
                        selected={!searching && section === item.id}
                        rowAttributes={{ "data-search-miss": (hitSections && !hitSections.has(item.id)) || undefined }}
                        onSelect={() => setSection(item.id)}
                     />
                  )}
               </MotionList>
            </div>
            <div className="settings-sidebar-bottom">
               <span>AcroClip {state.version}</span>
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
            </div>
         </aside>
         <PaneDivider label="Settings sidebar width" pane={sidebar} />
         <div className="settings-main" key={section} ref={content}>
            <div className="settings-scroll">
               <header className="settings-heading">
                  <h1>{title}</h1>
               </header>
               <div className="settings-body">
                  {searching && !results.length && (
                     <Empty
                        floating
                        icon={<SearchX size={38} />}
                        title={noMatchTitle(query.trim())}
                        detail="Search looks at setting names, their choices and descriptions."
                     />
                  )}
                  <MotionList items={shown} identity={section}>
                     {group}
                  </MotionList>
               </div>
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
                  (lockedShown
                     ? recording
                        ? "Stop capturing to change capture or file settings."
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
