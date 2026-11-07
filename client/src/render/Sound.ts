// Procedural sound effects with WebAudio — no audio files needed.
type Sfx = 'arrow' | 'magic' | 'rock' | 'hit' | 'death' | 'leak' | 'build' | 'coin' | 'destroy' | 'horn' | 'victory' | 'defeat' | 'click' | 'boss';

class SoundManager {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private noise: AudioBuffer | null = null;
  private last = new Map<Sfx, number>();
  muted = localStorage.getItem('siege.muted') === '1';

  private ensure(): AudioContext | null {
    if (this.muted) return null;
    if (!this.ctx) {
      try {
        this.ctx = new AudioContext();
      } catch {
        return null;
      }
      this.master = this.ctx.createGain();
      this.master.gain.value = 0.35;
      this.master.connect(this.ctx.destination);
      const len = this.ctx.sampleRate;
      this.noise = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
      const d = this.noise.getChannelData(0);
      for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    }
    if (this.ctx.state === 'suspended') void this.ctx.resume();
    return this.ctx;
  }

  setMuted(m: boolean) {
    this.muted = m;
    localStorage.setItem('siege.muted', m ? '1' : '0');
  }

  /** call from a user gesture once so iOS unlocks audio */
  unlock() {
    this.ensure();
  }

  private tone(freq: number, dur: number, type: OscillatorType, vol: number, slideTo?: number, delay = 0) {
    const ctx = this.ctx!;
    const t = ctx.currentTime + delay;
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = type;
    o.frequency.setValueAtTime(freq, t);
    if (slideTo) o.frequency.exponentialRampToValueAtTime(slideTo, t + dur);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(this.master!);
    o.start(t);
    o.stop(t + dur + 0.02);
  }

  private burst(dur: number, freq: number, q: number, vol: number, type: BiquadFilterType = 'bandpass', delay = 0) {
    const ctx = this.ctx!;
    const t = ctx.currentTime + delay;
    const s = ctx.createBufferSource();
    s.buffer = this.noise;
    const f = ctx.createBiquadFilter();
    f.type = type;
    f.frequency.value = freq;
    f.Q.value = q;
    const g = ctx.createGain();
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    s.connect(f).connect(g).connect(this.master!);
    s.start(t, Math.random() * 0.5);
    s.stop(t + dur + 0.02);
  }

  play(name: Sfx, minGapMs = 60) {
    const ctx = this.ensure();
    if (!ctx) return;
    const now = performance.now();
    if (now - (this.last.get(name) ?? 0) < minGapMs) return;
    this.last.set(name, now);
    const v = 0.9 + Math.random() * 0.2;
    switch (name) {
      case 'arrow':
        this.burst(0.12, 2500 * v, 2, 0.25, 'highpass');
        break;
      case 'magic':
        this.tone(900 * v, 0.18, 'sine', 0.12, 1800);
        this.tone(1350 * v, 0.14, 'triangle', 0.06, 2400);
        break;
      case 'rock':
        this.burst(0.25, 300, 1, 0.4, 'lowpass');
        break;
      case 'hit':
        this.burst(0.05, 1800 * v, 3, 0.18);
        break;
      case 'death':
        this.tone(520 * v, 0.18, 'square', 0.06, 140);
        this.burst(0.1, 900, 1, 0.15);
        break;
      case 'leak':
        this.tone(110, 0.35, 'sawtooth', 0.12, 55);
        break;
      case 'build':
        this.burst(0.2, 200, 1, 0.5, 'lowpass');
        this.tone(160, 0.15, 'sine', 0.2, 90);
        break;
      case 'coin':
        this.tone(1320, 0.08, 'square', 0.06);
        this.tone(1760, 0.16, 'square', 0.06, undefined, 0.07);
        break;
      case 'destroy':
        this.burst(0.7, 180, 0.7, 0.6, 'lowpass');
        this.tone(90, 0.5, 'sawtooth', 0.1, 40);
        break;
      case 'horn':
        this.tone(233, 0.6, 'sawtooth', 0.08, 262);
        this.tone(349, 0.6, 'sawtooth', 0.05, 392, 0.05);
        break;
      case 'boss':
        this.burst(1.1, 140, 0.5, 0.5, 'lowpass');
        this.tone(70, 1.0, 'sawtooth', 0.12, 45);
        break;
      case 'victory':
        [523, 659, 784, 1047].forEach((f, i) => this.tone(f, 0.35, 'triangle', 0.12, undefined, i * 0.12));
        break;
      case 'defeat':
        [392, 330, 262].forEach((f, i) => this.tone(f, 0.45, 'triangle', 0.1, undefined, i * 0.2));
        break;
      case 'click':
        this.tone(700, 0.04, 'square', 0.04);
        break;
    }
  }
}

export const sound = new SoundManager();
