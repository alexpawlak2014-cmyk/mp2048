function tierOfValue(value) {
  try {
    const v = typeof value === "bigint" ? value : BigInt(value);
    if (v <= 1n) return 1;
    return v.toString(2).length - 1;
  } catch {
    return 1;
  }
}

function rateFromTier(tier, base, step) {
  return base + Math.max(0, tier) * step;
}

export class Sfx {
  constructor() {
    this.ctx = null;
    this.buffers = {};
    this.ready = false;
    this.loading = null;
    this.volume = 0.85;
    this.muted = false;
  }

  mix(gain = 1) {
    if (this.muted) return 0;
    return Math.max(0, gain) * this.volume;
  }

  ensure() {
    if (!this.ctx) {
      this.ctx = new AudioContext();
    }
    if (this.ctx.state === "suspended") {
      this.ctx.resume();
    }
    if (!this.loading) this.loading = this.load();
    return this.ctx;
  }

  async load() {
    const ctx = this.ctx || new AudioContext();
    this.ctx = ctx;
    const names = ["tile", "win", "cut", "bump", "pop"];
    await Promise.all(
      names.map(async (name) => {
        const res = await fetch(`/sfx/${name}.wav`);
        const arr = await res.arrayBuffer();
        this.buffers[name] = await ctx.decodeAudioData(arr.slice(0));
      })
    );
    this.ready = true;
  }

  play(name, { rate = 1, gain = 1 } = {}) {
    this.ensure();
    const buf = this.buffers[name];
    if (!buf) return;
    const src = this.ctx.createBufferSource();
    src.buffer = buf;
    const r = Number(rate);
    try {
      src.playbackRate.value = Number.isFinite(r) ? r : 1;
    } catch {
      src.playbackRate.value = r > 1 ? src.playbackRate.maxValue : src.playbackRate.minValue;
    }
    const g = this.ctx.createGain();
    g.gain.value = this.mix(gain);
    src.connect(g).connect(this.ctx.destination);
    src.start();
  }

  merge(value) {
    const tier = tierOfValue(value);
    this.play("pop", { rate: rateFromTier(tier, 0.78, 0.06), gain: 1 });
  }

  bump() {
    this.play("bump", { gain: 0.9 });
  }

  cut() {
    this.play("cut", { gain: 1 });
  }

  tile(rate = 1) {
    this.play("tile", { rate, gain: 0.85 });
  }

  win(value = 2) {
    const tier = tierOfValue(value);
    this.play("win", { rate: rateFromTier(tier, 0.55, 0.085), gain: 1 });
  }

  sparkle(combo = 5) {
    const ctx = this.ensure();
    if (!ctx) return;
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = "triangle";
    const t = ctx.currentTime;
    o.frequency.setValueAtTime(480 + combo * 36, t);
    o.frequency.exponentialRampToValueAtTime(980 + combo * 40, t + 0.11);
    const amp = this.mix(0.1);
    if (amp <= 0) return;
    g.gain.setValueAtTime(amp, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.13);
    o.connect(g).connect(ctx.destination);
    o.start(t);
    o.stop(t + 0.14);
  }

  fall() {
    this.play("cut", { rate: 0.72, gain: 0.75 });
  }

  start() {
    this.ensure();
  }
}
