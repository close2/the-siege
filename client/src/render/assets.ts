// Texture store: real art from /assets/*.webp (listed in /assets/assets.gen.json), placeholders otherwise.
import { Assets, Container, Graphics, Rectangle, Renderer, Text, Texture } from 'pixi.js';
import { ART, type ArtSpec } from '../content/artSpec';

export interface ArtTexture {
  texture: Texture;
  /** scale factor to reach the spec display height */
  scale: number;
  anchorX: number;
  anchorY: number;
  placeholder: boolean;
}

interface GenEntry {
  w: number;
  h: number;
  anchorX: number;
  anchorY: number;
}

export class AssetStore {
  private cache = new Map<string, ArtTexture>();
  private available = new Set<string>();
  private gen: Record<string, GenEntry> = {};
  softDot!: Texture;

  constructor(private renderer: Renderer) {}

  async init() {
    try {
      const res = await fetch('/assets/assets.gen.json');
      if (res.ok) {
        this.gen = (await res.json()) as Record<string, GenEntry>;
        for (const id of Object.keys(this.gen)) this.available.add(id);
      }
    } catch {
      /* no generated art yet */
    }
    const ids = [...this.available];
    await Promise.all(
      ids.map(async (id) => {
        try {
          const tex = (await Assets.load(`/assets/${id}.webp`)) as Texture;
          const spec = ART[id];
          const scale = spec ? spec.h / tex.height : 1;
          const g = this.gen[id];
          this.cache.set(id, { texture: tex, scale, anchorX: g?.anchorX ?? 0.5, anchorY: g?.anchorY ?? 0.95, placeholder: false });
        } catch {
          this.available.delete(id);
        }
      }),
    );
    this.softDot = this.makeSoftDot();
  }

  /** URL of a processed asset for use in DOM/CSS (null if not generated yet). */
  static url(id: string): string {
    return `/assets/${id}.webp`;
  }

  has(id: string): boolean {
    return this.available.has(id);
  }

  get(id: string): ArtTexture {
    let t = this.cache.get(id);
    if (!t) {
      t = this.makePlaceholder(id, ART[id]);
      this.cache.set(id, t);
    }
    return t;
  }

  private makeSoftDot(): Texture {
    const c = document.createElement('canvas');
    c.width = c.height = 64;
    const ctx = c.getContext('2d')!;
    const g = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
    g.addColorStop(0, 'rgba(255,255,255,1)');
    g.addColorStop(0.4, 'rgba(255,255,255,0.6)');
    g.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, 64, 64);
    return Texture.from(c);
  }

  private makePlaceholder(id: string, spec: ArtSpec | undefined): ArtTexture {
    const s: ArtSpec = spec ?? { kind: 'unit', h: 40, color: 0xff00ff, label: id };
    const H = s.h * 2; // render at 2x for crispness
    const c = new Container();
    const g = new Graphics();
    c.addChild(g);
    let w = H;
    switch (s.kind) {
      case 'unit': {
        w = H * 0.7;
        g.roundRect(0, H * 0.25, w, H * 0.75, w * 0.3).fill(s.color).stroke({ width: 3, color: 0x2a1a10 });
        g.circle(w / 2, H * 0.25, w * 0.32).fill(s.color).stroke({ width: 3, color: 0x2a1a10 });
        // eye → shows facing (right)
        g.circle(w * 0.68, H * 0.22, w * 0.07).fill(0xffffff);
        break;
      }
      case 'building':
      case 'keep': {
        w = H * 0.75;
        g.ellipse(w / 2, H * 0.9, w / 2, H * 0.1).fill(0x8d8a80);
        g.rect(w * 0.15, H * 0.25, w * 0.7, H * 0.65).fill(s.color).stroke({ width: 4, color: 0x2a1a10 });
        g.poly([w * 0.05, H * 0.27, w / 2, 0, w * 0.95, H * 0.27]).fill(0x6b3b2a).stroke({ width: 4, color: 0x2a1a10 });
        break;
      }
      case 'pad': {
        w = H * 2;
        g.ellipse(w / 2, H / 2, w / 2 - 2, H / 2 - 2).fill(s.color).stroke({ width: 3, color: 0x5a574e });
        break;
      }
      case 'proj': {
        w = H * 5;
        g.rect(0, 0, w, H).fill(s.color);
        break;
      }
      default:
        g.rect(0, 0, w, H).fill(s.color);
    }
    if (s.label) {
      const t = new Text({ text: s.label, style: { fontSize: Math.max(12, H * 0.22), fill: 0xffffff, fontWeight: 'bold', stroke: { color: 0x000000, width: 3 } } });
      t.anchor.set(0.5);
      t.position.set(w / 2, H * 0.6);
      c.addChild(t);
    }
    const texture = this.renderer.generateTexture({ target: c, frame: new Rectangle(0, 0, w, H), resolution: 1 });
    c.destroy({ children: true });
    const anchorY = s.kind === 'pad' || s.kind === 'proj' ? 0.5 : s.kind === 'unit' ? 0.95 : 0.9;
    return { texture, scale: 0.5, anchorX: 0.5, anchorY, placeholder: true };
  }
}
