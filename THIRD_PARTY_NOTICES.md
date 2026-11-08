# Third-party notices

AcroClip is distributed under GPL-3.0-or-later (see LICENSE). It bundles or builds on the components below, which keep their own licenses.

## OBS Studio and libOBS

GNU GPL version 2 or later. The native helper links with libOBS. Runtime versions and source references are recorded in the recorder bundle's provenance.

Source and build instructions: https://github.com/obsproject/obs-studio

The recorder also compiles OBS Studio 32.2.2's audio filters (gain, noise suppression, noise gate, compressor, limiter, expander, upward compressor, 3-band equalizer and polarity inversion) from native/vendor/obs-filters, under the same license.

## RNNoise

BSD-3-Clause. Noise suppression uses the RNNoise copy bundled with OBS Studio, in native/vendor/rnnoise.

Source: https://github.com/xiph/rnnoise

### Retained BSD notice

```text
Copyright (c) 2017, Mozilla
Copyright (c) 2007-2017, Jean-Marc Valin
Copyright (c) 2005-2017, Xiph.Org Foundation
Copyright (c) 2003-2004, Mark Borgerding

Redistribution and use in source and binary forms, with or without
modification, are permitted provided that the following conditions
are met:

- Redistributions of source code must retain the above copyright
notice, this list of conditions and the following disclaimer.

- Redistributions in binary form must reproduce the above copyright
notice, this list of conditions and the following disclaimer in the
documentation and/or other materials provided with the distribution.

- Neither the name of the Xiph.Org Foundation nor the names of its
contributors may be used to endorse or promote products derived from
this software without specific prior written permission.

THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS
``AS IS'' AND ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT
LIMITED TO, THE IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR
A PARTICULAR PURPOSE ARE DISCLAIMED.  IN NO EVENT SHALL THE FOUNDATION
OR CONTRIBUTORS BE LIABLE FOR ANY DIRECT, INDIRECT, INCIDENTAL,
SPECIAL, EXEMPLARY, OR CONSEQUENTIAL DAMAGES (INCLUDING, BUT NOT
LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR SERVICES; LOSS OF USE,
DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER CAUSED AND ON ANY
THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY, OR TORT
(INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE
OF THIS SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.
```

## nlohmann/json

MIT. The native recorder compiles in JSON for Modern C++ 3.12.0. Its license text is in licenses/nlohmann-json-3.12.0-MIT.txt and ships with the recorder runtime.

Source: https://github.com/nlohmann/json

## FFmpeg

The build depends on the selected FFmpeg distribution. GPL builds require corresponding sources for FFmpeg and enabled libraries. Bundled versions, configure flags, and checksums are in resources/media/provenance.json. Provisioning uses checksum-pinned archives from scripts/media-lock.ts.

Source and build instructions: https://ffmpeg.org/ and https://github.com/BtbN/FFmpeg-Builds

## Application dependencies

Electron, React, electron-updater, Lucide, Zod, and the development toolchain retain their upstream licenses. The lockfile identifies the exact dependency versions. Lucide icons are ISC licensed. Electron includes Chromium and Node.js and their notices.

Release bundles must preserve upstream licenses and provide corresponding source for GPL components. A source archive of AcroClip alone does not include all bundled dependency sources.

Corresponding application and dependency source archives are available at https://github.com/NoomStuff/AcroClip/releases. App releases contain only application downloads. Verification reports stay with the CI build artifacts.
