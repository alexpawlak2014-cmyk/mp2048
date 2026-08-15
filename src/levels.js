import { radiusFor, tierOf } from "./values.js";

function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function trackAt(segments, z) {
  for (const s of segments) {
    if (z >= s.z0 && z < s.z1) return s;
  }
  return segments[segments.length - 1];
}

function clamp(n, a, b) {
  return Math.max(a, Math.min(b, n));
}

function safeX(seg, t, r) {
  const half = Math.max(0.2, seg.width / 2 - r - 0.12);
  return seg.cx + clamp(t, -1, 1) * half;
}

function cxAt(i, path, zig, freq) {
  const f = freq || 0.9;
  const z = zig || 0;
  switch (path) {
    case "sine":
      return Math.sin(i * f) * z;
    case "snake":
      return Math.sin(i * f) * z + Math.sin(i * f * 0.37) * z * 0.55;
    case "step":
      return ((Math.floor(i / 2) % 2) * 2 - 1) * z;
    case "sweep":
      return Math.sin(i * f * 0.28) * z;
    case "zigzag":
      return (i % 2 === 0 ? -1 : 1) * z;
    case "drift":
      return Math.sin(i * f * 0.15) * z * 1.15;
    case "s":
      return Math.tanh(Math.sin(i * f * 0.22) * 2.2) * z;
    case "helix":
      return Math.sin(i * f) * z * 0.72 + Math.cos(i * f * 0.51) * z * 0.52;
    case "pulse":
      return Math.sin(i * f * 0.5) * z * 0.4;
    default:
      return 0;
  }
}

function buildSegments(goal, spec) {
  const segs = [];
  let z = -8;
  let i = 0;
  const baseW = Math.max(7.2, spec.w);
  const segBase = spec.segLen || 16;
  while (z < goal + 18) {
    const len = segBase + (i % spec.segMod) * spec.segStep;
    const w = spec.path === "pulse" ? baseW + Math.sin(i * 0.72) * 0.85 : baseW;
    const cx = cxAt(i, spec.path, spec.zig, spec.freq);
    const z1 = Math.min(z + len, goal + 18);
    segs.push({ z0: z, z1, width: w, cx, hole: undefined });
    z = z1;
    i += 1;
  }
  return segs;
}

function toBigTier(v, fallback = 1n) {
  try {
    if (typeof v === "bigint") return v < 1n ? fallback : v;
    if (typeof v === "number" && Number.isFinite(v)) return BigInt(Math.max(1, Math.floor(v)));
    const digits = String(v ?? "").replace(/[^\d]/g, "");
    if (!digits) return fallback;
    const s = digits.replace(/^0+/, "") || "0";
    if (s === "0") return fallback;
    const b = BigInt(s);
    return b < 1n ? fallback : b;
  } catch {
    return fallback;
  }
}

function valueAt(z, goal, maxVal, rng, minTier = 1n) {
  minTier = toBigTier(minTier);
  let maxTier = toBigTier(tierOf(maxVal));
  if (maxTier < minTier) maxTier = minTier;
  const t = clamp(z / goal, 0, 1);
  const span = maxTier - minTier;
  const spanN = span > 1000000n ? 1000000 : Number(span);
  let idx = minTier + BigInt(Math.floor(t * Math.max(1, spanN)));
  if (rng() < 0.22 && idx > minTier) idx -= 1n;
  if (rng() < 0.18 && idx < maxTier) idx += 1n;
  if (idx < minTier) idx = minTier;
  if (idx > maxTier) idx = maxTier;
  return 2n ** idx;
}

function pairT(seg, r) {
  const half = Math.max(0.25, seg.width / 2 - r - 0.12);
  return Math.min(0.82, (r + 0.42) / half);
}

function placeBalls(segments, goal, rng, spec, maxVal, minTier = 1) {
  const balls = [];
  const layout = spec.layout;
  const startVal = 2n ** toBigTier(minTier);
  let z = 14;
  balls.push([z, safeX(trackAt(segments, z), -0.55, radiusFor(startVal)), startVal]);
  balls.push([z, safeX(trackAt(segments, z), 0.55, radiusFor(startVal)), startVal]);
  z += 8 + rng() * 3;
  balls.push([z, safeX(trackAt(segments, z), 0, radiusFor(startVal)), startVal]);
  z += 6 + rng() * 4;

  while (z < goal - 14) {
    const seg = trackAt(segments, z);
    const value = z < 28 ? startVal : valueAt(z, goal, maxVal, rng, minTier);
    const r = radiusFor(value);
    const off = pairT(seg, r);
    const pairChance =
      layout === "pairs" ? Math.max(spec.pair, 0.62) : spec.pair;
    const paired = rng() < pairChance;

    if (layout === "stagger") {
      const t = (Math.floor(z / 9) % 2 === 0 ? -off : off) + (rng() - 0.5) * 0.12;
      balls.push([z, safeX(seg, t, r), value]);
    } else if (layout === "center") {
      balls.push([z, safeX(seg, (rng() - 0.5) * 0.28, r), value]);
    } else if (layout === "lanes") {
      balls.push([z, safeX(seg, -off, r), value]);
      const other = rng() < 0.45 ? value : valueAt(z, goal, maxVal, rng, minTier);
      balls.push([z, safeX(seg, off, radiusFor(other)), other]);
      if (rng() < 0.28 && r < 0.9) balls.push([z, safeX(seg, 0, radiusFor(startVal)), startVal]);
    } else if (layout === "scatter") {
      const n = 1 + Math.floor(rng() * 3);
      for (let k = 0; k < n; k++) {
        const v = rng() < 0.7 ? value : valueAt(z, goal, maxVal, rng, minTier);
        const vr = radiusFor(v);
        balls.push([z + k * Math.max(0.5, vr * 0.35), safeX(seg, rng() * 2 - 1, vr), v]);
      }
    } else if (paired) {
      const t = (rng() * 2 - 1) * Math.max(0.08, 0.55 - off * 0.35);
      balls.push([z, safeX(seg, t - off, r), value]);
      balls.push([z, safeX(seg, t + off, r), value]);
    } else {
      const lanes = rng() < 0.3 ? 3 : rng() < 0.55 ? 2 : 1;
      if (lanes === 1 || r > 1.2) {
        balls.push([z, safeX(seg, rng() * 2 - 1, r), value]);
      } else if (lanes === 2) {
        balls.push([z, safeX(seg, -off, r), value]);
        const other = rng() < 0.4 ? value : valueAt(z, goal, maxVal, rng, minTier);
        balls.push([z, safeX(seg, off, radiusFor(other)), other]);
      } else {
        balls.push([z, safeX(seg, -off, r), value]);
        balls.push([z, safeX(seg, 0, radiusFor(startVal)), startVal]);
        balls.push([z, safeX(seg, off, r), value]);
      }
    }
    z += spec.ballGap + rng() * spec.ballJitter;
  }

  const last = valueAt(goal - 10, goal, maxVal, rng, minTier);
  balls.push([goal - 10, safeX(trackAt(segments, goal - 10), 0.15, radiusFor(last)), last]);
  return balls;
}

function placeSpikes(segments, goal, rng, spec, infinity) {
  const spikes = [];
  let style = spec.spikeStyle;
  let count = spec.spikes;
  if (infinity) {
    count = Math.max(2, Math.min(6, Math.round(spec.spikes * 0.28)));
    if (style === "wall" || style === "pairs") style = "stagger";
    if (style === "bursts") style = "weave";
  } else {
    count = Math.max(1, Math.min(7, Math.round(spec.spikes * 0.38)));
    if (style === "wall") style = "stagger";
    if (style === "pairs") count = Math.max(1, Math.ceil(count * 0.6));
    if (style === "bursts") style = "weave";
  }
  if (count <= 0) return spikes;
  const start = 36;
  const span = Math.max(40, goal - 50 - start);

  for (let i = 0; i < count; i++) {
    let z = start + ((i + 0.5) / count) * span;
    if (style === "bursts") {
      const pack = Math.floor(i / 3);
      const inner = i % 3;
      z = start + ((pack + 0.5) / Math.ceil(count / 3)) * span + (inner - 1) * 2.4;
    } else {
      z += (rng() - 0.5) * spec.spikeJitter;
    }
    const seg = trackAt(segments, z);
    const edge = Math.max(0.4, seg.width / 2 - 0.5);
    let x = seg.cx;

    if (style === "sides") x = seg.cx + (i % 2 === 0 ? -edge : edge);
    else if (style === "weave") x = seg.cx + Math.sin(i * spec.spikePhase) * edge * 0.78;
    else if (style === "wall") {
      for (let k = 0; k < 3; k++) {
        const t = (k / 2) * 2 - 1;
        spikes.push([z, seg.cx + t * edge * 0.68]);
      }
      continue;
    } else if (style === "center") x = seg.cx;
    else if (style === "pairs") {
      spikes.push([z, seg.cx - edge * 0.62]);
      spikes.push([z, seg.cx + edge * 0.62]);
      continue;
    } else if (style === "stagger") x = seg.cx + (i % 2 === 0 ? -edge * 0.7 : edge * 0.7);
    else if (style === "scatter") x = seg.cx + (rng() * 2 - 1) * edge * 0.88;
    else x = seg.cx + (rng() * 2 - 1) * edge * 0.7;

    spikes.push([z, x]);
  }
  return spikes;
}

const RAW = [
  ["First Roll", 230, 8.0, 0.0, "straight", 0.9, 2, "center", 16, 0.25, 1.0, "mix", "random"],
  ["Twin Lanes", 238, 7.8, 0.0, "straight", 0.9, 3, "sides", 16, 0.2, 1.0, "lanes", "lanes"],
  ["Easy Merge", 246, 7.6, 0.0, "straight", 0.9, 3, "center", 32, 0.62, 1.02, "pairs", "center"],
  ["First Thorns", 252, 7.5, 0.7, "sine", 0.85, 7, "weave", 32, 0.32, 1.03, "mix", "random"],
  ["Wide Open", 258, 8.4, 0.0, "straight", 0.9, 4, "scatter", 32, 0.28, 1.04, "scatter", "random"],
  ["Split Decision", 266, 7.6, 1.3, "step", 0.9, 6, "sides", 64, 0.3, 1.05, "lanes", "lanes"],
  ["Gentle Zig", 272, 7.5, 1.5, "sine", 0.72, 7, "weave", 64, 0.3, 1.06, "mix", "random"],
  ["Pair Factory", 278, 7.7, 0.0, "straight", 0.9, 5, "center", 64, 0.74, 1.06, "pairs", "center"],
  ["Thorn Wall", 284, 7.5, 0.2, "straight", 0.9, 8, "wall", 64, 0.26, 1.07, "stagger", "sides"],
  ["Side Step", 288, 7.4, 1.7, "step", 0.9, 8, "sides", 64, 0.28, 1.08, "stagger", "sides"],
  ["S-Bend", 296, 7.5, 2.1, "s", 0.8, 8, "weave", 128, 0.32, 1.09, "mix", "random"],
  ["Rising Tide", 304, 7.6, 1.9, "sweep", 0.7, 9, "weave", 128, 0.38, 1.1, "center", "center"],
  ["Crossfire", 308, 7.5, 0.0, "straight", 0.9, 12, "pairs", 128, 0.26, 1.11, "lanes", "lanes"],
  ["Weave Intro", 312, 7.5, 1.2, "sine", 1.05, 9, "weave", 128, 0.34, 1.11, "mix", "random"],
  ["Driftway", 318, 7.6, 2.3, "drift", 0.85, 8, "center", 128, 0.3, 1.12, "scatter", "random"],
  ["Merge School", 324, 7.8, 0.5, "pulse", 0.9, 7, "center", 256, 0.7, 1.13, "pairs", "center"],
  ["Canyon Run", 330, 7.4, 1.1, "sweep", 0.65, 10, "scatter", 256, 0.3, 1.14, "mix", "random"],
  ["Slalom", 336, 7.4, 2.5, "sine", 0.95, 11, "weave", 256, 0.28, 1.15, "stagger", "sides"],
  ["Big League", 342, 7.5, 1.6, "snake", 0.8, 10, "center", 256, 0.36, 1.16, "mix", "random"],
  ["Gauntlet", 348, 7.4, 0.25, "straight", 0.9, 14, "wall", 256, 0.24, 1.17, "lanes", "lanes"],
  ["Offset", 354, 7.4, 2.0, "zigzag", 0.9, 11, "sides", 512, 0.3, 1.18, "stagger", "sides"],
  ["Split & Spike", 358, 7.5, 1.5, "step", 0.9, 12, "pairs", 512, 0.28, 1.19, "lanes", "lanes"],
  ["Speedway", 368, 7.8, 1.3, "sweep", 0.55, 12, "weave", 512, 0.34, 1.24, "scatter", "random"],
  ["The Sweep", 360, 7.6, 2.7, "sweep", 0.42, 10, "center", 512, 0.3, 1.2, "center", "center"],
  ["Master Zig", 366, 7.4, 2.9, "zigzag", 0.9, 13, "weave", 512, 0.28, 1.21, "mix", "random"],
  ["Thorn Forest", 372, 7.4, 1.4, "snake", 0.88, 16, "wall", 1024, 0.26, 1.22, "scatter", "random"],
  ["High Stakes", 378, 7.5, 1.9, "helix", 0.78, 14, "weave", 1024, 0.34, 1.23, "mix", "random"],
  ["Almost Rainbow", 384, 7.5, 2.3, "s", 0.75, 13, "sides", 1024, 0.4, 1.24, "pairs", "center"],
  ["Final Approach", 390, 7.4, 2.1, "sine", 0.92, 15, "weave", 1024, 0.32, 1.25, "mix", "random"],
  ["Last Gauntlet", 396, 7.4, 2.0, "step", 0.9, 16, "wall", 1024, 0.28, 1.26, "lanes", "lanes"],
  ["Rainbow Gate", 404, 7.5, 2.2, "snake", 0.84, 15, "weave", 1024, 0.4, 1.27, "pairs", "random"],
  ["Double Time", 410, 7.5, 2.5, "helix", 1.02, 14, "stagger", 1024, 0.33, 1.28, "mix", "sides"],
  ["Meander", 416, 7.6, 2.7, "snake", 0.7, 13, "scatter", 1024, 0.3, 1.22, "scatter", "random"],
  ["Spike Garden", 422, 7.5, 0.9, "pulse", 0.95, 18, "bursts", 1024, 0.32, 1.23, "mix", "random"],
  ["Banked Turn", 428, 7.5, 2.9, "s", 0.68, 12, "sides", 1024, 0.3, 1.24, "center", "center"],
  ["Pair Storm", 434, 7.7, 0.15, "straight", 0.9, 11, "center", 1024, 0.78, 1.25, "pairs", "center"],
  ["Long Sweep", 440, 7.6, 2.8, "drift", 0.6, 13, "weave", 1024, 0.34, 1.26, "scatter", "random"],
  ["Staggered", 446, 7.4, 2.3, "zigzag", 0.9, 14, "stagger", 1024, 0.28, 1.27, "stagger", "sides"],
  ["Snake River", 452, 7.5, 2.5, "snake", 0.76, 14, "weave", 1024, 0.32, 1.28, "mix", "random"],
  ["Wall Street", 458, 7.4, 0.35, "straight", 0.9, 17, "wall", 1024, 0.26, 1.29, "lanes", "lanes"],
  ["Switchback", 464, 7.4, 2.5, "step", 0.9, 15, "pairs", 2048, 0.3, 1.3, "stagger", "sides"],
  ["Wide Weave", 470, 8.0, 1.7, "sine", 0.8, 14, "weave", 2048, 0.36, 1.3, "lanes", "lanes"],
  ["Pulse Track", 476, 7.6, 1.3, "pulse", 1.05, 13, "scatter", 2048, 0.32, 1.31, "mix", "random"],
  ["Scatter Thorns", 482, 7.5, 1.6, "drift", 0.7, 18, "scatter", 2048, 0.28, 1.32, "scatter", "random"],
  ["Twin Peaks", 488, 7.5, 2.6, "s", 0.62, 14, "sides", 2048, 0.3, 1.32, "lanes", "lanes"],
  ["Fast Lane", 500, 8.1, 1.1, "sweep", 0.5, 12, "center", 2048, 0.34, 1.38, "center", "center"],
  ["Curve Ball", 494, 7.5, 2.3, "helix", 0.9, 15, "weave", 2048, 0.32, 1.33, "mix", "random"],
  ["Merge Marathon", 506, 7.8, 0.0, "straight", 0.9, 16, "bursts", 2048, 0.72, 1.34, "pairs", "center"],
  ["Spiral", 512, 7.5, 2.7, "helix", 0.68, 15, "weave", 2048, 0.3, 1.35, "scatter", "random"],
  ["Thunder Run", 518, 7.4, 2.6, "zigzag", 0.95, 18, "wall", 2048, 0.26, 1.36, "mix", "random"],
  ["Ribbon", 524, 7.6, 2.9, "sine", 0.58, 14, "sides", 2048, 0.34, 1.36, "stagger", "sides"],
  ["Cascade", 530, 7.5, 2.5, "sweep", 0.48, 16, "stagger", 2048, 0.3, 1.37, "mix", "random"],
  ["Night Shift", 536, 7.5, 2.1, "drift", 0.64, 17, "bursts", 2048, 0.28, 1.38, "scatter", "random"],
  ["Grand Slalom", 542, 7.4, 2.9, "snake", 0.82, 16, "weave", 2048, 0.3, 1.39, "stagger", "sides"],
  ["Fortress", 548, 7.4, 1.9, "step", 0.9, 19, "wall", 2048, 0.24, 1.4, "lanes", "lanes"],
  ["Echo", 554, 7.6, 1.5, "pulse", 1.12, 15, "pairs", 2048, 0.36, 1.4, "mix", "random"],
  ["Overdrive", 568, 7.9, 1.7, "sweep", 0.52, 14, "scatter", 2048, 0.34, 1.46, "center", "center"],
  ["Summit", 560, 7.5, 3.1, "s", 0.55, 16, "weave", 2048, 0.3, 1.42, "mix", "random"],
  ["Storm Front", 574, 7.4, 2.1, "helix", 0.94, 18, "bursts", 2048, 0.28, 1.43, "scatter", "random"],
  ["Apex", 580, 7.4, 2.7, "zigzag", 0.88, 17, "wall", 2048, 0.26, 1.44, "stagger", "sides"],
  ["Last Light", 586, 7.5, 2.5, "drift", 0.58, 16, "weave", 2048, 0.38, 1.45, "pairs", "center"],
  ["Rainbow Road", 598, 7.6, 3.05, "snake", 0.74, 17, "weave", 2048, 0.4, 1.47, "mix", "random"],
  ["The Integer", 606, 7.5, 2.9, "helix", 0.66, 16, "stagger", 2048, 0.42, 1.48, "pairs", "lanes"],
  ["Beyond", 620, 7.6, 3.2, "s", 0.5, 18, "wall", 2048, 0.32, 1.5, "mix", "random"],
];

const SPECS = RAW.map((row, index) => {
  const [
    name, goal, w, zig, path, freq, spikes, spikeStyle, max, pair, speed, layout, scatter,
  ] = row;
  const hard = index / 63;
  return {
    index,
    name,
    goal,
    w,
    zig,
    path,
    freq,
    spikes,
    spikeStyle,
    max,
    pair,
    speed,
    layout,
    scatter,
    segLen: 14 + (index % 5) * 2,
    segMod: 3 + (index % 4),
    segStep: 3 + (index % 3) * 2,
    ballGap: 5.6 + (index % 5) * 0.55,
    ballJitter: 4.2 + (index % 4) * 0.8,
    chunks: 3 + (index % 4),
    chunkBalls: 5 + (index % 5),
    introChunks: 2 + (index % 3),
    chunkGap: 6 + (index % 5),
    gapJitter: 6 + (index % 4) * 2,
    prevChance: 0.35 + (index % 5) * 0.06,
    nextChance: 0.12 + (index % 4) * 0.05,
    infSpikeMul: 1.6 + hard * 1.1,
    spikeJitter: 4 + (index % 5),
    spikePhase: 1.35 + (index % 7) * 0.22,
  };
});

export const LEVEL_COUNT = SPECS.length;

export function levelName(index) {
  return SPECS[Math.max(0, Math.min(SPECS.length - 1, index))].name;
}

export function getLevel(index, infinity = false, superMode = false, extra = {}) {
  const i = clamp(index, 0, SPECS.length - 1);
  const spec = SPECS[i];
  const endless = !!extra.endless;
  const minTier = toBigTier(extra.minTier ?? 1);
  const rng = mulberry32(
    0x2048 +
      i * 9973 +
      (endless ? 4242 + i * 13 : superMode ? 9001 + i * 71 : infinity ? 1337 + i * 41 : 0) +
      Number(minTier % 1000003n) * 17
  );
  const climb = extra.climb ?? (endless ? 256 : superMode ? 127 : infinity ? 62 : 0);
  const covered = Math.max(4, tierOf(BigInt(spec.max)));
  const goal = climb ? Math.round(spec.goal * (climb / covered)) : spec.goal;
  let topTier =
    extra.topTier != null
      ? toBigTier(extra.topTier)
      : BigInt(endless ? 1024 : superMode ? 127 : infinity ? 62 : Math.max(1, tierOf(BigInt(spec.max))));
  if (topTier < minTier) topTier = minTier;
  const max = 2n ** topTier;
  const segments = buildSegments(goal, spec);
  return {
    id: i + 1,
    index: i,
    name: spec.name,
    goalZ: goal,
    speed: spec.speed,
    path: spec.path,
    segments,
    balls: placeBalls(segments, goal, rng, spec, max, minTier),
    spikes: placeSpikes(segments, goal, rng, spec, infinity || superMode || endless),
  };
}

export { radiusFor };
