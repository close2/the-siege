#!/usr/bin/env python3
"""Process generated art: art/raw/<id>.png -> client/public/assets/<id>.webp + assets.gen.json

Requires Python 3 with Pillow and numpy.
- Background key colour = median of the outer border (generated backgrounds are never exact #FF00FF).
- Only key-coloured pixels connected to the border become transparent (pink details inside stay).
- Soft edge ramp + despill, trim, resize to manifest outH, WebP output.

Usage: python3 tools/process_art.py [id ...]
"""
import json
import os
import sys

import numpy as np
from PIL import Image

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
RAW = os.path.join(ROOT, 'art', 'raw')
OUT = os.path.join(ROOT, 'client', 'public', 'assets')
MANIFEST = os.path.join(ROOT, 'art', 'manifest.json')

T0 = 60.0   # distance to key: fully transparent below
T1 = 130.0  # fully opaque above
BORDER = 8
POCKET = 45.0  # enclosed pixels closer than this to the key are removed too


def find_raw(asset_id):
    for name in (f'{asset_id}.png', f'{asset_id}_g.png'):
        p = os.path.join(RAW, name)
        if os.path.exists(p):
            return p
    return None


def key_out(img):
    rgb = np.asarray(img.convert('RGB')).astype(np.float32)
    h, w, _ = rgb.shape
    border = np.concatenate([
        rgb[:BORDER].reshape(-1, 3), rgb[-BORDER:].reshape(-1, 3),
        rgb[:, :BORDER].reshape(-1, 3), rgb[:, -BORDER:].reshape(-1, 3)])
    key = np.median(border, axis=0)
    d = np.sqrt(((rgb - key) ** 2).sum(axis=2))
    near = d < T1

    # flood fill from border through "near" pixels (iterative dilation)
    bg = np.zeros_like(near)
    bg[0, :] = near[0, :]
    bg[-1, :] = near[-1, :]
    bg[:, 0] |= near[:, 0]
    bg[:, -1] |= near[:, -1]
    for _ in range(4000):
        grown = bg.copy()
        grown[1:, :] |= bg[:-1, :]
        grown[:-1, :] |= bg[1:, :]
        grown[:, 1:] |= bg[:, :-1]
        grown[:, :-1] |= bg[:, 1:]
        grown &= near
        if np.array_equal(grown, bg):
            break
        bg = grown

    # enclosed pockets (e.g. gaps between tower posts): pixels almost exactly the key colour
    pocket = (d < POCKET) & ~bg
    bg |= pocket

    alpha = np.full((h, w), 255.0, dtype=np.float32)
    ramp = np.clip((d - T0) / (T1 - T0), 0, 1) * 255
    alpha[bg] = ramp[bg]

    # despill on edge pixels: bg region plus a 2px ring
    ring = bg.copy()
    for _ in range(2):
        g = ring.copy()
        g[1:, :] |= ring[:-1, :]
        g[:-1, :] |= ring[1:, :]
        g[:, 1:] |= ring[:, :-1]
        g[:, :-1] |= ring[:, 1:]
        ring = g
    out = rgb.copy()
    r, gch, b = out[..., 0], out[..., 1], out[..., 2]
    if key[0] > key[1] and key[2] > key[1]:  # magenta-ish
        spill = np.maximum(np.minimum(r, b) - gch, 0)
        r[ring] -= spill[ring]
        b[ring] -= spill[ring]
    elif key[1] > key[0] and key[1] > key[2]:  # green-ish
        spill = np.maximum(gch - np.maximum(r, b), 0)
        gch[ring] -= spill[ring]
    rgba = np.dstack([out, alpha]).clip(0, 255).astype(np.uint8)
    return Image.fromarray(rgba, 'RGBA')


def trim(img, pad=4):
    a = np.asarray(img)[..., 3]
    ys, xs = np.where(a > 8)
    if len(xs) == 0:
        return img
    x0, x1 = max(0, xs.min() - pad), min(img.width, xs.max() + 1 + pad)
    y0, y1 = max(0, ys.min() - pad), min(img.height, ys.max() + 1 + pad)
    return img.crop((x0, y0, x1, y1))


def resize_h(img, out_h):
    if img.height <= out_h:
        return img
    w = max(1, round(img.width * out_h / img.height))
    return img.resize((w, out_h), Image.LANCZOS)


def anchor_for(kind, img):
    if kind == 'center':
        return 0.5, 0.5
    if kind == 'base':
        # base ellipse (3/4 view): half-height ~ width/4 → centre of base sits that far above the bottom
        ay = 1 - (img.width / 4.6) / img.height
        return 0.5, round(max(0.55, min(0.92, ay)), 3)
    return 0.5, 0.97


def main():
    manifest = {k: v for k, v in json.load(open(MANIFEST)).items() if not k.startswith('_')}
    only = set(sys.argv[1:])
    os.makedirs(OUT, exist_ok=True)
    gen_path = os.path.join(OUT, 'assets.gen.json')
    gen = json.load(open(gen_path)) if os.path.exists(gen_path) else {}
    missing = []
    for asset_id, spec in manifest.items():
        if only and asset_id not in only:
            continue
        src = find_raw(asset_id)
        if not src:
            missing.append(asset_id)
            gen.pop(asset_id, None)
            continue
        img = Image.open(src)
        kind = spec['kind']
        if kind in ('background', 'keyart'):
            img = resize_h(img.convert('RGB'), spec['outH'])
            ax, ay = 0.5, 0.5
            quality = 85
        else:
            img = resize_h(trim(key_out(img)), spec['outH'])
            if asset_id == 'ui_panel':
                arr = np.asarray(img).astype(np.float32)
                h, w, _ = arr.shape
                b = int(min(h, w) * 0.175)
                inner = arr[b:h - b, b:w - b, :3]
                # lift dark-green bottom shading toward warm parchment while keeping paper grain
                parch = np.array([228.0, 198.0, 136.0], dtype=np.float32)
                lum = inner.mean(axis=2, keepdims=True) / 200.0
                grain = np.clip((lum - 0.5) * 0.35 + 1.0, 0.85, 1.08)
                arr[b:h - b, b:w - b, :3] = np.clip(inner * 0.25 + parch * grain * 0.75, 0, 255)
                img = Image.fromarray(arr.astype(np.uint8), 'RGBA')
            ax, ay = anchor_for(spec.get('anchor', 'bottom'), img)
            quality = 90
        dst = os.path.join(OUT, f'{asset_id}.webp')
        img.save(dst, 'WEBP', quality=quality, method=6)
        gen[asset_id] = {'w': img.width, 'h': img.height, 'anchorX': ax, 'anchorY': ay}
        print(f'{asset_id:28s} {img.width}x{img.height}  anchor {ax},{ay}')
    json.dump(dict(sorted(gen.items())), open(gen_path, 'w'), indent=1)
    icon_src = find_raw('app_icon')
    if icon_src and (not only or 'app_icon' in only):
        pub = os.path.dirname(OUT)
        ic = Image.open(icon_src).convert('RGBA')
        for sz in (192, 512):
            ic.resize((sz, sz), Image.LANCZOS).save(os.path.join(pub, f'icon-{sz}.png'), 'PNG')
        print('app_icon                     192x192 & 512x512 PNG icons')
    if missing:
        print('missing raw files:', ', '.join(missing))


if __name__ == '__main__':
    main()
