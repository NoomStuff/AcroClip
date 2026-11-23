"""Run Electron tests on private X11, D-Bus and PulseAudio (or PipeWire) servers."""
import os
import pathlib
import shutil
import signal
import socket
import subprocess
import sys
import tempfile
import time
import uuid

root = pathlib.Path.cwd()
evidence = root / '.cache/linux-ui' / str(uuid.uuid4())
evidence.mkdir(parents=True)
temporary = root / '.cache/linux-ui-tmp'
temporary.mkdir(parents=True, exist_ok=True, mode=0o700)
# Tests create their profiles and collections under TMPDIR. A per-run folder keeps them from piling up.
run = pathlib.Path(tempfile.mkdtemp(prefix='run-', dir=temporary))
private = pathlib.Path(tempfile.mkdtemp(prefix='acroclip-ui-', dir=run))
env = dict(os.environ, ACROCLIP_ISOLATED_TEST_RUNNER='private-linux', PWTEST_CACHE_DIR=str(temporary / 'playwright-cache'),
           TMPDIR=str(run), XDG_RUNTIME_DIR=str(private), XDG_CONFIG_HOME=str(private / 'config'),
           XDG_DATA_HOME=str(private / 'data'), XDG_CACHE_HOME=str(private / 'cache'),
           PULSE_SERVER='unix:' + str(private / 'audio.sock'),
           WAYLAND_DISPLAY='', XDG_SESSION_TYPE='x11',
           ACROCLIP_NATIVE_TEST_SOFTWARE='1', LIBGL_ALWAYS_SOFTWARE='1', GALLIUM_DRIVER='llvmpipe')
if os.environ.get("ACROCLIP_TEST_HARDWARE") == "1":
    env.pop("ACROCLIP_NATIVE_TEST_SOFTWARE", None)
processes, logs = [], []


def launch(command, name, pipe=False):
    log = open(evidence / (name + '.log'), 'w')
    logs.append(log)
    process = subprocess.Popen(command, env=env, stdout=subprocess.PIPE if pipe else log,
                               stderr=log, text=True, start_new_session=True)
    processes.append(process)
    return process


try:
    for number in range(90, 180):
        if pathlib.Path(f'/tmp/.X11-unix/X{number}').exists():
            continue
        with socket.socket() as candidate:
            try:
                candidate.bind(('127.0.0.1', 6000 + number))
                display = number
                break
            except OSError:
                continue
    else:
        raise RuntimeError('No private X11 display is available')
    env['DISPLAY'] = f'127.0.0.1:{display}'
    launch(['Xvfb', f':{display}', '-screen', '0', '1280x800x24', '-nolisten', 'unix', '-listen', 'tcp', '-ac'], 'xvfb')
    bus = launch(['dbus-daemon', '--session', '--nofork', '--print-address=1'], 'dbus', True)
    env['DBUS_SESSION_BUS_ADDRESS'] = bus.stdout.readline().strip()
    if shutil.which('pulseaudio'):
        audio = [launch(['pulseaudio', '-n', '--daemonize=no', '--exit-idle-time=-1', '--use-pid-file=no', '--disable-shm=true',
                         '--load=module-native-protocol-unix socket=' + str(private / 'audio.sock') + ' auth-anonymous=1',
                         '--load=module-null-sink sink_name=acroclip-test rate=48000 channels=2'], 'pulse')]
    elif all(shutil.which(name) for name in ('pipewire', 'pipewire-pulse', 'wireplumber', 'pactl')):
        # PipeWire hosts have no pulseaudio binary. Run a private PipeWire graph in the private runtime dir.
        # WirePlumber is required: without a session manager, streams never link and unmuted playback stalls.
        audio = [launch(['pipewire'], 'pipewire')]
        native = private / 'pulse/native'
        deadline = time.monotonic() + 10
        while not (private / 'pipewire-0').exists():
            if time.monotonic() > deadline or audio[0].poll() is not None:
                raise RuntimeError('Private PipeWire startup failed')
            time.sleep(.05)
        audio += [launch(['pipewire-pulse'], 'pipewire-pulse'), launch(['wireplumber'], 'wireplumber')]
        deadline = time.monotonic() + 15
        while not native.exists():
            if time.monotonic() > deadline or any(process.poll() is not None for process in audio):
                raise RuntimeError('Private pipewire-pulse startup failed')
            time.sleep(.05)
        pulse_env = dict(env, PULSE_SERVER='unix:' + str(native))
        subprocess.run(['pactl', 'load-module', 'module-null-sink', 'sink_name=acroclip-test', 'rate=48000', 'channels=2'],
                       env=pulse_env, check=True, capture_output=True)
        subprocess.run(['pactl', 'set-default-sink', 'acroclip-test'], env=pulse_env, check=True, capture_output=True)
        (private / 'audio.sock').symlink_to(native)
    else:
        raise RuntimeError('Install pulseaudio, or pipewire with pipewire-pulse, wireplumber and pactl')
    deadline = time.monotonic() + 15
    while True:
        try:
            with socket.create_connection(('127.0.0.1', 6000 + display), timeout=.2):
                if (private / 'audio.sock').exists():
                    break
        except OSError:
            pass
        if time.monotonic() > deadline or any(process.poll() is not None for process in audio):
            raise RuntimeError('Private display/audio startup failed')
        time.sleep(.05)
    manager = launch(['openbox', '--sm-disable'], 'window-manager')
    deadline = time.monotonic() + 10
    while True:
        check = subprocess.run(['xprop', '-root', '_NET_SUPPORTING_WM_CHECK'], env=env, capture_output=True, text=True)
        if 'window id #' in check.stdout:
            break
        if manager.poll() is not None or time.monotonic() > deadline:
            raise RuntimeError('Private window manager startup failed')
        time.sleep(.05)
    command = sys.argv[1:]
    if not command:
        raise ValueError('Pass the test command to run in the private desktop')
    result = subprocess.run(command, env=env)
    sys.exit(result.returncode)
finally:
    for process in reversed(processes):
        try:
            os.killpg(process.pid, signal.SIGTERM)
            process.wait(timeout=8)
        except ProcessLookupError:
            pass
        except subprocess.TimeoutExpired:
            os.killpg(process.pid, signal.SIGKILL)
            process.wait(timeout=5)
    for log in logs:
        log.close()
    if os.environ.get('ACROCLIP_KEEP_TEST_TMP') == '1':
        print('Kept test temporary files:', run)
    else:
        shutil.rmtree(run, ignore_errors=True)
    print('Private Linux desktop evidence:', evidence)
