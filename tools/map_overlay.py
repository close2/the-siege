#!/usr/bin/env python3
"""Debug overlay: draws roads, pads, rally points of valley.json onto map_valley.png."""
import json
import os
import sys

from PIL import Image, ImageDraw

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
m = json.load(open(os.path.join(ROOT, 'client/src/content/maps/valley.json')))
im = Image.open(os.path.join(ROOT, 'art/raw/map_valley.png')).convert('RGB')
d = ImageDraw.Draw(im)
for pts in m['roads'].values():
    d.line([(p['x'], p['y']) for p in pts], fill=(255, 0, 0), width=6)
for s in m['sectors']:
    col = (0, 160, 255) if s['ring'] == 'outer' else (255, 220, 0)
    for p in s['pads']:
        d.ellipse([p['x'] - 45, p['y'] - 30, p['x'] + 45, p['y'] + 30], outline=col, width=6)
        d.text((p['x'] - 20, p['y'] - 8), p['id'], fill=(255, 255, 255))
    r = s['rally']
    d.rectangle([r['x'] - 10, r['y'] - 10, r['x'] + 10, r['y'] + 10], fill=(255, 0, 255))
k = m['keep']
d.ellipse([k['x'] - 20, k['y'] - 20, k['x'] + 20, k['y'] + 20], fill=(255, 255, 255))
out = sys.argv[1] if len(sys.argv) > 1 else '/tmp/map_overlay.png'
im.resize((1024, 1024)).save(out)
print(out)
