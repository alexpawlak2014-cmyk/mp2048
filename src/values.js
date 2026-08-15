export const MAX_2048 = 11n;
export const MAX_INF = 63n;
export const MAX_SUPER = 128n;
export const FLOOR_HALF = -31n;
export const SUPER_LABEL = "340,282,366,920,938,463,463,374,607,431,768,211,456";

export function toVal(v) {
  try {
    if (typeof v === "bigint") return v;
    if (typeof v === "number" && Number.isFinite(v)) return BigInt(Math.trunc(v));
    return BigInt(String(v));
  } catch {
    return 1n;
  }
}

export function tierOf(value) {
  const v = toVal(value);
  if (v > 1000000n) return 1000000;
  if (v < -1000000n) return -1000000;
  return Number(v);
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
  return toVal(value) + 1n;
}

export function halfVal(value, floor = 1n) {
  const next = toVal(value) - 1n;
  const f = toVal(floor);
  return next < f ? f : next;
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

export function shortValue(value) {
  const e = toVal(value);
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

export function padColor(value) {
  const tier = tierOf(value);
  if (tier < 1) {
    const t = Math.max(0, 8 + tier);
    const ice = 0x6ec8ff - t * 0x081018;
    return ice > 0 ? ice : 0x3a6aa8;
  }
  if (tier >= 1 && tier <= TIER_HEX.length) return TIER_HEX[tier - 1];
  const h = (tier * 0.173) % 1;
  const s = 0.78;
  const l = 0.52;
  const a = s * Math.min(l, 1 - l);
  const f = (n) => {
    const k = (n + h * 12) % 12;
    const c = l - a * Math.max(Math.min(k - 3, 9 - k, 1), -1);
    return Math.round(255 * c);
  };
  return (f(0) << 16) + (f(8) << 8) + f(4);
}

export function styleFor(value) {
  const color = padColor(value);
  const text = lum(color) > 0.62 ? "#2b1c10" : "#ffffff";
  return { color, emissive: color, text };
}

export function isRainbow(value, max) {
  if (max == null) return false;
  return toVal(value) >= toVal(max);
}
