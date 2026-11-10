#!/usr/bin/env python3
"""Optional host GTK banner. No distro assumptions; failures use the parent fallback.

Geometry, motion and graphics follow native/notifications/windows.cpp so both
platforms show the same banner. Times are milliseconds, sizes logical pixels.
"""
import base64
import ctypes
import json
import math
import os
import subprocess
import sys
import threading
import time
import warnings

import cairo

# GTK 4 deprecates this pixbuf helper without a Cairo replacement. Each warning would reach the app log.
warnings.filterwarnings('ignore', category=DeprecationWarning, message='.*cairo_set_source_pixbuf')

render_only = '--render-proof' in sys.argv[1:]
wayland = not render_only and bool(os.environ.get('WAYLAND_DISPLAY')) and os.environ.get('GDK_BACKEND') != 'x11'
if wayland:
    ctypes.CDLL('libgtk4-layer-shell.so.0', mode=ctypes.RTLD_GLOBAL)
import gi
gi.require_version('PangoCairo', '1.0')
gi.require_version('Gtk', '4.0' if wayland else '3.0')
from gi.repository import Gtk, Gdk, GLib, GdkPixbuf, Pango, PangoCairo
if wayland:
    gi.require_version('Gtk4LayerShell', '1.0')
    from gi.repository import Gtk4LayerShell as Layer

WIDTH, HEIGHT = 420, 128
TOP_MARGIN = 8
PURPLE = (177, 151, 252)
FAILURE = (250, 137, 137)
ACTIVE = (244, 95, 117)
MUTED = (162, 159, 169)
INK = (245, 244, 247)


def rgb(color, alpha=255):
    return color[0] / 255, color[1] / 255, color[2] / 255, alpha / 255


def emit(event, request, **extra):
    print(json.dumps(dict(event=event, id=request, **extra)), flush=True)


def configure_capture_exclusion():
    """Probe the compositor's rule API. Layer-shell itself has no exclusion flag."""
    if not wayland or not os.environ.get('HYPRLAND_INSTANCE_SIGNATURE'):
        return False
    code = """
if not _G.acroclip_feedback_rule or not _G.acroclip_feedback_rule:is_enabled() then
    _G.acroclip_feedback_rule = hl.layer_rule({
        name = "acroclip-feedback",
        match = {namespace = "^acroclip-feedback$"},
        no_anim = true,
        no_screen_share = true,
    })
end
"""
    try:
        result = subprocess.run(['hyprctl', 'eval', code], capture_output=True, text=True, timeout=.5)
        supported = result.returncode == 0 and result.stdout.strip() == 'ok'
        if not supported:
            print('Compositor capture exclusion unavailable: ' + result.stdout[:300], file=sys.stderr)
        return supported
    except (OSError, subprocess.TimeoutExpired) as error:
        print('Compositor capture exclusion unavailable: ' + str(error), file=sys.stderr)
        return False


def smooth(value):
    value = max(0, min(1, value))
    return value * value * (3 - 2 * value)


def rounded(cr, x, y, w, h, r):
    cr.new_sub_path()
    cr.arc(x + r, y + r, r, math.pi, math.pi * 1.5)
    cr.arc(x + w - r, y + r, r, math.pi * 1.5, math.tau)
    cr.arc(x + w - r, y + h - r, r, 0, math.pi / 2)
    cr.arc(x + r, y + h - r, r, math.pi / 2, math.pi)
    cr.close_path()


def card(cr, offset):
    """Rounded on the exposed left edge, square where it meets the display edge."""
    cr.new_path()
    cr.arc(offset + 28, 28, 20, math.pi, math.pi * 1.5)
    cr.line_to(offset + 408, 8)
    cr.line_to(offset + 408, 96)
    cr.line_to(offset + 28, 96)
    cr.arc(offset + 28, 76, 20, math.pi / 2, math.pi)
    cr.close_path()


def load_artwork(data):
    if not data:
        return None
    if not data.startswith('data:image/') or ',' not in data:
        raise ValueError('Artwork must be an image data URL')
    raw = base64.b64decode(data.split(',', 1)[1], validate=True)
    if len(raw) > 1024 * 1024:
        raise ValueError('Artwork is too large')
    loader = GdkPixbuf.PixbufLoader()
    loader.write(raw)
    loader.close()
    image = loader.get_pixbuf()
    if image.get_width() > 2048 or image.get_height() > 2048:
        raise ValueError('Artwork is too large')
    return image


class Banner:
    def __init__(self):
        self.window = None
        self.area = None
        self.animate = True
        self.visible = False
        self.message_id = ''
        self.text = self.detail = self.previous_text = self.previous_detail = ''
        self.previous_error = self.text_transition = False
        self.text_changed_at = 0
        self.text_from_opacity = 1
        self.error = self.saving = False
        self.status = ''
        self.icon = False
        self.image = None
        self.artwork_data = ''
        self.started = self.entered = 0
        self.lifetime = 3200
        self.confirmed_at = 0
        self.completing = False
        self.image_from_scale = 1
        self.returning_at = 0
        self.return_background = self.return_content = 0
        self.refreshed_at = 0
        self.refresh_from = 0
        self.spinning_at = self.record_pulse_at = 0
        self.current_background = self.current_content = 0
        self.shown_reported = False
        self.excluded_once = False
        self.input_buffer = b''
        self.clock = None
        if render_only:
            return
        if wayland:
            Gtk.init()
            if not Layer.is_supported():
                raise RuntimeError('Compositor has no layer-shell support')
        else:
            if not Gtk.init_check()[0]:
                raise RuntimeError('No X11 display')
            if not Gdk.Screen.get_default().is_composited():
                raise RuntimeError('X11 desktop has no compositing manager')
        self.animate = self.animations_enabled()
        self.window = Gtk.Window()
        self.window.set_title('AcroClip feedback')
        self.window.set_decorated(False)
        self.window.set_default_size(WIDTH, HEIGHT)
        self.window.set_resizable(False)
        self.area = Gtk.DrawingArea()
        if wayland:
            Layer.init_for_window(self.window)
            Layer.set_namespace(self.window, 'acroclip-feedback')
            Layer.set_layer(self.window, Layer.Layer.OVERLAY)
            Layer.set_anchor(self.window, Layer.Edge.RIGHT, True)
            Layer.set_anchor(self.window, Layer.Edge.TOP, True)
            Layer.set_margin(self.window, Layer.Edge.TOP, TOP_MARGIN)
            Layer.set_keyboard_mode(self.window, Layer.KeyboardMode.NONE)
            self.area.set_content_width(WIDTH)
            self.area.set_content_height(HEIGHT)
            self.area.set_draw_func(lambda area, cr, width, height: self.draw(cr))
            self.area.set_can_target(False)
            self.window.set_child(self.area)
        else:
            self.window.set_accept_focus(False)
            self.window.set_focus_on_map(False)
            self.window.set_keep_above(True)
            self.window.set_skip_taskbar_hint(True)
            self.window.set_skip_pager_hint(True)
            self.window.set_type_hint(Gdk.WindowTypeHint.NOTIFICATION)
            self.window.set_app_paintable(True)
            self.window.set_visual(Gdk.Screen.get_default().get_rgba_visual())
            self.area.set_size_request(WIDTH, HEIGHT)
            self.area.connect('draw', lambda area, cr: self.draw(cr))
            self.window.add(self.area)
        # Clicks pass through to whatever is underneath, like the Windows banner.
        self.window.connect('realize', lambda window: self.pass_input())
        provider = Gtk.CssProvider()
        css = 'window { background: transparent; box-shadow: none; }'
        provider.load_from_data(css if wayland else css.encode())
        if wayland:
            Gtk.StyleContext.add_provider_for_display(Gdk.Display.get_default(), provider, 800)
        else:
            Gtk.StyleContext.add_provider_for_screen(Gdk.Screen.get_default(), provider, 800)
        GLib.io_add_watch(sys.stdin, GLib.IO_IN | GLib.IO_HUP, self.read)

    def now(self):
        return self.clock if self.clock is not None else time.monotonic() * 1000

    @staticmethod
    def animations_enabled():
        settings = Gtk.Settings.get_default()
        return bool(settings.get_property('gtk-enable-animations')) if settings else True

    def pass_input(self):
        try:
            if wayland:
                surface = self.window.get_surface()
                if surface:
                    surface.set_input_region(cairo.Region())
            else:
                self.window.input_shape_combine_region(cairo.Region())
        except Exception as error:
            print('Banner input passthrough unavailable: ' + str(error), file=sys.stderr)

    def place(self):
        if wayland:
            return
        display = Gdk.Display.get_default()
        monitor = display.get_primary_monitor() or display.get_monitor(0)
        geometry, work = monitor.get_geometry(), monitor.get_workarea()
        self.window.move(geometry.x + geometry.width - WIDTH, work.y + TOP_MARGIN)

    def read(self, stream, condition):
        chunk = os.read(stream.fileno(), 65536)
        if not chunk:
            self.quit()
            return False
        self.input_buffer += chunk
        while b'\n' in self.input_buffer:
            line, self.input_buffer = self.input_buffer.split(b'\n', 1)
            if not self.handle(line):
                return False
        if len(self.input_buffer) > 8 * 1024 * 1024:
            self.quit()
            return False
        return True

    def exclude_from_capture(self):
        # The first banner waits for the rule so its first frame is excluded. Later checks
        # only restore a rule a compositor reload dropped, without stalling the animation.
        if not self.excluded_once:
            self.excluded_once = True
            configure_capture_exclusion()
        else:
            threading.Thread(target=configure_capture_exclusion, daemon=True).start()

    def handle(self, line):
        request = ''
        try:
            data = json.loads(line)
            if not isinstance(data, dict):
                raise ValueError('Request must be an object')
            if data.get('action') == 'exit':
                self.quit()
                return False
            request = data.get('id', '')
            if not isinstance(request, str):
                raise ValueError('Request ID must be a string')
            sound = data.get('sound')
            if isinstance(sound, str) and sound:
                try:
                    subprocess.Popen(['paplay', sound], stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL, stderr=sys.stderr)
                except OSError as error:
                    print(error, file=sys.stderr)
            if data.get('visual') is False:
                if not data.get('preserveBanner'):
                    self.hide()
                return True
            self.exclude_from_capture()
            self.apply(data, request)
            self.animate = self.animations_enabled()
            self.place()
            if wayland:
                self.window.set_visible(True)
            else:
                self.window.show_all()
            self.pass_input()
            if not self.tick_running:
                self.tick_running = True
                GLib.timeout_add(16 if self.animate else 100, self.tick)
            self.area.queue_draw()
        except Exception as error:
            print(error, file=sys.stderr)
            emit('failed', request)
        return True

    tick_running = False

    def apply(self, data, request):
        """Mirror of the Windows notice handler: continue motion from where the banner is."""
        was_visible = self.visible
        now = self.now()
        next_error = bool(data.get('error'))
        next_saving = bool(data.get('saving'))
        status = data.get('recordingStatus') or ''
        try:
            image = load_artwork('' if status else str(data.get('artwork') or ''))
        except Exception as error:
            # Like the Windows banner, unreadable artwork leaves an empty tile rather than losing the banner.
            print('Banner artwork skipped: ' + str(error), file=sys.stderr)
            image = None
        self.message_id = request
        if data.get('pulse'):
            self.record_pulse_at = now
        elif not was_visible:
            self.record_pulse_at = 0
        if not was_visible or (not self.saving and next_saving):
            self.spinning_at = now
        completed = bool(data.get('completed', was_visible and self.saving)) and not next_saving and not next_error
        if was_visible and not self.saving and now - self.started > self.lifetime - 260:
            self.return_background, self.return_content, self.returning_at = self.current_background, self.current_content, now
        elif not was_visible:
            self.returning_at = 0
            self.return_background = self.return_content = 0
        if was_visible and next_saving and not next_error and data.get('replay', True):
            self.refresh_from, self.refreshed_at = self.current_content, now
            self.return_content = 0
        elif not was_visible:
            self.refreshed_at = 0
        if completed:
            self.image_from_scale = self.confirmation_scale(now) if was_visible else 1
            self.confirmed_at, self.completing = now, True
        elif not was_visible or next_error:
            self.completing = False
        title = str(data.get('message') or '')
        subtitle = str(data.get('detail') or 'AcroClip')
        if next_error:
            subtitle = str(data.get('detail') or title) if 'errorTitle' in data else title
            title = str(data.get('errorTitle') or 'AcroClip needs attention')
        self.change_text(title, subtitle, next_error, was_visible, now)
        self.status = status
        self.icon = bool(data.get('artworkIcon'))
        self.image = image
        self.error, self.saving = next_error, next_saving
        self.lifetime = 6500 if next_error else 3200
        self.started = now
        if not was_visible:
            self.entered = now
        self.shown_reported = False
        self.visible = True

    def change_text(self, title, subtitle, failure, visible, now):
        if visible and (title != self.text or subtitle != self.detail or failure != self.error):
            # Retarget a pending change rather than queuing flashes for every update.
            if not self.text_transition or now - self.text_changed_at >= 65:
                current = self.text_frame(now)
                self.previous_text, self.previous_detail, self.previous_error = current[0], current[1], current[2]
                self.text_from_opacity, self.text_changed_at, self.text_transition = current[3], now, True
        elif not visible:
            self.text_transition = False
        self.text, self.detail = title, subtitle

    def text_frame(self, now):
        if not self.text_transition or not self.animate:
            return self.text, self.detail, self.error, 1, 0
        age = now - self.text_changed_at
        if age < 65:
            progress = smooth(age / 65)
            return self.previous_text, self.previous_detail, self.previous_error, self.text_from_opacity * (1 - progress), -2 * progress
        progress = smooth((age - 65) / 115)
        return self.text, self.detail, self.error, progress, 3 * (1 - progress)

    def confirmation_scale(self, now):
        if not self.completing or not self.animate:
            return 1
        age = now - self.confirmed_at
        if age < 55:
            return self.image_from_scale + (.9 - self.image_from_scale) * (1 - (1 - age / 55) ** 3)
        if age < 170:
            return .9 + .125 * smooth((age - 55) / 115)
        if age < 340:
            return 1.025 - .025 * smooth((age - 170) / 170)
        return 1

    def offsets(self, now):
        age = now - self.started
        entry_age = now - self.entered
        leave = max(0, min(1, (age - self.lifetime + 260) / 260)) if self.animate and not self.saving else 0
        remaining = 1 - max(0, min(1, entry_age / 280))
        # A quick reveal with a small overshoot, followed by a damped content settle.
        background_rest = 1.6 * remaining ** 3 - .6 * remaining ** 2
        seconds = entry_age / 1000
        content_rest = 0 if entry_age >= 480 else math.exp(-14 * seconds) * (math.cos(18 * seconds) + 14 / 18 * math.sin(18 * seconds))
        return_rest = 1 - smooth((now - self.returning_at) / 160) if self.returning_at else 0
        background = 408 * background_rest + 408 * leave ** 3 + self.return_background * return_rest
        content = 96 * content_rest
        if self.refreshed_at:
            refresh_age = now - self.refreshed_at
            if refresh_age < 60:
                content = self.refresh_from + (64 - self.refresh_from) * smooth(refresh_age / 60)
            else:
                rest = 1 - max(0, min(1, (refresh_age - 60) / 280))
                content = 64 * (1.6 * rest ** 3 - .6 * rest ** 2)
        content += 96 * leave ** 3 + self.return_content * return_rest
        if not self.animate:
            return 0, 0
        return background, content

    def hide(self):
        self.visible = False
        if self.window:
            if wayland:
                self.window.set_visible(False)
            else:
                self.window.hide()

    def quit(self):
        if wayland:
            self.loop.quit()
        else:
            Gtk.main_quit()

    def tick(self):
        if not self.visible:
            self.tick_running = False
            return False
        if not self.saving and self.now() - self.started >= self.lifetime:
            self.hide()
            self.tick_running = False
            emit('hidden', self.message_id)
            return False
        self.area.queue_draw()
        return True

    def draw_text(self, cr, value, x, y, width, size, bold, color, lines=1):
        layout = PangoCairo.create_layout(cr)
        font = Pango.FontDescription.from_string('Sans Bold' if bold else 'Sans')
        font.set_absolute_size(size * Pango.SCALE)
        layout.set_font_description(font)
        layout.set_text(value, -1)
        layout.set_width(int(width * Pango.SCALE))
        layout.set_ellipsize(Pango.EllipsizeMode.END)
        if lines > 1:
            layout.set_wrap(Pango.WrapMode.WORD_CHAR)
            layout.set_height(-lines)
        cr.set_source_rgba(*color)
        cr.move_to(x, y)
        PangoCairo.show_layout(cr, layout)

    def draw_status(self, cr, now):
        if self.record_pulse_at and self.animate and self.status == 'recording':
            progress = min(1, (now - self.record_pulse_at) / 460)
            radius = 12 + 22 * (1 - (1 - progress) ** 3)
            opacity = (1 - progress) ** 2
            cr.arc(52, 52, radius, 0, math.tau)
            cr.set_source_rgba(*rgb(PURPLE, 22 * opacity))
            cr.fill_preserve()
            cr.set_source_rgba(*rgb(PURPLE, 140 * opacity))
            cr.set_line_width(2.5)
            cr.stroke()
        failed, active, pending = self.status == 'error', self.status == 'recording', self.status == 'starting'
        color = FAILURE if failed else ACTIVE if active else PURPLE if pending else MUTED
        cr.set_line_width(2.5)
        cr.arc(52, 52, 22, 0, math.tau)
        cr.set_source_rgba(*rgb(color, 60))
        cr.stroke()
        cr.set_source_rgba(*rgb(color))
        if pending:
            cr.set_line_cap(cairo.LINE_CAP_ROUND)
            angle = math.radians((now - self.spinning_at) * .28 - 90 if self.animate else -90)
            cr.arc(52, 52, 22, angle, angle + math.radians(250))
            cr.stroke()
            cr.arc(52, 52, 5, 0, math.tau)
            cr.fill()
        elif failed:
            cr.set_line_width(3)
            cr.set_line_cap(cairo.LINE_CAP_ROUND)
            cr.move_to(52, 41)
            cr.line_to(52, 54)
            cr.stroke()
            cr.arc(52, 61.5, 1.5, 0, math.tau)
            cr.fill()
        elif active:
            cr.arc(52, 52, 11, 0, math.tau)
            cr.fill()
        elif self.status == 'paused':
            rounded(cr, 43, 43, 7, 18, 2.5)
            rounded(cr, 54, 43, 7, 18, 2.5)
            cr.fill()
        else:
            rounded(cr, 43, 43, 18, 18, 4)
            cr.fill()

    def draw_thumbnail(self, cr, image_scale, flash):
        side = 64 * image_scale
        inset = 52 - side / 2
        cr.save()
        rounded(cr, inset, inset, side, side, 15 * image_scale)
        cr.set_source_rgb(40 / 255, 37 / 255, 47 / 255)
        cr.fill_preserve()
        cr.clip()
        if self.image:
            width, height = self.image.get_width(), self.image.get_height()
            cr.save()
            if self.icon:
                # An application icon sits inside the tile at the size of the other banner graphics.
                fit = side * .62 / max(width, height)
                cr.translate(52 - width * fit / 2, 52 - height * fit / 2)
            else:
                # A clip thumbnail fills the tile from its center.
                fit = side / min(width, height)
                cr.translate(52 - width * fit / 2, 52 - height * fit / 2)
            cr.scale(fit, fit)
            Gdk.cairo_set_source_pixbuf(cr, self.image, 0, 0)
            cr.get_source().set_filter(cairo.FILTER_GOOD)
            cr.paint()
            cr.restore()
        if flash > 0:
            cr.set_source_rgba(1, 1, 1, flash)
            cr.paint()
        cr.restore()

    def draw_artwork(self, cr, now):
        confirmation_age = now - self.confirmed_at
        confirming = self.completing and self.animate and confirmation_age < 420
        image_scale = self.confirmation_scale(now)
        flash = 0
        if confirming:
            flash = .22 * confirmation_age / 35 if confirmation_age < 35 else .22 * math.exp(-(confirmation_age - 35) / 65)
            pulse = min(1, confirmation_age / 420)
            expansion = 14 * (1 - (1 - pulse) ** 3)
            opacity = (1 - pulse) ** 2
            rounded(cr, 20 - expansion, 20 - expansion, 64 + 2 * expansion, 64 + 2 * expansion, 15 + expansion)
            cr.set_source_rgba(*rgb(PURPLE, 24 * opacity))
            cr.fill_preserve()
            cr.set_source_rgba(*rgb(PURPLE, 110 * opacity))
            cr.set_line_width(2)
            cr.stroke()
        self.draw_thumbnail(cr, image_scale, flash)
        accent = FAILURE if self.error else PURPLE
        cr.set_line_cap(cairo.LINE_CAP_ROUND)
        if self.saving:
            rounded(cr, 20, 20, 64, 64, 15)
            cr.set_source_rgba(17 / 255, 17 / 255, 19 / 255, 125 / 255)
            cr.fill()
            cr.set_line_width(3.5)
            cr.arc(52, 52, 21, 0, math.tau)
            cr.set_source_rgba(235 / 255, 228 / 255, 1, 85 / 255)
            cr.stroke()
            angle = math.radians((now - self.spinning_at) * .28 - 90 if self.animate else -90)
            cr.arc(52, 52, 21, angle, angle + math.radians(265))
            cr.set_source_rgba(*rgb(accent))
            cr.stroke()
        elif self.error:
            cr.arc(73.5, 73.5, 12.5, 0, math.tau)
            cr.set_source_rgb(28 / 255, 26 / 255, 33 / 255)
            cr.fill()
            cr.set_source_rgba(*rgb(accent))
            cr.set_line_width(2.3)
            cr.move_to(73.5, 67)
            cr.line_to(73.5, 74)
            cr.move_to(73.5, 78)
            cr.line_to(73.5, 78.3)
            cr.stroke()

    def draw(self, cr):
        try:
            cr.set_operator(cairo.OPERATOR_SOURCE)
            cr.set_source_rgba(0, 0, 0, 0)
            cr.paint()
            cr.set_operator(cairo.OPERATOR_OVER)
            if not self.visible:
                return
            now = self.now()
            background, content = self.offsets(now)
            self.current_background, self.current_content = background, content
            cr.translate(12, 12)
            # The shadow follows the moving card, without an outline.
            cr.save()
            cr.translate(0, 3)
            card(cr, background)
            cr.set_line_join(cairo.LINE_JOIN_ROUND)
            for spread in range(24, 3, -4):
                cr.set_source_rgba(0, 0, 0, 8 / 255)
                cr.set_line_width(spread)
                cr.stroke_preserve()
            cr.new_path()
            cr.restore()
            card(cr, background)
            cr.set_source_rgb(17 / 255, 17 / 255, 19 / 255)
            cr.fill_preserve()
            cr.clip()
            cr.translate(content, 0)
            if self.status:
                self.draw_status(cr, now)
            else:
                self.draw_artwork(cr, now)
            title, subtitle, failure, opacity, offset = self.text_frame(now)
            same_title = self.previous_text == self.text
            self.draw_text(cr, title, 100, 29 + (0 if same_title else offset), 279, 17, True, rgb(INK, 255 * (1 if same_title else opacity)))
            self.draw_text(cr, subtitle, 100, (51 if failure else 57) + offset, 279, 12, False, rgb(MUTED, 255 * opacity), 2 if failure else 1)
            if not self.shown_reported and not render_only and (not self.animate or now - self.entered >= 480):
                self.shown_reported = True
                # Report after the drawing pass reaches GTK.
                GLib.idle_add(self.acknowledge, self.message_id)
        except Exception as error:
            print(error, file=sys.stderr)
            emit('failed', self.message_id)
            self.hide()

    def acknowledge(self, request):
        if request == self.message_id and self.visible and self.window.get_mapped():
            emit('shown', request, visible=True)
        return False

    def run(self):
        if wayland:
            self.loop = GLib.MainLoop()
            self.loop.run()
        else:
            Gtk.main()


def render_proofs():
    """Draw the real banner to PNG without a window or sound, like the Windows --render-proof."""
    for line in sys.stdin:
        value = json.loads(line)
        banner = Banner()
        banner.animate = 'elapsedMs' in value
        base = 10_000_000
        banner.clock = base
        banner.visible = True
        banner.error, banner.saving = bool(value.get('error')), bool(value.get('saving'))
        banner.lifetime = value.get('lifetimeMs', 6500 if banner.error else 3200)
        banner.text = str(value.get('message', 'Clip saved'))
        banner.detail = str(value.get('detail', 'AcroClip'))
        banner.entered = base - value.get('elapsedMs', 1000)
        banner.started = base - value.get('completionAgeMs', value.get('elapsedMs', 1000))
        banner.completing = bool(value.get('completed'))
        banner.confirmed_at = banner.started
        banner.image_from_scale = value.get('imageFromScale', 1)
        banner.record_pulse_at = banner.started if value.get('pulse') else 0
        banner.spinning_at = base - value.get('spinningAgeMs', value.get('elapsedMs', 1000))
        banner.refreshed_at = base - value['refreshAgeMs'] if 'refreshAgeMs' in value else 0
        banner.refresh_from = value.get('refreshFrom', 0)
        banner.text_transition = 'previousMessage' in value
        banner.previous_text = str(value.get('previousMessage', ''))
        banner.previous_detail = str(value.get('previousDetail', ''))
        banner.text_changed_at = base - value.get('textAgeMs', 1000)
        banner.status = value.get('recordingStatus', '') or ''
        banner.icon = bool(value.get('artworkIcon'))
        banner.image = load_artwork('' if banner.status else value.get('artwork', ''))
        scale = float(value.get('scale', 1))
        surface = cairo.ImageSurface(cairo.FORMAT_ARGB32, int(WIDTH * scale), int(HEIGHT * scale))
        cr = cairo.Context(surface)
        cr.scale(scale, scale)
        banner.draw(cr)
        surface.write_to_png(value['proofPath'])


if __name__ == '__main__':
    if render_only:
        render_proofs()
    else:
        Banner().run()
