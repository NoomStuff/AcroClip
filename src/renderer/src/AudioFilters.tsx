import { useEffect, useRef, useState } from "react";
import { AudioWaveform, MoreHorizontal, Plus, Power, PowerOff, Trash2, WandSparkles } from "lucide-react";
import {
   audioFilterDefinitions,
   audioFilterKinds,
   createAudioFilter,
   maxAudioFilters,
   type AudioFilter,
   type AudioFilterKind,
} from "../../shared/audio-filters";
import { DialogPanel } from "./Dialog";
import { MotionList } from "./MotionList";
import { Slider } from "./Slider";
import { ContextHeader, Menu, MenuItem, Segmented, type ContextMenuRequest } from "./ui";
import "./AudioFilters.css";

export function filterSummary(filters: readonly AudioFilter[]): string {
   const active = filters.filter((filter) => filter.enabled);
   if (!filters.length) return "No filters";
   if (!active.length) return `${filters.length} ${filters.length === 1 ? "filter" : "filters"} off`;
   return active.map((filter) => audioFilterDefinitions[filter.kind].label).join(", ");
}

// Edits apply to capture as they are committed. Slider drags stay local until release.
export function AudioFilters({
   name,
   filters,
   onChange,
   close,
}: {
   name: string;
   filters: AudioFilter[];
   onChange: (filters: AudioFilter[]) => Promise<void>;
   close: () => void;
}) {
   const [chain, setChain] = useState(filters);
   const [selectedId, setSelectedId] = useState<string | null>(filters[0]?.id ?? null);
   const [contextMenu, setContextMenu] = useState<(ContextMenuRequest & { id: string }) | null>(null);
   const latest = useRef(chain);
   latest.current = chain;
   const body = useRef<HTMLDivElement>(null);
   const stored = JSON.stringify(filters);
   useEffect(() => {
      setChain(JSON.parse(stored) as AudioFilter[]);
   }, [stored]);
   const selected = chain.find((filter) => filter.id === selectedId) ?? chain[0];
   const commit = (next: AudioFilter[]) => {
      setChain(next);
      latest.current = next;
      onChange(next).catch(() => setChain(JSON.parse(stored) as AudioFilter[]));
   };
   const change = (id: string, patch: Partial<AudioFilter> | ((filter: AudioFilter) => Partial<AudioFilter>)) =>
      latest.current.map((filter) => (filter.id === id ? { ...filter, ...(typeof patch === "function" ? patch(filter) : patch) } : filter));
   const setting = (id: string, key: string, value: number | string) => change(id, (filter) => ({ settings: { ...filter.settings, [key]: value } }));
   const remove = (id: string) => {
      const index = latest.current.findIndex((item) => item.id === id);
      const next = latest.current.filter((item) => item.id !== id);
      commit(next);
      const neighbour = next[Math.min(index, next.length - 1)];
      setSelectedId(neighbour?.id ?? null);
      // Keep keyboard focus in the dialog when the focused filter disappears.
      requestAnimationFrame(() =>
         (
            body.current?.querySelector<HTMLElement>(neighbour ? `[data-filter-select="${neighbour.id}"]` : ".audio-filter-add > .icon-button") ??
            body.current?.querySelector<HTMLElement>(".audio-filter-add > .icon-button")
         )?.focus()
      );
   };
   const add = (kind: AudioFilterKind) => {
      const filter = createAudioFilter(kind, crypto.randomUUID());
      commit([...latest.current, filter]);
      setSelectedId(filter.id);
   };
   const definition = selected ? audioFilterDefinitions[selected.kind] : null;
   return (
      <DialogPanel title={`${name} filters`} titleHidden close={close} className="dialog-panel audio-filters-panel">
         <div className="audio-filters" ref={body}>
            <div className="audio-filters-list">
               <ContextHeader className="audio-filters-heading" label="Filters" title={name} icon={<WandSparkles size={17} />} />
               <MotionList
                  items={chain}
                  onReorder={(id, beforeId) => {
                     const moved = latest.current.find((item) => item.id === id);
                     if (!moved) return;
                     const next = latest.current.filter((item) => item.id !== id);
                     const index = beforeId === null ? next.length : next.findIndex((item) => item.id === beforeId);
                     next.splice(index < 0 ? next.length : index, 0, moved);
                     commit(next);
                  }}
               >
                  {(filter) => {
                     const label = audioFilterDefinitions[filter.kind].label;
                     const selectedRow = filter.id === selected?.id;
                     return (
                        <div
                           className="audio-filter"
                           data-disabled={!filter.enabled || undefined}
                           onContextMenu={(event) => {
                              event.preventDefault();
                              setContextMenu({
                                 id: filter.id,
                                 left: event.clientX,
                                 top: event.clientY,
                                 restoreFocus: event.currentTarget.querySelector("button") ?? event.currentTarget,
                              });
                           }}
                        >
                           <button
                              type="button"
                              data-list-control=""
                              data-filter-select={filter.id}
                              className={`sidebar-item ${selectedRow ? "selected" : ""}`}
                              aria-pressed={selectedRow}
                              aria-description={filter.enabled ? undefined : "Off"}
                              onClick={() => setSelectedId(filter.id)}
                           >
                              <AudioWaveform size={16} aria-hidden="true" />
                              <span className="sidebar-label" title={label}>
                                 {label}
                              </span>
                              {!filter.enabled && (
                                 <span className="audio-filter-state" aria-hidden="true">
                                    Off
                                 </span>
                              )}
                           </button>
                           <Menu
                              className="audio-filter-actions"
                              label={`Actions for ${label}`}
                              trigger={<MoreHorizontal size={14} />}
                              contextRequest={contextMenu?.id === filter.id ? contextMenu : undefined}
                              onContextClose={() => setContextMenu((current) => (current?.id === filter.id ? null : current))}
                           >
                              <MenuItem onClick={() => commit(change(filter.id, { enabled: !filter.enabled }))}>
                                 {filter.enabled ? <PowerOff size={14} /> : <Power size={14} />}
                                 {filter.enabled ? "Turn off" : "Turn on"}
                              </MenuItem>
                              <MenuItem danger onClick={() => remove(filter.id)}>
                                 <Trash2 size={14} />
                                 Remove filter
                              </MenuItem>
                           </Menu>
                        </div>
                     );
                  }}
               </MotionList>
               {chain.length < maxAudioFilters && (
                  <Menu
                     className="audio-filter-add"
                     label="Add filter"
                     trigger={
                        <>
                           <Plus size={14} />
                           Add filter
                        </>
                     }
                  >
                     {audioFilterKinds.map((kind) => (
                        <MenuItem key={kind} onClick={() => add(kind)}>
                           {audioFilterDefinitions[kind].label}
                        </MenuItem>
                     ))}
                  </Menu>
               )}
            </div>
            <div className="audio-filter-settings">
               {selected && definition ? (
                  <>
                     <div className="audio-filter-settings-header">
                        <h3>{definition.label}</h3>
                     </div>
                     <div className="audio-filter-controls" data-disabled={!selected.enabled || undefined}>
                        {definition.presets && (
                           <div className="audio-filter-parameter">
                              <span>Preset</span>
                              <Segmented
                                 label={`${definition.label} preset`}
                                 value={
                                    definition.presets.find((preset) =>
                                       Object.entries(preset.settings).every(([key, value]) => selected.settings[key] === value)
                                    )?.label ?? ""
                                 }
                                 values={definition.presets.map((preset) => ({ value: preset.label, label: preset.label }))}
                                 onChange={(label) => {
                                    const preset = definition.presets?.find((item) => item.label === label);
                                    if (preset) commit(change(selected.id, (current) => ({ settings: { ...current.settings, ...preset.settings } })));
                                 }}
                              />
                           </div>
                        )}
                        {definition.parameters.map((parameter) => (
                           <div key={`${selected.id}:${parameter.key}`} className="audio-filter-parameter">
                              <span aria-hidden="true">{parameter.label}</span>
                              <Slider
                                 aria-label={parameter.label === definition.label ? definition.label : `${definition.label} ${parameter.label.toLowerCase()}`}
                                 min={parameter.min}
                                 max={parameter.max}
                                 step={parameter.step}
                                 value={Number(selected.settings[parameter.key] ?? parameter.default)}
                                 defaultValue={parameter.default}
                                 numeric
                                 unit={parameter.unit}
                                 onValueChange={(value) => setChain(setting(selected.id, parameter.key, value))}
                                 onCommit={(value) => {
                                    // Sliders also commit on unrelated key releases such as Tab.
                                    const next = setting(selected.id, parameter.key, value);
                                    if (JSON.stringify(next) !== stored) commit(next);
                                 }}
                              />
                           </div>
                        ))}
                        {definition.choices?.map((choice) => (
                           <div key={`${selected.id}:${choice.key}`} className="audio-filter-parameter">
                              <span>{choice.label}</span>
                              <Segmented
                                 label={`${definition.label} ${choice.label.toLowerCase()}`}
                                 value={String(selected.settings[choice.key] ?? choice.values[0]!.value)}
                                 values={[...choice.values]}
                                 onChange={(value) => commit(setting(selected.id, choice.key, value))}
                              />
                           </div>
                        ))}
                        {!definition.parameters.length && !definition.choices?.length && <p className="audio-filter-none">No settings</p>}
                     </div>
                  </>
               ) : (
                  <p className="audio-filter-none">No filters</p>
               )}
            </div>
         </div>
      </DialogPanel>
   );
}
