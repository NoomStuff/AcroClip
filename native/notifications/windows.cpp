#include <windows.h>
#include <objidl.h>
#include <mmsystem.h>
#include <wincrypt.h>
#include <memory>
#include <vector>
#include <psapi.h>
#include <algorithm>
using std::min;
using std::max;
#include <gdiplus.h>
#include <cmath>
#include <iostream>
#include <string>
#include <thread>
#include <json.hpp>

using json = nlohmann::json;
using namespace Gdiplus;
namespace {
constexpr UINT noticeMessage = WM_APP + 1;
constexpr UINT closeMessage = WM_APP + 2;
constexpr UINT metricsMessage = WM_APP + 3;
HWND window = nullptr;
std::wstring text, detail, previousText, previousDetail;
std::string artworkData, recordingStatus;
std::string messageID;
bool previousError = false, textTransition = false;
ULONGLONG textChangedAt = 0, confirmedAt = 0, returningAt = 0, spinningAt = 0, refreshedAt = 0, recordPulseAt = 0;
float textFromOpacity = 1, imageFromScale = 1, refreshFrom = 0;
float currentBackground = 0, currentContent = 0, returnBackground = 0, returnContent = 0;
std::unique_ptr<Bitmap> artwork, thumbnailLayer;
float cachedImageScale = -1, cachedFlash = -1;
int cachedSampling = 0;
IStream *artworkStream = nullptr;
ULONGLONG entered = 0;
bool completing = false, renderOnly = false, shownReported = false;
HWND foregroundAtNotice = nullptr;
bool error = false, saving = false, animate = true;
ULONGLONG started = 0;
int lifetime = 2400;
float scale = 1;
RECT area{};
std::wstring proofPath;

ULONGLONG proofClock = 0;
ULONGLONG animationTime() {
  return renderOnly && proofClock ? proofClock : GetTickCount64();
}

std::wstring wide(const std::string &value) {
  int size = MultiByteToWideChar(CP_UTF8, MB_ERR_INVALID_CHARS, value.data(),
                               int(value.size()), nullptr, 0);
  if (!size) return L"AcroClip needs attention";
  std::wstring result(size, L'\0');
  MultiByteToWideChar(CP_UTF8, MB_ERR_INVALID_CHARS, value.data(),
                      int(value.size()), result.data(), size);
  return result;
}

double smooth(double value) {
  value = max(0., min(1., value));
  return value * value * (3 - 2 * value);
}
float confirmationScale(ULONGLONG now) {
  if (!completing || !animate) return 1;
  const double age = double(now - confirmedAt);
  if (age < 55.) return imageFromScale + (.9f - imageFromScale) * float(1 - pow(1 - age / 55., 3));
  if (age < 170.) return .9f + .125f * float(smooth((age - 55.) / 115.));
  if (age < 340.) return 1.025f - .025f * float(smooth((age - 170.) / 170.));
  return 1;
}
struct TextFrame {
  std::wstring title, subtitle;
  bool failure;
  float opacity = 1, offset = 0;
};
TextFrame textFrame(ULONGLONG now) {
  if (!textTransition || !animate) return {text, detail, error};
  const double age = double(now - textChangedAt);
  if (age < 65.) {
    const float progress = float(smooth(age / 65.));
    return {previousText, previousDetail, previousError, textFromOpacity * (1 - progress), -2 * progress};
  }
  const float progress = float(smooth((age - 65.) / 115.));
  return {text, detail, error, progress, 3 * (1 - progress)};
}
void changeText(const std::wstring &title, const std::wstring &subtitle, bool failure, bool visible, ULONGLONG now) {
  if (visible && (title != text || subtitle != detail || failure != error)) {
    // Retarget a pending change rather than queuing flashes for every update.
    if (!textTransition || now - textChangedAt >= 65) {
      const auto current = textFrame(now);
      previousText = current.title; previousDetail = current.subtitle; previousError = current.failure;
      textFromOpacity = current.opacity; textChangedAt = now; textTransition = true;
    }
  } else if (!visible) textTransition = false;
  text = title; detail = subtitle;
}

void rounded(GraphicsPath &path, float x, float y, float w, float h, float r) {
  path.AddArc(x, y, r * 2, r * 2, 180, 90);
  path.AddArc(x + w - r * 2, y, r * 2, r * 2, 270, 90);
  path.AddArc(x + w - r * 2, y + h - r * 2, r * 2, r * 2, 0, 90);
  path.AddArc(x, y + h - r * 2, r * 2, r * 2, 90, 90);
  path.CloseFigure();
}
void loadArtwork(const std::string &data) {
  if (data == artworkData) return;
  artworkData = data;
  artwork.reset(); thumbnailLayer.reset();
  if (artworkStream) { artworkStream->Release(); artworkStream = nullptr; }
  auto comma = data.find(',');
  if (data.rfind("data:image/", 0) != 0 || comma == std::string::npos) return;
  const auto base64 = data.substr(comma + 1);
  DWORD size = 0;
  if (!CryptStringToBinaryA(base64.c_str(), DWORD(base64.size()), CRYPT_STRING_BASE64, nullptr, &size, nullptr, nullptr) || size > 1024 * 1024) return;
  HGLOBAL memory = GlobalAlloc(GMEM_MOVEABLE, size);
  if (!memory) return;
  auto bytes = static_cast<BYTE *>(GlobalLock(memory));
  const bool decoded = bytes && CryptStringToBinaryA(base64.c_str(), DWORD(base64.size()), CRYPT_STRING_BASE64, bytes, &size, nullptr, nullptr);
  if (bytes) GlobalUnlock(memory);
  if (!decoded || CreateStreamOnHGlobal(memory, TRUE, &artworkStream) != S_OK) { GlobalFree(memory); return; }
  auto image = std::unique_ptr<Bitmap>(Bitmap::FromStream(artworkStream));
  if (image && image->GetLastStatus() == Ok && image->GetWidth() <= 2048 && image->GetHeight() <= 2048) artwork = std::move(image);
}

void drawRecordingStatus(Graphics &g) {
  if (recordPulseAt && animate && recordingStatus == "recording") {
    const float progress = min(1.f, float(animationTime() - recordPulseAt) / 460.f);
    const float radius = 12 + 22 * (1 - pow(1 - progress, 3));
    const float opacity = (1 - progress) * (1 - progress);
    SolidBrush wash(Color(BYTE(22 * opacity), 177, 151, 252));
    Pen ripple(Color(BYTE(140 * opacity), 177, 151, 252), 2.5f);
    g.FillEllipse(&wash, 52 - radius, 52 - radius, radius * 2, radius * 2);
    g.DrawEllipse(&ripple, 52 - radius, 52 - radius, radius * 2, radius * 2);
  }
  const bool failed = recordingStatus == "error", active = recordingStatus == "recording", pending = recordingStatus == "starting";
  const Color color = failed ? Color(255, 250, 137, 137) : active ? Color(255, 244, 95, 117) : pending ? Color(255, 177, 151, 252) : Color(255, 162, 159, 169);
  Pen track(Color(60, color.GetR(), color.GetG(), color.GetB()), 2.5f);
  g.DrawEllipse(&track, 30.f, 30.f, 44.f, 44.f);
  if (pending) {
    Pen arc(color, 2.5f); arc.SetStartCap(LineCapRound); arc.SetEndCap(LineCapRound);
    const float angle = animate ? float(animationTime() - spinningAt) * .28f - 90 : -90;
    g.DrawArc(&arc, 30.f, 30.f, 44.f, 44.f, angle, 250.f);
    SolidBrush dot(color); g.FillEllipse(&dot, 47.f, 47.f, 10.f, 10.f);
  } else if (failed) {
    Pen mark(color, 3); mark.SetStartCap(LineCapRound); mark.SetEndCap(LineCapRound);
    g.DrawLine(&mark, 52.f, 41.f, 52.f, 54.f);
    SolidBrush dot(color); g.FillEllipse(&dot, 50.5f, 60.f, 3.f, 3.f);
  } else if (active) {
    SolidBrush dot(color); g.FillEllipse(&dot, 41.f, 41.f, 22.f, 22.f);
  } else if (recordingStatus == "paused") {
    GraphicsPath bars; rounded(bars, 43, 43, 7, 18, 2.5f); rounded(bars, 54, 43, 7, 18, 2.5f);
    SolidBrush ink(color); g.FillPath(&ink, &bars);
  } else {
    GraphicsPath stop; rounded(stop, 43, 43, 18, 18, 4);
    SolidBrush ink(color); g.FillPath(&ink, &stop);
  }
}

void drawThumbnail(Graphics &target, float imageScale, float flash) {
  const int sampling = int(std::ceil(scale * 4));
  const int size = 72 * sampling;
  if (!thumbnailLayer || cachedImageScale != imageScale || cachedFlash != flash || cachedSampling != sampling) {
    thumbnailLayer = std::make_unique<Bitmap>(size, size, PixelFormat32bppPARGB);
    Graphics image(thumbnailLayer.get());
    image.Clear(Color(0, 0, 0, 0));
    image.SetSmoothingMode(SmoothingModeAntiAlias);
    image.SetPixelOffsetMode(PixelOffsetModeHalf);
    image.SetInterpolationMode(InterpolationModeHighQualityBicubic);
    // An even integer span preserves the center through rasterization. The
    // fixed supersampled layer keeps these subpixel size steps off the screen.
    const int side = int(std::round(32 * imageScale * sampling)) * 2;
    const int inset = (size - side) / 2;
    GraphicsPath tile;
    rounded(tile, float(inset), float(inset), float(side), float(side), 15 * imageScale * sampling);
    SolidBrush background(Color(255, 40, 37, 47));
    image.FillPath(&background, &tile);
    image.SetClip(&tile);
    if (artwork) {
      const float sourceSide = float(min(artwork->GetWidth(), artwork->GetHeight()));
      ImageAttributes edges; edges.SetWrapMode(WrapModeTileFlipXY);
      image.DrawImage(artwork.get(), Rect(inset, inset, side, side),
                      (artwork->GetWidth() - sourceSide) / 2, (artwork->GetHeight() - sourceSide) / 2,
                      sourceSide, sourceSide, UnitPixel, &edges);
    }
    if (flash > 0) {
      SolidBrush white(Color(BYTE(255 * flash), 255, 255, 255));
      image.FillPath(&white, &tile);
    }
    cachedImageScale = imageScale; cachedFlash = flash; cachedSampling = sampling;
  }
  const auto saved = target.Save();
  target.SetInterpolationMode(InterpolationModeHighQualityBicubic);
  ImageAttributes edges; edges.SetWrapMode(WrapModeTileFlipXY);
  target.DrawImage(thumbnailLayer.get(), RectF(16, 16, 72, 72), 0.f, 0.f, float(size), float(size), UnitPixel, &edges);
  target.Restore(saved);
}

void paint() {
  const int width = int(420 * scale), height = int(128 * scale);
  BITMAPINFO info{};
  info.bmiHeader.biSize = sizeof(BITMAPINFOHEADER);
  info.bmiHeader.biWidth = width;
  info.bmiHeader.biHeight = -height;
  info.bmiHeader.biPlanes = 1;
  info.bmiHeader.biBitCount = 32;
  void *pixels = nullptr;
  HDC dc = CreateCompatibleDC(nullptr);
  HBITMAP dib = CreateDIBSection(dc, &info, DIB_RGB_COLORS, &pixels, nullptr, 0);
  if (!dib || !pixels) { if (dib) DeleteObject(dib); DeleteDC(dc); return; }
  auto previous = SelectObject(dc, dib);
  const double age = double(animationTime() - started);
  const double entryAge = double(animationTime() - entered);
  const double leave = animate && !saving ? max(0., min(1., (age - lifetime + 260.) / 260.)) : 0.;
  const double progress = max(0., min(1., entryAge / 280.));
  const double remaining = 1 - progress;
  // A quick reveal with a small overshoot, followed by a damped content settle.
  const double backgroundRest = 1.6 * pow(remaining, 3) - .6 * pow(remaining, 2);
  const double seconds = entryAge / 1000.;
  const double contentRest = entryAge >= 480. ? 0. : exp(-14 * seconds) * (cos(18 * seconds) + (14. / 18.) * sin(18 * seconds));
  const double returnRest = returningAt ? 1 - smooth(double(animationTime() - returningAt) / 160.) : 0.;
  const float backgroundOffset = animate ? float(408 * backgroundRest + 408 * leave * leave * leave + returnBackground * returnRest) : 0.f;
  double contentEntrance = 96 * contentRest;
  if (refreshedAt) {
    const double refreshAge = double(animationTime() - refreshedAt);
    if (refreshAge < 60.) contentEntrance = refreshFrom + (64 - refreshFrom) * smooth(refreshAge / 60.);
    else {
      const double rest = 1 - max(0., min(1., (refreshAge - 60.) / 280.));
      contentEntrance = 64 * (1.6 * pow(rest, 3) - .6 * pow(rest, 2));
    }
  }
  const float contentOffset = animate ? float(contentEntrance + 96 * leave * leave * leave + returnContent * returnRest) : 0.f;
  currentBackground = backgroundOffset; currentContent = contentOffset;
  {
    Bitmap bitmap(width, height, width * 4, PixelFormat32bppPARGB,
                  static_cast<BYTE *>(pixels));
    Graphics g(&bitmap);
    g.Clear(Color(0, 0, 0, 0));
    g.ScaleTransform(scale, scale);
    g.TranslateTransform(12, 12);
    g.SetSmoothingMode(SmoothingModeAntiAlias);
    g.SetTextRenderingHint(TextRenderingHintAntiAlias);
    g.SetPixelOffsetMode(PixelOffsetModeHalf);
    GraphicsPath shape;
    // Rounded on the exposed left edge, square where it meets the display edge.
    shape.AddArc(8, 8, 40, 40, 180, 90);
    shape.AddLine(28, 8, 408, 8);
    shape.AddLine(408, 8, 408, 96);
    shape.AddLine(408, 96, 28, 96);
    shape.AddArc(8, 56, 40, 40, 90, 90);
    shape.CloseFigure();
    Matrix backgroundMotion;
    backgroundMotion.Translate(backgroundOffset, 0);
    shape.Transform(&backgroundMotion);
    GraphicsPath shadow;
    // The shadow follows the moving card, without an outline.
    shadow.AddPath(&shape, FALSE);
    Matrix shadowOffset; shadowOffset.Translate(0, 3); shadow.Transform(&shadowOffset);
    for (int spread = 24; spread >= 4; spread -= 4) {
      Pen softness(Color(8, 0, 0, 0), float(spread));
      softness.SetLineJoin(LineJoinRound);
      g.DrawPath(&softness, &shadow);
    }
    SolidBrush background(Color(255, 17, 17, 19));
    g.FillPath(&background, &shape);
    g.SetClip(&shape);
    g.TranslateTransform(contentOffset, 0);
    const Color accent = error ? Color(255, 250, 137, 137) : Color(255, 177, 151, 252);
    if (!recordingStatus.empty()) drawRecordingStatus(g);
    else {
      const double confirmationAge = double(animationTime() - confirmedAt);
      const bool confirming = completing && animate && confirmationAge < 420.;
      const float imageScale = confirmationScale(animationTime());
      float flash = 0;
      if (confirming) {
        flash = confirmationAge < 35. ? .22f * float(confirmationAge / 35.) : .22f * float(exp(-(confirmationAge - 35.) / 65.));
        const float pulse = min(1.f, float(confirmationAge / 420.));
        const float expansion = 14 * (1 - pow(1 - pulse, 3));
        GraphicsPath wave;
        rounded(wave, 20 - expansion, 20 - expansion, 64 + 2 * expansion, 64 + 2 * expansion, 15 + expansion);
        const float opacity = (1 - pulse) * (1 - pulse);
        SolidBrush wash(Color(BYTE(24 * opacity), 177, 151, 252));
        Pen ripple(Color(BYTE(110 * opacity), 177, 151, 252), 2);
        g.FillPath(&wash, &wave); g.DrawPath(&ripple, &wave);
      }
      drawThumbnail(g, imageScale, flash);
      GraphicsPath tile;
      rounded(tile, 20, 20, 64, 64, 15);
      Pen pen(accent, 3.5f);
      pen.SetStartCap(LineCapRound); pen.SetEndCap(LineCapRound);
      if (saving) {
        SolidBrush dim(Color(125, 17, 17, 19));
        g.FillPath(&dim, &tile);
        Pen track(Color(85, 235, 228, 255), 3.5f);
        g.DrawEllipse(&track, 31.f, 31.f, 42.f, 42.f);
        float angle = animate ? float(animationTime() - spinningAt) * .28f - 90.f : -90.f;
        g.DrawArc(&pen, 31.f, 31.f, 42.f, 42.f, angle, 265.f);
      } else if (error) {
        SolidBrush badge(Color(255, 28, 26, 33));
        g.FillEllipse(&badge, 61.f, 61.f, 25.f, 25.f);
        Pen status(accent, 2.3f);
        status.SetStartCap(LineCapRound); status.SetEndCap(LineCapRound);
        g.DrawLine(&status, 73.5f, 67.f, 73.5f, 74.f);
        g.DrawLine(&status, 73.5f, 78.f, 73.5f, 78.3f);
      }
    }
    FontFamily family(L"Segoe UI");
    Font title(&family, 17, FontStyleBold, UnitPixel);
    Font subtitle(&family, 12, FontStyleRegular, UnitPixel);
    const auto label = textFrame(animationTime());
    const bool sameTitle = previousText == text;
    SolidBrush muted(Color(BYTE(255 * label.opacity), 162, 159, 169)), ink(Color(BYTE(255 * (sameTitle ? 1 : label.opacity)), 245, 244, 247));
    StringFormat format;
    format.SetTrimming(StringTrimmingEllipsisCharacter);
    format.SetFormatFlags(StringFormatFlagsNoWrap);
    g.DrawString(label.title.c_str(), int(label.title.size()), &title, RectF(100, 29 + (sameTitle ? 0 : label.offset), 279, 26), &format, &ink);
    if (label.failure) format.SetFormatFlags(StringFormatFlagsLineLimit);
    g.DrawString(label.subtitle.c_str(), int(label.subtitle.size()), &subtitle, RectF(100, (label.failure ? 51.f : 57.f) + label.offset, 279, label.failure ? 34.f : 20.f), &format, &muted);
    if (!proofPath.empty() && (renderOnly || !animate || entryAge >= 480.)) {
      const CLSID png{0x557cf406, 0x1a04, 0x11d3, {0x9a, 0x73, 0x00, 0x00, 0xf8, 0x1e, 0xf3, 0x2e}};
      bitmap.Save(proofPath.c_str(), &png);
      proofPath.clear();
    }
  }
  if (renderOnly) { SelectObject(dc, previous); DeleteObject(dib); DeleteDC(dc); return; }
  POINT destination{area.right - width, area.top + int(8 * scale)};
  SIZE size{width, height}; POINT source{};
  BLENDFUNCTION blend{AC_SRC_OVER, 0, 255, AC_SRC_ALPHA};
  const bool rendered = UpdateLayeredWindow(window, nullptr, &destination, &size, dc, &source, 0, &blend, ULW_ALPHA) != FALSE;
  if (!rendered) {
    std::cout << json({{"event", "failed"}, {"id", messageID}}).dump() << std::endl;
    KillTimer(window, 1); ShowWindow(window, SW_HIDE);
  }
  if (!shownReported && rendered && (!animate || entryAge >= 480.) && IsWindowVisible(window)) {
    shownReported = true;
    DWORD protection = 0;
    BOOL protectedWindow = GetWindowDisplayAffinity(window, &protection);
    std::cout << json({{"event", "shown"}, {"id", messageID}, {"window", uint64_t(reinterpret_cast<uintptr_t>(window))},
                       {"visible", true}, {"protected", protection == 0x11}, {"affinity", protection}, {"affinityRead", bool(protectedWindow)},
                       {"focusPreserved", foregroundAtNotice == GetForegroundWindow()}}).dump() << std::endl;
  }
  SelectObject(dc, previous); DeleteObject(dib); DeleteDC(dc);
}

LRESULT CALLBACK events(HWND hwnd, UINT message, WPARAM w, LPARAM l) {
  if (message == metricsMessage) {
    PROCESS_MEMORY_COUNTERS memory{sizeof(PROCESS_MEMORY_COUNTERS)};
    GetProcessMemoryInfo(GetCurrentProcess(), &memory, sizeof(memory));
    FILETIME creation{}, exit{}, kernel{}, user{};
    GetProcessTimes(GetCurrentProcess(), &creation, &exit, &kernel, &user);
    auto ticks = [](FILETIME time) { return (uint64_t(time.dwHighDateTime) << 32) | time.dwLowDateTime; };
    const auto label = textFrame(animationTime());
    std::cout << json({{"event", "metrics"}, {"memory", memory.WorkingSetSize},
                       {"cpuSeconds", double(ticks(kernel) + ticks(user)) / 10000000.},
                       {"imageScale", confirmationScale(animationTime())}, {"textOpacity", label.opacity},
                       {"visible", bool(IsWindowVisible(hwnd))}, {"backgroundOffset", currentBackground}, {"contentOffset", currentContent}}).dump() << std::endl;
    return 0;
  }
  if (message == WM_PAINT) {
    PAINTSTRUCT update{}; BeginPaint(hwnd, &update); EndPaint(hwnd, &update);
    if (IsWindowVisible(hwnd)) paint();
    return 0;
  }
  if (message == noticeMessage) {
    auto *input = reinterpret_cast<json *>(l);
    if (input->contains("sound") && (*input)["sound"].is_string()) {
      auto sound = wide(input->value("sound", ""));
      PlaySoundW(sound.c_str(), nullptr, SND_FILENAME | SND_ASYNC | SND_NODEFAULT);
    }
    if (!input->value("visual", true)) {
      if (!input->value("preserveBanner", false)) { KillTimer(hwnd, 1); ShowWindow(hwnd, SW_HIDE); }
      delete input; return 0;
    }
    const bool wasVisible = IsWindowVisible(hwnd);
    messageID = input->value("id", "");
    const auto now = animationTime();
    if (input->value("pulse", false)) recordPulseAt = now;
    else if (!wasVisible) recordPulseAt = 0;
    const bool nextError = input->value("error", false), nextSaving = input->value("saving", false);
    if (!wasVisible || (!saving && nextSaving)) spinningAt = now;
    const bool completed = input->value("completed", wasVisible && saving) && !nextSaving && !nextError;
    if (wasVisible && !saving && now - started > ULONGLONG(lifetime - 260)) {
      returnBackground = currentBackground; returnContent = currentContent; returningAt = now;
    } else if (!wasVisible) { returningAt = 0; returnBackground = returnContent = 0; }
    if (wasVisible && nextSaving && !nextError && input->value("replay", true)) {
      refreshFrom = currentContent; refreshedAt = now;
      returnContent = 0;
    } else if (!wasVisible) refreshedAt = 0;
    if (completed) {
      imageFromScale = wasVisible ? confirmationScale(now) : 1;
      confirmedAt = now; completing = true;
    } else if (!wasVisible || nextError) completing = false;
    auto nextText = wide(input->value("message", ""));
    auto nextDetail = wide(input->value("detail", "AcroClip"));
    if (nextError) {
      nextDetail = input->contains("errorTitle") ? wide(input->value("detail", input->value("message", ""))) : nextText;
      nextText = wide(input->value("errorTitle", "AcroClip needs attention"));
    }
    changeText(nextText, nextDetail, nextError, wasVisible, now);
    recordingStatus = input->value("recordingStatus", "");
    loadArtwork(recordingStatus.empty() ? input->value("artwork", "") : "");
    error = input->value("error", false);
    saving = input->value("saving", false);
    if (input->contains("proofPath") && (*input)["proofPath"].is_string())
      proofPath = wide(input->value("proofPath", ""));
    lifetime = error ? 6500 : 3200;
    delete input;
    HWND foreground = GetForegroundWindow();
    foregroundAtNotice = foreground;
    shownReported = false;
    MONITORINFO monitor{sizeof(MONITORINFO)};
    GetMonitorInfo(MonitorFromWindow(foreground, MONITOR_DEFAULTTOPRIMARY), &monitor);
    area = monitor.rcWork;
    area.right = monitor.rcMonitor.right;
    scale = float(foreground ? GetDpiForWindow(foreground) : GetDpiForSystem()) / 96.f;
    BOOL animations = TRUE;
    SystemParametersInfo(SPI_GETCLIENTAREAANIMATION, 0, &animations, 0);
    animate = animations != FALSE;
    started = animationTime();
    if (!wasVisible) entered = started;
    SetWindowDisplayAffinity(hwnd, 0x11);
    paint();
    SetWindowPos(hwnd, HWND_TOPMOST, 0, 0, 0, 0,
                 SWP_NOMOVE | SWP_NOSIZE | SWP_NOACTIVATE | SWP_SHOWWINDOW);
    SetTimer(hwnd, 1, animate ? 16 : 100, nullptr);
    return 0;
  }
  if (message == WM_TIMER) {
    if (!saving && animationTime() - started >= ULONGLONG(lifetime)) {
      KillTimer(hwnd, 1); ShowWindow(hwnd, SW_HIDE);
      std::cout << json({{"event", "hidden"}, {"id", messageID}}).dump() << std::endl;
    } else paint();
    return 0;
  }
  if (message == WM_NCHITTEST) return HTTRANSPARENT;
  if (message == WM_MOUSEACTIVATE) return MA_NOACTIVATE;
  if (message == closeMessage || message == WM_CLOSE) {
    DestroyWindow(hwnd); return 0;
  }
  if (message == WM_DESTROY) { PostQuitMessage(0); return 0; }
  return DefWindowProc(hwnd, message, w, l);
}
}

int WINAPI wWinMain(HINSTANCE instance, HINSTANCE, PWSTR arguments, int) {
  SetProcessDpiAwarenessContext(DPI_AWARENESS_CONTEXT_PER_MONITOR_AWARE_V2);
  ULONG_PTR token; GdiplusStartupInput graphics;
  if (GdiplusStartup(&token, &graphics, nullptr) != Ok) return 1;
  // Draw the real native view to PNG without creating a window or playing audio.
  if (std::wstring(arguments) == L"--render-proof") {
    renderOnly = true; animate = false;
    std::string line;
    while (std::getline(std::cin, line)) {
      try {
        auto value = json::parse(line);
        proofClock = 10000000;
        lifetime = value.value("lifetimeMs", value.value("error", false) ? 6500 : 3200);
        text = wide(value.value("message", "Clip saved"));
        detail = wide(value.value("detail", "AcroClip"));
        saving = value.value("saving", false); error = value.value("error", false);
        animate = value.contains("elapsedMs");
        scale = value.value("scale", 1.f);
        entered = animationTime() - value.value("elapsedMs", 1000);
        started = animationTime() - value.value("completionAgeMs", value.value("elapsedMs", 1000));
        completing = value.value("completed", false);
        confirmedAt = started; imageFromScale = value.value("imageFromScale", 1.f);
        recordPulseAt = value.value("pulse", false) ? started : 0;
        spinningAt = animationTime() - value.value("spinningAgeMs", value.value("elapsedMs", 1000));
        refreshedAt = value.contains("refreshAgeMs") ? animationTime() - value.value("refreshAgeMs", 0) : 0;
        refreshFrom = value.value("refreshFrom", 0.f);
        textTransition = value.contains("previousMessage");
        previousText = wide(value.value("previousMessage", "")); previousDetail = wide(value.value("previousDetail", ""));
        textChangedAt = animationTime() - value.value("textAgeMs", 1000);
        recordingStatus = value.value("recordingStatus", "");
        loadArtwork(recordingStatus.empty() ? value.value("artwork", "") : "");
        proofPath = wide(value.at("proofPath").get<std::string>());
        paint();
      } catch (...) { GdiplusShutdown(token); return 1; }
    }
    thumbnailLayer.reset(); artwork.reset(); if (artworkStream) artworkStream->Release();
    GdiplusShutdown(token); return 0;
  }
  WNDCLASS cls{}; cls.lpfnWndProc = events; cls.hInstance = instance;
  cls.lpszClassName = L"AcroClipNativeFeedback";
  RegisterClass(&cls);
  window = CreateWindowEx(WS_EX_LAYERED | WS_EX_TOOLWINDOW | WS_EX_NOACTIVATE |
                         WS_EX_TOPMOST | WS_EX_TRANSPARENT,
                         cls.lpszClassName, L"AcroClip feedback", WS_POPUP,
                         0, 0, 368, 100, nullptr, nullptr, instance, nullptr);
  if (!window) { GdiplusShutdown(token); return 1; }
  // Prevent the popup appearing in screen/window clips. Never acquire focus.
  std::thread input([] {
    std::string line;
    while (std::getline(std::cin, line)) {
      try {
        if (line.size() > 2 * 1024 * 1024) continue;
        auto value = json::parse(line);
        if (value.value("action", "") == "exit") break;
        if (value.value("action", "") == "metrics") { PostMessage(window, metricsMessage, 0, 0); continue; }
        if (!value.contains("message") || !value["message"].is_string()) continue;
        if (value["message"].get_ref<const std::string &>().size() > 4000) continue;
        auto *notice = new json(std::move(value));
        if (!PostMessage(window, noticeMessage, 0, reinterpret_cast<LPARAM>(notice))) delete notice;
      } catch (...) { /* Invalid feedback must never stop recording. */ }
    }
    PostMessage(window, closeMessage, 0, 0);
  });
  MSG event{};
  while (GetMessage(&event, nullptr, 0, 0) > 0) {
    TranslateMessage(&event); DispatchMessage(&event);
  }
  // Normal shutdown closes stdin. Forced process termination also releases it.
  CancelSynchronousIo(input.native_handle());
  input.join(); thumbnailLayer.reset(); artwork.reset();
  if (artworkStream) artworkStream->Release();
  GdiplusShutdown(token);
  return 0;
}
