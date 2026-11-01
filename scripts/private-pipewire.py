"""Private PipeWire-Pulse fixture, with policy links and no hardware monitors."""
import ctypes
import os
import pathlib
import signal
import subprocess
import time
from collections.abc import Callable

runtime = pathlib.Path(os.environ["XDG_RUNTIME_DIR"])
if not runtime.is_absolute() or not runtime.name.startswith("acroclip-native-"):
    raise RuntimeError("Use this fixture only through smoke-linux-app-audio.py --pipewire")
env = dict(os.environ, XDG_CONFIG_HOME=str(runtime / "config"),
           XDG_DATA_HOME=str(runtime / "data"), XDG_CACHE_HOME=str(runtime / "cache"),
           XDG_STATE_HOME=str(runtime / "state"),
           PULSE_SERVER="unix:" + str(runtime / "pipewire-audio.sock"))
for key in ["LD_LIBRARY_PATH", "LD_PRELOAD"]:
    env.pop(key, None)
config = runtime / "config/pipewire/pipewire-pulse.conf.d"
config.mkdir(parents=True)
(config / "99-private.conf").write_text(
    'pulse.properties = { server.address = [ "unix:' + str(runtime / "pipewire-audio.sock") + '" ] }\n')
children: list[subprocess.Popen[bytes]] = []
stopping = False


def arm() -> None:
    ctypes.CDLL(None).prctl(1, signal.SIGKILL)


def launch(args: list[str]) -> None:
    child = subprocess.Popen(args, env=env, stdin=subprocess.DEVNULL,
                             preexec_fn=arm, start_new_session=True)
    children.append(child)


def wait(predicate: Callable[[], bool]) -> None:
    deadline = time.monotonic() + 15
    while not predicate():
        if time.monotonic() >= deadline or any(child.poll() is not None for child in children):
            raise RuntimeError("Private PipeWire fixture startup failed")
        time.sleep(.05)


def stop(*args: object) -> None:
    global stopping
    stopping = True


signal.signal(signal.SIGTERM, stop)
signal.signal(signal.SIGINT, stop)
try:
    launch(["dbus-daemon", "--session", "--nofork", "--address=unix:path=" + str(runtime / "dbus.sock")])
    wait(lambda: (runtime / "dbus.sock").exists())
    launch(["pipewire"])
    wait(lambda: (runtime / "pipewire-0").exists())
    version = subprocess.check_output(["wireplumber", "--version"], env=env, text=True)
    # 0.4 needs its main configuration for metadata as well as linking policy.
    # Disable hardware monitors before its enable-all scripts run.
    if "0.4." in version:
        for group, monitors in [("main", ["alsa", "v4l2", "libcamera"]),
                                 ("bluetooth", ["bluez", "bluez_midi"])]:
            directory = runtime / "config/wireplumber" / (group + ".lua.d")
            directory.mkdir(parents=True)
            (directory / "89-private.lua").write_text(
                "\n".join(name + "_monitor.enabled = false" for name in monitors) + "\n")
        policy = []
    else:
        policy = ["--profile=policy"]
    launch(["wireplumber", *policy])
    launch(["pipewire-pulse"])
    wait(lambda: (runtime / "pipewire-audio.sock").exists())
    subprocess.run(["pactl", "load-module", "module-null-sink", "sink_name=acroclip-test",
                    "rate=48000", "channels=2"], env=env, check=True)
    wait(lambda: subprocess.run(["pactl", "set-default-sink", "acroclip-test"], env=env,
                                capture_output=True).returncode == 0)
    subprocess.run(["pactl", "set-default-source", "acroclip-test.monitor"], env=env, check=True)
    (runtime / "audio.sock").symlink_to(runtime / "pipewire-audio.sock")
    print("Private PipeWire-Pulse ready, hardware monitors disabled", flush=True)
    while not stopping:
        if any(child.poll() is not None for child in children):
            raise RuntimeError("A private PipeWire service exited")
        time.sleep(.1)
finally:
    for child in reversed(children):
        if child.poll() is None:
            os.killpg(child.pid, signal.SIGTERM)
            try:
                child.wait(timeout=5)
            except subprocess.TimeoutExpired:
                os.killpg(child.pid, signal.SIGKILL)
                child.wait()
