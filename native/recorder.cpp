#include "recording-preset.hpp"
// SPDX-License-Identifier: GPL-2.0-or-later
// Mux protocol follows OBS Studio's ffmpeg-mux/ffmpeg-mux.h, Copyright Lain
// Bailey.
#include "clip-writer.hpp"
#include <algorithm>
#include <atomic>
#include <cmath>
#include <cstring>
#include <deque>
#include <filesystem>
#include <fstream>
#include <iostream>
#include <json.hpp>
#include <memory>
#include <mutex>
#include <obs.h>
#include <set>
#include <thread>
#include <util/platform.h>
#include <vector>
#ifdef _WIN32
#include "windows/audio-health.hpp"
#include "windows/listen-safety.hpp"
#endif
#ifdef __APPLE__
#include "macos/platform.hpp"
#include <mach/mach_time.h>
#endif
#ifdef __linux__
#include "linux-app-audio.hpp"
#include "linux-device-audio.hpp"
#include "linux-process.hpp"
#include "wayland/platform.hpp"
#include "x11-compat.hpp"
#include <X11/Xlib.h>
#include <obs-nix-platform.h>
#include <pthread.h>
#include <signal.h>
#include <time.h>
#include <xcb/xcb.h>
#endif
// Separate XCB connections avoid process-wide Xlib error handler changes when a
// captured window disappears. Reply errors simply make that target unavailable.
#ifdef __linux__
xcb_connection_t *candidateConnection = nullptr;
std::mutex xcbMutex;
xcb_atom_t atom(const char *name) {
  auto *reply = xcb_intern_atom_reply(
      candidateConnection,
      xcb_intern_atom(candidateConnection, 0, uint16_t(strlen(name)), name),
      nullptr);
  xcb_atom_t value = reply ? reply->atom : XCB_ATOM_NONE;
  free(reply);
  return value;
}
std::vector<uint8_t> property(xcb_window_t window, const char *name) {
  auto *reply = xcb_get_property_reply(
      candidateConnection,
      xcb_get_property(candidateConnection, 0, window, atom(name),
                       XCB_GET_PROPERTY_TYPE_ANY, 0, 4096),
      nullptr);
  std::vector<uint8_t> result;
  if (reply) {
    auto *data = static_cast<uint8_t *>(xcb_get_property_value(reply));
    result.assign(data, data + xcb_get_property_value_length(reply));
  }
  free(reply);
  return result;
}
uint32_t cardinal(xcb_window_t window, const char *name) {
  auto bytes = property(window, name);
  uint32_t value = 0;
  if (bytes.size() >= 4)
    memcpy(&value, bytes.data(), 4);
  return value;
}
std::string windowText(xcb_window_t window, const char *name) {
  auto bytes = property(window, name);
  if (bytes.empty())
    return {};
  auto end = std::find(bytes.begin(), bytes.end(), uint8_t(0));
  return std::string(bytes.begin(), end);
}
bool x11Available(uintptr_t window, uint32_t pid, bool requireVisible = true) {
  std::lock_guard<std::mutex> lock(xcbMutex);
  if (!candidateConnection || xcb_connection_has_error(candidateConnection))
    return false;
  if (!window)
    return true;
  auto *reply = xcb_get_window_attributes_reply(
      candidateConnection,
      xcb_get_window_attributes(candidateConnection, uint32_t(window)),
      nullptr);
  bool available =
      reply &&
      (!requireVisible || reply->map_state == XCB_MAP_STATE_VIEWABLE) &&
      (!pid || cardinal(uint32_t(window), "_NET_WM_PID") == pid);
  free(reply);
  return available;
}
nlohmann::json captureCandidates() {
  std::lock_guard<std::mutex> lock(xcbMutex);
  nlohmann::json result = nlohmann::json::array();
  if (!candidateConnection || xcb_connection_has_error(candidateConnection) ||
      !xcb_get_setup(candidateConnection))
    return result;
  auto roots = xcb_setup_roots_iterator(xcb_get_setup(candidateConnection));
  for (; roots.rem; xcb_screen_next(&roots)) {
    auto *screen = roots.data;
    auto bytes = property(screen->root, "_NET_CLIENT_LIST");
    std::vector<xcb_window_t> windows(bytes.size() / 4);
    if (!windows.empty())
      memcpy(windows.data(), bytes.data(), windows.size() * 4);
    if (windows.empty()) {
      auto *tree = xcb_query_tree_reply(
          candidateConnection,
          xcb_query_tree(candidateConnection, screen->root), nullptr);
      if (tree)
        windows.assign(xcb_query_tree_children(tree),
                       xcb_query_tree_children(tree) +
                           xcb_query_tree_children_length(tree));
      free(tree);
    }
    auto foreground = cardinal(screen->root, "_NET_ACTIVE_WINDOW");
    for (auto window : windows) {
      auto *attrs = xcb_get_window_attributes_reply(
          candidateConnection,
          xcb_get_window_attributes(candidateConnection, window), nullptr);
      bool visible = attrs && attrs->map_state == XCB_MAP_STATE_VIEWABLE &&
                     !attrs->override_redirect;
      free(attrs);
      if (!visible)
        continue;
      auto name = windowText(window, "_NET_WM_NAME");
      if (name.empty())
        name = windowText(window, "WM_NAME");
      auto pid = cardinal(window, "_NET_WM_PID");
      if (!pid || name.empty())
        continue;
      std::error_code error;
      auto executable = std::filesystem::read_symlink(
          "/proc/" + std::to_string(pid) + "/exe", error);
      if (error)
        continue;
      auto *geometry = xcb_get_geometry_reply(
          candidateConnection, xcb_get_geometry(candidateConnection, window),
          nullptr);
      auto *position = xcb_translate_coordinates_reply(
          candidateConnection,
          xcb_translate_coordinates(candidateConnection, window, screen->root,
                                    0, 0),
          nullptr);
      bool fullscreen = geometry && position && position->dst_x <= 0 &&
                        position->dst_y <= 0 &&
                        geometry->width >= screen->width_in_pixels &&
                        geometry->height >= screen->height_in_pixels;
      free(geometry);
      free(position);
      nlohmann::json candidate = {
          {"id", "window:" + std::to_string(window) + ":0"},
          {"name", name},
          {"executable", executable.string()},
          {"pid", pid},
          {"foreground", foreground == window},
          {"fullscreen", fullscreen}};
      auto arguments = linuxProcessArguments(pid, executable);
      if (!arguments.empty()) {
        try {
          // Linux argv is byte-oriented. Invalid UTF-8 must not break the
          // JSON command channel or create a guessed catalog match.
          nlohmann::json(arguments).dump();
          candidate["arguments"] = arguments;
        } catch (const nlohmann::json::exception &) {
        }
      }
      if (auto image = wineProcessImage(pid, executable)) {
        candidate["executable"] = image->executable.string();
        candidate["runtime"] = "wine";
        candidate["runtimeExecutable"] = image->runtimeExecutable.string();
      }
      result.push_back(std::move(candidate));
    }
  }
  return result;
}
#endif
#ifdef _WIN32
#include <objbase.h>
#include <psapi.h>
#include <util/dstr.h>
#include <util/windows/window-helpers.h>
#include <windows.h>
#include "windows/capture-window.hpp"
#endif
using json = nlohmann::json;
#ifdef _WIN32
std::string utf8(const std::wstring &value) {
  if (value.empty())
    return {};
  int size = WideCharToMultiByte(CP_UTF8, 0, value.data(), int(value.size()),
                                 nullptr, 0, nullptr, nullptr);
  std::string result(size, '\0');
  WideCharToMultiByte(CP_UTF8, 0, value.data(), int(value.size()),
                      result.data(), size, nullptr, nullptr);
  return result;
}
std::string processArguments(HANDLE process) {
  using QueryProcess = LONG(NTAPI *)(HANDLE, ULONG, PVOID, ULONG, PULONG);
  static const auto query = reinterpret_cast<QueryProcess>(GetProcAddress(
      GetModuleHandleW(L"ntdll.dll"), "NtQueryInformationProcess"));
  if (!query)
    return {};
  struct UnicodeText {
    USHORT length, maximumLength;
    PWSTR buffer;
  };
  ULONG required = 0;
  constexpr ULONG commandLineInformation = 60;
  query(process, commandLineInformation, nullptr, 0, &required);
  if (required < sizeof(UnicodeText) || required > 128 * 1024)
    return {};
  std::vector<uint8_t> bytes(required);
  if (query(process, commandLineInformation, bytes.data(), required,
            &required) < 0)
    return {};
  UnicodeText text{};
  memcpy(&text, bytes.data(), sizeof(text));
  const auto start = reinterpret_cast<uintptr_t>(bytes.data());
  const auto address = reinterpret_cast<uintptr_t>(text.buffer);
  if (address < start || address - start > bytes.size() ||
      text.length > bytes.size() - (address - start) ||
      text.length % sizeof(wchar_t))
    return {};
  return utf8(std::wstring(text.buffer, text.length / sizeof(wchar_t)));
}
json captureCandidates() {
  json windows = json::array();
  EnumWindows(
      [](HWND window, LPARAM data) -> BOOL {
        if (!acroclip::windows::userCaptureWindow(window))
          return TRUE;
        int length = GetWindowTextLengthW(window);
        if (!length)
          return TRUE;
        std::wstring title(size_t(length) + 1, L'\0');
        title.resize(GetWindowTextW(window, title.data(), int(title.size())));
        DWORD pid = 0;
        GetWindowThreadProcessId(window, &pid);
        HANDLE process =
            OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, FALSE, pid);
        if (!process)
          return TRUE;
        std::wstring executable(32768, L'\0');
        DWORD size = DWORD(executable.size());
        bool identified =
            QueryFullProcessImageNameW(process, 0, executable.data(), &size);
        auto arguments = identified ? processArguments(process) : std::string{};
        CloseHandle(process);
        if (!identified)
          return TRUE;
        executable.resize(size);
        RECT rect{};
        MONITORINFO monitor{};
        monitor.cbSize = sizeof(monitor);
        bool fullscreen =
            !IsIconic(window) && GetWindowRect(window, &rect) &&
            GetMonitorInfo(MonitorFromWindow(window, MONITOR_DEFAULTTONEAREST),
                           &monitor) &&
            rect.left <= monitor.rcMonitor.left &&
            rect.top <= monitor.rcMonitor.top &&
            rect.right >= monitor.rcMonitor.right &&
            rect.bottom >= monitor.rcMonitor.bottom;
        auto &result = *reinterpret_cast<json *>(data);
        result.push_back(
            {{"id",
              "window:" + std::to_string(reinterpret_cast<uintptr_t>(window)) +
                  ":0"},
             {"name", utf8(title)},
             {"executable", utf8(executable)},
             {"pid", pid},
             {"arguments", arguments},
             {"pixelSize", [&] { RECT area{}; GetClientRect(window, &area); return json{{"width", area.right - area.left}, {"height", area.bottom - area.top}}; }()},
             {"foreground", window == GetForegroundWindow()},
             {"fullscreen", fullscreen}});
        return TRUE;
      },
      reinterpret_cast<LPARAM>(&windows));
  return windows;
}
#endif
std::mutex stdoutMutex;
std::atomic<bool> captureTextureFailure{false};
std::string muxExecutable = "obs-ffmpeg-mux.exe";
bool inputTypeAvailable(const char *id) {
  const char *registered = nullptr;
  for (size_t i = 0; obs_enum_input_types(i, &registered); i++)
    if (std::string(registered) == id)
      return true;
  return false;
}
obs_source_t *createCaptureSource(const char *id, obs_data_t *settings) {
  if (!inputTypeAvailable(id))
    throw std::runtime_error("The selected capture method is unavailable. Its "
                             "OBS module did not initialize on this session");
  return obs_source_create_private(id, "Capture", settings);
}
std::vector<std::string> hardwareEncoders() {
#ifdef __APPLE__
  return acroclip::macos::hardwareEncoders();
#else
  std::vector<std::string> result;
  // These are hardware encoders, including the upload path on a secondary
  // GPU. OBS modules register them only after their device availability probe.
  for (const char *preferred :
       {"obs_nvenc_h264_tex", "obs_nvenc_h264", "h264_texture_amf",
        "h264_fallback_amf", "obs_qsv11_v2", "obs_qsv11_soft_v2"}) {
    const char *id = nullptr;
    for (size_t i = 0; obs_enum_encoder_types(i, &id); i++)
      if (std::string(id) == preferred)
        result.emplace_back(preferred);
  }
  return result;
#endif
}
const char *graphicsModule() {
#ifdef _WIN32
  return "libobs-d3d11.dll";
#elif defined(__APPLE__)
  return acroclip::macos::graphicsModule();
#else
  return "libobs-opengl.so";
#endif
}
const char *microphoneType() {
#ifdef _WIN32
  return "wasapi_input_capture";
#elif defined(__APPLE__)
  return "coreaudio_input_capture";
#else
  return linuxInputAudioType();
#endif
}
const char *desktopType() {
#ifdef _WIN32
  return "wasapi_output_capture";
#elif defined(__linux__)
  return linuxOutputAudioType();
#else
  return "pulse_output_capture";
#endif
}
void idleVideo() {
  obs_video_info info{};
  info.graphics_module = graphicsModule();
  info.fps_num = 1;
  info.fps_den = 1;
  info.base_width = 16;
  info.base_height = 16;
  info.output_width = 16;
  info.output_height = 16;
  info.output_format = VIDEO_FORMAT_NV12;
  info.gpu_conversion = true;
  info.colorspace = VIDEO_CS_709;
  info.range = VIDEO_RANGE_PARTIAL;
  obs_reset_video(&info);
}
void emit(json value) {
  std::lock_guard<std::mutex> lock(stdoutMutex);
  std::cout << value.dump() << std::endl;
}
void logger(int level, const char *format, va_list args, void *) {
  if (strstr(format, "Cannot create EGLImage"))
    captureTextureFailure = true;
  if (level <= LOG_INFO) {
    vfprintf(stderr, format, args);
    fputs("\n", stderr);
  }
}
using Packet = acroclip::Packet;
using Request = acroclip::ClipRequest;
using Job = acroclip::ClipJob;
void accumulatePeak(std::atomic<float> &held, float value) {
  float previous = held.load();
  while (previous < value && !held.compare_exchange_weak(previous, value)) {}
}
class Recorder {
private:
  obs_output_t *output = nullptr;
  obs_encoder_t *video = nullptr;
  std::vector<obs_encoder_t *> audio;
  obs_scene_t *scene = nullptr;
  obs_source_t *capture = nullptr;
  obs_source_t *desktop = nullptr;
#ifdef __linux__
  ApplicationAudio *applicationAudio = nullptr;
#endif
  obs_source_t *mic = nullptr;
  struct ExtraMeter {
    Recorder *owner;
    std::string id;
    obs_volmeter_t *meter = nullptr;
    std::atomic<uint64_t> lastEvent{0};
    std::atomic<float> pendingPeak{0};
    ~ExtraMeter() {
      if (meter)
        obs_volmeter_destroy(meter);
    }
  };
  struct AdditionalAudio {
    std::string id, name, kind, deviceId;
    obs_source_t *source = nullptr;
    uintptr_t window = 0;
    uint32_t pid = 0;
    uint32_t isolatedMask = 0;
    uint32_t mixerMask = 0, outputChannel = 0;
    bool managedInput = false;
    uint64_t openedAt = 0;
    std::shared_ptr<ExtraMeter> metering;
#ifdef __linux__
    ApplicationAudio *application = nullptr;
#endif
  };
  std::vector<AdditionalAudio> additionalAudio;
  std::mutex audioSourcesMutex;
#ifdef _WIN32
  acroclip::windows::AudioHealth audioHealth;
#endif
  std::vector<std::string> audioNames;
  obs_sceneitem_t *item = nullptr;
  std::mutex mutex;
  std::deque<Packet> ring;
  std::deque<Request> requests;
  std::vector<std::vector<uint8_t>> streamHeaders;
  std::unique_ptr<acroclip::ClipWriter> clipWriter;
  bool captureInterrupted = false;
  bool deliveryInterrupted = false;
  uint64_t lastVideoClock = 0;
  int64_t recoveryBoundary = 0;
  std::atomic<bool> active{false};
  std::atomic<bool> monitoring{false};
  std::string listeningSource, listeningDevice, listeningRequestedDevice, listeningFailure;
  json sessionConfiguration;
  std::atomic<bool> waitingForPresetSize{false};
  int sessionCQ = 23;
  bool presetRecording = false;
  std::atomic<bool> encoderFailed{false};
  std::atomic<uintptr_t> targetWindow{0};
  std::atomic<uint32_t> targetProcess{0};
  std::atomic<bool> captureEnabled{false};
  std::atomic<bool> gameCapture{false}, gameReady{false};
  std::atomic<bool> captureImageReady{false};
  std::atomic<uint64_t> captureImageSince{0};
  uint64_t captureImageChecked = 0;
  acroclip::RecordingSize initialSize{0, 0};
  uint64_t initialSizeSince = 0;
  std::mutex captureSourceMutex;
  std::atomic<bool> windowCompatibility{false};
  uint64_t gameStarted = 0;
  json gameConfig;
  obs_volmeter_t *captureMeter = nullptr, *microphoneMeter = nullptr;
  struct MeterContext {
    Recorder *owner;
    bool microphone;
  } captureContext{this, false}, microphoneContext{this, true};
  std::atomic<float> captureLevel{0}, microphoneLevel{0};
  std::atomic<float> capturePendingPeak{0}, microphonePendingPeak{0};
  std::atomic<uint64_t> lastMeterEvent{0};
  float captureVolume = 1, microphoneVolume = 1;
  bool captureMuted = false, microphoneMuted = false;
  uint64_t microphoneOpenedAt = 0;
  std::atomic<bool> captureAudioEnabled{true};
  std::atomic<bool> screenCapture{true};
  std::mutex displayIdentityMutex;
  std::string selectedDisplayIdentity;
  uint64_t displayIdentityChecked = 0;
  bool displayIdentityAvailable = true;
  size_t bytes = 0;
  int seconds = 60, width = 1920, height = 1080, fps = 60;
  bool avoidOverlap = false;
  std::string encoder, sourceName, selectedSourceId;
  std::string bufferedSourceName, bufferedSourceId;
  std::string audioWarningCandidate;
  uint64_t audioWarningSince = 0;
  bool bufferedScreen = false;
#ifdef __linux__
  std::shared_ptr<acroclip::wayland::Capture> portalCapture;
#endif
public:
  Recorder() {
    captureMeter = obs_volmeter_create(OBS_FADER_LOG);
    microphoneMeter = obs_volmeter_create(OBS_FADER_LOG);
    auto callback = [](void *data, const float *, const float *peak,
                       const float *) {
      auto *context = static_cast<MeterContext *>(data);
      auto *r = context->owner;
      float value = 0;
      for (size_t i = 0; i < 2; i++)
        if (std::isfinite(peak[i]))
          value =
              std::max(value, std::clamp((peak[i] + 60.f) / 60.f, 0.f, 1.f));
      (context->microphone ? r->microphoneLevel : r->captureLevel) = value;
      accumulatePeak(context->microphone ? r->microphonePendingPeak : r->capturePendingPeak, value);
      uint64_t now = os_gettime_ns(), last = r->lastMeterEvent.load();
      if (r->active && now - last >= 33000000 &&
          r->lastMeterEvent.compare_exchange_strong(last, now)) {
        emit({{"event", "audio-levels"},
              {"capture", std::max(r->captureLevel.load(), r->capturePendingPeak.exchange(0))},
              {"microphone", std::max(r->microphoneLevel.load(), r->microphonePendingPeak.exchange(0))}});
      }
    };
    obs_volmeter_add_callback(captureMeter, callback, &captureContext);
    obs_volmeter_add_callback(microphoneMeter, callback, &microphoneContext);
    clipWriter = std::make_unique<acroclip::ClipWriter>(
        muxExecutable, [](const acroclip::ClipResult &result) {
          if (result.saved)
            emit({{"event", "saved"},
                  {"requestId", result.request.id},
                  {"path", result.request.path},
                  {"previousFootage", result.secondsSinceCapture > 0.25},
                  {"secondsSinceCapture", result.secondsSinceCapture},
                  {"source", result.request.source},
                  {"sourceId", result.request.sourceId},
                  {"overlapSeconds", result.overlapSeconds}});
          else
            emit({{"event", "error"},
                  {"requestId", result.request.id},
                  {"message", result.error}});
        });
  }
  ~Recorder() {
    stop();
    clipWriter->finish();
    release();
    obs_volmeter_destroy(captureMeter);
    obs_volmeter_destroy(microphoneMeter);
  }
private:
  void releaseEncoders() {
    if (output) {
      obs_output_release(output);
      output = nullptr;
    }
    if (video) {
      obs_encoder_release(video);
      video = nullptr;
    }
    for (auto *a : audio)
      obs_encoder_release(a);
    audio.clear();
  }
  void release() {
    waitingForPresetSize = false;
    initialSize = {0, 0};
    initialSizeSince = 0;
    listeningSource.clear();
    listeningFailure.clear();
    listeningDevice.clear();
    listeningRequestedDevice.clear();
    monitoring = false;
    audioWarningCandidate.clear();
    audioWarningSince = 0;
    captureEnabled = false;
    gameCapture = false;
    gameReady = false;
    windowCompatibility = false;
    obs_volmeter_detach_source(captureMeter);
    obs_volmeter_detach_source(microphoneMeter);
    captureLevel = 0;
    microphoneLevel = 0;
    capturePendingPeak = 0;
    microphonePendingPeak = 0;
    releaseEncoders();
    obs_set_output_source(0, nullptr);
    obs_set_output_source(1, nullptr);
    obs_set_output_source(2, nullptr);
    for (uint32_t channel = 3; channel < 8; channel++)
      obs_set_output_source(channel, nullptr);
    {
      std::lock_guard<std::mutex> audioLock(audioSourcesMutex);
      for (auto &extra : additionalAudio) {
        extra.metering.reset();
#ifdef __linux__
        if (extra.application)
          destroyApplicationAudio(extra.application);
        else
#endif
            if (extra.source) {
#ifdef __APPLE__
          acroclip::macos::forgetInput(extra.source);
#endif
#ifdef _WIN32
          audioHealth.forget(extra.source);
#endif
          obs_source_release(extra.source);
        }
      }
      additionalAudio.clear();
      audioNames.clear();
#ifdef __linux__
      destroyApplicationAudio(applicationAudio);
      applicationAudio = nullptr;
#endif
      if (desktop) {
#ifdef _WIN32
        audioHealth.forget(desktop);
#endif
        obs_source_release(desktop);
        desktop = nullptr;
      }
      if (mic) {
#ifdef __APPLE__
        acroclip::macos::forgetInput(mic);
#endif
#ifdef _WIN32
        audioHealth.forget(mic);
#endif
        obs_source_release(mic);
        mic = nullptr;
      }
    }
    if (scene) {
      obs_scene_release(scene);
      scene = nullptr;
    }
    if (capture) {
      obs_source_release(capture);
      capture = nullptr;
    }
#ifdef __linux__
    std::atomic_store(&portalCapture,
                      std::shared_ptr<acroclip::wayland::Capture>{});
#endif
    item = nullptr;
    obs_wait_for_destroy_queue();
  }
public:
  void stop() {
    // Drain accepted requests to their original timestamps before stopping.
    for (int i = 0; i < 100 && active; i++) {
      {
        std::lock_guard<std::mutex> lock(mutex);
        if (requests.empty())
          break;
      }
      std::this_thread::sleep_for(std::chrono::milliseconds(5));
    }
    active = false;
    {
      std::lock_guard<std::mutex> lock(mutex);
      for (auto &r : requests)
        snapshot(r);
      requests.clear();
    }
    if (output && obs_output_active(output))
      obs_output_force_stop(output);
    {
      std::lock_guard<std::mutex> lock(mutex);
      ring.clear();
      bufferedSourceName.clear();
      bufferedSourceId.clear();
      bytes = 0;
      streamHeaders.clear();
      encoderFailed = false;
      captureInterrupted = false;
      deliveryInterrupted = false;
      lastVideoClock = 0;
      recoveryBoundary = 0;
    }
    release();
    idleVideo();
  }
private:
  bool targetAvailable() {
    if (waitingForPresetSize) return false;
    if (!captureEnabled)
      return false;
    if (gameCapture && !gameReady)
      return false;
#ifdef _WIN32
    {
      std::lock_guard<std::mutex> sourceLock(captureSourceMutex);
      if (!capture || !obs_source_get_width(capture) || !obs_source_get_height(capture)) {
        captureImageReady = false;
        captureImageSince = 0;
        return false;
      }
    }
    if (!captureImageReady)
      return false;
    if (screenCapture) {
      std::lock_guard<std::mutex> lock(displayIdentityMutex);
      if (!selectedDisplayIdentity.empty()) {
        uint64_t now = os_gettime_ns();
        if (now - displayIdentityChecked < 200000000)
          return displayIdentityAvailable;
        struct Match {
          const std::string *wanted;
          bool found = false;
        } match{&selectedDisplayIdentity};
        EnumDisplayMonitors(
            nullptr, nullptr,
            [](HMONITOR monitor, HDC, LPRECT, LPARAM data) -> BOOL {
              auto *match = reinterpret_cast<Match *>(data);
              MONITORINFOEXA info{};
              info.cbSize = sizeof(info);
              if (GetMonitorInfoA(monitor, &info)) {
                DISPLAY_DEVICEA device{};
                device.cb = sizeof(device);
                std::string identity =
                    EnumDisplayDevicesA(info.szDevice, 0, &device,
                                        EDD_GET_DEVICE_INTERFACE_NAME)
                        ? device.DeviceID
                        : info.szDevice;
                if (identity == *match->wanted) {
                  match->found = true;
                  return FALSE;
                }
              }
              return TRUE;
            },
            reinterpret_cast<LPARAM>(&match));
        displayIdentityChecked = now;
        displayIdentityAvailable = match.found;
        if (!displayIdentityAvailable)
          return false;
      }
    }
    HWND window = reinterpret_cast<HWND>(targetWindow.load());
    if (window &&
        (!IsWindow(window) || IsIconic(window) || !IsWindowVisible(window)))
      return false;
    if (window) {
      DWORD pid = 0;
      GetWindowThreadProcessId(window, &pid);
      if (pid != targetProcess.load())
        return false;
    }
#endif
#ifdef __APPLE__
    return acroclip::macos::targetAvailable(targetWindow.load());
#endif
#ifdef __linux__
    if (acroclip::wayland::enabled() && screenCapture) {
      auto portal = std::atomic_load(&portalCapture);
      return portal && portal->health().working();
    }
    if (!screenCapture && !windowCompatibility && captureTextureFailure)
      return false;
    if (windowCompatibility && !x11CompatibilityAvailable(targetWindow.load()))
      return false;
    return x11Available(targetWindow.load(), targetProcess.load());
#endif
    return true;
  }
  void refreshCapture() {
#ifdef _WIN32
    refreshImageState();
#endif
    if (active && waitingForPresetSize && capture && obs_source_get_width(capture) >= 64 && obs_source_get_height(capture) >= 64) {
      const acroclip::RecordingSize pixels{int(obs_source_get_width(capture)), int(obs_source_get_height(capture))};
      const auto now = os_gettime_ns();
      if (pixels.width != initialSize.width || pixels.height != initialSize.height) {
        initialSize = pixels;
        initialSizeSince = now;
        return;
      }
      if (now - initialSizeSince < 500000000ULL) return;
#ifdef _WIN32
      if (!captureImageReady) return;
#endif
      try {
#ifdef __linux__
        if (acroclip::wayland::enabled() && screenCapture) {
          auto portal=std::atomic_load(&portalCapture);
          if (!portal || !portal->health().working()) return;
        }
#endif
        const auto size=recordingSize(sessionConfiguration,{int(obs_source_get_width(capture)),int(obs_source_get_height(capture))});
        active=false;
        if(output && obs_output_active(output))obs_output_force_stop(output);
        releaseEncoders();
        obs_wait_for_destroy_queue();
        width=size.width;height=size.height;
        configureVideoOutput();
        captureImageSince = 0;
        captureImageReady = false;
        vec2 bounds{float(width),float(height)},pos{width/2.f,height/2.f};
        obs_sceneitem_set_bounds(item,&bounds);obs_sceneitem_set_pos(item,&pos);
        waitingForPresetSize=false;
        startEncoding(sessionConfiguration,sessionCQ);
      } catch(const std::exception &error) {
        const std::string message=error.what();stop();emit({{"event","fatal"},{"message",message}});
      }
      return;
    }

#ifdef _WIN32
    if (!capture)
      return;
    refreshImageState();
    if (screenCapture) {
      if (!captureImageSince && os_gettime_ns() - gameStarted > 3000000000ULL &&
          !gameConfig.contains("screenCaptureMethod")) {
        json fallback = gameConfig;
        fallback["screenCaptureMethod"] = 2;
        source(fallback);
        emit({{"event", "capture-method"},
              {"method", "screen"},
              {"reason",
               "Trying another capture method for the selected screen"}});
      }
      return;
    }
    if (!gameCapture) {
      if (!gameConfig.contains("captureMethod") &&
          selectedWindowFullscreen(
              reinterpret_cast<HWND>(targetWindow.load()))) {
        json fullscreen = gameConfig;
        fullscreen["captureMethod"] = "game";
        source(fullscreen);
        emit({{"event", "capture-method"},
              {"method", "game"},
              {"reason",
               "Using game capture for the selected fullscreen application"}});
      }
      return;
    }
    calldata_t data{};
    calldata_init(&data);
    bool called = proc_handler_call(obs_source_get_proc_handler(capture),
                                    "get_hooked", &data);
    gameReady = called && calldata_bool(&data, "hooked");
    calldata_free(&data);
    if (!gameReady && os_gettime_ns() - gameStarted > 3000000000ULL) {
      json fallback = gameConfig;
      fallback["captureMethod"] = "window";
      source(fallback);
      emit({{"event", "capture-method"},
            {"method", "window"},
            {"reason", "Game capture could not hook this application. "
                       "Capturing the same application window"}});
    }
#endif
  }
#ifdef _WIN32
  bool sourceDrawsImage(obs_source_t *source, uint32_t sourceWidth, uint32_t sourceHeight) {
    if (!sourceWidth || !sourceHeight) return false;
    // A drawable black frame is valid. Clearing to a distinct transparent color
    // lets us detect drawing without mistaking a missing texture for black video.
    constexpr uint32_t side = 16;
    bool drawn = false;
    obs_enter_graphics();
    {
      std::unique_ptr<gs_texrender_t, decltype(&gs_texrender_destroy)> target(gs_texrender_create(GS_RGBA, GS_ZS_NONE), &gs_texrender_destroy);
      std::unique_ptr<gs_stagesurf_t, decltype(&gs_stagesurface_destroy)> surface(gs_stagesurface_create(side, side, GS_RGBA), &gs_stagesurface_destroy);
      if (target && surface) for (int pass = 0; pass < 2 && !drawn; ++pass) {
        gs_texrender_reset(target.get());
        if (!gs_texrender_begin(target.get(), side, side)) break;
        vec4 clear;
        vec4_set(&clear, pass == 0 ? 1.f : 0.f, pass == 0 ? 0.f : 1.f, 1.f, 0.f);
        gs_clear(GS_CLEAR_COLOR, &clear, 0, 0);
        gs_ortho(0, float(sourceWidth), 0, float(sourceHeight), -100, 100);
        gs_blend_state_push();
        gs_reset_blend_state();
        obs_source_video_render(source);
        gs_blend_state_pop();
        gs_texrender_end(target.get());
        gs_stage_texture(surface.get(), gs_texrender_get_texture(target.get()));
        uint8_t *pixels = nullptr;
        uint32_t stride = 0;
        if (gs_stagesurface_map(surface.get(), &pixels, &stride)) {
          for (uint32_t y = 0; y < side && !drawn; ++y)
            for (uint32_t x = 0; x < side; ++x) {
              const auto *pixel = pixels + y * stride + x * 4;
              if (pixel[0] != (pass == 0 ? 255 : 0) || pixel[1] != (pass == 0 ? 0 : 255) || pixel[2] != 255 || pixel[3] != 0) { drawn = true; break; }
            }
          gs_stagesurface_unmap(surface.get());
        }
      }
    }
    obs_leave_graphics();
    return drawn;
  }
  void refreshImageState() {
    const uint64_t now = os_gettime_ns();
    std::unique_ptr<obs_source_t, decltype(&obs_source_release)> source(nullptr, &obs_source_release);
    {
      std::lock_guard<std::mutex> sourceLock(captureSourceMutex);
      if (!capture || !obs_source_get_width(capture) || !obs_source_get_height(capture)) {
        captureImageSince = 0;
        captureImageReady = false;
        captureImageChecked = 0;
        return;
      }
      if (captureImageReady || now - captureImageChecked < 250000000ULL) return;
      source.reset(obs_source_get_ref(capture));
    }
    captureImageChecked = now;
    // Never hold captureSourceMutex while acquiring the graphics context.
    // Encoder callbacks may check availability from a graphics-owned thread.
    if (sourceDrawsImage(source.get(), obs_source_get_width(source.get()), obs_source_get_height(source.get()))) {
      captureImageSince = now;
      captureImageReady = true;
    }
  }
  static bool selectedWindowFullscreen(HWND window) {
    RECT rect{};
    MONITORINFO monitor{};
    monitor.cbSize = sizeof(monitor);
    return window && window != GetDesktopWindow() &&
           window != GetShellWindow() && !IsIconic(window) &&
           GetWindowRect(window, &rect) &&
           GetMonitorInfo(MonitorFromWindow(window, MONITOR_DEFAULTTONEAREST),
                          &monitor) &&
           rect.left <= monitor.rcMonitor.left &&
           rect.top <= monitor.rcMonitor.top &&
           rect.right >= monitor.rcMonitor.right &&
           rect.bottom >= monitor.rcMonitor.bottom;
  }
#endif
  obs_source_t *openMicrophone(const std::string &device, const std::string &name) {
    const char *type = microphoneType();
    if (device == "test-tone" && std::getenv("ACROCLIP_NATIVE_TEST_LIFECYCLE")) {
      auto *source = obs_source_create_private("acroclip_test_tone", name.c_str(), nullptr);
      if (!source) throw std::runtime_error("The controlled microphone source could not be created");
      return source;
    }
#ifdef __APPLE__
    acroclip::macos::requireMicrophonePermission();
#endif
    std::unique_ptr<obs_properties_t, decltype(&obs_properties_destroy)> properties(
        obs_get_source_properties(type), &obs_properties_destroy);
    auto *devices = properties ? obs_properties_get(properties.get(), "device_id") : nullptr;
    bool found = false;
    if (devices)
      for (size_t index = 0; index < obs_property_list_item_count(devices); ++index)
        if (device == obs_property_list_item_string(devices, index) &&
            !obs_property_list_item_disabled(devices, index)) found = true;
    if (!found) throw std::runtime_error("The microphone is unavailable. Choose an available input device");
#ifdef _WIN32
    if (sessionConfiguration.value("automaticMaster", false)) {
      acroclip::windows::ListenRouting routing;
      const auto endpoint = acroclip::windows::ListenRouting::identity(routing.device(device, eCapture).Get());
      for (const auto &extra : additionalAudio)
        if (extra.kind == "input" && extra.source && endpoint == acroclip::windows::ListenRouting::identity(routing.device(extra.deviceId, eCapture).Get()))
          throw std::runtime_error("This microphone is already included by another audio source");
    }
#endif
    std::unique_ptr<obs_data_t, decltype(&obs_data_release)> settings(obs_data_create(), &obs_data_release);
    obs_data_set_string(settings.get(), "device_id", device.c_str());
    auto *source = obs_source_create_private(type, name.c_str(), settings.get());
    if (!source) throw std::runtime_error("The microphone could not be opened");
#ifdef __APPLE__
    acroclip::macos::watchInput(source);
#endif
#ifdef _WIN32
    audioHealth.watch(source);
#endif
    return source;
  }
  static bool inputWarming(const std::string &error, uint64_t openedAt) {
    // Opening a microphone is asynchronous. Its expected startup silence must
    // not interrupt video or erase history, but persistent failure still does.
    return openedAt && os_gettime_ns() - openedAt < 3000000000ULL &&
           (error == "Audio capture is starting" || error == "Audio capture is reconnecting");
  }
  void closeMicrophone(obs_source_t *&source, obs_volmeter_t *meter, uint32_t channel, const std::string &id) {
    if (!source) return;
    obs_source_set_muted(source, true);
    obs_source_set_monitoring_type(source, OBS_MONITORING_TYPE_NONE);
    if (listeningSource == id) {
      listeningSource.clear();
      listeningFailure.clear();
      listeningDevice.clear();
      listeningRequestedDevice.clear();
    }
    if (meter) obs_volmeter_detach_source(meter);
    obs_set_output_source(channel, nullptr);
#ifdef __APPLE__
    acroclip::macos::forgetInput(source);
#endif
#ifdef _WIN32
    audioHealth.forget(source);
#endif
    obs_source_release(source);
    source = nullptr;
  }
public:
  void setAudio(const json &c) {
    std::string source = c.at("source");
    float volume = c.at("volume");
    bool muted = c.at("muted");
    if (!std::isfinite(volume) || volume < 0 || volume > 4)
      throw std::runtime_error(
          "Audio volume must be between 0 and 400 percent");
    std::unique_lock<std::mutex> audioLock(audioSourcesMutex);
    bool releasedInput = false;
    if (source == "capture") {
      captureVolume = volume;
      captureMuted = muted;
      obs_source_t *source =
#ifdef __APPLE__
          capture;
#elif defined(__linux__)
          screenCapture ? desktop : applicationAudioSource(applicationAudio);
#else
          screenCapture ? desktop : capture;
#endif
      if (source) {
        obs_source_set_volume(source, volume);
        obs_source_set_muted(source, muted || !captureAudioEnabled);
      }
    } else if (source == "microphone") {
      microphoneVolume = volume;
      microphoneMuted = muted;
      if (muted && mic) {
        closeMicrophone(mic, microphoneMeter, 2, "microphone");
        microphoneLevel = 0;
        microphonePendingPeak = 0;
        releasedInput = true;
      } else if (!muted && !mic && sessionConfiguration.value("microphone", false)) {
        mic = openMicrophone(sessionConfiguration.value("microphoneDevice", std::string("default")), "Microphone");
        microphoneOpenedAt = os_gettime_ns();
        obs_source_set_volume(mic, volume);
        obs_source_set_audio_mixers(mic, 5);
        obs_volmeter_attach_source(microphoneMeter, mic);
        obs_set_output_source(2, mic);
      }
      if (mic) {
        obs_source_set_volume(mic, volume);
        obs_source_set_muted(mic, muted);
      }
    } else {
      auto found = std::find_if(
          additionalAudio.begin(), additionalAudio.end(),
          [&](const AdditionalAudio &value) { return value.id == source; });
      if (found == additionalAudio.end())
        throw std::runtime_error("Unknown audio source");
      if (found->managedInput) {
        if (muted) {
          releasedInput = found->source != nullptr;
          closeMicrophone(found->source, found->metering ? found->metering->meter : nullptr, found->outputChannel, found->id);
          if (found->metering) found->metering->pendingPeak = 0;
          emit({{"event", "audio-levels"}, {"capture", captureLevel.load()}, {"microphone", microphoneLevel.load()}, {"additional", {{found->id, 0.f}}}});
        } else if (!found->source) {
          found->source = openMicrophone(found->deviceId, found->name);
          found->openedAt = os_gettime_ns();
          obs_source_set_volume(found->source, volume);
          obs_source_set_audio_mixers(found->source, found->mixerMask);
          if (found->metering) obs_volmeter_attach_source(found->metering->meter, found->source);
          obs_set_output_source(found->outputChannel, found->source);
        }
      }
      if (found->source) {
        obs_source_set_volume(found->source, volume);
        obs_source_set_muted(found->source, muted);
      }
    }
    audioLock.unlock();
    // Device destruction can join an audio thread. Do not hold the source lock
    // while waiting, and acknowledge mute only once OBS has released the input.
    if (releasedInput) obs_wait_for_destroy_queue();
  }
private:
  std::string deviceAudioError(obs_source_t *source, uint64_t openedAt = 0) {
    if (!source || obs_source_muted(source)) return {};
    std::string error;
#ifdef __linux__
    error = linuxDeviceAudioError(source);
#elif defined(_WIN32)
    error = audioHealth.error(source);
#elif defined(__APPLE__)
    error = acroclip::macos::audioError(source, 0, 0);
#endif
    return inputWarming(error, openedAt) ? std::string{} : error;
  }
  std::string additionalSourceError(const AdditionalAudio &extra) {
    auto physical = deviceAudioError(extra.source, extra.openedAt);
    if (!physical.empty()) return extra.name + ": " + physical;
#ifdef _WIN32
    if (extra.window) {
      DWORD pid = 0;
      GetWindowThreadProcessId(reinterpret_cast<HWND>(extra.window), &pid);
      if (!IsWindow(reinterpret_cast<HWND>(extra.window)) || pid != extra.pid)
        return "Audio source " + extra.name + " is unavailable";
      calldata_t state{};
      calldata_init(&state);
      bool queried = proc_handler_call(obs_source_get_proc_handler(extra.source), "get_hooked", &state);
      bool ready = queried && calldata_bool(&state, "hooked");
      calldata_free(&state);
      if (!ready) return "Waiting for audio source " + extra.name;
    }
#elif defined(__linux__)
    if (extra.application) {
      auto error = applicationAudioError(extra.application);
      if (!error.empty()) return extra.name + ": " + error;
      if (!x11Available(extra.window, extra.pid, false)) return "Audio source " + extra.name + " is unavailable";
    }
#elif defined(__APPLE__)
    auto error = acroclip::macos::audioError(extra.source, extra.window, extra.pid);
    if (!error.empty() && !inputWarming(error, extra.openedAt)) return extra.name + ": " + error;
#endif
    return {};
  }
  std::string additionalAudioError() {
    std::lock_guard<std::mutex> audioLock(audioSourcesMutex);
    std::string warning;
    auto route = [&](obs_source_t *source, const std::string &error, uint32_t mask, const std::string &name) {
      if (source) obs_source_set_audio_mixers(source, error.empty() ? mask : 0);
      if (warning.empty() && !error.empty()) warning = name.empty() ? error : name + ": " + error;
    };
    route(mic, deviceAudioError(mic, microphoneOpenedAt), 5, "Microphone");
    if (desktop && screenCapture && captureAudioEnabled)
      route(desktop, deviceAudioError(desktop), 3, "Capture audio");
    for (auto &extra : additionalAudio) {
      if (!extra.source) continue;
      // Retain a silent encoded track while its source is unavailable. Recovery
      // restores routing, without pausing video or changing the user's mute.
      route(extra.source, obs_source_muted(extra.source) ? std::string{} : additionalSourceError(extra), extra.mixerMask, "");
    }
    return warning;
  }
  std::string captureAudioError() {
#ifdef __linux__
    std::lock_guard<std::mutex> audioLock(audioSourcesMutex);
    return applicationAudioError(applicationAudio);
#else
    return {};
#endif
  }
  void setupAdditionalAudio(const json &config) {
    auto sources = config.value("audioSources", json::array());
    const bool automatic=config.value("automaticMaster",false);
    if (!sources.is_array() || sources.size() > (monitoring ? 5u : automatic ? (config.value("sourceAudioPresent",false)?4u:5u) : 3u))
      throw std::runtime_error("The recorder supports up to five audio sources");
    std::set<std::string> identities;
    std::set<uint32_t> processIdentities;
    if(automatic && !screenCapture && captureAudioEnabled && targetProcess)processIdentities.insert(targetProcess);
#ifdef _WIN32
    std::set<std::wstring> endpointIdentities;
    if(automatic && screenCapture && captureAudioEnabled){acroclip::windows::ListenRouting routing;endpointIdentities.insert(L"output:"+acroclip::windows::ListenRouting::identity(routing.device("default").Get()));}
#endif
    audioNames = {"Master"};
    if(!automatic || config.value("sourceAudioPresent",false))audioNames.emplace_back(config.value("sourceKind",std::string("screen")) == "screen" ? "Desktop" : "Application");
    if (config.value("microphone", false))
      audioNames.emplace_back("Microphone");
    for (const auto &settings : sources) {
      AdditionalAudio extra;
      auto discard = [this](AdditionalAudio *value) {
#ifdef __linux__
        if (value->application) {
          destroyApplicationAudio(value->application);
          return;
        }
#endif
        if (value->source) {
#ifdef __APPLE__
          acroclip::macos::forgetInput(value->source);
#endif
#ifdef _WIN32
          audioHealth.forget(value->source);
#endif
          obs_source_release(value->source);
        }
      };
      std::unique_ptr<AdditionalAudio, decltype(discard)> extraOwner(&extra, discard);
      extra.id = settings.at("id").get<std::string>();
      extra.name = settings.at("name").get<std::string>();
      if (extra.id.empty() || extra.id == "capture" ||
          extra.id == "microphone" || !identities.insert(extra.id).second ||
          extra.name.empty() || extra.name.size() > 400)
        throw std::runtime_error(
            "The additional audio source identity is invalid");
      extra.kind=settings.at("kind").get<std::string>();
      uint32_t mixer = uint32_t(audioNames.size());
      if(!monitoring && mixer>=6)throw std::runtime_error("The recorder audio track limit was reached");
      extra.isolatedMask=1u<<mixer;
      audioNames.push_back(extra.name);
      uint32_t mask = monitoring
                          ? 0u
                          : (((automatic ? (!screenCapture || extra.kind=="input") : settings.value("includeInMaster", true)) ? 1u : 0u) |
                             extra.isolatedMask);
      extra.mixerMask = mask;
      extra.outputChannel = uint32_t(additionalAudio.size() + 3);
      extra.deviceId = settings.value("deviceId", "default");
      extra.managedInput = extra.kind == "input" && settings.value("enabled", true);
      if (!settings.value("enabled", true)) {
        additionalAudio.push_back(std::move(extra));
        extraOwner.release();
        continue;
      }
      std::string kind = settings.at("kind");
      extra.kind = kind;
      extra.deviceId = settings.value("deviceId", "default");
      std::unique_ptr<obs_data_t, decltype(&obs_data_release)> data(
          obs_data_create(), &obs_data_release);
      const char *type = nullptr;
      if (kind == "application") {
        std::string identity = settings.value("sourceId", "");
        if (identity.rfind("window:", 0) != 0) {
          data.reset();
          throw std::runtime_error(
              "Choose an available application audio source");
        }
        extra.window = std::stoull(identity.substr(7));
        extra.pid = settings.at("pid");
        if(automatic && !processIdentities.insert(extra.pid).second)throw std::runtime_error("This application is already included by another audio source");
#ifdef _WIN32
        auto window = reinterpret_cast<HWND>(extra.window);
        DWORD actual = 0;
        GetWindowThreadProcessId(window, &actual);
        if (!IsWindow(window) || actual != extra.pid) {
          data.reset();
          throw std::runtime_error("The application audio target changed");
        }
        dstr title{}, klass{}, exe{};
        ms_get_window_title(&title, window);
        ms_get_window_class(&klass, window);
        bool identified =
            ms_get_window_exe(&exe, window) &&
            ms_find_window(INCLUDE_MINIMIZED, WINDOW_PRIORITY_TITLE,
                           klass.array, title.array, exe.array) == window;
        for (auto *part : {&title, &klass, &exe}) {
          dstr_replace(part, "#", "#22");
          dstr_replace(part, ":", "#3A");
        }
        std::string match = std::string(title.array ? title.array : "") + ":" +
                            (klass.array ? klass.array : "") + ":" +
                            (exe.array ? exe.array : "");
        dstr_free(&title);
        dstr_free(&klass);
        dstr_free(&exe);
        if (!identified) {
          data.reset();
          throw std::runtime_error(
              "The application audio target cannot be distinguished safely");
        }
        obs_data_set_string(data.get(), "window", match.c_str());
        obs_data_set_int(data.get(), "priority", 0);
        type = "wasapi_process_output_capture";
#elif defined(__linux__)
        data.reset();
        if (!x11Available(extra.window, extra.pid, false))
          throw std::runtime_error("The application audio target changed");
        extra.application = createApplicationAudio(extra.pid, mask);
        extra.source = applicationAudioSource(extra.application);
#elif defined(__APPLE__)
        data.reset();
        extra.source = acroclip::macos::createApplicationAudio(
            extra.window, extra.pid, extra.name);
#else
        data.reset();
        throw std::runtime_error("Additional application audio is not "
                                 "available on this platform yet");
#endif
      } else if (kind == "input") {
        // Reserve the track without opening a microphone while muted.
        if (!settings.value("muted", false)) {
          extra.source = openMicrophone(extra.deviceId, extra.name);
          extra.openedAt = os_gettime_ns();
        }
      } else if (kind == "output") {
#ifdef _WIN32
        if(automatic){acroclip::windows::ListenRouting routing;const auto key=L"output:"+acroclip::windows::ListenRouting::identity(routing.device(extra.deviceId).Get());if(!endpointIdentities.insert(key).second)throw std::runtime_error("This audio device is already included by another source");}
#endif
#ifdef __APPLE__
        data.reset();
        if (extra.deviceId != "system")
          throw std::runtime_error("Choose System audio. Individual output-device capture is unavailable on macOS");
        extra.source = acroclip::macos::createSystemAudio(extra.name);
#else
        type = desktopType();
        auto *properties = obs_get_source_properties(type);
        auto *devices = properties ? obs_properties_get(properties, "device_id") : nullptr;
        bool found = false;
        if (devices)
          for (size_t index = 0; index < obs_property_list_item_count(devices); ++index)
            if (extra.deviceId == obs_property_list_item_string(devices, index) &&
                !obs_property_list_item_disabled(devices, index)) found = true;
        obs_properties_destroy(properties);
        if (!found) throw std::runtime_error("The additional audio device is unavailable");
        obs_data_set_string(data.get(), "device_id", extra.deviceId.c_str());
#endif
      } else {
        data.reset();
        throw std::runtime_error("The additional audio source kind is invalid");
      }
      if (type) {
        bool registered = false;
        const char *candidate = nullptr;
        for (size_t index = 0; obs_enum_input_types(index, &candidate); index++)
          if (std::string(candidate) == type)
            registered = true;
        if (!registered) {
          data.reset();
          throw std::runtime_error(
              "This additional audio source is unavailable on this platform");
        }
        extra.source =
            obs_source_create_private(type, extra.name.c_str(), data.get());
        data.reset();
        if (!extra.source)
          throw std::runtime_error(
              "The additional audio source could not be opened");
        obs_source_set_audio_mixers(extra.source, mask);
      }
      if (extra.source) obs_source_set_audio_mixers(extra.source, mask);
#ifdef __APPLE__
      if (extra.source) {
        acroclip::macos::watchInput(extra.source);
      }
#endif
#ifdef _WIN32
      audioHealth.watch(extra.source);
#endif
      additionalAudio.push_back(std::move(extra));
      extraOwner.release();
#ifdef __linux__
      if (additionalAudio.back().application) {
        std::string identity = additionalAudio.back().id;
        setApplicationAudioLevelCallback(
            additionalAudio.back().application, [this, identity](float value) {
              if (active || monitoring)
                emit({{"event", "audio-levels"},
                      {"capture", captureLevel.load()},
                      {"microphone", microphoneLevel.load()},
                      {"additional", {{identity, value}}}});
            });
      }
#endif
      auto metering = std::make_shared<ExtraMeter>();
      metering->owner = this;
      metering->id = additionalAudio.back().id;
      metering->meter = obs_volmeter_create(OBS_FADER_LOG);
      obs_volmeter_add_callback(
          metering->meter,
          [](void *data, const float *, const float *peak, const float *) {
            auto *meter = static_cast<ExtraMeter *>(data);
            float value = 0;
            for (size_t channel = 0; channel < 2; channel++)
              if (std::isfinite(peak[channel]))
                value = std::max(
                    value, std::clamp((peak[channel] + 60.f) / 60.f, 0.f, 1.f));
            accumulatePeak(meter->pendingPeak, value);
            uint64_t now = os_gettime_ns(), last = meter->lastEvent.load();
            if ((meter->owner->active || meter->owner->monitoring) && now - last >= 33000000 &&
                meter->lastEvent.compare_exchange_strong(last, now))
              emit({{"event", "audio-levels"},
                    {"capture", meter->owner->captureLevel.load()},
                    {"microphone", meter->owner->microphoneLevel.load()},
                    {"additional", {{meter->id, meter->pendingPeak.exchange(0)}}}});
          },
          metering.get());
      if (additionalAudio.back().source)
        obs_volmeter_attach_source(metering->meter, additionalAudio.back().source);
      additionalAudio.back().metering = std::move(metering);
      obs_set_output_source(uint32_t(additionalAudio.size() + 2),
                            additionalAudio.back().source);
      setAudio({{"source", additionalAudio.back().id},
                {"volume", settings.value("volume", 1.f)},
                {"muted", settings.value("muted", false)}});
    }
  }
public:
  void testListenerSource(bool desktop = false) {
    if (!active) { release(); monitoring=true; }
    AdditionalAudio extra;extra.id="test-listener";extra.name="Controlled listen tone";extra.kind="input";
    extra.source=obs_source_create_private("acroclip_test_tone",extra.name.c_str(),nullptr);
    if(!extra.source)throw std::runtime_error("Test tone source failed");
    extra.mixerMask = active ? 1u : 0u;
    obs_source_set_audio_mixers(extra.source,extra.mixerMask);obs_set_output_source(3,extra.source);additionalAudio.push_back(std::move(extra));
    setAudio({{"source","test-listener"},{"volume",1.f},{"muted",true}});
    if(desktop)setupAdditionalAudio({{"audioSources",json::array({{{"id","test-desktop"},{"name","Idle desktop meter"},{"kind","output"},{"deviceId","default"},{"enabled",true},{"includeInMaster",false},{"volume",1.f},{"muted",false}}})}});
  }
  void testListenerTone() {
    auto found=std::find_if(additionalAudio.begin(),additionalAudio.end(),[](const auto &extra){return extra.id=="test-listener";});
    if(found==additionalAudio.end())throw std::runtime_error("Create the isolated tone first");
    std::vector<float> samples(480);
    for(size_t block=0;block<50;block++) {
      for(size_t index=0;index<samples.size();index++)samples[index]=.03f*std::sin(2*3.141592653589793*1733.*double(block*480+index)/48000.);
      obs_source_audio data{};data.data[0]=reinterpret_cast<uint8_t*>(samples.data());data.data[1]=data.data[0];data.frames=480;data.speakers=SPEAKERS_STEREO;data.format=AUDIO_FORMAT_FLOAT_PLANAR;data.samples_per_sec=48000;data.timestamp=os_gettime_ns();obs_source_output_audio(found->source,&data);os_sleep_ms(10);
    }
  }
  struct ListenTarget {
    obs_source_t *source = nullptr;
    std::string kind, deviceId;
    uint32_t pid = 0;
  };
  ListenTarget listenTarget(const std::string &id) {
    if (active && id == "capture" && captureAudioEnabled)
      return {screenCapture ? desktop : capture, screenCapture ? "output" : "application", "default", targetProcess.load()};
    if (active && id == "microphone") return {mic, "input", "default", 0};
    for (const auto &extra : additionalAudio)
      if (extra.id == id) return {extra.source, extra.kind, extra.deviceId, extra.pid};
    return {};
  }
  void listenAudio(const json &config) {
    const std::string id=config.value("source","");
    if (!id.empty() && !active && !monitoring)throw std::runtime_error("Open Recording and enable the audio source to listen");
    std::lock_guard<std::mutex> lock(audioSourcesMutex);
    if (capture)obs_source_set_monitoring_type(capture,OBS_MONITORING_TYPE_NONE);
    if (desktop)obs_source_set_monitoring_type(desktop,OBS_MONITORING_TYPE_NONE);
    if (mic)obs_source_set_monitoring_type(mic,OBS_MONITORING_TYPE_NONE);
    for(auto &extra:additionalAudio)if(extra.source)obs_source_set_monitoring_type(extra.source,OBS_MONITORING_TYPE_NONE);
    listeningSource.clear();
    listeningFailure.clear();
    if(id.empty())return;
#ifndef _WIN32
    throw std::runtime_error("Source listening is currently available on Windows only");
#else
    if(!obs_audio_monitoring_available())throw std::runtime_error("Audio listening is unavailable in this session");
    const auto found=listenTarget(id);
    if(!found.source)throw std::runtime_error(found.kind == "input" ? "Unmute the microphone before listening" : "Enable the audio source before listening");
    const std::string requested=config.value("deviceId","default");
    acroclip::windows::ListenRouting routing;
    const std::string output=utf8(acroclip::windows::ListenRouting::identity(routing.device(requested).Get()));
    if(found.kind=="output" && (found.deviceId=="default" || routing.same(found.deviceId,output)))throw std::runtime_error("Cannot listen to this output through itself because that would create audio feedback");
    // A monitored signal must never re-enter any configured loopback capture,
    // including muted sources which the user can unmute during recording.
    if(active && screenCapture && captureAudioEnabled && (requested=="default" || routing.same("default",output)))
      throw std::runtime_error("Cannot listen while the system output is being recorded because that would change the recorded mix");
    for(const auto &extra:additionalAudio)
      if(active && extra.source && extra.kind=="output" && (extra.deviceId=="default" || routing.same(extra.deviceId,output)))
        throw std::runtime_error("Cannot listen while the system output is being captured because that would create audio feedback");
    if(!obs_set_audio_monitoring_device("Listening output",output.c_str()))throw std::runtime_error("The listening output could not be opened");
    // AND_OUTPUT keeps the existing mixer masks, recording gain and record mute.
    obs_source_set_monitoring_type(found.source,active ? OBS_MONITORING_TYPE_MONITOR_AND_OUTPUT : OBS_MONITORING_TYPE_MONITOR_ONLY);
    if(!routing.audible(GetCurrentProcessId(),output,false)){obs_source_set_monitoring_type(found.source,OBS_MONITORING_TYPE_NONE);throw std::runtime_error("The listening output did not start");}
    listeningSource=id;
    listeningDevice=output;
    listeningRequestedDevice=requested;
#endif
  }
  void monitorAudio(const json &config) {
    // A stale UI teardown must never release an active recording.
    if (active)
      return;
    release();
    if (!config.value("enabled", false))
      return;
    monitoring = true;
    try {
      setupAdditionalAudio(config);
    } catch (...) {
      release();
      throw;
    }
  }
  void packets(encoder_packet *p) {
    if (!p) {
      active = false;
      encoderFailed = true;
      {
        std::lock_guard<std::mutex> lock(mutex);
        // Accepted requests retain their valid history and copied codec headers.
        for (auto &r : requests)
          snapshot(r);
        requests.clear();
      }
      emit({{"event", "fatal"},
            {"message", "The recording encoder stopped producing footage"}});
      return;
    }
    if (!active)
      return;
    // Keep failed audio out of subsequent mixes between status polls. Audio
    // health never controls whether video packets enter the replay history.
    if (p->type == OBS_ENCODER_AUDIO) additionalAudioError();
    if (!targetAvailable()) {
      std::lock_guard<std::mutex> lock(mutex);
      if (!active)
        return;
      captureInterrupted = true;
      for (auto &r : requests)
        snapshot(r);
      requests.clear();
      return;
    }
#ifdef _WIN32
    if (p->sys_dts_usec < int64_t(captureImageSince / 1000))
      return;
#endif
    std::lock_guard<std::mutex> lock(mutex);
    if (!active)
      return;
    checkDeliveryGap();
    if (streamHeaders.empty())
      readStreamHeaders();
    if (p->type == OBS_ENCODER_VIDEO) {
      lastVideoClock = deliveryClock();
    }
    if (captureInterrupted) {
      // Keep earlier footage available until recovery produces a decodable
      // keyframe. Never join the absent interval into a seemingly continuous
      // clip.
      if (p->type != OBS_ENCODER_VIDEO || !p->keyframe ||
          p->sys_dts_usec < recoveryBoundary)
        return;
      ring.clear();
      bytes = 0;
      captureInterrupted = false;
      deliveryInterrupted = false;
      recoveryBoundary = 0;
      bufferedSourceName.clear();
      bufferedSourceId.clear();
    }
    if (p->type == OBS_ENCODER_VIDEO && bufferedSourceName.empty()) {
      bufferedSourceName = sourceName;
      bufferedSourceId = selectedSourceId;
      bufferedScreen = screenCapture;
    }
    ring.emplace_back(*p);
    bytes += p->size;
    // Purge only at keyframes, keeping the retained GOP independently
    // decodable.
    int64_t cutoff = p->sys_dts_usec - int64_t(seconds) * 1000000;
    size_t boundary = 0;
    for (size_t i = 0; i < ring.size(); i++)
      if (ring[i].p.type == OBS_ENCODER_VIDEO && ring[i].p.keyframe &&
          ring[i].p.sys_dts_usec <= cutoff)
        boundary = i;
    while (boundary--) {
      bytes -= ring.front().p.size;
      ring.pop_front();
    }
    while (bytes > 512ULL * 1024 * 1024 && ring.size() > 1) {
      size_t next = 1;
      while (next < ring.size() &&
             !(ring[next].p.type == OBS_ENCODER_VIDEO && ring[next].p.keyframe))
        next++;
      if (next == ring.size())
        break;
      while (next--) {
        bytes -= ring.front().p.size;
        ring.pop_front();
      }
    }
    while (!requests.empty() && p->type == OBS_ENCODER_VIDEO &&
           p->sys_dts_usec >= requests.front().end) {
      snapshot(requests.front());
      requests.pop_front();
    }
  }
  // These monotonic clocks include computer sleep. Wall-clock corrections
  // must not discard healthy footage, while suspend still breaks continuity.
private:
  static uint64_t deliveryClock() {
#ifdef _WIN32
    return GetTickCount64() * uint64_t(1000000);
#elif defined(__APPLE__)
    static const mach_timebase_info_data_t scale = [] {
      mach_timebase_info_data_t result{};
      if (mach_timebase_info(&result) != KERN_SUCCESS || !result.denom)
        throw std::runtime_error("The capture elapsed clock is unavailable");
      return result;
    }();
    return uint64_t(static_cast<long double>(mach_continuous_time()) *
                    scale.numer / scale.denom);
#elif defined(__linux__)
    timespec value{};
    if (clock_gettime(CLOCK_BOOTTIME, &value) != 0)
      throw std::runtime_error("The capture elapsed clock is unavailable");
    return uint64_t(value.tv_sec) * uint64_t(1000000000) +
           uint64_t(value.tv_nsec);
#endif
  }
  static bool deliveryGap(uint64_t last, uint64_t now, uint64_t threshold) {
    return last && now >= last && now - last > threshold;
  }
  // Caller holds mutex. A frozen process or suspended computer can retain a
  // valid texture while its encoded timestamps jump. Preserve accepted saves
  // before waiting for a fresh keyframe instead of joining that gap.
  void checkDeliveryGap() {
    if (!active || !lastVideoClock || captureInterrupted)
      return;
    uint64_t threshold =
        std::max(uint64_t(2000000000), uint64_t(3000000000) / uint64_t(fps));
    if (!deliveryGap(lastVideoClock, deliveryClock(), threshold))
      return;
    captureInterrupted = true;
    deliveryInterrupted = true;
    recoveryBoundary = int64_t(os_gettime_ns() / 1000);
    for (auto &request : requests)
      snapshot(request);
    requests.clear();
  }
  void readStreamHeaders() {
    std::vector<std::vector<uint8_t>> headers;
    std::vector<obs_encoder_t *> encoders{video};
    encoders.insert(encoders.end(), audio.begin(), audio.end());
    for (auto *encoder : encoders) {
      uint8_t *data = nullptr;
      size_t size = 0;
      if (!obs_encoder_get_extra_data(encoder, &data, &size) || !data || !size)
        return;
      headers.emplace_back(data, data + size);
    }
    streamHeaders = std::move(headers);
  }
  void snapshot(const Request &r) {
    int64_t end = r.end;
    for (auto i = ring.rbegin(); i != ring.rend(); ++i)
      if (i->p.type == OBS_ENCODER_VIDEO) {
        end = std::min(end, i->p.sys_dts_usec);
        break;
      }
    int64_t begin = end - int64_t(seconds) * 1000000;
    size_t start = ring.size();
    // Stream-copy boundaries must start on a keyframe. Keep at most one
    // preceding GOP.
    for (size_t i = 0; i < ring.size(); i++)
      if (ring[i].p.type == OBS_ENCODER_VIDEO && ring[i].p.keyframe &&
          ring[i].p.sys_dts_usec <= begin)
        start = i;
    if (start == ring.size())
      for (size_t i = 0; i < ring.size(); i++)
        if (ring[i].p.type == OBS_ENCODER_VIDEO && ring[i].p.keyframe) {
          start = i;
          break;
        }
    Job j;
    j.request = r;
    j.request.source = bufferedSourceName;
    j.request.sourceId = bufferedSourceId;
    j.end = end;
    j.reduceOverlap = avoidOverlap;
    j.width = width;
    j.height = height;
    j.fps = fps;
    j.secondsSinceCapture = std::max(0., double(r.end - end) / 1000000.);
    for (size_t i = start; i < ring.size(); i++)
      if (ring[i].p.sys_dts_usec <= end)
        j.packets.emplace_back(ring[i]);
    if (j.packets.empty()) {
      clipWriter->reject(r, "No recorded footage is available yet");
      return;
    }
    if (streamHeaders.empty()) {
      clipWriter->reject(r, "The encoder did not provide the clip's playback headers");
      return;
    }
    j.headers = streamHeaders;
    j.audioNames = audioNames;
    if ((!sessionConfiguration.value("automaticMaster", false) || sessionConfiguration.value("sourceAudioPresent", false)) && j.audioNames.size() > 1)
      j.audioNames[1] = bufferedScreen ? "Desktop" : "Application";
    clipWriter->submit(std::move(j));
  }
public:
  void save(const json &c) {
    std::lock_guard<std::mutex> lock(mutex);
    if (!active)
      throw std::runtime_error("Start recording before saving a clip");
    checkDeliveryGap();
    if (clipWriter->pending() >= 3)
      throw std::runtime_error(
          "Three clips are already saving. Wait for a save to finish");
    if (bytes * size_t(clipWriter->pending() + 2) > 768ULL * 1024 * 1024)
      throw std::runtime_error("The clip save queue has reached its memory "
                               "limit. Wait for a save to finish");
    auto wallMs = std::chrono::duration_cast<std::chrono::milliseconds>(
                      std::chrono::system_clock::now().time_since_epoch())
                      .count();
    int64_t age =
        c.contains("requestedAt")
            ? std::max(int64_t(0),
                       int64_t(wallMs) - c.at("requestedAt").get<int64_t>())
            : c.value("requestAgeMs", int64_t(0));
    Request r{c.at("requestId"), c.at("path"), sourceName,
              int64_t(os_gettime_ns() / 1000) - age * 1000};
    clipWriter->accept();
    requests.push_back(r);
    emit({{"event", "saving"}, {"requestId", r.id}});
    if (!targetAvailable() || captureInterrupted) {
      snapshot(requests.back());
      requests.pop_back();
    }
  }
  acroclip::RecordingSize requestedPresetSize(const json &c) {
    const std::string quality = c.value("quality", "standard");
    int w = quality == "low" ? 1280 : quality == "high" ? 2560 : 1920;
    int h = quality == "low" ? 720 : quality == "high" ? 1440 : 1080;
    if (c.value("recordingPresetVersion", 0) == 1) {
      w = c.value("customWidth", w);
      h = c.value("customHeight", h);
    }
    return {w, h};
  }
  acroclip::RecordingSize recordingSize(const json &c, acroclip::RecordingSize pixels) {
    if(c.value("recordingSizeVersion",0)==2) {
      std::string kind=c.value("sourceKind","screen");if(kind=="auto")kind=c.value("resolvedKind","waiting");
      return acroclip::fitResolutionLimit(pixels,c.value("resolutionLimit",1080),kind=="app");
    }
    return acroclip::fitRecordingSize(requestedPresetSize(c),pixels);
  }
  void source(const json &c) {
    // The first usable source establishes the encoded canvas. Later sources and
    // window resizes fit that canvas without restarting encoders or cancelling saves.
    for(auto &[key,value]:c.items())if(key!="audioSources")sessionConfiguration[key]=value;
    if (waitingForPresetSize) {
      initialSize = {0, 0};
      initialSizeSince = 0;
    }
    if (!listeningSource.empty()) {
      listenAudio({{"source", ""}});
      listeningFailure = "Listening stopped because the capture source changed";
    }
    std::string kind = c.value("sourceKind", "screen");
    if (kind == "auto")
      kind = c.value("resolvedKind", "waiting");
#ifdef __linux__
    if (acroclip::wayland::enabled()) {
      if (kind == "screen" && c.value("sourceId", "") != "portal:screen")
        throw std::runtime_error(
            "Wayland screen recording requires the system screen picker");
      if (kind != "screen" && (!candidateConnection ||
                               xcb_connection_has_error(candidateConnection)))
        throw std::runtime_error(
            "XWayland application capture is unavailable in this session");
    }
#endif
    if (kind == "waiting") {
      captureEnabled = false;
      gameCapture = false;
      gameReady = false;
      targetWindow = 0;
      targetProcess = 0;
      obs_volmeter_detach_source(captureMeter);
      captureLevel = 0;
      if (item)
        obs_sceneitem_remove(item);
      item = nullptr;
      {
        std::lock_guard<std::mutex> sourceLock(captureSourceMutex);
        if (capture)
          obs_source_release(capture);
        capture = nullptr;
      }
      {
        std::lock_guard<std::mutex> audioLock(audioSourcesMutex);
#ifdef __linux__
        obs_set_output_source(1, nullptr);
        destroyApplicationAudio(applicationAudio);
        applicationAudio = nullptr;
#endif
        if (desktop)
          obs_source_set_muted(desktop, true);
#ifdef _WIN32
        if(desktop){obs_set_output_source(1,nullptr);audioHealth.forget(desktop);obs_source_release(desktop);desktop=nullptr;}
#endif
#ifdef __linux__
        if (desktop)
          obs_source_release(desktop);
        desktop = nullptr;
#endif
      }
      screenCapture = false;
      std::lock_guard<std::mutex> lock(mutex);
      sourceName = c.value("sourceName", "Waiting for game");
      selectedSourceId.clear();
      return;
    }
    std::unique_ptr<obs_data_t, decltype(&obs_data_release)> sourceSettings(
        obs_data_create(), &obs_data_release);
    auto *s = sourceSettings.get();
    obs_source_t *next = nullptr;
    bool compatibility = false;
    std::string nextDisplayIdentity;
#ifdef __linux__
    std::shared_ptr<acroclip::wayland::Capture> nextPortal;
#endif
#ifdef _WIN32
    if (kind == "screen") {
      auto *props = obs_get_source_properties("monitor_capture");
      auto *p = obs_properties_get(props, "monitor_id");
      int index = c.value("screenIndex", 0);
      std::string monitor;
      if (c.contains("bounds") && c["bounds"].is_object()) {
        struct Match {
          RECT wanted;
          std::string identity;
        } match;
        auto b = c["bounds"];
        match.wanted = {b.at("x"), b.at("y"),
                        b.at("x").get<long>() + b.at("width").get<long>(),
                        b.at("y").get<long>() + b.at("height").get<long>()};
        EnumDisplayMonitors(
            nullptr, nullptr,
            [](HMONITOR h, HDC, LPRECT, LPARAM data) -> BOOL {
              auto *m = reinterpret_cast<Match *>(data);
              MONITORINFOEXA info{};
              info.cbSize = sizeof(info);
              if (GetMonitorInfoA(h, &info) &&
                  EqualRect(&m->wanted, &info.rcMonitor)) {
                DISPLAY_DEVICEA device{};
                device.cb = sizeof(device);
                if (EnumDisplayDevicesA(info.szDevice, 0, &device,
                                        EDD_GET_DEVICE_INTERFACE_NAME))
                  m->identity = device.DeviceID;
                else
                  m->identity = info.szDevice;
                return FALSE;
              }
              return TRUE;
            },
            reinterpret_cast<LPARAM>(&match));
        monitor = match.identity;
        if (monitor.empty()) {
          obs_properties_destroy(props);
          throw std::runtime_error("The selected screen changed or was "
                                   "disconnected. Select it again");
        }
      }
      for (size_t i = 0; monitor.empty() && i < obs_property_list_item_count(p);
           i++)
        if (!obs_property_list_item_disabled(p, i)) {
          if (index-- == 0) {
            monitor = obs_property_list_item_string(p, i);
            break;
          }
        }
      obs_properties_destroy(props);
      if (monitor.empty())
        throw std::runtime_error("The selected screen is unavailable");
      obs_data_set_string(s, "monitor_id", monitor.c_str());
      obs_data_set_int(s, "method", c.value("screenCaptureMethod", 0));
      nextDisplayIdentity = monitor;
      obs_data_set_bool(s, "capture_cursor", true);
      obs_data_set_bool(s, "force_sdr", true);
      next = createCaptureSource("monitor_capture", s);
    } else if (kind == "app") {
      std::string window = c.value("window", "");
      std::string sourceId = c.value("sourceId", "");
      if (sourceId.rfind("window:", 0) == 0) {
        HWND hwnd = reinterpret_cast<HWND>(std::stoull(sourceId.substr(7)));
        if (!acroclip::windows::userCaptureWindow(hwnd) || IsIconic(hwnd))
          throw std::runtime_error("The selected application is unavailable");
        DWORD pid = 0;
        GetWindowThreadProcessId(hwnd, &pid);
        if (c.contains("pid") && c.at("pid").get<uint32_t>() != pid)
          throw std::runtime_error(
              "The selected application changed. Select it again");
        dstr title{}, klass{}, exe{};
        ms_get_window_title(&title, hwnd);
        ms_get_window_class(&klass, hwnd);
        if (!ms_get_window_exe(&exe, hwnd)) {
          dstr_free(&title);
          dstr_free(&klass);
          throw std::runtime_error(
              "The selected application cannot be identified safely");
        }
        if (ms_find_window(INCLUDE_MINIMIZED, WINDOW_PRIORITY_TITLE,
                           klass.array, title.array, exe.array) != hwnd) {
          dstr_free(&title);
          dstr_free(&klass);
          dstr_free(&exe);
          throw std::runtime_error(
              "Another application has the same window title. Rename the "
              "selected window or choose another source");
        }
        for (auto *value : {&title, &klass, &exe}) {
          dstr_replace(value, "#", "#22");
          dstr_replace(value, ":", "#3A");
        }
        window = std::string(title.array ? title.array : "") + ":" +
                 (klass.array ? klass.array : "") + ":" +
                 (exe.array ? exe.array : "");
        dstr_free(&title);
        dstr_free(&klass);
        dstr_free(&exe);
        auto *props = obs_get_source_properties("window_capture");
        auto *p = obs_properties_get(props, "window");
        int matches = 0;
        for (size_t i = 0; i < obs_property_list_item_count(p); i++)
          if (window == obs_property_list_item_string(p, i))
            matches++;
        obs_properties_destroy(props);
        if (matches != 1)
          throw std::runtime_error(
              "The selected application cannot be distinguished safely. Rename "
              "its window or choose another source");
      }
      if (window.empty())
        throw std::runtime_error("The selected application is unavailable");
      obs_data_set_string(s, "window", window.c_str());
      obs_data_set_int(s, "method", 2);
      obs_data_set_int(s, "priority", 0);
      obs_data_set_bool(s, "cursor", true);
      obs_data_set_bool(s, "capture_audio", c.value("captureAudio", sessionConfiguration.value("captureAudio",true)));
      obs_data_set_bool(s, "force_sdr", true);
      bool preferGame =
          c.value("captureMethod",
                  c.value("sourceKind", "") == "auto" ? "game" : "window") ==
          "game";
      if (!c.contains("captureMethod") && sourceId.rfind("window:", 0) == 0)
        preferGame =
            preferGame || selectedWindowFullscreen(reinterpret_cast<HWND>(
                              std::stoull(sourceId.substr(7))));
      if (preferGame) {
        obs_data_set_string(s, "capture_mode", "window");
        obs_data_set_bool(s, "capture_cursor", true);
        obs_data_set_bool(s, "anti_cheat_hook", true);
        next = createCaptureSource("game_capture", s);
      } else
        next = createCaptureSource("window_capture", s);
    } else
      throw std::runtime_error(
          "Automatic game detection is not available in this recording backend "
          "yet. Choose Screen or App");
#elif defined(__APPLE__)
    next = acroclip::macos::createCapture(c);
#elif defined(__linux__)
    if (acroclip::wayland::enabled() && kind == "screen") {
      nextPortal = acroclip::wayland::createScreen();
      next = obs_source_get_ref(nextPortal->source());
    } else if (kind == "app") {
      std::string id = c.value("sourceId", "");
      if (id.rfind("window:", 0) != 0)
        throw std::runtime_error(
            "The selected X11 window has no capture identity");
      uint32_t window = uint32_t(std::stoull(id.substr(7)));
      if (!x11Available(window, c.value("pid", uint32_t(0))))
        throw std::runtime_error(
            "The selected X11 application is unavailable or changed");
      std::string name, klass;
      {
        std::lock_guard<std::mutex> lock(xcbMutex);
        name = windowText(window, "_NET_WM_NAME");
        if (name.empty())
          name = windowText(window, "WM_NAME");
        klass = windowText(window, "WM_CLASS");
      }
      std::string identity =
          std::to_string(window) + "\r\n" + name + "\r\n" + klass;
      obs_data_set_string(s, "capture_window", identity.c_str());
      obs_data_set_bool(s, "show_cursor", true);
      // OBS's XComposite texture import uses GLX. A Wayland output uses EGL,
      // so read this application's own pixmap through the CPU source instead.
      captureTextureFailure = acroclip::wayland::enabled();
      next = captureTextureFailure ? nullptr
                                   : createCaptureSource("xcomposite_input", s);
      if (captureTextureFailure) {
        obs_source_release(next);
        obs_wait_for_destroy_queue();
        obs_data_set_int(s, "window", window);
        obs_data_set_int(s, "fps", fps);
        next = createCaptureSource("acroclip_x11_window", s);
        auto deadline =
            std::chrono::steady_clock::now() + std::chrono::seconds(2);
        while ((!obs_source_get_width(next) || !obs_source_get_height(next)) &&
               std::chrono::steady_clock::now() < deadline)
          std::this_thread::sleep_for(std::chrono::milliseconds(10));
        if (!obs_source_get_width(next) || !obs_source_get_height(next)) {
          obs_source_release(next);
          throw std::runtime_error(
              "This X11 session could not capture the application's pixels. No "
              "desktop capture was substituted");
        }
        compatibility = true;
        emit({{"event", "capture-method"},
              {"method", "compatibility"},
              {"reason",
               acroclip::wayland::enabled()
                   ? "XWayland application capture uses CPU compatibility mode"
                   : "Application capture uses CPU compatibility mode because "
                     "this graphics driver cannot import its window texture"}});
      }
    } else if (kind == "screen") {
      int screen = c.value("screenIndex", 0);
      obs_data_set_int(s, "screen", screen);
      obs_data_set_bool(s, "show_cursor", true);
      const char *screenType = inputTypeAvailable("xshm_input_v2")
                                   ? "xshm_input_v2"
                                   : "xshm_input";
      next = createCaptureSource(screenType, s);
      if (!next)
        throw std::runtime_error(
            "The X11 capture module could not create a source");
      auto *props = obs_source_properties(next);
      auto *screens = props ? obs_properties_get(props, "screen") : nullptr;
      bool found = false;
      if (screens)
        for (size_t i = 0; i < obs_property_list_item_count(screens); i++) {
          if (obs_property_list_item_disabled(screens, i))
            continue;
          int candidate = int(obs_property_list_item_int(screens, i));
          if (c.contains("bounds") && c["bounds"].is_object()) {
            std::string label = obs_property_list_item_name(screens, i);
            auto bracket = label.find('(');
            int w = 0, h = 0, x = 0, y = 0;
            if (bracket == std::string::npos ||
                sscanf(label.c_str() + bracket, "(%dx%d @ %d,%d)", &w, &h, &x,
                       &y) != 4)
              continue;
            auto b = c["bounds"];
            if (w != b.value("width", 0) || h != b.value("height", 0) ||
                x != b.value("x", 0) || y != b.value("y", 0))
              continue;
          } else if (candidate != screen)
            continue;
          obs_data_set_int(s, "screen", candidate);
          found = true;
          break;
        }
      obs_properties_destroy(props);
      if (!found) {
        obs_source_release(next);
        throw std::runtime_error(
            "The selected X11 display could not be matched safely");
      }
      obs_source_update(next, s);
    } else
      throw std::runtime_error("The resolved X11 capture source is invalid");
#else
    throw std::runtime_error(
        "Native capture on this platform is not yet implemented");
#endif
    if (!next)
      throw std::runtime_error("The capture source could not be created");
    uintptr_t target = 0;
    if (kind == "app") {
      std::string id = c.value("sourceId", "");
      if (id.rfind("window:", 0) == 0)
        target = std::stoull(id.substr(7));
    }
    uint32_t targetPid = 0;
#ifdef _WIN32
    if (target) {
      DWORD pid = 0;
      GetWindowThreadProcessId(reinterpret_cast<HWND>(target), &pid);
      targetPid = pid;
    }
#endif
#ifdef __linux__
    if (target) {
      std::lock_guard<std::mutex> lock(xcbMutex);
      targetPid = cardinal(uint32_t(target), "_NET_WM_PID");
    }
#endif
    if(sessionConfiguration.value("automaticMaster",false) && c.value("captureAudio",sessionConfiguration.value("captureAudio",true))) {
      try {
        for(const auto &extra:additionalAudio)if(extra.source) {
          if(kind=="app" && extra.kind=="application" && extra.pid==targetPid)throw std::runtime_error("This application is already included by another audio source");
#ifdef _WIN32
          if(kind=="screen" && extra.kind=="output"){acroclip::windows::ListenRouting routing;if(routing.same("default",extra.deviceId))throw std::runtime_error("This output is already included by Source audio");}
#endif
        }
      }catch(...){obs_source_release(next);throw;}
    }
#ifdef __linux__
    std::unique_ptr<ApplicationAudio, decltype(&destroyApplicationAudio)> nextAudio(
        nullptr, &destroyApplicationAudio);
    std::unique_ptr<obs_source_t, decltype(&obs_source_release)> nextDesktop(
        nullptr, &obs_source_release);
    try {
      if (target && c.value("captureAudio", sessionConfiguration.value("captureAudio",true)))
        nextAudio.reset(createApplicationAudio(targetPid));
      bool needsDesktop = false;
      {
        std::lock_guard<std::mutex> audioLock(audioSourcesMutex);
        needsDesktop = kind == "screen" && !desktop;
      }
      if (needsDesktop) {
        std::unique_ptr<obs_data_t, decltype(&obs_data_release)> settings(
            obs_data_create(), &obs_data_release);
        obs_data_set_string(settings.get(), "device_id", "default");
        nextDesktop.reset(obs_source_create_private(
            desktopType(), "Capture audio", settings.get()));
        if (!nextDesktop)
          throw std::runtime_error("Desktop audio could not be opened");
        obs_source_set_audio_mixers(nextDesktop.get(), 3);
      }
    } catch (...) {
      obs_source_release(next);
      throw;
    }
    obs_volmeter_detach_source(captureMeter);
    {
      std::lock_guard<std::mutex> audioLock(audioSourcesMutex);
      obs_set_output_source(1, nullptr);
      destroyApplicationAudio(applicationAudio);
      applicationAudio = nextAudio.release();
      if (nextDesktop)
        desktop = nextDesktop.release();
      if (kind != "screen" && desktop) {
        obs_source_release(desktop);
        desktop = nullptr;
      }
      obs_set_output_source(1, kind == "screen"
                                   ? desktop
                                   : applicationAudioSource(applicationAudio));
    }
#endif
    targetWindow = target;
    targetProcess = targetPid;
    {
      std::lock_guard<std::mutex> lock(displayIdentityMutex);
      selectedDisplayIdentity = std::move(nextDisplayIdentity);
      displayIdentityChecked = 0;
    }
    windowCompatibility = compatibility;
#ifdef _WIN32
    gameCapture = std::string(obs_source_get_id(next)) == "game_capture";
#else
    gameCapture = false;
#endif
    gameReady = false;
    captureImageReady = false;
    captureImageSince = 0;
    gameStarted = os_gettime_ns();
    gameConfig = c;
    screenCapture = kind == "screen";
    captureAudioEnabled = c.value("captureAudio", sessionConfiguration.value("captureAudio",true));
    obs_source_set_audio_mixers(next, 3);
    if (item)
      obs_sceneitem_remove(item);
    {
      std::lock_guard<std::mutex> sourceLock(captureSourceMutex);
      if (capture)
        obs_source_release(capture);
      capture = next;
    }
#ifdef __linux__
    std::atomic_store(&portalCapture, std::move(nextPortal));
#endif
    item = obs_scene_add(scene, capture);
    obs_sceneitem_set_bounds_type(item, OBS_BOUNDS_SCALE_INNER);
    vec2 bounds{float(width), float(height)};
    obs_sceneitem_set_bounds(item, &bounds);
    obs_sceneitem_set_bounds_alignment(item, OBS_ALIGN_CENTER);
    obs_sceneitem_set_alignment(item, OBS_ALIGN_CENTER);
    vec2 pos{width / 2.f, height / 2.f};
    obs_sceneitem_set_pos(item, &pos);
    {
      std::lock_guard<std::mutex> lock(mutex);
      sourceName = c.value("sourceName", "Screen");
      selectedSourceId = c.value("sourceId", "");
#ifdef __linux__
      if (acroclip::wayland::enabled() && screenCapture)
        sourceName = "Portal-selected screen";
#endif
    }
    captureEnabled = true;
    std::lock_guard<std::mutex> audioLock(audioSourcesMutex);
#ifdef _WIN32
    if((!screenCapture || !captureAudioEnabled) && desktop){obs_set_output_source(1,nullptr);audioHealth.forget(desktop);obs_source_release(desktop);desktop=nullptr;}
    if(screenCapture && captureAudioEnabled && !desktop){auto *settings=obs_data_create();obs_data_set_string(settings,"device_id","default");desktop=obs_source_create_private(desktopType(),"Source audio",settings);obs_data_release(settings);if(!desktop)throw std::runtime_error("Source audio could not be opened");audioHealth.watch(desktop);obs_source_set_audio_mixers(desktop,3);obs_set_output_source(1,desktop);}
#endif
    if (desktop)
      obs_source_set_muted(desktop, kind != "screen" ||
                                        !c.value("captureAudio", sessionConfiguration.value("captureAudio",true)) ||
                                        captureMuted);
    obs_source_t *audioSource =
#ifdef __APPLE__
        capture;
#elif defined(__linux__)
        screenCapture ? desktop : applicationAudioSource(applicationAudio);
#else
        screenCapture ? desktop : capture;
#endif
    if(sessionConfiguration.value("automaticMaster",false))for(auto &extra:additionalAudio) {
      extra.mixerMask = extra.isolatedMask | ((!screenCapture || extra.kind == "input") ? 1u : 0u);
      if(extra.source)obs_source_set_audio_mixers(extra.source, extra.mixerMask);
    }
    if (audioSource) {
      obs_source_set_volume(audioSource, captureVolume);
      obs_source_set_muted(audioSource, captureMuted || !captureAudioEnabled);
      obs_volmeter_attach_source(captureMeter, audioSource);
    }
#ifdef __linux__
    if (applicationAudio)
      setApplicationAudioLevelCallback(applicationAudio, [this](float value) {
        captureLevel = value;
        if (active)
          emit({{"event", "audio-levels"},
                {"capture", value},
                {"microphone", microphoneLevel.load()}});
      });
#endif
  }
  void start(const json &c) {
    if (active)
      throw std::runtime_error("Recording is already running");
    if (clipWriter->pending() > 0)
      throw std::runtime_error(
          "Wait for clip saves to finish before restarting");
    try {
      initializeSession(c);
    } catch (...) {
      // A failed start owns no accepted saves. Close every partly initialized
      // source and return the video loop to idle before reporting the failure.
      stop();
      throw;
    }
  }
private:
  void configureVideoOutput() {
    obs_video_info vi{};
    vi.graphics_module = graphicsModule();
    vi.fps_num = fps;
    vi.fps_den = 1;
    vi.base_width = width;
    vi.base_height = height;
    vi.output_width = width;
    vi.output_height = height;
    vi.output_format = VIDEO_FORMAT_NV12;
    vi.gpu_conversion = true;
    vi.colorspace = VIDEO_CS_709;
    vi.range = VIDEO_RANGE_PARTIAL;
    vi.scale_type = OBS_SCALE_BICUBIC;
    if (obs_reset_video(&vi) != OBS_VIDEO_SUCCESS)
      throw std::runtime_error(
          "The graphics driver could not initialize recording");
  }
  void initializeSession(const json &c) {
    release();
    sessionConfiguration = c;
    seconds = c.value("clipSeconds", 60);
    avoidOverlap = c.value("avoidOverlap", false);
    clipWriter->resetOverlap();
    std::string quality = c.value("quality", "standard");
    const auto size = quality == "custom" && c.value("recordingSizeVersion",0)!=2 ? acroclip::RecordingSize{c.value("customWidth",1920),c.value("customHeight",1080)} : acroclip::RecordingSize{0,0};
    presetRecording = c.value("recordingSizeVersion",0)==2 || quality != "custom";
    waitingForPresetSize = presetRecording;
    // This temporary profile never enters history. NVENC rejects dimensions below its hardware minimum.
    width=waitingForPresetSize ? 320 : size.width; height=waitingForPresetSize ? 180 : size.height;
    fps=c.value("recordingPresetVersion",0)==1 || quality=="custom" ? c.value("customFPS",60) : quality=="low"?30:60;
    int cq=c.value("recordingPresetVersion",0)==1 || quality=="custom" ? c.value("customCQ",23) : quality=="high"?18:23;
    sessionCQ = cq;
    if (width < 64 || width > 7680 || height < 64 || height > 4320 || width % 2 || height % 2 || fps < 1 || fps > 120 || cq < 12 || cq > 35)
      throw std::runtime_error("The recording profile is invalid");
    configureVideoOutput();
    scene = obs_scene_create_private("Recording");
    if (!scene)
      throw std::runtime_error("The recording scene could not be created");
    obs_set_output_source(0, obs_scene_get_source(scene));
    std::unique_ptr<obs_data_t, decltype(&obs_data_release)> d(
        obs_data_create(), &obs_data_release);
#ifndef __APPLE__
#ifdef __linux__
    d.reset();
#else
    obs_data_set_string(d.get(), "device_id", "default");
    {
      std::lock_guard<std::mutex> audioLock(audioSourcesMutex);
      const auto configuredKind=c.value("sourceKind",std::string("screen"));
      if((configuredKind=="screen" || (configuredKind=="auto" && c.value("resolvedKind",std::string("waiting"))=="screen")) && c.value("captureAudio",true))desktop = obs_source_create_private(desktopType(), "Capture audio", d.get());
      d.reset();
      if (desktop) {
        audioHealth.watch(desktop);
        obs_source_set_audio_mixers(desktop, 3);
        obs_set_output_source(1, desktop);
      }
    }
#endif
#else
    d.reset();
#endif
    source(c);
    setupAdditionalAudio(c);
    captureVolume = c.value("captureVolume", 1.f);
    microphoneVolume = c.value("microphoneVolume", 1.f);
    captureMuted = c.value("captureMuted", false);
    microphoneMuted = c.value("microphoneMuted", false);
    setAudio({{"source", "capture"},
              {"volume", captureVolume},
              {"muted", captureMuted}});
    setAudio({{"source", "microphone"},
              {"volume", microphoneVolume},
              {"muted", microphoneMuted}});
    startEncoding(c, cq);
  }
  void startEncoding(const json &c, int cq) {
    std::unique_ptr<obs_data_t, decltype(&obs_data_release)> d(obs_data_create(), &obs_data_release);
    obs_data_set_string(d.get(), "rate_control", "CQP");
    obs_data_set_int(d.get(), "cqp", cq);
    obs_data_set_string(d.get(), "preset", "p4");
    obs_data_set_int(d.get(), "keyint_sec", 1);
    obs_data_set_int(d.get(), "bf", 0);
    const char *id = nullptr;
    encoder.clear();
#ifdef __APPLE__
    encoder = acroclip::macos::hardwareEncoder(d.get(), cq, width, height, fps);
#else
    auto hardware = hardwareEncoders();
    if (!hardware.empty())
      encoder = hardware.front();
    if (encoder.find("amf") != std::string::npos)
      obs_data_set_string(d.get(), "preset", "balanced");
    if (encoder.find("qsv") != std::string::npos) {
      obs_data_set_string(d.get(), "target_usage", "TU4");
      obs_data_set_int(d.get(), "qpi", cq);
      obs_data_set_int(d.get(), "qpp", cq);
      obs_data_set_int(d.get(), "qpb", cq);
      obs_data_set_int(d.get(), "bframes", 0);
    }
#endif
    if (std::getenv("ACROCLIP_NATIVE_TEST_SOFTWARE"))
      encoder.clear();
    if (encoder.empty() && c.value("allowSoftwareEncoder", false)) {
      for (size_t i = 0; obs_enum_encoder_types(i, &id); i++)
        if (std::string(id) == "obs_x264")
          encoder = id;
      if (!encoder.empty()) {
        obs_data_set_string(d.get(), "rate_control", "CRF");
        obs_data_set_int(d.get(), "crf", cq);
        obs_data_set_string(d.get(), "preset", "veryfast");
        obs_data_set_string(d.get(), "x264opts", "bframes=0");
      }
    }
    if (encoder.empty())
      throw std::runtime_error(
          "No supported hardware H.264 encoder is available. Software "
          "recording is not silently enabled");
    video = obs_video_encoder_create(encoder.c_str(), "Video", d.get(), nullptr);
    d.reset();
    if (!video)
      throw std::runtime_error("The hardware encoder could not be created");
    obs_encoder_set_video(video, obs_get_video());
    output = obs_output_create("acroclip_replay", "Replay", nullptr, nullptr);
    if (!output)
      throw std::runtime_error("The recording output could not be created");
    obs_output_set_video_encoder(output, video);
    audio.reserve(audioNames.size());
    for (size_t i = 0; i < audioNames.size(); i++) {
      d.reset(obs_data_create());
      obs_data_set_int(d.get(), "bitrate", 160);
      auto *a = obs_audio_encoder_create("ffmpeg_aac", audioNames[i].c_str(), d.get(),
                                         i, nullptr);
      d.reset();
      if (!a)
        throw std::runtime_error("The audio encoder could not be created");
      obs_encoder_set_audio(a, obs_get_audio());
      audio.push_back(a);
      obs_output_set_audio_encoder(output, a, i);
    }
    active = true;
    if (!obs_output_start(output))
      throw std::runtime_error(obs_output_get_last_error(output));
    if (std::getenv("ACROCLIP_NATIVE_TEST_LIFECYCLE") &&
        c.value("testEncoderFailure", false))
      packets(nullptr);
    if (!active || encoderFailed)
      throw std::runtime_error("The recording encoder stopped during startup");
    emit({{"event", "recording"}, {"encoder", encoder}});
#ifdef __APPLE__
    if (std::getenv("ACROCLIP_NATIVE_TEST_AUDIO_TIMING"))
      emit({{"event","audio-timing"},{"phase","recording"},{"reportedNs",os_gettime_ns()},{"sources",acroclip::macos::audioTiming()}});
#endif
  }
public:
  // The command channel reads a state snapshot, not the recorder's mutexes,
  // encoder handles or replay storage.
  json status() {
    // Destruction belongs to the command thread, never an encoder callback.
    if (encoderFailed.exchange(false))
      stop();
    refreshCapture();
    std::lock_guard<std::mutex> lock(mutex);
    checkDeliveryGap();
    // Audio can arrive before the video encoder delivers usable footage.
    // Report only the video history that snapshot() can actually save.
    int64_t firstVideo = 0, lastVideo = 0;
    bool hasVideo = false;
    for (const auto &packet : ring) {
      if (packet.p.type != OBS_ENCODER_VIDEO)
        continue;
      if (!hasVideo) {
        if (!packet.p.keyframe)
          continue;
        firstVideo = packet.p.sys_dts_usec;
        hasVideo = true;
      }
      lastVideo = packet.p.sys_dts_usec;
    }
    double available = hasVideo ? (lastVideo - firstVideo) / 1000000. : 0;
    bool fullscreen = false;
    std::string captureError;
#ifdef _WIN32
    HWND foreground = GetForegroundWindow();
    RECT rect{};
    MONITORINFO monitor{};
    monitor.cbSize = sizeof(monitor);
    if (foreground && GetWindowRect(foreground, &rect) &&
        GetMonitorInfo(
            MonitorFromWindow(foreground, MONITOR_DEFAULTTONEAREST),
            &monitor))
      fullscreen = rect.left <= monitor.rcMonitor.left &&
                   rect.top <= monitor.rcMonitor.top &&
                   rect.right >= monitor.rcMonitor.right &&
                   rect.bottom >= monitor.rcMonitor.bottom &&
                   foreground != GetDesktopWindow() &&
                   foreground != GetShellWindow();
#endif
#ifdef __APPLE__
    fullscreen = acroclip::macos::foregroundFullscreen();
    captureError = acroclip::macos::captureError();
#endif
#ifdef __linux__
    if (acroclip::wayland::enabled() && screenCapture) {
      auto portal = std::atomic_load(&portalCapture);
      if (portal)
        captureError = portal->health().message();
    }
#endif
    std::string audioWarning = additionalAudioError();
#ifdef __linux__
    const auto sourceAudioError = captureAudioError();
    if (audioWarning.empty()) audioWarning = sourceAudioError;
#endif
    if (audioWarning != audioWarningCandidate) {
      audioWarningCandidate = audioWarning;
      audioWarningSince = os_gettime_ns();
    }
    const std::string visibleAudioWarning = audioWarning.empty() || os_gettime_ns() - audioWarningSince >= 1200000000ULL ? audioWarning : "";
#ifdef _WIN32
    if(!listeningSource.empty()) {
      try {
        acroclip::windows::ListenRouting routing;
        if(listeningRequestedDevice=="default" && utf8(acroclip::windows::ListenRouting::identity(routing.device("default").Get()))!=listeningDevice) {
          const std::string source=listeningSource;
          listenAudio({{"source",source},{"deviceId","default"}});
        }
        routing.device(listeningDevice);
        const auto found=listenTarget(listeningSource);
        if(!found.source)throw std::runtime_error("The listening source is unavailable");
        if(found.kind=="input"||found.kind=="output") {
          const auto problem=audioHealth.error(found.source);
          // Keep an explicit listen request during normal asynchronous startup.
          // Endpoint loss and delivery failures are actual audition failures.
          if(!problem.empty()&&problem!="Audio capture is starting"&&problem!="Audio capture is reconnecting")throw std::runtime_error(problem);
        }
        if(listeningSource=="capture"&&!screenCapture){DWORD pid=0;GetWindowThreadProcessId(reinterpret_cast<HWND>(targetWindow.load()),&pid);if(!IsWindow(reinterpret_cast<HWND>(targetWindow.load()))||pid!=targetProcess)throw std::runtime_error("The listening source is unavailable");}
        if(found.kind=="output" && (found.deviceId=="default" || routing.same(found.deviceId,listeningDevice)))throw std::runtime_error("Listening stopped to prevent output audio feedback");
        if(active && screenCapture && captureAudioEnabled && routing.same("default",listeningDevice))
          throw std::runtime_error("Listening stopped because its output is now being recorded");
        for(const auto &extra:additionalAudio)
          if(active && extra.source && extra.kind=="output" && (extra.deviceId=="default" || routing.same(extra.deviceId,listeningDevice)))
            throw std::runtime_error("Listening stopped because its output is now being captured");
        for(const auto &extra:additionalAudio) {
          if(extra.id!=listeningSource || !extra.window)continue;
          DWORD pid=0;GetWindowThreadProcessId(reinterpret_cast<HWND>(extra.window),&pid);
          if(!IsWindow(reinterpret_cast<HWND>(extra.window)) || pid!=extra.pid)throw std::runtime_error("The listening source is unavailable");
        }
      } catch(const std::exception &error) {const std::string message=error.what();listenAudio({{"source",""}});listeningFailure=message;}
    }
#endif
    if (monitoring)
      emit({{"event", "audio-monitor"}, {"monitorMessage", listeningFailure.empty() ? audioWarning : listeningFailure}, {"listeningMessage", listeningFailure}});
    if (captureError.empty() && deliveryInterrupted)
      captureError = "Waiting for recording to resume";
#ifdef _WIN32
    if (captureError.empty() && active && captureEnabled && !captureImageReady)
      captureError = "Waiting for an image from the selected source";
#endif
    if (captureError.empty() && active && screenCapture &&
        !targetAvailable())
      captureError = "The selected screen is unavailable";
#ifdef __APPLE__
    if (std::getenv("ACROCLIP_NATIVE_TEST_AUDIO_TIMING"))
      emit({{"event","audio-timing"},{"phase","status"},{"reportedNs",os_gettime_ns()},{"firstVideoUs",firstVideo},{"lastVideoUs",lastVideo},{"sources",acroclip::macos::audioTiming()}});
#endif
    return {{"event", "status"},
          {"fullscreen", fullscreen},
          {"active", active.load()},
          {"source", sourceName},
          {"message", captureError},
          {"audioWarning", active ? visibleAudioWarning : ""},
          {"bufferedSource", bufferedSourceName},
          {"bufferedSourceId", bufferedSourceId},
          {"bufferedSourceKind", bufferedScreen ? "screen" : "app"},
          {"monitorMessage", monitoring && listeningFailure.empty() ? audioWarning : listeningFailure},
          {"listeningMessage", listeningFailure},
          {"sourceId", selectedSourceId},
          {"sourceKind", captureEnabled
                             ? (screenCapture ? "screen" : "app")
                             : "waiting"},
          {"captureMethod", windowCompatibility ? "compatibility"
                            : gameCapture       ? "game"
                                                  : "window"},
          {"waiting",
           active && (!targetAvailable() || captureInterrupted)},
          {"availableSeconds", std::min(double(seconds), available)},
          {"pendingSaves", clipWriter->pending()}};
  }
  bool beginEncodedOutput() {
    if (!obs_output_can_begin_data_capture(output, 0) ||
        !obs_output_initialize_encoders(output, 0))
      return false;
    obs_output_begin_data_capture(output, 0);
    return true;
  }
  void endEncodedOutput() { obs_output_end_data_capture(output); }
  json lifecycle(const std::string &id) {
    size_t sources = 0, attached = 0;
    obs_enum_all_sources([](void *count, obs_source_t *) {
      ++*static_cast<size_t *>(count);
      return true;
    }, &sources);
    for (uint32_t channel = 0; channel < 8; ++channel) {
      auto *source = obs_get_output_source(channel);
      if (source) {
        ++attached;
        obs_source_release(source);
      }
    }
    obs_video_info video{};
    obs_get_video_info(&video);
    std::lock_guard<std::mutex> lock(mutex);
    float listeningPeak = 0;
    bool listeningOutputActive = false;
#ifdef _WIN32
    if (!listeningDevice.empty()) {
      acroclip::windows::ListenRouting routing;
      listeningOutputActive = routing.audible(GetCurrentProcessId(), listeningDevice, false);
      listeningPeak = routing.peak(GetCurrentProcessId(), listeningDevice);
    }
#endif
    return {{"event", "lifecycle"},
          {"id", id},
          {"sources", sources}, {"attached", attached},
          {"active", active.load()},
          {"monitoring", monitoring.load()},
          {"listening", listeningSource},
          {"listeningPeak", listeningPeak},
          {"listeningOutputActive", listeningOutputActive},
          {"videoEncoder", this->video != nullptr},
          {"audioEncoders", audio.size()},
          {"historyPackets", ring.size()},
          {"width", video.output_width},
          {"height", video.output_height},
          {"fps", video.fps_num}};
  }
  json encoderFailure(const std::string &id) {
    size_t accepted = 0;
    {
      std::lock_guard<std::mutex> lock(mutex);
      accepted = requests.size();
    }
    packets(nullptr);
    return {{"event", "encoder-failure"},
            {"id", id},
            {"acceptedBeforeFailure", accepted}};
  }
#ifdef __linux__
  void closePortalSession() {
    auto portal = std::atomic_load(&portalCapture);
    if (!portal)
      throw std::runtime_error("No portal session is active");
    portal->closeSession();
  }
#endif

};
Recorder *recorder = nullptr;
int main(int argc, char **argv) {
  try {
    std::filesystem::path root =
        std::filesystem::absolute(argc > 1 ? argv[1] : ".");
#ifdef __APPLE__
    acroclip::macos::prepareProcess(root);
    muxExecutable = acroclip::macos::muxPath();
#endif
#ifdef __linux__
    // Match OBS's frontend: a failed mux pipe is a save failure, never a
    // SIGPIPE termination of the capture process and its retained footage.
    sigset_t brokenPipe{};
    sigemptyset(&brokenPipe);
    sigaddset(&brokenPipe, SIGPIPE);
    if (pthread_sigmask(SIG_BLOCK, &brokenPipe, nullptr) != 0)
      throw std::runtime_error("Could not configure recorder pipe handling");
    if (!XInitThreads())
      throw std::runtime_error("X11 thread initialization failed");
    auto waylandPlatform = std::make_unique<acroclip::wayland::Platform>();
    struct ObsShutdown {
      bool initialized = false;
      ~ObsShutdown() {
        if (initialized)
          obs_shutdown();
      }
    } obsShutdown;
#endif
    base_set_log_handler(logger, nullptr);
#ifdef _WIN32
    if (!SetProcessDpiAwarenessContext(DPI_AWARENESS_CONTEXT_PER_MONITOR_AWARE_V2)) SetProcessDPIAware();
#endif
#ifdef _WIN32
    if (argc > 2 && std::string(argv[2]) == "--candidates") { emit({{"event","candidates"},{"windows",captureCandidates()}}); return 0; }
#endif
    // win-capture starts an upstream network updater when its cache directory
    // is writable. Reserve that path as a file. The upstream updater returns
    // before creating its HTTP thread, while bundled locale data still works.
    auto config = std::filesystem::temp_directory_path() / "AcroClip" /
                  "offline-module-config";
    std::filesystem::create_directories(config);
    auto disabledUpdater = config / "win-capture";
    if (std::filesystem::is_directory(disabledUpdater))
      throw std::runtime_error("The offline recorder configuration is invalid");
    std::ofstream(disabledUpdater, std::ios::app).close();
    if (!std::filesystem::is_regular_file(disabledUpdater))
      throw std::runtime_error(
          "Could not disable capture compatibility updates");
    if (!
#ifdef __APPLE__
        acroclip::macos::startup("en-US", config.u8string().c_str())
#else
        obs_startup("en-US", config.u8string().c_str(), nullptr)
#endif
    )
      throw std::runtime_error("libOBS initialization failed");
#ifdef __linux__
    obsShutdown.initialized = true;
    if (!acroclip::wayland::enabled()) {
      if (!std::getenv("DISPLAY"))
        throw std::runtime_error(
            "An X11 display is required for native recording");
      auto *display = XOpenDisplay(nullptr);
      if (!display)
        throw std::runtime_error("The X11 display could not be opened");
      obs_set_nix_platform(OBS_NIX_PLATFORM_X11_EGL);
      obs_set_nix_platform_display(display);
    }
    if (std::getenv("DISPLAY") && *std::getenv("DISPLAY")) {
      candidateConnection = xcb_connect(nullptr, nullptr);
      if (xcb_connection_has_error(candidateConnection)) {
        xcb_disconnect(candidateConnection);
        candidateConnection = nullptr;
        if (!acroclip::wayland::enabled())
          throw std::runtime_error(
              "X11 application identity connection failed");
      }
    }
    muxExecutable = (root / "obs-ffmpeg-mux").string();
#endif
    obs_add_data_path(((root / "data/libobs").u8string() + "/").c_str());
    obs_video_info initial{};
    initial.graphics_module = graphicsModule();
    initial.fps_num = 30;
    initial.fps_den = 1;
    initial.base_width = 1920;
    initial.base_height = 1080;
    initial.output_width = 1920;
    initial.output_height = 1080;
    initial.output_format = VIDEO_FORMAT_NV12;
    initial.gpu_conversion = true;
    initial.colorspace = VIDEO_CS_709;
    initial.range = VIDEO_RANGE_PARTIAL;
    if (obs_reset_video(&initial) != OBS_VIDEO_SUCCESS)
      throw std::runtime_error("Graphics initialization failed");
#ifdef _WIN32
    // The pinned win-capture module resolves hook initialization assets through
    // ../../data, independently of its configured module data path.
    const auto originalDirectory = std::filesystem::current_path();
    std::filesystem::current_path(root / "obs-plugins/64bit");
    for (auto name : {"win-capture", "win-wasapi", "obs-ffmpeg", "obs-nvenc",
                      "obs-qsv11", "obs-x264"}) {
      obs_module_t *module = nullptr;
      auto dll = root / "obs-plugins/64bit" / (std::string(name) + ".dll");
      auto data = root / "data/obs-plugins" / name;
      if (obs_open_module(&module, dll.u8string().c_str(),
                          data.u8string().c_str()) == MODULE_SUCCESS)
        obs_init_module(module);
    }
    std::filesystem::current_path(originalDirectory);
#elif defined(__APPLE__)
    acroclip::macos::loadModules();
#elif defined(__linux__)
    for (auto name : {"linux-capture", "linux-pulseaudio", "obs-ffmpeg",
                      "obs-nvenc", "obs-x264"}) {
      if (std::string(name) == "obs-nvenc" &&
          std::getenv("ACROCLIP_NATIVE_TEST_SOFTWARE"))
        continue;
      obs_module_t *module = nullptr;
      auto file = root / "obs-plugins" / (std::string(name) + ".so");
      auto data = root / "data/obs-plugins" / name;
      if (obs_open_module(&module, file.string().c_str(),
                          data.string().c_str()) == MODULE_SUCCESS)
        obs_init_module(module);
    }
    if (acroclip::wayland::enabled()) {
      acroclip::wayland::loadModule(
          (root / "obs-plugins/linux-pipewire.so").string(),
          (root / "data/obs-plugins/linux-pipewire").string());
      if (!acroclip::wayland::screenAvailable())
        throw std::runtime_error("The system portal cannot share a screen");
    }
#endif
    obs_post_load_modules();
#ifdef __linux__
    registerX11CompatibilitySource();
    registerLinuxApplicationAudio();
    registerLinuxDeviceAudio();
#endif
    obs_audio_info ai{};
    ai.samples_per_sec = 48000;
    ai.speakers = SPEAKERS_STEREO;
    if (!obs_reset_audio(&ai))
      throw std::runtime_error("Audio initialization failed");
    if(std::getenv("ACROCLIP_NATIVE_TEST_LIFECYCLE")) {
      obs_source_info tone{};tone.id="acroclip_test_tone";tone.type=OBS_SOURCE_TYPE_INPUT;tone.output_flags=OBS_SOURCE_AUDIO;
      tone.get_name=[](void*){return "Controlled test audio";};tone.create=[](obs_data_t*,obs_source_t*)->void*{return new int(0);};tone.destroy=[](void*value){delete static_cast<int*>(value);};obs_register_source(&tone);
    }
    idleVideo();
    obs_output_info info{};
    info.id = "acroclip_replay";
    info.flags = OBS_OUTPUT_AV | OBS_OUTPUT_ENCODED | OBS_OUTPUT_MULTI_TRACK;
    info.get_name = [](void *) { return "AcroClip replay"; };
    info.create = [](obs_data_t *, obs_output_t *) -> void * {
      return recorder;
    };
    info.destroy = [](void *) {};
    info.start = [](void *data) {
      auto *r = static_cast<Recorder *>(data);
      return r->beginEncodedOutput();
    };
    info.stop = [](void *data, uint64_t) {
      static_cast<Recorder *>(data)->endEncodedOutput();
    };
    info.encoded_packet = [](void *data, encoder_packet *p) {
      static_cast<Recorder *>(data)->packets(p);
    };
    obs_register_output(&info);
    {
      Recorder r;
      recorder = &r;
      json ready = {{"event", "ready"},
                    {"audioMonitor", true},
                    {"audioListen", true},
                    {"version", obs_get_version_string()},
                    {"encoders", hardwareEncoders()}};
#ifdef __linux__
      if (acroclip::wayland::enabled()) {
        ready["captureBackend"] = "wayland-portal";
        ready["sourceKinds"] = json::array({"screen"});
        if (candidateConnection &&
            !xcb_connection_has_error(candidateConnection)) {
          ready["sourceKinds"].push_back("app");
          ready["sourceKinds"].push_back("auto");
          ready["applicationBackend"] = "xwayland";
        }
        ready["portalPicker"] = true;
      }
#endif
      emit(ready);
      std::string line;
      while (std::getline(std::cin, line)) {
        json c;
        try {
          c = json::parse(line);
          std::string action = c.value("action", "");
          if (action == "start")
            r.start(c);
          else if (action == "stop") {
            r.stop();
            emit({{"event", "stopped"}});
          } else if (action == "save")
            r.save(c);
          else if (action == "source")
            r.source(c);
          else if (action == "listen-audio")
            r.listenAudio(c);
          else if (action == "monitor-audio")
            r.monitorAudio(c);
          else if (action == "audio")
            r.setAudio(c);
#ifdef __linux__
          else if (action == "test-close-portal" &&
                   std::getenv("ACROCLIP_NATIVE_TEST_PORTAL")) {
            r.closePortalSession();
          }
#endif
          else if (action == "exit")
            break;
          else if (action == "candidates") {
#if defined(_WIN32) || defined(__linux__)
            emit({{"event", "candidates"}, {"windows", captureCandidates()}});
#elif defined(__APPLE__)
            emit({{"event", "candidates"},
                  {"windows", acroclip::macos::candidates()}});
#else
            emit({{"event", "candidates"}, {"windows", json::array()}});
#endif
          } else if (action == "windows") {
#ifdef _WIN32
            auto *props = obs_get_source_properties("window_capture");
            auto *p = obs_properties_get(props, "window");
            json windows = json::array();
            for (size_t i = 0; i < obs_property_list_item_count(p); i++)
              windows.push_back(
                  {{"name", obs_property_list_item_name(p, i)},
                   {"value", obs_property_list_item_string(p, i)}});
            obs_properties_destroy(props);
            emit({{"event", "windows"}, {"windows", windows}});
#endif
          } else if (action == "audio-devices") {
            std::string kind = c.value("kind", "input");
            if (kind != "input" && kind != "output")
              throw std::runtime_error("Choose input or output audio devices");
#ifdef __APPLE__
            if (kind == "output")
              emit({{"event", "audio-devices"},
                    {"devices", acroclip::macos::outputDevices()}});
            else {
#endif
              auto *props = obs_get_source_properties(
                  kind == "input" ? microphoneType() : desktopType());
              auto *property =
                  props ? obs_properties_get(props, "device_id") : nullptr;
              json devices = json::array();
              if (property)
                for (size_t i = 0; i < obs_property_list_item_count(property);
                     i++)
                  devices.push_back(
                      {{"name", obs_property_list_item_name(property, i)},
                       {"id", obs_property_list_item_string(property, i)}});
              obs_properties_destroy(props);
              emit({{"event", "audio-devices"}, {"devices", devices}});
#ifdef __APPLE__
            }
#endif
          } else if (action == "test-listener-source" && std::getenv("ACROCLIP_NATIVE_TEST_LIFECYCLE")) {
            r.testListenerSource(c.value("desktop",false));
          } else if (action == "test-listener-tone" && std::getenv("ACROCLIP_NATIVE_TEST_LIFECYCLE")) {
            r.testListenerTone();
          } else if (action == "test-lifecycle" &&
                     std::getenv("ACROCLIP_NATIVE_TEST_LIFECYCLE")) {
            emit(r.lifecycle(c.value("id", "")));
          } else if (action == "test-encoder-failure" &&
                     std::getenv("ACROCLIP_NATIVE_TEST_LIFECYCLE")) {
            emit(r.encoderFailure(c.value("id", "")));
          } else if (action == "status") {
            emit(r.status());
          }
          emit({{"event", "response"}, {"id", c.value("id", "")}});
        } catch (const std::exception &e) {
          emit({{"event", "error"},
                {"id", c.value("id", std::string(""))},
                {"action", c.value("action", std::string(""))},
                {"requestId", c.value("requestId", std::string(""))},
                {"message", e.what()}});
        }
      }
    }
    obs_shutdown();
#ifdef __linux__
    obsShutdown.initialized = false;
#endif
    return 0;
  } catch (const std::exception &e) {
    emit({{"event", "error"}, {"message", e.what()}});
    return 1;
  }
}
