"""Check actual Cairo thumbnail frames for fixed-center compression and rebound."""
import importlib.util
import pathlib
import sys
from unittest.mock import patch

import cairo

spec = importlib.util.spec_from_file_location('linux_feedback', pathlib.Path('native/notifications/linux.py'))
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)
banner = module.Banner.__new__(module.Banner)
banner.animate = banner.shown = banner.ack = True
banner.started = banner.changed = banner.content_changed = -1
banner.confirmed = 0
banner.refresh_from = banner.exit_at = banner.text_previous = None
banner.background_from = 440
banner.data = dict(message='Clip saved', detail='Real drawing check', completed=True)
banner.image = module.GdkPixbuf.Pixbuf.new(module.GdkPixbuf.Colorspace.RGB, False, 8, 120, 60)
banner.image.fill(0x00ff00ff)
widths = []
for index, age in enumerate([.001, .055, .17, .34]):
    surface = cairo.ImageSurface(cairo.FORMAT_ARGB32, 440, 132)
    with patch.object(module.time, 'monotonic', return_value=age):
        banner.draw(None, cairo.Context(surface), 440, 132)
    surface.flush()
    raw = surface.get_data()
    pixels = []
    for y in range(132):
        for x in range(440):
            offset = y * surface.get_stride() + x * 4
            b, g, r, a = bytes(raw[offset:offset+4]) if sys.byteorder == 'little' else bytes(raw[offset:offset+4])[::-1]
            if g > r + 50 and g > b + 50 and a > 100:
                pixels.append((x, y))
    # The flash briefly covers the green artwork at the first sample.
    if age < .01:
        continue
    assert pixels
    left, right = min(p[0] for p in pixels), max(p[0] for p in pixels)
    top, bottom = min(p[1] for p in pixels), max(p[1] for p in pixels)
    assert abs((left + right + 1) / 2 - 66) <= .5, (age, left, right)
    assert abs((top + bottom + 1) / 2 - 64) <= .5, (age, top, bottom)
    widths.append(right - left + 1)
assert widths[0] < widths[2] < widths[1], widths
banner.refresh_from = banner.content_offset(.34)
banner.content_changed = .34
assert banner.content_offset(.34) == banner.refresh_from
print('Actual Cairo frames retain thumbnail center through compression and overshoot; replay starts at current position')
