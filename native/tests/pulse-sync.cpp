// SPDX-License-Identifier: GPL-2.0-or-later
// Private Pulse playback and X11 marker. The marker follows the actual
// playback position, not the time samples entered the playback queue.
#include <X11/Xlib.h>
#include <pulse/simple.h>
#include <cmath>
#include <csignal>
#include <cstdint>
#include <cstdlib>
#include <vector>

volatile sig_atomic_t quitting = 0;
void stop(int) { quitting = 1; }
int main() {
  if (!std::getenv("PULSE_SERVER") || !std::getenv("DISPLAY")) return 2;
  signal(SIGTERM, stop);
  signal(SIGINT, stop);
  auto *display = XOpenDisplay(nullptr);
  if (!display) return 3;
  pa_sample_spec spec{PA_SAMPLE_FLOAT32LE, 48000, 2};
  pa_buffer_attr attributes{48000 * 8 / 4, 48000 * 8 / 20, 0, 48000 * 8 / 100, UINT32_MAX};
  int error = 0;
  auto *stream = pa_simple_new(nullptr, "AttaClip private sync fixture",
      PA_STREAM_PLAYBACK, nullptr, "Audio and visible playback marker",
      &spec, nullptr, &attributes, &error);
  if (!stream) { XCloseDisplay(display); return 4; }
  std::vector<float> samples(480 * 2);
  uint64_t position = 0;
  int previous = -1;
  while (!quitting) {
    for (size_t i = 0; i < 480; i++, position++) {
      const float value = (position / 24000) % 2
          ? float(.05 * std::sin(2 * 3.141592653589793 * 997 * double(position) / 48000))
          : 0.f;
      samples[i * 2] = samples[i * 2 + 1] = value;
    }
    if (pa_simple_write(stream, samples.data(), samples.size() * sizeof(float), &error) < 0) break;
    const auto latency = pa_simple_get_latency(stream, &error);
    if (latency == pa_usec_t(-1)) break;
    const auto queued = latency * 48000 / 1000000;
    const auto heard = position > queued ? position - queued : 0;
    const int phase = int((heard / 24000) % 2);
    if (phase != previous) {
      XSetWindowBackground(display, DefaultRootWindow(display), phase ? 0xffffff : 0);
      XClearWindow(display, DefaultRootWindow(display));
      XSync(display, False);
      previous = phase;
    }
  }
  pa_simple_free(stream);
  XCloseDisplay(display);
  return error ? 5 : 0;
}
