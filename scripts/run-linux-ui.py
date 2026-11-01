"""Run Electron tests on private X11, D-Bus and PulseAudio servers."""
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
private = pathlib.Path(tempfile.mkdtemp(prefix='acroclip-ui-', dir=temporary))
env = dict(os.environ, ACROCLIP_ISOLATED_TEST_RUNNER='private-linux',
           TMPDIR=str(temporary), XDG_RUNTIME_DIR=str(private), XDG_CONFIG_HOME=str(private / 'config'),
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
    pulse = launch(['pulseaudio', '-n', '--daemonize=no', '--exit-idle-time=-1', '--use-pid-file=no', '--disable-shm=true',
                   '--load=module-native-protocol-unix socket=' + str(private / 'audio.sock') + ' auth-anonymous=1',
                   '--load=module-null-sink sink_name=acroclip-test rate=48000 channels=2'], 'pulse')
    deadline = time.monotonic() + 15
    while True:
        try:
            with socket.create_connection(('127.0.0.1', 6000 + display), timeout=.2):
                if (private / 'audio.sock').exists():
                    break
        except OSError:
            pass
        if time.monotonic() > deadline or pulse.poll() is not None:
            raise RuntimeError('Private display/audio startup failed')
        time.sleep(.05)
    bus = launch(['dbus-daemon', '--session', '--nofork', '--print-address=1'], 'dbus', True)
    env['DBUS_SESSION_BUS_ADDRESS'] = bus.stdout.readline().strip()
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
    shutil.rmtree(private)
    print('Private Linux desktop evidence:', evidence)
