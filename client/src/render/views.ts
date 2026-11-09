// Sprite views with procedural animation (art is static; all motion is code).
import { Container, Graphics, Rectangle, Sprite, type Texture } from 'pixi.js';
import type { ArtTexture } from './assets';

function drawBar(g: Graphics, w: number, frac: number, color: number) {
  g.clear();
  if (frac >= 0.999 || frac <= 0) return;
  g.rect(-w / 2 - 1, -1, w + 2, 6).fill({ color: 0x140c08, alpha: 0.85 });
  g.rect(-w / 2, 0, w * frac, 4).fill(color);
}

export class UnitView extends Container {
  readonly body: Sprite;
  private readonly shadow: Graphics;
  private readonly bar: Graphics;
  private idle: ArtTexture;
  private attackTex: ArtTexture | null;
  private facing: 1 | -1 = 1;
  private phase = Math.random() * 10;
  private lunge = 0;
  private flash = 0;
  private pose = 0;
  private hover: number;
  private barColor: number;
  dying = -1;
  prevX = 0;
  prevY = 0;
  curX = 0;
  curY = 0;
  hp = 1;
  maxHp = 1;
  readonly bodyH: number;

  constructor(idle: ArtTexture, attack: ArtTexture | null, opts: { flying?: boolean; enemy?: boolean; big?: boolean }) {
    super();
    this.idle = idle;
    this.attackTex = attack;
    this.hover = opts.flying ? 34 : 0;
    this.barColor = opts.enemy ? 0xe0413a : 0x5fd35a;
    this.shadow = new Graphics();
    const sw = opts.big ? 46 : 14;
    this.shadow.ellipse(0, 0, sw, sw * 0.38).fill({ color: 0x000000, alpha: opts.flying ? 0.15 : 0.28 });
    this.addChild(this.shadow);
    this.body = new Sprite(idle.texture);
    this.body.anchor.set(idle.anchorX, idle.anchorY);
    this.body.scale.set(idle.scale);
    this.addChild(this.body);
    this.bodyH = idle.texture.height * idle.scale;
    this.bar = new Graphics();
    this.bar.y = -this.bodyH - this.hover - 8;
    this.addChild(this.bar);
  }

  place(x: number, y: number) {
    this.prevX = this.curX = x;
    this.prevY = this.curY = y;
    this.position.set(x, y);
  }

  setTarget(x: number, y: number) {
    this.prevX = this.curX;
    this.prevY = this.curY;
    this.curX = x;
    this.curY = y;
  }

  setFacing(f: number) {
    if (f > 0.05) this.facing = 1;
    else if (f < -0.05) this.facing = -1;
  }

  hit() {
    this.flash = 0.09;
  }

  attack(towardX?: number) {
    if (towardX !== undefined) this.setFacing(towardX - this.x);
    this.lunge = 0.2;
    if (this.attackTex) this.pose = 0.28;
  }

  die() {
    this.dying = 0.5;
    this.bar.clear();
  }

  /** alpha = interpolation between prev and cur sim tick. Returns false when the view can be removed. */
  update(dt: number, alpha: number): boolean {
    const x = this.prevX + (this.curX - this.prevX) * alpha;
    const y = this.prevY + (this.curY - this.prevY) * alpha;
    const moving = Math.abs(this.curX - this.prevX) + Math.abs(this.curY - this.prevY) > 0.05;
    this.position.set(x, y);
    this.zIndex = y;

    const tex = this.pose > 0 && this.attackTex ? this.attackTex : this.idle;
    if (this.body.texture !== tex.texture) {
      this.body.texture = tex.texture as Texture;
      this.body.anchor.set(tex.anchorX, tex.anchorY);
    }
    const sc = tex.scale;

    let bob = 0;
    let rot = 0;
    let sy = 1;
    if (this.dying >= 0) {
      this.dying -= dt;
      const t = 1 - Math.max(0, this.dying) / 0.5;
      this.body.rotation = this.facing * -0.9 * t;
      this.body.alpha = 1 - t;
      this.body.y = -this.hover * (1 - t) + 6 * t;
      this.shadow.alpha = 1 - t;
      return this.dying > 0;
    }
    if (moving) {
      this.phase += dt * 11;
      bob = Math.abs(Math.sin(this.phase)) * 3.5;
      rot = Math.sin(this.phase) * 0.07;
      sy = 1 + Math.abs(Math.cos(this.phase)) * 0.04;
    } else {
      this.phase += dt * 2.5;
      sy = 1 + Math.sin(this.phase) * 0.025; // breathing
    }
    if (this.hover) bob += Math.sin(this.phase * 0.5) * 4;
    let lx = 0;
    if (this.lunge > 0) {
      this.lunge -= dt;
      const t = 1 - Math.max(0, this.lunge) / 0.2;
      lx = Math.sin(t * Math.PI) * 9 * this.facing;
    }
    if (this.pose > 0) this.pose -= dt;
    this.body.x = lx;
    this.body.y = -bob - this.hover;
    this.body.rotation = rot;
    this.body.scale.set(sc * this.facing, sc * sy);
    if (this.flash > 0) {
      this.flash -= dt;
      this.body.tint = 0xff7070;
    } else this.body.tint = 0xffffff;
    drawBar(this.bar, Math.max(20, this.bodyH * 0.5), this.hp / this.maxHp, this.barColor);
    return true;
  }
}

export class BuildingView extends Container {
  readonly sprite: Sprite;
  private readonly bar: Graphics;
  private recoil = 0;
  private flash = 0;
  private pop = 0;
  private smokeAcc = 0;
  hp = 1;
  maxHp = 1;
  destroyed = false;
  readonly topY: number;

  constructor(art: ArtTexture) {
    super();
    this.interactiveChildren = false;
    const shadow = new Graphics();
    shadow.ellipse(0, 0, 46, 16).fill({ color: 0x000000, alpha: 0.25 });
    this.addChild(shadow);
    this.sprite = new Sprite(art.texture);
    this.sprite.anchor.set(art.anchorX, art.anchorY);
    this.sprite.scale.set(art.scale);
    this.addChild(this.sprite);
    this.topY = -art.texture.height * art.scale * art.anchorY;
    this.bar = new Graphics();
    this.bar.y = this.topY - 10;
    this.addChild(this.bar);
    this.updateHitArea(art);
  }

  private updateHitArea(art: ArtTexture) {
    const w = Math.max(100, art.texture.width * art.scale);
    const h = art.texture.height * art.scale;
    const top = -h * art.anchorY;
    const bot = Math.max(30, h * (1 - art.anchorY));
    this.hitArea = new Rectangle(-w / 2, top, w, bot - top);
  }

  setArt(art: ArtTexture) {
    this.sprite.texture = art.texture;
    this.sprite.anchor.set(art.anchorX, art.anchorY);
    this.sprite.scale.set(art.scale);
    this.updateHitArea(art);
  }

  fire() {
    this.recoil = 0.12;
  }

  hit() {
    this.flash = 0.09;
  }

  popIn() {
    this.pop = 0.35;
  }

  update(dt: number, fx?: { smoke(x: number, y: number): void; fire(x: number, y: number): void }) {
    this.zIndex = this.y;
    let sx = 1;
    let sy = 1;
    if (this.recoil > 0) {
      this.recoil -= dt;
      sy = 1 - 0.06 * Math.max(0, this.recoil / 0.12);
      sx = 1 + 0.03 * Math.max(0, this.recoil / 0.12);
    }
    if (this.pop > 0) {
      this.pop -= dt;
      const t = 1 - Math.max(0, this.pop) / 0.35;
      const s = t < 0.6 ? (t / 0.6) * 1.12 : 1.12 - ((t - 0.6) / 0.4) * 0.12;
      sx *= s;
      sy *= s;
    }
    this.scale.set(sx, sy);
    if (this.flash > 0) {
      this.flash -= dt;
      this.sprite.tint = 0xff8a8a;
    } else this.sprite.tint = this.destroyed ? 0xffffff : this.hp / this.maxHp < 0.5 ? 0xc8b8a8 : 0xffffff;
    if (!this.destroyed) {
      drawBar(this.bar, 60, this.hp / this.maxHp, 0x5fd35a);
      const frac = this.hp / this.maxHp;
      if (fx && frac < 0.5) {
        this.smokeAcc += dt * (frac < 0.25 ? 10 : 4);
        while (this.smokeAcc > 1) {
          this.smokeAcc -= 1;
          fx.smoke(this.x, this.y + this.topY * 0.6);
          if (frac < 0.25) fx.fire(this.x, this.y + this.topY * 0.5);
        }
      }
    } else this.bar.clear();
  }
}
