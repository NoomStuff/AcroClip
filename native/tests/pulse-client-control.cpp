// Private fixture controls only the isolated server specified by PULSE_SERVER.
// SPDX-License-Identifier: GPL-2.0-or-later
#include <pulse/pulseaudio.h>
#include <chrono>
#include <thread>
#include <cstdlib>
#include <string>
int main(int argc, char **argv) {
  const auto *configured = getenv("PULSE_SERVER");
  if (argc != 2 || !configured) return 2;
  const std::string server = configured;
  if (server.rfind("unix:/tmp/attaclip-native-", 0) != 0 ||
      server.size() < 11 || server.substr(server.size() - 11) != "/audio.sock") return 2;
  auto *loop = pa_mainloop_new();
  auto *context = pa_context_new(pa_mainloop_get_api(loop), "AttaClip private client termination");
  if (pa_context_connect(context, nullptr, PA_CONTEXT_NOAUTOSPAWN, nullptr) < 0) return 3;
  const auto deadline = std::chrono::steady_clock::now() + std::chrono::seconds(3);
  while (pa_context_get_state(context) != PA_CONTEXT_READY) {
    if (!PA_CONTEXT_IS_GOOD(pa_context_get_state(context)) || std::chrono::steady_clock::now() > deadline) return 4;
    pa_mainloop_iterate(loop, 0, nullptr); std::this_thread::sleep_for(std::chrono::milliseconds(1));
  }
  bool success = false;
  auto *operation = pa_context_kill_source_output(context, uint32_t(strtoul(argv[1], nullptr, 10)),
      [](pa_context *, int result, void *value) { *static_cast<bool *>(value) = result != 0; }, &success);
  if (!operation) return 5;
  while (pa_operation_get_state(operation) == PA_OPERATION_RUNNING) {
    if (!PA_CONTEXT_IS_GOOD(pa_context_get_state(context)) || std::chrono::steady_clock::now() > deadline) return 6;
    pa_mainloop_iterate(loop, 0, nullptr); std::this_thread::sleep_for(std::chrono::milliseconds(1));
  }
  pa_operation_unref(operation); pa_context_disconnect(context); pa_context_unref(context); pa_mainloop_free(loop);
  return success ? 0 : 7;
}
