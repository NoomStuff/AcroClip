import { shareableTargetAllowed } from "../../shared/shareable-target";
import { useCallback, useEffect, useRef, useState } from "react";
import { Film, FolderOpen, LoaderCircle, MoreHorizontal, Pencil, Scissors, Share2, SlidersHorizontal, Trash2, X } from "lucide-react";
import type { AppState, Clip } from "../../shared/types";
import { api, describeError, fileDragProps } from "./desktop";
import { Button, Empty, HeaderActions, IconButton, Menu, MenuItem, Segmented, Select } from "./ui";
import type { ContextMenuRequest } from "./ui";
import { formatSize, formatTime } from "./format";
import type { Run } from "./desktop";
import { DropdownSelect } from "./DropdownSelect";
import { ApplicationIcon } from "./ApplicationIcon";
import { ViewerTransport } from "./ViewerTransport";
import { PaneDivider, usePaneSize } from "./layout";
import type { Ask } from "./Dialog";
import { useAttaCutAvailable } from "./useAttaCutAvailable";

export function Viewer({
   state,
   clip,
   visible,
   run,
   openLibrary,
   ask,
}: {
   state: AppState;
   clip: Clip | undefined;
   visible: boolean;
   run: Run;
   openLibrary: () => void;
   ask: Ask;
}) {
   const layout = useRef<HTMLDivElement>(null);
   const sidebar = usePaneSize(layout, { key: "viewer.sidebar", initial: 270, min: 230, max: 380, reserve: 440, axis: "x" });
   const attaCutAvailable = useAttaCutAvailable(visible);
   const [contextMenu, setContextMenu] = useState<ContextMenuRequest | null>(null);
   useEffect(() => setContextMenu(null), [visible, clip?.id]);
   const [selectedVersion, setVersion] = useState<"original" | "shareable">("original");
   const version = clip?.originalMissing ? "shareable" : selectedVersion;
   const [shareId, setShareId] = useState("");
   const [url, setUrl] = useState("");
   const [loading, setLoading] = useState(false);
   const [playing, setPlaying] = useState(false);
   const [time, setTime] = useState(0);
   const [duration, setDuration] = useState(0);
   const [volume, setVolume] = useState(1);
   const [muted, setMuted] = useState(false);
   const toggleMute = useCallback(() => setMuted((current) => !current), []);
   const [fullscreen, setFullscreen] = useState(false);
   const [controlsShown, setControlsShown] = useState(true);
   const controlsTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
   const [track, setTrack] = useState<number[] | undefined>(undefined);
   const [speed, setSpeed] = useState(1);
   const [target, setTarget] = useState(state.preferences.shareSizeMB);
   const [override, setOverride] = useState(false);
   const [mediaError, setMediaError] = useState("");
   const video = useRef<HTMLVideoElement>(null);
   const player = useRef<HTMLDivElement>(null);
   const seek = useRef(0);
   const switching = useRef(false);
   const currentUrl = useRef("");
   const resume = useRef(false);
   const previousClip = useRef<string | undefined>(undefined);
   const shareable = clip?.shareables.find((item) => item.id === shareId) ?? clip?.shareables.at(-1);
   const path = version === "shareable" ? shareable?.path : clip?.path;
   const targetAllowed = shareableTargetAllowed(clip?.size ?? 0, override ? target : state.preferences.shareSizeMB);
   const job = state.jobs.find((item) => item.clipId === clip?.id && item.kind === "shareable" && ["queued", "running"].includes(item.state));
   useEffect(() => {
      if (previousClip.current !== clip?.id) {
         previousClip.current = clip?.id;
         seek.current = 0;
         resume.current = false;
         setTime(0);
         setVersion(clip?.originalMissing ? "shareable" : "original");
         setTrack(undefined);
         setShareId("");
         setOverride(false);
         setTarget(state.preferences.shareSizeMB);
      }
   }, [clip?.id, clip?.originalMissing, state.preferences.shareSizeMB]);
   useEffect(() => {
      if (clip?.originalMissing) setVersion("shareable");
   }, [clip?.originalMissing]);
   useEffect(() => {
      if (!visible) {
         video.current?.pause();
         if (document.fullscreenElement === player.current) void document.exitFullscreen().catch(() => undefined);
         resume.current = false;
         return;
      }
      if (!path) {
         setUrl("");
         return;
      }
      let disposed = false;
      switching.current = true;
      video.current?.pause();
      setLoading(true);
      setMediaError("");
      void (async () => {
         try {
            const result = await api.playback(path, version === "original" ? track : undefined);
            if (!disposed) {
               if (currentUrl.current === result) {
                  switching.current = false;
                  if (resume.current) void video.current?.play().catch(() => undefined);
               }
               currentUrl.current = result;
               setUrl(result);
            }
         } catch (error) {
            if (!disposed) {
               setUrl("");
               setMediaError(describeError(error));
            }
         } finally {
            if (!disposed) setLoading(false);
         }
      })();
      return () => {
         disposed = true;
      };
   }, [path, track, version, visible]);

   const rememberPlayback = () => {
      if (!switching.current) {
         seek.current = video.current?.currentTime ?? time;
         resume.current = !!video.current && !video.current.paused;
      }
   };
   const changeVersion = (next: "original" | "shareable") => {
      rememberPlayback();
      setVersion(next);
   };
   const changeTrack = (value: number[]) => {
      rememberPlayback();
      setTrack(value);
   };
   const toggle = () => {
      if (!video.current) return;
      if (video.current.paused) void run(() => video.current!.play());
      else video.current.pause();
   };
   useEffect(() => {
      if (!visible) return;
      const command = (event: Event) => {
         const id = (event as CustomEvent<string>).detail,
            node = video.current;
         if (!clip || !node) return;
         if (id === "playPause") {
            if (node.paused) void run(() => node.play());
            else node.pause();
         } else if (id === "seekBack") node.currentTime = Math.max(0, node.currentTime - 5);
         else if (id === "seekForward" && Number.isFinite(node.duration)) node.currentTime = Math.min(node.duration, node.currentTime + 5);
         else if (id === "mutePlayback") toggleMute();
         else if (id === "fullscreen" && player.current)
            void run(() => (document.fullscreenElement ? document.exitFullscreen() : player.current!.requestFullscreen()));
         else if (id === "createShareable" && targetAllowed && !clip.originalMissing && !job)
            void run(() => api.createShareable(clip.id, override ? target : undefined));
         else if (id === "showFile" && path) void run(() => api.reveal(path));
      };
      window.addEventListener("acroclip-shortcut", command);
      return () => window.removeEventListener("acroclip-shortcut", command);
   }, [visible, clip, override, target, path, run, targetAllowed, job, toggleMute]);
   useEffect(() => {
      const changed = () => setFullscreen(document.fullscreenElement === player.current);
      document.addEventListener("fullscreenchange", changed);
      return () => document.removeEventListener("fullscreenchange", changed);
   }, []);
   useEffect(() => {
      if (video.current) {
         video.current.volume = volume;
         video.current.muted = muted;
      }
   }, [volume, muted, url]);
   useEffect(() => {
      if (video.current) {
         video.current.defaultPlaybackRate = speed;
         video.current.playbackRate = speed;
         video.current.preservesPitch = true;
      }
   }, [speed, url]);
   useEffect(() => {
      if (!playing || !visible) return;
      let frame = 0;
      const tick = () => {
         if (video.current && !switching.current) {
            setTime(video.current.currentTime);
            seek.current = video.current.currentTime;
         }
         frame = requestAnimationFrame(tick);
      };
      frame = requestAnimationFrame(tick);
      return () => cancelAnimationFrame(frame);
   }, [playing, visible]);
   const wakeControls = useCallback(() => {
      clearTimeout(controlsTimer.current);
      setControlsShown(true);
      if (fullscreen && playing)
         controlsTimer.current = setTimeout(() => {
            const root = player.current;
            const keyboardFocus =
               document.documentElement.hasAttribute("data-keyboard") && root?.querySelector(".player-controls")?.contains(document.activeElement);
            const popup = root?.querySelector(".select-menu,.floating-menu,[role=dialog],.player-volume-control[data-open]");
            if (!keyboardFocus && !popup) setControlsShown(false);
         }, 2200);
   }, [fullscreen, playing]);
   useEffect(() => {
      wakeControls();
      return () => clearTimeout(controlsTimer.current);
   }, [wakeControls]);
   const create = () => {
      if (clip && targetAllowed && !clip.originalMissing && !job) void run(() => api.createShareable(clip.id, override ? target : undefined));
   };
   const rename = async () => {
      if (!clip) return;
      const name = await ask({
         title: "Rename clip",
         ...(clip.shareables.length ? { detail: "Renames the clip and all its shareables." } : {}),
         confirm: "Rename",
         initial: clip.name,
      });
      if (typeof name === "string" && name) await run(() => api.renameClip(clip.id, name));
   };
   const remove = async (shareableId?: string, scope?: "shareables") => {
      if (!clip) return;
      await run(async () => {
         await api.deleteClip(clip.id, shareableId, scope);
         const latest = await api.state();
         if (!latest.clips.find((item) => item.id === clip.id)?.shareables.some((item) => item.id === shareable?.id)) setVersion("original");
      });
   };
   if (!clip)
      return (
         <div className="viewer-page" ref={layout}>
            <Empty icon={<Film size={40} />} title="No clip selected">
               <Button onClick={openLibrary}>
                  <FolderOpen size={16} />
                  Open Library
               </Button>
            </Empty>
         </div>
      );
   return (
      <div className="viewer-page" ref={layout}>
         <aside className="viewer-sidebar" style={{ width: sidebar.size }}>
            <div className="viewer-sidebar-scroll">
               <header className="viewer-title action-header">
                  <h1>{clip.name}</h1>
                  <HeaderActions>
                     <Menu
                        label="File actions"
                        trigger={<MoreHorizontal size={17} />}
                        contextRequest={contextMenu ?? undefined}
                        onContextClose={() => setContextMenu(null)}
                     >
                        <MenuItem disabled={!!job || !!clip.originalMissing || !targetAllowed} onClick={create}>
                           <Share2 size={14} />
                           {job ? "Creating shareable…" : "Create shareable"}
                        </MenuItem>
                        <MenuItem disabled={!!job || !!clip.originalMissing} onClick={() => void rename()}>
                           <Pencil size={14} />
                           Rename clip
                        </MenuItem>

                        <div className="menu-separator" role="separator" />
                        <MenuItem disabled={!!clip.originalMissing} onClick={() => void run(() => api.reveal(clip.path))}>
                           <FolderOpen size={14} />
                           Show clip in folder
                        </MenuItem>
                        {shareable && (
                           <MenuItem onClick={() => void run(() => api.reveal(shareable.path))}>
                              <FolderOpen size={14} />
                              Show shareable in folder
                           </MenuItem>
                        )}
                        {attaCutAvailable && !clip.originalMissing && (
                           <MenuItem onClick={() => void run(() => api.openInAttaCut(clip.id))}>
                              <Scissors size={14} />
                              Open in AttaCut
                           </MenuItem>
                        )}
                        <div className="menu-separator" role="separator" />
                        {shareable && (
                           <MenuItem danger disabled={!!job} onClick={() => void remove(shareable.id)}>
                              <Trash2 size={14} />
                              {clip.shareables.length > 1 ? `Delete shareable ${clip.shareables.indexOf(shareable) + 1}` : "Delete shareable"}
                           </MenuItem>
                        )}
                        {clip.shareables.length > 1 && (
                           <MenuItem danger disabled={!!job} onClick={() => void remove(undefined, "shareables")}>
                              <Trash2 size={14} />
                              Delete all shareables
                           </MenuItem>
                        )}
                        <MenuItem danger disabled={!!job} onClick={() => void remove()}>
                           <Trash2 size={14} />
                           Delete clip
                        </MenuItem>
                     </Menu>
                  </HeaderActions>
                  <div className="viewer-metadata">
                     {clip.applicationId && state.applicationIcons[clip.applicationId] && (
                        <ApplicationIcon src={state.applicationIcons[clip.applicationId]} size={14} />
                     )}
                     {clip.source.trim() && clip.source.trim().toLowerCase() !== "unknown" && (
                        <span className="source-label" title={clip.source}>
                           {clip.source}
                        </span>
                     )}
                     <time dateTime={new Date(clip.createdAt).toISOString()}>
                        {new Date(clip.createdAt).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" })}
                     </time>
                  </div>
               </header>
               <section className="viewer-file" aria-label="Displayed file">
                  <Segmented
                     label="Clip version"
                     value={version}
                     onChange={changeVersion}
                     values={[
                        { value: "original", label: "Clip", disabled: !!clip.originalMissing },
                        { value: "shareable", label: "Shareable" },
                     ]}
                  />
                  {clip.originalMissing && (
                     <p className="permission-note" role="status">
                        Clip missing or changed. Your shareables are still available.
                     </p>
                  )}
                  <div className="version-info">
                     {version === "original" ? (
                        <>
                           <div>
                              <span>File size</span>
                              <strong>{clip.availability && !clip.size ? "Checking" : formatSize(clip.size)}</strong>
                           </div>
                           <div>
                              <span>Resolution</span>
                              <strong>
                                 {clip.width} × {clip.height}
                              </strong>
                           </div>
                           <div>
                              <span>Duration</span>
                              <strong>{clip.availability && !clip.duration ? "Checking" : formatTime(clip.duration)}</strong>
                           </div>
                           <div>
                              <span>Audio tracks</span>
                              <strong>{clip.availability && !clip.tracks.length ? "Checking" : clip.tracks.length || "None"}</strong>
                           </div>
                        </>
                     ) : shareable ? (
                        <>
                           {clip.shareables.length > 1 && (
                              <div className="select-wrap version-select">
                                 <Select
                                    label="Choose shareable"
                                    value={shareable.id}
                                    onChange={(value) => {
                                       rememberPlayback();
                                       setShareId(value);
                                    }}
                                 >
                                    {clip.shareables.map((item) => (
                                       <option key={item.id} value={item.id}>
                                          Shareable {clip.shareables.indexOf(item) + 1} · {formatSize(item.size)}
                                       </option>
                                    ))}
                                 </Select>
                              </div>
                           )}
                           <div>
                              <span>File size</span>
                              <strong>{formatSize(shareable.size)}</strong>
                           </div>
                           <div>
                              <span>Size target</span>
                              <strong>{shareable.targetMB} MB</strong>
                           </div>
                        </>
                     ) : (
                        <p className="muted">No shareables.</p>
                     )}
                  </div>
               </section>
            </div>
            <div className="viewer-sidebar-bottom">
               {path && (
                  <div className="reveal-row">
                     <Button className="wide" onClick={() => void run(() => api.reveal(path))}>
                        <FolderOpen size={16} />
                        {version === "shareable" ? "Show shareable in folder" : "Show clip in folder"}
                     </Button>
                  </div>
               )}
               <div className="viewer-create-row">
                  <div className="viewer-create-main">
                     <Button
                        className="primary wide"
                        onClick={create}
                        disabled={!!clip.originalMissing || !targetAllowed}
                        title={!targetAllowed ? "Choose a size target no larger than the clip" : undefined}
                        busy={!!job}
                        busyIndicator="content"
                        {...(job ? { progress: job.progress } : {})}
                        aria-label={
                           job
                              ? `${job.state === "queued" ? "Waiting to create shareable" : "Creating shareable"}, ${Math.round(job.progress * 100)} percent`
                              : undefined
                        }
                     >
                        {job ? (
                           <>
                              <LoaderCircle size={17} className="spin" />
                              <span role="status">{Math.round(job.progress * 100)}%</span>
                           </>
                        ) : (
                           <>
                              <Share2 size={17} />
                              Create shareable
                           </>
                        )}
                     </Button>
                     {job && (
                        <IconButton className="viewer-cancel-export" label="Cancel shareable" onClick={() => void run(() => api.cancelJob(job.id))}>
                           <X size={15} />
                        </IconButton>
                     )}
                  </div>
                  <ShareSizePicker
                     defaultTarget={state.preferences.shareSizeMB}
                     target={target}
                     override={override}
                     disabled={!!clip.originalMissing || !!job}
                     onOverride={setOverride}
                     onTarget={setTarget}
                  />
               </div>
            </div>
         </aside>
         <PaneDivider label="Player sidebar width" pane={sidebar} />
         <div
            className="viewer-main"
            ref={player}
            data-controls-hidden={(fullscreen && !controlsShown) || undefined}
            onPointerMove={wakeControls}
            onFocus={wakeControls}
         >
            <div
               className="video-stage"
               onContextMenu={(event) => {
                  event.preventDefault();
                  setContextMenu({ left: event.clientX, top: event.clientY, restoreFocus: video.current ?? event.currentTarget });
                  wakeControls();
               }}
            >
               {loading && (
                  <div className="video-loading">
                     <LoaderCircle size={30} className="spin" />
                     <span>Preparing playback</span>
                  </div>
               )}
               {url ? (
                  <video
                     ref={video}
                     tabIndex={0}
                     {...fileDragProps(path)}
                     title="Drag this video into another app"
                     src={url}
                     poster={clip.thumbnail || undefined}
                     onLoadedMetadata={(event) => {
                        const media = event.currentTarget;
                        setDuration(media.duration);
                        media.currentTime = Math.min(seek.current, media.duration || 0);
                        setTime(media.currentTime);
                        switching.current = false;
                        media.playbackRate = speed;
                        media.defaultPlaybackRate = speed;
                        media.preservesPitch = true;
                        media.volume = volume;
                        media.muted = muted;
                        if (resume.current) void media.play().catch(() => undefined);
                     }}
                     onTimeUpdate={(event) => {
                        if (switching.current) return;
                        setTime(event.currentTarget.currentTime);
                        seek.current = event.currentTarget.currentTime;
                     }}
                     onPlay={() => setPlaying(true)}
                     onPause={() => setPlaying(false)}
                     onEnded={() => {
                        resume.current = false;
                        setPlaying(false);
                     }}
                     onError={() => setMediaError("This video could not be played. Try opening it in AttaCut or another player.")}
                     onClick={() => {
                        if (fullscreen && !controlsShown) wakeControls();
                        else toggle();
                     }}
                     onDoubleClick={() => void run(() => (document.fullscreenElement ? document.exitFullscreen() : player.current!.requestFullscreen()))}
                  />
               ) : (
                  !loading && (
                     <Empty
                        icon={<Share2 size={38} />}
                        title={mediaError ? "Playback unavailable" : clip.originalMissing && !shareable ? "Clip unavailable" : "No shareable"}
                        detail={
                           mediaError ||
                           (clip.originalMissing && !shareable
                              ? "The clip is missing or changed. Locate it in your collection folder."
                              : "Create a compressed copy of the full clip.")
                        }
                     />
                  )
               )}
               {mediaError && url && (
                  <div className="playback-error" role="alert">
                     {mediaError}
                  </div>
               )}
            </div>
            <ViewerTransport
               time={time}
               duration={duration || clip.duration}
               playing={playing}
               volume={volume}
               muted={muted}
               tracks={version === "original" ? clip.tracks : [{ index: -1, title: "Master" }]}
               track={version === "original" ? (track ?? clip.tracks.slice(0, 1).map((item) => item.index)) : [-1]}
               speed={speed}
               onSpeed={setSpeed}
               disabled={!url || loading}
               fullscreen={fullscreen}
               onToggle={toggle}
               onSeek={(next) => {
                  if (video.current) video.current.currentTime = next;
                  setTime(next);
                  seek.current = next;
               }}
               onVolume={(next, restore) => {
                  setVolume(next === 0 ? (restore > 0 ? restore : 1) : next);
                  setMuted(next === 0);
               }}
               onMute={toggleMute}
               onTrack={changeTrack}
               onFullscreen={() => void run(() => (document.fullscreenElement ? document.exitFullscreen() : player.current!.requestFullscreen()))}
            />
         </div>
      </div>
   );
}

function ShareSizePicker({
   defaultTarget,
   target,
   override,
   disabled,
   onOverride,
   onTarget,
}: {
   defaultTarget: number;
   target: number;
   override: boolean;
   disabled: boolean;
   onOverride: (value: boolean) => void;
   onTarget: (value: number) => void;
}) {
   const [custom, setCustom] = useState(false);
   const [editing, setEditing] = useState(false);
   const root = useRef<HTMLDivElement>(null);
   const close = () => {
      setEditing(false);
      root.current?.querySelector<HTMLButtonElement>("button")?.focus();
   };
   useEffect(() => {
      if (!editing) return;
      root.current?.querySelector<HTMLInputElement>("input")?.focus();
      root.current?.querySelector<HTMLInputElement>("input")?.select();
      const dismiss = (event: PointerEvent) => {
         if (!root.current?.contains(event.target as Node)) setEditing(false);
      };
      document.addEventListener("pointerdown", dismiss);
      return () => document.removeEventListener("pointerdown", dismiss);
   }, [editing]);
   return (
      <div
         className="viewer-size-picker"
         ref={root}
         onBlur={(event) => {
            if (!event.currentTarget.contains(event.relatedTarget)) setEditing(false);
         }}
         onKeyDown={(event) => {
            if (!editing || !["Escape", "Enter"].includes(event.key)) return;
            event.preventDefault();
            event.stopPropagation();
            close();
         }}
      >
         <DropdownSelect
            label={`Shareable size: ${override ? target : defaultTarget} MB${override ? "" : " (default)"}`}
            iconOnly
            placement="up"
            disabled={disabled}
            triggerContent={<SlidersHorizontal size={17} />}
            value={custom && override ? "custom" : String(override ? target : defaultTarget)}
            options={[
               ...Array.from(new Set([10, 20, 50, 100, defaultTarget]))
                  .sort((a, b) => a - b)
                  .map((size) => ({ value: String(size), label: `${size} MB${size === defaultTarget ? " (default)" : ""}` })),
               { value: "custom", label: "Custom" },
            ]}
            onChange={(value) => {
               setCustom(value === "custom");
               onOverride(value === "custom" || Number(value) !== defaultTarget);
               if (value === "custom") setEditing(true);
               else {
                  setEditing(false);
                  onTarget(Number(value));
               }
            }}
         />
         {editing && (
            <div className="viewer-size-popover">
               <label htmlFor="viewer-custom-size">Custom size</label>
               <div className="number-unit">
                  <input
                     id="viewer-custom-size"
                     type="number"
                     min={1}
                     max={2000}
                     value={target}
                     aria-label="Shareable size target in MB"
                     onChange={(event) => onTarget(Math.max(1, Math.min(2000, Number(event.target.value))))}
                  />
                  <span>MB</span>
               </div>
            </div>
         )}
      </div>
   );
}
