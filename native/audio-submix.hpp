// SPDX-License-Identifier: GPL-2.0-or-later
#pragma once
#include <obs.h>
#include <stdexcept>

// A private mix consumer keeps child scenes rendering while idle meters and
// listening are open. It creates no encoder, file, or audible output.
class AudioSubmixClock {
  static void consume(void *, size_t, audio_data *) {}
public:
  AudioSubmixClock() {
    if (!audio_output_connect(obs_get_audio(), 0, nullptr, consume, this))
      throw std::runtime_error("Desktop audio mixing could not start");
  }
  ~AudioSubmixClock() { audio_output_disconnect(obs_get_audio(), 0, consume, this); }
  AudioSubmixClock(const AudioSubmixClock &) = delete;
  AudioSubmixClock &operator=(const AudioSubmixClock &) = delete;
};
