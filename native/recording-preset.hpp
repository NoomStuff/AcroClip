// SPDX-License-Identifier: GPL-3.0-or-later
#pragma once
#include <algorithm>
#include <cmath>
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

}
