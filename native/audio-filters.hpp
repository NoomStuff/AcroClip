// SPDX-License-Identifier: GPL-2.0-or-later
// Per-source audio filters. The DSP is OBS Studio's own audio filter code
// (native/vendor/obs-filters), compiled into the recorder so every platform
// processes audio identically without loading another OBS module.
#pragma once
#include <json.hpp>
#include <obs.h>
#include <string>
#include <vector>
namespace acroclip::filters {
struct Filter {
  std::string id, type;
  bool enabled = true;
  nlohmann::json settings;
};
using Chain = std::vector<Filter>;
void registerAudioFilters();
// Validates the app's filter list against OBS's full ranges. The app offers a
// practical subset of them (src/shared/audio-filters.ts).
Chain parseChain(const nlohmann::json &value);
// Brings the source's filters in line with the chain. Unchanged filters keep
// their state, so adjusting one filter does not reset the others.
void applyChain(obs_source_t *source, const Chain &chain);
}
