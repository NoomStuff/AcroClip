## Setup

Install [Bun](https://bun.sh/) 1.4.2 or later. Building the native recorder on Windows needs CMake and Visual Studio Build Tools with the Desktop development with C++ workload.

```sh
git clone https://github.com/NoomStuff/AcroClip.git
cd AcroClip
bun install
bun run dev
```

Development runs work without the native helper, but recording stays unavailable until it is built. The UI does not pretend otherwise.

## Media builds

`bun scripts/provision-media.ts` downloads checksum-pinned FFmpeg and ffprobe builds for Linux and macOS development and records their paths. `bun run bundle:media` stages those binaries for the app build. For a plain local shell, set `FFMPEG_PATH` and `FFPROBE_PATH` to the printed locations. You can also point those variables at compatible binaries, but a development override does not establish release source correspondence.

Windows media is a controlled FFmpeg build rather than a provider download. In Ubuntu 24.04, including WSL, install `gcc-mingw-w64-x86-64`, `g++-mingw-w64-x86-64`, `binutils-mingw-w64-x86-64`, `make`, `nasm`, `meson`, `ninja-build`, and `pkg-config`. Run `bun scripts/release-sources.ts --controlled-inputs --collect-only`, then `bash scripts/build-media-windows.sh` in Ubuntu. Back in Windows, run `bun scripts/controlled-media.ts` to execute the binaries and record their provenance, then stage with `bun run bundle:media`.

macOS media follows the same controlled recipe: `brew install ffmpeg-full meson ninja pkg-config nasm`, then `bun scripts/release-sources.ts --controlled-inputs --collect-only`, `bash scripts/build-media-macos.sh`, and `bun scripts/controlled-media-macos.ts`.

## Recorder builds

| Host    | Command                               | Needs                                                                                                                                                                                                                                     |
| ------- | ------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Windows | `bun run build:native`                | CMake, VS Build Tools; downloads the pinned OBS runtime                                                                                                                                                                                   |
| Linux   | `bun scripts/build-native-linux.ts`   | The OBS PPA package `obs-studio=32.2.0-0obsproject1~noble` on x64, plus `cmake g++ make pkg-config patch python3 libx11-dev libxcb-composite0-dev libpulse-dev libsimde-dev libwayland-dev libglib2.0-dev libpipewire-0.3-dev libdrm-dev` |
| macOS   | `bun scripts/build-recorder-macos.ts` | Xcode command line tools; verifies pinned OBS frameworks before staging                                                                                                                                                                   |

## Common commands

| Command                         | Purpose                                                                      |
| ------------------------------- | ---------------------------------------------------------------------------- |
| `bun run dev`                   | Start the app                                                                |
| `bun run verify`                | Check formatting, lint, unit tests, and build                                |
| `bun run test`                  | Run unit tests                                                               |
| `bun run test:media`            | Run media tests against isolated real videos                                 |
| `bun run test:ui`               | Build the app and run UI tests                                               |
| `bun run test:ui:native`        | Run UI tests that exercise real capture against the native recorder          |
| `bun run test:native`           | Run the recorder smoke test on the current host                              |
| `bun run test:packaged`         | Run recording and media checks against a packaged build                      |
| `bun run test:native:lifecycle` | Run the recorder start/stop lifecycle smoke test                             |
| `bun run test:capture-loss`     | Record a source longer than the configured history, lose it, verify recovery |
| `bun run format`                | Format the repository                                                        |

`verify` covers formatting, lint, unit tests, strict types, and the application build. Run it after edits. Capture, audio, and sharing invariants are checked against actual media, not simulated: media tests create isolated videos and check full-duration size-limited exports, original preservation, cancellation, playback tracks, moved collections, and metadata recovery. Recording and export changes need this actual-media treatment plus the failure cases; a build that compiles does not establish working capture.

`ACROCLIP_PROFILE`, `ACROCLIP_COLLECTION`, and `ACROCLIP_TEST=1` isolate manual or automated runs from your real preferences, collection, and OS startup state. The tests set them automatically. Never point destructive tests at a real collection.

## Release process

Bump the version in `package.json` for the changes being made (not every change needs a release), and push a `v*` tag when it is ready. CI runs the checks on main, so verify locally first.

The Desktop builds workflow runs on the tag and produces private release candidates for Windows x64, Linux x64 and arm64, and macOS x64 and Apple Silicon. It never publishes anything.

A release becomes public only once its corresponding-source kit passes:

1. The controlled media and recorder recipes record provenance for the exact binaries bundled into the app, and the release kits stage the matching sources, licenses, and build evidence for them.
2. `bun scripts/release-sources.ts --collect-only` collects core and dependency sources; `bun scripts/assemble-source-evidence.ts` archives the clean commit, verifies Electron's playback `ffmpeg.dll` against the official Electron archive with its full dependency closure, and populates native notices. Package again after assembly.
3. Each platform assembles and checks its kit: `bun scripts/package-source-kit.ts` (shared), `bun scripts/package-linux-source-kit.ts`, and `bun scripts/package-macos-source-kit.ts`, with `bun scripts/verify-release.ts`, `bun scripts/verify-linux-release.ts`, and `bun scripts/verify-macos-release.ts` recompiling the clean source and comparing installer payloads, packaged resources, and updater files against the kit.

The checkers report technical completeness, not a legal conclusion. Review the recorded inputs against the binaries before publishing. Upload all assets into a GitHub draft, verify their sizes and digests, then publish. Public releases carry app downloads only; corresponding sources are published separately from the app downloads. When re-verifying an existing release, check out its version tag first: the kit covers that immutable commit, not later changes.

Installers stay unpublished until the kit checks pass and the correspondence has been reviewed.

## License

AcroClip is released under the [GPL-3.0-or-later license](LICENSE). Contributions are released under the same license. Code reused from AttaCut keeps its [MIT notice](licenses/AttaCut-MIT.txt). Run `bun run build:notices` to regenerate [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md) after dependency changes.
