#pragma once
#include <windows.h>
#include <dwmapi.h>
namespace acroclip::windows {
inline bool userCaptureWindow(HWND window) {
  if (!IsWindow(window) || !IsWindowVisible(window) ||
      window == GetShellWindow() || window == GetDesktopWindow())
    return false;
  const auto style = GetWindowLongPtrW(window, GWL_EXSTYLE);
  if ((style & (WS_EX_TOOLWINDOW | WS_EX_NOACTIVATE)) &&
      !(style & WS_EX_APPWINDOW))
    return false;
  if (GetWindow(window, GW_OWNER) && !(style & WS_EX_APPWINDOW))
    return false;
  DWORD cloaked = 0, affinity = WDA_NONE;
  if (SUCCEEDED(DwmGetWindowAttribute(window, DWMWA_CLOAKED, &cloaked,
                                    sizeof(cloaked))) && cloaked)
    return false;
  if (GetWindowDisplayAffinity(window, &affinity) && affinity != WDA_NONE)
    return false;
  RECT client{};
  if (!IsIconic(window) &&
      (!GetClientRect(window, &client) || client.right <= client.left ||
       client.bottom <= client.top))
    return false;
  return GetWindowTextLengthW(window) > 0;
}
}
