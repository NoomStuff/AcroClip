#include "../windows/capture-window.hpp"
#include "isolation.h"
#include <cassert>
int main() {
  if (!acroclip_fixture_isolated()) return 2;
  const auto normal = CreateWindowExW(WS_EX_APPWINDOW, L"STATIC", L"AcroClip normal fixture", WS_OVERLAPPEDWINDOW | WS_VISIBLE, 100, 100, 640, 360, nullptr, nullptr, GetModuleHandleW(nullptr), nullptr);
  assert(normal); assert(acroclip::windows::userCaptureWindow(normal));
  ShowWindow(normal, SW_MINIMIZE); assert(acroclip::windows::userCaptureWindow(normal)); ShowWindow(normal, SW_RESTORE);
  ShowWindow(normal, SW_HIDE); assert(!acroclip::windows::userCaptureWindow(normal)); ShowWindow(normal, SW_SHOW);
  assert(SetWindowDisplayAffinity(normal, WDA_EXCLUDEFROMCAPTURE)); assert(!acroclip::windows::userCaptureWindow(normal)); SetWindowDisplayAffinity(normal, WDA_NONE);
  const auto tool = CreateWindowExW(WS_EX_TOOLWINDOW, L"STATIC", L"AcroClip helper fixture", WS_POPUP | WS_VISIBLE, 0, 0, 50, 50, nullptr, nullptr, GetModuleHandleW(nullptr), nullptr);
  assert(tool); assert(!acroclip::windows::userCaptureWindow(tool));
  const auto empty = CreateWindowExW(0, L"STATIC", L"AcroClip empty fixture", WS_POPUP | WS_VISIBLE, 0, 0, 0, 0, nullptr, nullptr, GetModuleHandleW(nullptr), nullptr);
  assert(empty); assert(!acroclip::windows::userCaptureWindow(empty));
  DestroyWindow(empty); DestroyWindow(tool); DestroyWindow(normal);
}
