// SPDX-License-Identifier: MIT
// Test fixtures must never attach to the developer's desktop or audio server.
#pragma once
#include <stdlib.h>
#include <string.h>
static int acroclip_fixture_isolated(void) {
  const char *kind = getenv("ACROCLIP_ISOLATED_TEST_RUNNER");
  if (!kind) return 0;
  if (strcmp(kind, "github-hosted") == 0) {
    const char *actions = getenv("GITHUB_ACTIONS");
    if (!actions || strcmp(actions, "true") != 0) return 0;
#ifdef _WIN32
    return getenv("ACROCLIP_TEST_RENDER_ENDPOINT_ID") != NULL;
#else
    return 1;
#endif
  }
  if (strcmp(kind, "private-linux") == 0) {
    const char *runtime = getenv("XDG_RUNTIME_DIR");
    const char *pulse = getenv("PULSE_SERVER");
    if (!runtime || !pulse || strncmp(pulse, "unix:", 5) != 0) return 0;
    size_t length = strlen(runtime);
    const char *leaf = strrchr(runtime, '/');
    if (!length || !leaf || strncmp(leaf, "/acroclip-", 10) != 0) return 0;
    if (strlen(pulse) <= 5 + length) return 0;
    return strncmp(pulse + 5, runtime, length) == 0 && pulse[5 + length] == '/' &&
      (getenv("DISPLAY") != NULL || getenv("WAYLAND_DISPLAY") != NULL);
  }
  return 0;
}
