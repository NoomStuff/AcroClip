// SPDX-License-Identifier: GPL-2.0-or-later
#pragma once
#include <windows.h>
#include <mmdeviceapi.h>
#include <audiopolicy.h>
#include <endpointvolume.h>
#include <tlhelp32.h>
#include <wrl/client.h>
#include <string>
#include <algorithm>
#include <atomic>
#include <chrono>
#include <condition_variable>
#include <map>
#include <mutex>
#include <stdexcept>
#include <vector>
namespace acroclip::windows {
/** Every process and its parent, from one snapshot. */
inline std::map<DWORD, DWORD> processParents() {
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
/** When a process started, in FILETIME units, or 0 if Windows won't say. A reused id starts later. */
inline uint64_t processStarted(DWORD pid) {
  HANDLE process = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, FALSE, pid);
  if (!process) return 0;
  FILETIME created{}, exited{}, kernel{}, user{};
  const bool known = GetProcessTimes(process, &created, &exited, &kernel, &user);
  CloseHandle(process);
  return known ? (uint64_t(created.dwHighDateTime) << 32) | created.dwLowDateTime : 0;
}
class ListenRouting {
  using Device = Microsoft::WRL::ComPtr<IMMDevice>;
  Microsoft::WRL::ComPtr<IMMDeviceEnumerator> enumerator;
  HRESULT initialized;
public:
  ListenRouting() : initialized(CoInitializeEx(nullptr, COINIT_MULTITHREADED)) {
    if ((FAILED(initialized) && initialized != RPC_E_CHANGED_MODE) || FAILED(CoCreateInstance(__uuidof(MMDeviceEnumerator), nullptr, CLSCTX_ALL, IID_PPV_ARGS(&enumerator)))) { if(SUCCEEDED(initialized))CoUninitialize(); throw std::runtime_error("Audio output routing could not be verified"); }
  }
  ListenRouting(const ListenRouting&)=delete;
  ListenRouting& operator=(const ListenRouting&)=delete;
  ~ListenRouting() { enumerator.Reset(); if(SUCCEEDED(initialized))CoUninitialize(); }
  Device device(const std::string &id,EDataFlow flow=eRender) {
    Device value;
    HRESULT result;
    if(id == "default")result=enumerator->GetDefaultAudioEndpoint(flow,flow==eCapture?eCommunications:eConsole,&value);
    else {int count=MultiByteToWideChar(CP_UTF8,MB_ERR_INVALID_CHARS,id.c_str(),-1,nullptr,0);std::wstring wide(size_t(count>0?count:1),L'\0');if(count>0)MultiByteToWideChar(CP_UTF8,MB_ERR_INVALID_CHARS,id.c_str(),-1,wide.data(),count);result=count>0?enumerator->GetDevice(wide.c_str(),&value):E_INVALIDARG;}
    DWORD state=0;
    if(FAILED(result)||FAILED(value->GetState(&state))||state!=DEVICE_STATE_ACTIVE)throw std::runtime_error("The listening output is unavailable");
    return value;
  }
  struct Session { DWORD pid; AudioSessionState state; };
  /** Every live session on one output, by process. */
  static std::vector<Session> sessions(IMMDevice *endpoint) {
    Microsoft::WRL::ComPtr<IAudioSessionManager2> manager;
    Microsoft::WRL::ComPtr<IAudioSessionEnumerator> enumerated;
    if (FAILED(endpoint->Activate(__uuidof(IAudioSessionManager2), CLSCTX_ALL, nullptr, reinterpret_cast<void **>(manager.GetAddressOf()))) ||
        FAILED(manager->GetSessionEnumerator(&enumerated)))
      throw std::runtime_error("Desktop audio sessions could not be enumerated");
    std::vector<Session> listed;
    int count = 0;
    if (FAILED(enumerated->GetCount(&count))) throw std::runtime_error("Desktop audio sessions could not be read");
    for (int index = 0; index < count; ++index) {
      Microsoft::WRL::ComPtr<IAudioSessionControl> control;
      Microsoft::WRL::ComPtr<IAudioSessionControl2> session;
      DWORD pid = 0;
      AudioSessionState state = AudioSessionStateExpired;
      if (FAILED(enumerated->GetSession(index, &control)) || FAILED(control.As(&session)) ||
          FAILED(session->GetProcessId(&pid)) || FAILED(session->GetState(&state)))
        throw std::runtime_error("A desktop audio session could not be identified");
      if (!pid || state == AudioSessionStateExpired) continue;
      listed.push_back({pid, state});
    }
    return listed;
  }
  /** Calls `client` when outputs come, go or the default changes, until unwatch. */
  void watch(IMMNotificationClient *client) {
    if (FAILED(enumerator->RegisterEndpointNotificationCallback(client))) throw std::runtime_error("Audio output changes could not be followed");
  }
  void unwatch(IMMNotificationClient *client) { enumerator->UnregisterEndpointNotificationCallback(client); }
  /** Every active output device. */
  std::vector<Device> outputs() {
    Microsoft::WRL::ComPtr<IMMDeviceCollection> collection;
    UINT count=0;
    if(FAILED(enumerator->EnumAudioEndpoints(eRender,DEVICE_STATE_ACTIVE,&collection))||FAILED(collection->GetCount(&count)))throw std::runtime_error("Audio outputs could not be listed");
    std::vector<Device> result;
    for(UINT index=0;index<count;index++){Device value;if(SUCCEEDED(collection->Item(index,&value)))result.push_back(value);}
    return result;
  }
  static std::wstring identity(IMMDevice *device) { LPWSTR raw=nullptr;if(FAILED(device->GetId(&raw)))throw std::runtime_error("The listening output cannot be identified");std::wstring result(raw);CoTaskMemFree(raw);return result; }
  bool same(const std::string&a,const std::string&b){return identity(device(a).Get())==identity(device(b).Get());}
  float peak(uint32_t pid,const std::string &output) {
    Microsoft::WRL::ComPtr<IAudioSessionManager2> manager;auto endpoint=device(output);
    if(FAILED(endpoint->Activate(__uuidof(IAudioSessionManager2),CLSCTX_ALL,nullptr,reinterpret_cast<void**>(manager.GetAddressOf()))))throw std::runtime_error("The listening output cannot be metered");
    Microsoft::WRL::ComPtr<IAudioSessionEnumerator> sessions;if(FAILED(manager->GetSessionEnumerator(&sessions)))throw std::runtime_error("The listening output cannot be metered");int count=0;sessions->GetCount(&count);float result=0;
    for(int i=0;i<count;i++){Microsoft::WRL::ComPtr<IAudioSessionControl> control;Microsoft::WRL::ComPtr<IAudioSessionControl2> session;Microsoft::WRL::ComPtr<IAudioMeterInformation> meter;if(FAILED(sessions->GetSession(i,&control))||FAILED(control.As(&session)))continue;DWORD actual=0;if(FAILED(session->GetProcessId(&actual))||actual!=pid||FAILED(control.As(&meter)))continue;float value=0;if(SUCCEEDED(meter->GetPeakValue(&value)))result=std::max(result,value);}
    return result;
  }
  bool audible(uint32_t pid,const std::string &output,bool descendants=true) {
    std::map<DWORD,DWORD> parents;
    if(descendants){HANDLE snapshot=CreateToolhelp32Snapshot(TH32CS_SNAPPROCESS,0);if(snapshot==INVALID_HANDLE_VALUE)throw std::runtime_error("Application audio routing could not be verified");PROCESSENTRY32 entry{};entry.dwSize=sizeof(entry);if(Process32First(snapshot,&entry))do{parents[entry.th32ProcessID]=entry.th32ParentProcessID;}while(Process32Next(snapshot,&entry));CloseHandle(snapshot);}
    Microsoft::WRL::ComPtr<IAudioSessionManager2> manager;auto endpoint=device(output);
    if(FAILED(endpoint->Activate(__uuidof(IAudioSessionManager2),CLSCTX_ALL,nullptr,reinterpret_cast<void**>(manager.GetAddressOf()))))throw std::runtime_error("Application audio routing could not be verified");
    Microsoft::WRL::ComPtr<IAudioSessionEnumerator> sessions;if(FAILED(manager->GetSessionEnumerator(&sessions)))throw std::runtime_error("Application audio routing could not be verified");int count=0;if(FAILED(sessions->GetCount(&count)))throw std::runtime_error("Application audio routing could not be verified");
    for(int i=0;i<count;i++){Microsoft::WRL::ComPtr<IAudioSessionControl> control;Microsoft::WRL::ComPtr<IAudioSessionControl2> session;if(FAILED(sessions->GetSession(i,&control))||FAILED(control.As(&session)))continue;DWORD actual=0;AudioSessionState state=AudioSessionStateInactive;if(FAILED(session->GetProcessId(&actual))||FAILED(session->GetState(&state))||state!=AudioSessionStateActive)continue;for(int depth=0;actual&&depth<128;depth++){if(actual==pid)return true;if(!descendants)break;auto found=parents.find(actual);if(found==parents.end()||found->second==actual)break;actual=found->second;}}
    return false;
  }
};
/**
 * Hears from Windows when Desktop audio's sources may have changed: a session starts, stops or
 * goes away, an output comes or goes, or the default output changes. Windows calls it on its own
 * threads, so it only sets flags and wakes the waiting thread, and it owns everything it touches.
 * Volume and property changes fire often and never change who is captured, so they're ignored.
 */
class AudioChanges final : public IMMNotificationClient, public IAudioSessionNotification, public IAudioSessionEvents {
public:
  struct Pending { bool sessions = false; bool outputs = false; };
  /** Waits up to `timeout` for a change, and returns and clears what changed. */
  Pending wait(std::chrono::milliseconds timeout) {
    std::unique_lock<std::mutex> lock(mutex);
    woken.wait_for(lock, timeout, [&] { return pending.sessions || pending.outputs || stopping; });
    const Pending result = pending;
    pending = {};
    return result;
  }
  /** Ends a wait at once, for shutting down. */
  void stop() {
    { std::lock_guard<std::mutex> lock(mutex); stopping = true; }
    woken.notify_all();
  }
  ULONG STDMETHODCALLTYPE AddRef() override { return ++references; }
  ULONG STDMETHODCALLTYPE Release() override {
    const ULONG left = --references;
    if (!left) delete this;
    return left;
  }
  HRESULT STDMETHODCALLTYPE QueryInterface(REFIID id, void **out) override {
    if (!out) return E_POINTER;
    if (id == __uuidof(IUnknown) || id == __uuidof(IMMNotificationClient)) *out = static_cast<IMMNotificationClient *>(this);
    else if (id == __uuidof(IAudioSessionNotification)) *out = static_cast<IAudioSessionNotification *>(this);
    else if (id == __uuidof(IAudioSessionEvents)) *out = static_cast<IAudioSessionEvents *>(this);
    else { *out = nullptr; return E_NOINTERFACE; }
    AddRef();
    return S_OK;
  }
  // Outputs.
  HRESULT STDMETHODCALLTYPE OnDeviceStateChanged(LPCWSTR, DWORD) override { return mark(false, true); }
  HRESULT STDMETHODCALLTYPE OnDeviceAdded(LPCWSTR) override { return mark(false, true); }
  HRESULT STDMETHODCALLTYPE OnDeviceRemoved(LPCWSTR) override { return mark(false, true); }
  HRESULT STDMETHODCALLTYPE OnDefaultDeviceChanged(EDataFlow flow, ERole role, LPCWSTR) override {
    return flow == eRender && role == eConsole ? mark(false, true) : S_OK;
  }
  HRESULT STDMETHODCALLTYPE OnPropertyValueChanged(LPCWSTR, const PROPERTYKEY) override { return S_OK; }
  // A new session on the watched output.
  HRESULT STDMETHODCALLTYPE OnSessionCreated(IAudioSessionControl *) override { return mark(true, false); }
  // One watched session.
  HRESULT STDMETHODCALLTYPE OnStateChanged(AudioSessionState) override { return mark(true, false); }
  HRESULT STDMETHODCALLTYPE OnSessionDisconnected(AudioSessionDisconnectReason) override { return mark(true, false); }
  HRESULT STDMETHODCALLTYPE OnDisplayNameChanged(LPCWSTR, LPCGUID) override { return S_OK; }
  HRESULT STDMETHODCALLTYPE OnIconPathChanged(LPCWSTR, LPCGUID) override { return S_OK; }
  HRESULT STDMETHODCALLTYPE OnSimpleVolumeChanged(float, BOOL, LPCGUID) override { return S_OK; }
  HRESULT STDMETHODCALLTYPE OnChannelVolumeChanged(DWORD, float[], DWORD, LPCGUID) override { return S_OK; }
  HRESULT STDMETHODCALLTYPE OnGroupingParamChanged(LPCGUID, LPCGUID) override { return S_OK; }
private:
  ~AudioChanges() = default;
  HRESULT mark(bool sessions, bool outputs) {
    {
      std::lock_guard<std::mutex> lock(mutex);
      pending.sessions = pending.sessions || sessions;
      pending.outputs = pending.outputs || outputs;
    }
    woken.notify_all();
    return S_OK;
  }
  std::atomic<ULONG> references{1};
  std::mutex mutex;
  std::condition_variable woken;
  Pending pending;
  bool stopping = false;
};

/**
 * One output's sessions through a session manager that's kept, with every listed session's state
 * changes reported to `events`. Sessions are watched once each, by their instance id, so listing
 * again only registers the new ones.
 */
class SessionWatch {
public:
  using Session = ListenRouting::Session;
  SessionWatch() = default;
  SessionWatch(const SessionWatch &) = delete;
  SessionWatch &operator=(const SessionWatch &) = delete;
  ~SessionWatch() { stop(); }
  void start(IMMDevice *endpoint, AudioChanges *changes) {
    stop();
    if (FAILED(endpoint->Activate(__uuidof(IAudioSessionManager2), CLSCTX_ALL, nullptr, reinterpret_cast<void **>(manager.GetAddressOf()))))
      throw std::runtime_error("Desktop audio sessions could not be enumerated");
    listener = changes;
    if (FAILED(manager->RegisterSessionNotification(listener.Get()))) {
      manager.Reset();
      listener.Reset();
      throw std::runtime_error("Desktop audio sessions could not be followed");
    }
  }
  void stop() {
    for (auto &[id, control] : watched) control->UnregisterAudioSessionNotification(listener.Get());
    watched.clear();
    if (manager && listener) manager->UnregisterSessionNotification(listener.Get());
    manager.Reset();
    listener.Reset();
  }
  bool started() const { return !!manager; }
  /** Every live session, as ListenRouting::sessions lists them. Windows only reports new sessions after a listing. */
  std::vector<Session> list() {
    Microsoft::WRL::ComPtr<IAudioSessionEnumerator> enumerated;
    int count = 0;
    if (!manager || FAILED(manager->GetSessionEnumerator(&enumerated)) || FAILED(enumerated->GetCount(&count)))
      throw std::runtime_error("Desktop audio sessions could not be read");
    std::vector<Session> listed;
    std::map<std::wstring, Microsoft::WRL::ComPtr<IAudioSessionControl>> seen;
    for (int index = 0; index < count; ++index) {
      Microsoft::WRL::ComPtr<IAudioSessionControl> control;
      Microsoft::WRL::ComPtr<IAudioSessionControl2> session;
      DWORD pid = 0;
      AudioSessionState state = AudioSessionStateExpired;
      if (FAILED(enumerated->GetSession(index, &control)) || FAILED(control.As(&session)) ||
          FAILED(session->GetProcessId(&pid)) || FAILED(session->GetState(&state)))
        throw std::runtime_error("A desktop audio session could not be identified");
      if (!pid || state == AudioSessionStateExpired) continue;
      listed.push_back({pid, state});
      LPWSTR raw = nullptr;
      if (FAILED(session->GetSessionInstanceIdentifier(&raw)) || !raw) continue;
      std::wstring id(raw);
      CoTaskMemFree(raw);
      auto known = watched.find(id);
      if (known != watched.end()) {
        seen.emplace(id, known->second);
        watched.erase(known);
      } else if (SUCCEEDED(control->RegisterAudioSessionNotification(listener.Get()))) seen.emplace(id, control);
    }
    // Whatever is left has ended.
    for (auto &[id, control] : watched) control->UnregisterAudioSessionNotification(listener.Get());
    watched = std::move(seen);
    return listed;
  }
private:
  Microsoft::WRL::ComPtr<IAudioSessionManager2> manager;
  Microsoft::WRL::ComPtr<AudioChanges> listener;
  std::map<std::wstring, Microsoft::WRL::ComPtr<IAudioSessionControl>> watched;
};
}
