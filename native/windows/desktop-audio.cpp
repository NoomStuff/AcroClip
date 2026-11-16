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
/** Bumped when the app changes its exclusions, so the next round lists sessions again. */
std::atomic<uint64_t> exclusionGeneration{0};
/** Every running Desktop audio's listener, so a change of exclusions wakes them at once. */
std::mutex listenersMutex;
std::set<AudioChanges *> listeners;
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
  /** Shared under `mutex` after every round, for native checks. */
  DesktopAudioActivity activity;
  uint64_t listings = 0;
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
    changes.Attach(new AudioChanges());
    { std::lock_guard<std::mutex> lock(listenersMutex); listeners.insert(changes.Get()); }
    thread = std::thread([this] { run(); });
  }
  ~DesktopAudio() {
    { std::lock_guard<std::mutex> lock(listenersMutex); listeners.erase(changes.Get()); }
    quit = true;
    changes->stop();
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
  // Windows reports when sessions start, stop or end and when outputs change, so the sessions are
  // only listed after a change. That used to happen ten times a second whether or not anything
  // changed. A listing every 2 s, or every second while a captured app plays on another output,
  // catches anything a report could miss. The routing and the default output's session manager
  // live as long as this thread, and the output is looked up again after a change or every 10 s.
  Microsoft::WRL::ComPtr<AudioChanges> changes;
  std::unique_ptr<ListenRouting> routing;
  bool outputsWatched = false;
  SessionWatch sessions;
  Microsoft::WRL::ComPtr<IMMDevice> endpoint;
  std::wstring endpointId;
  std::chrono::steady_clock::time_point endpointAt{};
  std::chrono::steady_clock::time_point listedAt{};
  uint64_t listedExclusions = 0;
  /** A captured app was last found on another output, which Windows doesn't report changes for. */
  bool moved = false;
  /** A child was dropped between listings, so the next round lists again. */
  bool relist = false;
  std::set<DWORD> active;
  static constexpr std::chrono::seconds endpointInterval{10};
  static constexpr std::chrono::seconds listInterval{2};
  static constexpr std::chrono::seconds movedListInterval{1};
  /** Child health and anything Windows reported are handled at least this often. */
  static constexpr std::chrono::milliseconds round{250};
  void forgetRouting() {
    sessions.stop();
    if (routing && outputsWatched) routing->unwatch(changes.Get());
    outputsWatched = false;
    endpoint.Reset();
    endpointId.clear();
    routing.reset();
  }
  std::string update(AudioChanges::Pending pending) {
    const auto now = std::chrono::steady_clock::now();
    if (!routing) {
      routing = std::make_unique<ListenRouting>();
      routing->watch(changes.Get());
      outputsWatched = true;
      pending.outputs = true;
    }
    if (pending.outputs || !endpoint || now - endpointAt >= endpointInterval) {
      auto found = routing->device(device.empty() ? "default" : device);
      const auto id = ListenRouting::identity(found.Get());
      endpointAt = now;
      if (id != endpointId || !sessions.started()) {
        endpoint = found;
        endpointId = id;
        // Its other-output listing left out the new default and included the old one.
        otherSessions.clear();
        sessions.start(endpoint.Get(), changes.Get());
        pending.sessions = true;
      }
    }
    const uint64_t exclusionsNow = exclusionGeneration.load();
    if (pending.sessions || relist || exclusionsNow != listedExclusions || now - listedAt >= (moved ? movedListInterval : listInterval)) {
      listedExclusions = exclusionsNow;
      relist = false;
      select(now);
      listedAt = now;
      ++listings;
    }
    return health();
  }
  void select(std::chrono::steady_clock::time_point now) {
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
        for (auto &output : routing->outputs())
          if (ListenRouting::identity(output.Get()) != endpointId) lists.push_back([output] { return sessionsOn(output.Get()); });
        return collectSessions<Session>(lists);
      });
    };
    const std::vector<Session> onDefault = sessions.list();
    moved = std::any_of(captured.begin(), captured.end(), [&](uint32_t pid) {
      return std::none_of(onDefault.begin(), onDefault.end(), [&](const Session &item) { return item.pid == pid; });
    });
    const std::vector<Session> listed = followCapturedSessions(onDefault, captured, others);
    std::set<DWORD> wanted(excluded.begin(), excluded.end());
    for (const auto &item : listed) wanted.insert(item.pid);
    // About 2 us per process, against 9 ms for a snapshot of all of them.
    std::vector<SnapshotCheck> checks;
    for (DWORD pid : wanted) {
      const auto start = processStarted(pid);
      checks.push_back({pid, parents.count(pid) > 0 || absent.count(pid) > 0, start.started, start.exists});
    }
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
    active.clear();
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
  }
  std::string health() {
    std::string healthFailure;
    for (auto it = children.begin(); it != children.end();) {
      auto &[pid, child] = *it;
      calldata_t report{};
      calldata_init(&report);
      const bool queried = proc_handler_call(obs_source_get_proc_handler(child.source), "get_capture_health", &report);
      const auto phase = calldata_int(&report, "state");
      const auto version = calldata_int(&report, "version");
      const bool ready = calldata_bool(&report, "ready");
      const auto result = static_cast<uint32_t>(calldata_int(&report, "hresult"));
      calldata_free(&report);
      const bool audible = std::any_of(active.begin(), active.end(), [&](DWORD process) { return within(process, pid, parents); });
      if ((!queried || phase != 1 || !ready) && !audible) {
        obs_sceneitem_remove(child.item);
        obs_source_release(child.source);
        it = children.erase(it);
        relist = true;
        continue;
      }
      const auto error = child.health.error(queried, int(version), int(phase), ready, result, ProcessCaptureHealth::Clock::now());
      if (healthFailure.empty() && !error.empty()) healthFailure = "Desktop audio process " + std::to_string(pid) + ": " + error;
      ++it;
    }
    return healthFailure;
  }
  void run() {
    AudioChanges::Pending pending{true, true};
    while (!quit) {
      std::string error;
      try { error = update(pending); } catch (const std::exception &problem) {
        error = problem.what();
        // Routing errors invalidate the mix. A reconnecting process does not:
        // keep healthy children and let WASAPI retry its own failed client.
        clear();
        // A removed output or a restarted audio service leaves the kept routing unusable.
        forgetRouting();
      }
      {
        std::lock_guard<std::mutex> lock(mutex);
        failure = error;
        activity.processes.clear();
        for (const auto &[pid, child] : children) activity.processes.push_back(pid);
        activity.listings = listings;
      }
      // Failure must never fall back to an unfiltered device mix. A report from Windows ends the wait early.
      pending = changes->wait(round);
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
DesktopAudioActivity desktopAudioActivity(obs_source_t *source) {
  if (!filteredDesktop(source)) return {};
  auto *state = static_cast<DesktopAudio *>(obs_obj_get_data(source));
  std::lock_guard<std::mutex> lock(state->mutex);
  return state->activity;
}
void setDesktopExclusions(const std::vector<uint32_t> &pids) {
  { std::lock_guard<std::mutex> lock(exclusionsMutex); exclusions = pids; }
  ++exclusionGeneration;
  std::lock_guard<std::mutex> lock(listenersMutex);
  for (auto *listener : listeners) listener->sessionsChanged();
}
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
