// SPDX-License-Identifier: GPL-2.0-or-later
#pragma once
#include <atomic>
#include <chrono>
#include <algorithm>
#include <cstdint>
#include <exception>
#include <optional>
#include <set>
#include <string>
#include <vector>

namespace acroclip::windows {
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

class ProcessCaptureHealth {
public:
  using Clock = std::chrono::steady_clock;
  explicit ProcessCaptureHealth(Clock::time_point now = Clock::now()) : waiting(now) {}
  std::string error(bool queried, int version, int phase, bool ready, uint32_t result, Clock::time_point now) {
    if (!queried || version != 1 || phase < 0 || phase > 3)
      return "Audio capture health is unavailable. Repair the recorder installation";
    if (phase == 1 && ready) { waiting.reset(); return {}; }
    if (!waiting) waiting = now;
    // Each newly audible process starts its own asynchronous loopback client.
    // Normal startup/reconnect must not poison an otherwise healthy Desktop mix.
    if (now - *waiting < std::chrono::seconds(2)) return {};
    return captureStateError(phase, false, result, false);
  }
private:
  std::optional<Clock::time_point> waiting;
};

/**
 * The sessions Desktop audio works from, given the default output's sessions and the processes it
 * already captures. Many games stay on the output they started on when the default changes, and
 * they're still audible there, so a captured process stays while it has a session on any output.
 * New captures still come only from the default output, because a mixer like Voicemeeter replays
 * every app onto the real headset and capturing it there would double them all.
 *
 * `others` returns the sessions on every other output. It only runs when a captured process has
 * left the default output. Failing to list other outputs only costs the processes that moved,
 * never the default mix.
 */
template <class Session, class Others>
std::vector<Session> followCapturedSessions(std::vector<Session> listed, const std::set<uint32_t> &captured, Others &&others) {
  std::set<uint32_t> moved;
  for (const uint32_t pid : captured)
    if (std::none_of(listed.begin(), listed.end(), [&](const Session &item) { return item.pid == pid; })) moved.insert(pid);
  if (moved.empty()) return listed;
  try {
    for (const Session &item : others())
      if (moved.count(item.pid)) listed.push_back(item);
  } catch (const std::exception &) {}
  return listed;
}

/** Every session from a set of outputs. One that fails to list only loses its own sessions. */
template <class Session, class Lists>
std::vector<Session> collectSessions(const Lists &lists) {
  std::vector<Session> found;
  for (const auto &list : lists) {
    try {
      for (const Session &item : list()) found.push_back(item);
    } catch (const std::exception &) {}
  }
  return found;
}

/**
 * The other outputs' sessions, listed at most once a second. The default output is checked every
 * round so new apps join quickly, but an app moving between outputs is rare, and listing every
 * output ten times a second would cost the most exactly while a game is running.
 */
template <class Session>
class SessionCache {
public:
  using Clock = std::chrono::steady_clock;
  static constexpr std::chrono::milliseconds interval{1000};
  template <class List>
  const std::vector<Session> &get(Clock::time_point now, List &&list) {
    if (!listedAt || now - *listedAt >= interval) {
      // A failed listing still counts, so a broken output isn't retried every round.
      listedAt = now;
      try { sessions = list(); } catch (const std::exception &) { sessions.clear(); throw; }
    }
    return sessions;
  }
private:
  std::optional<Clock::time_point> listedAt;
  std::vector<Session> sessions;
};
}
