// SPDX-License-Identifier: GPL-2.0-or-later
#pragma once
#include <atomic>
#include <chrono>
#include <cstdint>
#include <string>

namespace attaclip::windows {
class InputDelivery {
public:
  using Clock = std::chrono::steady_clock;
  explicit InputDelivery(Clock::time_point now) : created(milliseconds(now)) {}
  // Silence and mute do not stop WASAPI input packets. Count frames, not peaks.
  void delivered(uint32_t frames, Clock::time_point now) {
    if (frames) last.store(milliseconds(now), std::memory_order_release);
  }
  std::string error(Clock::time_point now) const {
    const auto sampled = last.load(std::memory_order_acquire);
    if (milliseconds(now) - (sampled < 0 ? created : sampled) < 2000) return {};
    return sampled < 0 ? "Audio input has not started sending samples"
                       : "Audio input stopped sending samples";
  }
private:
  static int64_t milliseconds(Clock::time_point time) {
    return std::chrono::duration_cast<std::chrono::milliseconds>(time.time_since_epoch()).count();
  }
  const int64_t created;
  std::atomic<int64_t> last{-1};
};
enum class EndpointState { active, unavailable, failed };
inline std::string endpointError(EndpointState state) {
  if (state == EndpointState::unavailable) return "Audio device is unavailable. Reconnect it or select another device";
  if (state == EndpointState::failed) return "Audio device status could not be checked";
  return {};
}

inline std::string captureStateError(int phase, bool ready, uint32_t result, bool input) {
  if (ready) return {};
  // E_ACCESSDENIED. Keep this policy independent of Windows SDK headers.
  if (result == 0x80070005u)
    return input ? "Microphone access was denied. Allow it in Windows Settings"
                 : "Audio device access was denied. Check device access settings";
  return phase == 0 ? "Audio capture is starting"
                   : phase == 2 ? "Audio capture is reconnecting"
                                : "Audio capture has stopped";
}
}
