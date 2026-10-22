# Test execution isolation

`bun run verify` and `bun run test:media` run locally. They compile code, inspect files and decode generated media without opening app windows or rendering sound.

Interactive UI, packaged playback, portable, installed-upgrade and Windows native checks run in a disposable Windows CI machine. Their real windows, focus changes, keyboard events, capture, playback and installer interactions stay inside that machine. VB-CABLE supplies its private playback endpoint. The endpoint identity must match the active Core Audio default before a test starts. Audio signals remain present and measurable.

Run `bun run test:isolated ui`, or the ordinary suite command such as `bun run test:ui`. The runner requires a clean working tree and finds a remote branch at the exact local commit. It dispatches that revision and reports the actual CI result. It never stages, commits, pushes, snapshots or uploads local files. If local files change while CI runs, the result is explicitly limited to the committed revision and the command fails to claim local verification.

A dirty or unpushed working tree cannot run these checks on the personal desktop. The command reports that the tests did not run. Keep those edits local and use a separately provisioned isolated environment to test them. A remote main result does not cover different local source.

Available suites are `ui`, `ui-native`, `packaged`, `portable`, `installer`, `native`, `lifecycle`, `capture-loss`, `fullscreen`, `feedback`, `audio`, `audio-monitor`, `additional-audio`, `game-capture`, `overlap` and `resolution-limits`. Direct Playwright, installer and native fixture entry points also reject the personal desktop. The CI marker is set by the hosted workflows after private audio setup. It is not a request to set environment variables on the personal desktop.

Hardware encoder, game-hook and exclusive-fullscreen assertions remain unchanged. A standard hosted VM may lack a required GPU capability. Such a failure is not a pass or a skipped substitute. Configure the `ISOLATED_WINDOWS_RUNNER` repository variable with a suitable disposable GitHub-hosted GPU runner label for those suites. Self-hosted personal desktop runners are refused.

Linux's existing private Xvfb or headless Wayland session and private PulseAudio null sink remain available locally. Those harnesses create their own runtime directory and audio socket. They do not use the user's display, PulseAudio server or physical playback output. macOS interactive proofs run in disposable Mac CI, preserving their real ScreenCaptureKit, audio, gain, isolation and failure checks.

The release candidate still requires its platform checks, source correspondence, packaged behavior and Windows installed-upgrade tests. Test isolation does not authorize publication or replace source review.
