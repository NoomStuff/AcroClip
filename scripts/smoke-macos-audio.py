"""Actual ScreenCaptureKit audio isolation proof with two independent fixture apps."""
from test_isolation import require_isolated_runner
require_isolated_runner()
import array
import json
import math
import os
import pathlib
import plistlib
import shutil
import subprocess
import sys
import threading
import time
import uuid
from macos_fixture_health import stable_audio_output
from audio_tone import tone_peak

assert sys.platform == "darwin", "This proof requires an actual macOS host"
root = pathlib.Path.cwd()
runtime = (root / "resources/recorder").resolve()
folder = root / ".cache/macos-audio" / str(uuid.uuid4())
folder.mkdir(parents=True)
env = dict(os.environ, DYLD_LIBRARY_PATH=str(runtime / "Frameworks"), DYLD_FRAMEWORK_PATH=str(runtime / "Frameworks"), ACROCLIP_NATIVE_TEST_AUDIO_TIMING="1")
ffmpeg = str(root / "resources/media/ffmpeg")
ffprobe = str(root / "resources/media/ffprobe")
processes, logs, events, fixtures, media, audio_diagnostics = [], [], [], [], [], []
timed_events = []
saved_captures = []


def launch(args, name, pipe=False):
    log = (folder / (name + ".log")).open("w")
    logs.append(log)
    child = subprocess.Popen(args, cwd=root, env=env, stdin=subprocess.PIPE if pipe else subprocess.DEVNULL,
                             stdout=subprocess.PIPE if pipe else log, stderr=log, text=True)
    processes.append(child)
    return child


def fixture(name, frequency, compact=False):
    contents = folder / (name + ".app") / "Contents"
    (contents / "MacOS").mkdir(parents=True)
    with (root / "native/macos/fixture-Info.plist").open("rb") as source:
        info = plistlib.load(source)
    info["CFBundleIdentifier"] = "dev.acroclip.audio-proof." + name.lower()
    info["CFBundleName"] = name
    with (contents / "Info.plist").open("wb") as target:
        plistlib.dump(info, target)
    binary = contents / "MacOS/fixture"
    if fixtures:
        shutil.copy2(fixtures[0]["binary"], binary)
    else:
        subprocess.run(["swiftc", "-O", str(root / "native/macos/fixture.swift"), "-o", str(binary)], check=True)
    output = folder / (name + ".jsonl")
    fixtures.append(dict(output=output, binary=binary))
    launch(["open", "-n", "-W", str(contents.parent), "--args", str(output), str(frequency), "compact" if compact else "bounded"], name)
    deadline = time.monotonic() + 20
    while time.monotonic() < deadline:
        if output.exists() and "\n" in output.read_text():
            identity = json.loads(output.read_text().splitlines()[0])
            assert identity["audioStarted"], identity
            assert identity["bundleIdentifier"] == info["CFBundleIdentifier"], identity
            return identity
        time.sleep(0.05)
    raise RuntimeError("Fixture did not start: " + name)


def wait(predicate, timeout=30, after=0):
    deadline = time.monotonic() + timeout
    next_status = time.monotonic() + 0.5
    while time.monotonic() < deadline:
        for event in events[after:]:
            if predicate(event):
                return event
        if helper.poll() is not None:
            raise RuntimeError(f"Recorder exited {helper.returncode}. Inspect {folder}")
        if time.monotonic() >= next_status and any(event["event"] == "recording" for event in events):
            # The application polls status while recording. This also flushes
            # accepted saves if frame delivery stops and records the reason.
            helper.stdin.write(json.dumps(dict(action="status", id=str(uuid.uuid4()))) + "\n")
            helper.stdin.flush()
            next_status = time.monotonic() + 0.5
        time.sleep(0.02)
    # Capture the live blocked operation before cleanup terminates the helper.
    children = subprocess.run(["pgrep", "-P", str(helper.pid)], capture_output=True, text=True).stdout.split()
    for pid in [str(helper.pid), *children]:
        subprocess.run(["sample", pid, "1", "1", "-file", str(folder / f"hang-{pid}.log")], capture_output=True, text=True, timeout=15)
    raise RuntimeError(f"Timed out. Events: {events[after:]}")


def command(data, expected="response"):
    identity = str(uuid.uuid4())
    helper.stdin.write(json.dumps(dict(data, id=identity)) + "\n")
    helper.stdin.flush()
    result = wait(lambda event: event.get("id") == identity)
    assert result["event"] == expected, result
    return result


def amplitudes(file, track):
    raw = subprocess.run([ffmpeg, "-v", "error", "-i", str(file), "-map", f"0:a:{track}", "-ac", "1", "-ar", "48000", "-t", "1", "-f", "f32le", "-"], capture_output=True, check=True).stdout
    samples = array.array("f")
    samples.frombytes(raw)
    assert len(samples) >= 24000, "Insufficient decoded audio"
    result = {}
    for frequency in (997, 1613):
        sine = sum(value * math.sin(2 * math.pi * frequency * index / 48000) for index, value in enumerate(samples))
        cosine = sum(value * math.cos(2 * math.pi * frequency * index / 48000) for index, value in enumerate(samples))
        result[str(frequency)] = 2 * math.hypot(sine, cosine) / len(samples)
    # A single exact-frequency projection can cancel a healthy tone when the
    # virtual device clock shifts it slightly. Keep nominal measurements as
    # diagnostics and use independently measured tone amplitudes for the same
    # gain, mute, isolation and master-mix assertions below.
    peaks = {str(nominal): tone_peak(samples, 48000, nominal) for nominal in (997, 1613)}
    audio_diagnostics.append(dict(file=file.name, track=track, samples=len(samples),
                                 rms=math.sqrt(sum(value * value for value in samples) / len(samples)),
                                 silenceFraction=sum(abs(value) < 1e-7 for value in samples) / len(samples),
                                 nominalAmplitudes=result, peaks=peaks))
    return {nominal: peak["amplitude"] for nominal, peak in peaks.items()}


def save(name, verify_frames=True):
    file = folder / (name + ".mkv")
    request = str(uuid.uuid4())
    command(dict(action="save", path=str(file), requestId=request, requestedAt=int(time.time() * 1000)))
    result = wait(lambda event: event.get("requestId") == request and event["event"] in ("saved", "error"), 45)
    assert result["event"] == "saved", result
    saved_captures.append((name, file, verify_frames))


def verify_capture(name, file, verify_frames):
    info = json.loads(subprocess.run([ffprobe, "-v", "error", "-show_streams", "-show_format", "-of", "json", str(file)], capture_output=True, text=True, check=True).stdout)
    (folder / (name + ".media.json")).write_text(json.dumps(info, indent=2))
    packets = json.loads(subprocess.run([ffprobe, "-v", "error", "-show_packets", "-of", "json", str(file)], capture_output=True, text=True, check=True).stdout)
    (folder / (name + ".packets.json")).write_text(json.dumps(packets, indent=2))
    tracks = [stream for stream in info["streams"] if stream["codec_type"] == "audio"]
    assert len(tracks) == 4, tracks
    assert [stream.get("tags", {}).get("title") for stream in tracks] == ["Master", "Capture audio", "Selected app", "System audio"], tracks
    assert float(info["format"]["duration"]) >= 1.5, info
    subprocess.run([ffmpeg, "-v", "error", "-i", str(file), "-map", "0", "-f", "null", "-"], check=True)
    video = next(stream for stream in info["streams"] if stream["codec_type"] == "video")
    assert (video["width"], video["height"]) == (320, 180), video
    pixels = subprocess.run([ffmpeg, "-v", "error", "-i", str(file), "-vf", "crop=2:2:iw/2:ih/2,scale=1:1", "-fps_mode", "passthrough", "-pix_fmt", "rgb24", "-f", "rawvideo", "-"], capture_output=True, check=True).stdout
    colors = ((228, 76, 102), (65, 184, 170))
    classes = [next((color for color, values in enumerate(colors) if all(abs(pixels[offset + index] - values[index]) <= 22 for index in range(3))), None) for offset in range(0, len(pixels), 3)]
    assert classes, "The saved video contained no decoded frames"
    if verify_frames:
        assert None not in classes and set(classes) == {0, 1}, "The saved video did not contain both changing fixture colors"
    result = dict(name=name, tracks=[amplitudes(file, index) for index in range(4)])
    media.append(result)
    (folder / "partial-proof.json").write_text(json.dumps(dict(captures=media, audioDiagnostics=audio_diagnostics), indent=2))
    print(json.dumps(dict(audioMeasurement=name, tracks=result["tracks"], diagnostics=audio_diagnostics[-4:])), flush=True)
    return result["tracks"]


def only_main(track):
    assert track["997"] > 0.03, track
    assert track["1613"] < track["997"] / 8, track


try:
    selected = fixture("Selected", 997)
    decoy = fixture("Decoy", 1613, True)
    # Establish producer readiness before starting the recorder. This does not
    # discard, delay or retry any captured clip or relax its audio assertions.
    readiness_deadline = time.monotonic() + 20
    while True:
        fixture_health = [
            [json.loads(line) for line in item["output"].read_text().splitlines(keepends=True) if line.endswith("\n")]
            for item in fixtures
        ]
        if all(stable_audio_output(health) for health in fixture_health):
            (folder / "fixture-readiness.json").write_text(json.dumps(fixture_health, indent=2))
            print("Both independent tone producers passed sustained output readiness before recorder startup", flush=True)
            break
        if time.monotonic() >= readiness_deadline:
            raise RuntimeError(f"Synthetic tone producers did not establish sustained output: {fixture_health}")
        time.sleep(0.1)
    helper = launch([str(runtime / "acroclip-recorder"), str(runtime)], "native", True)
    def read():
        for line in helper.stdout:
            event = json.loads(line)
            events.append(event)
            timed_events.append(dict(monotonicSeconds=time.monotonic(), unixSeconds=time.time(), event=event))
    threading.Thread(target=read, daemon=True).start()
    assert wait(lambda event: event["event"] == "ready")["version"] == "32.2.2"
    begin = len(events)
    command(dict(action="audio-devices", kind="output"))
    assert wait(lambda event: event["event"] == "audio-devices", after=begin)["devices"] == [dict(id="system", name="System audio")]
    application = dict(id="selected", name="Selected app", kind="application", sourceId=f"window:{selected['windowId']}:0", pid=selected["pid"], enabled=True, volume=1, muted=False, includeInMaster=False)
    system = dict(id="system", name="System audio", kind="output", deviceId="system", enabled=True, volume=1, muted=False, includeInMaster=False)
    # This proof exercises four audio tracks. Keep its synthetic video small
    # enough for Intel CI's software OpenGL renderer; smoke-macos.py separately
    # verifies full-display and window inputs with its own capture profile.
    configuration = dict(action="start", sourceKind="app", sourceId=f"window:{selected['windowId']}:0", sourceName="Selected fixture", quality="custom", customWidth=320, customHeight=180, customFPS=15, customCQ=28, clipSeconds=2, microphone=False, captureAudio=True, allowSoftwareEncoder=True, audioSources=[application, system])
    rejected = command(dict(configuration, audioSources=[dict(system, deviceId="unavailable-physical-output")]), "error")
    assert "System audio" in rejected["message"], rejected
    command(dict(action="stop"))
    command(configuration)
    time.sleep(3.5)
    save("isolated")
    command(dict(action="audio", source="selected", volume=0.5, muted=False))
    time.sleep(3)
    save("half-volume")
    command(dict(action="audio", source="selected", volume=0.5, muted=True))
    time.sleep(3)
    save("muted")
    command(dict(action="stop"))
    command(dict(configuration, captureAudio=False, audioSources=[dict(application, includeInMaster=True), system]))
    time.sleep(3)
    save("included-in-master")
    # Video remains available in the other app. Losing the selected AUDIO app
    # must still report a stopped source rather than quietly capture its replacement.
    command(dict(action="source", sourceKind="app", sourceId=f"window:{decoy['windowId']}:0", sourceName="Decoy fixture", captureAudio=True))
    (fixtures[0]["output"].with_name(fixtures[0]["output"].name + ".stop")).touch()
    deadline = time.monotonic() + 15
    status = None
    while time.monotonic() < deadline:
        begin = len(events)
        command(dict(action="status"))
        status = wait(lambda event: event["event"] == "status", after=begin)
        if "Selected app" in status["message"] and status["waiting"]:
            break
        time.sleep(0.15)
    assert status and status["waiting"] and "Selected app" in status["message"], status
    save("preserved-after-audio-target-loss", verify_frames=False)
    command(dict(action="stop"))
    helper.stdin.write(json.dumps(dict(action="exit")) + "\n")
    helper.stdin.flush()
    helper.wait(timeout=15)
    assert helper.returncode == 0, helper.returncode
    for item in fixtures:
        pathlib.Path(str(item["output"]) + ".stop").touch()
    # Decoding every track and scanning tone frequencies competes with the
    # real-time fixture producers on Intel CI. Analyze the original files only
    # after capture ends, without trimming samples or relaxing any assertion.
    captures = {name: verify_capture(name, file, verify_frames) for name, file, verify_frames in saved_captures}
    baseline = captures["isolated"]
    for track in baseline[:3]:
        only_main(track)
    assert min(baseline[3].values()) > 0.03, baseline[3]
    assert 0.8 < baseline[0]["997"] / baseline[1]["997"] < 1.2, "Excluded extras changed master audio"
    quieter = captures["half-volume"]
    assert 0.35 < quieter[2]["997"] / baseline[2]["997"] < 0.65, quieter[2]
    assert 0.8 < quieter[0]["997"] / baseline[0]["997"] < 1.2, quieter[0]
    muted = captures["muted"]
    assert max(muted[2].values()) < 0.005, muted[2]
    only_main(muted[0])
    assert min(muted[3].values()) > 0.03, muted[3]
    mixed = captures["included-in-master"]
    only_main(mixed[0])
    assert max(mixed[1].values()) < 0.005, mixed[1]
    assert 0.8 < mixed[0]["997"] / mixed[2]["997"] < 1.2, "Included app did not supply the master mix"
    proof = dict(schema=1, actualMacOS=True, selected=selected, decoy=decoy, appIsolationTested=True, systemMixTested=True, masterExclusionTested=True, liveGainTested=True, liveMuteTested=True, masterInclusionTested=True, audioTargetLossTested=True, previousFootageSavedAfterTargetLoss=True, physicalOutputFallbackRejected=True, physicalMicrophoneTested=False, captures=media, targetLoss=status)
    (folder / "proof.json").write_text(json.dumps(proof, indent=2))
    print(json.dumps(proof, indent=2))
finally:
    for item in fixtures:
        pathlib.Path(str(item["output"]) + ".stop").touch()
    (folder / "native-events.json").write_text(json.dumps(events, indent=2))
    (folder / "timed-native-events.json").write_text(json.dumps(timed_events, indent=2))
    for child in reversed(processes):
        if child.poll() is None:
            child.terminate()
            try:
                child.wait(timeout=5)
            except subprocess.TimeoutExpired:
                child.kill()
                child.wait()
    for log in logs:
        log.close()
