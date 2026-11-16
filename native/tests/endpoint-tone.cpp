// Test fixture for the default-output check. It plays a tone pinned to one
// output, which never follows a default change the way many games don't, and
// switches the default output the way the Sound settings do.
//
//   acroclip-endpoint-tone list
//   acroclip-endpoint-tone play <endpoint id> <frequency>
//   acroclip-endpoint-tone default <endpoint id>
#include <windows.h>
#include <mmdeviceapi.h>
#include <audioclient.h>
#include <ksmedia.h>
#include <wrl/client.h>
#include <cmath>
#include <cstdint>
#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <iostream>
#include <string>

using Microsoft::WRL::ComPtr;

namespace {
// Undocumented, but it's what the Sound settings call, and it has been stable since Windows 7.
struct DECLSPEC_UUID("f8679f50-850a-41cf-9c72-430f290290c8") IPolicyConfig : IUnknown {
  virtual HRESULT STDMETHODCALLTYPE GetMixFormat(PCWSTR, WAVEFORMATEX **) = 0;
  virtual HRESULT STDMETHODCALLTYPE GetDeviceFormat(PCWSTR, INT, WAVEFORMATEX **) = 0;
  virtual HRESULT STDMETHODCALLTYPE ResetDeviceFormat(PCWSTR) = 0;
  virtual HRESULT STDMETHODCALLTYPE SetDeviceFormat(PCWSTR, WAVEFORMATEX *, WAVEFORMATEX *) = 0;
  virtual HRESULT STDMETHODCALLTYPE GetProcessingPeriod(PCWSTR, INT, PINT64, PINT64) = 0;
  virtual HRESULT STDMETHODCALLTYPE SetProcessingPeriod(PCWSTR, PINT64) = 0;
  virtual HRESULT STDMETHODCALLTYPE GetShareMode(PCWSTR, void *) = 0;
  virtual HRESULT STDMETHODCALLTYPE SetShareMode(PCWSTR, void *) = 0;
  virtual HRESULT STDMETHODCALLTYPE GetPropertyValue(PCWSTR, const PROPERTYKEY &, PROPVARIANT *) = 0;
  virtual HRESULT STDMETHODCALLTYPE SetPropertyValue(PCWSTR, const PROPERTYKEY &, PROPVARIANT *) = 0;
  virtual HRESULT STDMETHODCALLTYPE SetDefaultEndpoint(PCWSTR, ERole) = 0;
  virtual HRESULT STDMETHODCALLTYPE SetEndpointVisibility(PCWSTR, INT) = 0;
};
const CLSID policyConfigClient = {0x870af99c, 0x171d, 0x4f9e, {0xaf, 0x0d, 0xe6, 0x3d, 0xf4, 0x0c, 0x2b, 0xc9}};

std::wstring wide(const char *value) {
  const int count = MultiByteToWideChar(CP_UTF8, 0, value, -1, nullptr, 0);
  std::wstring result(size_t(count > 0 ? count : 1), L'\0');
  if (count > 0) MultiByteToWideChar(CP_UTF8, 0, value, -1, result.data(), count);
  result.resize(std::wcslen(result.c_str()));
  return result;
}
std::string narrow(const wchar_t *value) {
  const int count = WideCharToMultiByte(CP_UTF8, 0, value, -1, nullptr, 0, nullptr, nullptr);
  std::string result(size_t(count > 0 ? count : 1), '\0');
  if (count > 0) WideCharToMultiByte(CP_UTF8, 0, value, -1, result.data(), count, nullptr, nullptr);
  result.resize(std::strlen(result.c_str()));
  return result;
}
int fail(const char *message, HRESULT result) {
  std::fprintf(stderr, "%s (0x%08lx)\n", message, static_cast<unsigned long>(result));
  return 2;
}

int list(IMMDeviceEnumerator *enumerator) {
  ComPtr<IMMDeviceCollection> devices;
  UINT count = 0;
  HRESULT result = enumerator->EnumAudioEndpoints(eRender, DEVICE_STATE_ACTIVE, &devices);
  if (FAILED(result) || FAILED(result = devices->GetCount(&count))) return fail("Outputs could not be listed", result);
  for (UINT index = 0; index < count; ++index) {
    ComPtr<IMMDevice> device;
    LPWSTR id = nullptr;
    if (FAILED(devices->Item(index, &device)) || FAILED(device->GetId(&id))) continue;
    std::cout << narrow(id) << std::endl;
    CoTaskMemFree(id);
  }
  return 0;
}

int setDefault(const std::wstring &id) {
  ComPtr<IPolicyConfig> policy;
  HRESULT result = CoCreateInstance(policyConfigClient, nullptr, CLSCTX_ALL, __uuidof(IPolicyConfig), reinterpret_cast<void **>(policy.GetAddressOf()));
  if (FAILED(result)) return fail("The default output could not be changed", result);
  for (const ERole role : {eConsole, eMultimedia, eCommunications})
    if (FAILED(result = policy->SetDefaultEndpoint(id.c_str(), role))) return fail("The default output could not be changed", result);
  return 0;
}

int play(IMMDeviceEnumerator *enumerator, const std::wstring &id, double frequency) {
  ComPtr<IMMDevice> device;
  ComPtr<IAudioClient> client;
  ComPtr<IAudioRenderClient> render;
  WAVEFORMATEX *format = nullptr;
  HRESULT result = enumerator->GetDevice(id.c_str(), &device);
  if (FAILED(result)) return fail("The output is unavailable", result);
  if (FAILED(result = device->Activate(__uuidof(IAudioClient), CLSCTX_ALL, nullptr, reinterpret_cast<void **>(client.GetAddressOf()))) ||
      FAILED(result = client->GetMixFormat(&format)))
    return fail("The output could not be opened", result);
  const auto *extensible = reinterpret_cast<const WAVEFORMATEXTENSIBLE *>(format);
  const bool floating = format->wFormatTag == WAVE_FORMAT_IEEE_FLOAT ||
                        (format->wFormatTag == WAVE_FORMAT_EXTENSIBLE && extensible->SubFormat == KSDATAFORMAT_SUBTYPE_IEEE_FLOAT);
  const bool pcm16 = format->wBitsPerSample == 16 &&
                     (format->wFormatTag == WAVE_FORMAT_PCM || (format->wFormatTag == WAVE_FORMAT_EXTENSIBLE && extensible->SubFormat == KSDATAFORMAT_SUBTYPE_PCM));
  if (!(floating && format->wBitsPerSample == 32) && !pcm16) return fail("The output's mix format is unsupported", E_FAIL);
  UINT32 size = 0;
  if (FAILED(result = client->Initialize(AUDCLNT_SHAREMODE_SHARED, 0, 2000000, 0, format, nullptr)) ||
      FAILED(result = client->GetBufferSize(&size)) ||
      FAILED(result = client->GetService(__uuidof(IAudioRenderClient), reinterpret_cast<void **>(render.GetAddressOf()))) ||
      FAILED(result = client->Start()))
    return fail("The tone could not start", result);
  std::cout << "playing" << std::endl;
  const double step = 2 * 3.141592653589793 * frequency / format->nSamplesPerSec;
  double phase = 0;
  for (;;) {
    Sleep(20);
    UINT32 padding = 0;
    BYTE *data = nullptr;
    if (FAILED(result = client->GetCurrentPadding(&padding))) return fail("The tone stopped", result);
    const UINT32 frames = size - padding;
    if (!frames) continue;
    if (FAILED(result = render->GetBuffer(frames, &data))) return fail("The tone stopped", result);
    for (UINT32 frame = 0; frame < frames; ++frame, phase += step) {
      const double sample = 0.05 * std::sin(phase);
      for (WORD channel = 0; channel < format->nChannels; ++channel) {
        const size_t index = size_t(frame) * format->nChannels + channel;
        if (floating) reinterpret_cast<float *>(data)[index] = float(sample);
        else reinterpret_cast<int16_t *>(data)[index] = int16_t(sample * 32767);
      }
    }
    phase = std::fmod(phase, 2 * 3.141592653589793);
    if (FAILED(result = render->ReleaseBuffer(frames, 0))) return fail("The tone stopped", result);
  }
}
}

int main(int argc, char **argv) {
  if (argc < 2) return fail("Choose list, play or default", E_INVALIDARG);
  if (FAILED(CoInitializeEx(nullptr, COINIT_MULTITHREADED))) return fail("COM is unavailable", E_FAIL);
  ComPtr<IMMDeviceEnumerator> enumerator;
  const HRESULT result = CoCreateInstance(__uuidof(MMDeviceEnumerator), nullptr, CLSCTX_ALL, IID_PPV_ARGS(&enumerator));
  if (FAILED(result)) return fail("Audio devices are unavailable", result);
  const std::string action = argv[1];
  if (action == "list") return list(enumerator.Get());
  if (action == "default" && argc == 3) return setDefault(wide(argv[2]));
  if (action == "play" && argc == 4) return play(enumerator.Get(), wide(argv[2]), std::atof(argv[3]));
  return fail("Choose list, play or default", E_INVALIDARG);
}
