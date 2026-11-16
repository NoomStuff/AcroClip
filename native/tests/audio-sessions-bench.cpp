// Times the work one Desktop audio round does, with the recorder's own code, on this machine's
// real outputs. It only lists sessions and processes, so it plays and records nothing.
//
//   acroclip-audio-sessions-bench [rounds]
//
// Prints one JSON line: microseconds per round for each kind of work, as median, p99 and max.
#include "../windows/listen-safety.hpp"
#include <algorithm>
#include <chrono>
#include <cstdio>
#include <cstdlib>
#include <functional>
#include <string>
#include <vector>

using namespace acroclip::windows;
using Clock = std::chrono::steady_clock;

namespace {
struct Timing { std::string name; std::vector<double> micros; double cpuMicros; };

double processCpuMicros() {
  FILETIME created, exited, kernel, user;
  GetProcessTimes(GetCurrentProcess(), &created, &exited, &kernel, &user);
  const auto value = [](FILETIME time) { return double((uint64_t(time.dwHighDateTime) << 32) | time.dwLowDateTime) / 10.0; };
  return value(kernel) + value(user);
}

double percentile(std::vector<double> values, double share) {
  std::sort(values.begin(), values.end());
  return values[std::min(values.size() - 1, size_t(share * double(values.size())))];
}

std::string only;

Timing measure(const char *name, int rounds, const std::function<void()> &work) {
  if (!only.empty() && only != name) return {name, {0}, 0};
  Timing result{name, {}, 0};
  work();  // The first call loads COM classes and isn't what a running recorder pays.
  const double cpuStart = processCpuMicros();
  for (int round = 0; round < rounds; ++round) {
    const auto start = Clock::now();
    work();
    result.micros.push_back(std::chrono::duration<double, std::micro>(Clock::now() - start).count());
  }
  // Own CPU only. Session calls also cost the Windows audio service some time, which this misses.
  result.cpuMicros = (processCpuMicros() - cpuStart) / rounds;
  return result;
}
}

int main(int argc, char **argv) {
  const int rounds = argc > 1 ? std::max(10, std::atoi(argv[1])) : 500;
  // An optional name runs only that timing, so an outside tool can measure what it costs the audio service.
  only = argc > 2 ? argv[2] : "";
  std::vector<Timing> timings;
  size_t outputs = 0;
  try {
    {
      ListenRouting routing;
      outputs = routing.outputs().size();
    }
    // Before: every round built the routing and looked up the default output again.
    timings.push_back(measure("oldRound", rounds, [] {
      ListenRouting routing;
      auto endpoint = routing.device("default");
      (void)ListenRouting::sessions(endpoint.Get());
    }));
    {
      // Now: the routing lives as long as the audio thread, and the output is looked up once a
      // second, so one round in ten pays for the lookup.
      ListenRouting routing;
      auto endpoint = routing.device("default");
      int round = 0;
      timings.push_back(measure("round", rounds, [&] {
        if (++round % 10 == 0) endpoint = routing.device("default");
        (void)ListenRouting::sessions(endpoint.Get());
      }));
      // Only while a captured app has left the default output, and then at most once a second.
      timings.push_back(measure("otherOutputs", rounds, [&] {
        const auto current = ListenRouting::identity(endpoint.Get());
        for (auto &output : routing.outputs()) {
          if (ListenRouting::identity(output.Get()) == current) continue;
          try { (void)ListenRouting::sessions(output.Get()); } catch (const std::exception &) {}
        }
      }));
    }
    // A cheaper way to notice reused process ids: each session process's start time.
    {
      ListenRouting routing;
      auto endpoint = routing.device("default");
      const auto listed = ListenRouting::sessions(endpoint.Get());
      timings.push_back(measure("sessionStartTimes", rounds, [&] {
        for (const auto &item : listed) (void)processStarted(item.pid);
      }));
    }
    // Every 2 s, or when an unknown process appears.
    timings.push_back(measure("processSnapshot", rounds, [] { (void)processParents(); }));
  } catch (const std::exception &problem) {
    std::fprintf(stderr, "%s\n", problem.what());
    return 2;
  }
  std::printf("{\"rounds\":%d,\"outputs\":%zu", rounds, outputs);
  for (const auto &timing : timings)
    std::printf(",\"%s\":{\"medianUs\":%.1f,\"p99Us\":%.1f,\"maxUs\":%.1f,\"cpuUs\":%.1f}", timing.name.c_str(), percentile(timing.micros, 0.5),
                percentile(timing.micros, 0.99), *std::max_element(timing.micros.begin(), timing.micros.end()), timing.cpuMicros);
  std::printf("}\n");
  return 0;
}
