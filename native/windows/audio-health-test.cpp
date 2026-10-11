// SPDX-License-Identifier: GPL-2.0-or-later
#include "audio-health-policy.hpp"
#include <iostream>
#include <stdexcept>
using namespace std::chrono_literals;
using namespace attaclip::windows;
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
  std::cout << "Input delivery, endpoint state, access denial and capture recovery policy passed\n";
}
