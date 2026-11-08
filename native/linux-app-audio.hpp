// SPDX-License-Identifier: GPL-2.0-or-later
#pragma once
#include "audio-filters.hpp"
#include <cstdint>
#include <functional>
#include <obs.h>
#include <string>
#include <vector>
struct ApplicationAudio;
void registerLinuxApplicationAudio();
ApplicationAudio *createApplicationAudio(uint32_t pid, uint32_t mixers = 3);
obs_source_t *applicationAudioSource(ApplicationAudio *audio);
std::string applicationAudioError(ApplicationAudio *audio);
void destroyApplicationAudio(ApplicationAudio *audio);
// Applied by the stream thread within one discovery cycle, and to new streams
// as they appear.
void setApplicationAudioFilters(ApplicationAudio *audio, const acroclip::filters::Chain &chain);
void setApplicationAudioLevelCallback(ApplicationAudio *audio,
                                      std::function<void(float)> callback);

void setLinuxDesktopExclusions(const std::vector<uint32_t> &pids);
const char *linuxDesktopAudioType();
std::string linuxDesktopAudioError(obs_source_t *source);
