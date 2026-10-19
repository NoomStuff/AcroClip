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
#include <map>
#include <stdexcept>
namespace acroclip::windows {
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
    if(id == "default")result=enumerator->GetDefaultAudioEndpoint(flow,eConsole,&value);
    else {int count=MultiByteToWideChar(CP_UTF8,MB_ERR_INVALID_CHARS,id.c_str(),-1,nullptr,0);std::wstring wide(size_t(count>0?count:1),L'\0');if(count>0)MultiByteToWideChar(CP_UTF8,MB_ERR_INVALID_CHARS,id.c_str(),-1,wide.data(),count);result=count>0?enumerator->GetDevice(wide.c_str(),&value):E_INVALIDARG;}
    DWORD state=0;
    if(FAILED(result)||FAILED(value->GetState(&state))||state!=DEVICE_STATE_ACTIVE)throw std::runtime_error("The listening output is unavailable");
    return value;
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
}
