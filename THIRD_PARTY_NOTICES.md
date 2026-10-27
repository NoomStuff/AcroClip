# Third-party notices

AcroClip is distributed under GPL-3.0-or-later. Reused MIT code retains its original license. See LICENSE and the retained notices below.

## AttaCut

Copyright NoomStuff. MIT. AcroClip adapts AttaCut's media serving, binary provisioning, release conventions, and explicit update behavior. The renderer adapts AttaCut's dropdown, player, transport, audio picker, and volume controls for AcroClip.

Source: https://github.com/NoomStuff/AttaCut

### Retained MIT notice

```text
MIT License

Copyright (c) 2026 NoomStuff

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

## OBS Studio and libOBS

GNU GPL version 2 or later. The native helper links with libOBS. Runtime versions and source references are recorded in the recorder bundle's provenance.

Source and build instructions: https://github.com/obsproject/obs-studio

## FFmpeg

The build depends on the selected FFmpeg distribution. GPL builds require corresponding sources for FFmpeg and enabled libraries. Bundled versions, configure flags, and checksums are in resources/media/provenance.json. Provisioning uses checksum-pinned archives from scripts/media-lock.ts.

Source and build instructions: https://ffmpeg.org/ and https://github.com/BtbN/FFmpeg-Builds

## Application dependencies

Electron, React, electron-updater, Lucide, Zod, and the development toolchain retain their upstream licenses. The lockfile identifies the exact dependency versions. Lucide icons are ISC licensed. Electron includes Chromium and Node.js and their notices.

Release bundles must preserve upstream licenses and provide corresponding source for GPL components. A source archive of AcroClip alone does not include all bundled dependency sources.

Corresponding application and dependency source archives are available at https://github.com/NoomStuff/AcroClip/releases. App releases contain only application downloads. Verification reports stay with the CI build artifacts.
