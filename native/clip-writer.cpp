// SPDX-License-Identifier: GPL-2.0-or-later
// Mux protocol follows OBS Studio's ffmpeg-mux/ffmpeg-mux.h, Copyright Lain Bailey.
#include "clip-writer.hpp"
#include <algorithm>
#include <chrono>
#include <cstdlib>
#include <filesystem>
#include <memory>
#include <stdexcept>
#include <util/pipe.h>

namespace acroclip {
namespace {
struct PacketInfo {
  int64_t pts, dts;
  uint32_t size, index;
  int type;
  bool keyframe;
};

bool writePacket(os_process_pipe_t *pipe, const encoder_packet &packet,
                 int64_t origin) {
  PacketInfo info{};
  info.pts = packet.pts;
  info.dts = packet.dts;
  info.size = uint32_t(packet.size);
  info.index = uint32_t(packet.track_idx);
  info.type = packet.type == OBS_ENCODER_VIDEO ? 0 : 1;
  info.keyframe = packet.keyframe;
  if (packet.timebase_den > 1) {
    int64_t offset = origin * packet.timebase_den / 1000000;
    info.pts -= offset;
    info.dts -= offset;
  }
  return os_process_pipe_write(pipe, reinterpret_cast<uint8_t *>(&info),
                               sizeof(info)) == sizeof(info) &&
         os_process_pipe_write(pipe, packet.data, packet.size) == packet.size;
}
} // namespace

Packet::Packet(const encoder_packet &value) {
  auto copy = value;
  obs_encoder_packet_ref(&p, &copy);
}
Packet::Packet(Packet &&value) noexcept : p(value.p) { value.p = {}; }
Packet::Packet(const Packet &value) : Packet(value.p) {}
Packet::~Packet() {
  if (p.data)
    obs_encoder_packet_release(&p);
}

ClipWriter::ClipWriter(std::string executable, Completion completion)
    : executable(std::move(executable)), completion(std::move(completion)) {
  thread = std::thread([this] { run(); });
}
ClipWriter::~ClipWriter() { finish(); }
void ClipWriter::accept() { pendingRequests++; }
int ClipWriter::pending() const { return pendingRequests.load(); }
void ClipWriter::reject(const ClipRequest &request, const std::string &error) {
  completion({request, false, 0, 0, error});
  pendingRequests--;
}
void ClipWriter::submit(ClipJob job) {
  {
    std::lock_guard<std::mutex> lock(mutex);
    if (closing)
      throw std::runtime_error("The clip writer is shutting down");
    jobs.emplace_back(std::move(job));
  }
  wake.notify_one();
}
void ClipWriter::resetOverlap() {
  if (pending())
    throw std::runtime_error("Wait for clip saves to finish before restarting");
  previousEnd = 0;
}
void ClipWriter::finish() {
  {
    std::lock_guard<std::mutex> lock(mutex);
    closing = true;
  }
  wake.notify_one();
  if (thread.joinable())
    thread.join();
}
void ClipWriter::run() {
  for (;;) {
    ClipJob job;
    {
      std::unique_lock<std::mutex> lock(mutex);
      wake.wait(lock, [this] { return closing || !jobs.empty(); });
      if (jobs.empty() && closing)
        return;
      job = std::move(jobs.front());
      jobs.pop_front();
    }
    ClipResult result;
    try {
      result = write(job);
    } catch (const std::exception &error) {
      result.request = job.request;
      result.error = error.what();
    }
    completion(result);
    pendingRequests--;
  }
}

ClipResult ClipWriter::write(ClipJob &job) {
  if (auto *gate = std::getenv("ACROCLIP_NATIVE_TEST_WRITER_GATE")) {
    for (int i = 0; i < 1000 && !std::filesystem::exists(gate); i++)
      std::this_thread::sleep_for(std::chrono::milliseconds(10));
  }
  ClipResult result;
  result.request = job.request;
  result.secondsSinceCapture = job.secondsSinceCapture;
  if (job.packets.empty() || job.headers.empty() ||
      job.audioNames.size() + 1 != job.headers.size())
    throw std::runtime_error("The saved clip has incomplete encoded media");
  size_t start = 0;
  int64_t cutoff = job.reduceOverlap ? previousEnd.load() : 0;
  if (cutoff)
    for (size_t i = 0; i < job.packets.size(); i++)
      if (job.packets[i].p.type == OBS_ENCODER_VIDEO &&
          job.packets[i].p.keyframe && job.packets[i].p.sys_dts_usec <= cutoff)
        start = i;
  result.overlapSeconds =
      cutoff > 0 ? std::max(0., double(std::min(cutoff, job.end) -
                                     job.packets[start].p.sys_dts_usec) /
                                   1000000.)
                 : 0.;
  std::string temporary = job.request.path + ".saving.mkv";
  using Arguments =
      std::unique_ptr<os_process_args_t, decltype(&os_process_args_destroy)>;
  Arguments arguments(os_process_args_create(executable.c_str()),
                      &os_process_args_destroy);
  auto add = [&](std::string value) {
    os_process_args_add_arg(arguments.get(), value.c_str());
  };
  add(temporary);
  add("1");
  add(std::to_string(job.headers.size() - 1));
  add("h264");
  add("10000");
  add(std::to_string(job.width));
  add(std::to_string(job.height));
  for (auto value : {1, 1, 1, 1, 1, 0})
    add(std::to_string(value));
  add(std::to_string(job.fps));
  add("1");
  add("0");
  if (job.headers.size() > 1) {
    add("aac");
    for (const auto &name : job.audioNames) {
      add(name);
      add("160");
      add("48000");
      add("1024");
#if LIBOBS_API_VER >= MAKE_SEMANTIC_VERSION(32, 2, 0)
      // The pinned OBS 30 muxer has no initial-padding argument.
      add("0");
#endif
      add("2");
    }
  }
  add("");
  add("");
  using Pipe =
      std::unique_ptr<os_process_pipe_t, decltype(&os_process_pipe_destroy)>;
  Pipe pipe(os_process_pipe_create2(arguments.get(), "w"),
            &os_process_pipe_destroy);
  bool okay = bool(pipe);
  if (pipe) {
    for (size_t i = 0; i < job.headers.size(); i++) {
      encoder_packet packet{};
      packet.data = job.headers[i].data();
      packet.size = job.headers[i].size();
      packet.type = i ? OBS_ENCODER_AUDIO : OBS_ENCODER_VIDEO;
      packet.track_idx = i ? i - 1 : 0;
      packet.timebase_den = 1;
      if (!writePacket(pipe.get(), packet, 0))
        okay = false;
    }
    int64_t origin = job.packets[start].p.dts_usec;
    for (size_t i = start; i < job.packets.size(); i++)
      if (!writePacket(pipe.get(), job.packets[i].p, origin)) {
        okay = false;
        break;
      }
    int code = os_process_pipe_destroy(pipe.release());
    okay = okay && code == 0;
  }
  if (!okay || std::filesystem::file_size(temporary) <= 1000) {
    result.error = "The clip could not be finalized. Check free storage and "
                   "folder permissions";
    return result;
  }
  if (std::filesystem::exists(job.request.path))
    throw std::runtime_error(
        "A file already exists at the clip destination. The existing file was "
        "preserved");
#ifdef _WIN32
  std::filesystem::rename(temporary, job.request.path);
#else
  // POSIX rename overwrites. The hard link publishes without that race.
  std::filesystem::create_hard_link(temporary, job.request.path);
  std::filesystem::remove(temporary);
#endif
  previousEnd = std::max(previousEnd.load(), job.end);
  result.saved = true;
  return result;
}
} // namespace acroclip
