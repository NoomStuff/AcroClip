# Design references

These files preserve the material behind the product discussions and UI review. The original source files remain unchanged. The current working decisions are in [product.md](../product.md), and verified behavior and known limits are in [development-status.md](../development-status.md).

## Mockups

Open [AcroClip.excalidraw](mockups/AcroClip.excalidraw) in Excalidraw to edit the original canvas. The canvas also contains earlier sketches for other work. The four PNGs below isolate the AcroClip views that Dave shared.

| View                                  | Original image                         |
| ------------------------------------- | -------------------------------------- |
| Recording, source selection and audio | [recording.png](mockups/recording.png) |
| Library and grouping                  | [library.png](mockups/library.png)     |
| Clip viewer                           | [viewer.png](mockups/viewer.png)       |
| Settings layout                       | [settings.png](mockups/settings.png)   |

These sketches show the intended layout and visual direction. They are not a requirement to copy every label, border or control. The shared recording-status strip was omitted from the sketches but remains part of the design. The viewer and settings details were left for refinement in the app.

The visual direction is purple accents on a near-black background, lighter rounded cards, few borders, smooth transitions and button feedback for shortcuts. AttaCut is a reference for useful controls and interaction feedback; AcroClip has its own full-page layout.

## Original proposal and diagnostic reference

[Friends plan](reference/friends-plan.md) is the original proposal, copied from the supplied document. Later product discussions changed its scope, including deferring multiple clip lengths, keeping trimming in AttaCut and preserving shareables. Treat it as historical reference rather than an additional feature checklist.

[Preview probe](reference/preview-probe.cjs.txt) preserves the standalone Electron display-capture diagnostic that was outside the repository. The `.txt` suffix keeps this historical script out of normal execution and linting. It contains machine-specific paths and changes capture permissions inside its isolated test process. It is not a supported test command or evidence that a user flow passed.

## Fresh-user test attempts

Both reports below describe blocked computer-use attempts on 14 October 2026. Neither completed recording or sharing flows, and neither establishes a product bug or a successful usability review.

- [Fresh subagent report](../reviews/2026-10-14-fresh-user-subagent.md), including accessible-text observations and failed screenshot/input recovery.
- [Separate chat report](../reviews/2026-10-14-fresh-user-thread.md), from a new chat without inherited product or code context.

The local paths and process IDs inside the reports record those historical runs. They are not paths or IDs to reuse. No usable screenshots or output clips came from those attempts.

## What was preserved

The editable canvas, four mock images and original proposal came from the supplied Downloads and temporary attachment files. The reports came from the ignored test directory and the separate chat's output directory. The preview probe came from the parent Coding directory. Originals were copied, not moved or deleted.

Runtime profiles, recordings, build outputs, raw diagnostic logs and unrelated documents are not design references and were not added. The earlier visualization directory associated with this chat was checked and contained no files to preserve.
