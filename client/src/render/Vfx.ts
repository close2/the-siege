// Pooled particle effects + floating text. Renderer-only (Math.random is fine here).
import { Container, Sprite, Text, Texture } from 'pixi.js';

interface Particle {
  sprite: Sprite;
  vx: number;
  vy: number;
  gravity: number;
  drag: number;
  life: number;
  maxLife: number;
  s0: number;
  s1: number;
  a0: number;
  active: boolean;
}

interface FloatText {
  text: Text;
  vy: number;
  life: number;
  maxLife: number;
}

export class Vfx {
  private pool: Particle[] = [];
  private texts: FloatText[] = [];

  constructor(
    private layer: Container,
    private textLayer: Container,
    private dot: Texture,
  ) {}

  private emit(x: number, y: number, o: { color: number; vx: number; vy: number; life: number; s0: number; s1: number; a0?: number; gravity?: number; drag?: number; add?: boolean }) {
    let p = this.pool.find((q) => !q.active);
    if (!p) {
      if (this.pool.length > 1500) return;
      const sprite = new Sprite(this.dot);
      sprite.anchor.set(0.5);
      this.layer.addChild(sprite);
      p = { sprite, vx: 0, vy: 0, gravity: 0, drag: 0, life: 0, maxLife: 1, s0: 1, s1: 1, a0: 1, active: false };
      this.pool.push(p);
    }
    p.active = true;
    p.sprite.visible = true;
    p.sprite.position.set(x, y);
    p.sprite.tint = o.color;
    p.sprite.blendMode = o.add ? 'add' : 'normal';
    p.vx = o.vx;
    p.vy = o.vy;
    p.gravity = o.gravity ?? 0;
    p.drag = o.drag ?? 0;
    p.life = p.maxLife = o.life;
    p.s0 = o.s0;
    p.s1 = o.s1;
    p.a0 = o.a0 ?? 1;
  }

  update(dt: number) {
    for (const p of this.pool) {
      if (!p.active) continue;
      p.life -= dt;
      if (p.life <= 0) {
        p.active = false;
        p.sprite.visible = false;
        continue;
      }
      p.vy += p.gravity * dt;
      const k = 1 - p.drag * dt;
      p.vx *= k;
      p.vy *= k;
      p.sprite.x += p.vx * dt;
      p.sprite.y += p.vy * dt;
      const t = 1 - p.life / p.maxLife;
      const s = (p.s0 + (p.s1 - p.s0) * t) / 64;
      p.sprite.scale.set(s);
      p.sprite.alpha = p.a0 * (1 - t);
    }
    for (let i = this.texts.length - 1; i >= 0; i--) {
      const f = this.texts[i];
      f.life -= dt;
      f.text.y += f.vy * dt;
      f.vy *= 1 - 2 * dt;
      f.text.alpha = Math.min(1, (f.life / f.maxLife) * 2);
      if (f.life <= 0) {
        f.text.destroy();
        this.texts.splice(i, 1);
      }
    }
  }

  clear() {
    for (const p of this.pool) {
      p.active = false;
      p.sprite.visible = false;
    }
    for (const f of this.texts) f.text.destroy();
    this.texts = [];
  }

  private rnd(a: number, b: number) {
    return a + Math.random() * (b - a);
  }

  sparks(x: number, y: number, color = 0xffd27a, n = 6) {
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2;
      const sp = this.rnd(60, 160);
      this.emit(x, y, { color, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp - 40, life: this.rnd(0.2, 0.4), s0: 7, s1: 2, gravity: 300, add: true });
    }
  }

  dust(x: number, y: number, n = 8, color = 0xcbb894) {
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2;
      const sp = this.rnd(20, 60);
      this.emit(x + this.rnd(-8, 8), y, { color, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp * 0.4 - 10, life: this.rnd(0.5, 0.9), s0: 14, s1: 30, a0: 0.6, drag: 2 });
    }
  }

  smoke(x: number, y: number) {
    this.emit(x + this.rnd(-10, 10), y, { color: 0x3a3532, vx: this.rnd(-6, 6), vy: this.rnd(-30, -18), life: this.rnd(1.2, 2), s0: 14, s1: 42, a0: 0.45 });
  }

  fire(x: number, y: number) {
    this.emit(x + this.rnd(-12, 12), y, { color: Math.random() < 0.5 ? 0xff7a1a : 0xffc23a, vx: this.rnd(-8, 8), vy: this.rnd(-60, -30), life: this.rnd(0.3, 0.6), s0: 16, s1: 4, add: true });
  }

  magicTrail(x: number, y: number, color = 0x7fd4ff) {
    this.emit(x, y, { color, vx: this.rnd(-10, 10), vy: this.rnd(-10, 10), life: 0.25, s0: 12, s1: 2, add: true });
  }

  magicBolt(from: { x: number; y: number }, to: { x: number; y: number }, t = 1, color = 0x7fd4ff) {
    const steps = 12;
    for (let i = 0; i <= steps; i++) {
      const u = (i / steps) * Math.max(0.05, Math.min(1, t));
      const x = from.x + (to.x - from.x) * u;
      const y = from.y + (to.y - from.y) * u - 30 * 4 * u * (1 - u);
      this.magicTrail(x, y, color);
    }
    const hx = from.x + (to.x - from.x) * t;
    const hy = from.y + (to.y - from.y) * t - 30 * 4 * t * (1 - t);
    this.burst(hx, hy, color, 8, 12);
  }

  burst(x: number, y: number, color: number, n = 10, size = 14) {
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2;
      const sp = this.rnd(50, 110);
      this.emit(x, y, { color, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, life: this.rnd(0.25, 0.45), s0: size, s1: 2, drag: 3, add: true });
    }
  }

  healGlow(x: number, y: number) {
    for (let i = 0; i < 5; i++) this.emit(x + this.rnd(-14, 14), y - this.rnd(0, 20), { color: 0xfff0a0, vx: 0, vy: this.rnd(-40, -20), life: 0.7, s0: 10, s1: 3, add: true });
  }

  coinBurst(x: number, y: number) {
    for (let i = 0; i < 8; i++) this.emit(x, y, { color: 0xffd23a, vx: this.rnd(-70, 70), vy: this.rnd(-160, -90), life: 0.8, s0: 9, s1: 7, gravity: 380, add: false });
  }

  splash(x: number, y: number, r: number) {
    this.dust(x, y, 14, 0x8f7a5a);
    for (let i = 0; i < 12; i++) {
      const a = (i / 12) * Math.PI * 2;
      this.emit(x + Math.cos(a) * r * 0.3, y + Math.sin(a) * r * 0.15, { color: 0x6e5a40, vx: Math.cos(a) * 80, vy: Math.sin(a) * 40 - 60, life: 0.5, s0: 8, s1: 3, gravity: 300 });
    }
  }

  floatingText(x: number, y: number, text: string, color = 0xffffff, size = 16) {
    if (this.texts.length > 80) return;
    const t = new Text({ text, style: { fontSize: size, fontWeight: '900', fill: color, stroke: { color: 0x1a0f08, width: 4 } } });
    t.anchor.set(0.5, 1);
    t.position.set(x + this.rnd(-6, 6), y);
    this.textLayer.addChild(t);
    this.texts.push({ text: t, vy: -50, life: 0.9, maxLife: 0.9 });
  }
}
