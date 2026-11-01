# Linux notification verification

PR #9 remains draft. Final commissioned sounds are still required. No audio from the reference video was added.

The optional helper uses host Python 3, PyGObject, Pycairo, Pango, and GTK. Wayland requires GTK 4 and gtk4-layer-shell with its introspection typelib. X11 uses GTK 3 and requires an active compositing manager. Capability checks do not inspect distribution or desktop names. Linux sound playback uses `paplay` independently of banner startup. Missing dependencies or unsupported displays terminate the helper and activate the existing system notification fallback. The helper is staged as an executable script by the Linux native build.

Verified locally on November 2, 2026:

- `bun run verify` passed, including strict types, unit tests, and the application build.
- `bun run test:media` passed with real media. The existing streaming Matroska fixture change was already present in the PR branch.
- `python3 scripts/smoke-linux-feedback.py sway` passed on a disposable headless Sway desktop. It exercised real GTK drawing, correlated string acknowledgements, recording transitions, muted events preserving a critical error, expiry, and a correlated invalid-artwork failure. Screenshot and compositor logs are under `.cache/linux-feedback/`.
- A private Xvfb display with Openbox and xcompmgr displayed and acknowledged the GTK 3 banner. The same display without xcompmgr rejected custom banners. This verifies both composited X11 and the unsupported-display decision.
- Feedback unit tests cover missing executables, synchronous startup failures, process errors, crashes, broken pipes, rendering failures, stale acknowledgements, the two-second display timeout, muted requests, preserved errors, and intentional shutdown. OS notification permissions still determine whether fallback can appear.

Not verified:

- Hyprland live rendering. A private direct instance failed during backend creation. A nested instance under headless Sway failed with `invalid version for global xdg_wm_base: expected at most 5, got 6`. The smoke runner retains this attempt as `python3 scripts/smoke-linux-feedback.py Hyprland`. Do not infer Hyprland support from Sway results.
- Linux screen-capture exclusion. The Sway `grim` screenshot includes the layer-shell banner. Layer-shell does not provide capture exclusion. Window capture can omit unrelated windows, but monitor capture exclusion is not established. Windows and macOS exclusion implementations were not changed.
- Other Wayland desktops, including desktops without layer-shell. Their startup rejection uses the same fallback mechanism, but no live GNOME or KDE test ran.
- `bun run verify:release` passed verification and media checks, then stopped at the interactive isolation guard. The private Linux UI runner could not start because this host lacks the `pulseaudio` executable. It did not access a real profile or collection.
- Latest macOS changes on a Mac, native Linux helper packaging in the pinned Ubuntu toolchain, full capture/export UI suites, or final sound assets.

These gaps remain before calling the whole PR verified. Do not merge, publish, tag, or bump the version based on these checks.

The previous Windows CI run also exposed checkbox hit testing and a viewer test that expected the removed main-process toast event. The checkbox now has a hit area matching its switch. The viewer test exercises the renderer feedback event used by rejected UI actions. These changes await the next isolated CI run.
