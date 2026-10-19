// SPDX-License-Identifier: GPL-2.0-or-later
#pragma once

#include <atomic>
#include <condition_variable>
#include <cstdint>
#include <deque>
#include <functional>
#include <mutex>
#include <obs.h>
#include <string>
#include <thread>
#include <vector>

namespace acroclip {

struct Packet {
  encoder_packet p{};
  explicit Packet(const encoder_packet &value);
  Packet(Packet &&value) noexcept;
  Packet(const Packet &value);
  ~Packet();
};

struct ClipRequest {
  std::string id, path, source;
  int64_t end;
};

// All media and profile data are sealed before a job leaves the replay history.
// The writer never reads live encoders or capture sources.
struct ClipJob {
  ClipRequest request;
  int64_t end = 0;
  bool reduceOverlap = false;
  int width = 0, height = 0, fps = 0;
  double secondsSinceCapture = 0;
  std::vector<Packet> packets;
  std::vector<std::vector<uint8_t>> headers;
  std::vector<std::string> audioNames;
};

struct ClipResult {
  ClipRequest request;
  bool saved = false;
  double secondsSinceCapture = 0, overlapSeconds = 0;
  std::string error;
};

class ClipWriter {
public:
  using Completion = std::function<void(const ClipResult &)>;
  ClipWriter(std::string executable, Completion completion);
  ~ClipWriter();
  ClipWriter(const ClipWriter &) = delete;
  ClipWriter &operator=(const ClipWriter &) = delete;

  // Accepted requests count while waiting for their final packet as well as
  // while queued or writing. Each ends through submit or reject, exactly once.
  void accept();
  void reject(const ClipRequest &request, const std::string &error);
  void submit(ClipJob job);
  int pending() const;
  void resetOverlap();
  void finish();

private:
  std::string executable;
  Completion completion;
  std::mutex mutex;
  std::condition_variable wake;
  std::deque<ClipJob> jobs;
  std::thread thread;
  bool closing = false;
  std::atomic<int> pendingRequests{0};
  std::atomic<int64_t> previousEnd{0};
  void run();
  ClipResult write(ClipJob &job);
};

} // namespace acroclip
