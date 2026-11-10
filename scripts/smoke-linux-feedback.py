"""Real GTK rendering inside disposable compositors. Hyprland can nest on an explicitly supplied parent socket."""
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
    with tempfile.TemporaryDirectory(prefix='ac-feedback-') as temporary:
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
        config.write_text('hl.monitor({output="",mode="1280x720@60",position="auto",scale=1})\nhl.layer_rule({name="test-no-anim",match={namespace="^acroclip-feedback$"},no_anim=true})\n'
                          # A nested Xwayland can take the parent's display number and remove its socket on exit.
                          'hl.config({xwayland={enabled=false}})\n' if desktop == 'Hyprland' else
                          'output HEADLESS-1 mode 1280x720@60Hz\nseat seat0 fallback true\nxwayland disable\n')
        log = open(proof / (desktop + '.log'), 'w')
        outer = None
        if desktop == 'Hyprland':
            parent = os.environ.get('ACROCLIP_TEST_PARENT_WAYLAND')
            if not parent or not pathlib.Path(parent).is_socket():
                raise RuntimeError('Set ACROCLIP_TEST_PARENT_WAYLAND to the parent Wayland socket for a private nested Hyprland test')
            env['WAYLAND_DISPLAY'] = parent
        compositor = subprocess.Popen([desktop, '-c', str(config)], env=env, stdout=log, stderr=log)
        helper = None
        try:
            deadline = time.monotonic() + 15
            initial_socket = env.get('WAYLAND_DISPLAY')
            while not [p for p in private.glob('wayland-*.lock') if p.name != str(initial_socket) + '.lock']:
                assert compositor.poll() is None and time.monotonic() < deadline, 'Compositor failed, inspect log'
                time.sleep(.05)
            env['WAYLAND_DISPLAY'] = [p for p in private.glob('wayland-*.lock') if p.name != str(initial_socket) + '.lock'][0].name.removesuffix('.lock')
            if desktop == 'Hyprland':
                env['HYPRLAND_INSTANCE_SIGNATURE'] = next((private / 'hypr').iterdir()).name
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

            send(dict(id='starting', message='Starting capture...', detail='Waiting for source', recordingStatus='starting', saving=True))
            assert event('starting', 'shown')['visible']
            send(dict(id='ready', message='Capture started', detail='Private fixture', recordingStatus='recording', pulse=True))
            event('ready', 'shown')
            time.sleep(.7)
            subprocess.run(['grim', str(proof / (desktop + '.png'))], env=env, check=True)
            if desktop == 'Hyprland':
                send(dict(id='capture-proof', message='Starting capture...', detail='Private capture fixture', saving=True, recordingStatus='starting'))
                event('capture-proof', 'shown')
                from PIL import Image, ImageChops
                excluded = proof / 'Hyprland-excluded.png'
                subprocess.run(['grim', str(excluded)], env=env, check=True)
                def rule(enabled):
                    code = '_G.acroclip_feedback_rule:set_enabled(' + ('true' if enabled else 'false') + ')'
                    result = subprocess.run(['hyprctl', 'eval', code], env=env, capture_output=True, text=True, check=True)
                    assert result.stdout.strip() == 'ok', result.stdout
                rule(False)
                time.sleep(.2)
                visible = proof / 'Hyprland-visible.png'
                subprocess.run(['grim', str(visible)], env=env, check=True)
                difference = ImageChops.difference(Image.open(excluded).convert('RGB'), Image.open(visible).convert('RGB'))
                assert difference.getbbox(), 'Exclusion did not change captured pixels'
                frames = proof / 'capture-frames'
                frames.mkdir(exist_ok=True)
                # Actual screencopy frames, first visible then excluded. No generated video fixture.
                for index in range(30):
                    if index == 15:
                        rule(True)
                    subprocess.run(['grim', str(frames / f'{index:03}.png')], env=env, check=True)
                    time.sleep(.04)
                subprocess.run(['ffmpeg', '-v', 'error', '-y', '-framerate', '15', '-i', str(frames / '%03d.png'),
                                '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-vf', 'pad=ceil(iw/2)*2:ceil(ih/2)*2',
                                str(proof / 'Hyprland-capture-exclusion.mp4')], check=True)
                rule(True)
                print('Hyprland: real screencopy footage and visible/excluded pixel difference passed')
            video = private / 'clip.mp4'
            thumbnail = private / 'thumbnail.png'
            subprocess.run(['ffmpeg', '-v', 'error', '-y', '-f', 'lavfi', '-i', 'testsrc2=size=320x180:rate=24',
                            '-t', '1', '-c:v', 'libx264', str(video)], check=True)
            subprocess.run(['ffmpeg', '-v', 'error', '-y', '-i', str(video), '-frames:v', '1', str(thumbnail)], check=True)
            artwork = 'data:image/png;base64,' + base64.b64encode(thumbnail.read_bytes()).decode()
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
            event('critical', 'hidden', 9)
            send(dict(id='invalid-art', message='Saved', artwork='invalid'))
            # Unreadable artwork leaves an empty tile, like the Windows banner, instead of losing it.
            event('invalid-art', 'shown')
            send(dict(action='exit'))
            helper.wait(timeout=5)
            assert helper.returncode == 0
            print(desktop + ': shown, recording transition, preserved error, hidden, unreadable artwork passed')
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
