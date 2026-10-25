# AcroClip

We are building a local-first, cross-platform clipping app. Trying to make clipping moments, rewatching them, and sharing them as easy as possible.

## What we optimize for

1. **Correctness.** A saved clip contains the requested moment, with working playback and synchronized audio. A fast save of the wrong footage is a failure.
2. **Low impact.** Recording must remain dependable during gameplay. Library work and compression must not compromise capture.
3. **Polish.** Common actions should feel immediate. Use compact controls, useful feedback, and sensible defaults.

## Scope

AcroClip captures recent footage, previews clips, and creates shareables. Full-session recording belongs in OBS. Cutting belongs in AttaCut. Growth needs a reason tied to making clipping or sharing better, rather than turning this into another recording studio or editor.

## The user's files are theirs

The folder is the collection. Existing supported videos should work without registration, and files must remain usable outside AcroClip. Metadata supports the collection, allowing for better library features, but its only additive.

## Verified work

`bun run verify` covers formatting, lint, unit tests, strict types, and the build; run it after edits. Recording, audio, and export changes are verified against actual media and failure cases, never simulations. Useful checks beyond `verify`:

- `bun run test:media`: real video fixtures for exports, playback tracks, moved collections, and metadata recovery.
- `bun run test:ui` and `bun run test:ui:native`: the actual app in an isolated profile, with real capture in the native variant.
- `bun run test:native`, `bun run test:packaged`, `bun run test:capture-loss`: recorder smoke, packaged builds, and recovery after source loss.

Isolate runs from real user state with `ACROCLIP_PROFILE`, `ACROCLIP_COLLECTION`, and `ACROCLIP_TEST=1`. Never point destructive tests at a real collection. A platform build alone doesn't establish working capture.

## Versioning

Pushing to main with a new version number in `package.json` triggers a release via GitHub Actions. Bump it appropriately for the changes made, not every change needs a new version. Follow ups should not bump again unless pushes to main have been made since. Don't blindly push without permission from the user.

Always run `bun run format` and `bun run verify` after a turn with many file edits. For changes to capture, audio, export, playback, packaging, or release workflows, run `bun run verify:release` too. Fix local failures before pushing, then fix isolated check failures before publication.

After a version bump, watch the release through completion on all five targets. If an unpublished release fails, fix and retry the same version. The release workflow publishes automatically after every required check passes. Release notes and custom attempt counts are not required. Create the final tag only when publishing the verified commit. Public releases and tags are immutable, so fixes after publication require a new version. Public app release pages carry app downloads only.
