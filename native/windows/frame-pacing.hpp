// SPDX-License-Identifier: GPL-2.0-or-later
#pragma once
#include <windows.h>
#include <obs.h>
#include <util/platform.h>
#include <cstdint>
#include <cstring>
#include <string>

namespace acroclip::windows {
/**
 * libOBS paces video frames with os_sleepto_ns, which sleeps to a millisecond short of the next
 * frame and then spins on the CPU until it arrives. At 60 fps the graphics thread cost about
 * 40 ms of CPU a second that way, measured with thread cycle counters while capturing. libOBS
 * stamps each frame with its target time, not the moment the thread wakes, and only counts a
 * lagged frame when the wait overruns a whole frame. So this waits on a high-resolution
 * waitable timer instead, which wakes within about half a millisecond without spinning and
 * without raising the system timer resolution.
 *
 * obs.dll is the official prebuilt release, so the export is redirected in memory. It's only
 * done for the libOBS version the build pins, since video_sleep in that version is the only
 * caller and the replacement keeps its contract: true after waiting, false when already late.
 */
namespace frame_pacing {
/** Within this of the target the wait ends, rather than arming a timer for almost nothing. */
constexpr uint64_t settleNs = 200'000;

inline bool sleepTo(uint64_t target) {
  uint64_t now = os_gettime_ns();
  if (target <= now) return false;
  // One timer per pacing thread, kept for its lifetime.
  thread_local HANDLE timer = CreateWaitableTimerExW(nullptr, nullptr, CREATE_WAITABLE_TIMER_HIGH_RESOLUTION, TIMER_ALL_ACCESS);
  while (now + settleNs < target) {
    LARGE_INTEGER due;
    due.QuadPart = -static_cast<LONGLONG>((target - now) / 100);
    if (!timer || !SetWaitableTimerEx(timer, &due, 0, nullptr, nullptr, nullptr, 0) || WaitForSingleObject(timer, INFINITE) != WAIT_OBJECT_0) Sleep(1);
    now = os_gettime_ns();
  }
  return true;
}
}

/** Puts the timer wait in place of libOBS's spin. Returns why it didn't, or nothing when it did. */
inline std::string installFramePacing(const char *pinnedVersion) {
  if (const char *choice = std::getenv("ACROCLIP_NATIVE_OBS_SLEEP"); choice && std::string(choice) == "spin") return "kept libOBS pacing as asked";
  if (std::string(obs_get_version_string()) != pinnedVersion) return std::string("libOBS is ") + obs_get_version_string() + ", not " + pinnedVersion;
  HANDLE probe = CreateWaitableTimerExW(nullptr, nullptr, CREATE_WAITABLE_TIMER_HIGH_RESOLUTION, TIMER_ALL_ACCESS);
  if (!probe) return "this Windows has no high-resolution timer";
  CloseHandle(probe);
  auto *entry = reinterpret_cast<uint8_t *>(GetProcAddress(GetModuleHandleW(L"obs.dll"), "os_sleepto_ns"));
  if (!entry) return "obs.dll has no os_sleepto_ns";
  // mov rax, <address>; jmp rax
  uint8_t jump[12] = {0x48, 0xB8, 0, 0, 0, 0, 0, 0, 0, 0, 0xFF, 0xE0};
  const auto target = reinterpret_cast<uint64_t>(&frame_pacing::sleepTo);
  std::memcpy(jump + 2, &target, sizeof(target));
  DWORD previous = 0;
  if (!VirtualProtect(entry, sizeof(jump), PAGE_EXECUTE_READWRITE, &previous)) return "os_sleepto_ns could not be replaced";
  std::memcpy(entry, jump, sizeof(jump));
  VirtualProtect(entry, sizeof(jump), previous, &previous);
  FlushInstructionCache(GetCurrentProcess(), entry, sizeof(jump));
  return {};
}
}
