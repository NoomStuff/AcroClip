// SPDX-License-Identifier: GPL-2.0-or-later
#import <Cocoa/Cocoa.h>
#import <ScreenCaptureKit/ScreenCaptureKit.h>
#include "desktop-audio.hpp"
#include <libproc.h>
#include <unistd.h>
#include <algorithm>
#include <atomic>
#include <chrono>
#include <cmath>
#include <memory>
#include <mutex>
#include <stdexcept>
#include <thread>

namespace {
std::mutex exclusionsMutex;
std::vector<uint32_t> exclusions;
struct AudioState {
  std::mutex mutex;
  obs_source_t *source = nullptr;
  std::string error = "Audio capture is starting";
};
bool within(pid_t pid, pid_t root) {
  for (unsigned depth = 0; pid > 1 && depth < 128; ++depth) {
    if (pid == root) return true;
    proc_bsdinfo info{};
    if (proc_pidinfo(pid, PROC_PIDTBSDINFO, 0, &info, sizeof(info)) != sizeof(info) || info.pbi_ppid == uint32_t(pid)) break;
    pid = pid_t(info.pbi_ppid);
  }
  return false;
}
struct Content {
  dispatch_semaphore_t ready = dispatch_semaphore_create(0);
  SCShareableContent *value = nil;
  ~Content() { [value release]; dispatch_release(ready); }
};
}

@interface AcroClipDesktopAudioDelegate : NSObject <SCStreamOutput, SCStreamDelegate> {
@public
  std::shared_ptr<AudioState> state;
}
@end
@implementation AcroClipDesktopAudioDelegate
- (void)stream:(SCStream *)stream didStopWithError:(NSError *)error {
  std::lock_guard<std::mutex> lock(state->mutex);
  state->error = "Desktop audio stopped. Stop recording and select the source again";
}
- (void)stream:(SCStream *)stream didOutputSampleBuffer:(CMSampleBufferRef)sample ofType:(SCStreamOutputType)type {
  if (type != SCStreamOutputTypeAudio || !CMSampleBufferDataIsReady(sample)) return;
  auto description = CMSampleBufferGetFormatDescription(sample);
  const auto *format = description ? CMAudioFormatDescriptionGetStreamBasicDescription(description) : nullptr;
  if (!format || format->mFormatID != kAudioFormatLinearPCM || !(format->mFormatFlags & kAudioFormatFlagIsFloat) || format->mBitsPerChannel != 32 ||
      format->mChannelsPerFrame < 1 || format->mChannelsPerFrame > 2) return;
  const bool planar = format->mFormatFlags & kAudioFormatFlagIsNonInterleaved;
  auto block = CMSampleBufferGetDataBuffer(sample);
  char *bytes = nullptr;
  size_t length = 0, total = 0;
  if (!block || CMBlockBufferGetDataPointer(block, 0, &length, &total, &bytes) != kCMBlockBufferNoErr || length != total || !bytes) return;
  const auto frames = CMSampleBufferGetNumSamples(sample);
  if (frames <= 0 || frames > UINT32_MAX || total < size_t(frames) * format->mChannelsPerFrame * sizeof(float)) return;
  const double seconds = CMTimeGetSeconds(CMSampleBufferGetPresentationTimeStamp(sample));
  if (!std::isfinite(seconds) || seconds < 0) return;
  obs_source_audio audio{};
  audio.frames = uint32_t(frames);
  audio.speakers = format->mChannelsPerFrame == 2 ? SPEAKERS_STEREO : SPEAKERS_MONO;
  audio.samples_per_sec = uint32_t(format->mSampleRate);
  audio.format = planar ? AUDIO_FORMAT_FLOAT_PLANAR : AUDIO_FORMAT_FLOAT;
  audio.timestamp = uint64_t(seconds * 1000000000.);
  audio.data[0] = reinterpret_cast<uint8_t *>(bytes);
  if (planar && format->mChannelsPerFrame == 2) audio.data[1] = audio.data[0] + size_t(frames) * sizeof(float);
  std::lock_guard<std::mutex> lock(state->mutex);
  if (state->source) obs_source_output_audio(state->source, &audio);
}
@end

namespace acroclip::macos {
namespace {
struct DesktopAudio {
  std::shared_ptr<AudioState> state = std::make_shared<AudioState>();
  std::atomic<bool> quit{false};
  std::thread thread;
  SCStream *stream = nil;
  AcroClipDesktopAudioDelegate *delegate = nil;
  dispatch_queue_t queue = dispatch_queue_create("dev.acroclip.desktop-audio", DISPATCH_QUEUE_SERIAL);
  DesktopAudio(obs_source_t *source) {
    state->source = source;
    delegate = [[AcroClipDesktopAudioDelegate alloc] init];
    delegate->state = state;
    thread = std::thread([this] { run(); });
  }
  ~DesktopAudio() {
    { std::lock_guard<std::mutex> lock(state->mutex); state->source = nullptr; }
    quit = true;
    thread.join();
    if (stream) {
      auto stopped = std::make_shared<Content>();
      auto *retainedDelegate = [delegate retain];
      [stream stopCaptureWithCompletionHandler:^(NSError *) { [retainedDelegate release]; dispatch_semaphore_signal(stopped->ready); }];
      dispatch_semaphore_wait(stopped->ready, dispatch_time(DISPATCH_TIME_NOW, 3000000000LL));
    }
    dispatch_sync(queue, ^{});
    [stream release];
    [delegate release];
    dispatch_release(queue);
  }
  void run() {
    @autoreleasepool {
      std::vector<pid_t> previous;
      try {
        while (!quit) {
          @autoreleasepool {
            auto content = std::make_shared<Content>();
            [SCShareableContent getShareableContentExcludingDesktopWindows:YES onScreenWindowsOnly:NO
                completionHandler:^(SCShareableContent *value, NSError *error) {
                  if (!error) content->value = [value retain];
                  dispatch_semaphore_signal(content->ready);
                }];
            if (dispatch_semaphore_wait(content->ready, dispatch_time(DISPATCH_TIME_NOW, 3000000000LL)) || !content->value)
              throw std::runtime_error("Desktop audio applications could not be inspected");
            SCDisplay *display = nil;
            for (SCDisplay *candidate in content->value.displays)
              if (candidate.displayID == CGMainDisplayID()) { display = candidate; break; }
            if (!display) throw std::runtime_error("Desktop audio needs an active screen");
            std::vector<uint32_t> excluded;
            { std::lock_guard<std::mutex> lock(exclusionsMutex); excluded = exclusions; }
            excluded.push_back(uint32_t(getpid()));
            NSMutableArray<SCRunningApplication *> *included = [NSMutableArray array];
            std::vector<pid_t> identities;
            // Include the current permitted applications. A future feedback
            // helper cannot enter this filter before its identity is checked.
            for (SCRunningApplication *application in content->value.applications) {
              if (std::any_of(excluded.begin(), excluded.end(), [&](uint32_t root) { return within(application.processID, pid_t(root)); })) continue;
              [included addObject:application];
              identities.push_back(application.processID);
            }
            std::sort(identities.begin(), identities.end());
            if (!stream || identities != previous) {
              SCContentFilter *filter = [[SCContentFilter alloc] initWithDisplay:display includingApplications:included exceptingWindows:@[]];
              auto completed = std::make_shared<Content>();
              auto currentState = state;
              void (^completion)(NSError *) = ^(NSError *error) {
                { std::lock_guard<std::mutex> lock(currentState->mutex);
                  currentState->error = error ? "Desktop audio could not start or update its application filter" : ""; }
                dispatch_semaphore_signal(completed->ready);
              };
              if (!stream) {
                SCStreamConfiguration *configuration = [[SCStreamConfiguration alloc] init];
                configuration.width = 2; configuration.height = 2;
                configuration.minimumFrameInterval = CMTimeMake(1, 1);
                configuration.capturesAudio = YES;
                configuration.excludesCurrentProcessAudio = YES;
                configuration.sampleRate = 48000;
                configuration.channelCount = 2;
                configuration.showsCursor = NO;
                stream = [[SCStream alloc] initWithFilter:filter configuration:configuration delegate:delegate];
                [configuration release];
                NSError *error = nil;
                if (![stream addStreamOutput:delegate type:SCStreamOutputTypeAudio sampleHandlerQueue:queue error:&error]) {
                  [filter release];
                  throw std::runtime_error("Desktop audio could not attach its sample output");
                }
                [stream startCaptureWithCompletionHandler:completion];
              } else [stream updateContentFilter:filter completionHandler:completion];
              [filter release];
              if (dispatch_semaphore_wait(completed->ready, dispatch_time(DISPATCH_TIME_NOW, 3000000000LL)))
                throw std::runtime_error("Desktop audio did not acknowledge its application filter");
              { std::lock_guard<std::mutex> lock(state->mutex); if (!state->error.empty()) throw std::runtime_error(state->error); }
              previous = identities;
            }
          }
          for (unsigned i = 0; i < 50 && !quit; ++i) std::this_thread::sleep_for(std::chrono::milliseconds(10));
        }
      } catch (const std::exception &error) {
        std::lock_guard<std::mutex> lock(state->mutex);
        state->error = error.what();
      }
    }
  }
};
}
void setDesktopExclusions(const std::vector<uint32_t> &pids) { std::lock_guard<std::mutex> lock(exclusionsMutex); exclusions = pids; }
std::string desktopAudioError(obs_source_t *source) {
  if (!source || std::string(obs_source_get_id(source)) != "acroclip_sck_desktop_audio") return {};
  auto *self = static_cast<DesktopAudio *>(obs_obj_get_data(source));
  std::lock_guard<std::mutex> lock(self->state->mutex);
  return self->state->error;
}
void registerDesktopAudio() {
  obs_source_info info{};
  info.id = "acroclip_sck_desktop_audio";
  info.type = OBS_SOURCE_TYPE_INPUT;
  info.output_flags = OBS_SOURCE_AUDIO | OBS_SOURCE_DO_NOT_DUPLICATE;
  info.get_name = [](void *) { return "Desktop audio"; };
  info.create = [](obs_data_t *, obs_source_t *source) -> void * { try { return new DesktopAudio(source); } catch (...) { return nullptr; } };
  info.destroy = [](void *data) { delete static_cast<DesktopAudio *>(data); };
  obs_register_source(&info);
}
}
