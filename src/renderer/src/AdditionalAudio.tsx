import { useEffect, useState } from "react";
import { Plus } from "lucide-react";
import type { AdditionalAudioSource, GameCandidate, Preferences } from "../../shared/types";
import { api, describeError, reportFeedback } from "./desktop";
import { Button, MenuItem, Select } from "./ui";
import { DialogPanel } from "./Dialog";
import { AudioMixerRow } from "./AudioMixerRow";
export function AdditionalAudio({
   preferences,
   captureAvailable = true,
   active,
   visible,
   save,
}: {
   preferences: Preferences;
   captureAvailable?: boolean;
   active: boolean;
   visible: boolean;
   save: (patch: Partial<Preferences> | ((current: Preferences) => Partial<Preferences>)) => Promise<void>;
}) {
   const [open, setOpen] = useState(false),
      [editing, setEditing] = useState<string | null>(null),
      [kind, setKind] = useState<AdditionalAudioSource["kind"]>("application"),
      [candidates, setCandidates] = useState<GameCandidate[]>([]),
      [devices, setDevices] = useState<Array<{ id: string; name: string }>>([]),
      [selected, setSelected] = useState(""),
      [loading, setLoading] = useState(false),
      [saving, setSaving] = useState(false);
   const existing = preferences.audioSources.find((source) => source.id === editing);
   useEffect(() => {
      if (!open || !visible || active) return;
      let cancelled = false;
      setLoading(true);
      setSelected("");
      void (async () => {
         if (kind === "source") {
            if (!cancelled) setSelected("source");
         } else if (kind === "application") {
            const items = await api.games();
            if (!cancelled) {
               setCandidates(items);
               setSelected(existing?.kind === kind ? existing.sourceId : (items[0]?.id ?? ""));
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
            if (!cancelled) reportFeedback({ kind: "notice", error: true, message: describeError(reason) });
         })
         .finally(() => {
            if (!cancelled) setLoading(false);
         });
      return () => {
         cancelled = true;
      };
   }, [open, kind, visible, active, editing, existing?.deviceId, existing?.kind, existing?.sourceId]);
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
               : (app?.gameName ?? app?.name ?? (kind === "input" && device?.id === "default" ? "Microphone" : (device?.name ?? "Audio source"))),
         kind,
         sourceId: app?.id ?? "",
         executable: app?.executable ?? "",
         deviceId: device?.id ?? "",
         enabled: existing?.enabled ?? true,
         volume: existing?.volume ?? 1,
         muted: existing?.muted ?? false,
         includeInMaster: existing?.includeInMaster ?? false,
      };
      try {
         await api.savePreferences({
            ...preferences,
            audioSources: editing ? preferences.audioSources.map((source) => (source.id === editing ? item : source)) : [...preferences.audioSources, item],
         });
         setOpen(false);
      } catch (reason) {
         reportFeedback({ kind: "notice", error: true, message: describeError(reason) });
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
   return (
      <>
         {preferences.audioSources.map((source) => (
            <AudioMixerRow
               key={source.id}
               visible={visible}
               sourceId={source.id}
               name={source.name}
               enabled={source.enabled}
               listenAvailable={(source.kind !== "source" || captureAvailable) && !(source.kind === "input" && source.muted)}
               muted={source.muted}
               volume={source.volume}
               captureLevel={source.kind === "source"}
               active={active}
               onEnable={(enabled) => update(source.id, { enabled, muted: false })}
               onMute={() => update(source.id, (current) => ({ muted: !current.muted && current.volume > 0, volume: current.volume > 0 ? current.volume : 1 }))}
               onVolume={(volume, restore) => update(source.id, { volume: volume === 0 ? (restore > 0 ? restore : 1) : volume, muted: volume === 0 })}
               options={
                  <>
                     <MenuItem disabled={active} onClick={() => show(source)}>
                        Edit source
                     </MenuItem>
                     <MenuItem
                        disabled={active}
                        onClick={() => save((current) => ({ audioSources: current.audioSources.filter((item) => item.id !== source.id) }))}
                     >
                        Remove source
                     </MenuItem>
                  </>
               }
            />
         ))}
         {preferences.audioSources.length < 5 && (
            <Button className="audio-add" disabled={active} title={active ? "Stop recording to add audio sources" : undefined} onClick={() => show()}>
               <Plus size={14} />
               Add audio source
            </Button>
         )}
         {open && !active && (
            <DialogPanel title={editing ? "Edit audio source" : "Add audio source"} close={() => setOpen(false)}>
               <div className="audio-source-form">
                  <Select label="Audio source type" value={kind} onChange={(value) => setKind(value as AdditionalAudioSource["kind"])}>
                     <option value="source" disabled={preferences.audioSources.some((source) => source.kind === "source" && source.id !== editing)}>
                        Source audio
                     </option>
                     <option value="application">Application</option>
                     <option value="input">Input device</option>
                     <option value="output">Output device</option>
                  </Select>
                  <Select label="Audio source" value={selected} disabled={loading} onChange={setSelected}>
                     {kind === "source" ? (
                        <option value="source">Recorded source</option>
                     ) : (
                        <>
                           <option value="">{loading ? "Loading sources…" : "Choose a source"}</option>
                           {existing?.kind === kind && kind !== "application" && !devices.some((item) => item.id === existing.deviceId) && (
                              <option value={existing.deviceId} disabled>
                                 Selected device unavailable
                              </option>
                           )}
                           {(kind === "application" ? candidates : devices).map((item) => (
                              <option key={item.id} value={item.id}>
                                 {item.name}
                              </option>
                           ))}
                        </>
                     )}
                  </Select>
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
