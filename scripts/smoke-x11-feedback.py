"""Real staged helper on private X11. No user collection, display, or audio connection."""
import json
import os
import pathlib
import select
import socket
import subprocess
import sys
import tempfile
import time

helper_path = pathlib.Path(sys.argv[1] if len(sys.argv) > 1 else 'native/notifications/linux.py').resolve()
assert helper_path.read_bytes() == pathlib.Path('native/notifications/linux.py').read_bytes(), 'Staged helper differs from source'
with tempfile.TemporaryDirectory(prefix='acroclip-feedback-x11-') as temporary:
    private = pathlib.Path(temporary)
    env = dict(os.environ, XDG_RUNTIME_DIR=temporary, WAYLAND_DISPLAY='', GDK_BACKEND='x11',
               XDG_CONFIG_HOME=temporary, XDG_CACHE_HOME=temporary, XDG_DATA_HOME=temporary,
               ACROCLIP_TEST='1', ACROCLIP_PROFILE=str(private / 'profile'), ACROCLIP_COLLECTION=str(private / 'collection'))
    for key in ['HYPRLAND_INSTANCE_SIGNATURE', 'DBUS_SESSION_BUS_ADDRESS', 'PULSE_SERVER']:
        env.pop(key, None)
    processes = []
    try:
        for number in range(190, 250):
            if pathlib.Path(f'/tmp/.X11-unix/X{number}').exists():
                continue
            with socket.socket() as probe:
                try:
                    probe.bind(('127.0.0.1', 6000 + number))
                    break
                except OSError:
                    continue
        else:
            raise RuntimeError('No private X11 display available')
        env['DISPLAY'] = f':{number}'
        def launch(args, pipe=False):
            child = subprocess.Popen(args, env=env, stdin=subprocess.PIPE if pipe else subprocess.DEVNULL,
                                     stdout=subprocess.PIPE if pipe else subprocess.DEVNULL, text=True)
            processes.append(child)
            return child
        launch(['Xvfb', f':{number}', '-screen', '0', '1280x720x24', '-nolisten', 'tcp', '-ac'])
        deadline = time.monotonic() + 5
        while not pathlib.Path(f'/tmp/.X11-unix/X{number}').exists():
            assert time.monotonic() < deadline
            time.sleep(.05)
        launch(['openbox', '--sm-disable'])
        unsupported = subprocess.run([str(helper_path)], env=env, input='', capture_output=True, text=True, timeout=5)
        assert unsupported.returncode != 0 and 'compositing manager' in unsupported.stderr, unsupported.stderr
        launch(['xcompmgr', '-a'])
        time.sleep(.3)
        helper = launch([str(helper_path)], True)
        def send(data):
            helper.stdin.write(json.dumps(data) + '\n')
            helper.stdin.flush()
        def event(identity, expected, timeout=5):
            deadline = time.monotonic() + timeout
            while time.monotonic() < deadline:
                if select.select([helper.stdout], [], [], .1)[0]:
                    line = helper.stdout.readline()
                    assert line, 'Helper exited'
                    data = json.loads(line)
                    if data.get('id') == identity and data['event'] == expected:
                        return data
            raise AssertionError(f'Missing {identity} {expected}')
        send(dict(id='start', message='Starting capture...', saving=True, recordingStatus='starting'))
        assert event('start', 'shown')['visible']
        send(dict(id='critical', message="Couldn't save clip", error=True))
        event('critical', 'shown')
        send(dict(id='muted', visual=False, preserveBanner=True))
        event('critical', 'hidden', 9)
        send(dict(id='bad-art', message='Saved', artwork='invalid'))
        # Unreadable artwork leaves an empty tile, like the Windows banner, instead of losing it.
        event('bad-art', 'shown')
        send(dict(action='exit'))
        helper.wait(timeout=5)
        assert helper.returncode == 0
        print('Staged X11 helper: composited drawing, unsupported desktop, preserved error, expiry and unreadable artwork passed')
    finally:
        for child in reversed(processes):
            if child.poll() is None:
                child.terminate()
                child.wait(timeout=5)
