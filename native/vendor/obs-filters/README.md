# OBS Studio audio filters

Unmodified audio filter sources from OBS Studio 32.2.2 (`plugins/obs-filters`, commit ba2f32bdf791005443988a4955e963663e16b1ed), GPL-2.0-or-later. Source: https://github.com/obsproject/obs-studio/tree/32.2.2/plugins/obs-filters

`native/audio-filters.cpp` registers them inside the recorder. Noise suppression uses the bundled RNNoise copy in `native/vendor/rnnoise` (BSD-3-Clause, see its COPYING). Speex and NVIDIA noise removal are not built.
