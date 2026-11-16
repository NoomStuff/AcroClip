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
      // second, so one round in ten pays for the lookup. This was the step before events.
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
      // Now: their session managers are kept until outputs change, so a listing only reads sessions.
      std::vector<Microsoft::WRL::ComPtr<IAudioSessionManager2>> managers;
      const auto current = ListenRouting::identity(endpoint.Get());
      for (auto &output : routing.outputs())
        if (ListenRouting::identity(output.Get()) != current) managers.push_back(ListenRouting::manager(output.Get()));
      timings.push_back(measure("otherOutputsKept", rounds, [&] {
        for (const auto &manager : managers) {
          try { (void)ListenRouting::sessions(manager.Get()); } catch (const std::exception &) {}
        }
      }));
    }
    // Now: sessions are listed after Windows reports a change, or every 2 s, through a kept
    // session manager that also watches each session for changes.
    {
      ListenRouting routing;
      auto endpoint = routing.device("default");
      Microsoft::WRL::ComPtr<AudioChanges> changes;
      changes.Attach(new AudioChanges());
      SessionWatch watch;
      watch.start(endpoint.Get(), changes.Get());
      timings.push_back(measure("watchedList", rounds, [&] { (void)watch.list(); }));
      // What a quiet round costs: waiting for a report that doesn't come.
      timings.push_back(measure("quietWait", std::min(rounds, 40), [&] { (void)changes->wait(std::chrono::milliseconds(0)); }));
      watch.stop();
    }
    // A cheaper way to notice reused process ids: each session process's start time. Twenty
    // running processes stand in for the sessions, so a machine with few sessions still measures.
    {
      std::vector<DWORD> sample;
      for (const auto &[pid, parent] : processParents())
        if (sample.size() < 20 && processStarted(pid).started) sample.push_back(pid);
      timings.push_back(measure("sessionStartTimes", rounds, [&] {
        for (DWORD pid : sample) (void)processStarted(pid);
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
