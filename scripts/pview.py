#!/usr/bin/env python3
"""Look at build/shot.png (or another screenshot) without needing eyes on the host.

  scripts/pview.py                 # crop the panel band -> build/panel.png
  scripts/pview.py --runs          # text/icon clusters in the band, with x ranges
  scripts/pview.py --box=x,y,w,h   # crop that region instead of the band
  scripts/pview.py --full          # scale the whole picture to build/panel.png

The panel band is found by scanning the bottom (and top) rows for a mostly
uniform dark strip, so the crop works regardless of where the panel sits.
"""
import sys
from PIL import Image

path = 'build/shot.png'
args = sys.argv[1:]
opts = [a for a in args if a.startswith('--')]
pos = [a for a in args if not a.startswith('--')]
if pos:
    path = pos[0]

im = Image.open(path).convert('RGB')
w, h = im.size


def is_dark(p):
    return p[0] < 60 and p[1] < 60 and p[2] < 60


def band_rows():
    """Rows that are dark across most of the width (the panel)."""
    rows = []
    for y in range(h):
        if y > 900 and y < h - 900:      # only the top and bottom strips matter
            continue
        probe = [im.getpixel((x, y)) for x in range(0, w, max(1, w // 80))]
        if sum(1 for p in probe if is_dark(p)) / len(probe) > 0.9:
            rows.append(y)
    return rows


rows = band_rows()
if rows:
    top, bottom = min(rows), max(rows)
    print(f'panel band: y={top}..{bottom} ({bottom - top + 1}px tall, {w}px wide)')
else:
    top, bottom = h - 90, h
    print('no uniform dark band found, using the bottom of the image')

if '--full' in opts:
    out = im.resize((w // 2, h // 2), Image.LANCZOS)
elif any(a.startswith('--box=') for a in opts):
    a = next(a for a in opts if a.startswith('--box='))
    x, y, wd, ht = (int(v) for v in a.split('=', 1)[1].split(','))
    out = im.crop((x, y, x + wd, y + ht))
    out = out.resize((out.width * 2, out.height * 2), Image.LANCZOS)
else:
    out = im.crop((0, max(0, top - 6), w, min(h, bottom + 8)))
    out = out.resize((out.width, out.height * 2), Image.LANCZOS)

out.save('build/panel.png')
print(f'cropped -> build/panel.png ({out.width}x{out.height})')

if '--runs' in opts:
    mid = (top + bottom) // 2
    cols = [(x, max(im.getpixel((x, y))[1] for y in range(top, bottom + 1, 3)))
            for x in range(w)]
    lit = [x for x, v in cols if v > 110]
    runs, start = [], None
    previous = None
    for x in lit:
        if previous is not None and x > previous + 8:
            runs.append((start, previous))
            start = x
        previous = x
    if start is not None:
        runs.append((start, previous))
    for x0, x1 in runs:
        print(f'  x={x0:5d}-{x1:<5d} width={x1 - x0 + 1}')
