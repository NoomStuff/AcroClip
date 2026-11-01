#!/usr/bin/env python3
"""Optional host GTK banner. No distro assumptions; failures use the parent fallback."""
import base64
import json
import math
import os
import subprocess
import sys
import time

import ctypes

wayland = bool(os.environ.get('WAYLAND_DISPLAY')) and os.environ.get('GDK_BACKEND') != 'x11'
if wayland:
    ctypes.CDLL('libgtk4-layer-shell.so.0', mode=ctypes.RTLD_GLOBAL)
import gi
gi.require_version('PangoCairo', '1.0')
gi.require_version('Gtk', '4.0' if wayland else '3.0')
from gi.repository import Gtk, Gdk, GLib, GdkPixbuf, Pango, PangoCairo
if wayland:
    gi.require_version('Gtk4LayerShell', '1.0')
    from gi.repository import Gtk4LayerShell as Layer


def emit(event, request, **extra):
    print(json.dumps(dict(event=event, id=request, **extra)), flush=True)


class Banner:
    def __init__(self):
        if wayland:
            Gtk.init()
            self.window = Gtk.Window()
            if not Layer.is_supported():
                raise RuntimeError('Compositor has no layer-shell support')
        else:
            if not Gtk.init_check()[0]:
                raise RuntimeError('No X11 display')
            if not Gdk.Screen.get_default().is_composited():
                raise RuntimeError('X11 desktop has no compositing manager')
        if not wayland:
            self.window = Gtk.Window()
        self.window.set_title('AcroClip feedback')
        self.window.set_decorated(False)
        self.window.set_default_size(440, 132)
        self.window.set_resizable(False)
        self.area = Gtk.DrawingArea()
        self.data = {}
        self.input_buffer = b""
        self.image = None
        self.started = self.changed = time.monotonic()
        self.deadline = None
        self.shown = False
        self.ack = False
        self.exit_at = None
        if wayland:
            Layer.init_for_window(self.window)
            Layer.set_namespace(self.window, 'acroclip-feedback')
            Layer.set_layer(self.window, Layer.Layer.OVERLAY)
            Layer.set_anchor(self.window, Layer.Edge.RIGHT, True)
            Layer.set_anchor(self.window, Layer.Edge.TOP, True)
            Layer.set_margin(self.window, Layer.Edge.TOP, 64)
            Layer.set_keyboard_mode(self.window, Layer.KeyboardMode.NONE)
            self.area.set_draw_func(self.draw)
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
            monitor = Gdk.Display.get_default().get_primary_monitor() or Gdk.Display.get_default().get_monitor(0)
            rect = monitor.get_workarea()
            self.window.move(rect.x + rect.width - 440, rect.y + 64)
            self.area.connect('draw', lambda area, cr: self.draw(area, cr, 440, 132))
            self.window.add(self.area)
        provider = Gtk.CssProvider()
        css = b'window { background: transparent; }'
        provider.load_from_data(css.decode() if wayland else css)
        if wayland:
            Gtk.StyleContext.add_provider_for_display(Gdk.Display.get_default(), provider, 800)
        else:
            Gtk.StyleContext.add_provider_for_screen(Gdk.Screen.get_default(), provider, 800)
        GLib.io_add_watch(sys.stdin, GLib.IO_IN | GLib.IO_HUP, self.read)
        GLib.timeout_add(16, self.tick)

    def read(self, stream, condition):
        chunk = os.read(stream.fileno(), 65536)
        if not chunk:
            self.quit()
            return False
        self.input_buffer += chunk
        while b"\n" in self.input_buffer:
            line, self.input_buffer = self.input_buffer.split(b"\n", 1)
            if not self.handle(line):
                return False
        if len(self.input_buffer) > 8 * 1024 * 1024:
            self.quit()
            return False
        return True

    def handle(self, line):
        request = ''
        try:
            data = json.loads(line)
            request = data.get('id', '')
            if data.get('action') == 'exit':
                self.quit()
                return False
            if not isinstance(request, str):
                raise ValueError('Request ID must be a string')
            if data.get('sound'):
                try:
                    subprocess.Popen(['paplay', data['sound']], stdout=subprocess.DEVNULL, stderr=sys.stderr)
                except OSError as error:
                    print(error, file=sys.stderr)
            if data.get('visual') is False:
                if not data.get('preserveBanner'):
                    self.window.hide()
                    self.shown = False
                return True
            now = time.monotonic()
            if not self.shown:
                self.started = now
            if data.get("replay") or data.get("message") != self.data.get("message") or data.get("completed") or data.get("pulse"):
                self.changed = now
            self.exit_at = None
            self.data = data
            self.ack = False
            self.image = None
            artwork = data.get('artwork', '')
            if artwork and not data.get('recordingStatus'):
                raw = base64.b64decode(artwork.split(',', 1)[1], validate=True)
                loader = GdkPixbuf.PixbufLoader()
                loader.write(raw)
                loader.close()
                self.image = loader.get_pixbuf()
            self.deadline = None if data.get('saving') else now + (5 if data.get('error') else 3)
            self.shown = True
            if wayland:
                self.window.set_visible(True)
            else:
                self.window.show_all()
            self.area.queue_draw()
        except Exception as error:
            print(error, file=sys.stderr)
            emit('failed', request)
        return True

    def quit(self):
        if wayland:
            self.loop.quit()
        else:
            Gtk.main_quit()

    def tick(self):
        if self.shown:
            now = time.monotonic()
            if self.deadline and now >= self.deadline and self.exit_at is None:
                self.exit_at = now
            if self.exit_at and now - self.exit_at > .25:
                self.window.hide()
                self.shown = False
                emit('hidden', self.data['id'])
            else:
                self.area.queue_draw()
        return True

    def text(self, cr, value, x, y, size, color):
        layout = PangoCairo.create_layout(cr)
        layout.set_font_description(Pango.FontDescription('Sans ' + size))
        layout.set_text(value, -1)
        layout.set_width(285 * Pango.SCALE)
        layout.set_ellipsize(Pango.EllipsizeMode.END)
        cr.set_source_rgba(*color)
        cr.move_to(x, y)
        PangoCairo.show_layout(cr, layout)

    def draw(self, area, cr, width, height):
        import cairo
        try:
            cr.set_operator(cairo.OPERATOR_SOURCE)
            cr.set_source_rgba(0, 0, 0, 0)
            cr.paint()
            cr.set_operator(cairo.OPERATOR_OVER)
            if not self.shown:
                return
            now = time.monotonic()
            entrance = min(1, (now - self.started) / .38)
            content = min(1, (now - self.changed) / .32)
            offset = 440 * (1 - entrance) ** 3
            if self.exit_at:
                offset = 440 * min(1, (now - self.exit_at) / .25) ** 2
            cr.translate(offset, 0)
            for radius in range(12, 0, -1):
                cr.set_source_rgba(0, 0, 0, .012)
                cr.rectangle(16 - radius, 16 - radius, 440 + radius, 96 + 2 * radius)
                cr.fill()
            cr.rectangle(16, 16, 424, 96)
            cr.set_source_rgb(.075, .075, .085)
            cr.fill_preserve()
            cr.clip()
            cr.translate(28 * (1 - content) ** 3, 0)
            age = now - self.changed
            pulse = bool(self.data.get('completed') or self.data.get('pulse')) and not self.data.get('saving')
            scale = 1 - .14 * math.sin(min(1, age / .32) * math.pi) if pulse else 1
            cr.save()
            cr.translate(66, 64)
            cr.scale(scale, scale)
            if self.image:
                cr.save()
                cr.rectangle(-30, -30, 60, 60)
                cr.clip()
                cr.scale(60 / self.image.get_width(), 60 / self.image.get_height())
                Gdk.cairo_set_source_pixbuf(cr, self.image, -self.image.get_width() / 2, -self.image.get_height() / 2)
                cr.paint()
                cr.restore()
            else:
                cr.set_source_rgb(.72, .52, 1)
                cr.set_line_width(3)
                if self.data.get('saving'):
                    cr.arc(0, 0, 18, now * 5, now * 5 + 4.5)
                    cr.stroke()
                elif self.data.get('error'):
                    self.text(cr, '!', -5, -20, 'bold 24', (1, .4, .4, 1))
                elif self.data.get('recordingStatus') == 'stopped':
                    cr.rectangle(-12, -12, 24, 24)
                    cr.fill()
                else:
                    cr.arc(0, 0, 15, 0, math.tau)
                    cr.fill()
            if pulse and age < .55:
                cr.set_source_rgba(1, 1, 1, max(0, 1 - age / .18) * .8)
                if self.image:
                    cr.rectangle(-30, -30, 60, 60)
                else:
                    cr.arc(0, 0, 18, 0, math.tau)
                cr.fill()
            cr.restore()
            if pulse and age < .6:
                cr.set_source_rgba(.65, .4, 1, 1 - age / .6)
                cr.set_line_width(2)
                cr.arc(66, 64, 30 + 30 * age / .6, 0, math.tau)
                cr.stroke()
            alpha = 1 - (1 - content) ** 2
            self.text(cr, self.data.get('message', ''), 112, 40, 'bold 13', (1, 1, 1, alpha))
            self.text(cr, self.data.get('detail', ''), 112, 66, '10', (.65, .65, .7, alpha))
            if not self.ack and entrance >= 1:
                self.ack = True
                # A frame-clock callback runs after the drawing pass reaches GTK.
                GLib.idle_add(self.acknowledge, self.data['id'])
        except Exception as error:
            print(error, file=sys.stderr)
            emit('failed', self.data.get('id', ''))

    def acknowledge(self, request):
        if request == self.data.get('id') and self.window.get_mapped():
            emit('shown', request, visible=True)
        return False

    def run(self):
        if wayland:
            self.loop = GLib.MainLoop()
            self.loop.run()
        else:
            Gtk.main()


if __name__ == '__main__':
    Banner().run()
