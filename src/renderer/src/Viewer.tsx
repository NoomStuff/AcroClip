import { shareableTargetAllowed } from "../../shared/shareable-target";
import { useDirectionalContent } from "./useDirectionalContent";
import { useCallback, useEffect, useId, useRef, useState } from "react";
import { Film, LibraryBig, FolderOpen, LoaderCircle, MoreHorizontal, Share2, Trash2, X, Info } from "lucide-react";
import type { AppState, Clip } from "../../shared/types";
import { api, describeError, fileDragProps } from "./desktop";
import { Button, Empty, HeaderActions, IconButton, Menu, MenuItem, Segmented, Select } from "./ui";
import type { ContextMenuRequest } from "./ui";
import type { Run } from "./desktop";
import { ShareSizePicker } from "./ShareSizePicker";
import { ApplicationIcon } from "./ApplicationIcon";
import { ViewerTransport } from "./ViewerTransport";
import { PaneDivider, usePaneSize } from "./layout";
import type { Ask } from "./Dialog";
import { useAttaCutAvailable } from "./useAttaCutAvailable";
import { ClipActions } from "./ClipActions";
import { CategoryEditor } from "./CategoryEditor";
import { formatSize } from "./format";
import { ClipDetails, ClipTags } from "./ClipDetails";
import { usePlaybackFade } from "./usePlaybackFade";

export function Viewer({
   state,
   clip,
   visible,
   run,
   openLibrary,
   ask,
}: {
   state: Pick<AppState, "applicationIcons" | "jobs" | "preferences" | "categories">;
   clip: Clip | undefined;
   visible: boolean;
   run: Run;
   openLibrary: () => void;
   ask: Ask;
}) {
   const layout = useRef<HTMLDivElement>(null);
   const sidebar = usePaneSize(layout, { key: "viewer.sidebar", initial: 260, min: 230, max: 420, reserve: 440, axis: "x" });
   const shareHintId = useId();
   const [detailsOpen, setDetailsOpen] = useState(() => {
      try {
         return localStorage.getItem("acroclip.viewer.details") === "true";
      } catch {
         return false;
      }
   });
   const toggleDetails = () => {
      const next = !detailsOpen;
      setDetailsOpen(next);
      try {
         localStorage.setItem("acroclip.viewer.details", String(next));
      } catch {
         /* The inspector still works without persistence. */
      }
   };
   const attaCutAvailable = useAttaCutAvailable(visible);
   const [contextMenu, setContextMenu] = useState<ContextMenuRequest | null>(null);
   useEffect(() => setContextMenu(null), [visible, clip?.id]);
   const [selectedVersion, setVersion] = useState<"original" | "shareable">("original");
   const version = clip?.originalMissing ? "shareable" : selectedVersion;
   const versionContent = useRef<HTMLDivElement>(null);
   const versionActions = useRef<HTMLDivElement>(null);
   useDirectionalContent(versionContent, version, version === "original" ? 0 : 1, visible, clip?.id ?? "");
   useDirectionalContent(versionActions, version, version === "original" ? 0 : 1, visible, clip?.id ?? "");
   const [shareId, setShareId] = useState("");
   const [url, setUrl] = useState("");
   const [creatingTag, setCreatingTag] = useState(false);
   const [urlOwner, setUrlOwner] = useState("");
   const [urlGeneration, setUrlGeneration] = useState(0);
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
   const playbackIdentity = JSON.stringify([clip?.id, path, version, track]);
   const fade = usePlaybackFade(video, playbackIdentity, url, urlOwner === playbackIdentity, visible, urlGeneration);
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
         setUrlOwner("");
         video.current?.pause();
         if (document.fullscreenElement === player.current) void document.exitFullscreen().catch(() => undefined);
         resume.current = false;
         return;
      }
      if (!path) {
         setUrl("");
         setUrlOwner("");
         setLoading(false);
         setMediaError("");
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
               setUrlOwner(playbackIdentity);
               setUrlGeneration((value) => value + 1);
            }
         } catch (error) {
            if (!disposed) {
               setUrl("");
               setUrlOwner("");
               setMediaError(describeError(error));
            }
         } finally {
            if (!disposed) setLoading(false);
         }
      })();
      return () => {
         disposed = true;
      };
   }, [path, track, version, visible, playbackIdentity]);

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
                  <LibraryBig size={16} />
                  Open Library
               </Button>
            </Empty>
         </div>
      );
   return (
      <div className="viewer-page" ref={layout} data-details-open={detailsOpen || undefined}>
         <div className="viewer-header">
            <header className="viewer-title action-header">
               <h1>{clip.name}</h1>
               <HeaderActions>
                  <Menu
                     label="File actions"
                     trigger={<MoreHorizontal size={17} />}
                     contextRequest={contextMenu ?? undefined}
                     onContextClose={() => setContextMenu(null)}
                  >
                     <ClipActions
                        createTag={() => setCreatingTag(true)}
                        clip={clip}
                        categories={state.categories}
                        busy={!!job}
                        canCreate={targetAllowed}
                        attaCutAvailable={attaCutAvailable}
                        ask={ask}
                        run={run}
                        create={create}
                        remove={() => void remove()}
                        shareable={shareable}
                     >
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
                     </ClipActions>
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
                  <ClipTags ids={clip.categories} categories={state.categories} />
               </div>
            </header>
            <div className="viewer-toolbar">
               <div className="viewer-version-controls">
                  <Segmented
                     label="Clip version"
                     value={version}
                     onChange={changeVersion}
                     values={[
                        { value: "original", label: "Clip", disabled: !!clip.originalMissing },
                        { value: "shareable", label: "Shareable" },
                     ]}
                  />
                  {version === "shareable" && shareable && clip.shareables.length > 1 && (
                     <Select
                        label="Choose shareable"
                        value={shareable.id}
                        onChange={(id) => {
                           rememberPlayback();
                           setShareId(id);
                        }}
                     >
                        {clip.shareables.map((item, index) => (
                           <option key={item.id} value={item.id}>
                              Shareable {index + 1} · {formatSize(item.size)}
                           </option>
                        ))}
                     </Select>
                  )}
               </div>
               <div className="viewer-share-actions" ref={versionActions}>
                  {path && (
                     <div className="reveal-row">
                        <Button className="quiet" onClick={() => void run(() => api.reveal(path))}>
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
                           aria-describedby={!targetAllowed ? shareHintId : undefined}
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
               <IconButton
                  label={detailsOpen ? "Hide file details" : "Show file details"}
                  aria-expanded={detailsOpen}
                  aria-controls="viewer-file-details"
                  onClick={toggleDetails}
               >
                  <Info size={18} />
               </IconButton>
            </div>
            {clip.originalMissing && (
               <p className="permission-note" role="status">
                  Clip missing or changed. Your shareables are still available.
               </p>
            )}

            {!targetAllowed && !clip.originalMissing && !job && (
               <p className="viewer-share-hint" id={shareHintId}>
                  Already under {override ? target : state.preferences.shareSizeMB} MB. You can share this file directly.
               </p>
            )}
         </div>
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
               {path && !mediaError && clip.thumbnail && <img className="player-poster" src={clip.thumbnail} alt="" aria-hidden="true" />}
               <canvas ref={fade.outgoing} className="player-outgoing" aria-hidden="true" hidden={!path || !!mediaError} />
               {url ? (
                  <video
                     ref={video}
                     className={`player-video ${fade.ready ? "ready" : ""}`}
                     tabIndex={0}
                     {...fileDragProps(path)}
                     src={url}
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
                        seek.current = event.currentTarget.currentTime;
                     }}
                     onPlay={() => setPlaying(true)}
                     onPause={() => setPlaying(false)}
                     onEnded={() => {
                        resume.current = false;
                        setPlaying(false);
                     }}
                     onError={() => setMediaError("This video could not be played. Try opening it in AttaCut or another player.")}
                     onClick={(event) => {
                        const media = event.currentTarget;
                        if (!media.videoWidth || !media.videoHeight) return;
                        const bounds = media.getBoundingClientRect();
                        const scale = Math.min(bounds.width / media.videoWidth, bounds.height / media.videoHeight);
                        const width = media.videoWidth * scale;
                        const height = media.videoHeight * scale;
                        const left = bounds.left + (bounds.width - width) / 2;
                        const top = bounds.top + (bounds.height - height) / 2;
                        if (event.clientX < left || event.clientX > left + width || event.clientY < top || event.clientY > top + height) return;
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
                              : !targetAllowed
                                ? "The original is already below your size limit. Choose Clip to watch or share it."
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
               video={video}
               visible={visible}
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
         <aside className="viewer-sidebar" id="viewer-file-details" hidden={!detailsOpen} style={{ width: sidebar.size }}>
            <header className="panel-heading">
               <h2>File details</h2>
            </header>
            <div className="viewer-sidebar-scroll">
               <section className="viewer-file" aria-label="Displayed file">
                  <div ref={versionContent}>
                     <ClipDetails clip={clip} shareable={shareable} version={version} />
                  </div>
               </section>
            </div>
         </aside>
         {detailsOpen && <PaneDivider label="Player sidebar width" pane={sidebar} />}
         {creatingTag && <CategoryEditor close={() => setCreatingTag(false)} run={run} />}
      </div>
   );
}
