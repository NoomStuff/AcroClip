// SPDX-License-Identifier: GPL-2.0-or-later
#include "desktop-audio.hpp"
#include "../audio-submix.hpp"
#include "listen-safety.hpp"
#include <atomic>
#include <chrono>
#include <cstring>
#include <map>
#include <mutex>
#include <set>
#include <thread>

namespace acroclip::windows {
namespace {
std::mutex exclusionsMutex;
std::vector<uint32_t> exclusions;
std::map<DWORD, DWORD> processParents() {
  HANDLE snapshot = CreateToolhelp32Snapshot(TH32CS_SNAPPROCESS, 0);
  if (snapshot == INVALID_HANDLE_VALUE) throw std::runtime_error("Desktop audio processes could not be identified");
  std::map<DWORD, DWORD> result;
  PROCESSENTRY32 entry{};
  entry.dwSize = sizeof(entry);
  if (Process32First(snapshot, &entry)) do {
    result[entry.th32ProcessID] = entry.th32ParentProcessID;
  } while (Process32Next(snapshot, &entry));
  CloseHandle(snapshot);
  return result;
}
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
  struct Child { obs_source_t *source; obs_sceneitem_t *item; };
  std::map<DWORD, Child> children;

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
  void update() {
    ListenRouting routing;
    auto endpoint = routing.device(device.empty() ? "default" : device);
    Microsoft::WRL::ComPtr<IAudioSessionManager2> manager;
    Microsoft::WRL::ComPtr<IAudioSessionEnumerator> sessions;
    if (FAILED(endpoint->Activate(__uuidof(IAudioSessionManager2), CLSCTX_ALL, nullptr, reinterpret_cast<void **>(manager.GetAddressOf()))) ||
        FAILED(manager->GetSessionEnumerator(&sessions)))
      throw std::runtime_error("Desktop audio sessions could not be enumerated");
    auto parents = processParents();
    std::vector<uint32_t> excluded;
    { std::lock_guard<std::mutex> lock(exclusionsMutex); excluded = exclusions; }
    // The app supplies its PID. Native-only fixtures exclude the recorder,
    // without treating their test launcher and sibling tone processes as AcroClip.
    excluded.push_back(GetCurrentProcessId());
    std::set<DWORD> selected;
    int count = 0;
    if (FAILED(sessions->GetCount(&count))) throw std::runtime_error("Desktop audio sessions could not be read");
    for (int index = 0; index < count; ++index) {
      Microsoft::WRL::ComPtr<IAudioSessionControl> control;
      Microsoft::WRL::ComPtr<IAudioSessionControl2> session;
      DWORD pid = 0;
      AudioSessionState state = AudioSessionStateExpired;
      if (FAILED(sessions->GetSession(index, &control)) || FAILED(control.As(&session)) ||
          FAILED(session->GetProcessId(&pid)) || FAILED(session->GetState(&state)))
        throw std::runtime_error("A desktop audio session could not be identified");
      if (!pid || state == AudioSessionStateExpired) continue;
      if (std::any_of(excluded.begin(), excluded.end(), [&](DWORD root) { return within(pid, root, parents); })) continue;
      // Windows captures a process tree. An audible ancestor of a separately
      // captured process cannot safely be included in the remaining mix.
      if (std::any_of(excluded.begin(), excluded.end(), [&](DWORD root) { return within(root, pid, parents); })) {
        if (state != AudioSessionStateActive) continue;
        throw std::runtime_error("Desktop audio cannot separate an application from its audible parent process");
      }
      selected.insert(pid);
    }
    // A parent capture already includes its descendants. Never mix them twice.
    for (auto it = selected.begin(); it != selected.end();) {
      const DWORD pid = *it;
      if (std::any_of(selected.begin(), selected.end(), [&](DWORD other) { return other != pid && within(pid, other, parents); })) it = selected.erase(it);
      else ++it;
    }
    // Process loopback has no endpoint selector. Refuse a process that is
    // actually playing on another device rather than save that device's audio
    // under the selected output's name.
    Microsoft::WRL::ComPtr<IMMDeviceEnumerator> enumerator;
    Microsoft::WRL::ComPtr<IMMDeviceCollection> endpoints;
    if (FAILED(CoCreateInstance(__uuidof(MMDeviceEnumerator), nullptr, CLSCTX_ALL, IID_PPV_ARGS(&enumerator))) ||
        FAILED(enumerator->EnumAudioEndpoints(eRender, DEVICE_STATE_ACTIVE, &endpoints)))
      throw std::runtime_error("Desktop audio output routing could not be verified");
    UINT endpointCount = 0;
    if (FAILED(endpoints->GetCount(&endpointCount))) throw std::runtime_error("Desktop audio outputs could not be read");
    const auto selectedEndpoint = ListenRouting::identity(endpoint.Get());
    for (UINT index = 0; index < endpointCount && !selected.empty(); ++index) {
      Microsoft::WRL::ComPtr<IMMDevice> other;
      Microsoft::WRL::ComPtr<IAudioSessionManager2> otherManager;
      Microsoft::WRL::ComPtr<IAudioSessionEnumerator> otherSessions;
      if (FAILED(endpoints->Item(index, &other))) throw std::runtime_error("A desktop audio output could not be identified");
      if (ListenRouting::identity(other.Get()) == selectedEndpoint) continue;
      if (FAILED(other->Activate(__uuidof(IAudioSessionManager2), CLSCTX_ALL, nullptr, reinterpret_cast<void **>(otherManager.GetAddressOf()))) ||
          FAILED(otherManager->GetSessionEnumerator(&otherSessions)))
        throw std::runtime_error("Desktop audio output routing could not be inspected");
      int otherCount = 0;
      if (FAILED(otherSessions->GetCount(&otherCount))) throw std::runtime_error("Desktop audio output sessions could not be read");
      for (int sessionIndex = 0; sessionIndex < otherCount; ++sessionIndex) {
        Microsoft::WRL::ComPtr<IAudioSessionControl> control;
        Microsoft::WRL::ComPtr<IAudioSessionControl2> session;
        DWORD pid = 0;
        AudioSessionState state = AudioSessionStateExpired;
        if (FAILED(otherSessions->GetSession(sessionIndex, &control)) || FAILED(control.As(&session)) ||
            FAILED(session->GetProcessId(&pid)) || FAILED(session->GetState(&state)))
          throw std::runtime_error("A desktop audio session could not be identified");
        if (state == AudioSessionStateActive && std::any_of(selected.begin(), selected.end(), [&](DWORD root) { return within(pid, root, parents); }))
          throw std::runtime_error("Desktop audio cannot separate an application playing through multiple outputs. Route it through one output");
      }
    }
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
      children.emplace(pid, Child{child, item});
    }
    for (const auto &[pid, child] : children) {
      calldata_t health{};
      calldata_init(&health);
      const bool queried = proc_handler_call(obs_source_get_proc_handler(child.source), "get_capture_health", &health);
      const auto phase = calldata_int(&health, "state");
      calldata_free(&health);
      if (!queried || phase != 1) throw std::runtime_error("Desktop audio is waiting for a process capture");
    }
  }
  void run() {
    while (!quit) {
      std::string error;
      try { update(); } catch (const std::exception &problem) { error = problem.what(); }
      { std::lock_guard<std::mutex> lock(mutex); failure = error; }
      // Failure must never fall back to an unfiltered device mix.
      if (!error.empty() && error != "Desktop audio is waiting for a process capture") clear();
      for (int i = 0; i < 10 && !quit; ++i) std::this_thread::sleep_for(std::chrono::milliseconds(10));
    }
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
