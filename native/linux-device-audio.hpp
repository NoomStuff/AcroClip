// SPDX-License-Identifier: GPL-2.0-or-later
#pragma once
#include <obs.h>
#include <string>
void registerLinuxDeviceAudio();
const char *linuxInputAudioType();
const char *linuxOutputAudioType();
std::string linuxDeviceAudioError(obs_source_t *source);
