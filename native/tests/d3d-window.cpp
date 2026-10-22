#include "isolation.h"
// SPDX-License-Identifier: MIT
// Isolated, animated Direct3D surface for verifying real OBS game hooks.
#include <algorithm>
#include <cmath>
#include <cstring>
#include <cstdlib>
#include <d3d11.h>
#include <iostream>
#include <mmsystem.h>
#include <vector>
#include <windows.h>
LRESULT CALLBACK procedure(HWND window, UINT message, WPARAM w, LPARAM l) {
  if(message==WM_GETMINMAXINFO){auto *limits=reinterpret_cast<MINMAXINFO *>(l);limits->ptMaxTrackSize={8192,8192};return 0;}
  if (message == WM_DESTROY) {
    PostQuitMessage(0);
    return 0;
  }
  return DefWindowProcW(window, message, w, l);
}
int main(int argc, char **argv) {
  if (!acroclip_fixture_isolated()) return 2;
  SetProcessDpiAwarenessContext(DPI_AWARENESS_CONTEXT_PER_MONITOR_AWARE_V2);
  HWND originalForeground = GetForegroundWindow();
  bool fullscreenRequested = false;
  bool delayedFullscreen = false;
  for (int i = 1; i < argc; ++i) {
    fullscreenRequested |= std::strcmp(argv[i], "--fullscreen") == 0;
    delayedFullscreen |= std::strcmp(argv[i], "--fullscreen-after") == 0;
  }
  WNDCLASSW klass{};
  klass.lpfnWndProc = procedure;
  klass.hInstance = GetModuleHandleW(nullptr);
  klass.lpszClassName = L"AcroClipIsolatedD3DProof";
  RegisterClassW(&klass);
  const auto dimension=[](const char *key,int fallback){const char *value=std::getenv(key);return value?std::clamp(std::atoi(value),64,3840):fallback;};
  const int frameWidth=dimension("ACROCLIP_FIXTURE_WIDTH",640), frameHeight=dimension("ACROCLIP_FIXTURE_HEIGHT",360);
  RECT client{0,0,frameWidth,frameHeight};
  AdjustWindowRect(&client,WS_OVERLAPPEDWINDOW,FALSE);
  HWND window = CreateWindowW(klass.lpszClassName,
                              L"AcroClip isolated Direct3D capture proof",
                              WS_OVERLAPPEDWINDOW, 80, 80, client.right-client.left, client.bottom-client.top, nullptr,
                              nullptr, klass.hInstance, nullptr);
  if (argc > 1)
    SetWindowTextA(window, argv[1]);
  HWAVEOUT sound = nullptr;
  WAVEHDR header{};
  std::vector<int16_t> tone;
  if (argc > 2) {
    int frequency = atoi(argv[2]);
    tone.resize(48000 * 2);
    for (size_t index = 0; index < tone.size() / 2; index++)
      tone[index * 2] = tone[index * 2 + 1] =
          int16_t(1000 * std::sin(2 * 3.141592653589793 * frequency *
                                  double(index) / 48000));
    WAVEFORMATEX format{WAVE_FORMAT_PCM, 2, 48000, 192000, 4, 16, 0};
    if (waveOutOpen(&sound, WAVE_MAPPER, &format, 0, 0, CALLBACK_NULL) !=
        MMSYSERR_NOERROR)
      return 3;
    header.lpData = reinterpret_cast<LPSTR>(tone.data());
    header.dwBufferLength = DWORD(tone.size() * sizeof(int16_t));
    header.dwFlags = WHDR_BEGINLOOP | WHDR_ENDLOOP;
    header.dwLoops = std::getenv("ACROCLIP_FIXTURE_LONG") ? 600 : 120;
    if (waveOutPrepareHeader(sound, &header, sizeof(header)) !=
            MMSYSERR_NOERROR ||
        waveOutWrite(sound, &header, sizeof(header)) != MMSYSERR_NOERROR)
      return 4;
  }
  DXGI_SWAP_CHAIN_DESC desc{};
  desc.BufferCount = 2;
  desc.BufferDesc.Width = frameWidth;
  desc.BufferDesc.Height = frameHeight;
  desc.BufferDesc.Format = DXGI_FORMAT_R8G8B8A8_UNORM;
  desc.BufferUsage = DXGI_USAGE_RENDER_TARGET_OUTPUT;
  desc.OutputWindow = window;
  desc.SampleDesc.Count = 1;
  desc.Windowed = TRUE;
  desc.SwapEffect = DXGI_SWAP_EFFECT_DISCARD;
  IDXGISwapChain *swap = nullptr;
  ID3D11Device *device = nullptr;
  ID3D11DeviceContext *context = nullptr;
  if (FAILED(D3D11CreateDeviceAndSwapChain(
          nullptr, D3D_DRIVER_TYPE_HARDWARE, nullptr, 0, nullptr, 0,
          D3D11_SDK_VERSION, &desc, &swap, &device, nullptr, &context)))
    return 1;
  ID3D11Texture2D *buffer = nullptr;
  ID3D11RenderTargetView *view = nullptr;
  if (FAILED(swap->GetBuffer(0, __uuidof(ID3D11Texture2D),
                             reinterpret_cast<void **>(&buffer))) ||
      FAILED(device->CreateRenderTargetView(buffer, nullptr, &view)))
    return 2;
  buffer->Release();
  ShowWindow(window, SW_SHOW);
  auto enterFullscreen = [&]() {
    HMONITOR monitor = MonitorFromWindow(window, MONITOR_DEFAULTTONEAREST);
    MONITORINFO info{};
    info.cbSize = sizeof(info);
    if (!GetMonitorInfo(monitor, &info))
      return false;
    SetWindowLongPtr(window, GWL_STYLE, WS_POPUP);
    SetWindowPos(window, HWND_TOP, info.rcMonitor.left, info.rcMonitor.top,
                 info.rcMonitor.right - info.rcMonitor.left,
                 info.rcMonitor.bottom - info.rcMonitor.top,
                 SWP_FRAMECHANGED | SWP_SHOWWINDOW);
    DWORD foregroundThread =
        GetWindowThreadProcessId(GetForegroundWindow(), nullptr);
    AttachThreadInput(GetCurrentThreadId(), foregroundThread, TRUE);
    SetForegroundWindow(window);
    AttachThreadInput(GetCurrentThreadId(), foregroundThread, FALSE);
    if (GetForegroundWindow() != window ||
        FAILED(swap->SetFullscreenState(TRUE, nullptr)))
      return false;
    BOOL fullscreen = FALSE;
    if (FAILED(swap->GetFullscreenState(&fullscreen, nullptr)) || !fullscreen)
      return false;
    std::cerr << "fullscreen:" << info.rcMonitor.left << ":"
              << info.rcMonitor.top << ":"
              << info.rcMonitor.right - info.rcMonitor.left << ":"
              << info.rcMonitor.bottom - info.rcMonitor.top << std::endl;
    return true;
  };
  if (fullscreenRequested && !enterFullscreen())
    return 8;
  std::cout << reinterpret_cast<uintptr_t>(window) << std::endl;
  MSG message{};
  uint64_t frame = 0;
  const ULONGLONG started = GetTickCount64();
  while (message.message != WM_QUIT &&
         (!(fullscreenRequested || delayedFullscreen) ||
          GetTickCount64() - started < (std::getenv("ACROCLIP_FIXTURE_LONG") ? 360000u : 45000u))) {
    if (delayedFullscreen && !fullscreenRequested) {
      DWORD available = 0;
      HANDLE input = GetStdHandle(STD_INPUT_HANDLE);
      if (PeekNamedPipe(input, nullptr, 0, nullptr, &available, nullptr) &&
          available) {
        char command[64];
        DWORD read = 0;
        if (ReadFile(input, command, sizeof(command), &read, nullptr) && read) {
          fullscreenRequested = true;
          if (!enterFullscreen())
            break;
        }
      }
    }
    while (PeekMessageW(&message, nullptr, 0, 0, PM_REMOVE)) {
      TranslateMessage(&message);
      DispatchMessageW(&message);
    }
    float color[] = {0.1f, float(0.25 + 0.2 * std::sin(double(frame++) / 40.)),
                     0.8f, 1.f};
    context->ClearRenderTargetView(view, color);
    swap->Present(1, 0);
  }
  if (fullscreenRequested) {
    swap->SetFullscreenState(FALSE, nullptr);
    SetForegroundWindow(originalForeground);
  }
  view->Release();
  context->Release();
  device->Release();
  swap->Release();
  if (sound) {
    waveOutReset(sound);
    waveOutUnprepareHeader(sound, &header, sizeof(header));
    waveOutClose(sound);
  }
  return 0;
}
