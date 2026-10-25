# Release candidates and publication

Push a stable version change to `main` to request a release. `Release` also retries every subsequent main commit while that version is unpublished. Manual dispatch verifies current main again. A failed private build does not need a version bump or a tag. Every changed commit runs the required checks again.

The candidate workflow requires Windows checks and packaged media tests, installed upgrade verification, and native capture, packaged behavior and corresponding source verification on Linux x64/arm64 and macOS x64/arm64. It retains the existing platform source checks. A successful run seals eight downloads, five source packets, verification reports and Windows/Linux feeds into `sealed-release-candidate`. Its manifest identifies the full commit, run ID and every file's size and SHA-256.

After every required job passes, the same workflow verifies the sealed artifact and automatically publishes the five unchanged source packets in a source-only prerelease in this repository. Its tag is `v<version>-sources-<fingerprint>`. The fingerprint identifies the commit and exact source packets, so a failed app publication does not reserve the source tag for a corrected or rebuilt candidate. Source releases cannot replace the latest stable app release. The app release has exactly eight app downloads.

Publication checks the candidate commit and run against the current workflow, requires current main to match that commit, and checks every uploaded file against the sealed size and SHA-256 digest. Missing or changed corresponding sources block app publication. Platform checks establish source closure, build recipes, licenses and binary correspondence before sealing. There is no separate publication workflow or manual upload.

Release descriptions are blank. Release notes and custom attempt counts are not required. Commit, run, source release URL and sealed file hashes belong in `updates:releases/v<version>.json`. The publisher records provenance before publication so interrupted publication can retry. An unpublished candidate may replace that record, while public app provenance and downloads remain immutable. Feed commits preserve earlier provenance records.

Publication creates `v<version>` against the verified commit, then updates the separate `updates` branch with Windows and Linux feeds pointing to those downloads. Unsigned macOS builds retain manual updates.

The released 0.3.0 Windows client uses the GitHub provider and requests `latest.yml` as a release asset. Since 0.3.1, the generic provider reads feeds from the `updates` branch. That branch cannot redirect the old client's release-asset request. Installed 0.3.0 users need one manual 0.3.1 installer upgrade. Historical 0.3.1 release instructions remain on its public release page. Do not add feed assets to immutable app releases to hide the migration gap.

Publication never rebuilds packages. Concurrent publication runs serialize. A retry can finish a partial private upload or repair feed publication using the same sealed candidate. It never overwrites public release assets or moves a tag. A stale private draft can be replaced. Any change after public publication requires a new version.

`bun run dist` and `bun run package` stage host media and the recorder, build the app, and always pass `--publish never`. Windows needs the controlled media build prepared first. Platform CI supplies the matching controlled media and source evidence. Local packaging does not establish release readiness.

The isolated Windows upgrade test uses another app ID, executable name, shortcuts and uninstall registration. It installs an older fixture at a custom path, runs a newer installer interactively without scope/path arguments, rejects redundant first-install pages, verifies registry scope/path and runs packaged media checks against the installed executable. It does not use the real AcroClip install or collection. Elevated per-machine upgrade behavior still needs a separate isolated administrator test.

The disposable GitHub-hosted Windows job downloads the pinned VB-CABLE Pack45 audio fixture from [VB-Audio](https://vb-audio.com/Cable/). It verifies the archive hash, installer signature and Microsoft hardware catalog signature before installing the virtual endpoint. An independent generated tone must appear in both master and capture audio during unpacked, portable and installed media tests. The driver is test infrastructure and is never included in the app downloads. The setup script rejects local execution.
