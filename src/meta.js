const STAR_KEY = "ball-run-2048-stars";
const UP_KEY = "ball-run-2048-upgrades";
const SET_KEY = "ball-run-2048-settings";

export const UPGRADE_LIST = [
  {
    id: "start",
    name: "Bigger Ball",
    desc: "Start as 4 instead of 2. Buy again for 8, 16, 32… no cap.",
    max: null,
  },
  {
    id: "life",
    name: "Spare Heart",
    desc: "Start each run with extra lives.",
    max: 2,
    costs: [50, 140],
  },
  {
    id: "shield",
    name: "Starter Shield",
    desc: "Begin with a spike shield charged.",
    max: 1,
    costs: [90],
  },
  {
    id: "magnet",
    name: "Magnet Coil",
    desc: "Longer pull. Matching balls come to you.",
    max: 5,
    costs: [25, 55, 95, 155, 240],
  },
  {
    id: "steer",
    name: "Grip Tires",
    desc: "Snap left and right faster.",
    max: 5,
    costs: [20, 40, 75, 120, 180],
  },
  {
    id: "combo",
    name: "Combo Fuse",
    desc: "Combo lasts longer. Fever hits sooner.",
    max: 5,
    costs: [30, 65, 110, 170, 260],
  },
  {
    id: "luck",
    name: "Star Luck",
    desc: "More stars and powerups on the track.",
    max: 5,
    costs: [35, 70, 120, 190, 280],
  },
  {
    id: "boost",
    name: "Afterburner",
    desc: "Boosts last longer and hit harder.",
    max: 5,
    costs: [25, 55, 95, 150, 230],
  },
];

export function upgradeCost(u, lv) {
  if (u.max == null) {
    return Math.max(25, Math.min(1e12, Math.round(25 * 1.55 ** lv)));
  }
  return u.costs[lv];
}

export function defaultUpgrades() {
  return Object.fromEntries(UPGRADE_LIST.map((u) => [u.id, 0]));
}

export function defaultSettings() {
  return {
    sfx: true,
    volume: 0.85,
    quality: "med",
    shake: true,
    invert: false,
    flash: true,
    scanlines: true,
    vignette: true,
  };
}

function readJson(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return fallback;
    return { ...fallback, ...JSON.parse(raw) };
  } catch {
    return fallback;
  }
}

export function loadStars() {
  const raw = localStorage.getItem(STAR_KEY);
  if (raw == null) {
    saveStars(25);
    return 25;
  }
  const n = Number(raw);
  return Number.isFinite(n) ? Math.max(0, Math.floor(n)) : 0;
}

export function saveStars(n) {
  localStorage.setItem(STAR_KEY, String(Math.max(0, Math.floor(n))));
}

export function loadUpgrades() {
  const data = readJson(UP_KEY, defaultUpgrades());
  const out = defaultUpgrades();
  for (const u of UPGRADE_LIST) {
    const v = Number(data[u.id] || 0);
    const n = Number.isFinite(v) ? Math.max(0, Math.floor(v)) : 0;
    out[u.id] = u.max == null ? n : Math.min(u.max, n);
  }
  return out;
}

export function saveUpgrades(obj) {
  localStorage.setItem(UP_KEY, JSON.stringify(obj));
}

export function loadSettings() {
  const data = readJson(SET_KEY, defaultSettings());
  const d = defaultSettings();
  return {
    sfx: data.sfx !== false,
    volume: Math.min(1, Math.max(0, Number(data.volume ?? d.volume))),
    quality: data.quality === "low" || data.quality === "high" ? data.quality : "med",
    shake: data.shake !== false,
    invert: !!data.invert,
    flash: data.flash !== false,
    scanlines: data.scanlines !== false,
    vignette: data.vignette !== false,
  };
}

export function saveSettings(obj) {
  localStorage.setItem(SET_KEY, JSON.stringify(obj));
}
