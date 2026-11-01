"""Real GTK rendering on disposable compositor instances, never the user's desktop."""
import base64
import json
import os
import pathlib
import select
import subprocess
import tempfile
import time

root = pathlib.Path.cwd()
proof = root / '.cache/linux-feedback'
proof.mkdir(parents=True, exist_ok=True)


def run(desktop):
    with tempfile.TemporaryDirectory(prefix='acroclip-feedback-') as temporary:
        private = pathlib.Path(temporary)
        env = dict(os.environ, XDG_RUNTIME_DIR=temporary, XDG_CONFIG_HOME=temporary,
                   XDG_DATA_HOME=temporary, XDG_CACHE_HOME=temporary,
                   WLR_BACKENDS='headless', WLR_RENDERER='pixman',
                   WLR_LIBINPUT_NO_DEVICES='1', AQ_BACKEND='headless',
                   LIBGL_ALWAYS_SOFTWARE='1', GALLIUM_DRIVER='llvmpipe',
                   ACROCLIP_TEST='1', ACROCLIP_PROFILE=str(private / 'profile'),
                   ACROCLIP_COLLECTION=str(private / 'collection'))
        for key in ['DISPLAY', 'WAYLAND_DISPLAY', 'HYPRLAND_INSTANCE_SIGNATURE', 'DBUS_SESSION_BUS_ADDRESS']:
            env.pop(key, None)
        config = private / 'config'
        config.write_text('monitor = ,1280x720@60,auto,1\n' if desktop == 'Hyprland' else
                          'output HEADLESS-1 mode 1280x720@60Hz\nseat seat0 fallback true\n')
        log = open(proof / (desktop + '.log'), 'w')
        outer = None
        if desktop == 'Hyprland':
            outer_config = private / 'sway.conf'
            outer_config.write_text('output HEADLESS-1 mode 1280x720@60Hz\nseat seat0 fallback true\n')
            env['WLR_RENDERER'] = 'gles2'
            outer = subprocess.Popen(['sway', '-c', str(outer_config)], env=env, stdout=log, stderr=log)
            deadline = time.monotonic() + 15
            while not list(private.glob('wayland-*.lock')):
                assert outer.poll() is None and time.monotonic() < deadline
                time.sleep(.05)
            env['WAYLAND_DISPLAY'] = list(private.glob('wayland-*.lock'))[0].name.removesuffix('.lock')
        compositor = subprocess.Popen([desktop, '-c', str(config)], env=env, stdout=log, stderr=log)
        helper = None
        try:
            deadline = time.monotonic() + 15
            initial_socket = env.get('WAYLAND_DISPLAY')
            while not [p for p in private.glob('wayland-*.lock') if p.name != str(initial_socket) + '.lock']:
                assert compositor.poll() is None and time.monotonic() < deadline, 'Compositor failed, inspect log'
                time.sleep(.05)
            env['WAYLAND_DISPLAY'] = [p for p in private.glob('wayland-*.lock') if p.name != str(initial_socket) + '.lock'][0].name.removesuffix('.lock')
            helper = subprocess.Popen(['python3', 'native/notifications/linux.py'], env=env,
                                      stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=log, text=True)

            def send(data):
                helper.stdin.write(json.dumps(data) + '\n')
                helper.stdin.flush()

            def event(identity, name, timeout=5):
                deadline = time.monotonic() + timeout
                while time.monotonic() < deadline:
                    if select.select([helper.stdout], [], [], .1)[0]:
                        line = helper.stdout.readline()
                        assert line, 'Helper exited, inspect log'
                        value = json.loads(line)
                        if value.get('id') == identity and value['event'] == name:
                            return value
                raise AssertionError('Missing event ' + identity + ' ' + name)

            send(dict(id='starting', message='Starting recording...', detail='Waiting for source', recordingStatus='starting', saving=True))
            assert event('starting', 'shown')['visible']
            send(dict(id='ready', message='Recording started', detail='Private fixture', recordingStatus='recording', pulse=True))
            event('ready', 'shown')
            time.sleep(.7)
            subprocess.run(['grim', str(proof / (desktop + '.png'))], env=env, check=True)
            artwork = 'data:image/png;base64,' + base64.b64encode((root / 'build/icon.png').read_bytes()).decode()
            send(dict(id='saving', message='Clip saving...', saving=True, artwork=artwork, replay=True))
            event('saving', 'shown')
            # Multiple requests in one pipe write must not remain in Python's input buffer.
            helper.stdin.write(json.dumps(dict(id='repeat', message='Clip saving...', saving=True, artwork=artwork, replay=True)) + '\n' +
                               json.dumps(dict(id='saved', message='Clip saved', artwork=artwork, completed=True)) + '\n')
            helper.stdin.flush()
            event('saved', 'shown')
            send(dict(id='critical', message="Couldn't save clip", detail='Private test', error=True))
            event('critical', 'shown')
            send(dict(id='muted', visual=False, preserveBanner=True))
            event('critical', 'hidden', 7)
            send(dict(id='invalid-art', message='Saved', artwork='invalid'))
            event('invalid-art', 'failed')
            send(dict(action='exit'))
            helper.wait(timeout=5)
            assert helper.returncode == 0
            print(desktop + ': shown, recording transition, preserved error, hidden, rendering failure passed')
        finally:
            if helper and helper.poll() is None:
                helper.terminate()
                helper.wait(timeout=5)
            compositor.terminate()
            compositor.wait(timeout=5)
            if outer:
                outer.terminate()
                outer.wait(timeout=5)
            log.close()


if __name__ == '__main__':
    import sys
    for desktop in sys.argv[1:] or ['Hyprland', 'sway']:
        run(desktop)
