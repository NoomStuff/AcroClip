# AttaClip first-time Windows GUI test

Date: 2026-10-14
Result: Blocked by computer-use screenshot capture failure. No product behavior claims.

## Scope and isolation

Requested executable: D:/Coding/AttaClip/work/fullscreen-fix-preview/win-unpacked/AttaClip.exe

Launched visibly using Start-Process. The launch returned PID 3132.

Unique test root: C:/Coding/AttaClip-UI-tests/fresh-user-57f521eab60241419017ddceddd63b23

ATTACLIP_PROFILE: C:/Coding/AttaClip-UI-tests/fresh-user-57f521eab60241419017ddceddd63b23/profile

ATTACLIP_COLLECTION: C:/Coding/AttaClip-UI-tests/fresh-user-57f521eab60241419017ddceddd63b23/collection

ATTACLIP_TEST was removed from the launching process environment. No source code, project instructions, README, specification or previous report was read. No implementation changes were made.

An AttaClip window already existed before launch, with window ID 46402302. It was left alone. After the isolated launch, list_windows returned an additional AttaClip window with ID 131286. The test selected only that new window.

## Blocking failure

What I tried: Select the newly returned AttaClip window, activate it, and capture its screenshot and accessibility text through the installed computer-use skill and @oai/sky Windows APIs.

What happened: get_window_state failed with the exact message:

`window capture timed out: timed out waiting on channel`

Expected: A screenshot of the visible first-launch UI, allowing inspection and real clicks.

Recovery: Refreshed list_windows, uniquely selected the new window again, rehydrated it with get_window, activated it and retried get_window_state once. The retry returned the same exact error. Stopped Windows automation as required by the documented recovery instructions.

Reproduction steps:

1. Initialize @oai/sky and call list_apps.
2. Launch the executable visibly with the isolated environment paths above.
3. Call list_windows and select the newly added AttaClip window.
4. Call get_window, activate_window and get_window_state with include_screenshot and include_text true.
5. Observe the capture timeout.
6. Refresh window selection and retry once. Observe the same timeout.

Evidence: Tool output confirmed two distinct AttaClip window IDs after launch and returned the error above on both capture attempts. No screenshot payload or accessibility tree was returned. No screenshot files are available.

This is a test-infrastructure failure, not a confirmed AttaClip functional bug. The observations do not establish whether the desktop was locked or whether AttaClip rendered correctly. No accessible labels were used as a substitute for the visual test.

## Coverage

Passed: The isolated launch produced an additional targetable window in the Windows tool inventory. This is launch evidence only, not a GUI usability pass.

Not tested: First setup, capture source selection, recording start, save button, save shortcut, finding clips, playback, shareable creation and comparison, navigation while recording, settings changes, close to tray and return, stop and exit, fullscreen capture, and actual generated footage or shareable validation.

No functional bugs, UX friction or visual preference findings can be supported because no screenshot was observable and no product controls were clicked.

## State left behind

The isolated test instance was left running because no GUI interaction was possible and the instructions required stopping after failed recovery. The existing user instance was not stopped. No recording was intentionally started, no startup setting was changed, no files were deleted and nothing was published.
