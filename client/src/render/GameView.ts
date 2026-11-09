// PixiJS scene: painted valley, pads, buildings, battle replay with interpolation and juice.
import { Application, Container, Graphics, Sprite, Text } from 'pixi.js';
import { Viewport } from 'pixi-viewport';
import { enemyArtId } from '../content/artSpec';
import { BUILDING_HP, ECON, TICK_RATE } from '../content/stats';
import { Battle, type BattleEvent, type EntityId, type ProjectileKind } from '../sim/battle';
import { makePath, pointAt } from '../sim/map';
import type { BattleSetup, Dir, Intent, KeepState, MapDef, PadId, PadState, PlayerId } from '../sim/types';
import { DIRS } from '../sim/types';
import { sound } from './Sound';
import { AssetStore } from './assets';
import { BuildingView, UnitView } from './views';
import { Vfx } from './Vfx';

interface Projectile {
  view: Container;
  kind: ProjectileKind;
  x0: number;
  y0: number;
  tx: number;
  ty: number;
  target: EntityId;
  t: number;
  dur: number;
  arc: number;
}

export interface ValleyOptions {
  owners?: Record<PlayerId, { color: number; name: string; dormant?: boolean }>;
  me?: PlayerId;
  intent?: Intent | null;
  theme?: string;
  rally?: boolean;
  /** animate buildings that differ from the previous showValley call */
  animate?: boolean;
}

export class GameView {
  readonly app = new Application();
  viewport!: Viewport;
  assets!: AssetStore;
  vfx!: Vfx;
  private world = new Container();
  private ground = new Container();
  private entities = new Container();
  private fxLayer = new Container();
  private textLayer = new Container();
  private overlay = new Container();
  private highlights: Graphics[] = [];
  private intentMarkers: Graphics[] = [];
  private lastPadKeys = new Map<PadId, string>();
  private time = 0;
  private lastUserInput = 0;
  autoCamera = false;
  cameraFocus: { x: number; y: number }[] = [];
  private map: MapDef | null = null;
  private buildingViews = new Map<PadId, BuildingView>();
  private keepSprite: Sprite | null = null;
  private lastKeepLevel = 0;
  private keepPop = 0;
  private shake = 0;
  private destroyed = false;
  replay: ReplayPlayer | null = null;
  onPadTap: ((padId: PadId) => void) | null = null;
  onIntentTap: ((dir: Dir) => void) | null = null;

  static async create(el: HTMLElement): Promise<GameView> {
    const v = new GameView();
    await v.init(el);
    return v;
  }

  private async init(el: HTMLElement) {
    await this.app.init({ resizeTo: el, background: 0x1b2a1a, antialias: true, resolution: Math.min(2, window.devicePixelRatio || 1), autoDensity: true });
    el.appendChild(this.app.canvas);
    this.assets = new AssetStore(this.app.renderer as never);
    await this.assets.init();
    this.viewport = new Viewport({ screenWidth: el.clientWidth, screenHeight: el.clientHeight, worldWidth: 2048, worldHeight: 2048, events: this.app.renderer.events });
    this.viewport.drag().pinch().wheel({ smooth: 4 }).decelerate({ friction: 0.92 }).clamp({ direction: 'all', underflow: 'center' });
    this.app.stage.addChild(this.viewport);
    this.viewport.addChild(this.world);
    this.entities.sortableChildren = true;
    this.fxLayer.eventMode = 'none';
    this.textLayer.eventMode = 'none';
    this.world.addChild(this.ground, this.entities, this.fxLayer, this.overlay, this.textLayer);
    for (const ev of ['drag-start', 'pinch-start', 'wheel-start'] as const) this.viewport.on(ev, () => (this.lastUserInput = performance.now()));
    this.vfx = new Vfx(this.fxLayer, this.textLayer, this.assets.softDot);
    this.app.renderer.on('resize', (w: number, h: number) => {
      this.viewport.resize(w, h, 2048, 2048);
      this.fitZoomLimits();
    });
    this.fitZoomLimits();
    this.viewport.setZoom(Math.max(this.viewport.screenWidth / 2048, Math.min(1, this.viewport.screenWidth / 900)), true);
    this.viewport.moveCenter(1024, 1024);
    this.app.ticker.add((t) => this.tick(Math.min(0.1, t.deltaMS / 1000)));
  }

  private fitZoomLimits() {
    const min = Math.max(this.viewport.screenWidth / 2048, this.viewport.screenHeight / 2048);
    this.viewport.clampZoom({ minScale: min, maxScale: 2.5 });
    if (this.viewport.scale.x < min) this.viewport.setZoom(min, true);
  }

  destroy() {
    if (this.destroyed) return;
    this.destroyed = true;
    this.app.destroy(true, { children: true });
  }

  // ---------- static valley ----------

  showValley(map: MapDef, pads: Record<PadId, PadState> | null, keep: Pick<KeepState, 'level' | 'hp'>, opts: ValleyOptions = {}) {
    this.stopReplay();
    this.map = map;
    this.ground.removeChildren().forEach((c) => c.destroy({ children: true }));
    this.entities.removeChildren().forEach((c) => c.destroy({ children: true }));
    this.overlay.removeChildren().forEach((c) => c.destroy({ children: true }));
    this.highlights = [];
    this.intentMarkers = [];
    this.buildingViews.clear();
    this.vfx.clear();
    this.drawGround(map);

    for (const sec of map.sectors) {
      for (const pad of sec.pads) {
        const st = pads?.[pad.id];
        if (pads && !st?.owner) continue; // unowned sectors are wilderness
        const art = this.assets.get('pad_empty');
        const ps = new Sprite(art.texture);
        ps.anchor.set(art.anchorX, art.anchorY);
        ps.scale.set(art.scale);
        ps.position.set(pad.x, pad.y);
        this.bindTap(ps, () => this.onPadTap?.(pad.id));
        this.ground.addChild(ps);
        if (st?.building) {
          const v = this.setBuilding(pad.id, pad.x, pad.y, st.building.type, st.building.level, st.building.hp);
          const key = `${st.building.type}${st.building.level}`;
          if (opts.animate && this.lastPadKeys.get(pad.id) !== key) {
            v.popIn();
            this.vfx.dust(pad.x, pad.y, 12);
            sound.play('build');
          }
          this.lastPadKeys.set(pad.id, key);
        } else {
          this.lastPadKeys.delete(pad.id);
          if (st?.rubble) this.setRubble(pad.id, pad.x, pad.y);
          else if (opts.me && st?.owner === opts.me) {
            const g = new Graphics();
            g.ellipse(0, 0, 40, 24).stroke({ width: 4, color: 0xffd76a });
            g.position.set(pad.x, pad.y);
            g.eventMode = 'none';
            this.overlay.addChild(g);
            this.highlights.push(g);
          }
        }
      }
      const owner = pads?.[sec.pads[0].id]?.owner;
      const info = owner ? opts.owners?.[owner] : undefined;
      if (info) this.addBanner(sec.rally.x, sec.rally.y, sec.pads, info.color, info.name, owner === opts.me, info.dormant);
    }
    if (opts.intent) this.showIntent(map, opts.intent, opts.theme ?? 'sugar');
    const ka = this.assets.get(`keep_${keep.level}`);
    this.keepSprite = new Sprite(ka.texture);
    this.keepSprite.anchor.set(ka.anchorX, ka.anchorY);
    this.keepSprite.scale.set(ka.scale);
    this.keepSprite.position.set(map.keep.x, map.keep.y);
    this.keepSprite.zIndex = map.keep.y;
    this.keepSprite.eventMode = 'none';
    this.entities.addChild(this.keepSprite);
    if (opts.rally) this.addRallyBanner(map.keep.x, this.keepTopY - 12);
    if (opts.animate && this.lastKeepLevel > 0 && keep.level > this.lastKeepLevel) {
      this.keepPop = 1;
      this.vfx.burst(map.keep.x, map.keep.y - 60, 0xffd24a, 24, 24);
      this.vfx.coinBurst(map.keep.x, map.keep.y - 40);
      this.vfx.floatingText(map.keep.x, this.keepTopY - 20, `Keep Level ${keep.level}!`, 0xffe48a, 24);
      sound.play('victory');
    }
    this.lastKeepLevel = keep.level;
  }

  private addRallyBanner(x: number, y: number) {
    const c = new Container();
    const bg = new Graphics();
    bg.roundRect(-62, -16, 124, 28, 14).fill({ color: 0x2a1808, alpha: 0.85 }).stroke({ width: 2, color: 0xffd24a });
    c.addChild(bg);
    if (this.assets.has('icon_rally')) {
      const a = this.assets.get('icon_rally');
      const sp = new Sprite(a.texture);
      sp.anchor.set(0.5);
      sp.scale.set(22 / a.texture.height);
      sp.position.set(-44, -2);
      c.addChild(sp);
    }
    const rallyPct = Math.round((ECON.rallyFireRate - 1) * 100);
    const t = new Text({ text: `RALLY +${rallyPct}%`, style: { fontSize: 13, fontWeight: '900', fill: 0xffe48a, stroke: { color: 0x1a0f08, width: 3 } } });
    t.anchor.set(0.5);
    t.position.set(10, -2);
    c.addChild(t);
    c.position.set(x, y);
    c.zIndex = 99999;
    c.eventMode = 'none';
    this.overlay.addChild(c);
  }

  private addBanner(rx: number, ry: number, pads: { x: number; y: number }[], color: number, name: string, mine: boolean, dormant?: boolean) {
    let cx = 0;
    let cy = 0;
    for (const p of pads) {
      cx += p.x;
      cy += p.y;
    }
    cx /= pads.length;
    cy /= pads.length;
    const x = (rx + cx) / 2 + 30;
    const y = (ry + cy) / 2;
    const c = new Container();
    const art = this.assets.get('ui_banner');
    const s = new Sprite(art.texture);
    s.anchor.set(art.anchorX, art.anchorY);
    s.scale.set(56 / art.texture.height);
    s.tint = color;
    if (dormant) s.alpha = 0.65;
    c.addChild(s);
    const label = dormant ? `${name} (resting)` : name;
    const t = new Text({ text: label, style: { fontSize: 13, fontWeight: '900', fill: mine ? 0xffe28a : dormant ? 0xc8c0b0 : 0xffffff, stroke: { color: 0x1a0f08, width: 4 } } });
    t.anchor.set(0.5, 0);
    t.y = 2;
    c.addChild(t);
    c.position.set(x, y);
    c.zIndex = y;
    c.eventMode = 'none';
    this.entities.addChild(c);
  }

  private bindTap(target: Container, fn: () => void) {
    let downX = 0;
    let downY = 0;
    let down = false;
    target.eventMode = 'static';
    target.cursor = 'pointer';
    target.on('pointerdown', (e) => {
      down = true;
      downX = e.global.x;
      downY = e.global.y;
    });
    target.on('pointertap', (e) => {
      if (down && Math.hypot(e.global.x - downX, e.global.y - downY) > 10) {
        down = false;
        return;
      }
      down = false;
      fn();
    });
  }

  private showIntent(map: MapDef, intent: Intent, theme: string) {
    for (const d of DIRS) {
      const ri = intent.roads[d];
      if (!ri) continue;
      const path = makePath(map.roads[d]);
      const c = new Container();
      for (let s = 120; s < Math.min(path.len * 0.55, 700); s += 70) {
        const p = pointAt(path, s);
        const g = new Graphics();
        g.poly([-10, -12, 8, 0, -10, 12, -4, 0]).fill({ color: ri.boss ? 0xff3a6a : 0xff5a3a });
        g.position.set(p.x, p.y);
        g.rotation = Math.atan2(p.dy, p.dx);
        g.alpha = 0.8;
        (g as Graphics & { phase?: number }).phase = s / 140;
        c.addChild(g);
        this.intentMarkers.push(g);
      }
      const at = pointAt(path, Math.min(170, path.len * 0.2));
      const role = ri.boss ? 'boss' : ri.featured;
      const art = this.assets.get(enemyArtId(theme, role));
      const sp = new Sprite(art.texture);
      sp.anchor.set(art.anchorX, art.anchorY);
      sp.scale.set(art.scale * (ri.boss ? 0.8 : 1.5));
      sp.position.set(at.x, at.y);
      c.addChild(sp);
      const total = Object.values(ri.counts).reduce((a, b) => a + (b ?? 0), 0);
      const label = new Text({ text: `×${total}${ri.boss ? ' + BOSS' : ''}`, style: { fontSize: 22, fontWeight: '900', fill: 0xffe0d0, stroke: { color: 0x3a0505, width: 5 } } });
      label.anchor.set(0.5, 0);
      label.position.set(at.x, at.y + 6);
      c.addChild(label);
      this.bindTap(c, () => this.onIntentTap?.(d));
      this.overlay.addChild(c);
    }
  }

  private drawGround(map: MapDef) {
    if (this.assets.has('map_valley')) {
      const a = this.assets.get('map_valley');
      const s = new Sprite(a.texture);
      s.width = map.width;
      s.height = map.height;
      s.eventMode = 'none';
      this.ground.addChild(s);
      return;
    }
    const g = new Graphics();
    g.eventMode = 'none';
    g.rect(0, 0, map.width, map.height).fill(0x5d8a3a);
    // some meadow variation
    for (let i = 0; i < 60; i++) {
      const x = (i * 733) % map.width;
      const y = (i * 1297) % map.height;
      g.circle(x, y, 60 + ((i * 37) % 90)).fill({ color: i % 2 ? 0x6b9a44 : 0x4f7a33, alpha: 0.5 });
    }
    for (const d of DIRS) {
      const pts = map.roads[d];
      g.moveTo(pts[0].x, pts[0].y);
      for (let i = 1; i < pts.length; i++) g.lineTo(pts[i].x, pts[i].y);
      g.stroke({ width: 54, color: 0x9a7a4a, cap: 'round', join: 'round' });
      g.moveTo(pts[0].x, pts[0].y);
      for (let i = 1; i < pts.length; i++) g.lineTo(pts[i].x, pts[i].y);
      g.stroke({ width: 40, color: 0xc29d63, cap: 'round', join: 'round' });
    }
    g.circle(map.keep.x, map.keep.y, 170).fill(0x6f9a48);
    this.ground.addChild(g);
  }

  setBuilding(padId: PadId, x: number, y: number, type: string, level: number, hp: number) {
    const art = this.assets.get(`building_${type}_${level}`);
    let v = this.buildingViews.get(padId);
    if (!v) {
      v = new BuildingView(art);
      v.position.set(x, y);
      v.zIndex = y;
      this.bindTap(v, () => this.onPadTap?.(padId));
      this.entities.addChild(v);
      this.buildingViews.set(padId, v);
    } else {
      v.setArt(art);
      v.destroyed = false;
    }
    v.maxHp = BUILDING_HP[level - 1];
    v.hp = hp;
    return v;
  }

  private setRubble(padId: PadId, x: number, y: number) {
    const v = this.setBuilding(padId, x, y, 'archer', 1, 0);
    v.setArt(this.assets.get('rubble'));
    v.destroyed = true;
  }

  buildingView(padId: PadId) {
    return this.buildingViews.get(padId);
  }

  get keepPos() {
    return this.map ? this.map.keep : { x: 1024, y: 1024 };
  }

  get keepTopY() {
    return this.keepPos.y - (this.keepSprite ? this.keepSprite.height * 0.7 : 150);
  }

  flashKeep() {
    if (!this.keepSprite) return;
    this.keepSprite.tint = 0xff8080;
    setTimeout(() => this.keepSprite && (this.keepSprite.tint = 0xffffff), 90);
  }

  addEntity(c: Container) {
    this.entities.addChild(c);
  }

  shakeCamera(amount: number) {
    this.shake = Math.max(this.shake, amount);
  }

  focus(x: number, y: number, zoom?: number) {
    if (zoom) this.viewport.animate({ position: { x, y }, scale: zoom, time: 600, ease: 'easeInOutSine' });
    else this.viewport.animate({ position: { x, y }, time: 600, ease: 'easeInOutSine' });
  }

  // ---------- battle ----------

  playBattle(setup: BattleSetup, pads: Record<PadId, PadState> | null, opts: ValleyOptions = {}): ReplayPlayer {
    this.showValley(setup.map, pads, { level: setup.keep.level, hp: setup.keep.hp }, { ...opts, intent: null, rally: setup.rally, animate: false });
    this.highlights.forEach((h) => h.destroy());
    this.highlights = [];
    // buildings in battle setup reflect post-order state
    for (const b of setup.buildings) this.setBuilding(b.padId, b.x, b.y, b.type, b.level, b.hp);
    this.replay = new ReplayPlayer(this, setup);
    return this.replay;
  }

  stopReplay() {
    this.replay?.dispose();
    this.replay = null;
  }

  private tick(dt: number) {
    this.time += dt;
    this.replay?.update(dt);
    const pulse = 0.55 + 0.45 * Math.sin(this.time * 4);
    for (const h of this.highlights) h.alpha = pulse;
    for (const m of this.intentMarkers) m.alpha = 0.35 + 0.6 * Math.max(0, Math.sin(this.time * 5 - ((m as Graphics & { phase?: number }).phase ?? 0)));
    if (this.autoCamera && this.replay && performance.now() - this.lastUserInput > 3500) {
      const t = this.replay.focusPoint(this.cameraFocus);
      if (t) {
        const c = this.viewport.center;
        const k = Math.min(1, dt * 1.2);
        this.viewport.moveCenter(c.x + (t.x - c.x) * k, c.y + (t.y - c.y) * k);
      }
    }
    const fx = this.vfx;
    for (const v of this.buildingViews.values()) v.update(dt, fx);
    if (this.keepPop > 0 && this.keepSprite) {
      this.keepPop = Math.max(0, this.keepPop - dt * 3);
      const ka = this.assets.get(`keep_${this.lastKeepLevel || 1}`);
      const bump = 1 + Math.sin(this.keepPop * Math.PI) * 0.22;
      this.keepSprite.scale.set(ka.scale * bump);
    }
    this.vfx.update(dt);
    if (this.shake > 0) {
      this.shake = Math.max(0, this.shake - dt * 30);
      this.world.position.set((Math.random() - 0.5) * this.shake, (Math.random() - 0.5) * this.shake);
    } else if (this.world.x !== 0 || this.world.y !== 0) this.world.position.set(0, 0);
  }

}

export class ReplayPlayer {
  battle: Battle;
  speed = 1;
  paused = false;
  onEnd: (() => void) | null = null;
  onTick: ((tick: number) => void) | null = null;
  private acc = 0;
  private units = new Map<EntityId, UnitView>();
  private dyingUnits: UnitView[] = [];
  private projectiles: Projectile[] = [];
  private ended = false;
  private endDelay = 0.8;

  constructor(
    private view: GameView,
    readonly setup: BattleSetup,
  ) {
    this.battle = new Battle(setup);
    this.syncUnits();
  }

  get totalTicks() {
    return this.battle.tick;
  }

  dispose() {
    for (const u of this.units.values()) u.destroy({ children: true });
    for (const u of this.dyingUnits) u.destroy({ children: true });
    for (const p of this.projectiles) p.view.destroy();
    this.units.clear();
    this.dyingUnits = [];
    this.projectiles = [];
  }

  /** Advance n ticks without effects (dev/testing). */
  fastForward(n: number) {
    for (let i = 0; i < n && !this.battle.done; i++) {
      this.battle.step();
      for (const [id, u] of this.units) {
        if (!this.battle.enemies.some((e) => e.id === id) && !this.battle.defenders.some((d) => d.id === id)) {
          u.destroy({ children: true });
          this.units.delete(id);
        }
      }
      this.syncUnits();
    }
    for (const u of this.units.values()) u.place(u.curX, u.curY);
    this.syncBuildings();
  }

  skip() {
    while (!this.battle.done) this.battle.step();
    for (const p of this.projectiles) p.view.destroy();
    this.projectiles = [];
    for (const [id, u] of this.units) {
      if (!this.battle.defenders.some((d) => d.id === id)) {
        u.destroy({ children: true });
        this.units.delete(id);
      }
    }
    this.syncUnits();
    this.syncBuildings();
    this.finish();
  }

  private finish() {
    if (this.ended) return;
    this.ended = true;
    this.onEnd?.();
  }

  update(dtReal: number) {
    if (!this.paused && !this.battle.done) {
      this.acc += dtReal * this.speed;
      const stepDt = 1 / TICK_RATE;
      let steps = 0;
      while (this.acc >= stepDt && !this.battle.done && steps < 40) {
        this.acc -= stepDt;
        steps++;
        for (const u of this.units.values()) u.setTarget(u.curX, u.curY);
        const frame = this.battle.step();
        this.syncUnits();
        this.syncBuildings();
        for (const e of frame.events) this.handle(e);
        this.onTick?.(frame.tick);
      }
    }
    const alpha = this.battle.done ? 1 : Math.min(1, this.acc * TICK_RATE);
    const dt = this.paused ? 0 : dtReal * this.speed;
    for (const u of this.units.values()) u.update(dt, alpha);
    this.dyingUnits = this.dyingUnits.filter((u) => {
      const keep = u.update(dt, 1);
      if (!keep) u.destroy({ children: true });
      return keep;
    });
    this.updateProjectiles(dt);
    if (this.battle.done && !this.ended && this.projectiles.length === 0) {
      this.endDelay -= dtReal;
      if (this.endDelay <= 0) this.finish();
    }
  }

  /** where the camera should look: enemies near the given points first, else the enemy closest to the keep */
  focusPoint(prefer: { x: number; y: number }[]): { x: number; y: number } | null {
    const es = this.battle.enemies;
    if (!es.length) return null;
    let sx = 0;
    let sy = 0;
    let n = 0;
    for (const e of es) {
      if (prefer.some((p) => (p.x - e.x) ** 2 + (p.y - e.y) ** 2 < 380 * 380)) {
        sx += e.x;
        sy += e.y;
        n++;
      }
    }
    if (n) return { x: sx / n, y: sy / n };
    let best = es[0];
    let bestR = Infinity;
    for (const e of es) {
      const r = this.battle.paths[e.road].len - e.s;
      if (r < bestR) {
        bestR = r;
        best = e;
      }
    }
    return { x: best.x, y: best.y };
  }

  private syncUnits() {
    const b = this.battle;
    const theme = this.setup.theme;
    for (const e of b.enemies) {
      let u = this.units.get(e.id);
      if (!u) {
        const id = enemyArtId(theme, e.role);
        const atk = this.view.assets.has(`${id}_attack`) ? this.view.assets.get(`${id}_attack`) : null;
        u = new UnitView(this.view.assets.get(id), atk, { flying: e.flying, enemy: true, big: e.role === 'boss' || e.role === 'siege' });
        u.place(e.x, e.y);
        this.units.set(e.id, u);
        this.view.addEntity(u);
      }
      u.curX = e.x;
      u.curY = e.y;
      u.hp = e.hp;
      u.maxHp = e.maxHp;
      if (e.state === 'walk') u.setFacing(e.dirX);
    }
    for (const d of b.defenders) {
      let u = this.units.get(d.id);
      if (!u) {
        const id = d.kind === 'hero' ? `hero_${d.heroClass}` : 'soldier_footman';
        const atk = this.view.assets.has(`${id}_attack`) || this.view.assets.get(id).placeholder ? this.view.assets.get(`${id}_attack`) : null;
        u = new UnitView(this.view.assets.get(id), atk, {});
        u.place(d.x, d.y);
        this.units.set(d.id, u);
        this.view.addEntity(u);
      }
      u.visible = d.alive;
      if (!d.alive) {
        u.place(d.x, d.y);
        continue;
      }
      u.curX = d.x;
      u.curY = d.y;
      u.hp = d.hp;
      u.maxHp = d.maxHp;
      u.setFacing(d.facing);
    }
  }

  private syncBuildings() {
    for (const bl of this.battle.buildings) {
      const v = this.view.buildingView(bl.padId);
      if (!v || v.destroyed) continue;
      v.hp = Math.max(0, bl.hp);
      v.maxHp = bl.maxHp;
    }
  }

  private srcPos(src: EntityId | PadId | 'keep', x: number, y: number): { x: number; y: number } {
    if (src === 'keep') return { x, y: this.view.keepTopY };
    if (typeof src === 'string') {
      const v = this.view.buildingView(src);
      if (v) {
        v.fire();
        return { x, y: y + v.topY * 0.8 };
      }
      return { x, y };
    }
    const u = this.units.get(src);
    if (u) {
      u.attack(undefined);
      return { x: u.x, y: u.y - u.bodyH * 0.6 };
    }
    return { x, y };
  }

  private handle(e: BattleEvent) {
    const vfx = this.view.vfx;
    switch (e.t) {
      case 'spawn': {
        const u = this.units.get(e.id);
        if (u) vfx.dust(u.curX, u.curY, 5);
        if (u && this.battle.enemies.some((x) => x.id === e.id && x.role === 'boss')) {
          sound.play('boss');
          this.view.shakeCamera(10);
        }
        break;
      }
      case 'shot': {
        const from = this.srcPos(e.src, e.x, e.y);
        const tu = this.units.get(e.target);
        if (tu && typeof e.src === 'number') this.units.get(e.src)?.setFacing(tu.curX - from.x);
        this.spawnProjectile(e.kind, from.x, from.y, e.tx, e.ty, e.target, e.flight);
        sound.play(e.kind === 'arrow' ? 'arrow' : e.kind === 'rock' ? 'rock' : 'magic', 70);
        break;
      }
      case 'hit': {
        const u = this.units.get(e.id);
        if (!u) break;
        u.hit();
        sound.play('hit', 45);
        const y = u.curY - u.bodyH * 0.6;
        vfx.sparks(u.curX, y, e.dtype === 'magic' ? 0x8fdcff : 0xffd27a, 4);
        if (e.amount >= 12) vfx.floatingText(u.curX, y - 10, String(Math.round(e.amount)), e.dtype === 'magic' ? 0x9fe4ff : 0xfff4d8, e.amount >= 40 ? 22 : 15);
        break;
      }
      case 'splash':
        vfx.splash(e.x, e.y, e.r);
        this.view.shakeCamera(4);
        break;
      case 'melee': {
        const a = this.units.get(e.id);
        if (!a) break;
        if (typeof e.target === 'string') {
          const b = this.view.buildingView(e.target);
          a.attack(b ? b.x : undefined);
          if (b) vfx.dust(b.x, b.y - 10, 3);
        } else {
          const t = this.units.get(e.target);
          a.attack(t ? t.curX : undefined);
          if (t) vfx.sparks((a.curX + t.curX) / 2, (a.curY + t.curY) / 2 - 18, 0xffffff, 3);
        }
        break;
      }
      case 'hurt': {
        if (typeof e.id === 'string') this.view.buildingView(e.id)?.hit();
        else this.units.get(e.id)?.hit();
        break;
      }
      case 'death': {
        const u = this.units.get(e.id);
        if (!u) break;
        const isDefender = this.battle.defenders.some((d) => d.id === e.id);
        if (isDefender) {
          vfx.dust(u.curX, u.curY, 6);
          break;
        }
        this.units.delete(e.id);
        u.die();
        this.dyingUnits.push(u);
        sound.play('death', 50);
        vfx.burst(u.curX, u.curY - u.bodyH * 0.5, 0xff6fb0, u.bodyH > 100 ? 30 : 10, u.bodyH > 100 ? 26 : 12);
        if (u.bodyH > 100) this.view.shakeCamera(14);
        break;
      }
      case 'leak': {
        const u = this.units.get(e.id);
        if (u) {
          this.units.delete(e.id);
          u.die();
          this.dyingUnits.push(u);
        }
        const k = this.view.keepPos;
        sound.play('leak', 120);
        this.view.flashKeep();
        this.view.shakeCamera(6 + e.dmg);
        vfx.floatingText(k.x, this.view.keepTopY, `-${e.dmg}`, 0xff5a4a, 22);
        vfx.burst(k.x, k.y - 60, 0xff4a3a, 8, 14);
        break;
      }
      case 'destroyed': {
        const v = this.view.buildingView(e.padId);
        if (!v) break;
        v.destroyed = true;
        v.setArt(this.view.assets.get('rubble'));
        sound.play('destroy');
        vfx.dust(v.x, v.y, 20, 0x8a7a66);
        vfx.burst(v.x, v.y - 40, 0xff9a3a, 14, 18);
        this.view.shakeCamera(16);
        break;
      }
      case 'heal': {
        const u = this.units.get(e.id);
        if (u) vfx.healGlow(u.curX, u.curY - 20);
        break;
      }
    }
  }

  private spawnProjectile(kind: ProjectileKind, x0: number, y0: number, tx: number, ty: number, target: EntityId, flight: number) {
    let view: Container;
    if (kind === 'arrow' || kind === 'rock') {
      const art = this.view.assets.get(kind === 'arrow' ? 'proj_arrow' : 'proj_rock');
      const s = new Sprite(art.texture);
      s.anchor.set(0.5);
      s.scale.set(art.scale);
      if (kind === 'arrow') s.scale.set(art.scale * 1.6);
      view = s;
    } else {
      const g = new Graphics();
      g.circle(0, 0, kind === 'holy' ? 6 : 7).fill({ color: kind === 'holy' ? 0xfff0a0 : 0x8fdcff });
      g.circle(0, 0, 3).fill(0xffffff);
      g.blendMode = 'add';
      view = g;
    }
    view.position.set(x0, y0);
    view.zIndex = 100000;
    this.view.addEntity(view);
    const dist = Math.hypot(tx - x0, ty - y0);
    const arc = kind === 'rock' ? 120 : kind === 'arrow' ? Math.min(60, dist * 0.25) : 10;
    this.projectiles.push({ view, kind, x0, y0, tx, ty, target, t: 0, dur: flight, arc });
  }

  private updateProjectiles(dt: number) {
    const vfx = this.view.vfx;
    this.projectiles = this.projectiles.filter((p) => {
      p.t += dt;
      const u = this.units.get(p.target);
      if (u) {
        p.tx = u.x;
        p.ty = u.y - u.bodyH * 0.55;
      }
      const t = Math.min(1, p.t / p.dur);
      const x = p.x0 + (p.tx - p.x0) * t;
      const y = p.y0 + (p.ty - p.y0) * t - p.arc * 4 * t * (1 - t);
      const px = p.view.x;
      const py = p.view.y;
      p.view.position.set(x, y);
      if (p.kind === 'arrow') p.view.rotation = Math.atan2(y - py, x - px);
      else if (p.kind === 'rock') p.view.rotation += dt * 8;
      else vfx.magicTrail(x, y, p.kind === 'holy' ? 0xfff0a0 : 0x7fd4ff);
      if (t >= 1) {
        p.view.destroy();
        return false;
      }
      return true;
    });
  }
}

