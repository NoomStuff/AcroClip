// SPDX-License-Identifier: GPL-2.0-or-later
#include "desktop-audio.hpp"
#include "../audio-submix.hpp"
#include "listen-safety.hpp"
#include "audio-health-policy.hpp"
#include <atomic>
#include <chrono>
#include <cstring>
#include <functional>
#include <map>
#include <memory>
#include <mutex>
#include <set>
#include <thread>

namespace acroclip::windows {
namespace {
std::mutex exclusionsMutex;
std::vector<uint32_t> exclusions;
bool within(DWORD pid, DWORD root, const std::map<DWORD, DWORD> &parents) {
  for (unsigned depth = 0; pid && depth < 128; ++depth) {
    if (pid == root) return true;
    auto found = parents.find(pid);
    if (found == parents.end() || found->second == pid) break;
    pid = found->second;
  }
  return false;
}

struct DesktopAudio {
  AudioSubmixClock clock;
  obs_source_t *source;
  obs_scene_t *scene = nullptr;
  std::string device;
  std::atomic<bool> quit{false};
  std::thread thread;
  std::mutex mutex;
  std::string failure = "Audio capture is starting";
  struct Child { obs_source_t *source; obs_sceneitem_t *item; ProcessCaptureHealth health; };
  std::map<DWORD, Child> children;
  // A process snapshot walks every process on the system, which is most of an update's cost.
  // Parents never change after a process starts, so the snapshot is reused until a session or
  // excluded app names a process it hasn't seen or one that started after it. See snapshotStale.
  std::map<DWORD, DWORD> parents;
  std::chrono::steady_clock::time_point parentsAt{};
  uint64_t parentsTakenAt = 0;
  std::set<DWORD> absent;

  DesktopAudio(obs_data_t *settings, obs_source_t *owner) : source(owner), device(obs_data_get_string(settings, "device_id")) {
    scene = obs_scene_create_private("Desktop audio streams");
    if (!scene) throw std::runtime_error("Desktop audio could not be opened");
    obs_source_add_active_child(source, obs_scene_get_source(scene));
    thread = std::thread([this] { run(); });
  }
  ~DesktopAudio() {
    quit = true;
    if (thread.joinable()) thread.join();
    clear();
    obs_source_remove_active_child(source, obs_scene_get_source(scene));
    obs_scene_release(scene);
  }
  void clear() {
    for (auto &[pid, child] : children) {
      obs_sceneitem_remove(child.item);
      obs_source_release(child.source);
    }
    children.clear();
  }
  using Session = ListenRouting::Session;
  SessionCache<Session> otherSessions;
  static std::vector<Session> sessionsOn(IMMDevice *endpoint) { return ListenRouting::sessions(endpoint); }
  // Setting up COM and the device enumerator cost about 2 ms of CPU, and looking up the default
  // output another 2 ms of waiting on the audio service. Both used to happen every round, ten
  // times a second. Now the routing lives as long as this thread, and the output is looked up
  // again once a second or after any error. Apps on a new default join within that second, and
  // apps already captured stay in meanwhile, because they still play on the old output.
  std::unique_ptr<ListenRouting> routing;
  Microsoft::WRL::ComPtr<IMMDevice> endpoint;
  std::chrono::steady_clock::time_point endpointAt{};
  static constexpr std::chrono::seconds endpointInterval{1};
  void forgetRouting() {
    endpoint.Reset();
    routing.reset();
  }
  std::string update() {
    const auto now = std::chrono::steady_clock::now();
    if (!routing) routing = std::make_unique<ListenRouting>();
    if (!endpoint || now - endpointAt >= endpointInterval) {
      endpoint = routing->device(device.empty() ? "default" : device);
      endpointAt = now;
    }
    std::vector<uint32_t> excluded;
    { std::lock_guard<std::mutex> lock(exclusionsMutex); excluded = exclusions; }
    // The app supplies its PID. Native-only fixtures exclude the recorder,
    // without treating their test launcher and sibling tone processes as AcroClip.
    excluded.push_back(GetCurrentProcessId());
    std::set<uint32_t> captured;
    for (const auto &[pid, child] : children) captured.insert(pid);
    const auto others = [&]() -> const std::vector<Session> & {
      return otherSessions.get(now, [&] {
        std::vector<std::function<std::vector<Session>()>> lists;
        const auto current = ListenRouting::identity(endpoint.Get());
        for (auto &output : routing->outputs())
          if (ListenRouting::identity(output.Get()) != current) lists.push_back([output] { return sessionsOn(output.Get()); });
        return collectSessions<Session>(lists);
      });
    };
    const std::vector<Session> listed = followCapturedSessions(sessionsOn(endpoint.Get()), captured, others);
    std::set<DWORD> wanted(excluded.begin(), excluded.end());
    for (const auto &item : listed) wanted.insert(item.pid);
    // About 2 us per process, against 9 ms for a snapshot of all of them.
    std::vector<SnapshotCheck> checks;
    for (DWORD pid : wanted) checks.push_back({pid, parents.count(pid) > 0 || absent.count(pid) > 0, processStarted(pid)});
    if (snapshotStale(parentsTakenAt, now - parentsAt, checks)) {
      FILETIME taken{};
      GetSystemTimeAsFileTime(&taken);
      parents = processParents();
      parentsTakenAt = (uint64_t(taken.dwHighDateTime) << 32) | taken.dwLowDateTime;
      parentsAt = now;
      absent.clear();
      for (DWORD pid : wanted) if (!parents.count(pid)) absent.insert(pid);
    }
    std::set<DWORD> selected;
    std::set<DWORD> active;
    for (const auto &[pid, state] : listed) {
      // An inactive session has no running streams. Only retain an existing
      // capture through silence; never open a new one for an idle application.
      if (state != AudioSessionStateActive && !children.count(pid)) continue;
      if (std::any_of(excluded.begin(), excluded.end(), [&](DWORD root) { return within(pid, root, parents); })) continue;
      // Windows captures a process tree. An audible ancestor of a separately
      // captured process cannot safely be included in the remaining mix.
      if (std::any_of(excluded.begin(), excluded.end(), [&](DWORD root) { return within(root, pid, parents); })) {
        if (state != AudioSessionStateActive) continue;
        throw std::runtime_error("Desktop audio cannot separate an application from its audible parent process");
      }
      selected.insert(pid);
      if (state == AudioSessionStateActive) active.insert(pid);
    }
    // A parent capture already includes its descendants. Never mix them twice.
    for (auto it = selected.begin(); it != selected.end();) {
      const DWORD pid = *it;
      if (std::any_of(selected.begin(), selected.end(), [&](DWORD other) { return other != pid && within(pid, other, parents); })) it = selected.erase(it);
      else ++it;
    }
    // Process loopback has no endpoint selector, so a process that also plays on another output
    // brings that audio along. Mixers like SteelSeries Sonar render one process to several
    // outputs, and refusing them would leave the whole desktop track silent.
    for (auto it = children.begin(); it != children.end();) {
      if (!selected.count(it->first)) {
        obs_sceneitem_remove(it->second.item);
        obs_source_release(it->second.source);
        it = children.erase(it);
      } else ++it;
    }
    for (DWORD pid : selected) {
      if (children.count(pid)) continue;
      auto *settings = obs_data_create();
      obs_data_set_int(settings, "acroclip_process_id", pid);
      auto *child = obs_source_create_private("wasapi_process_output_capture", "Desktop process audio", settings);
      obs_data_release(settings);
      if (!child) throw std::runtime_error("A desktop audio process could not be opened");
      obs_source_set_audio_mixers(child, 0x3f);
      auto *item = obs_scene_add(scene, child);
      if (!item) { obs_source_release(child); throw std::runtime_error("A desktop audio stream could not be added"); }
      children.emplace(pid, Child{child, item, ProcessCaptureHealth{}});
    }
    std::string healthFailure;
    for (auto it = children.begin(); it != children.end();) {
      auto &[pid, child] = *it;
      calldata_t health{};
      calldata_init(&health);
      const bool queried = proc_handler_call(obs_source_get_proc_handler(child.source), "get_capture_health", &health);
      const auto phase = calldata_int(&health, "state");
      const auto version = calldata_int(&health, "version");
      const bool ready = calldata_bool(&health, "ready");
      const auto result = static_cast<uint32_t>(calldata_int(&health, "hresult"));
      calldata_free(&health);
      const bool audible = std::any_of(active.begin(), active.end(), [&](DWORD process) { return within(process, pid, parents); });
      if ((!queried || phase != 1 || !ready) && !audible) {
        obs_sceneitem_remove(child.item);
        obs_source_release(child.source);
        it = children.erase(it);
        continue;
      }
      const auto error = child.health.error(queried, int(version), int(phase), ready, result, ProcessCaptureHealth::Clock::now());
      if (healthFailure.empty() && !error.empty()) healthFailure = "Desktop audio process " + std::to_string(pid) + ": " + error;
      ++it;
    }
    return healthFailure;
  }
  void run() {
    while (!quit) {
      std::string error;
      try { error = update(); } catch (const std::exception &problem) {
        error = problem.what();
        // Routing errors invalidate the mix. A reconnecting process does not:
        // keep healthy children and let WASAPI retry its own failed client.
        clear();
        // A removed output or a restarted audio service leaves the kept routing unusable.
        forgetRouting();
      }
      { std::lock_guard<std::mutex> lock(mutex); failure = error; }
      // Failure must never fall back to an unfiltered device mix.
      for (int i = 0; i < 10 && !quit; ++i) std::this_thread::sleep_for(std::chrono::milliseconds(10));
    }
    // COM was set up on this thread, so it's released here too.
    forgetRouting();
  }
  bool render(uint64_t *timestamp, audio_output_data *output, size_t channels) {
    auto *child = obs_scene_get_source(scene);
    if (obs_source_audio_pending(child)) return false;
    *timestamp = obs_source_get_audio_timestamp(child);
    if (!*timestamp) return false;
    obs_source_audio_mix mix{};
    obs_source_get_audio_mix(child, &mix);
    for (size_t channel = 0; channel < channels; ++channel)
      std::memcpy(output->data[channel], mix.output[0].data[channel], AUDIO_OUTPUT_FRAMES * sizeof(float));
    return true;
  }
};
}
bool filteredDesktop(obs_source_t *source) { return source && std::string(obs_source_get_id(source)) == "acroclip_desktop_audio"; }
std::string desktopAudioError(obs_source_t *source) {
  if (!filteredDesktop(source)) return {};
  auto *state = static_cast<DesktopAudio *>(obs_obj_get_data(source));
  std::lock_guard<std::mutex> lock(state->mutex);
  return state->failure;
}
void setDesktopExclusions(const std::vector<uint32_t> &pids) { std::lock_guard<std::mutex> lock(exclusionsMutex); exclusions = pids; }
void registerDesktopAudio() {
  obs_source_info info{};
  info.id = "acroclip_desktop_audio";
  info.type = OBS_SOURCE_TYPE_INPUT;
  info.output_flags = OBS_SOURCE_AUDIO | OBS_SOURCE_DO_NOT_DUPLICATE;
  info.get_name = [](void *) { return "Desktop audio"; };
  info.create = [](obs_data_t *settings, obs_source_t *source) -> void * {
    try { return new DesktopAudio(settings, source); } catch (...) { return nullptr; }
  };
  info.destroy = [](void *data) { delete static_cast<DesktopAudio *>(data); };
  info.enum_active_sources = [](void *data, obs_source_enum_proc_t callback, void *context) {
    auto *self = static_cast<DesktopAudio *>(data);
    callback(self->source, obs_scene_get_source(self->scene), context);
  };
  info.audio_mix = [](void *data, uint64_t *timestamp, audio_output_data *output, size_t channels, size_t) {
    return static_cast<DesktopAudio *>(data)->render(timestamp, output, channels);
  };
  obs_register_source(&info);
}
}
