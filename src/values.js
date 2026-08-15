export const MAX_2048 = 2048n;
export const MAX_INF = 2n ** 63n;
export const MAX_SUPER = 2n ** 128n;
export const SUPER_LABEL = "340,282,366,920,938,463,463,374,607,431,768,211,456";

export function toVal(v) {
  return typeof v === "bigint" ? v : BigInt(v);
}

export function tierOf(value) {
  let v = toVal(value);
  if (v <= 1n) return 0;
  let bits = 0;
  while (v > 0xffffffffn) {
    v >>= 32n;
    bits += 32;
  }
  bits += 32 - Math.clz32(Number(v));
  return bits - 1;
}

export function fromTier(tier) {
  return 2n ** BigInt(tier);
}

export function radiusFor(value) {
  const tier = tierOf(value);
  const visual = Math.min(tier, 26);
  return 0.42 + Math.max(0, visual - 1) * 0.07;
}

export function doubleVal(value, max) {
  const next = toVal(value) * 2n;
  if (max == null) return next;
  return next > max ? max : next;
}

export function halfVal(value) {
  const v = toVal(value) / 2n;
  return v < 2n ? 2n : v;
}

export function formatValue(value) {
  const s = toVal(value).toString();
  return s.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
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
  const v = toVal(value);
  if (v < 10000n) return v.toString();
  const tier = tierOf(v);
  if (tier >= 40) return `2^${tier}`;
  for (const [scale, suffix] of COMPACT_UNITS) {
    if (v >= scale) {
      const n = v / scale;
      if (n >= 10000n) return `2^${tier}`;
      return `${n}${suffix}`;
    }
  }
  return `2^${tier}`;
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
