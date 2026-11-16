// SPDX-License-Identifier: GPL-2.0-or-later
#include "audio-health-policy.hpp"
#include <iostream>
#include <functional>
#include <stdexcept>
#include <vector>
using namespace std::chrono_literals;
using namespace acroclip::windows;
static void require(bool condition) { if (!condition) throw std::runtime_error("Audio health assertion failed"); }
int main() {
  const auto start = InputDelivery::Clock::time_point{};
  InputDelivery missing(start);
  require(missing.error(start + 1999ms).empty());
  require(!missing.error(start + 2000ms).empty());
  missing.delivered(0, start + 2000ms);
  require(!missing.error(start + 2001ms).empty());
  InputDelivery silent(start), muted(start);
  for (int step = 0; step < 100; step++) {
    const auto time = start + step * 100ms;
    silent.delivered(4800, time);
    muted.delivered(4800, time);
    require(silent.error(time).empty());
    require(muted.error(time).empty());
  }
  require(silent.error(start + 11899ms).empty());
  require(!silent.error(start + 11900ms).empty());
  silent.delivered(480, start + 12000ms);
  require(silent.error(start + 12000ms).empty());
  require(endpointError(EndpointState::active).empty());
  require(!endpointError(EndpointState::unavailable).empty());
  require(!endpointError(EndpointState::failed).empty());
  require(captureStateError(2, false, 0x80070005u, true) ==
      "Microphone access was denied. Allow it in Windows Settings");
  require(captureStateError(2, false, 0x80070005u, false) ==
      "Audio device access was denied. Check device access settings");
  require(captureStateError(0, false, 0, true) == "Audio capture is starting");
  require(captureStateError(2, false, 0x80004005u, true) == "Audio capture is reconnecting");
  require(captureStateError(3, false, 0x80004005u, false) == "Audio capture has stopped");
  // A stale failure must not override restored capture or silent output.
  require(captureStateError(1, true, 0x80070005u, true).empty());
  require(captureStateError(1, true, 0, false).empty());
  ProcessCaptureHealth process(start);
  require(process.error(true, 1, 0, false, 0, start + 1999ms).empty());
  require(process.error(true, 1, 0, false, 0, start + 2000ms) == "Audio capture is starting");
  require(process.error(true, 1, 1, true, 0, start + 2100ms).empty());
  require(process.error(true, 1, 1, true, 0, start + 1h).empty());
  require(process.error(true, 1, 2, false, 0x80004005u, start + 1h).empty());
  require(process.error(true, 1, 2, false, 0x80004005u, start + 1h + 1999ms).empty());
  require(process.error(true, 1, 2, false, 0x80004005u, start + 1h + 2000ms) == "Audio capture is reconnecting");
  require(process.error(true, 1, 1, true, 0, start + 1h + 2100ms).empty());
  ProcessCaptureHealth denied(start);
  require(denied.error(true, 1, 2, false, 0x80070005u, start + 2000ms) == "Audio device access was denied. Check device access settings");
  require(!denied.error(false, 1, 1, true, 0, start).empty());
  require(!denied.error(true, 0, 1, true, 0, start).empty());
  require(!denied.error(true, 1, 4, true, 0, start).empty());
  {
    struct Session { uint32_t pid; bool active; };
    using Lists = std::vector<std::function<std::vector<Session>()>>;
    const auto pids = [](const std::vector<Session> &sessions) {
      std::set<uint32_t> result;
      for (const auto &item : sessions) result.insert(item.pid);
      return result;
    };
    int asked = 0;
    const auto others = [&] {
      asked++;
      return Lists{[] { return std::vector<Session>{{10, true}, {30, true}}; }, [] { return std::vector<Session>{{40, true}}; }};
    };
    // Nothing captured left the default output, so the other outputs aren't even listed.
    require(pids(followCapturedSessions<Session>({{10, true}, {20, true}}, {10, 20}, others)) == std::set<uint32_t>{10, 20});
    require(asked == 0);
    // The default changed under a game: it stays while it plays on the old output.
    // A process that only ever played elsewhere, like a mixer's replay, stays out.
    require(pids(followCapturedSessions<Session>({{20, true}}, {10, 20}, others)) == std::set<uint32_t>{10, 20});
    require(asked == 1);
    // A captured process that closed everywhere drops out.
    require(pids(followCapturedSessions<Session>({}, {50}, others)).empty());
    // One output failing to list only costs its own processes.
    const auto failing = [] {
      return Lists{[]() -> std::vector<Session> { throw std::runtime_error("gone"); }, [] { return std::vector<Session>{{40, true}}; }};
    };
    require(pids(followCapturedSessions<Session>({{20, true}}, {10, 20, 40}, failing)) == std::set<uint32_t>{20, 40});
    // Failing to list the outputs at all never loses the default mix.
    const auto unlisted = []() -> Lists { throw std::runtime_error("no outputs"); };
    require(pids(followCapturedSessions<Session>({{20, true}}, {10, 20}, unlisted)) == std::set<uint32_t>{20});
    // An idle session on the old output keeps its state, so it's only retained, never reopened.
    const auto idle = [] { return Lists{[] { return std::vector<Session>{{10, false}}; }}; };
    const auto kept = followCapturedSessions<Session>({}, {10}, idle);
    require(kept.size() == 1 && !kept[0].active);
  }
  std::cout << "Input delivery, endpoint state, access denial, capture recovery and output change policy passed\n";
}
