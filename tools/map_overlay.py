#!/usr/bin/env python3
"""Debug overlay: draws roads, pads, rally points of valley.json onto map_valley.png."""
import json
import os
import sys

from PIL import Image, ImageDraw

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
m = json.load(open(os.path.join(ROOT, 'client/src/content/maps/valley.json')))
im = Image.open(os.path.join(ROOT, 'art/raw/map_valley.png')).convert('RGB')
off = m.get('border', 0)
d = ImageDraw.Draw(im)
if off > 0:
    d.rectangle([off, off, off + m['width'], off + m['height']], outline=(255, 255, 255), width=4)
for pts in m['roads'].values():
    d.line([(p['x'] + off, p['y'] + off) for p in pts], fill=(255, 0, 0), width=6)
for s in m['sectors']:
    col = (0, 160, 255) if s['ring'] == 'outer' else (255, 220, 0)
    for p in s['pads']:
        d.ellipse([p['x'] + off - 45, p['y'] + off - 30, p['x'] + off + 45, p['y'] + off + 30], outline=col, width=6)
        d.text((p['x'] + off - 20, p['y'] + off - 8), p['id'], fill=(255, 255, 255))
    r = s['rally']
    d.rectangle([r['x'] + off - 10, r['y'] + off - 10, r['x'] + off + 10, r['y'] + off + 10], fill=(255, 0, 255))
k = m['keep']
d.ellipse([k['x'] + off - 20, k['y'] + off - 20, k['x'] + off + 20, k['y'] + off + 20], fill=(255, 255, 255))
out = sys.argv[1] if len(sys.argv) > 1 else '/tmp/map_overlay.png'
preview_h = 1024
preview_w = max(1, round(im.width * preview_h / im.height))
im.resize((preview_w, preview_h)).save(out)
print(out)
