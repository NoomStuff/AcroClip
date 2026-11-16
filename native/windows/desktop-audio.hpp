// SPDX-License-Identifier: GPL-2.0-or-later
#pragma once
#include <obs.h>
#include <cstdint>
#include <string>
#include <vector>
namespace acroclip::windows {
void registerDesktopAudio();
void setDesktopExclusions(const std::vector<uint32_t> &pids);
bool filteredDesktop(obs_source_t *source);
std::string desktopAudioError(obs_source_t *source);
/** What Desktop audio captures now and how often it has listed sessions, for native checks. */
struct DesktopAudioActivity { std::vector<uint32_t> processes; uint64_t listings = 0; };
DesktopAudioActivity desktopAudioActivity(obs_source_t *source);
}
