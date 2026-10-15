# Fresh user UI test, setup evidence

Test profile and collection are isolated at D:/Coding/AttaClip/.cache/fresh-user-ui-test/pass-20261014-1854.
Executable: D:/Coding/AttaClip/work/fullscreen-fix-preview/win-unpacked/AttaClip.exe.

No project code, documentation or previous test report was inspected. Only the required computer-use skill documentation was read.

## Setup limitation

Start-Process -WindowStyle Hidden launched the app with the three instructed environment variables. The first instance exposed no window. Launching a second time with identical isolation variables exposed an AttaClip window. This is test setup evidence, not a product bug, because the required Hidden flag may explain the initial behavior.

Native Windows screenshot capture failed twice, including after recovering the current returned window and activating it. Errors were 'FrameArrived timed out: timed out waiting on channel' and 'window capture timed out: timed out waiting on channel'. Accessible text worked. I paused UI input under the computer-use skill's recovery rule.

## First impressions from accessible text only

The app opens with a six-step setup: Capture, Audio, Clips, Quality, Sharing, Ready. The first page explains screen capture, application capture and following a game automatically. This makes the basic choices understandable. 'Saved locally. Nothing uploaded.' gives a useful, specific promise.

Screen choices are named Screen 1, Screen 2 and Screen 3. A newcomer with several monitors needs their previews to identify the right one. Screenshot capture was unavailable, so I cannot judge whether the previews solve that problem.

The page behind onboarding has explicit Start recording, a disabled Clip it with Ctrl + Shift + F8, and Recording, Library, Clip viewer and Settings navigation. Those names make the main workflow discoverable in the accessibility tree. I cannot assess their visual prominence.

'Opening preview…' remains in the accessible tree several minutes after launch. It may be caused by the same unavailable graphics capture environment. Do not classify it as a recording bug without another pass.

## Not completed

No onboarding action, source selection, recording, save shortcut, playback, shareable creation, version comparison, settings edit, tray return, fullscreen recording or media verification has been performed yet. No output media exists. No screenshot evidence is available. No implementation files or user collection were modified.

## Accessibility action recovery

A fresh list_windows inventory exposed no LockApp or lock-screen window. Refreshed text-only state succeeded. Clicking the observed onboarding App control, index 81, returned 'coordinate input geometry is unavailable'. A new focus observation showed only the window itself. Pressing Tab and refreshing left that focus unchanged. Invoking the observed window's supported Raise secondary action also left focus unchanged. This is an automation/setup limitation, not an app discoverability finding. No onboarding control was successfully activated.

## Visible launch recovery

The parent authorized stopping only the owned isolated instance and relaunching the interactive app with WindowStyle Normal. I stopped its four known PIDs and relaunched with the same isolated profile and collection. ATTACLIP_TEST was removed. The new root PID is 29764; child PIDs are 42004, 49780 and 47784. No other process was stopped.

A fresh returned AttaClip window, id 46402302, exposed onboarding text. Native screenshot capture again returned 'window capture timed out: timed out waiting on channel'. After fresh window inventory and successful text-only state, clicking the current App control, index 81, again returned 'coordinate input geometry is unavailable'. The visible relaunch rules out the Hidden flag as the sole cause of unusable automation.

## Final result

The test is inconclusive. It produced no defensible functional bug, visual preference or completed recording flow. The only successful product observation is accessible-text discovery of the first onboarding page and main actions. Do not represent this report as a usability pass or capture validation.

A normal newcomer would expect the Capture setup to accept a source choice. The test could not establish the app's actual response because the automation tool rejected the action before any observable UI change. Severity is a blocking test-tool limitation. Reproduction is to launch the isolated app visibly, obtain text-only state with the documented sky runtime, and click the App index from that fresh tree. The error is coordinate input geometry is unavailable.

All requested later flows remain untested: audio setup, recording start, UI save, shortcut save, playback, shareable creation and comparison, settings, leaving Recording, close to tray and return, UI stop and exit, fullscreen capture, actual media/audio verification. Collection contains no saved footage. Screenshot directory cannot contain useful images because capture never succeeded.

The visible isolated app is left open and not recording to allow the parent to inspect the test-tool issue. No user collection, private screen capture, implementation, project documentation or system settings were touched.

## Final runtime reset

The documented node_repl js_reset completed. I imported @oai/sky anew, obtained a fresh list_windows inventory and reacquired the returned AttaClip window. No stale binding or index was reused.

Returned window metadata: app process:D:\Coding\AttaClip\work\fullscreen-fix-preview\win-unpacked\AttaClip.exe, id 46402302, title AttaClip.

Fresh screenshot-plus-text state still failed with FrameArrived timed out: timed out waiting on channel. I stopped UI actions. A subsequent text-only state succeeded and is saved in state-metadata.json, including the complete accessibility tree, document text, focused element and returned window metadata. Screenshots array is empty. Focus is 0 window AttaClip Secondary Actions: Raise. The state remains first onboarding page, Not recording and Opening preview.

The runtime reset did not repair screenshot capture. This report does not infer monitor or display status from console activity.
