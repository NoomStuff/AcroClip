import { useEffect, useRef, useState } from "react";
import { Clapperboard, Film, FolderOpen, LoaderCircle, MoreHorizontal, Share2, SlidersHorizontal, Trash2, X } from "lucide-react";
import type { AppState, Clip } from "../../shared/types";
import { api, describeError, fileDragProps } from "./desktop";
import { Button, Empty, HeaderActions, IconButton, Menu, MenuItem, Segmented, Select } from "./ui";
import { formatSize, formatTime } from "./format";
import type { Run } from "./desktop";
import { DropdownSelect } from "./DropdownSelect";
import { ViewerTransport } from "./ViewerTransport";
import { PaneDivider, usePaneSize } from "./layout";

export function Viewer({
   state,
   clip,
   visible,
   run,
   openLibrary,
}: {
   state: AppState;
   clip: Clip | undefined;
   visible: boolean;
   run: Run;
   openLibrary: () => void;
}) {
   const layout = useRef<HTMLDivElement>(null);
   const sidebar = usePaneSize(layout, { key: "viewer.sidebar", initial: 270, min: 230, max: 380, reserve: 440, axis: "x" });
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
   const [fullscreen, setFullscreen] = useState(false);
   const [controlsShown, setControlsShown] = useState(true);
   const controlsTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
   const [track, setTrack] = useState(-1);
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
   const job = state.jobs.find((item) => item.clipId === clip?.id && item.kind === "shareable" && ["queued", "running"].includes(item.state));
   useEffect(() => {
      if (previousClip.current !== clip?.id) {
         previousClip.current = clip?.id;
         seek.current = 0;
         resume.current = false;
         setTime(0);
         setVersion(clip?.originalMissing ? "shareable" : "original");
         setTrack(-1);
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
            const result = await api.playback(path, version === "original" && track >= 0 ? track : undefined);
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
   const changeVersion = (next: "original" | "shareable") => {
      seek.current = video.current?.currentTime ?? time;
      resume.current = !video.current?.paused;
      setVersion(next);
   };
   const changeTrack = (value: number) => {
      seek.current = video.current?.currentTime ?? time;
      resume.current = !video.current?.paused;
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
         else if (id === "seekForward") node.currentTime = Math.min(node.duration, node.currentTime + 5);
         else if (id === "mutePlayback") {
            node.muted = !node.muted;
            setMuted(node.muted);
         } else if (id === "fullscreen" && player.current)
            void run(() => (document.fullscreenElement ? document.exitFullscreen() : player.current!.requestFullscreen()));
         else if (id === "createShareable") void run(() => api.createShareable(clip.id, override ? target : undefined));
         else if (id === "showFile" && path) void run(() => api.reveal(path));
      };
      window.addEventListener("acroclip-shortcut", command);
      return () => window.removeEventListener("acroclip-shortcut", command);
   }, [visible, clip, override, target, path, run]);
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
   const wakeControls = () => {
      clearTimeout(controlsTimer.current);
      setControlsShown(true);
      if (fullscreen && playing)
         controlsTimer.current = setTimeout(() => {
            if (
               !player.current?.querySelector(".player-controls")?.contains(document.activeElement) &&
               !player.current?.querySelector(".select-menu")?.contains(document.activeElement)
            )
               setControlsShown(false);
         }, 2200);
   };
   useEffect(() => {
      setControlsShown(true);
      if (fullscreen && playing) controlsTimer.current = setTimeout(() => setControlsShown(false), 2200);
      return () => clearTimeout(controlsTimer.current);
   }, [fullscreen, playing]);
   const create = () => {
      if (clip) void run(() => api.createShareable(clip.id, override ? target : undefined));
   };
   const remove = async () => {
      if (!clip || (version === "shareable" && !shareable)) return;
      await run(async () => {
         await api.deleteClip(clip.id, version === "shareable" ? shareable!.id : undefined);
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
                     <Menu label="File actions" trigger={<MoreHorizontal size={17} />}>
                        <MenuItem danger disabled={!!job || (version === "shareable" && !shareable)} onClick={() => void remove()}>
                           <Trash2 size={14} />
                           {version === "shareable" ? "Delete shareable" : clip.shareables.length ? "Delete original and shareables" : "Delete original"}
                        </MenuItem>
                     </Menu>
                  </HeaderActions>
                  <div className="viewer-metadata">
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
                        { value: "original", label: "Original", disabled: !!clip.originalMissing },
                        { value: "shareable", label: "Shareable" },
                     ]}
                  />
                  {clip.originalMissing && (
                     <p className="permission-note" role="status">
                        Original missing or changed. Your shareables are still available.
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
                                       seek.current = video.current?.currentTime ?? time;
                                       resume.current = !video.current?.paused;
                                       setShareId(value);
                                    }}
                                 >
                                    {clip.shareables.map((item) => (
                                       <option key={item.id} value={item.id}>
                                          {item.targetMB} MB target · {formatSize(item.size)}
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
               <Button
                  className="quiet wide"
                  title="Edit the original clip in AttaCut"
                  disabled={!!clip.originalMissing}
                  onClick={() => void run(() => api.openInAttaCut(clip.id))}
               >
                  <Clapperboard size={17} />
                  Open in AttaCut
               </Button>
               {path && (
                  <div className="reveal-row">
                     <Button className="wide" onClick={() => void run(() => api.reveal(path))}>
                        <FolderOpen size={16} />
                        Show in folder
                     </Button>
                  </div>
               )}
               <div className="viewer-create-row">
                  <div className="viewer-create-main">
                     <Button
                        className="primary wide"
                        onClick={create}
                        disabled={!!clip.originalMissing}
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
         <PaneDivider label="Viewer sidebar width" pane={sidebar} />
         <div
            className="viewer-main"
            ref={player}
            data-controls-hidden={(fullscreen && !controlsShown) || undefined}
            onPointerMove={wakeControls}
            onFocus={wakeControls}
         >
            <div className="video-stage">
               {loading && (
                  <div className="video-loading">
                     <LoaderCircle size={30} className="spin" />
                     <span>Preparing playback</span>
                  </div>
               )}
               {url ? (
                  <video
                     ref={video}
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
                        title={mediaError ? "Playback unavailable" : clip.originalMissing && !shareable ? "Original unavailable" : "No shareable"}
                        detail={
                           mediaError ||
                           (clip.originalMissing && !shareable
                              ? "The original is missing or changed. Locate it in your collection folder."
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
               track={version === "original" ? track : -1}
               disabled={!url || loading}
               fullscreen={fullscreen}
               onToggle={toggle}
               onSeek={(next) => {
                  if (video.current) video.current.currentTime = next;
                  setTime(next);
                  seek.current = next;
               }}
               onVolume={(next) => {
                  setVolume(next);
                  setMuted(false);
               }}
               onMute={() => {
                  if (volume === 0) setVolume(1);
                  setMuted(volume > 0 && !muted);
               }}
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
