// SPDX-License-Identifier: GPL-3.0-or-later
#pragma once
#include <algorithm>
#include <cmath>
#include <cstdlib>
#include <stdexcept>
namespace acroclip {
struct RecordingSize { int width, height; };
inline RecordingSize fitRecordingSize(RecordingSize requested, RecordingSize source) {
  if (source.width <= 0 || source.height <= 0) return requested;
  double scale = std::min({1.0, double(requested.width) / source.width, double(requested.height) / source.height});
  RecordingSize result{int(std::floor(source.width * scale / 2)) * 2, int(std::floor(source.height * scale / 2)) * 2};
  if (result.width < 64 || result.height < 64) throw std::runtime_error("The source is too small for a recording preset. Use a source at least 64 pixels in each output dimension");
  return result;
}
inline RecordingSize fitResolutionLimit(RecordingSize source, int limit, bool application) {
  if(source.width<=0 || source.height<=0)return {0,0};
  // p caps the shorter edge, independent of screen orientation or aspect ratio.
  const double scale=application || limit==0 ? 1.0 : std::min(1.0,double(limit)/std::min(source.width,source.height));
  RecordingSize result{int(std::floor(source.width*scale/2))*2,int(std::floor(source.height*scale/2))*2};
  if(result.width<64 || result.height<64 || result.width>7680 || result.height>4320)throw std::runtime_error("The source resolution is outside the supported recorder size");
  return result;
}
struct ScreenRect { long left, top, right, bottom; };
// Electron converts scaled display bounds back to pixels with its own rounding, so at
// fractional scales like 121% an edge can land a pixel or two off the real monitor.
// Monitors never overlap, so the nearest one within this tolerance is the selected one.
constexpr long screenRectTolerance = 4;
template <typename Rects> int matchScreenRect(const ScreenRect &wanted, const Rects &monitors) {
  int best = -1;
  long bestDistance = 0;
  int index = 0;
  for (const ScreenRect &monitor : monitors) {
    const long edges[] = {monitor.left - wanted.left, monitor.top - wanted.top, monitor.right - wanted.right, monitor.bottom - wanted.bottom};
    long distance = 0;
    bool within = true;
    for (long edge : edges) {
      within = within && std::labs(edge) <= screenRectTolerance;
      distance += std::labs(edge);
    }
    if (within && (best < 0 || distance < bestDistance)) {
      best = index;
      bestDistance = distance;
    }
    index++;
  }
  return best;
}

}
