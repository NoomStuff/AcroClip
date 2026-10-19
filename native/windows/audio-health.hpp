// SPDX-License-Identifier: GPL-2.0-or-later
#pragma once
#include "audio-health-policy.hpp"
#include <windows.h>
#include <mmdeviceapi.h>
#include <wrl/client.h>
#include <obs.h>
#include <map>
#include <memory>
#include <mutex>
#include <string>

namespace acroclip::windows {
class AudioHealth {
  using Clock = InputDelivery::Clock;
  struct Entry {
    explicit Entry(bool value, std::string identity)
        : input(value), device(std::move(identity)), delivery(Clock::now()) {}
    bool input;
    std::string device;
    InputDelivery delivery;
    Clock::time_point nextCheck{};
    std::string endpointFailure;
  };
  std::map<obs_source_t *, std::unique_ptr<Entry>> entries;
  std::mutex mutex;
  static void received(void *context, obs_source_t *, const audio_data *data, bool) {
    if (data) static_cast<Entry *>(context)->delivery.delivered(data->frames, Clock::now());
  }
  static EndpointState endpoint(const Entry &entry) {
    const HRESULT initialized = CoInitializeEx(nullptr, COINIT_MULTITHREADED);
    if (FAILED(initialized) && initialized != RPC_E_CHANGED_MODE) return EndpointState::failed;
    EndpointState state = EndpointState::failed;
    // Create/use/release all COM interfaces on this checking thread. OBS invokes
    // health from both command and packet threads, so no enumerator is shared.
    {
      using Microsoft::WRL::ComPtr;
      ComPtr<IMMDeviceEnumerator> enumerator;
      ComPtr<IMMDevice> device;
      HRESULT result = CoCreateInstance(__uuidof(MMDeviceEnumerator), nullptr, CLSCTX_ALL,
                                       IID_PPV_ARGS(&enumerator));
      if (SUCCEEDED(result)) {
        if (entry.device == "default") {
          result = enumerator->GetDefaultAudioEndpoint(entry.input ? eCapture : eRender,
              entry.input ? eCommunications : eConsole, &device);
        } else {
          const int count = MultiByteToWideChar(CP_UTF8, MB_ERR_INVALID_CHARS,
                                               entry.device.c_str(), -1, nullptr, 0);
          if (count > 0) {
            std::wstring identity(size_t(count), L'\0');
            MultiByteToWideChar(CP_UTF8, MB_ERR_INVALID_CHARS, entry.device.c_str(), -1,
                                identity.data(), count);
            result = enumerator->GetDevice(identity.c_str(), &device);
          } else result = E_INVALIDARG;
        }
        if (SUCCEEDED(result)) {
          DWORD flags = 0;
          result = device->GetState(&flags);
          if (SUCCEEDED(result)) state = flags == DEVICE_STATE_ACTIVE
              ? EndpointState::active : EndpointState::unavailable;
        } else if (result == HRESULT_FROM_WIN32(ERROR_NOT_FOUND) || result == E_INVALIDARG)
          state = EndpointState::unavailable;
      }
    }
    if (SUCCEEDED(initialized)) CoUninitialize();
    return state;
  }
public:
  void watch(obs_source_t *source) {
    if (!source) return;
    const std::string kind = obs_source_get_id(source);
    if (kind != "wasapi_input_capture" && kind != "wasapi_output_capture") return;
    std::lock_guard<std::mutex> lock(mutex);
    if (entries.count(source)) return;
    auto *settings = obs_source_get_settings(source);
    std::string device = obs_data_get_string(settings, "device_id");
    obs_data_release(settings);
    auto entry = std::make_unique<Entry>(kind == "wasapi_input_capture", device);
    if (entry->input) obs_source_add_audio_capture_callback(source, received, entry.get());
    entries.emplace(source, std::move(entry));
  }
  void forget(obs_source_t *source) {
    std::lock_guard<std::mutex> lock(mutex);
    const auto entry = entries.find(source);
    if (entry == entries.end()) return;
    if (entry->second->input)
      obs_source_remove_audio_capture_callback(source, received, entry->second.get());
    entries.erase(entry);
  }
  std::string error(obs_source_t *source) {
    std::lock_guard<std::mutex> lock(mutex);
    const auto found = entries.find(source);
    if (found == entries.end()) return {};
    auto &entry = *found->second;
    const auto now = Clock::now();
    if (now >= entry.nextCheck) {
      entry.endpointFailure = endpointError(endpoint(entry));
      entry.nextCheck = now + std::chrono::seconds(1);
    }
    if (!entry.endpointFailure.empty()) return entry.endpointFailure;
    calldata_t state{};
    calldata_init(&state);
    const bool queried = proc_handler_call(obs_source_get_proc_handler(source),
                                          "get_capture_health", &state);
    const auto version = calldata_int(&state, "version");
    const auto phase = calldata_int(&state, "state");
    const bool ready = calldata_bool(&state, "ready");
    const auto result = static_cast<uint32_t>(calldata_int(&state, "hresult"));
    calldata_free(&state);
    if (!queried || version != 1 || phase < 0 || phase > 3)
      return "Audio capture health is unavailable. Repair the recorder installation";
    const auto captureFailure = captureStateError(static_cast<int>(phase), ready, result, entry.input);
    if (!captureFailure.empty()) return captureFailure;
    // DeviceOutput loopback may correctly send no packets during silence.
    return entry.input ? entry.delivery.error(now) : std::string{};
  }
};
}
