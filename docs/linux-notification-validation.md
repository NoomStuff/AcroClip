# Linux notification verification

PR #9 remains draft. Final commissioned sounds are still required. No audio from the reference video was added. No version, release or tag was created for this work.

## Implementation

The optional helper uses host Python 3, PyGObject, Pycairo, Pango and GTK. Wayland requires GTK 4 and gtk4-layer-shell with its introspection typelib. X11 uses GTK 3 and requires an active compositing manager. Capability checks do not inspect distribution names. Missing dependencies and unsupported displays terminate the helper and activate system notification fallback. Linux sound playback uses `paplay` independently of banner startup. Linux native builds stage the executable script, and the local staged-helper smoke compares its bytes against source before exercising it.

When a compositor IPC connection is available, the helper probes Hyprland's Lua layer-rule API for `no_screen_share` and `no_anim`. An unsupported API leaves the banner usable without exclusion. It scopes the rule to `acroclip-feedback`, without modifying a configuration file. Layer-shell alone has no capture-exclusion flag. Other compositors and X11 do not gain exclusion from this rule.

Motion uses separate background and clipped content positions. Repeated entrances start at the current content position. Text changes fade between the previous and current labels. Completion keeps the thumbnail center in place, compresses and rebounds it, flashes white and expands a purple outline. Recording uses dedicated red graphics. Loading spinners do not pulse. GTK's animation preference disables these transitions.

## Verified

- `bun run verify` and real-media checks passed. Windows CI passed verification, media and regular UI checks at `7d97f6a`. The optional interactive job was skipped.
- Hyprland 0.57.0 ran inside a private nested instance on the active Hyprland session. The initial attempt under an older Sway parent failed due to incompatible protocol versions. A compatible parent resolved that failure.
- Run the Hyprland smoke with `ACROCLIP_TEST_PARENT_WAYLAND=/run/user/1000/wayland-1 python3 scripts/smoke-linux-feedback.py Hyprland`. It creates a private compositor, profile and collection directory. It does not record the parent desktop or open a real collection.
- Actual GTK rendering, recording transitions, thumbnail loading from an encoded video, multiple requests in one pipe write, correlated string acknowledgements, muted events preserving a critical error, expiry and correlated rendering failure passed on private Hyprland and headless Sway.
- Hyprland `no_screen_share` changed the banner region to black in real screencopy output. It hides banner contents but does not reveal the background beneath them. The smoke captures actual frames with exclusion off and on, then encodes those frames into `.cache/linux-feedback/Hyprland-capture-exclusion.mp4`. Visible and excluded PNGs are alongside it. This is evidence for the screencopy route, not a claim about every portal or capture implementation.
- `python3 scripts/smoke-x11-feedback.py` passed on private Xvfb/Openbox/xcompmgr. The same desktop without a compositor rejected custom banners. Recording display, preserved critical errors, expiry and rendering failure passed. The smoke can run against `resources/recorder/acroclip-notifier` to check the staged copy.
- Feedback unit tests cover missing executables, synchronous startup failures, process errors, crashes, broken pipes, rendering failures, stale acknowledgements, the two-second display timeout, muted requests, preserved errors and intentional shutdown. System permissions still determine whether fallback can appear.
- Actual Cairo frame checks verify the thumbnail center during compression and rebound, including the overshoot, and verify that replay starts at the current content position. These checks passed locally.
- The tag-order UI test passed three consecutive runs using private X11 and private PipeWire audio after fixing a stale keyboard preview. Checkbox hit testing and the viewer feedback test also passed in Windows CI.

## Release candidate and limits

The Release workflow supports `verify_candidate=true` with an exact `candidate_sha`. This builds and independently verifies Windows x64, Linux x64/arm64 and macOS x64/arm64. Preflight sets `publish=false`, and the publication job requires `publish=true`. Candidate artifacts stay in Actions. No version bump is needed.

The current candidate run is tracked in the PR description. Extra workflow steps for staged-helper drawing and live X11 checks could not be pushed because the connected credential lacks workflow scope. Their patch is retained locally at `.cache/hypr-feedback/release-checks.patch`; the existing five-target candidate workflow runs unchanged. Until it completes, packaged behavior in the pinned Ubuntu environment and macOS verification remain pending. `bun run verify:release` locally runs verification and media checks, then stops at the interactive guard rather than touching the real collection.

Live GNOME/KDE fallback, older Hyprland rule APIs, actual OBS/PipeWire capture exclusion on Hyprland, and final sounds remain unverified. Sway monitor screenshots include the banner. Do not describe Linux capture exclusion as universal, or infer all-desktop support from these tests.

## Candidate result and follow-up

Candidate run 41369896434 finished in about 33 minutes. Windows x64, Linux arm64 and both macOS targets passed independent verification. Linux x64 failed the tag-order UI test, where a still-pending keyboard save masked an unrelated external reorder. The hook now recognizes intermediate orders from its own keyboard sequence and lets unrelated authoritative orders replace the preview. The Wine smoke prefix also moved out of the uploaded evidence tree so its `Z:` symlink cannot lead artifact collection into the host filesystem.

The PR watch reported the regular checks but did not deliver this manually dispatched candidate failure. Treat candidate status as separate from the regular PR checks; a green PR check notification is not evidence that the release candidate passed.

The corrected tag-order UI test passed ten consecutive isolated X11 runs before the candidate retry. The Wine-prefix change was syntax-checked locally; its full native verification remains part of the candidate run.

## Main synchronization

Candidate run 41528695913, attempt 2, passed the final gate and independent verification for all five targets at `c079bfa`. Publication was skipped. The successful retry does not establish a cause for the first attempt's missing audio fixture.

Main advanced to `1dfd034` with capture and library changes and version `0.9.0`. The notification branch merges those changes, preserving the notification save-failure tests, immediate starting feedback, main's audio-warning handling and candidate retry tests, and the external tag-order fix. The version comes from main; this PR does not add another bump. The merged tree requires a new candidate run before its release validation is considered complete.

## Merged candidate meter check

Candidate run 41731470641 passed four target verifications. Linux arm64 failed the meter-routing UI check: after the test enabled the microphone and sent one sample, its displayed level stayed at silence. The test now waits for the enabled microphone meter and publishes a stream until both expected levels arrive. It retains the original thresholds and checks that partial updates preserve the microphone level and muting another source does not affect it. This addresses the single-sample startup race without changing application audio behavior.
