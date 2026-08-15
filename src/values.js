export const MAX_2048 = 11n;
export const MAX_INF = 63n;
export const MAX_SUPER = 128n;
export const FLOOR_HALF = -31n;
export const SUPER_LABEL = "340,282,366,920,938,463,463,374,607,431,768,211,456";

export function toVal(v) {
  try {
    if (typeof v === "bigint") return v;
    if (v && typeof v === "object" && "e" in v) return toVal(v.e);
    if (typeof v === "number" && Number.isFinite(v)) return BigInt(Math.trunc(v));
    return BigInt(String(v));
  } catch {
    return 1n;
  }
}

export function asVal(v) {
  if (v && typeof v === "object" && "e" in v) {
    let k = 1n;
    try {
      k = typeof v.k === "bigint" ? v.k : BigInt(v.k ?? 1);
    } catch {
      k = 1n;
    }
    if (k <= 0n) k = 1n;
    return { k, e: toVal(v.e) };
  }
  return { k: 1n, e: toVal(v) };
}

export function valEq(a, b) {
  const x = asVal(a);
  const y = asVal(b);
  return x.k === y.k && x.e === y.e;
}

export function magCmp(a, b) {
  const x = asVal(a);
  const y = asVal(b);
  if (x.e >= y.e) {
    const left = x.k << (x.e - y.e);
    if (left > y.k) return 1;
    if (left < y.k) return -1;
    return 0;
  }
  const right = y.k << (y.e - x.e);
  if (x.k > right) return 1;
  if (x.k < right) return -1;
  return 0;
}

function triCount(k) {
  let t = 0;
  let x = k;
  while (x > 1n && x % 3n === 0n && t < 40) {
    x /= 3n;
    t += 1;
  }
  return t;
}

export function magLog2(value) {
  const { k, e } = asVal(value);
  return Number(e) + triCount(k) * 1.5849625;
}

export function tierOf(value) {
  const n = magLog2(value);
  if (n > 1000000) return 1000000;
  if (n < -1000000) return -1000000;
  return n;
}

export function fromTier(tier) {
  return toVal(tier);
}

export function magTier(magnitude) {
  let v = toVal(magnitude);
  if (v <= 1n) return 0;
  let bits = 0;
  while (v > 0xffffffffn) {
    v >>= 32n;
    bits += 32;
  }
  bits += 32 - Math.clz32(Number(v));
  return bits - 1;
}

export function radiusFor(value) {
  const tier = Math.max(-12, Math.min(26, tierOf(value)));
  return Math.max(0.18, 0.36 + (tier - 1) * 0.055);
}

export function doubleVal(value, _max) {
  const x = asVal(value);
  return x.k === 1n ? x.e + 1n : { k: x.k, e: x.e + 1n };
}

export function halfVal(value, floor = 1n) {
  const x = asVal(value);
  const next = x.k === 1n ? x.e - 1n : { k: x.k, e: x.e - 1n };
  if (magCmp(next, floor) < 0) return asVal(floor).k === 1n ? asVal(floor).e : asVal(floor);
  return next;
}

export function mul15(value) {
  const x = asVal(value);
  return { k: x.k * 3n, e: x.e - 1n };
}

export function serializeVal(value) {
  const x = asVal(value);
  return x.k === 1n ? x.e.toString() : `${x.k}:${x.e}`;
}

export function parseVal(raw) {
  const s = String(raw ?? "");
  if (s.includes(":")) {
    const [k, e] = s.split(":");
    try {
      return { k: BigInt(k), e: BigInt(e) };
    } catch {
      return 1n;
    }
  }
  try {
    return BigInt(s);
  } catch {
    return 1n;
  }
}

export function formatValue(value) {
  return shortValue(value);
}

const COMPACT_UNITS = [
  [10n ** 36n, "Ud"],
  [10n ** 33n, "Dc"],
  [10n ** 30n, "No"],
  [10n ** 27n, "Oc"],
  [10n ** 24n, "Sp"],
  [10n ** 21n, "Sx"],
  [10n ** 18n, "Qi"],
  [10n ** 15n, "Qa"],
  [10n ** 12n, "T"],
  [10n ** 9n, "B"],
  [10n ** 6n, "M"],
  [10n ** 3n, "K"],
];

function formatPow2(e) {
  if (e === 0n) return "1";
  if (e < 0n) {
    const n = Number(e);
    if (n >= -8) {
      const s = (2 ** n).toPrecision(n <= -5 ? 3 : 6);
      return String(Number(s));
    }
    return `2^${e}`;
  }
  if (e < 14n) return (2n ** e).toString();
  if (e >= 40n) return `2^${e}`;
  const mag = 2n ** e;
  for (const [scale, suffix] of COMPACT_UNITS) {
    if (mag >= scale) {
      const n = mag / scale;
      if (n >= 10000n) return `2^${e}`;
      return `${n}${suffix}`;
    }
  }
  return `2^${e}`;
}

export function shortValue(value) {
  const { k, e } = asVal(value);
  if (k === 1n) return formatPow2(e);
  if (e >= 0n && e < 20n) {
    const mag = k << e;
    if (mag < 100000n) return mag.toString();
  }
  if (e < 0n && e >= -8n && k < 10000n) {
    const n = Number(k) * 2 ** Number(e);
    if (Number.isFinite(n)) return String(Number(n.toPrecision(6)));
  }
  if (k === 3n) return e === 0n ? "3" : `3·2^${e}`;
  return `${k}·2^${e}`;
}

export function padLabel(value) {
  return { main: shortValue(value), sub: "" };
}

const TIER_HEX = [
  0xf4efe6, 0xefe0c4, 0x7ed957, 0xff3d9a, 0x2d4cff, 0xffe14a, 0x3ee0ff, 0x9b5cff, 0x7a6b9a,
  0xedc53f, 0xff5ad6,
];

function lum(hex) {
  const r = ((hex >> 16) & 255) / 255;
  const g = ((hex >> 8) & 255) / 255;
  const b = (hex & 255) / 255;
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function hslHex(h, s, l) {
  const a = s * Math.min(l, 1 - l);
  const f = (n) => {
    const k = (n + h * 12) % 12;
    const c = l - a * Math.max(Math.min(k - 3, 9 - k, 1), -1);
    return Math.round(255 * c);
  };
  return (f(0) << 16) + (f(8) << 8) + f(4);
}

export function padColor(value) {
  const { k } = asVal(value);
  const tier = tierOf(value);
  if (k !== 1n) {
    return hslHex((0.14 + triCount(k) * 0.08 + tier * 0.03) % 1, 0.82, 0.52);
  }
  if (tier < 1) {
    const t = Math.max(0, 8 + tier);
    const ice = 0x6ec8ff - t * 0x081018;
    return ice > 0 ? ice : 0x3a6aa8;
  }
  const nearest = Math.round(tier);
  if (nearest >= 1 && nearest <= TIER_HEX.length) return TIER_HEX[nearest - 1];
  return hslHex((tier * 0.173) % 1, 0.78, 0.52);
}

export function styleFor(value) {
  const color = padColor(value);
  const text = lum(color) > 0.62 ? "#2b1c10" : "#ffffff";
  return { color, emissive: color, text };
}

export function isRainbow(value, max) {
  if (max == null) return false;
  return magLog2(value) + 1e-6 >= magLog2(max);
}
