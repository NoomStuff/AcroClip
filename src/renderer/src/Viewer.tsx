import { shareableTargetAllowed } from "../../shared/shareable-target";
import { useDirectionalContent } from "./useDirectionalContent";
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { Check, ChevronDown, Copy, CopyPlus, Film, FolderOpen, LibraryBig, LoaderCircle, MoreHorizontal, Save, Scissors, Share2, X } from "lucide-react";
import type { ReactNode, RefObject } from "react";
import type { AppState, Clip } from "../../shared/types";
import { api, describeError, fileDragProps, reportFeedback } from "./desktop";
import { clipFiles, copiedMessage } from "./clip-files";
import { Button, Empty, HeaderActions, IconButton, Menu, NumberInput, Segmented, Select } from "./ui";
import type { ContextMenuRequest } from "./ui";
import { formatSize, formatTime } from "./format";
import type { Run } from "./desktop";
import { DropdownSelect } from "./DropdownSelect";
import { Popover } from "./Popover";
import { ApplicationIcon } from "./ApplicationIcon";
import { ViewerTransport } from "./ViewerTransport";
import { PaneDivider, usePaneSize } from "./layout";
import type { Ask } from "./Dialog";
import { useAttaCutAvailable } from "./useAttaCutAvailable";
import { ClipActions } from "./ClipActions";
import { CategoryEditor, CategoryMark } from "./CategoryEditor";
import { categoryStyle } from "./category-color";
import { usePlaybackFade } from "./usePlaybackFade";
import { mediaAudioTracks, nativeAudioTracks, selectAudioTracks } from "./audio-tracks";
import { restartThreshold } from "./play-queue";
import type { QueuePosition } from "./play-queue";
import { startWatch, watchEvent, watchSeek, watchTick } from "./view-stats";
import type { WatchSession } from "./view-stats";
import { lastKeptTime, trims } from "./trim-range";
import { SeekQueue } from "./seek-queue";
import type { TrimEdge, TrimRange } from "./trim-range";

const autoAdvanceKey = "acroclip.player.autoAdvance";
function readAutoAdvance(): boolean {
   try {
      return localStorage.getItem(autoAdvanceKey) === "true";
   } catch {
      return false;
   }
}

export function Viewer({
   state,
   clip,
   queue,
   autoplay,
   stepClip,
   visible,
   run,
   openLibrary,
   ask,
   trimRequest,
   showClip,
}: {
   state: Pick<AppState, "applicationIcons" | "jobs" | "preferences" | "categories">;
   clip: Clip | undefined;
   queue: QueuePosition | null;
   autoplay: boolean;
   stepClip: (clip: Clip, play: boolean) => void;
   visible: boolean;
   run: Run;
   openLibrary: () => void;
   ask: Ask;
   // Asks the player to start trimming this clip, such as from a library card's menu.
   trimRequest: { clipId: string; at: number } | null;
   // Shows another clip in the player, such as a trimmed copy just saved.
   showClip: (id: string) => void;
}) {
   const layout = useRef<HTMLDivElement>(null);
   const sidebar = usePaneSize(layout, { key: "viewer.sidebar", initial: 300, min: 230, max: 420, reserve: 440, axis: "x" });
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
   // The menu shows a choice at once. A choice that needs a mixed copy waits a moment, so toggling
   // tracks one by one never loads a copy for a combination that only existed between two clicks.
   const [shownTrack, setShownTrack] = useState<number[] | undefined>(undefined);
   const mixDelay = useRef<number | undefined>(undefined);
   useEffect(() => () => window.clearTimeout(mixDelay.current), []);
   const [speed, setSpeed] = useState(1);
   // The part to keep while trimming, and whether saving makes a copy or replaces the clip.
   const [trim, setTrim] = useState<TrimRange | null>(null);
   const [trimMode, setTrimMode] = useState<"copy" | "replace">("copy");
   const trimRef = useRef(trim);
   useLayoutEffect(() => {
      trimRef.current = trim;
   }, [trim]);
   // A trim that replaced the file keeps its path, so the player reloads it by revision.
   const [revision, setRevision] = useState(0);
   const [target, setTarget] = useState(state.preferences.shareSizeMB);
   const [override, setOverride] = useState(false);
   const createRow = useRef<HTMLDivElement>(null);
   const [mediaError, setMediaError] = useState("");
   const video = useRef<HTMLVideoElement>(null);
   // Seeks from the player's controls wait for the previous one to show, so dragging never freezes the picture.
   const [seeker] = useState(() => new SeekQueue());
   const player = useRef<HTMLDivElement>(null);
   const seek = useRef(0);
   const switching = useRef(false);
   const currentUrl = useRef("");
   const resume = useRef(false);
   const previousClip = useRef<string | undefined>(undefined);
   const autoplayRef = useRef(autoplay);
   useLayoutEffect(() => {
      autoplayRef.current = autoplay;
   }, [autoplay]);
   const [autoAdvance, setAutoAdvance] = useState(readAutoAdvance);
   const changeAutoAdvance = useCallback((value: boolean) => {
      setAutoAdvance(value);
      try {
         localStorage.setItem(autoAdvanceKey, String(value));
      } catch {
         /* The toggle still works for this session. */
      }
   }, []);
   // Previous restarts a clip that has been playing for a moment, like a music player.
   // While trimming, the queue stays put: previous restarts at the start handle and next does nothing.
   const stepBack = useCallback(() => {
      const media = video.current;
      const range = trimRef.current;
      if (media && (range || media.currentTime > restartThreshold || !queue?.previous)) {
         const start = range?.start ?? 0;
         seeker.seek(start);
         seek.current = start;
         setTime(start);
         return;
      }
      if (queue?.previous) stepClip(queue.previous, !!media && !media.paused);
   }, [queue?.previous, stepClip, seeker]);
   const stepForward = useCallback(() => {
      if (queue?.next && !trimRef.current) stepClip(queue.next, !!video.current && !video.current.paused);
   }, [queue?.next, stepClip]);
   const trimming = !!trim;
   // Media keys step through the queue too, while this player has the media session.
   useEffect(() => {
      if (!visible || !("mediaSession" in navigator)) return;
      const session = navigator.mediaSession;
      session.setActionHandler("previoustrack", stepBack);
      session.setActionHandler("nexttrack", queue?.next && !trimming ? stepForward : null);
      return () => {
         session.setActionHandler("previoustrack", null);
         session.setActionHandler("nexttrack", null);
      };
   }, [visible, stepBack, stepForward, queue?.next, trimming]);
   // One watch session per clip while the player shows it, recorded when it ends.
   const watch = useRef<WatchSession | null>(null);
   const watchedClip = clip?.id;
   const watchedDuration = clip?.duration ?? 0;
   useEffect(() => {
      if (!visible || !watchedClip) return;
      const finish = () => {
         const event = watch.current && watchEvent(watch.current);
         watch.current = null;
         if (event) void api.recordView(event).catch(() => undefined);
      };
      watch.current = startWatch(watchedClip, watchedDuration);
      const hidden = () => {
         if (document.visibilityState !== "hidden") return;
         finish();
         watch.current = startWatch(watchedClip, watchedDuration);
      };
      document.addEventListener("visibilitychange", hidden);
      return () => {
         document.removeEventListener("visibilitychange", hidden);
         finish();
      };
   }, [visible, watchedClip, watchedDuration]);
   const shareable = clip?.shareables.find((item) => item.id === shareId) ?? clip?.shareables.at(-1);
   const path = version === "shareable" ? shareable?.path : clip?.path;
   // Files the player failed to decode, and files whose audio tracks it can't toggle. Both
   // fall back to copies the main process prepares, once per file for this session.
   const [compatiblePaths, setCompatiblePaths] = useState<ReadonlySet<string>>(() => new Set());
   const [trackCopyPaths, setTrackCopyPaths] = useState<ReadonlySet<string>>(() => new Set());
   const compatible = !!path && compatiblePaths.has(path);
   const nativeTrackSelection = nativeAudioTracks && !!path && !trackCopyPaths.has(path);
   // Chromium plays one audio track at a time and switches it in place. A mix of several
   // tracks plays from a prepared copy, requested once the selection settles, so clicking
   // through the picker doesn't start conversions that are immediately replaced.
   const mixTracks = version === "original" && track && (track.length > 1 || !nativeTrackSelection) ? track : undefined;
   const [settledMix, setSettledMix] = useState<number[] | undefined>(undefined);
   useEffect(() => {
      if (!mixTracks) return;
      const timer = setTimeout(() => setSettledMix(mixTracks), 350);
      return () => clearTimeout(timer);
   }, [mixTracks]);
   const requestedTrack = mixTracks && settledMix === mixTracks ? mixTracks : undefined;
   const singleTrack = !mixTracks;
   const selectedTracks = track ?? clip?.tracks.slice(0, 1).map((item) => item.index) ?? [];
   const masterSelected = !track || (track.length === 1 && track[0] === clip?.tracks[0]?.index);
   const playbackIdentity = JSON.stringify([clip?.id, path, version, requestedTrack, compatible, revision]);
   const currentPlayback = useRef({ identity: playbackIdentity, generation: urlGeneration });
   useLayoutEffect(() => {
      currentPlayback.current = { identity: playbackIdentity, generation: urlGeneration };
   }, [playbackIdentity, urlGeneration]);
   const ownsMedia = (media: HTMLVideoElement) =>
      visible && urlOwner === currentPlayback.current.identity && urlGeneration === currentPlayback.current.generation && media.currentSrc === url;
   // The envelope describes the original's first track, which every version shares in shape.
   const [loudness, setLoudness] = useState<{ path: string; revision: number; levels: number[] } | null>(null);
   const clipPath = clip?.originalMissing ? undefined : clip?.path;
   const loudnessCurrent = !!loudness && loudness.path === clipPath && loudness.revision === revision;
   useEffect(() => {
      if (!clipPath || !visible || loudnessCurrent) return;
      let current = true;
      void api.loudness(clipPath).then(
         (levels) => current && setLoudness({ path: clipPath, revision, levels }),
         () => current && setLoudness({ path: clipPath, revision, levels: [] })
      );
      return () => {
         current = false;
      };
   }, [clipPath, visible, loudnessCurrent, revision]);
   const fade = usePlaybackFade(video, playbackIdentity, url, urlOwner === playbackIdentity, visible, urlGeneration);
   const targetAllowed = shareableTargetAllowed(clip?.size ?? 0, override ? target : state.preferences.shareSizeMB);
   const job = state.jobs.find((item) => item.clipId === clip?.id && item.kind === "shareable" && ["queued", "running"].includes(item.state));
   const trimJob = state.jobs.find((item) => item.clipId === clip?.id && item.kind === "trim" && ["queued", "running"].includes(item.state));
   useEffect(() => {
      if (previousClip.current !== clip?.id) {
         previousClip.current = clip?.id;
         seek.current = 0;
         // Stepping through a queue while playing keeps playing.
         resume.current = autoplayRef.current;
         setTime(0);
         setVersion(clip?.originalMissing ? "shareable" : "original");
         window.clearTimeout(mixDelay.current);
         setTrack(undefined);
         setShownTrack(undefined);
         setShareId("");
         setTrim(null);
         setOverride(false);
         setTarget(state.preferences.shareSizeMB);
      }
   }, [clip?.id, clip?.originalMissing, state.preferences.shareSizeMB]);
   useEffect(() => {
      if (clip?.originalMissing) setVersion("shareable");
   }, [clip?.originalMissing]);
   useEffect(() => {
      if (!visible) {
         setPlaying(false);
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
      const requestId = crypto.randomUUID();
      switching.current = true;
      setPlaying(false);
      video.current?.pause();
      setLoading(true);
      setMediaError("");
      void (async () => {
         try {
            const prepared = await api.playback(path, requestedTrack, requestId, compatible ? { compatible: true } : undefined);
            // The same file path after a trim replaced it. A new address keeps the old footage from being reused.
            const result = revision ? `${prepared}?revision=${revision}` : prepared;
            if (!disposed) {
               setMediaError("");
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
         void api.cancelPlayback(requestId).catch(() => undefined);
      };
   }, [path, requestedTrack, compatible, visible, playbackIdentity, revision]);
   // Track changes apply to the playing element without reloading it.
   useEffect(() => {
      const media = video.current;
      // The previous clip stays loaded until this one's metadata arrives, which applies the tracks.
      if (
         !media ||
         !clip ||
         version !== "original" ||
         !nativeTrackSelection ||
         !singleTrack ||
         requestedTrack ||
         media.readyState < HTMLMediaElement.HAVE_METADATA ||
         !ownsMedia(media)
      )
         return;
      if (!selectAudioTracks(mediaAudioTracks(media), clip.tracks, selectedTracks) && path) setTrackCopyPaths((paths) => new Set(paths).add(path));
      // selectedTracks follows track and clip.tracks, and ownsMedia follows the url state.
      // eslint-disable-next-line react-hooks/exhaustive-deps
   }, [track, clip?.tracks, url, urlOwner, urlGeneration, version, nativeTrackSelection, singleTrack, requestedTrack, path]);

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
      setShownTrack(value);
      window.clearTimeout(mixDelay.current);
      const apply = () => {
         rememberPlayback();
         setTrack(value);
      };
      if (value.length > 1 || !nativeTrackSelection) mixDelay.current = window.setTimeout(apply, 350);
      else apply();
   };
   // While trimming, playback stays between the handles. Playing from the end starts over at the start handle.
   const play = useCallback(
      (media: HTMLVideoElement) => {
         const range = trimRef.current;
         if (range && (media.currentTime >= lastKeptTime(range) - 0.01 || media.currentTime < range.start)) seeker.seek(range.start);
         return media.play();
      },
      [seeker]
   );
   const seekTo = useCallback(
      (value: number) => {
         const range = trimRef.current;
         const next = range ? Math.min(lastKeptTime(range), Math.max(range.start, value)) : value;
         seeker.seek(next);
         seek.current = next;
         setTime(next);
      },
      [seeker]
   );
   useEffect(() => {
      const media = video.current;
      return media ? seeker.attach(media) : undefined;
   }, [seeker, url]);
   const toggle = () => {
      const media = video.current;
      if (!media) return;
      if (media.paused) void run(() => play(media));
      else media.pause();
   };
   useEffect(() => {
      const media = video.current;
      if (!trim || !media || !playing) return;
      let frame = 0;
      const watch = () => {
         if (media.currentTime >= trim.end - 0.001) {
            media.pause();
            media.currentTime = lastKeptTime(trim);
         } else frame = requestAnimationFrame(watch);
      };
      frame = requestAnimationFrame(watch);
      return () => cancelAnimationFrame(frame);
   }, [trim, playing, url]);
   const clipDuration = duration || clip?.duration || 0;
   // One export per clip at a time, so a clip making a shareable can't be trimmed, and the other way round.
   const trimAvailable = !!clip && !clip.originalMissing && clipDuration > 0 && !trimJob && !job;
   // The sidebar's buttons rise in from the bottom when trimming starts or ends.
   const trimLayer = !!trim || !!trimJob;
   const bottomLayer = useRef<HTMLDivElement>(null);
   const shownLayer = useRef({ trimLayer, clip: clip?.id });
   useLayoutEffect(() => {
      const before = shownLayer.current;
      shownLayer.current = { trimLayer, clip: clip?.id };
      const node = bottomLayer.current;
      if (!node || !visible || before.trimLayer === trimLayer || before.clip !== clip?.id || matchMedia("(prefers-reduced-motion: reduce)").matches) return;
      const animation = node.animate(
         [
            { opacity: 0, transform: "translateY(18px)" },
            { opacity: 1, transform: "translateY(0)" },
         ],
         { duration: 300, easing: "cubic-bezier(.22,.8,.3,1)" }
      );
      return () => animation.cancel();
   }, [trimLayer, clip?.id, visible]);
   const startTrim = useCallback(() => {
      if (!clip || clip.originalMissing) return;
      rememberPlayback();
      setVersion("original");
      setTrim({ start: 0, end: video.current && version === "original" && Number.isFinite(video.current.duration) ? video.current.duration : clip.duration });
      // rememberPlayback reads refs only. The trim always starts from the whole original.
      // eslint-disable-next-line react-hooks/exhaustive-deps
   }, [clip, version]);
   const stopTrim = () => setTrim(null);
   // A request from a library card arrives with the clip it names. Each request starts trimming once.
   const handledTrimRequest = useRef<number | undefined>(undefined);
   useEffect(() => {
      if (!visible || !trimRequest || handledTrimRequest.current === trimRequest.at || clip?.id !== trimRequest.clipId) return;
      handledTrimRequest.current = trimRequest.at;
      startTrim();
   }, [visible, trimRequest, clip?.id, startTrim]);
   const changeTrimRange = (next: TrimRange, edge: TrimEdge) => {
      setTrim(next);
      const media = video.current;
      if (!media) return;
      // The player shows the frame under the handle being dragged.
      media.pause();
      const shown = edge === "start" ? next.start : lastKeptTime(next);
      seeker.seek(shown);
      seek.current = shown;
      setTime(shown);
   };
   const currentClip = useRef(clip?.id);
   useLayoutEffect(() => {
      currentClip.current = clip?.id;
   }, [clip?.id]);
   const saveTrim = () => {
      if (!clip || !trim || trimJob || !trims(trim, clipDuration, clip.frameRate)) return;
      const clipId = clip.id,
         range = trim,
         mode = trimMode;
      void run(async () => {
         if (mode === "replace") video.current?.pause();
         const result = await api.trimClip(clipId, range.start, range.end, mode);
         // A failed or cancelled trim keeps the handles, and main reports why.
         if (!result || currentClip.current !== clipId) return;
         setTrim(null);
         if (mode === "copy") showClip(result);
         else {
            seek.current = 0;
            setTime(0);
            setRevision((value) => value + 1);
            reportFeedback({ kind: "notice", message: "Clip trimmed. The original is in the trash.", error: false });
         }
      });
   };
   // Copies the file on show: the clip, or the chosen shareable. The shortcut reports it in a notice,
   // the button with its own checkmark. Resolves to whether the file was copied.
   const copyShown = useCallback(
      (notify: boolean): Promise<boolean> => {
         if (!clip) return Promise.resolve(false);
         const files = clipFiles(clip);
         const file = version === "shareable" && shareable ? files.shareables[clip.shareables.indexOf(shareable)] : files.original;
         if (!file?.available) return Promise.resolve(false);
         return run(async () => {
            await api.copyFile(file.path);
            if (notify) reportFeedback({ kind: "notice", message: copiedMessage(file), error: false });
         });
      },
      [clip, version, shareable, run]
   );
   // Escape stops trimming, unless it closes a menu or dialog first.
   useEffect(() => {
      if (!visible || !trim || trimJob) return;
      const key = (event: KeyboardEvent) => {
         if (event.key !== "Escape" || event.defaultPrevented || document.querySelector(".select-menu,.floating-menu,[role=dialog]")) return;
         if (document.fullscreenElement) return;
         setTrim(null);
      };
      window.addEventListener("keydown", key);
      return () => window.removeEventListener("keydown", key);
   }, [visible, trim, trimJob]);
   useEffect(() => {
      if (!visible) return;
      const command = (event: Event) => {
         const id = (event as CustomEvent<string>).detail,
            node = video.current;
         if (!clip || !node) return;
         if (id === "playPause") {
            if (node.paused) void run(() => play(node));
            else node.pause();
         } else if (id === "seekBack") seekTo(Math.max(0, node.currentTime - 5));
         else if (id === "seekForward" && Number.isFinite(node.duration)) seekTo(Math.min(node.duration, node.currentTime + 5));
         else if (id === "mutePlayback") toggleMute();
         else if (id === "previousClip") stepBack();
         else if (id === "nextClip") stepForward();
         else if (id === "fullscreen" && player.current)
            void run(() => (document.fullscreenElement ? document.exitFullscreen() : player.current!.requestFullscreen()));
         else if (id === "createShareable" && targetAllowed && !clip.originalMissing && !job && !trimJob && !trimRef.current)
            void run(() => api.createShareable(clip.id, override ? target : undefined));
         else if (id === "showFile" && path) void run(() => api.reveal(path));
         else if (id === "copyFile" && path && !window.getSelection()?.toString()) void copyShown(true);
      };
      window.addEventListener("acroclip-shortcut", command);
      return () => window.removeEventListener("acroclip-shortcut", command);
   }, [visible, clip, override, target, path, run, targetAllowed, job, trimJob, toggleMute, stepBack, stepForward, play, seekTo, copyShown]);
   // A clip counts as viewed once it is on screen, which keeps a later save from merging it away.
   const clipId = clip?.id;
   useEffect(() => {
      if (!visible || !clipId) return;
      const viewed = () => {
         if (document.visibilityState === "visible") void api.clipViewed(clipId).catch(() => undefined);
      };
      viewed();
      document.addEventListener("visibilitychange", viewed);
      return () => document.removeEventListener("visibilitychange", viewed);
   }, [visible, clipId]);
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
      if (clip && targetAllowed && !clip.originalMissing && !job && !trimJob && !trim)
         void run(() => api.createShareable(clip.id, override ? target : undefined));
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
                        <ClipActions
                           createTag={() => setCreatingTag(true)}
                           clip={clip}
                           categories={state.categories}
                           busy={!!job || !!trimJob}
                           canCreate={targetAllowed && !trim}
                           attaCutAvailable={attaCutAvailable}
                           ask={ask}
                           run={run}
                           create={create}
                           trim={trimAvailable && !trim ? startTrim : undefined}
                           remove={(shareableId, scope) => void remove(shareableId, scope)}
                        />
                     </Menu>
                  </HeaderActions>
                  <div className="viewer-metadata">
                     {clip.applicationId && state.applicationIcons[clip.applicationId] && (
                        <ApplicationIcon src={state.applicationIcons[clip.applicationId]} size={14} />
                     )}
                     {clip.source.trim() && clip.source.trim().toLowerCase() !== "unknown" && (
                        <span className="source-label" data-tooltip={clip.source} data-tooltip-overflow="">
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
                        { value: "shareable", label: "Shareable", disabled: !!trim },
                     ]}
                  />
                  {clip.originalMissing && (
                     <p className="permission-note" role="status">
                        Clip missing or changed. Your shareables are still available.
                     </p>
                  )}
                  <div ref={versionContent}>
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
                              {clip.mergedFrom && (
                                 <div>
                                    <span>Extended from</span>
                                    <strong>{clip.mergedFrom} saves</strong>
                                 </div>
                              )}
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
                     {clip.categories.length > 0 && (
                        <div className="viewer-categories" aria-label="Tags">
                           {state.categories
                              .filter((category) => clip.categories.includes(category.id))
                              .map((category) => (
                                 <span key={category.id} className="viewer-category" style={categoryStyle(category.color)}>
                                    <CategoryMark category={category} size={13} />
                                    <span>{category.name}</span>
                                 </span>
                              ))}
                        </div>
                     )}
                  </div>
               </section>
            </div>
            <div className="viewer-sidebar-bottom" ref={versionActions}>
               {/* A trim keeps showing its progress after the player moved away from it and back. */}
               <div className="viewer-bottom-layer" ref={bottomLayer}>
                  {trimLayer ? (
                     <TrimActions
                        trimmed={!trim || trims(trim, clipDuration, clip.frameRate)}
                        mode={trimMode}
                        onMode={setTrimMode}
                        job={trimJob}
                        onSave={saveTrim}
                        onCancel={stopTrim}
                        onCancelJob={(id) => void run(() => api.cancelJob(id))}
                     />
                  ) : (
                     <>
                        <div className="reveal-row">
                           <ConfirmButton
                              label={version === "shareable" ? "Show shareable in folder" : "Show clip in folder"}
                              icon={<FolderOpen size={16} />}
                              disabled={!path}
                              action={() => (path ? run(() => api.reveal(path)) : Promise.resolve(false))}
                           />
                           <ConfirmButton
                              label={version === "shareable" ? "Copy shareable" : "Copy clip"}
                              icon={<Copy size={16} />}
                              disabled={!path}
                              action={() => copyShown(false)}
                           />
                        </div>
                        <div className="reveal-row">
                           <Button className="wide" onClick={startTrim} disabled={!trimAvailable}>
                              <Scissors size={16} />
                              Trim clip
                           </Button>
                        </div>
                        <div className="viewer-create-row" ref={createRow}>
                           <div className="viewer-create-main">
                              <Button
                                 className="primary wide"
                                 onClick={create}
                                 disabled={!!clip.originalMissing || !targetAllowed}
                                 data-tooltip={!targetAllowed ? "Choose a size target no larger than the clip" : undefined}
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
                                       {override && <span className="viewer-create-size">({target} MB)</span>}
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
                              anchor={createRow}
                           />
                        </div>
                     </>
                  )}
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
                        if (!ownsMedia(media)) return;
                        // Chromium drops a video stream it can't decode, such as HEVC without
                        // a platform decoder, and keeps playing the audio. Convert it instead.
                        if (!media.videoWidth && path && !compatible) {
                           setCompatiblePaths((paths) => new Set(paths).add(path));
                           return;
                        }
                        // A prepared mix carries one track. Otherwise the element holds all of them.
                        const tracks = version === "original" && nativeTrackSelection && !requestedTrack ? mediaAudioTracks(media) : undefined;
                        if (tracks && !selectAudioTracks(tracks, clip.tracks, singleTrack ? selectedTracks : selectedTracks.slice(0, 1)) && path) {
                           setTrackCopyPaths((paths) => new Set(paths).add(path));
                           // Only the first track plays until a prepared copy carries the selection.
                           if (!masterSelected) return;
                        }
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
                        if (switching.current || !ownsMedia(event.currentTarget)) return;
                        seek.current = event.currentTarget.currentTime;
                        if (watch.current && !event.currentTarget.paused) watchTick(watch.current, event.currentTarget.currentTime);
                     }}
                     onSeeking={() => watch.current && watchSeek(watch.current)}
                     onPlay={(event) => {
                        if (ownsMedia(event.currentTarget)) setPlaying(true);
                     }}
                     onPause={(event) => {
                        if (ownsMedia(event.currentTarget)) setPlaying(false);
                     }}
                     onEnded={(event) => {
                        if (!ownsMedia(event.currentTarget)) return;
                        if (watch.current) watchTick(watch.current, event.currentTarget.currentTime);
                        resume.current = false;
                        setPlaying(false);
                        // Trimming keeps this clip open, even with autoplay on.
                        if (autoAdvance && queue?.next && !trimRef.current) stepClip(queue.next, true);
                     }}
                     onError={(event) => {
                        if (!ownsMedia(event.currentTarget)) return;
                        if (event.currentTarget.error && path && !compatible) setCompatiblePaths((paths) => new Set(paths).add(path));
                        else setMediaError("This video could not be played. Try opening it in AttaCut or another player.");
                     }}
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
               tracks={version === "original" ? clip.tracks : clip.tracks.length ? [{ index: -1, title: "Master" }] : []}
               track={version === "original" ? (shownTrack ?? clip.tracks.slice(0, 1).map((item) => item.index)) : clip.tracks.length ? [-1] : []}
               speed={speed}
               onSpeed={setSpeed}
               disabled={!url || loading}
               fullscreen={fullscreen}
               onToggle={toggle}
               // While trimming, previous restarts at the start handle and next is off.
               previousTitle={trim ? undefined : queue?.previous?.name}
               nextTitle={trim ? undefined : queue?.next?.name}
               queueLabel={queue && queue.total > 1 ? `${queue.label} · ${queue.index + 1} of ${queue.total}` : ""}
               autoAdvance={autoAdvance}
               onAutoAdvance={changeAutoAdvance}
               onPrevious={stepBack}
               onNext={stepForward}
               loudness={loudnessCurrent ? loudness.levels : undefined}
               preview={clip}
               onSeek={seekTo}
               seeker={seeker}
               onVolume={(next, restore) => {
                  setVolume(next === 0 ? (restore > 0 ? restore : 1) : next);
                  setMuted(next === 0);
               }}
               onMute={toggleMute}
               onTrack={changeTrack}
               onFullscreen={() => void run(() => (document.fullscreenElement ? document.exitFullscreen() : player.current!.requestFullscreen()))}
               trim={trim ? { range: trim, frameRate: clip.frameRate, disabled: !!trimJob, onRange: changeTrimRange } : undefined}
            />
         </div>
         {creatingTag && <CategoryEditor close={() => setCreatingTag(false)} run={run} />}
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
   anchor,
}: {
   defaultTarget: number;
   target: number;
   override: boolean;
   disabled: boolean;
   onOverride: (value: boolean) => void;
   onTarget: (value: number) => void;
   // The whole split button, so the custom size popover lines up with it.
   anchor: RefObject<HTMLDivElement | null>;
}) {
   const [custom, setCustom] = useState(false);
   const [editing, setEditing] = useState(false);
   const [draft, setDraft] = useState("");
   const trigger = useRef<HTMLButtonElement>(null);
   const input = useRef<HTMLInputElement>(null);
   const popover = useRef<HTMLDivElement>(null);
   const valid = draft.trim() !== "" && Number.isInteger(Number(draft)) && Number(draft) >= 1 && Number(draft) <= 2000;
   const commit = () => {
      if (!valid) return false;
      onTarget(Number(draft));
      onOverride(true);
      setCustom(true);
      return true;
   };
   const close = () => {
      setEditing(false);
      trigger.current?.focus();
   };
   useEffect(() => {
      if (!editing) return;
      input.current?.focus();
      input.current?.select();
   }, [editing]);
   return (
      <div
         className="viewer-size-picker"
         onPointerDown={(event) => {
            if (event.target instanceof Element && event.target.closest(".select-trigger")) setEditing(false);
         }}
         onBlur={(event) => {
            // The popover is portaled, so focus moving into it is not leaving the picker.
            if (editing && !event.currentTarget.contains(event.relatedTarget) && !popover.current?.contains(event.relatedTarget as Node | null)) {
               commit();
               setEditing(false);
            }
         }}
         onKeyDown={(event) => {
            if (!editing || !["Escape", "Enter"].includes(event.key)) return;
            event.preventDefault();
            event.stopPropagation();
            // Escape discards the draft. Enter and leaving the field commit a valid value.
            if (event.key === "Escape" || commit()) close();
         }}
      >
         <DropdownSelect
            triggerRef={trigger}
            label={`Shareable size: ${override ? target : defaultTarget} MB${override ? "" : " (default)"}`}
            disabled={disabled}
            iconOnly
            placement="up"
            className="viewer-size-select"
            triggerContent={<ChevronDown size={16} />}
            value={custom && override ? "custom" : String(override ? target : defaultTarget)}
            options={[
               ...Array.from(new Set([10, 20, 50, 100, defaultTarget]))
                  .sort((a, b) => a - b)
                  .map((size) => ({ value: String(size), label: `${size} MB${size === defaultTarget ? " (default)" : ""}` })),
               { value: "custom", label: "Custom" },
            ]}
            onChange={(value) => {
               if (value === "custom") {
                  setDraft(String(override ? target : defaultTarget));
                  setEditing(true);
               } else {
                  setCustom(false);
                  setEditing(false);
                  onOverride(Number(value) !== defaultTarget);
                  onTarget(Number(value));
               }
            }}
         />
         <Popover
            open={editing}
            anchor={anchor}
            onClose={() => setEditing(false)}
            label="Custom shareable size"
            panelRef={popover}
            className="viewer-size-popover"
         >
            <label className="popover-title" htmlFor="viewer-custom-size">
               Custom size
            </label>
            <NumberInput
               inputRef={input}
               id="viewer-custom-size"
               min={1}
               max={2000}
               step={1}
               value={draft.trim() === "" ? NaN : Number(draft)}
               unit="MB"
               aria-label="Shareable size target in MB"
               aria-describedby="viewer-size-range"
               aria-invalid={!valid}
               onValueChange={(next) => setDraft(Number.isNaN(next) ? "" : String(next))}
            />
            <p id="viewer-size-range" hidden={valid} className="popover-note" data-tone="error">
               Enter a whole number, 1 to 2000 MB.
            </p>
         </Popover>
      </div>
   );
}

/** Saving a trim takes the place of creating a shareable: one split button, with Cancel above it. */
function TrimActions({
   trimmed,
   mode,
   onMode,
   job,
   onSave,
   onCancel,
   onCancelJob,
}: {
   trimmed: boolean;
   mode: "copy" | "replace";
   onMode: (mode: "copy" | "replace") => void;
   job: AppState["jobs"][number] | undefined;
   onSave: () => void;
   onCancel: () => void;
   onCancelJob: (id: string) => void;
}) {
   const percent = job ? Math.round(job.progress * 100) : 0;
   return (
      <>
         <div className="reveal-row">
            <Button className="wide" onClick={onCancel} disabled={!!job}>
               <X size={16} />
               Cancel trim
            </Button>
         </div>
         <div className="viewer-create-row">
            <div className="viewer-create-main">
               <Button
                  className="primary wide"
                  onClick={onSave}
                  disabled={!trimmed}
                  busy={!!job}
                  busyIndicator="content"
                  {...(job ? { progress: job.progress } : {})}
                  aria-label={job ? `${job.state === "queued" ? "Waiting to trim" : "Trimming"}, ${percent} percent` : undefined}
               >
                  {job ? (
                     <>
                        <LoaderCircle size={17} className="spin" />
                        <span role="status">{percent}%</span>
                     </>
                  ) : mode === "copy" ? (
                     <>
                        <CopyPlus size={17} />
                        Save as copy
                     </>
                  ) : (
                     <>
                        <Save size={17} />
                        Save
                     </>
                  )}
               </Button>
               {job && (
                  <IconButton className="viewer-cancel-export" label="Cancel trim" onClick={() => onCancelJob(job.id)}>
                     <X size={15} />
                  </IconButton>
               )}
            </div>
            <div className="viewer-size-picker">
               <DropdownSelect
                  label={mode === "copy" ? "Save options: Save as copy" : "Save options: Save"}
                  disabled={!!job}
                  iconOnly
                  placement="up"
                  className="viewer-size-select"
                  triggerContent={<ChevronDown size={16} />}
                  value={mode}
                  options={[
                     { value: "copy", label: "Save as copy" },
                     { value: "replace", label: "Save" },
                  ]}
                  onChange={(value) => onMode(value === "replace" ? "replace" : "copy")}
               />
            </div>
         </div>
      </>
   );
}

/** An icon button that answers a finished action with a checkmark, then its own icon, each bouncing in. */
function ConfirmButton({ label, icon, disabled, action }: { label: string; icon: ReactNode; disabled: boolean; action: () => Promise<boolean> }) {
   // Each change of icon remounts it, which plays the bounce. The first icon shows without one.
   const [phase, setPhase] = useState<"rest" | "done" | "back">("rest");
   const timer = useRef<number | undefined>(undefined);
   useEffect(() => () => window.clearTimeout(timer.current), []);
   return (
      <Button
         className="wide confirm-button"
         aria-label={label}
         data-tooltip={label}
         disabled={disabled}
         onClick={() =>
            void action().then((done) => {
               if (!done) return;
               window.clearTimeout(timer.current);
               setPhase("done");
               timer.current = window.setTimeout(() => setPhase("back"), 1100);
            })
         }
      >
         <span key={phase} className="confirm-icon" data-bounce={phase === "rest" ? undefined : true} aria-hidden="true">
            {phase === "done" ? <Check size={16} /> : icon}
         </span>
      </Button>
   );
}
