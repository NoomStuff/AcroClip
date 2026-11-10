# Linux notification verification

What was verified on Linux for 0.20.0's capture banners and sounds, and what wasn't.

## How the Linux banner works

`native/notifications/linux.py` is an optional helper that runs on the host's Python 3, PyGObject, Pycairo, Pango and GTK. It ports the Windows banner in `native/notifications/windows.cpp`: the same geometry, motion, glyphs, colors, text transitions, lifetimes and error wording. On Wayland it needs GTK 4 with gtk4-layer-shell and its typelib. On X11 it needs GTK 3 and a running compositing manager. It checks capabilities, not distribution names. If a dependency is missing, the display isn't supported, the helper crashes or the pipe breaks, or a correlated display acknowledgement doesn't arrive within two seconds, `Feedback` switches to system notifications.

The system fallback shows the banner's title and detail. It doesn't post again while a busy notice like "Starting capture..." only changes its detail. Unreadable artwork leaves an empty tile instead of failing the banner, as on Windows. Clicks pass through the banner, and it never takes keyboard focus.

Sounds play through `paplay`, which AcroClip starts directly, independently of the banner helper. `paplay` plays all six commissioned files, including the five 24-bit WAVE_FORMAT_EXTENSIBLE ones.

On Hyprland, the helper sets a scoped Lua `hl.layer_rule` with `no_screen_share` for the `acroclip-feedback` namespace. The first banner waits for the rule. Later checks run off the GTK thread. Hyprland covers an excluded surface with black in screencopy output, so a screen share shows a black rectangle where the banner is, not the content behind it. Other compositors and X11 have no exclusion.

## Verified on 2026-11-10

Everything ran on one Arch machine: an Intel i5 8th gen with Hyprland 0.57.2, Sway 1.12, niri, GTK 4.24.1, gtk4-layer-shell 1.3.0 and PipeWire. Each desktop ran privately in its own user, mount and network namespaces, with a private `/tmp`, D-Bus, PipeWire, profile and collection. Nested compositors ran on the parent Wayland socket. The app was a development build of this branch. The native recorder came from the published 0.19.0 AppImage, and its source is unchanged since 0.16.0.

Real app, real capture, private nested Hyprland with XWayland and xdg-desktop-portal-hyprland:

- Auto with a game already running shows "Capture started" with the game's name and no "Now capturing". The start banner appears on the start request and keeps its title while the detail changes.
- Closing the game shows "Stopped capturing game" 3.1 s later, with the banner turned on. Reopening it shows "Now capturing".
- A focused window opening and closing in under 2 s shows nothing.
- App mode: hiding the chosen window shows "Capture paused" after 3 s, and showing it again shows "Capture resumed" ("was found again"). Hiding it for 1 s shows nothing.
- App mode: closing the chosen application shows "Starfall closed. Reopen it and choose it again." Linux capture follows one window of one process, so a reopened application can't resume on its own.
- A source switch in the settings mid-capture shows no found, lost or resumed banner.
- Capture on launch, outside test mode with a game running, showed no banner.
- Saves: "Saving clip…", then "Clip saved" with the clip's own thumbnail. A save in the extend window shows "Clip extended to 0:12" and "Added 0:05 to the previous clip". Opening the clips while the merge runs shows "Saved as a separate clip" without a second chime.
- Failures: a locked collection folder shows "Couldn't save clip" with the recorder's reason. Killing the recorder shows "Capture stopped unexpectedly" and "Start capturing again.". Stopping shows "Capture stopped".
- Low storage, from a collection on a filesystem with under 1 GiB free, shows "Low storage in clip folder" and "Free up space so new clips can save." with no sound.
- Hyprland's `no_screen_share` rule hid every banner from screencopy as a black rectangle, and the banners appeared when the rule was off.

Other desktops:

- Composited X11 (Xvfb, Openbox, xcompmgr): the same Auto, save, extension, correction and crash banners, drawn by the GTK 3 path.
- X11 without a compositor: the helper exits with "X11 desktop has no compositing manager". Every notice then reached a private `org.freedesktop.Notifications` server with the banner's title and detail. "Starting capture..." posted once.
- Sway and niri, nested with no ScreenCast portal: the layer-shell banner displayed and was acknowledged. The capability error appeared as "Capture needs attention" or "Couldn't start capture" with "The system portal cannot share a screen".
- Helper smokes, `scripts/smoke-linux-feedback.py` and `scripts/smoke-x11-feedback.py`, passed on Hyprland, Sway and X11. They cover display acknowledgements, recording transitions, several requests in one pipe write, muted requests keeping a visible error, expiry and unreadable artwork.
- `scripts/check-feedback-render.ts` now also runs against the Linux helper's `--render-proof`. Across 28 frames at 100%, 125%, 150% and 200% scale, the thumbnail center stayed fixed through compression and rebound.
- Every banner state was rendered to PNG and compared against the Windows demo.

Fixes from these runs:

- The Linux helper was drawing an older design. It now matches Windows, including the paused glyph and the inset application icon.
- A settings switch announced the new source as found.
- App mode briefly said "Waiting for game".
- A crash whose message only repeated the title showed the title twice.
- An empty window thumbnail turned off the Linux banner for the rest of the session.
- The system fallback spammed "Starting capture..." with no detail.
- A refused Start clicked in the window raised the desktop error banner.

## Not verified

- Banner exclusion inside an actual AcroClip screen recording on Hyprland. In this setup the 0.19.0 recorder segfaults in OBS's PipeWire portal connect (`obs_pipewire_connect_fd`, `pw_thread_loop_get_loop`) before the first frame, with both software and hardware GL. This is native capture code that this branch doesn't change. App-mode capture over XWayland never includes the banner, because it records one window.
- The 10 s game-hook allowance against real games. Linux capture doesn't hook games, so that allowance never applies here.
- A real Steam game. Fixture windows (ffplay, GTK) stood in, and Auto matched them as a custom game.
- GNOME, KDE and other desktops without layer-shell or a compositor on Wayland. The X11 fallback path is the closest live check.
- Hyprland before the Lua rule API. There the banner works without exclusion.

Don't describe Linux capture exclusion as universal. It applies on Hyprland with the Lua rule API, and there it shows as black.

## Reproducing

Never run a nested compositor with Xwayland unless it's isolated. A nested Hyprland can take the host's `:0` and remove `/tmp/.X11-unix/X0` when it exits. The banner smoke turns Xwayland off for that reason. For runs of the full app, wrap the harness in `unshare --user --map-root-user --mount --net`, mount a tmpfs over `/tmp`, bring up `lo`, then run it under `unshare --user --map-user=1000 --map-group=1000`.
