// SPDX-License-Identifier: GPL-2.0-or-later
#include "linux-device-audio.hpp"
#include <pulse/pulseaudio.h>
#include <util/platform.h>
#include <atomic>
#include <algorithm>
#include <chrono>
#include <cmath>
#include <mutex>
#include <stdexcept>
#include <thread>
#include <time.h>
#include <vector>

namespace {
uint64_t elapsedMs() {
  timespec value{};
  if (clock_gettime(CLOCK_BOOTTIME, &value) != 0)
    throw std::runtime_error("Audio delivery timing is unavailable");
  return uint64_t(value.tv_sec) * 1000 + uint64_t(value.tv_nsec) / 1000000;
}
struct Connection {
  pa_mainloop *loop = nullptr;
  pa_context *context = nullptr;
  std::atomic<bool> &quit;
  void iterate() {
    pa_mainloop_iterate(loop, 0, nullptr);
    std::this_thread::sleep_for(std::chrono::milliseconds(2));
  }
  Connection(std::atomic<bool> &stop) : quit(stop) {
    loop = pa_mainloop_new();
    context = loop ? pa_context_new(pa_mainloop_get_api(loop), "AttaClip device audio") : nullptr;
    try {
      if (!context || pa_context_connect(context, nullptr, PA_CONTEXT_NOAUTOSPAWN, nullptr) < 0)
        throw std::runtime_error("Audio server is unavailable");
      const auto deadline = elapsedMs() + 2000;
      while (!quit && pa_context_get_state(context) != PA_CONTEXT_READY) {
        if (!PA_CONTEXT_IS_GOOD(pa_context_get_state(context)) || elapsedMs() >= deadline)
          throw std::runtime_error("Audio server is unavailable");
        iterate();
      }
      if (quit) throw std::runtime_error("Audio capture stopped");
    } catch (...) { release(); throw; }
  }
  void release() {
    if (context) { pa_context_disconnect(context); pa_context_unref(context); context = nullptr; }
    if (loop) { pa_mainloop_free(loop); loop = nullptr; }
  }
  ~Connection() { release(); }
  bool operation(pa_operation *value) {
    if (!value) return false;
    const auto deadline = elapsedMs() + 2000;
    while (!quit && PA_CONTEXT_IS_GOOD(pa_context_get_state(context)) &&
           pa_operation_get_state(value) == PA_OPERATION_RUNNING && elapsedMs() < deadline)
      iterate();
    const bool done = pa_operation_get_state(value) == PA_OPERATION_DONE &&
                      pa_context_get_state(context) == PA_CONTEXT_READY;
    if (!done) pa_operation_cancel(value);
    pa_operation_unref(value);
    return done;
  }
};
struct Device {
  std::string name;
  uint32_t index = PA_INVALID_INDEX;
  bool suspended = false;
};
Device resolve(Connection &connection, bool input, const std::string &configured) {
  std::string name = configured;
  if (name == "default") {
    struct Request { std::string name; bool input; } request{{}, input};
    if (!connection.operation(pa_context_get_server_info(connection.context,
        [](pa_context *, const pa_server_info *info, void *value) {
          auto &request = *static_cast<Request *>(value);
          if (info) { const char *name = request.input ? info->default_source_name : info->default_sink_name;
            if (name) request.name = name; }
        }, &request)) || request.name.empty())
      throw std::runtime_error("The default audio device is unavailable");
    name = request.name;
    if (!input) {
      std::string monitor;
      if (!connection.operation(pa_context_get_sink_info_by_name(connection.context, name.c_str(),
          [](pa_context *, const pa_sink_info *info, int end, void *value) {
            if (!end && info && info->monitor_source_name)
              *static_cast<std::string *>(value) = info->monitor_source_name;
          }, &monitor)) || monitor.empty())
        throw std::runtime_error("The default audio output is unavailable");
      name = monitor;
    }
  }
  struct Request { Device device; bool input; } request{{}, input};
  if (!connection.operation(pa_context_get_source_info_by_name(connection.context, name.c_str(),
      [](pa_context *, const pa_source_info *info, int end, void *value) {
        auto &request = *static_cast<Request *>(value);
        if (!end && info && info->name && request.input == (info->monitor_of_sink == PA_INVALID_INDEX))
          request.device = {info->name, info->index, info->state == PA_SOURCE_SUSPENDED};
      }, &request)) || request.device.name.empty())
    throw std::runtime_error("The selected audio device is unavailable");
  return request.device;
}
struct Capture {
  obs_source_t *source;
  const bool input;
  const std::string configured;
  std::atomic<bool> quit{false};
  std::atomic<uint64_t> frames{0}, lastFrame{0}, readySince{0};
  std::atomic<bool> ready{false};
  std::mutex mutex;
  std::string failure = "Audio capture is starting";
  std::thread thread;
  Capture(obs_data_t *settings, obs_source_t *value, bool kind)
      : source(value), input(kind), configured(obs_data_get_string(settings, "device_id")) {
    thread = std::thread([this] { run(); });
  }
  ~Capture() { quit = true; thread.join(); }
  void fail(std::string message) {
    ready = false;
    std::lock_guard<std::mutex> lock(mutex);
    failure = std::move(message);
  }
  std::string error() {
    if (!ready.load()) { std::lock_guard<std::mutex> lock(mutex); return failure; }
    if (input) {
      const auto last = lastFrame.load(), since = readySince.load();
      if (elapsedMs() - (last ? last : since) >= 2000)
        return "Audio input stopped sending samples";
    }
    return {};
  }
  void run() {
    while (!quit) {
      try {
        Connection connection(quit);
        const auto device = resolve(connection, input, configured);
        pa_sample_spec spec{PA_SAMPLE_FLOAT32LE, 48000, 2};
        auto *stream = pa_stream_new(connection.context, obs_source_get_name(source), &spec, nullptr);
        if (!stream) throw std::runtime_error("Audio capture could not create a stream");
        struct Release { pa_stream *stream; ~Release() { pa_stream_disconnect(stream); pa_stream_unref(stream); } } release{stream};
        pa_buffer_attr attributes{UINT32_MAX, UINT32_MAX, UINT32_MAX, UINT32_MAX, 48000 * 8 / 40};
        if (pa_stream_connect_record(stream, device.name.c_str(), &attributes,
            pa_stream_flags_t(PA_STREAM_ADJUST_LATENCY | PA_STREAM_DONT_MOVE | PA_STREAM_AUTO_TIMING_UPDATE | PA_STREAM_INTERPOLATE_TIMING)) < 0)
          throw std::runtime_error("Audio capture could not connect to the selected device");
        const auto deadline = elapsedMs() + 2000;
        while (!quit && pa_stream_get_state(stream) != PA_STREAM_READY) {
          if (!PA_STREAM_IS_GOOD(pa_stream_get_state(stream)) || elapsedMs() >= deadline)
            throw std::runtime_error("Audio capture did not start");
          connection.iterate();
        }
        // Connecting may wake an idle input. Verify the post-connect identity
        // and state before claiming recovery, so a still-suspended input never
        // briefly looks healthy during retries.
        const auto started = resolve(connection, input, configured);
        if (started.name != device.name || started.index != device.index)
          throw std::runtime_error("The selected audio device changed");
        if (input && started.suspended)
          throw std::runtime_error("Audio input is suspended");
        lastFrame = 0; readySince = elapsedMs(); ready = true;
        auto nextDeviceCheck = elapsedMs() + 250;
        uint64_t nextTimestamp = 0;
        while (!quit) {
          connection.iterate();
          if (pa_context_get_state(connection.context) != PA_CONTEXT_READY)
            throw std::runtime_error("Audio server disconnected");
          if (pa_stream_get_state(stream) != PA_STREAM_READY)
            throw std::runtime_error("Audio capture disconnected");
          if (pa_stream_is_corked(stream))
            throw std::runtime_error("Audio capture has paused");
          // A loopback source may be suspended while its sink is idle. That is
          // ordinary silence, not evidence that a client or device failed.
          if (elapsedMs() >= nextDeviceCheck) {
            const auto actual = resolve(connection, input, configured);
            if (actual.name != device.name || actual.index != device.index)
              throw std::runtime_error("The selected audio device changed");
            if (input && actual.suspended)
              throw std::runtime_error("Audio input is suspended");
            nextDeviceCheck = elapsedMs() + 250;
          }
          while (!quit && pa_stream_readable_size(stream) > 0) {
            const void *data = nullptr; size_t bytes = 0;
            if (pa_stream_peek(stream, &data, &bytes) < 0)
              throw std::runtime_error("Audio capture could not read samples");
            if (!bytes) break;
            // PulseAudio holes contain silent frames. Silence is valid capture.
            std::vector<float> silent;
            if (!data) { silent.resize(bytes / sizeof(float), 0); data = silent.data(); }
            obs_source_audio audio{};
            audio.data[0] = static_cast<const uint8_t *>(data);
            audio.frames = uint32_t(bytes / 8);
            audio.speakers = SPEAKERS_STEREO; audio.samples_per_sec = 48000; audio.format = AUDIO_FORMAT_FLOAT;
            const auto duration = uint64_t(audio.frames) * 1000000000 / 48000;
            const auto now = os_gettime_ns();
            const auto queued = pa_stream_readable_size(stream);
            if (queued == size_t(-1))
              throw std::runtime_error("Audio capture could not inspect queued samples");
            // Record latency refers to the oldest unread frame. It includes
            // transport and device buffering. A monitor can be ahead of actual
            // playback, in which case Pulse returns a negative latency.
            pa_usec_t latency = 0; int negative = 0;
            uint64_t arrival = now - uint64_t(queued / 8) * 1000000000 / 48000;
            if (pa_stream_get_latency(stream, &latency, &negative) == 0 && latency < 10000000)
              arrival = negative ? now + latency * 1000 : now - std::min(now, latency * 1000);
            if (!nextTimestamp || std::abs(int64_t(arrival) - int64_t(nextTimestamp)) > 200000000)
              nextTimestamp = arrival;
            audio.timestamp = nextTimestamp;
            nextTimestamp += duration;
            if (audio.frames) {
              lastFrame = elapsedMs(); frames.fetch_add(audio.frames);
              obs_source_output_audio(source, &audio);
            }
            if (pa_stream_drop(stream) < 0) throw std::runtime_error("Audio capture could not release samples");
          }
        }
      } catch (const std::exception &error) { fail(error.what()); }
      for (int wait = 0; !quit && wait < 20; wait++)
        std::this_thread::sleep_for(std::chrono::milliseconds(25));
    }
    fail("Audio capture stopped");
  }
};
obs_properties_t *properties(bool input) {
  auto *result = obs_properties_create();
  auto *list = obs_properties_add_list(result, "device_id", "Device", OBS_COMBO_TYPE_LIST, OBS_COMBO_FORMAT_STRING);
  obs_property_list_add_string(list, "Default", "default");
  std::atomic<bool> quit{false};
  try {
    Connection connection(quit);
    if (input) connection.operation(pa_context_get_source_info_list(connection.context,
        [](pa_context *, const pa_source_info *info, int end, void *value) {
          if (!end && info && info->monitor_of_sink == PA_INVALID_INDEX)
            obs_property_list_add_string(static_cast<obs_property_t *>(value), info->description, info->name);
        }, list));
    else connection.operation(pa_context_get_sink_info_list(connection.context,
        [](pa_context *, const pa_sink_info *info, int end, void *value) {
          if (!end && info && info->monitor_source_name)
            obs_property_list_add_string(static_cast<obs_property_t *>(value), info->description, info->monitor_source_name);
        }, list));
  } catch (...) {}
  return result;
}
void *create(obs_data_t *settings, obs_source_t *source, bool input) {
  auto *capture = new Capture(settings, source, input);
  proc_handler_add(obs_source_get_proc_handler(source), "void get_capture_health(out bool ready, out string message, out int frames)",
      [](void *value, calldata_t *state) {
        auto *capture = static_cast<Capture *>(value);
        const auto error = capture->error();
        calldata_set_bool(state, "ready", error.empty());
        calldata_set_string(state, "message", error.c_str());
        calldata_set_int(state, "frames", int64_t(capture->frames.load()));
      }, capture);
  return capture;
}
}
const char *linuxInputAudioType() { return "attaclip_pulse_device_input"; }
const char *linuxOutputAudioType() { return "attaclip_pulse_device_output"; }
void registerLinuxDeviceAudio() {
  for (const bool input : {true, false}) {
    obs_source_info info{};
    info.id = input ? linuxInputAudioType() : linuxOutputAudioType();
    info.type = OBS_SOURCE_TYPE_INPUT; info.output_flags = OBS_SOURCE_AUDIO | OBS_SOURCE_DO_NOT_DUPLICATE;
    info.get_name = input ? [](void *) { return "Audio input"; } : [](void *) { return "Audio output"; };
    info.create = input ? [](obs_data_t *data, obs_source_t *source) { return create(data, source, true); }
                        : [](obs_data_t *data, obs_source_t *source) { return create(data, source, false); };
    info.destroy = [](void *value) { delete static_cast<Capture *>(value); };
    info.get_defaults = [](obs_data_t *data) { obs_data_set_default_string(data, "device_id", "default"); };
    info.get_properties = input ? [](void *) { return properties(true); } : [](void *) { return properties(false); };
    obs_register_source(&info);
  }
}
std::string linuxDeviceAudioError(obs_source_t *source) {
  if (!source) return {};
  const std::string kind = obs_source_get_id(source);
  if (kind != linuxInputAudioType() && kind != linuxOutputAudioType()) return {};
  calldata_t state{}; calldata_init(&state);
  const bool queried = proc_handler_call(obs_source_get_proc_handler(source), "get_capture_health", &state);
  std::string message = queried ? calldata_string(&state, "message") : "Audio capture health is unavailable";
  calldata_free(&state);
  return message;
}
