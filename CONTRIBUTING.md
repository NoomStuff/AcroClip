# Contributing

## Setup

You need [Bun](https://bun.sh/) 1.4.2 or later.

```sh
git clone https://github.com/NoomStuff/AcroClip.git
cd AcroClip
bun install
bun run dev
```

The app runs without the native recorder, but recording stays unavailable until you build it (see below).

## Before you open a PR

Run `bun run verify`. It checks formatting, lint, unit tests, types, and the build. `bun run format` fixes formatting.

If you touch capture, audio, export, or playback, also run `bun run verify:release`. It adds the media, UI, and native capture tests. These tests use real video files and real capture, so a passing build alone doesn't prove recording works.

Tests run in an isolated profile automatically. For manual runs, set `ACROCLIP_PROFILE`, `ACROCLIP_COLLECTION`, and `ACROCLIP_TEST=1` to keep your real settings and clips out of it. Never point destructive tests at a real collection.

## Commands

| Command                     | What it does                                            |
| --------------------------- | ------------------------------------------------------- |
| `bun run dev`               | Start the app                                           |
| `bun run verify`            | Formatting, lint, unit tests, types, and build          |
| `bun run verify:release`    | `verify` plus media, UI, native UI, and capture-loss    |
| `bun run test`              | Unit tests                                              |
| `bun run test:media`        | Exports, playback, and metadata against real videos     |
| `bun run test:ui`           | UI tests in the built app                               |
| `bun run test:ui:native`    | UI tests with real capture                              |
| `bun run test:native`       | Recorder smoke test                                     |
| `bun run test:packaged`     | Recording and media checks against a packaged build     |
| `bun run test:capture-loss` | Lose a capture source mid-recording and check recovery  |
| `bun run build:notices`     | Regenerate JavaScript dependency notices after upgrades |

## Building the recorder

| Platform | Command                               | Requirements                                                                                                                                                                                                                                |
| -------- | ------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Windows  | `bun run build:native`                | CMake and Visual Studio Build Tools (Desktop development with C++). Downloads the pinned OBS runtime.                                                                                                                                       |
| Linux    | `bun scripts/build-native-linux.ts`   | x64 with the OBS PPA package `obs-studio=32.2.0-0obsproject1~noble`, plus `cmake g++ make pkg-config patch python3 libx11-dev libxcb-composite0-dev libpulse-dev libsimde-dev libwayland-dev libglib2.0-dev libpipewire-0.3-dev libdrm-dev` |
| macOS    | `bun scripts/build-recorder-macos.ts` | Xcode command line tools                                                                                                                                                                                                                    |

## FFmpeg

On Linux and macOS, `bun scripts/provision-media.ts` downloads checksum-pinned FFmpeg and ffprobe builds and prints their paths. `bun run bundle:media` stages them for the app build. To use your own binaries during development, set `FFMPEG_PATH` and `FFPROBE_PATH`.

Release builds use FFmpeg compiled from source:

- **Windows:** in Ubuntu 24.04 (WSL works), install `gcc-mingw-w64-x86-64 g++-mingw-w64-x86-64 binutils-mingw-w64-x86-64 make nasm meson ninja-build pkg-config`. Run `bun scripts/release-sources.ts --controlled-inputs --collect-only` and `bash scripts/build-media-windows.sh` there. Then, on Windows, run `bun scripts/controlled-media.ts` and `bun run bundle:media`.
- **macOS:** run `brew install ffmpeg-full meson ninja pkg-config nasm`, then `bun scripts/release-sources.ts --controlled-inputs --collect-only`, `bash scripts/build-media-macos.sh`, and `bun scripts/controlled-media-macos.ts`.

## Releases

Releases are cut from `main` by bumping the version in `package.json`. Not every change needs a new version.

Every push to `main` builds and tests all five targets as a private candidate. Once a commit's `Release candidate` status passes, `bun run release <major|minor|patch>` pushes a commit that changes only the version. That release builds the targets again and checks the package bytes and sources, but skips the suites the candidate already passed.

When a new version lands on `main` together with other changes, the Release workflow builds and tests Windows x64, Linux x64 and arm64, and macOS x64 and Apple Silicon. It also assembles and verifies the corresponding-source kits for the bundled GPL components. If every check passes, it publishes one release with the app downloads, the updater feeds, and an `AcroClip-sources-<platform>.zip` per platform, and tags it.

If a release fails before it's published, fix the problem and push again with the same version. Published releases and tags can't be changed, so any later fix needs a new version.

## License

AcroClip is [GPL-3.0-or-later](LICENSE), and contributions are accepted under the same license. Bundled third-party components are listed in [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
