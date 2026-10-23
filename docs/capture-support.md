# Capture and sharing support

This document says what each platform captures, how saving and sharing behave, and what the release-candidate verification runs actually exercise. It describes behavior, not numbers. Each release's packaged `provenance.json` files record the exact media and recorder builds, and each release asset shows its SHA-256 digest on GitHub.

## Verified scope

The rows name what release verification performs in CI, or did on real development hardware where noted. A machine that is not in these rows is unmeasured, not unsupported.

| Area          | Verified during release checks                                                                                                                                                                                                                                                                                                                                    |
| ------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Windows       | Real screen and selected-application capture, Auto game capture, hardware encoding plus the explicit software fallback, queued saves, and full recording-and-sharing runs in the packaged installer and portable executable                                                                                                                                       |
| Linux X11     | Real screen recording with PulseAudio tones, device and selected-application audio including recovery, interrupted-recorder recovery, and packaged AppImage recording, playback, and sharing. Application capture falls back to an exact-window CPU method when a driver cannot import the window texture. A Wine target proves Windows game identity and capture |
| Linux Wayland | Screen capture through the system picker portal, including cancelled pickers, actual frames, audio, permission prompts, and stream-loss recovery in an isolated Sway session; exact XWayland and Wine application pixels with audio-privacy checks                                                                                                                |
| macOS         | Real screen and window recording with generated audio through ScreenCaptureKit, application and system audio, native feedback behavior, and packaged DMG/ZIP recording and sharing                                                                                                                                                                                |

Microphone gain, mute, and selected-application audio also passed real tone checks on Windows development hardware. Source-correspondence kits exist for every platform and an installer stays unpublished while its kit is incomplete.

## Capture sources

The recording page offers Screen, App, and Auto.

- Screen records a display.
- App records one application window and its audio. App candidates come from the recorder on Windows; the App tab disables itself on sessions where application capture has no backend.
- Auto matches running windows against a locally cached game catalog plus games you add. Until a match is captured, Auto reports what it is waiting for. Refresh uses a public endpoint and sends nothing local; when it fails, cached entries, a small built-in list, and your own games keep working. The screen fallback stays off until you enable it, and switching to an ordinary application keeps the current game instead of jumping away.

The live preview shows only the selected source, with no audio, and is unavailable where the platform cannot provide it (native Wayland sessions). It is released when you leave the recording page, minimize, or close to the tray; recording never depends on it.

On Wayland, global shortcuts depend on the desktop's GlobalShortcuts portal with the app's launcher identity. Packaged AppImages create an owned reverse-DNS launcher so the portal can attribute the binding; when your desktop cannot register it, binding a launcher command to the app path plus `--clip` saves a clip through the running app without opening its window.

## Audio

Audio rows are Source audio, Microphone, and any Application, Input device, or Output device rows you add, each with enable, mute, and volume. The recorder mixes enabled rows; a printable "Audio unavailable" message appears where a row cannot be honored. On Linux, selected-application audio monitors the verified PulseAudio streams of that process and its children and never substitutes desktop audio.

The clip viewer plays the original or a shareable with a per-track selector, so individual audio tracks are previewable inside the app before sharing. Shareables use only the master mix, the first audio track.

## Saving and sharing

Clips save instantly from a rolling history and keep their request endpoints while writing is queued, so saving delays never shift the moment you asked for. Saved clips overlap by default; the optional overlap reduction starts near the previous successfully saved moment, and a preceding keyframe can leave a small overlap.

- Originals are MKV files, chosen so interrupted saves stay recoverable. MP4 playback copies are made on demand and never replace the original.
- Shareables are MP4 with H.264 video and the master audio mix, encoded in two passes under your size target. The completed file is verified for size, duration and audio before publication; a budget too small to hold the full clip produces an error instead of a truncated file.
- Metadata lives in the collection folder under `.acroclip`, thumbnails under `.acroclip/thumbnails`, and on-demand playback copies under `.acroclip/playback`. Shareables live under `shareables`, mirroring the original's folders, with an ownership marker that refuses to export into someone else's existing `shareables` folder.
- Moving a whole collection preserves categories and original/shareable links, because clips are re-related by sampled file identity, not absolute paths. Existing supported videos in the folder appear in the library without registration.
- A damaged metadata file disables further metadata writes and tells you, but the videos stay fully usable. Deleting a clip moves its files to the trash rather than overwriting anything.

## Not yet verified

- Physical sleep and audio device hotplug while recording.
- Hardware HDR recording.
- Notification visibility over hardware-exclusive fullscreen.
- Fresh physical Mac permission grants and revocation flows.
- Authenticated Steam-launched Linux Proton session tests.
