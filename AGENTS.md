# AcroClip

We are building a local-first, cross-platform clipping app. Trying to make clipping, rewatching, managing and sharing moments as easy as possible.

## What we optimize for

1. **Correctness.** Our absolute top priority making sure clips are correctly saved.
2. **Low impact.** Recording must remain dependable during gameplay. Minimimal usage, high clip quality.
3. **Polish & Speed.** Common actions should feel immediate. Use compact controls, useful feedback, and sensible defaults.

## Scope

AcroClip captures recent footage, manages and plays clips, and creates shareables. Growth needs a reason tied to making clipping, managing clips, or sharing them better, rather than turning this into another recording studio or editor.

## The user's files are theirs

The folder is the collection. Existing supported videos should work without registration, and files must remain usable outside AcroClip. Metadata supports the collection, allowing for better library features, but its only additive.

## Versioning

Every push to main builds and verifies all five targets as a private candidate. To release, push the changes first, wait for that commit's `Release candidate` status to pass, then run `bun run release <major|minor|patch>`. Don't blindly bump without permission from the user.

Always run `bun run format` and `bun run verify` after a turn with many file edits. For changes to capture, audio, export, playback, packaging, or release workflows, run `bun run verify:release` too. Fix local failures before pushing, then fix isolated check failures before publication.

After a version bump, watch the release through completion on all five targets. If an unpublished release fails, rerun the failed jobs or fix and retry the same version. The release workflow publishes automatically after every required check passes.

## Shared Files

These files are shared line for line with AttaCut and Deduup, apart from their imports and app blocks: `src/main/update-manager.ts`, `src/main/splash.ts`, `scripts/splash/splash.cs`, `scripts/after-pack.cjs` and `scripts/release-notes.mjs`. Each app keeps its own `scripts/splash/identity.cs`. Make changes to a shared file in all three apps in the same turn.
