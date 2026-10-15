# AttaClip — Game Clipping App

## Overview

I want AttaClip to be a lightweight, local-first game clipping application inspired by the core convenience of Medal, but with a cleaner UI, better local clip organization, and more control over recording and sharing.

The main philosophy is:

> **Open the app, start playing, and clip something instantly without having to think about it.**

It should run in the background, continuously maintain a recording buffer, and save the requested portion of that buffer when the user activates a clip hotkey.

The app should prioritize **low performance impact, instant clipping, simple organization, and easy sharing.**

---

# 1. Clip Library

AttaClip should connect to a user-selected local folder and treat that folder as the clip library.

When the app opens, it should scan the folder and automatically discover existing clips.

The library should provide:

* All clips
* Recently created clips
* Favorites
* Albums
* Search
* Filtering
* Sorting
* Clip previews/thumbnails
* Duration
* File size
* Creation date
* Game/source information where available

Users should be able to rename clips and organize them into custom albums.

For example:

**Albums**

* Priceless Games
* Funny Moments
* Valorant
* Minecraft
* Friends
* Best Clips

A clip can potentially belong to multiple albums without needing to duplicate the actual video file.

The important thing is that the library should work with **real local files**, rather than forcing users into a proprietary cloud library.

---

# 2. Extremely Simple Clipping

The primary interaction should be extremely fast.

AttaClip should continuously record a rolling buffer in the background.

When the user presses a clip hotkey, AttaClip saves the requested amount of time from that buffer.

Example:

**F1 → Save the previous 2 minutes**

The user should not have to open the application, interact with a menu, or wait for a recording to start.

The clip should simply appear in the library.

---

# 3. Configurable Clip Hotkeys

Users should be able to configure multiple clipping hotkeys.

Each hotkey can have its own clip duration.

Example:

* F1 → Last 30 seconds
* F2 → Last 60 seconds
* F5 → Last 2 minutes
* Alt + F7 → Last 10 minutes

The exact hotkeys and durations should be fully configurable.

### Activation behavior

There should be an option for:

**Tap**

* A single press immediately creates the clip.

**Hold**

* The user must hold the key for a configurable amount of time before the clip is created.

This prevents accidental clips if desired.

The hold duration should be configurable.

---

# 4. Recording Quality

AttaClip should have simple presets for normal users, while still providing advanced controls for people who know what they're doing.

### Presets

* Low
* Standard
* High
* Custom

Example:

**Low**

* Lower resolution/bitrate
* Lower performance impact
* Smaller files

**Standard**

* Good balance between quality and performance

**High**

* High-quality recording
* Larger files
* More resource usage

**Custom**
Allow the user to configure things such as:

* Resolution
* FPS
* Bitrate
* Encoder
* GPU vs CPU encoding
* Other relevant encoder settings

The UI should make presets easy to understand without exposing technical settings unless the user selects Custom.

---

# 5. Performance / Recording Mode

There should be a clear distinction between:

**Quality-first recording**

* Higher quality
* Larger files
* Potentially more system resource usage

and

**Performance-first recording**

* Lower quality
* Smaller files
* Minimize FPS impact and system load

The user should be able to choose a lower-quality recording mode specifically because they don't want clipping to interfere with gameplay.

Ideally, AttaClip should also provide sensible warnings when a configuration is likely to be expensive.

---

# 6. Separate Audio Tracks

Game audio and microphone audio should be recorded separately.

For example:

**Track 1:** Game/Desktop audio
**Track 2:** Microphone

This means the final clip contains independent audio tracks rather than permanently mixing everything together.

This is useful because the user can later:

* Adjust microphone volume
* Mute the microphone
* Edit game audio independently
* Edit microphone audio independently

If possible, other audio sources such as Discord could also be independently selectable.

---

# 7. Share / Compression System

AttaClip should have a built-in **Share Clip** function.

The important idea is that sharing should **not destroy or replace the original high-quality clip.**

Instead:

1. User selects a clip.
2. User presses **Share**.
3. AttaClip creates a temporary/exported copy.
4. AttaClip compresses that copy for the selected destination.
5. The original clip remains untouched.

### Example

Original:

> 1440p / 60 FPS / High quality / 150 MB

User clicks:

> **Share → Discord**

AttaClip creates:

> Compressed Discord version → ≤ 20 MB

The original 150 MB clip remains exactly as it was.

---

# 8. Share Presets

Users should be able to configure share/export presets.

For example:

* Discord
* WhatsApp
* Telegram
* Custom
* Other platforms

Each preset can define things such as:

* Maximum file size
* Resolution
* FPS
* Bitrate
* Codec
* Audio settings

For example:

**Discord**

> Automatically compress the clip until it fits within the configured Discord file-size limit.

There should also be a setting for:

> **Always record High quality, but automatically create a Low quality version when sharing.**

This lets the user record everything at high quality without having to manually compress clips every time.

---

# 9. Storage Management

AttaClip should clearly show how much storage the clipping system is using.

For example:

> Clip Buffer
> 18.4 GB / 50 GB

or:

> 31.6 GB available for clips

The user should be able to configure a maximum amount of storage AttaClip is allowed to use.

Example:

> Maximum clip storage: **50 GB**

Once the limit is reached, AttaClip should have a configurable strategy, such as:

* Stop recording
* Delete oldest clips automatically
* Warn the user
* Only clear temporary buffer data

The UI should make this impossible to accidentally misunderstand.

---

# 10. Clip Naming & Metadata

After saving a clip, the user should be able to rename it.

For example:

> `Valorant Ace`

instead of:

> `2026-10-06_15-42-18.mp4`

The app can still generate a unique filename internally, but the library should expose a clean human-readable name.

Useful metadata could include:

* Name
* Game
* Date/time
* Duration
* File size
* Resolution
* FPS
* Album/category
* Favorite status

---

# 11. Voice Clipping

A fun optional feature:

The user should be able to define a voice command that triggers a clip.

Example:

> “AttaClip”

AttaClip detects the phrase and executes the user's configured clipping action.

For example:

> “AttaClip” → save the previous 2 minutes

The user could configure the command/action themselves.

Potentially:

> “AttaClip” → F5 action → 2-minute clip

or

> “Add a long clip” → 10-minute clip

This should be completely optional because always-on voice detection has privacy/performance implications.

---

# 12. UI / UX

The UI is extremely important.

The goal is **simple, clean, and information-dense without being cluttered.**

Do not copy the typical “gamer software” approach of filling the screen with unnecessary buttons, cards, statistics, animations, etc.

The main library should immediately answer:

* What clips do I have?
* What did I record recently?
* Where are my albums?
* How much storage am I using?
* Can I quickly find/share a clip?

### Main navigation

Something roughly like:

**Library**

* All Clips
* Recent
* Favorites
* Albums

**Recording**

* Current recording state
* Clip hotkeys
* Buffer length
* Quality
* Storage

**Settings**

* Recording
* Quality
* Audio
* Hotkeys
* Storage
* Sharing
* Voice commands

Keep advanced options hidden behind expandable sections.

---


# 14. Important Technical Goal

The clipping system should be designed around a **rolling recording buffer**, rather than starting a new recording every time the user presses the hotkey.

The user should always have the configured amount of recent gameplay available to save.

For example:

> Buffer: 10 minutes

The system continuously maintains those 10 minutes.

When the user presses:

> F5 → 2 minutes

AttaClip saves the last 2 minutes from the buffer.

When the user presses:

> Alt + F7 → 10 minutes

AttaClip saves the entire available buffer.

The implementation details can be decided based on the target OS/API/encoder, but the UX should feel instantaneous.

---

# 15. Core Priorities

If this gets built incrementally, prioritize these features in roughly this order:

### Tier 1 — Must Have

1. Background recording buffer
2. Instant clipping
3. Configurable hotkeys
4. Configurable clip durations
5. Local clip folder/library
6. Recent clips
7. Albums/categories
8. Clip naming
9. Storage limit
10. Quality presets
11. Separate game/microphone audio

### Tier 2 — Very Important

12. Custom encoder settings
13. Multiple recording profiles
14. Share/compression system
15. Share presets
16. Automatic Discord-size compression
17. Performance-focused recording mode
18. Search/filtering

### Tier 3 — Nice to Have

19. Voice clipping
20. Hold-to-clip activation
21. Per-game settings
22. More advanced metadata
23. Automatic cleanup policies
24. More sharing integrations

---

# Overall Product Goal

AttaClip shouldn't try to become a giant social-media platform.

The core product is:

> **A fast, local, lightweight game clipping tool that lets me save anything that just happened, organize my clips properly, and share them without fucking around with video compression.**

The biggest differentiators should be:

* Extremely fast clipping
* Low performance impact
* Local-first storage
* Excellent organization
* Flexible hotkeys
* Separate audio tracks
* High-quality recording
* One-click sharing/compression
* Clean UI
* No unnecessary clutter

Basically: take the **instant clipping + library + hotkey philosophy of Medal**, but build the experience around **local files, organization, control, and simplicity** rather than making the app feel like a social network.
