import { useEffect, useState } from "react";
import { WandSparkles, Pencil, Plus, SlidersVertical, Trash2 } from "lucide-react";
import type { AdditionalAudioSource, GameCandidate, Preferences } from "../../shared/types";
import { normalizeApplicationLabel } from "../../shared/application-label";
import { api, describeError, reportFeedback } from "./desktop";
import { Button, MenuCheckboxItem, MenuItem, Select } from "./ui";
import { setVerticalMixer, useVerticalMixer } from "./useVerticalMixer";
import { DialogPanel } from "./Dialog";
import { MotionList } from "./MotionList";
import { AudioMixerRow } from "./AudioMixerRow";
import { AudioFilters, filterSummary } from "./AudioFilters";
import { ApplicationIcon } from "./ApplicationIcon";
import { DropdownSelect } from "./DropdownSelect";
import { applicationChoiceName, applicationChoices, applicationKey } from "./application-choices";
export function AdditionalAudio({
   preferences,
   captureKind = preferences.sourceKind,
   captureAvailable = true,
   active,
   visible,
   issues = {},
   save,
}: {
   preferences: Preferences;
   captureKind?: Preferences["sourceKind"] | "waiting" | undefined;
   captureAvailable?: boolean;
   active: boolean;
   visible: boolean;
   /** Track problems by audio source id. Source audio uses "capture". */
   issues?: Record<string, string> | undefined;
   save: (patch: Partial<Preferences> | ((current: Preferences) => Partial<Preferences>)) => Promise<void>;
}) {
   const [open, setOpen] = useState(false),
      [editing, setEditing] = useState<string | null>(null),
      [kind, setKind] = useState<AdditionalAudioSource["kind"]>("application"),
      [candidates, setCandidates] = useState<GameCandidate[]>([]),
      [devices, setDevices] = useState<Array<{ id: string; name: string }>>([]),
      [selected, setSelected] = useState(""),
      [loading, setLoading] = useState(false),
      [saving, setSaving] = useState(false),
      [filtering, setFiltering] = useState<string | null>(null);
   const vertical = useVerticalMixer();
   const existing = preferences.audioSources.find((source) => source.id === editing);
   const filtered = preferences.audioSources.find((source) => source.id === filtering);
   const captureName = captureKind === "screen" ? "Desktop" : captureKind === "app" ? "Application" : "Source audio";
   useEffect(() => {
      if (!open || !visible || active) return;
      let cancelled = false;
      setLoading(true);
      setSelected("");
      void (async () => {
         if (kind === "source") {
            if (!cancelled) setSelected("source");
         } else if (kind === "application") {
            // Audio comes from the app's process, so each app is one choice whichever window was picked before.
            const items = applicationChoices(await api.games());
            if (!cancelled) {
               setCandidates(items);
               const previous =
                  existing?.kind === kind
                     ? items.find((item) => applicationKey(item) === applicationKey({ id: existing.sourceId, executable: existing.executable }))
                     : undefined;
               setSelected(previous?.id ?? items[0]?.id ?? "");
            }
         } else {
            const items = await api.audioDevices(kind);
            const choices = [{ id: "default", name: "Default" }, ...items.filter((item) => item.id !== "default")];
            if (!cancelled) {
               setDevices(choices);
               setSelected(existing?.kind === kind ? existing.deviceId : "default");
            }
         }
      })()
         .catch((reason) => {
            if (!cancelled) reportFeedback({ kind: "notice", error: true, chip: true, message: describeError(reason) });
         })
         .finally(() => {
            if (!cancelled) setLoading(false);
         });
      return () => {
         cancelled = true;
      };
   }, [open, kind, visible, active, editing, existing?.deviceId, existing?.executable, existing?.kind, existing?.sourceId]);
   const update = (id: string, patch: Partial<AdditionalAudioSource> | ((source: AdditionalAudioSource) => Partial<AdditionalAudioSource>)) =>
      save((current) => ({
         audioSources: current.audioSources.map((source) =>
            source.id === id ? { ...source, ...(typeof patch === "function" ? patch(source) : patch) } : source
         ),
      }));
   const submit = async () => {
      const app = kind === "application" ? candidates.find((item) => item.id === selected) : undefined,
         device = kind === "input" || kind === "output" ? devices.find((item) => item.id === selected) : undefined;
      if (kind !== "source" && !app && !device) return;
      setSaving(true);
      const item: AdditionalAudioSource = {
         id: existing?.id ?? crypto.randomUUID(),
         name:
            kind === "source"
               ? "Source audio"
               : app
                 ? applicationChoiceName(app)
                 : kind === "input" && device?.id === "default"
                   ? "Microphone"
                   : (device?.name ?? "Audio source"),
         kind,
         sourceId: app?.id ?? "",
         executable: app?.executable ?? "",
         deviceId: device?.id ?? "",
         enabled: existing?.enabled ?? true,
         volume: existing?.volume ?? 1,
         muted: existing?.muted ?? false,
         includeInMaster: existing?.includeInMaster ?? false,
         filters: existing?.filters ?? [],
      };
      try {
         await api.savePreferences({
            ...preferences,
            audioSources: editing ? preferences.audioSources.map((source) => (source.id === editing ? item : source)) : [...preferences.audioSources, item],
         });
         setOpen(false);
      } catch (reason) {
         reportFeedback({ kind: "notice", error: true, chip: true, message: describeError(reason) });
      } finally {
         setSaving(false);
      }
   };
   const show = (source?: AdditionalAudioSource) => {
      setEditing(source?.id ?? null);
      setKind(source?.kind ?? "application");
      setLoading(true);
      setOpen(true);
   };
   const renderRow = (source: AdditionalAudioSource) => (
      <AudioMixerRow
         key={source.id}
         visible={visible}
         sourceId={source.id}
         name={source.kind === "source" ? captureName : source.kind === "application" ? normalizeApplicationLabel(source.name) : source.name}
         enabled={source.enabled}
         listenAvailable={(source.kind !== "source" || captureAvailable) && !(source.kind === "input" && source.muted)}
         muted={source.muted}
         volume={source.volume}
         captureLevel={source.kind === "source"}
         active={active}
         issue={issues[source.kind === "source" ? "capture" : source.id]}
         onEnable={(enabled) => update(source.id, { enabled, muted: false })}
         onMute={() => update(source.id, (current) => ({ muted: !current.muted && current.volume > 0, volume: current.volume > 0 ? current.volume : 1 }))}
         onVolume={(volume, restore) => update(source.id, { volume: volume === 0 ? (restore > 0 ? restore : 1) : volume, muted: volume === 0 })}
         filters={source.filters.length ? { summary: filterSummary(source.filters), onOpen: () => setFiltering(source.id) } : undefined}
         options={
            <>
               <MenuItem onClick={() => setFiltering(source.id)}>
                  <WandSparkles size={15} />
                  Audio filters
               </MenuItem>
               <MenuItem disabled={active} onClick={() => show(source)}>
                  <Pencil size={15} />
                  Edit source
               </MenuItem>
               <MenuCheckboxItem checked={vertical} onClick={() => setVerticalMixer(!vertical)}>
                  <SlidersVertical size={15} />
                  Vertical mixer
               </MenuCheckboxItem>
               <MenuItem
                  danger
                  disabled={active}
                  onClick={() => save((current) => ({ audioSources: current.audioSources.filter((item) => item.id !== source.id) }))}
               >
                  <Trash2 size={15} />
                  Remove source
               </MenuItem>
            </>
         }
      />
   );
   return (
      <>
         {vertical ? (
            <div className="mixer-strips">{preferences.audioSources.map(renderRow)}</div>
         ) : (
            <MotionList
               items={preferences.audioSources}
               onReorder={
                  active
                     ? undefined
                     : (id, beforeId) =>
                          save((current) => {
                             const source = current.audioSources.find((item) => item.id === id);
                             if (!source) return {};
                             const audioSources = current.audioSources.filter((item) => item.id !== id);
                             const index = beforeId === null ? audioSources.length : audioSources.findIndex((item) => item.id === beforeId);
                             audioSources.splice(index < 0 ? audioSources.length : index, 0, source);
                             return { audioSources };
                          })
               }
            >
               {renderRow}
            </MotionList>
         )}
         {preferences.audioSources.length < 5 && (
            <Button className="audio-add" disabled={active} data-tooltip={active ? "Stop capturing to add audio sources" : undefined} onClick={() => show()}>
               <Plus size={14} />
               Add audio source
            </Button>
         )}
         {filtered && (
            <AudioFilters
               key={filtered.id}
               name={filtered.kind === "source" ? captureName : filtered.name}
               filters={filtered.filters}
               onChange={(filters) => update(filtered.id, { filters })}
               close={() => setFiltering(null)}
            />
         )}
         {open && !active && (
            <DialogPanel title={editing ? "Edit audio source" : "Add audio source"} close={() => setOpen(false)}>
               <div className="audio-source-form">
                  <Select label="Audio source type" value={kind} onChange={(value) => setKind(value as AdditionalAudioSource["kind"])}>
                     <option value="source" disabled={preferences.audioSources.some((source) => source.kind === "source" && source.id !== editing)}>
                        {captureName}
                     </option>
                     <option value="application">Application</option>
                     <option value="input">Input device</option>
                     <option value="output">Output device</option>
                  </Select>
                  <DropdownSelect
                     label="Audio source"
                     value={selected}
                     disabled={loading}
                     onChange={setSelected}
                     options={
                        kind === "source"
                           ? [{ value: "source", label: "Recorded source" }]
                           : [
                                ...(!selected ? [{ value: "", label: loading ? "Loading sources…" : "No sources available", disabled: true }] : []),
                                ...(existing?.kind === kind && kind !== "application" && !devices.some((item) => item.id === existing.deviceId)
                                   ? [{ value: existing.deviceId, label: "Selected device unavailable", disabled: true }]
                                   : []),
                                ...(kind === "application"
                                   ? candidates.map((item) => ({
                                        value: item.id,
                                        label: applicationChoiceName(item),
                                        icon: <ApplicationIcon size={16} src={item.appIcon} />,
                                     }))
                                   : devices.map((item) => ({ value: item.id, label: item.name }))),
                             ]
                     }
                  />
                  <div className="audio-source-actions">
                     <Button onClick={() => setOpen(false)}>Cancel</Button>
                     <Button
                        className="primary"
                        busy={saving}
                        disabled={loading || !selected || ((kind === "input" || kind === "output") && !devices.some((item) => item.id === selected))}
                        onClick={() => void submit()}
                     >
                        {editing ? "Save source" : "Add source"}
                     </Button>
                  </div>
               </div>
            </DialogPanel>
         )}
      </>
   );
}
