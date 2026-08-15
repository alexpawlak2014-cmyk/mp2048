import * as THREE from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import { EffectComposer } from "three/addons/postprocessing/EffectComposer.js";
import { RenderPass } from "three/addons/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "three/addons/postprocessing/UnrealBloomPass.js";
import { OutputPass } from "three/addons/postprocessing/OutputPass.js";
import { Sfx } from "./audio.js";
import { LEVEL_COUNT, getLevel, levelName } from "./levels.js";
import {
  MAX_2048,
  FLOOR_HALF,
  radiusFor,
  toVal,
  tierOf,
  magTier,
  fromTier,
  doubleVal,
  halfVal,
  mul15,
  valEq,
  magCmp,
  serializeVal,
  parseVal,
  shortValue,
  padLabel,
  padColor,
  styleFor,
  isRainbow,
} from "./values.js";
import {
  UPGRADE_LIST,
  upgradeCost,
  loadStars,
  saveStars,
  loadUpgrades,
  saveUpgrades,
  loadSettings,
  saveSettings,
} from "./meta.js";

const BEST_KEY = "ball-run-2048-best";
const UNLOCK_KEY = "ball-run-2048-unlocked";
const SANDBOX_KEY = "ball-run-2048-sandbox-tier";
const SANDBOX_MAP_KEY = "ball-run-2048-sandbox-map";
const CUSTOM_KEY = "mp2048-custom-cap";
const SANDBOX_CEIL_KEY = "mp2048-sandbox-ceil";
function parseSandboxTier(raw) {
  const digits = String(raw ?? "").replace(/[^\d]/g, "");
  if (!digits) return 1n;
  const s = digits.replace(/^0+/, "") || "0";
  if (s === "0") return 1n;
  try {
    const n = BigInt(s);
    if (n > 4096n) return 4096n;
    return n < 1n ? 1n : n;
  } catch {
    return 1n;
  }
}

function expLabel(n) {
  const e = toVal(n);
  return e >= 40n ? `2^${e}` : shortValue(fromTier(e));
}

const SANDBOX_MAPS = ["2048", "inf", "super", "endless", "custom", "half", "halfinf"];

function toBigTier(v, fallback = 1n) {
  try {
    if (typeof v === "bigint") return v < 1n ? fallback : v;
    if (typeof v === "number" && Number.isFinite(v)) {
      const n = Math.max(1, Math.floor(v));
      return BigInt(n);
    }
    return parseSandboxTier(v);
  } catch {
    return fallback;
  }
}

function readSandboxMap() {
  const v = localStorage.getItem(SANDBOX_MAP_KEY);
  if (
    v === "2048" ||
    v === "inf" ||
    v === "super" ||
    v === "endless" ||
    v === "custom" ||
    v === "half" ||
    v === "halfinf"
  ) {
    return v;
  }
  return "inf";
}
const SPHERE = new THREE.SphereGeometry(1, 16, 12);
const SPARK_GEO = new THREE.SphereGeometry(0.1, 5, 5);
const CONFETTI_GEO = new THREE.BoxGeometry(0.16, 0.05, 0.24);
const WAVE_GEO = new THREE.TorusGeometry(0.25, 0.07, 5, 16);
const OCTA_GEO = new THREE.OctahedronGeometry(0.55, 0);
const DECOR_CYL_GEO = new THREE.CylinderGeometry(0.32, 0.48, 1.3, 6);
const CLOUD_GEO = new THREE.SphereGeometry(2.4, 6, 4);
const BOOST_GEO = new THREE.TorusGeometry(0.42, 0.08, 6, 16);
const SHIELD_GEO = new THREE.OctahedronGeometry(0.38, 0);
const STAR_GEO = new THREE.OctahedronGeometry(0.28, 0);
const SPIKE_RADIUS = 0.4;
const SPIKE_TOP = 0.67;
const SPIKE_BASE_GEO = new THREE.CylinderGeometry(SPIKE_RADIUS, SPIKE_RADIUS, 0.12, 8);
const SPIKE_CONE_GEO = new THREE.ConeGeometry(0.12, 0.58, 5);
const MUL_SLAB_GEO = new THREE.BoxGeometry(1, 1.45, 0.28);
const MUL_POST_GEO = new THREE.BoxGeometry(0.22, 1.7, 0.22);

function hexCss(n) {
  return `#${n.toString(16).padStart(6, "0")}`;
}

function sphereHit(ax, ay, az, ar, bx, by, bz, br) {
  const dx = ax - bx;
  const dy = ay - by;
  const dz = az - bz;
  const min = ar + br;
  return dx * dx + dy * dy + dz * dz < min * min;
}

function sphereOverlap(ax, ay, az, ar, bx, by, bz, br) {
  const dx = bx - ax;
  const dy = by - ay;
  const dz = bz - az;
  const dist = Math.hypot(dx, dy, dz);
  const min = ar + br;
  if (dist >= min) return null;
  if (dist < 1e-8) return { nx: 1, ny: 0, nz: 0, dist: 0, overlap: min };
  return { nx: dx / dist, ny: dy / dist, nz: dz / dist, dist, overlap: min - dist };
}

function sphereVsCylinder(px, py, pz, pr, cx, cz, radius, y0, y1) {
  const radial = Math.hypot(px - cx, pz - cz);
  const closestY = Math.min(y1, Math.max(y0, py));
  const dy = py - closestY;
  const dxz = Math.max(0, radial - radius);
  return dxz * dxz + dy * dy < pr * pr;
}

export class MP2048 {
  constructor(canvas) {
    this.canvas = canvas;
    this.sfx = new Sfx();
    this.infinity = false;
    this.superMode = false;
    this.endless = false;
    this.sandbox = false;
    this.custom = false;
    this.half = false;
    this.halfInf = false;
    this.mode = "2048";
    this.sandboxTier = parseSandboxTier(localStorage.getItem(SANDBOX_KEY) || "1");
    this.sandboxMap = readSandboxMap();
    this.customCap = parseSandboxTier(localStorage.getItem(CUSTOM_KEY) || "11");
    this.sandboxCeil = parseSandboxTier(localStorage.getItem(SANDBOX_CEIL_KEY) || "11");
    this.maxValue = MAX_2048;
    this.shake = 0;
    this.fovPunch = 0;
    this.trailClock = 0;
    this.combo = 0;
    this.comboTimer = 0;
    this.slow = 0;
    this.waves = [];
    this.streaks = [];
    this.runSpeed = 12;
    this.best = this.loadBest();
    this.unlocked = Math.max(1, Number(localStorage.getItem(UNLOCK_KEY) || 1));
    this.levelIndex = 0;
    this.level = getLevel(0, false);
    this.state = "title";
    this.clock = new THREE.Clock();
    this.keys = { left: false, right: false };
    this.pointerActive = false;
    this.pointerX = 0;
    this.invuln = 0;
    this.particles = [];
    this.texCache = new Map();
    this.matCache = new Map();
    this.trackGroup = null;
    this.winGroup = null;
    this.winPads = [];
    this.winTimer = 0;
    this.winPadIndex = -1;
    this.squash = 1;
    this.merges = 0;
    this.shield = 0;
    this.magnet = 0;
    this.boost = 0;
    this.fever = 0;
    this.powerups = [];
    this.segHint = 0;
    this.lives = 0;
    this.gems = 0;
    this.useBloom = true;
    this.frameAvg = 0.016;
    this.nearPickups = [];
    this._hudMerges = "";
    this._hudBuffs = "";
    this.wallet = loadStars();
    this.upgrades = loadUpgrades();
    this.settings = loadSettings();
    this.syncCap();
    this.menu = null;
    this.menuFrom = "title";
    this.runStars = 0;

    this.els = {
      hud: document.querySelector("#hud"),
      badge: document.querySelector("#badge"),
      bestHud: document.querySelector("#best-hud"),
      levelHud: document.querySelector("#level-hud"),
      toast: document.querySelector("#toast"),
      combo: document.querySelector("#combo"),
      flash: document.querySelector("#fx-flash"),
      kicker: document.querySelector(".kicker"),
      title: document.querySelector("#title-screen"),
      end: document.querySelector("#end-screen"),
      play: document.querySelector("#play"),
      retry: document.querySelector("#retry"),
      next: document.querySelector("#next"),
      toLevels: document.querySelector("#to-levels"),
      bestTitle: document.querySelector("#best-title"),
      endKicker: document.querySelector("#end-kicker"),
      endTitle: document.querySelector("#end-title"),
      endNumber: document.querySelector("#end-number"),
      endMsg: document.querySelector("#end-msg"),
      grid: document.querySelector("#level-grid"),
      mode2048: document.querySelector("#mode-2048"),
      modeInf: document.querySelector("#mode-inf"),
      modeSuper: document.querySelector("#mode-super"),
      modeEndless: document.querySelector("#mode-endless"),
      modeCustom: document.querySelector("#mode-custom"),
      modeHalf: document.querySelector("#mode-half"),
      modeHalfInf: document.querySelector("#mode-halfinf"),
      modeSandbox: document.querySelector("#mode-sandbox"),
      sandboxPanel: document.querySelector("#sandbox-panel"),
      sandboxSize: document.querySelector("#sandbox-size"),
      sandboxLabel: document.querySelector("#sandbox-label"),
      customPanel: document.querySelector("#custom-panel"),
      customSize: document.querySelector("#custom-size"),
      customLabel: document.querySelector("#custom-label"),
      customMinus: document.querySelector("#custom-minus"),
      customPlus: document.querySelector("#custom-plus"),
      sandboxCeilWrap: document.querySelector("#sandbox-ceil-wrap"),
      sandboxCeilSize: document.querySelector("#sandbox-ceil-size"),
      sandboxCeilLabel: document.querySelector("#sandbox-ceil-label"),
      sandboxCeilMinus: document.querySelector("#sandbox-ceil-minus"),
      sandboxCeilPlus: document.querySelector("#sandbox-ceil-plus"),
      statMerges: document.querySelector("#stat-merges"),
      statBuffs: document.querySelector("#stat-buffs"),
      fever: document.querySelector("#fever"),
      sandboxMinus: document.querySelector("#sandbox-minus"),
      sandboxPlus: document.querySelector("#sandbox-plus"),
      smap2048: document.querySelector("#smap-2048"),
      smapInf: document.querySelector("#smap-inf"),
      smapSuper: document.querySelector("#smap-super"),
      smapEndless: document.querySelector("#smap-endless"),
      smapCustom: document.querySelector("#smap-custom"),
      smapHalf: document.querySelector("#smap-half"),
      smapHalfInf: document.querySelector("#smap-halfinf"),
      blurb: document.querySelector(".blurb"),
      pauseBtn: document.querySelector("#pause-btn"),
      starHud: document.querySelector("#star-hud"),
      starWallet: document.querySelector("#star-wallet"),
      upgradesBtn: document.querySelector("#upgrades-btn"),
      settingsBtn: document.querySelector("#settings-btn"),
      upgrades: document.querySelector("#upgrades-screen"),
      settings: document.querySelector("#settings-screen"),
      shopList: document.querySelector("#shop-list"),
      shopWallet: document.querySelector("#shop-wallet"),
      shopBack: document.querySelector("#shop-back"),
      settingsBack: document.querySelector("#settings-back"),
      settingsResume: document.querySelector("#settings-resume"),
      settingsKicker: document.querySelector("#settings-kicker"),
      endStars: document.querySelector("#end-stars"),
      endUpgrades: document.querySelector("#end-upgrades"),
      setSfx: document.querySelector("#set-sfx"),
      setVolume: document.querySelector("#set-volume"),
      setShake: document.querySelector("#set-shake"),
      setInvert: document.querySelector("#set-invert"),
      setFlash: document.querySelector("#set-flash"),
      setScanlines: document.querySelector("#set-scanlines"),
      setVignette: document.querySelector("#set-vignette"),
      qualLow: document.querySelector("#qual-low"),
      qualMed: document.querySelector("#qual-med"),
      qualHigh: document.querySelector("#qual-high"),
    };
  }

  bestKey() {
    if (this.sandbox) return `${BEST_KEY}-sandbox`;
    if (this.endless) return `${BEST_KEY}-endless`;
    if (this.superMode) return `${BEST_KEY}-super`;
    if (this.halfInf) return `${BEST_KEY}-halfinf`;
    if (this.half) return `${BEST_KEY}-half`;
    if (this.custom) return `${BEST_KEY}-custom`;
    if (this.infinity) return `${BEST_KEY}-inf`;
    return BEST_KEY;
  }

  mapKind() {
    if (this.sandbox) return this.sandboxMap;
    if (this.endless) return "endless";
    if (this.superMode) return "super";
    if (this.halfInf) return "halfinf";
    if (this.half) return "half";
    if (this.custom) return "custom";
    if (this.infinity) return "inf";
    return "2048";
  }

  isHalfKind() {
    const k = this.mapKind();
    return k === "half" || k === "halfinf";
  }

  heavyFx() {
    const k = this.mapKind();
    return k === "super" || k === "endless";
  }

  infLook() {
    const k = this.mapKind();
    return k === "inf" || k === "halfinf";
  }

  canGrow(_value) {
    return true;
  }

  startValue() {
    if (this.sandbox) return fromTier(this.sandboxTier);
    if (this.half || this.halfInf) return 1n;
    return fromTier(1 + this.up("start"));
  }

  floorExp() {
    return this.isHalfKind() ? FLOOR_HALF : 1n;
  }

  capTier() {
    const start = this.startValue();
    const k = this.mapKind();
    if (k === "custom") {
      const cap = this.sandbox ? this.sandboxCeil : this.customCap;
      return cap < start ? start : cap;
    }
    if (k === "half") return start + 10n;
    if (k === "halfinf") return start + 62n;
    if (k === "super") return start + 127n;
    if (k === "inf") return start + 62n;
    if (k === "endless") return start + 1024n;
    return start + 10n;
  }

  modeMax() {
    const k = this.mapKind();
    if (k === "endless") return null;
    if (this.sandbox && k !== "custom" && k !== "half" && k !== "halfinf") return null;
    return fromTier(this.capTier());
  }

  syncCap() {
    this.maxValue = this.modeMax();
  }

  up(id) {
    return this.upgrades[id] | 0;
  }

  refreshWallet() {
    const label = `★ ${this.wallet}`;
    if (this.els.starWallet) this.els.starWallet.textContent = label;
    if (this.els.starHud) this.els.starHud.textContent = label;
    if (this.els.shopWallet) this.els.shopWallet.textContent = label;
  }

  applySettings() {
    const s = this.settings;
    this.sfx.muted = !s.sfx;
    this.sfx.volume = s.volume;
    document.body.classList.toggle("no-scanlines", !s.scanlines);
    document.body.classList.toggle("no-vignette", !s.vignette);
    if (!this.renderer) return;
    const cap = s.quality === "high" ? 1.25 : 1;
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, cap));
    this.renderer.shadowMap.enabled = s.quality === "high";
    if (this.sun) {
      this.sun.castShadow = s.quality === "high";
      this.sun.shadow.mapSize.set(512, 512);
    }
    this.useBloom = s.quality === "high";
    if (this.playerLight) this.playerLight.visible = s.quality === "high";
  }

  syncSettingsUi() {
    const s = this.settings;
    const toggle = (el, on) => {
      if (!el) return;
      el.classList.toggle("on", on);
      el.textContent = on ? "ON" : "OFF";
    };
    toggle(this.els.setSfx, s.sfx);
    toggle(this.els.setShake, s.shake);
    toggle(this.els.setInvert, s.invert);
    toggle(this.els.setFlash, s.flash);
    toggle(this.els.setScanlines, s.scanlines);
    toggle(this.els.setVignette, s.vignette);
    if (this.els.setVolume) this.els.setVolume.value = String(Math.round(s.volume * 100));
    this.els.qualLow?.classList.toggle("on", s.quality === "low");
    this.els.qualMed?.classList.toggle("on", s.quality === "med");
    this.els.qualHigh?.classList.toggle("on", s.quality === "high");
    const paused = this.state === "paused" || this.menuFrom === "play" || this.menuFrom === "paused";
    this.els.settingsResume?.classList.toggle("hidden", !paused);
    if (this.els.settingsKicker) {
      this.els.settingsKicker.textContent = paused ? "paused" : "tweak the run";
    }
  }

  patchSetting(key, value) {
    this.settings[key] = value;
    saveSettings(this.settings);
    this.applySettings();
    this.syncSettingsUi();
  }

  openMenu(which, from) {
    this.menu = which;
    this.menuFrom = from || (this.state === "play" ? "play" : this.state);
    if (this.state === "play") this.state = "paused";
    this.els.upgrades?.classList.toggle("hidden", which !== "upgrades");
    this.els.settings?.classList.toggle("hidden", which !== "settings");
    this.els.pauseBtn?.classList.add("hidden");
    if (which === "upgrades") this.renderShop();
    if (which === "settings") this.syncSettingsUi();
    this.refreshWallet();
  }

  closeMenu() {
    this.els.upgrades?.classList.add("hidden");
    this.els.settings?.classList.add("hidden");
    const from = this.menuFrom;
    this.menu = null;
    if (from === "play" || from === "paused") this.resume();
    else if (from === "end") {
      this.state = "end";
      this.els.end.classList.remove("hidden");
    }
  }

  resume() {
    this.els.upgrades?.classList.add("hidden");
    this.els.settings?.classList.add("hidden");
    this.menu = null;
    this.state = "play";
    this.els.hud.classList.remove("hidden");
    this.els.pauseBtn?.classList.remove("hidden");
    this.clock.getDelta();
  }

  renderShop() {
    const root = this.els.shopList;
    if (!root) return;
    root.innerHTML = "";
    this.refreshWallet();
    for (const u of UPGRADE_LIST) {
      const lv = this.up(u.id);
      const maxed = u.max != null && lv >= u.max;
      const cost = maxed ? 0 : upgradeCost(u, lv);
      let desc = u.desc;
      if (u.id === "start") {
        const now = shortValue(fromTier(1 + lv));
        const next = shortValue(fromTier(2 + lv));
        desc = lv === 0 ? "Start as 4 instead of 2." : `Now ${now}. Next start: ${next}.`;
      }
      const row = document.createElement("div");
      row.className = "shop-row";
      const btn = document.createElement("button");
      btn.type = "button";
      btn.dataset.up = u.id;
      btn.disabled = maxed || this.wallet < cost;
      btn.textContent = maxed ? "MAX" : `★ ${cost}`;
      const info = document.createElement("div");
      const lvLabel = u.max == null ? `Lv ${lv}` : `Lv ${lv}/${u.max}`;
      info.innerHTML = `<strong>${u.name}</strong><small>${lvLabel} · ${desc}</small>`;
      row.append(info, btn);
      root.appendChild(row);
    }
  }

  buyUpgrade(id) {
    const u = UPGRADE_LIST.find((x) => x.id === id);
    if (!u) return;
    const lv = this.up(id);
    if (u.max != null && lv >= u.max) return;
    const cost = upgradeCost(u, lv);
    if (this.wallet < cost) return;
    this.wallet -= cost;
    this.upgrades[id] = lv + 1;
    saveStars(this.wallet);
    saveUpgrades(this.upgrades);
    this.renderShop();
    this.refreshWallet();
    this.sfx.sparkle(6);
    if (id === "start") {
      this.syncCap();
      this.texCache.clear();
      this.matCache.clear();
      this.resetPlayerPose();
      this.applyModeChrome();
      if (this.state === "title" || this.menuFrom === "title") {
        this.loadLevel(this.levelIndex, false);
      }
    }
  }

  awardRunStars(kind) {
    const bonus = kind === "goal" ? 15 + this.levelIndex : 0;
    const earned = this.runStars + bonus;
    if (earned > 0) {
      this.wallet += earned;
      saveStars(this.wallet);
    }
    this.refreshWallet();
    if (this.els.endStars) this.els.endStars.textContent = `+${earned} ★`;
  }

  levelOpts() {
    const start = this.startValue();
    const k = this.mapKind();
    const spikeMul = k === "half" || k === "halfinf" ? 1.5 : 1;
    const mulWalls = k === "half" || k === "halfinf";
    if (k === "custom") {
      let cap = this.sandbox ? this.sandboxCeil : this.customCap;
      if (cap < start) cap = start;
      const span = cap - start;
      const spanN = span > 1000000n ? 1000000 : Number(span);
      const climb = spanN > 12 ? spanN : 0;
      return { minTier: start, climb, topTier: cap, spikeMul, mulWalls };
    }
    if (k === "half") return { minTier: start, topTier: start + 10n, spikeMul, mulWalls };
    if (k === "halfinf") return { minTier: start, climb: 62, topTier: start + 62n, spikeMul, mulWalls };
    if (k === "2048") return { minTier: start, topTier: start + 10n, spikeMul };
    if (k === "inf") return { minTier: start, climb: 62, topTier: start + 62n, spikeMul };
    if (k === "super") return { minTier: start, climb: 127, topTier: start + 127n, spikeMul };
    return { endless: true, minTier: start, climb: 256, topTier: start + 1024n, spikeMul };
  }

  loadBest() {
    try {
      const eRaw = localStorage.getItem(`${this.bestKey()}-e`);
      if (eRaw != null && eRaw !== "") return parseVal(eRaw);
      const old = localStorage.getItem(this.bestKey());
      if (old == null || old === "" || old === "0") return null;
      return BigInt(magTier(BigInt(old)));
    } catch {
      return null;
    }
  }

  mount() {
    this.buildRenderer();
    this.buildScene();
    this.buildComposer();
    this.buildPlayer();
    this.buildStreaks();
    this.buildFxPool();
    this.loadLevel(0, false);
    this.setPlayLook();
    this.buildLevelGrid();
    this.bind();
    this.updateSandboxLabel();
    this.updateCustomLabel();
    this.syncSandboxMapButtons();
    this.applyModeChrome();
    this.refreshBest();
    this.applySettings();
    this.refreshWallet();
    this.idlePreview();
    document.fonts.ready.then(() => {
      this.texCache.clear();
      this.matCache.clear();
      this.applyPlayerLook();
    });
    this.loop();
  }

  buildRenderer() {
    this.renderer = new THREE.WebGLRenderer({
      canvas: this.canvas,
      antialias: false,
      alpha: false,
      powerPreference: "high-performance",
    });
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 1));
    this.renderer.setSize(innerWidth, innerHeight);
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.shadowMap.enabled = false;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 0.92;

    this.camera = new THREE.PerspectiveCamera(52, innerWidth / innerHeight, 0.1, 1600);
    this.camera.position.set(0, 7.2, -11);
  }

  buildScene() {
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x9fd8ff);
    this.scene.fog = new THREE.Fog(0x9fd8ff, 38, 120);

    this.hemi = new THREE.HemisphereLight(0xd8f4ff, 0xf3c9a0, 0.78);
    this.scene.add(this.hemi);
    this.ambient = new THREE.AmbientLight(0xffffff, 0.18);
    this.scene.add(this.ambient);

    const sun = new THREE.DirectionalLight(0xfff3dc, 1.12);
    sun.position.set(-18, 34, 8);
    sun.castShadow = false;
    sun.shadow.mapSize.set(512, 512);
    sun.shadow.camera.near = 2;
    sun.shadow.camera.far = 90;
    sun.shadow.camera.left = -22;
    sun.shadow.camera.right = 22;
    sun.shadow.camera.top = 22;
    sun.shadow.camera.bottom = -22;
    this.sun = sun;
    this.sun.target = new THREE.Object3D();
    this.scene.add(sun);
    this.scene.add(sun.target);

    this.rim = new THREE.DirectionalLight(0xff8ad8, 0.22);
    this.rim.position.set(16, 10, -8);
    this.scene.add(this.rim);

    this.skyMat = new THREE.ShaderMaterial({
      side: THREE.BackSide,
      depthWrite: false,
      uniforms: {
        topColor: { value: new THREE.Color(0x62c8ff) },
        botColor: { value: new THREE.Color(0xffe4b8) },
        offset: { value: 0.12 },
        exponent: { value: 0.72 },
      },
      vertexShader: `
        varying vec3 vWorld;
        void main() {
          vec4 w = modelMatrix * vec4(position, 1.0);
          vWorld = w.xyz;
          gl_Position = projectionMatrix * viewMatrix * w;
        }
      `,
      fragmentShader: `
        uniform vec3 topColor;
        uniform vec3 botColor;
        uniform float offset;
        uniform float exponent;
        varying vec3 vWorld;
        void main() {
          float h = normalize(vWorld + vec3(0.0, 40.0, 0.0)).y;
          h = clamp(pow(max(h + offset, 0.0), exponent), 0.0, 1.0);
          gl_FragColor = vec4(mix(botColor, topColor, h), 1.0);
        }
      `,
    });
    this.sky = new THREE.Mesh(new THREE.SphereGeometry(520, 12, 8), this.skyMat);
    this.scene.add(this.sky);

    this.ground = new THREE.Mesh(
      new THREE.PlaneGeometry(90, 520),
      new THREE.MeshLambertMaterial({ color: 0x7ec7a0 })
    );
    this.ground.rotation.x = -Math.PI / 2;
    this.ground.position.set(0, -18, 180);
    this.scene.add(this.ground);

    this.ocean = new THREE.Mesh(
      new THREE.PlaneGeometry(420, 900, 1, 1),
      new THREE.MeshStandardMaterial({
        color: 0x2aa8ea,
        roughness: 0.16,
        metalness: 0.12,
        emissive: 0x0c4a78,
        emissiveIntensity: 0.22,
      })
    );
    this.ocean.rotation.x = -Math.PI / 2;
    this.ocean.position.set(0, -3.2, 280);
    this.ocean.visible = false;
    this.scene.add(this.ocean);

    this.blob = new THREE.Mesh(
      new THREE.CircleGeometry(1, 20),
      new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.22 })
    );
    this.blob.rotation.x = -Math.PI / 2;
    this.blob.position.y = 0.03;
    this.scene.add(this.blob);

    this.worldGroup = new THREE.Group();
    this.scene.add(this.worldGroup);

    const starCount = 160;
    const starPos = new Float32Array(starCount * 3);
    for (let i = 0; i < starCount; i++) {
      starPos[i * 3] = (Math.random() - 0.5) * 220;
      starPos[i * 3 + 1] = 6 + Math.random() * 80;
      starPos[i * 3 + 2] = Math.random() * 520 - 40;
    }
    const starGeo = new THREE.BufferGeometry();
    starGeo.setAttribute("position", new THREE.BufferAttribute(starPos, 3));
    this.stars = new THREE.Points(
      starGeo,
      new THREE.PointsMaterial({ color: 0xfff6ff, size: 0.42, transparent: true, opacity: 0.85 })
    );
    this.stars.visible = false;
    this.scene.add(this.stars);
  }

  buildComposer() {
    this.composer = new EffectComposer(this.renderer);
    this.composer.addPass(new RenderPass(this.scene, this.camera));
    this.bloomPass = new UnrealBloomPass(new THREE.Vector2(innerWidth, innerHeight), 0.22, 0.4, 0.84);
    this.composer.addPass(this.bloomPass);
    this.composer.addPass(new OutputPass());
    this.composer.setPixelRatio(1);
  }

  buildStreaks() {
    const geo = new THREE.BoxGeometry(0.04, 0.04, 4.4);
    this.streaks = [];
    for (let i = 0; i < 12; i++) {
      const mat = new THREE.MeshBasicMaterial({
        color: 0xffffff,
        transparent: true,
        opacity: 0.12,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      });
      const mesh = new THREE.Mesh(geo, mat);
      mesh.visible = false;
      this.scene.add(mesh);
      this.streaks.push({ mesh, spd: 18 + Math.random() * 28 });
    }
  }

  buildFxPool() {
    this.sparks = [];
    for (let i = 0; i < 36; i++) {
      const mesh = new THREE.Mesh(
        SPARK_GEO,
        new THREE.MeshBasicMaterial({
          color: 0xffffff,
          transparent: true,
          blending: THREE.AdditiveBlending,
          depthWrite: false,
        })
      );
      mesh.visible = false;
      this.scene.add(mesh);
      this.sparks.push({ mesh, vx: 0, vy: 0, vz: 0, life: 0, spin: false });
    }
    this.confettis = [];
    for (let i = 0; i < 20; i++) {
      const mesh = new THREE.Mesh(CONFETTI_GEO, new THREE.MeshBasicMaterial({ color: 0xffe14a }));
      mesh.visible = false;
      this.scene.add(mesh);
      this.confettis.push({ mesh, vx: 0, vy: 0, vz: 0, life: 0, spin: true });
    }
    this.wavePool = [];
    for (let i = 0; i < 4; i++) {
      const mesh = new THREE.Mesh(
        WAVE_GEO,
        new THREE.MeshBasicMaterial({
          color: 0xffffff,
          transparent: true,
          opacity: 0,
          depthWrite: false,
          blending: THREE.AdditiveBlending,
        })
      );
      mesh.visible = false;
      this.scene.add(mesh);
      this.wavePool.push({ mesh, life: 0, max: 0.4, grow: 12 });
    }
  }

  disposeGroup(group) {
    if (!group) return;
    group.traverse((obj) => {
      if (obj.geometry) obj.geometry.dispose();
    });
    group.parent?.remove(group);
  }

  loadLevel(index, spawnPickups = true) {
    this.levelIndex = index;
    const opts = this.levelOpts();
    const kind = this.mapKind();
    const infTrack =
      kind === "inf" ||
      kind === "super" ||
      kind === "endless" ||
      kind === "halfinf" ||
      (kind === "custom" && (opts.climb || 0) > 12);
    this.level = getLevel(index, infTrack, kind === "super" || kind === "endless", opts);
    this.segments = this.level.segments;
    this.goalZ = this.level.goalZ;
    this.buildTrack();
    if (spawnPickups) this.spawnWorld();
    else this.clearWorld();
    this.updateLevelHud();
  }

  buildTrack() {
    this.disposeGroup(this.trackGroup);
    this.trackGroup = new THREE.Group();
    this.scene.add(this.trackGroup);

    const deckMats = [
      new THREE.MeshStandardMaterial({ color: 0xf0e2d0, roughness: 0.5, metalness: 0.02 }),
      new THREE.MeshStandardMaterial({ color: 0xe5d0b4, roughness: 0.5, metalness: 0.02 }),
    ];
    const neon = this.heavyFx()
      ? 0xb14bff
      : this.isHalfKind()
        ? 0x5ad8ff
        : this.mapKind() === "custom"
          ? 0xffc44a
          : this.infLook()
            ? 0xff5ad6
            : 0xff7a3a;
    const railMat = new THREE.MeshStandardMaterial({
      color: neon,
      roughness: 0.32,
      metalness: 0.22,
      emissive: neon,
      emissiveIntensity: this.heavyFx() ? 0.38 : 0.16,
    });
    const stripeMat = new THREE.MeshStandardMaterial({
      color: 0x3ee0ff,
      roughness: 0.28,
      metalness: 0.12,
      emissive: 0x3ee0ff,
      emissiveIntensity: this.heavyFx() ? 0.42 : 0.18,
    });

    const decks = [[], []];
    const rails = [];
    const stripes = [];

    for (const seg of this.segments) {
      const len = seg.z1 - seg.z0;
      const zMid = (seg.z0 + seg.z1) / 2;
      const deckIdx = decks[Math.abs(Math.floor(seg.z0)) % 2 === 0 ? 0 : 1];

      if (seg.hole) {
        const leftW = seg.width / 2 - seg.hole.w / 2;
        const left = new THREE.BoxGeometry(leftW, 0.38, len);
        left.translate(seg.cx - (seg.hole.w / 2 + leftW / 2), -0.19, zMid);
        const right = new THREE.BoxGeometry(leftW, 0.38, len);
        right.translate(seg.cx + (seg.hole.w / 2 + leftW / 2), -0.19, zMid);
        deckIdx.push(left, right);
      } else {
        const deck = new THREE.BoxGeometry(seg.width, 0.38, len);
        deck.translate(seg.cx, -0.19, zMid);
        deckIdx.push(deck);
        const stripe = new THREE.BoxGeometry(0.22, 0.02, len * 0.92);
        stripe.translate(seg.cx, 0.01, zMid);
        stripes.push(stripe);
      }

      const railL = new THREE.BoxGeometry(0.16, 0.42, len);
      railL.translate(seg.cx - seg.width / 2, 0.12, zMid);
      const railR = new THREE.BoxGeometry(0.16, 0.42, len);
      railR.translate(seg.cx + seg.width / 2, 0.12, zMid);
      rails.push(railL, railR);
    }

    decks.forEach((list, i) => {
      if (!list.length) return;
      const mesh = new THREE.Mesh(mergeGeometries(list, false), deckMats[i]);
      mesh.receiveShadow = true;
      this.trackGroup.add(mesh);
    });
    const railMesh = new THREE.Mesh(mergeGeometries(rails, false), railMat);
    railMesh.castShadow = true;
    railMesh.receiveShadow = true;
    this.trackGroup.add(railMesh);
    if (stripes.length) {
      this.trackGroup.add(new THREE.Mesh(mergeGeometries(stripes, false), stripeMat));
    }

    this.addArch(-2, "START", 0xedcf72);
    this.addArch(this.goalZ, "GOAL", 0xf65e3b);
    this.addDecor();
  }

  addArch(z, label, color) {
    const mat = new THREE.MeshStandardMaterial({
      color,
      roughness: 0.35,
      metalness: 0.15,
      emissive: color,
      emissiveIntensity: 0.16,
    });
    const post = new THREE.CylinderGeometry(0.18, 0.22, 3.2, 10);
    const left = new THREE.Mesh(post, mat);
    left.position.set(-3.4, 1.4, z);
    const right = left.clone();
    right.position.x = 3.4;
    const bar = new THREE.Mesh(new THREE.BoxGeometry(7.2, 0.35, 0.35), mat);
    bar.position.set(0, 3.05, z);
    for (const m of [left, right, bar]) {
      m.castShadow = true;
      this.trackGroup.add(m);
    }

    const canvas = document.createElement("canvas");
    canvas.width = 512;
    canvas.height = 128;
    const ctx = canvas.getContext("2d");
    ctx.fillStyle = "#2b1c10";
    ctx.font = "bold 84px Fredoka, Nunito, sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(label, 256, 70);
    const tex = new THREE.CanvasTexture(canvas);
    tex.colorSpace = THREE.SRGBColorSpace;
    const sign = new THREE.Mesh(
      new THREE.PlaneGeometry(3.4, 0.85),
      new THREE.MeshBasicMaterial({ map: tex, transparent: true })
    );
    sign.position.set(0, 3.55, z);
    this.trackGroup.add(sign);
  }

  addDecor() {
    const superMode = this.heavyFx();
    const colors = superMode
      ? [0xff4fd8, 0x7c5cff, 0x3ee0ff, 0xffe14a]
      : this.isHalfKind()
        ? [0x7ee8ff, 0x5ad8ff, 0xb8f0ff, 0x3aa8d8]
        : this.mapKind() === "custom"
          ? [0xffe14a, 0xffc44a, 0xff9a3b, 0xffd98a]
          : this.mapKind() === "inf"
            ? [0xff7ad9, 0xff9a3b, 0x7c5cff, 0x3ee0ff]
            : [0xf2b179, 0xf67c5f, 0xedcf72, 0x7ec7a0, 0x7c5cff];
    const step = this.goalZ > 800 ? 36 : 22;
    const count = Math.min(18, Math.floor(this.goalZ / step));
    const geos = [];
    for (let i = 0; i < count; i++) {
      const z = 12 + i * step;
      const side = i % 2 === 0 ? 1 : -1;
      const x = side * (6.5 + (i % 4) * 0.55);
      const g = (superMode ? OCTA_GEO : DECOR_CYL_GEO).clone();
      g.translate(x, superMode ? 0.7 : 0.2, z);
      geos.push(g);
    }
    if (geos.length) {
      const mesh = new THREE.Mesh(
        mergeGeometries(geos, false),
        new THREE.MeshStandardMaterial({
          color: colors[0],
          emissive: colors[0],
          emissiveIntensity: superMode ? 0.2 : 0.06,
          roughness: 0.4,
        })
      );
      this.trackGroup.add(mesh);
    }
    const cloudMat = new THREE.MeshLambertMaterial({
      color: superMode ? 0xc9a6ff : 0xffffff,
      transparent: true,
      opacity: superMode ? 0.2 : 0.45,
    });
    const cloudGeos = [];
    const cloudStep = this.goalZ > 800 ? 70 : 48;
    const clouds = Math.min(8, Math.floor(this.goalZ / cloudStep) + 3);
    for (let i = 0; i < clouds; i++) {
      const g = CLOUD_GEO.clone();
      g.translate((i % 2 === 0 ? -1 : 1) * (14 + (i % 5) * 2.2), 9 + (i % 4), 8 + i * cloudStep);
      cloudGeos.push(g);
    }
    if (cloudGeos.length) this.trackGroup.add(new THREE.Mesh(mergeGeometries(cloudGeos, false), cloudMat));
  }

  buildPlayer() {
    const start = this.startValue();
    this.player = {
      value: start,
      x: 0,
      y: radiusFor(start),
      z: 0,
      vx: 0,
      vy: 0,
      r: radiusFor(start),
      spin: 0,
    };
    this.player.mat = this.ballMaterial(start);
    this.player.mesh = new THREE.Mesh(SPHERE, this.player.mat);
    this.player.mesh.castShadow = true;
    this.player.mesh.scale.setScalar(this.player.r);
    this.scene.add(this.player.mesh);
    this.playerLight = new THREE.PointLight(0xffe4b5, 0.4, 14, 2);
    this.playerLight.position.set(0, 1.2, 0);
    this.scene.add(this.playerLight);

    this.aura = new THREE.Mesh(
      new THREE.TorusGeometry(1.22, 0.055, 6, 18),
      new THREE.MeshBasicMaterial({
        color: 0xffffff,
        transparent: true,
        opacity: 0.32,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      })
    );
    this.aura.rotation.x = Math.PI / 2;
    this.scene.add(this.aura);

    this.glowDisk = new THREE.Mesh(
      new THREE.CircleGeometry(1.4, 12),
      new THREE.MeshBasicMaterial({
        color: 0xffffff,
        transparent: true,
        opacity: 0.1,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      })
    );
    this.glowDisk.rotation.x = -Math.PI / 2;
    this.scene.add(this.glowDisk);

    this.ghosts = [];
    const ghostMat = new THREE.MeshBasicMaterial({
      color: 0xffffff,
      transparent: true,
      opacity: 0.18,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    for (let i = 0; i < 4; i++) {
      const g = new THREE.Mesh(SPHERE, ghostMat.clone());
      g.visible = false;
      this.scene.add(g);
      this.ghosts.push(g);
    }
    this.pickups = [];
    this.spikes = [];
    this.mulWalls = [];
  }

  ballTexture(value) {
    const rainbow = isRainbow(value, this.maxValue);
    const key = `${serializeVal(value)}-${rainbow ? "r" : "n"}`;
    if (this.texCache.has(key)) return this.texCache.get(key);
    const p = styleFor(value);
    const canvas = document.createElement("canvas");
    canvas.width = 256;
    canvas.height = 128;
    const ctx = canvas.getContext("2d");
    if (rainbow) {
      const g = ctx.createLinearGradient(0, 0, 0, 128);
      g.addColorStop(0, "#ff3b3b");
      g.addColorStop(0.18, "#ff9a3b");
      g.addColorStop(0.36, "#ffe14a");
      g.addColorStop(0.52, "#4dff6a");
      g.addColorStop(0.68, "#3ec6ff");
      g.addColorStop(0.84, "#7c5cff");
      g.addColorStop(1, "#ff4fd8");
      ctx.fillStyle = g;
    } else {
      ctx.fillStyle = hexCss(p.color);
    }
    ctx.fillRect(0, 0, 256, 128);
    const label = shortValue(value);
    const size = label.length > 6 ? 20 : label.length > 4 ? 26 : 32;
    ctx.font = `800 ${size}px Nunito, sans-serif`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.lineJoin = "round";
    const copies = 2;
    const drawNum = (x) => {
      ctx.lineWidth = 6;
      ctx.strokeStyle = "rgba(40, 24, 12, 0.32)";
      ctx.strokeText(label, x, y);
      ctx.fillStyle = rainbow ? "#ffffff" : p.text;
      ctx.fillText(label, x, y);
    };
    const y = 64;
    for (let i = 0; i < copies; i++) {
      const x = (((i / copies) + 0.75) % 1) * 256;
      drawNum(x);
      if (x < 28) drawNum(x + 256);
      if (x > 256 - 28) drawNum(x - 256);
    }
    const tex = new THREE.CanvasTexture(canvas);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = 1;
    this.texCache.set(key, tex);
    return tex;
  }

  ballMaterial(value) {
    const rainbow = isRainbow(value, this.maxValue);
    const key = `${serializeVal(value)}-${rainbow ? "r" : "n"}`;
    if (this.matCache.has(key) && !rainbow) return this.matCache.get(key).clone();
    const p = styleFor(value);
    const mat = new THREE.MeshStandardMaterial({
      map: this.ballTexture(value),
      color: 0xffffff,
      emissive: rainbow ? 0xffffff : p.emissive,
      emissiveIntensity: rainbow ? 0.16 : this.heavyFx() ? 0.14 : 0.06,
      roughness: 0.28,
      metalness: 0.08,
    });
    if (!rainbow) this.matCache.set(key, mat);
    return mat;
  }

  spawnWorld() {
    this.clearWorld();
    for (const [z, x, value] of this.level.balls) {
      this.spawnPickup(x, z, value);
    }
    for (const [z, x] of this.level.spikes) {
      this.spawnSpike(x, z);
    }
    for (const w of this.level.mulWalls || []) {
      this.spawnMulWall(w);
    }
    this.spawnPowerups();
  }

  spawnPickup(x, z, value) {
    const r = radiusFor(value);
    const mesh = new THREE.Mesh(SPHERE, this.ballMaterial(value));
    mesh.castShadow = false;
    mesh.scale.setScalar(r);
    mesh.position.set(x, r, z);
    this.worldGroup.add(mesh);
    this.pickups.push({
      value,
      x,
      z,
      y: r,
      r,
      vx: 0,
      vz: 0,
      vy: 0,
      alive: true,
      falling: false,
      touching: false,
      mesh,
    });
  }

  spawnSpike(x, z) {
    const group = new THREE.Group();
    const base = new THREE.Mesh(
      SPIKE_BASE_GEO,
      new THREE.MeshStandardMaterial({ color: 0x2a1510, roughness: 0.5 })
    );
    base.position.y = 0.06;
    group.add(base);
    const spikeMat = new THREE.MeshStandardMaterial({
      color: 0xff3a4a,
      roughness: 0.22,
      metalness: 0.35,
      emissive: 0x7a1020,
      emissiveIntensity: 0.18,
    });
    for (let i = 0; i < 3; i++) {
      const cone = new THREE.Mesh(SPIKE_CONE_GEO, spikeMat);
      const a = (i / 3) * Math.PI * 2;
      cone.position.set(Math.cos(a) * 0.16, 0.38, Math.sin(a) * 0.16);
      group.add(cone);
    }
    group.position.set(x, 0, z);
    this.worldGroup.add(group);
    this.spikes.push({ x, z, group, mat: spikeMat, near: false });
  }

  mulWallTexture() {
    if (this._mulTex) return this._mulTex;
    const canvas = document.createElement("canvas");
    canvas.width = 256;
    canvas.height = 128;
    const ctx = canvas.getContext("2d");
    ctx.clearRect(0, 0, 256, 128);
    ctx.fillStyle = "rgba(20, 12, 0, 0.2)";
    ctx.fillRect(0, 0, 256, 128);
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.font = "900 64px Nunito, sans-serif";
    ctx.lineWidth = 10;
    ctx.strokeStyle = "#3a2208";
    ctx.strokeText("×1.5", 128, 64);
    ctx.fillStyle = "#ffe14a";
    ctx.fillText("×1.5", 128, 64);
    const tex = new THREE.CanvasTexture(canvas);
    tex.colorSpace = THREE.SRGBColorSpace;
    this._mulTex = tex;
    return tex;
  }

  spawnMulWall(spec) {
    const z = spec.z;
    const x = spec.x;
    const w = spec.w;
    const group = new THREE.Group();
    const gold = new THREE.MeshStandardMaterial({
      color: 0xffc44a,
      emissive: 0xff9a1a,
      emissiveIntensity: 0.42,
      roughness: 0.28,
      metalness: 0.35,
      transparent: true,
      opacity: 0.78,
    });
    const slab = new THREE.Mesh(MUL_SLAB_GEO, gold);
    slab.scale.set(w, 1, 1);
    slab.position.y = 0.72;
    group.add(slab);
    const left = new THREE.Mesh(MUL_POST_GEO, gold);
    left.position.set(-w * 0.5, 0.85, 0);
    group.add(left);
    const right = new THREE.Mesh(MUL_POST_GEO, gold.clone());
    right.position.set(w * 0.5, 0.85, 0);
    group.add(right);
    const label = new THREE.Mesh(
      new THREE.PlaneGeometry(Math.min(3.6, w * 0.7), 0.85),
      new THREE.MeshBasicMaterial({ map: this.mulWallTexture(), transparent: true, depthWrite: false })
    );
    label.position.set(0, 1.55, 0.18);
    group.add(label);
    const labelB = label.clone();
    labelB.rotation.y = Math.PI;
    labelB.position.z = -0.18;
    group.add(labelB);
    group.position.set(x, 0, z);
    this.worldGroup.add(group);
    this.mulWalls.push({ x, z, w, group, used: false, mat: gold });
  }

  spawnPowerups() {
    this.powerups = [];
    const goal = this.goalZ;
    const add = (kind, color, zRaw, xOff, geo) => {
      const z = Math.min(goal - 16, zRaw);
      if (z < 20) return;
      const seg = this.trackAt(z);
      const x = seg.cx + xOff * seg.width * 0.28;
      const mesh = new THREE.Mesh(
        geo,
        new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.92 })
      );
      if (kind === "boost" || kind === "slow") mesh.rotation.y = Math.PI / 2;
      if (kind === "heart") mesh.scale.setScalar(1.2);
      mesh.position.set(x, 0.55, z);
      this.worldGroup.add(mesh);
      this.powerups.push({ kind, x, y: 0.55, z, r: kind === "star" ? 0.36 : 0.5, alive: true, mesh });
    };
    add("shield", 0x3ee0ff, 48, -1, SHIELD_GEO);
    add("magnet", 0xff4fd8, 72, 1, SHIELD_GEO);
    add("boost", 0xffe14a, 96, 0, BOOST_GEO);
    add("heart", 0xff4d6d, Math.max(108, goal * 0.34), -0.55, STAR_GEO);
    add("slow", 0x7dffd4, Math.max(132, goal * 0.52), 0.55, BOOST_GEO);
    add("shield", 0x3ee0ff, Math.max(120, goal * 0.45), -1, SHIELD_GEO);
    add("boost", 0xffe14a, Math.max(170, goal * 0.76), 0, BOOST_GEO);
    const luck = this.up("luck");
    if (luck >= 2) add("magnet", 0xff4fd8, Math.max(88, goal * 0.28), 0.8, SHIELD_GEO);
    if (luck >= 4) add("heart", 0xff4d6d, Math.max(160, goal * 0.68), -0.4, STAR_GEO);
    const starStep = Math.max(32, goal / (8 + luck));
    const starMax = Math.min(8, Math.max(4, Math.floor(goal / starStep)) + luck);
    for (let i = 0; i < starMax; i++) {
      add("star", 0xffe14a, 26 + i * starStep, i % 2 === 0 ? 0.72 : -0.72, STAR_GEO);
    }
  }

  clearWorld() {
    for (const p of this.pickups) {
      p.mesh.parent?.remove(p.mesh);
    }
    for (const s of this.spikes) s.group.parent?.remove(s.group);
    for (const w of this.mulWalls) w.group.parent?.remove(w.group);
    for (const u of this.powerups) u.mesh.parent?.remove(u.mesh);
    this.pickups = [];
    this.spikes = [];
    this.mulWalls = [];
    this.powerups = [];
  }

  buildLevelGrid() {
    this.els.grid.innerHTML = "";
    for (let i = 0; i < LEVEL_COUNT; i++) {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "lvl";
      const locked = i + 1 > this.unlocked;
      btn.classList.toggle("locked", locked);
      btn.classList.toggle("current", i === this.levelIndex);
      btn.disabled = locked;
      btn.innerHTML = `<span>${i + 1}</span><small>${locked ? "🔒" : levelName(i)}</small>`;
      btn.addEventListener("click", () => {
        if (i + 1 > this.unlocked) return;
        this.levelIndex = i;
        this.loadLevel(i, false);
        this.resetPlayerPose();
        this.buildLevelGrid();
        this.start();
      });
      this.els.grid.appendChild(btn);
    }
  }

  bind() {
    this.els.play.addEventListener("click", () => this.start());
    this.els.retry.addEventListener("click", () => this.start());
    this.els.next.addEventListener("click", () => {
      this.levelIndex = Math.min(LEVEL_COUNT - 1, this.levelIndex + 1);
      this.start();
    });
    this.els.toLevels.addEventListener("click", () => this.showTitle());
    this.els.upgradesBtn?.addEventListener("click", () => this.openMenu("upgrades", "title"));
    this.els.settingsBtn?.addEventListener("click", () => this.openMenu("settings", "title"));
    this.els.shopBack?.addEventListener("click", () => this.closeMenu());
    this.els.settingsBack?.addEventListener("click", () => this.closeMenu());
    this.els.settingsResume?.addEventListener("click", () => this.resume());
    this.els.endUpgrades?.addEventListener("click", () => {
      this.els.end.classList.add("hidden");
      this.openMenu("upgrades", "end");
    });
    this.els.pauseBtn?.addEventListener("click", (e) => {
      e.stopPropagation();
      if (this.state === "play") this.openMenu("settings", "play");
    });
    this.els.shopList?.addEventListener("click", (e) => {
      const btn = e.target.closest("[data-up]");
      if (btn?.dataset.up) this.buyUpgrade(btn.dataset.up);
    });
    const bindToggle = (el, key) => {
      el?.addEventListener("click", () => this.patchSetting(key, !this.settings[key]));
    };
    bindToggle(this.els.setSfx, "sfx");
    bindToggle(this.els.setShake, "shake");
    bindToggle(this.els.setInvert, "invert");
    bindToggle(this.els.setFlash, "flash");
    bindToggle(this.els.setScanlines, "scanlines");
    bindToggle(this.els.setVignette, "vignette");
    this.els.setVolume?.addEventListener("input", () => {
      this.patchSetting("volume", Number(this.els.setVolume.value) / 100);
    });
    this.els.qualLow?.addEventListener("click", () => this.patchSetting("quality", "low"));
    this.els.qualMed?.addEventListener("click", () => this.patchSetting("quality", "med"));
    this.els.qualHigh?.addEventListener("click", () => this.patchSetting("quality", "high"));
    this.els.mode2048.addEventListener("click", () => this.setMode("2048"));
    this.els.modeInf.addEventListener("click", () => this.setMode("inf"));
    this.els.modeSuper.addEventListener("click", () => this.setMode("super"));
    this.els.modeEndless?.addEventListener("click", () => this.setMode("endless"));
    this.els.modeCustom?.addEventListener("click", () => this.setMode("custom"));
    this.els.modeHalf?.addEventListener("click", () => this.setMode("half"));
    this.els.modeHalfInf?.addEventListener("click", () => this.setMode("halfinf"));
    this.els.modeSandbox?.addEventListener("click", () => this.setMode("sandbox"));
    this.els.smap2048?.addEventListener("click", () => this.setSandboxMap("2048"));
    this.els.smapInf?.addEventListener("click", () => this.setSandboxMap("inf"));
    this.els.smapSuper?.addEventListener("click", () => this.setSandboxMap("super"));
    this.els.smapEndless?.addEventListener("click", () => this.setSandboxMap("endless"));
    this.els.smapCustom?.addEventListener("click", () => this.setSandboxMap("custom"));
    this.els.smapHalf?.addEventListener("click", () => this.setSandboxMap("half"));
    this.els.smapHalfInf?.addEventListener("click", () => this.setSandboxMap("halfinf"));
    this.els.sandboxMinus?.addEventListener("click", () => this.setSandboxTier(this.sandboxTier - 1n));
    this.els.sandboxPlus?.addEventListener("click", () => this.setSandboxTier(this.sandboxTier + 1n));
    this.els.customMinus?.addEventListener("click", () => this.setCustomCap(this.customCap - 1n));
    this.els.customPlus?.addEventListener("click", () => this.setCustomCap(this.customCap + 1n));
    this.els.sandboxCeilMinus?.addEventListener("click", () => this.setSandboxCeil(this.sandboxCeil - 1n));
    this.els.sandboxCeilPlus?.addEventListener("click", () => this.setSandboxCeil(this.sandboxCeil + 1n));
    if (this.els.sandboxSize) {
      this.els.sandboxSize.value = String(this.sandboxTier);
      const commitSize = () => this.setSandboxTier(parseSandboxTier(this.els.sandboxSize.value));
      this.els.sandboxSize.addEventListener("input", () => {
        this.setSandboxTier(parseSandboxTier(this.els.sandboxSize.value), {
          reload: false,
          syncInput: false,
          preview: false,
        });
      });
      this.els.sandboxSize.addEventListener("change", commitSize);
      this.els.sandboxSize.addEventListener("blur", commitSize);
      this.els.sandboxSize.addEventListener("keydown", (e) => {
        if (e.code === "Enter") {
          e.preventDefault();
          commitSize();
        }
        e.stopPropagation();
      });
    }
    if (this.els.customSize) {
      this.els.customSize.value = String(this.customCap);
      const commitCap = () => this.setCustomCap(parseSandboxTier(this.els.customSize.value));
      this.els.customSize.addEventListener("input", () => {
        this.setCustomCap(parseSandboxTier(this.els.customSize.value), { reload: false, syncInput: false });
      });
      this.els.customSize.addEventListener("change", commitCap);
      this.els.customSize.addEventListener("blur", commitCap);
      this.els.customSize.addEventListener("keydown", (e) => {
        if (e.code === "Enter") {
          e.preventDefault();
          commitCap();
        }
        e.stopPropagation();
      });
    }
    if (this.els.sandboxCeilSize) {
      this.els.sandboxCeilSize.value = String(this.sandboxCeil);
      const commitCeil = () => this.setSandboxCeil(parseSandboxTier(this.els.sandboxCeilSize.value));
      this.els.sandboxCeilSize.addEventListener("input", () => {
        this.setSandboxCeil(parseSandboxTier(this.els.sandboxCeilSize.value), {
          reload: false,
          syncInput: false,
        });
      });
      this.els.sandboxCeilSize.addEventListener("change", commitCeil);
      this.els.sandboxCeilSize.addEventListener("blur", commitCeil);
      this.els.sandboxCeilSize.addEventListener("keydown", (e) => {
        if (e.code === "Enter") {
          e.preventDefault();
          commitCeil();
        }
        e.stopPropagation();
      });
    }

    addEventListener("resize", () => {
      this.camera.aspect = innerWidth / innerHeight;
      this.camera.updateProjectionMatrix();
      this.renderer.setSize(innerWidth, innerHeight);
      this.composer?.setSize(innerWidth, innerHeight);
      if (this.bloomPass) this.bloomPass.setSize(innerWidth, innerHeight);
    });

    const onDown = (e) => {
      if (this.state !== "play") return;
      this.pointerActive = true;
      this.pointerX = e.clientX ?? e.touches?.[0]?.clientX ?? innerWidth / 2;
    };
    const onMove = (e) => {
      if (!this.pointerActive) return;
      this.pointerX = e.clientX ?? e.touches?.[0]?.clientX ?? this.pointerX;
    };
    const onUp = () => {
      this.pointerActive = false;
    };
    this.canvas.addEventListener("pointerdown", onDown);
    addEventListener("pointermove", onMove);
    addEventListener("pointerup", onUp);
    addEventListener("pointercancel", onUp);
    this.canvas.addEventListener("touchstart", (e) => e.preventDefault(), { passive: false });

    addEventListener("keydown", (e) => {
      if (e.code === "Escape") {
        if (this.menu) this.closeMenu();
        else if (this.state === "play") this.openMenu("settings", "play");
        else if (this.state === "paused") this.resume();
        return;
      }
      if (this.menu) return;
      if (e.code === "ArrowLeft" || e.code === "KeyA") this.keys.left = true;
      if (e.code === "ArrowRight" || e.code === "KeyD") this.keys.right = true;
      if ((e.code === "Space" || e.code === "Enter") && this.state !== "play") {
        if (this.state === "paused") this.resume();
        else if (this.state === "end" && !this.els.next.classList.contains("hidden")) {
          this.els.next.click();
        } else if (this.state !== "winrun" && this.state !== "falling") {
          this.start();
        }
      }
    });
    addEventListener("keyup", (e) => {
      if (e.code === "ArrowLeft" || e.code === "KeyA") this.keys.left = false;
      if (e.code === "ArrowRight" || e.code === "KeyD") this.keys.right = false;
    });
  }

  refreshBest() {
    const label = this.best == null ? "0" : shortValue(this.best);
    this.els.bestTitle.textContent = `BEST ${label}`;
    this.els.bestHud.textContent = `BEST ${label}`;
  }

  updateSandboxLabel() {
    if (!this.els.sandboxLabel) return;
    const n = this.sandboxTier;
    this.els.sandboxLabel.textContent = `SIZE ${n} = ${expLabel(n)}`;
  }

  updateCustomLabel() {
    if (this.els.customLabel) {
      this.els.customLabel.textContent = `CEILING ${this.customCap} = ${expLabel(this.customCap)}`;
    }
    if (this.els.sandboxCeilLabel) {
      this.els.sandboxCeilLabel.textContent = `CEILING ${this.sandboxCeil} = ${expLabel(this.sandboxCeil)}`;
    }
  }

  syncSandboxMapButtons() {
    const kind = this.sandboxMap;
    this.els.smap2048?.classList.toggle("on", kind === "2048");
    this.els.smapInf?.classList.toggle("on", kind === "inf");
    this.els.smapSuper?.classList.toggle("on", kind === "super");
    this.els.smapEndless?.classList.toggle("on", kind === "endless");
    this.els.smapCustom?.classList.toggle("on", kind === "custom");
    this.els.smapHalf?.classList.toggle("on", kind === "half");
    this.els.smapHalfInf?.classList.toggle("on", kind === "halfinf");
    this.els.sandboxCeilWrap?.classList.toggle("hidden", kind !== "custom");
  }

  setSandboxTier(n, { reload = true, syncInput = true, preview = true } = {}) {
    this.sandboxTier = parseSandboxTier(n);
    localStorage.setItem(SANDBOX_KEY, String(this.sandboxTier));
    if (syncInput && this.els.sandboxSize) this.els.sandboxSize.value = String(this.sandboxTier);
    this.updateSandboxLabel();
    if (this.sandbox) {
      this.els.blurb.textContent = `Any map, your size. 1=2, 2=4, 3=8. Starting at ${expLabel(this.sandboxTier)} on ${this.sandboxMapLabel()}.`;
      if (preview && this.state === "title") {
        this.resetPlayerPose();
        if (reload) this.loadLevel(this.levelIndex, false);
      }
    }
  }

  setCustomCap(n, { reload = true, syncInput = true } = {}) {
    this.customCap = parseSandboxTier(n);
    localStorage.setItem(CUSTOM_KEY, String(this.customCap));
    if (syncInput && this.els.customSize) this.els.customSize.value = String(this.customCap);
    this.updateCustomLabel();
    this.syncCap();
    if (this.custom && this.state === "title") {
      this.applyModeChrome();
      this.resetPlayerPose();
      if (reload) this.loadLevel(this.levelIndex, false);
    }
  }

  setSandboxCeil(n, { reload = true, syncInput = true } = {}) {
    this.sandboxCeil = parseSandboxTier(n);
    localStorage.setItem(SANDBOX_CEIL_KEY, String(this.sandboxCeil));
    if (syncInput && this.els.sandboxCeilSize) this.els.sandboxCeilSize.value = String(this.sandboxCeil);
    this.updateCustomLabel();
    this.syncCap();
    if (this.sandbox && this.sandboxMap === "custom" && this.state === "title") {
      this.applyModeChrome();
      this.resetPlayerPose();
      if (reload) this.loadLevel(this.levelIndex, false);
    }
  }

  sandboxMapLabel() {
    const labels = {
      endless: "∞∞",
      super: "Super ∞",
      inf: "Infinity",
      custom: "Custom",
      half: "Half",
      halfinf: "Half ∞",
      2048: "2048",
    };
    return labels[this.sandboxMap] || "2048";
  }

  setSandboxMap(kind) {
    this.sandboxMap = SANDBOX_MAPS.includes(kind) ? kind : "inf";
    localStorage.setItem(SANDBOX_MAP_KEY, this.sandboxMap);
    this.syncSandboxMapButtons();
    if (!this.sandbox) return;
    this.syncCap();
    this.applyModeChrome();
    this.texCache.clear();
    this.matCache.clear();
    this.loadLevel(this.levelIndex, false);
    this.resetPlayerPose();
    this.updateLevelHud();
    this.setPlayLook();
  }

  applyModeChrome() {
    const mode = this.mode;
    const kind = this.mapKind();
    this.els.mode2048.classList.toggle("on", mode === "2048");
    this.els.modeInf.classList.toggle("on", mode === "inf");
    this.els.modeSuper.classList.toggle("on", mode === "super");
    this.els.modeEndless?.classList.toggle("on", mode === "endless");
    this.els.modeCustom?.classList.toggle("on", mode === "custom");
    this.els.modeHalf?.classList.toggle("on", mode === "half");
    this.els.modeHalfInf?.classList.toggle("on", mode === "halfinf");
    this.els.modeSandbox?.classList.toggle("on", mode === "sandbox");
    this.els.sandboxPanel?.classList.toggle("hidden", mode !== "sandbox");
    this.els.customPanel?.classList.toggle("hidden", mode !== "custom");
    this.syncSandboxMapButtons();
    document.body.classList.toggle("super-mode", kind === "super" || kind === "endless");
    document.body.classList.toggle("inf-mode", kind === "inf");
    document.body.classList.toggle("endless-mode", kind === "endless");
    document.body.classList.toggle("half-mode", kind === "half" || kind === "halfinf");
    document.body.classList.toggle("halfinf-mode", kind === "halfinf");
    document.body.classList.toggle("custom-mode", kind === "custom");
    this.updateSandboxLabel();
    this.updateCustomLabel();
    const kickers = {
      endless: "no ceiling  ·  keep going",
      sandbox: "any map  ·  any size",
      super: "2¹²⁸  ·  neon integer",
      inf: "no cap  ·  keep merging",
      custom: "your ceiling  ·  your run",
      half: "split to dust  ·  2⁻³¹",
      halfinf: "half forever  ·  ice ∞",
    };
    if (this.els.kicker) this.els.kicker.textContent = kickers[mode] || "merge · dodge · roll";
    const cap = this.modeMax();
    this.els.blurb.textContent =
      mode === "endless"
        ? "Merges never cap. Balls climb toward 2^1024 and past it. Infinity is the point."
        : mode === "sandbox"
          ? `Any map, your size. 1=2, 2=4, 3=8. Starting at ${expLabel(this.sandboxTier)} on ${this.sandboxMapLabel()}.`
          : mode === "super"
            ? `No ceiling but ${shortValue(cap)}. Climb to 2^${this.capTier()}.`
            : mode === "inf"
              ? `Same merge run, no 2048 cap. Climb all the way to ${shortValue(cap)}.`
              : mode === "custom"
                ? `Pick the rainbow. Ceiling is ${expLabel(this.customCap)}. Rainbows still merge.`
                : mode === "half"
                  ? "Classic 2048 plus gold ×1.5 walls: 2 becomes 3. Spikes still half you down to 2^-31."
                  : mode === "halfinf"
                    ? "Half rules, Infinity climb. Gold ×1.5 walls turn 2 into 3. Split to 2^-31, merge toward 2^63."
                    : `Steer into matching numbers to grow. Spikes cut you in half. Fall off the rail and you start over. Can you make ${shortValue(cap)}?`;
  }

  setMode(mode) {
    this.mode = mode;
    this.superMode = mode === "super";
    this.endless = mode === "endless";
    this.sandbox = mode === "sandbox";
    this.custom = mode === "custom";
    this.half = mode === "half";
    this.halfInf = mode === "halfinf";
    this.infinity = mode === "inf";
    this.syncCap();
    this.best = this.loadBest();
    this.refreshBest();
    this.applyModeChrome();
    this.texCache.clear();
    this.matCache.clear();
    this.loadLevel(this.levelIndex, false);
    this.resetPlayerPose();
    this.updateLevelHud();
    this.setPlayLook();
  }

  updateLevelHud() {
    const kind = this.mapKind();
    const tag = this.sandbox
      ? `SB ${this.sandboxMapLabel()} `
      : kind === "endless"
        ? "∞∞ "
        : kind === "super"
          ? "✦ "
          : kind === "halfinf"
            ? "½∞ "
            : kind === "half"
              ? "½ "
              : kind === "custom"
                ? "★ "
                : kind === "inf"
                  ? "∞ "
                  : "";
    this.els.levelHud.textContent = `${tag}${this.level.id}  ${this.level.name}`;
  }

  idlePreview() {
    this.camera.position.set(0, 8.5, -14);
    this.camera.lookAt(0, 1.2, 8);
  }

  showTitle() {
    this.state = "title";
    this.setPlayLook();
    this.disposeGroup(this.winGroup);
    this.winGroup = null;
    this.els.end.classList.add("hidden");
    this.els.hud.classList.add("hidden");
    this.els.title.classList.remove("hidden");
    this.els.fever?.classList.add("hidden");
    this.els.upgrades?.classList.add("hidden");
    this.els.settings?.classList.add("hidden");
    this.els.pauseBtn?.classList.add("hidden");
    this.menu = null;
    document.body.classList.remove("fever", "boosting", "cleared");
    this.refreshWallet();
    this.resetPlayerPose();
    this.idlePreview();
    this.buildLevelGrid();
    if (this.ghosts) for (const g of this.ghosts) g.visible = false;
    if (this.streaks) for (const s of this.streaks) s.mesh.visible = false;
  }

  resetPlayerPose() {
    const start = this.startValue();
    this.player.value = start;
    this.player.x = 0;
    this.player.z = 0;
    this.player.y = radiusFor(start);
    this.player.vy = 0;
    this.player.vx = 0;
    this.player.r = radiusFor(start);
    this.player.spin = 0;
    this.applyPlayerLook();
  }

  start() {
    this.sfx.start();
    this.setPlayLook();
    this.disposeGroup(this.winGroup);
    this.winGroup = null;
    this.winPads = [];
    this.winPadIndex = -1;
    this.squash = 1;
    this.failKind = "fall";
    this.syncCap();
    this.loadLevel(this.levelIndex, true);
    this.state = "play";
    this.invuln = 0.35;
    this.combo = 0;
    this.comboTimer = 0;
    this.slow = 0;
    this.merges = 0;
    this.shield = 0;
    this.magnet = 0;
    this.boost = 0;
    this.fever = 0;
    this.lives = this.up("life");
    this.shield = this.up("shield");
    this.gems = 0;
    this.runStars = 0;
    this.segHint = 0;
    this.showCombo();
    this.resetPlayerPose();
    this.resetStreaks();
    this.flash(0.2);
    this.toast(this.level.name);
    this.updateBadge();
    this.updateBuffHud();
    this.els.title.classList.add("hidden");
    this.els.end.classList.add("hidden");
    this.els.upgrades?.classList.add("hidden");
    this.els.settings?.classList.add("hidden");
    this.els.hud.classList.remove("hidden");
    this.els.pauseBtn?.classList.remove("hidden");
    this.menu = null;
    document.body.classList.remove("cleared");
    this.refreshWallet();
    this.clock.getDelta();
  }

  setPlayLook() {
    const superSky = this.heavyFx();
    const kind = this.mapKind();
    const inf = kind === "inf";
    const half = kind === "half" || kind === "halfinf";
    const custom = kind === "custom";
    this.ground.visible = true;
    this.ocean.visible = false;
    if (this.stars) this.stars.visible = superSky || inf || kind === "halfinf" || custom;
    const top = superSky ? 0x0e0318 : half ? 0x7ec8ff : custom ? 0xf6c84a : inf ? 0x2a0e48 : 0x4aa0d8;
    const bot = superSky ? 0x2a0c48 : half ? 0xe8f6ff : custom ? 0xfff3c4 : inf ? 0xc45a3a : 0xe8c898;
    const fog = superSky ? 0x14061f : half ? 0xb8e4ff : custom ? 0xf0d080 : inf ? 0xb86850 : 0x86c0e4;
    this.scene.background = new THREE.Color(fog);
    this.scene.fog = new THREE.Fog(fog, 32, superSky ? 150 : 110);
    if (this.skyMat) {
      this.skyMat.uniforms.topColor.value.setHex(top);
      this.skyMat.uniforms.botColor.value.setHex(bot);
    }
    this.renderer.toneMappingExposure = superSky ? 0.98 : inf ? 0.9 : 0.88;
    if (this.bloomPass) {
      this.bloomPass.strength = superSky ? 0.36 : inf ? 0.26 : half ? 0.22 : custom ? 0.24 : 0.18;
      this.bloomPass.threshold = 0.84;
    }
    if (this.rim) {
      this.rim.color.setHex(superSky ? 0xc46bff : half ? 0x8ee8ff : custom ? 0xffe08a : inf ? 0xff6ad6 : 0xffc48a);
      this.rim.intensity = superSky ? 0.32 : 0.16;
    }
    if (this.hemi) this.hemi.intensity = superSky ? 0.55 : 0.78;
    if (this.sun) this.sun.intensity = superSky ? 0.85 : 1.08;
    this.ground.material.color.setHex(
      superSky ? 0x2a1840 : half ? 0x8fd4c4 : custom ? 0xc4b070 : inf ? 0x4a9a72 : 0x6eb090
    );
  }

  setWinLook() {
    this.ground.visible = false;
    this.ocean.visible = true;
    if (this.stars) this.stars.visible = true;
    const dark = this.heavyFx();
    const top = dark ? 0x061028 : 0x1560c8;
    const bot = dark ? 0x2a0a40 : 0x5ec8e8;
    const fog = dark ? 0x0b1a3a : 0x3aa8d8;
    this.scene.background = new THREE.Color(fog);
    this.scene.fog = new THREE.Fog(fog, 40, 240);
    if (this.skyMat) {
      this.skyMat.uniforms.topColor.value.setHex(top);
      this.skyMat.uniforms.botColor.value.setHex(bot);
    }
    this.renderer.toneMappingExposure = dark ? 1.0 : 0.92;
    if (this.bloomPass) {
      this.bloomPass.strength = dark ? 0.4 : 0.24;
      this.bloomPass.threshold = 0.82;
    }
  }

  applyPlayerLook() {
    const r = radiusFor(this.player.value);
    this.player.r = r;
    this.player.mesh.material = this.ballMaterial(this.player.value);
    this.player.mat = this.player.mesh.material;
    this.player.mesh.scale.setScalar(r);
    if (this.state === "play") this.player.y = r;
  }

  updateBadge() {
    const p = styleFor(this.player.value);
    const rainbow = isRainbow(this.player.value, this.maxValue);
    const label = shortValue(this.player.value);
    this.els.badge.textContent = label;
    this.els.badge.style.background = rainbow
      ? "linear-gradient(135deg, #ff4fd8, #7c5cff, #3ee0ff, #ffe14a)"
      : hexCss(p.color);
    this.els.badge.style.color = rainbow ? "#ffffff" : p.text;
    this.els.badge.style.fontSize = label.length > 4 ? "22px" : "34px";
    this.els.badge.classList.toggle("rainbow", rainbow);
    this.els.badge.classList.remove("pop");
    void this.els.badge.offsetWidth;
    this.els.badge.classList.add("pop");
  }

  toast(text) {
    this.els.toast.textContent = text;
    this.els.toast.classList.remove("show");
    void this.els.toast.offsetWidth;
    this.els.toast.classList.add("show");
  }

  flash(amount = 0.18, color = "#ffffff") {
    if (!this.settings.flash || !this.els.flash) return;
    this.els.flash.style.background = color;
    this.els.flash.style.setProperty("--flash", String(amount));
    this.els.flash.classList.remove("pop");
    void this.els.flash.offsetWidth;
    this.els.flash.classList.add("pop");
  }

  showCombo() {
    if (!this.els.combo) return;
    if (this.combo < 2) {
      this.els.combo.classList.add("hidden");
      return;
    }
    this.els.combo.classList.remove("hidden");
    this.els.combo.textContent = `x${this.combo}`;
    this.els.combo.style.color = this.combo >= 8 ? "#ffe14a" : this.combo >= 5 ? "#ff4fd8" : "#ffffff";
    this.els.combo.classList.toggle("hot", this.combo >= 8);
    this.els.combo.classList.remove("pop");
    void this.els.combo.offsetWidth;
    this.els.combo.classList.add("pop");
  }

  updateBuffHud() {
    const bits = [];
    if (this.shield) bits.push("SHIELD");
    if (this.magnet > 0) bits.push("MAGNET");
    if (this.boost > 0) bits.push("BOOST");
    if (this.lives > 0) bits.push(`♥${this.lives}`);
    if (this.gems) bits.push(`★${this.gems}`);
    if (this.slow > 0.25) bits.push("SLOW");
    const buffs = bits.join("  ");
    const merges = `${this.merges} MERGES`;
    if (this.els.statMerges && this._hudMerges !== merges) {
      this._hudMerges = merges;
      this.els.statMerges.textContent = merges;
    }
    if (this.els.statBuffs && this._hudBuffs !== buffs) {
      this._hudBuffs = buffs;
      this.els.statBuffs.textContent = buffs;
    }
    this.els.fever?.classList.toggle("hidden", this.fever <= 0 || this.state !== "play");
    document.body.classList.toggle("fever", this.fever > 0 && this.state === "play");
    document.body.classList.toggle("boosting", this.boost > 0 && this.state === "play");
  }

  spinPowerups(dt) {
    const t = this.clock.elapsedTime;
    for (const u of this.powerups) {
      if (!u.alive || !u.mesh.visible) continue;
      u.mesh.rotation.y += dt * (u.kind === "star" ? 4.2 : 2.4);
      u.mesh.position.y = u.y + Math.sin(t * 4 + u.z) * 0.12;
    }
  }

  shockwave(x, y, z, color) {
    const grab = () => this.wavePool.find((w) => w.life <= 0);
    const a = grab();
    if (!a) return;
    a.life = 0.42;
    a.max = 0.42;
    a.grow = 12;
    a.mesh.visible = true;
    a.mesh.position.set(x, y + 0.05, z);
    a.mesh.rotation.x = Math.PI / 2;
    a.mesh.scale.setScalar(1);
    a.mesh.material.color.setHex(color);
    a.mesh.material.opacity = 0.9;
    const b = grab();
    if (!b) return;
    b.life = 0.28;
    b.max = 0.28;
    b.grow = 7;
    b.mesh.visible = true;
    b.mesh.position.set(x, y + 0.05, z);
    b.mesh.rotation.set(0, 0, 0);
    b.mesh.scale.setScalar(0.6);
    b.mesh.material.color.setHex(color);
    b.mesh.material.opacity = 0.7;
  }

  resetStreaks() {
    const p = this.player;
    if (!this.streaks?.length) return;
    for (const s of this.streaks) {
      s.mesh.position.set(
        p.x + (Math.random() - 0.5) * 11,
        0.4 + Math.random() * 5,
        p.z + 2 + Math.random() * 22
      );
      s.spd = 28 + Math.random() * 42;
    }
  }

  trackAt(z) {
    const segs = this.segments;
    if (!segs?.length) return { cx: 0, width: 8, z0: 0, z1: 1 };
    let i = this.segHint || 0;
    if (i >= segs.length) i = segs.length - 1;
    if (z >= segs[i].z0 && z < segs[i].z1) return segs[i];
    if (i + 1 < segs.length && z >= segs[i + 1].z0 && z < segs[i + 1].z1) {
      this.segHint = i + 1;
      return segs[i + 1];
    }
    let lo = 0;
    let hi = segs.length - 1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      const s = segs[mid];
      if (z < s.z0) hi = mid - 1;
      else if (z >= s.z1) lo = mid + 1;
      else {
        this.segHint = mid;
        return s;
      }
    }
    this.segHint = Math.max(0, Math.min(segs.length - 1, lo));
    return segs[this.segHint];
  }

  onFloor(x, z, r) {
    const seg = this.trackAt(z);
    const rail = 0.08;
    const left = seg.cx - seg.width / 2 - rail;
    const right = seg.cx + seg.width / 2 + rail;
    if (x + r < left || x - r > right) return false;
    if (!seg.hole) return true;
    const hL = seg.cx + seg.hole.x - seg.hole.w / 2;
    const hR = seg.cx + seg.hole.x + seg.hole.w / 2;
    const overlapsLeft = x + r > left && x - r < hL;
    const overlapsRight = x + r > hR && x - r < right;
    const bridges = x - r <= hL && x + r >= hR;
    return overlapsLeft || overlapsRight || bridges;
  }

  keepOnDeck(obj, force = false) {
    const seg = this.trackAt(obj.z);
    const left = seg.cx - seg.width / 2;
    const right = seg.cx + seg.width / 2;
    if (force || (obj.x + obj.r > left && obj.x - obj.r < right)) {
      obj.x = Math.max(left, Math.min(right, obj.x));
    }
  }

  loop = () => {
    requestAnimationFrame(this.loop);
    const raw = Math.min(this.clock.getDelta(), 0.033);
    this.frameAvg = this.frameAvg * 0.9 + raw * 0.1;
    const quality = this.settings.quality;
    this.useBloom = quality === "high" && this.frameAvg < 0.024;
    this.slow = Math.max(0, (this.slow || 0) - raw);
    const dt = raw * (this.slow > 0 ? 0.38 : 1);
    if (this.state === "paused") {
      this.draw();
      return;
    }
    if (this.state === "play" || this.state === "falling" || this.state === "winrun") this.update(dt);
    else this.updateIdle(dt);
    this.draw();
  };

  updateIdle(dt) {
    const t = this.clock.elapsedTime;
    this.player.spin += dt * 1.35;
    this.player.mesh.rotation.x = this.player.spin;
    this.player.y = this.player.r + Math.abs(Math.sin(t * 2.2)) * 0.28;
    this.player.mesh.position.set(0, this.player.y, 0);
    this.camera.position.x = Math.sin(t * 0.32) * 2.1;
    this.camera.position.y = 7.4 + Math.sin(t * 0.18) * 0.55;
    this.camera.position.z = -13.2;
    this.camera.lookAt(0, 1.15, 6.5);
  }

  update(dt) {
    const p = this.player;
    this.invuln = Math.max(0, this.invuln - dt);
    const t = Math.max(0, tierOf(p.value));
    const kind = this.mapKind();
    const capSpd = kind === "super" || kind === "endless" ? 32 : kind === "inf" || kind === "halfinf" ? 28 : 22;
    const tierMul = kind === "super" || kind === "endless" ? 0.38 : kind === "inf" || kind === "halfinf" ? 0.48 : 0.2;
    const speed = Math.min(capSpd, (11.6 + Math.min(p.z, 260) * 0.014 + t * tierMul) * this.level.speed) * (this.boost > 0 ? 1.55 + this.up("boost") * 0.08 : 1) * (this.fever > 0 ? 1.12 : 1);
    this.runSpeed = speed;

    if (this.state === "play") {
      let steer = 0;
      if (this.settings.invert) {
        if (this.keys.left) steer -= 1;
        if (this.keys.right) steer += 1;
      } else {
        if (this.keys.left) steer += 1;
        if (this.keys.right) steer -= 1;
      }
      const xSpeed = steer * 11.5 * (1 + this.up("steer") * 0.1);
      let pointerTarget = null;
      if (this.pointerActive) {
        const nx = ((this.pointerX / innerWidth) * 2 - 1) * (this.settings.invert ? 1 : -1);
        const seg = this.trackAt(p.z);
        const half = Math.max(0.2, seg.width * 0.5 - p.r);
        pointerTarget = seg.cx + nx * half;
      }

      const moveZ = speed * dt;
      const stepLen = Math.max(0.06, p.r * 0.35);
      const steps = Math.max(1, Math.min(4, Math.ceil(moveZ / stepLen)));
      const dtStep = dt / steps;
      for (let i = 0; i < steps; i++) {
        p.z += speed * dtStep;
        p.x += xSpeed * dtStep;
        if (pointerTarget != null) {
          p.x += (pointerTarget - p.x) * Math.min(1, 13 * dtStep);
        }
        p.y = p.r;
        const xBeforeHit = p.x;
        this.collidePickups(speed);
        this.collideSpikes();
        this.collideMulWalls();
        if (this.onFloor(xBeforeHit, p.z, p.r) && !this.onFloor(p.x, p.z, p.r)) {
          this.keepOnDeck(p, true);
        }
        if (!this.onFloor(p.x, p.z, p.r)) {
          this.beginFall();
          break;
        }
        if (p.z >= this.goalZ) {
          this.beginWinRun();
          break;
        }
      }
      p.spin += moveZ / Math.max(0.2, p.r);
      p.mesh.rotation.x = p.spin;
      p.mesh.rotation.z = -steer * 0.25;
      this.squash += (1 - this.squash) * Math.min(1, 10 * dt);
      this.collidePowerups();
      this.spinPowerups(dt);
      this.pickupPhysics(dt);
      this.cullWorld();
      this.updateTrail(dt);
    } else if (this.state === "winrun") {
      this.updateWinRun(dt);
    } else if (this.state === "falling") {
      p.vy -= 32 * dt;
      p.y += p.vy * dt;
      p.x += p.vx * dt;
      p.z += speed * 0.35 * dt;
      p.spin += dt * 6;
      p.mesh.rotation.x = p.spin;
      p.mesh.rotation.z += dt * 4;
      this.pickupPhysics(dt);
      this.cullWorld();
      if (p.y < -14) this.finish(this.failKind || "fall");
    }

    this.updateParticles(dt);
    this.updateWaves(dt);
    this.updateStreaks(dt);
    this.comboTimer = Math.max(0, this.comboTimer - dt);
    this.boost = Math.max(0, this.boost - dt);
    this.magnet = Math.max(0, this.magnet - dt);
    this.fever = Math.max(0, this.fever - dt);
    if (this.comboTimer <= 0 && this.combo) {
      this.combo = 0;
      this.showCombo();
    }
    this.updateBuffHud();
    this.shake = Math.max(0, this.shake - dt * 2.8);
    this.fovPunch = Math.max(0, this.fovPunch - dt * 18);
    const speedFov = this.state === "play" ? Math.min(9, Math.max(0, this.runSpeed - 12) * 0.32) : 0;
    const fov = 52 + this.fovPunch + speedFov;
    if (Math.abs(this.camera.fov - fov) > 0.04) {
      this.camera.fov = fov;
      this.camera.updateProjectionMatrix();
    }
    if (this.ocean.visible) {
      this.ocean.material.emissiveIntensity = 0.08 + Math.sin(this.clock.elapsedTime * 1.4) * 0.04;
    }
    const pulse = 0.16 + Math.sin(this.clock.elapsedTime * 10) * 0.08;
    if (this.settings.quality === "high") {
      for (const s of this.spikes) {
        if (s.mat && Math.abs(s.z - p.z) < 36) s.mat.emissiveIntensity = pulse;
      }
      for (const w of this.mulWalls) {
        if (!w.used && w.mat && Math.abs(w.z - p.z) < 36) {
          w.mat.emissiveIntensity = 0.32 + Math.sin(this.clock.elapsedTime * 6) * 0.18;
        }
      }
    }
    if (isRainbow(p.value, this.maxValue) && p.mat) {
      const h = (this.clock.elapsedTime * 0.55) % 1;
      p.mat.emissive.setHSL(h, 0.85, 0.28);
      p.mat.emissiveIntensity = this.superMode ? 0.32 : 0.18;
    }
  }

  beginFall(kind = "fall") {
    if (this.state !== "play") return;
    if (this.lives > 0) {
      const seg = this.trackAt(this.player.z);
      const candidates = [seg.cx, seg.cx - seg.width * 0.3, seg.cx + seg.width * 0.3];
      let savedX = null;
      for (const x of candidates) {
        if (this.onFloor(x, this.player.z, this.player.r)) {
          savedX = x;
          break;
        }
      }
      if (savedX != null) {
        this.lives -= 1;
        this.invuln = 1.2;
        this.player.x = savedX;
        this.player.y = this.player.r;
        this.player.vx = 0;
        this.player.vy = 0;
        this.toast(this.lives ? "SAVED" : "LAST CHANCE");
        this.flash(0.22, "#ff4d6d");
        this.shake = 0.32;
        this.sfx.sparkle(6);
        this.updateBuffHud();
        return;
      }
    }
    this.state = "falling";
    this.failKind = kind;
    this.combo = 0;
    this.showCombo();
    this.player.vy = 1.2;
    this.player.vx = this.player.x >= this.trackAt(this.player.z).cx ? 2.2 : -2.2;
    if (kind === "spike") this.sfx.cut();
    else this.sfx.fall();
  }

  collidePickups(speed) {
    const p = this.player;
    for (const b of this.pickups) {
      if (!b.alive || b.falling) continue;
      if (Math.abs(b.z - p.z) > 14 || Math.abs(b.x - p.x) > 12) {
        b.touching = false;
        if ((this.magnet > 0 || this.fever > 0) && valEq(b.value, p.value) && Math.abs(b.z - p.z) < 22 + this.up("magnet") * 7) {
          const pull = 0.08 + this.up("magnet") * 0.025;
          b.x += (p.x - b.x) * pull;
          b.z += (p.z + p.r + b.r - b.z) * 0.05;
        }
        continue;
      }
      const hit = sphereOverlap(p.x, p.y, p.z, p.r, b.x, b.y, b.z, b.r);
      if (!hit) {
        b.touching = false;
        continue;
      }

      if (valEq(b.value, p.value) && this.canGrow(p.value)) {
        this.mergePlayer(b);
        continue;
      }

      if (!b.touching) {
        this.sfx.bump();
        b.touching = true;
      }
      p.x -= hit.nx * hit.overlap;
      b.x += hit.nx * hit.overlap;
      b.z += hit.nz * hit.overlap;
      b.vx += hit.nx * 14;
      b.vz += hit.nz * 10 + Math.max(0, speed) * 0.2;

      const again = sphereOverlap(p.x, p.y, p.z, p.r, b.x, b.y, b.z, b.r);
      if (again) {
        p.x -= again.nx * again.overlap;
        b.z += Math.max(0, again.nz) * again.overlap;
      }
    }
  }

  mergePlayer(ball) {
    ball.alive = false;
    ball.mesh.visible = false;
    const next = doubleVal(this.player.value, this.maxValue);
    this.burst(this.player.x, this.player.y, this.player.z, this.player.value);
    this.shockwave(this.player.x, this.player.y, this.player.z, styleFor(next).color);
    this.player.value = next;
    this.squash = this.superMode ? 1.72 : 1.52;
    this.shake = this.settings.shake ? Math.min(1.35, 0.36 + Math.max(0, tierOf(next)) * 0.012) : 0;
    this.fovPunch = this.superMode ? 13 : 8;
    this.combo += 1;
    this.comboTimer = 1.7 + this.up("combo") * 0.28;
    this.merges += 1;
    this.runStars += 1 + (this.combo >= 5 ? 1 : 0);
    if (this.combo >= 3) this.slow = 0.11;
    const feverAt = Math.max(4, 6 - Math.floor(this.up("combo") / 2));
    if (this.combo === feverAt) {
      this.fever = 2.4;
      this.toast("FEVER");
      this.sfx.sparkle(8);
    }
    this.flash(this.combo >= 5 ? 0.34 : 0.14);
    this.showCombo();
    this.applyPlayerLook();
    this.updateBadge();
    this.sfx.merge(next);
    if (this.combo >= 5) this.sfx.sparkle(this.combo);
    this.toast(this.combo >= 8 ? `x${this.combo}  ${shortValue(next)}` : shortValue(next));
    if (navigator.vibrate) navigator.vibrate(18);
    if (this.combo >= 8) this.confetti(this.player.x, this.player.y, this.player.z);
    if (isRainbow(next, this.maxValue)) {
      this.toast("RAINBOW!");
      this.confetti(this.player.x, this.player.y, this.player.z);
      this.fovPunch = Math.max(this.fovPunch, 10);
    }
  }

  collideSpikes() {
    if (this.invuln > 0) return;
    const p = this.player;
    for (const s of this.spikes) {
      if (Math.abs(s.z - p.z) > 8) continue;
      if (sphereVsCylinder(p.x, p.y, p.z, p.r, s.x, s.z, SPIKE_RADIUS, 0, SPIKE_TOP)) {
        this.hitSpike();
        break;
      }
      const dist = Math.hypot(p.x - s.x, p.z - s.z);
      if (!s.near && dist < p.r + SPIKE_RADIUS + 0.28 && dist > p.r + SPIKE_RADIUS - 0.02) {
        s.near = true;
        this.toast("CLOSE!");
        this.sfx.sparkle(3);
      }
    }
  }

  collideMulWalls() {
    const p = this.player;
    for (const w of this.mulWalls) {
      if (w.used) continue;
      if (Math.abs(w.z - p.z) > 2.4) continue;
      const half = w.w * 0.5;
      if (Math.abs(p.x - w.x) > half + p.r * 0.15) continue;
      if (Math.abs(w.z - p.z) > 0.42 + p.r) continue;
      this.hitMulWall(w);
      break;
    }
  }

  hitMulWall(w) {
    w.used = true;
    const next = mul15(this.player.value);
    this.player.value = next;
    this.squash = 1.38;
    this.applyPlayerLook();
    this.updateBadge();
    this.toast(`×1.5  ${shortValue(next)}`);
    this.sfx.sparkle(7);
    this.burst(this.player.x, this.player.y, this.player.z, next);
    this.shockwave(this.player.x, this.player.y, this.player.z, 0xffe14a);
    this.flash(0.16, "#ffe14a");
    this.fovPunch = 6;
    if (w.group) {
      w.group.visible = false;
    }
  }

  collidePowerups() {
    const p = this.player;
    for (const u of this.powerups) {
      if (!u.alive) continue;
      if (Math.abs(u.z - p.z) > 8) continue;
      if (!sphereHit(p.x, p.y, p.z, p.r, u.x, u.y, u.z, u.r)) continue;
      u.alive = false;
      u.mesh.visible = false;
      if (u.kind === "shield") {
        this.shield = 1;
        this.toast("SHIELD");
        this.flash(0.16, "#3ee0ff");
      } else if (u.kind === "magnet") {
        this.magnet = 4.2 + this.up("magnet") * 0.9;
        this.toast("MAGNET");
        this.flash(0.14, "#ff4fd8");
      } else if (u.kind === "boost") {
        this.boost = 1.35 + this.up("boost") * 0.28;
        this.toast("BOOST");
        this.flash(0.14, "#ffe14a");
        this.fovPunch = 8;
      } else if (u.kind === "heart") {
        this.lives = Math.min(2 + this.up("life"), this.lives + 1);
        this.toast("EXTRA LIFE");
        this.flash(0.18, "#ff4d6d");
      } else if (u.kind === "slow") {
        this.slow = 1.2;
        this.toast("SLOW-MO");
        this.flash(0.14, "#7dffd4");
      } else {
        this.gems += 1;
        this.runStars += 1;
        this.comboTimer = Math.min(2.6, this.comboTimer + 0.55);
        if (this.gems % 5 === 0) {
          this.fever = Math.max(this.fever, 1.8);
          this.toast("STAR RUSH");
          this.sfx.sparkle(8);
        }
      }
      this.sfx.sparkle(6);
      this.burst(u.x, u.y, u.z, p.value);
    }
  }

  hitSpike() {
    if (this.shield > 0) {
      this.shield = 0;
      this.invuln = 0.85;
      this.toast("BLOCKED");
      this.flash(0.2, "#3ee0ff");
      this.shake = 0.3;
      this.sfx.bump();
      return;
    }
    this.invuln = 0.7;
    const prev = this.player.value;
    const floor = this.floorExp();
    if (magCmp(prev, floor) <= 0) {
      if (this.lives > 0) {
        this.lives -= 1;
        this.invuln = 1.1;
        this.toast(this.lives ? "SAVED" : "LAST CHANCE");
        this.flash(0.2, "#ff4d6d");
        this.shake = 0.28;
        this.sfx.sparkle(6);
        this.updateBuffHud();
        return;
      }
      this.burst(this.player.x, this.player.y, this.player.z, prev);
      this.shockwave(this.player.x, this.player.y, this.player.z, 0xff3355);
      this.shake = 0.7;
      this.fovPunch = 6;
      this.flash(0.28, "#ff3355");
      if (navigator.vibrate) navigator.vibrate([18, 40, 18]);
      this.beginFall("spike");
      return;
    }
    const next = halfVal(prev, floor);
    if (prev && magCmp(prev, floor) > 0) {
      const side = this.player.x >= 0 ? -1 : 1;
      this.spawnPickup(
        this.player.x + side * (this.player.r + radiusFor(next) + 0.12),
        this.player.z + 0.35,
        next
      );
      const spawned = this.pickups[this.pickups.length - 1];
      spawned.vx = side * 6;
      spawned.vz = 3;
    }
    this.player.value = next;
    this.squash = 0.78;
    this.applyPlayerLook();
    this.updateBadge();
    this.sfx.cut();
    this.toast(`↓ ${shortValue(next)}`);
    this.combo = 0;
    this.comboTimer = 0;
    this.showCombo();
    this.burst(this.player.x, this.player.y, this.player.z, next);
    this.shockwave(this.player.x, this.player.y, this.player.z, 0xff3355);
    this.shake = 0.55;
    this.fovPunch = 4;
    this.flash(0.22, "#ff3355");
    if (navigator.vibrate) navigator.vibrate([12, 30, 12]);
  }

  cullWorld() {
    const z = this.player.z;
    for (const b of this.pickups) {
      if (!b.alive) continue;
      b.mesh.visible = Math.abs(b.z - z) < 110;
    }
    for (const s of this.spikes) {
      s.group.visible = Math.abs(s.z - z) < 90;
    }
    for (const w of this.mulWalls) {
      if (!w.used) w.group.visible = Math.abs(w.z - z) < 90;
    }
    for (const u of this.powerups) {
      if (u.alive) u.mesh.visible = Math.abs(u.z - z) < 90;
    }
  }

  pickupPhysics(dt) {
    const pz = this.player.z;
    const list = this.nearPickups;
    list.length = 0;
    for (const b of this.pickups) {
      if (b.alive && (Math.abs(b.z - pz) < 48 || b.vx || b.vz || b.falling)) list.push(b);
    }
    for (const b of list) {
      b.vx *= 0.9;
      b.vz *= 0.9;
      b.x += b.vx * dt;
      b.z += b.vz * dt;
      if (!b.falling) this.keepOnDeck(b);
      if (!b.falling && !this.onFloor(b.x, b.z, b.r)) {
        b.falling = true;
        b.vy = 0.4;
      }
      if (b.falling) {
        b.vy -= 28 * dt;
        b.y += b.vy * dt;
        if (b.y < -10) {
          b.alive = false;
          b.mesh.visible = false;
        }
      } else {
        b.y = b.r;
      }
      b.mesh.position.set(b.x, b.y, b.z);
      b.mesh.rotation.x += (Math.abs(b.vz) + 3) * dt * 0.35;
    }

    for (let i = 0; i < list.length; i++) {
      for (let j = i + 1; j < list.length; j++) {
        const a = list[i];
        const b = list[j];
        if (!a.alive || !b.alive || a.falling || b.falling) continue;
        if (!sphereHit(a.x, a.y, a.z, a.r, b.x, b.y, b.z, b.r)) continue;
        if (valEq(a.value, b.value) && this.canGrow(a.value)) {
          const nx = (a.x + b.x) / 2;
          const nz = (a.z + b.z) / 2;
          b.alive = false;
          b.mesh.visible = false;
          a.value = doubleVal(a.value, this.maxValue);
          a.r = radiusFor(a.value);
          a.y = a.r;
          a.mesh.material = this.ballMaterial(a.value);
          a.mesh.scale.setScalar(a.r);
          a.x = nx;
          a.z = nz;
          this.burst(nx, a.r, nz, a.value);
          this.shockwave(nx, a.r, nz, styleFor(a.value).color);
          this.sfx.merge(a.value);
        } else {
          const hit = sphereOverlap(a.x, a.y, a.z, a.r, b.x, b.y, b.z, b.r);
          if (!hit) continue;
          a.x -= hit.nx * hit.overlap * 0.5;
          a.z -= hit.nz * hit.overlap * 0.5;
          b.x += hit.nx * hit.overlap * 0.5;
          b.z += hit.nz * hit.overlap * 0.5;
          a.vx -= hit.nx * 5;
          a.vz -= hit.nz * 5;
          b.vx += hit.nx * 5;
          b.vz += hit.nz * 5;
        }
      }
    }
  }

  burst(x, y, z, value) {
    const pal = styleFor(value);
    const n = 8;
    const power = 7 + Math.min(6, Math.max(0, tierOf(value)) * 0.06);
    let used = 0;
    for (const q of this.sparks) {
      if (used >= n) break;
      if (q.life > 0) continue;
      q.life = 0.4;
      q.vx = (Math.random() - 0.5) * power;
      q.vy = Math.random() * (power * 0.7) + 1;
      q.vz = (Math.random() - 0.5) * power;
      q.spin = false;
      q.mesh.visible = true;
      q.mesh.position.set(x, y, z);
      q.mesh.material.color.setHex(pal.color);
      q.mesh.scale.setScalar(1);
      used += 1;
    }
  }

  confetti(x, y, z) {
    const colors = [0xff4fd8, 0x7c5cff, 0x3ee0ff, 0xffe14a, 0xff7a3a, 0x4dff6a];
    let i = 0;
    for (const q of this.confettis) {
      if (q.life > 0) continue;
      q.life = 0.9;
      q.vx = (Math.random() - 0.5) * 9;
      q.vy = 3.5 + Math.random() * 6;
      q.vz = (Math.random() - 0.5) * 9;
      q.spin = true;
      q.mesh.visible = true;
      q.mesh.position.set(x, y + 0.4, z);
      q.mesh.material.color.setHex(colors[i % colors.length]);
      i += 1;
      if (i >= 16) break;
    }
  }

  updateTrail(dt) {
    if (!this.ghosts) return;
    this.trailClock += dt;
    if (this.trailClock < 0.032) return;
    this.trailClock = 0;
    const p = this.player;
    const ghost = this.ghosts.pop();
    ghost.visible = this.state === "play" || this.state === "winrun";
    ghost.position.set(p.x, p.y, p.z);
    ghost.scale.setScalar(p.r * 0.96);
    ghost.material.color.setHex(styleFor(p.value).color);
    this.ghosts.unshift(ghost);
    const base = this.fever > 0 ? 0.34 : this.superMode ? 0.22 : 0.14;
    for (let i = 0; i < this.ghosts.length; i++) {
      this.ghosts[i].material.opacity = base * (1 - i / this.ghosts.length);
    }
  }

  updateParticles(dt) {
    const step = (q, gravity) => {
      if (q.life <= 0) {
        if (q.mesh.visible) q.mesh.visible = false;
        return;
      }
      q.life -= dt;
      q.vy -= gravity * dt;
      q.mesh.position.x += q.vx * dt;
      q.mesh.position.y += q.vy * dt;
      q.mesh.position.z += q.vz * dt;
      if (q.spin) {
        q.mesh.rotation.x += dt * 8;
        q.mesh.rotation.z += dt * 6;
      } else {
        q.mesh.scale.setScalar(Math.max(0.01, q.life * 2.2));
      }
      if (q.life <= 0) q.mesh.visible = false;
    };
    for (const q of this.sparks) step(q, 8);
    for (const q of this.confettis) step(q, 11);
  }

  updateWaves(dt) {
    for (const w of this.wavePool) {
      if (w.life <= 0) {
        if (w.mesh.visible) w.mesh.visible = false;
        continue;
      }
      w.life -= dt;
      const t = 1 - w.life / w.max;
      w.mesh.scale.setScalar(1 + t * (w.grow || 10));
      w.mesh.material.opacity = 0.9 * (1 - t);
      if (w.life <= 0) w.mesh.visible = false;
    }
  }

  updateStreaks(dt) {
    if (!this.streaks?.length) return;
    const p = this.player;
    const on = this.state === "play";
    for (const s of this.streaks) {
      if (!on) {
        s.mesh.visible = false;
        continue;
      }
      s.mesh.visible = true;
      s.mesh.position.z -= s.spd * dt * (this.superMode ? 1.35 : 1);
      if (s.mesh.position.z < p.z - 6) {
        s.mesh.position.set(
          p.x + (Math.random() - 0.5) * 12,
          0.35 + Math.random() * 5,
          p.z + 6 + Math.random() * 22
        );
        s.spd = 28 + Math.random() * 48;
        const neon = this.heavyFx()
          ? [0xeab0ff, 0x3ee0ff, 0xff4fd8]
          : this.infLook()
            ? [0xff9ad8, 0xffe14a, 0xffffff]
            : [0xffffff, 0xffe4b8, 0xffc48a];
        s.mesh.material.color.setHex(neon[Math.floor(Math.random() * neon.length)]);
        s.mesh.material.opacity = this.fever > 0 ? 0.46 : this.boost > 0 ? 0.36 : this.superMode ? 0.3 : 0.18;
      }
    }
  }

  beginWinRun() {
    if (this.state !== "play") return;
    this.state = "winrun";
    this.winTimer = 0;
    this.winSettling = false;
    this.player.x = 0;
    this.clearWorld();
    this.setWinLook();
    this.buildWinRunway();
    this.winPadIndex = -1;
  }

  rainbowPadMap() {
    if (this.texCache.has("rainbow-pad")) return this.texCache.get("rainbow-pad");
    const canvas = document.createElement("canvas");
    canvas.width = 256;
    canvas.height = 64;
    const ctx = canvas.getContext("2d");
    const g = ctx.createLinearGradient(0, 0, 256, 0);
    g.addColorStop(0, "#ff3b3b");
    g.addColorStop(0.16, "#ff9a3b");
    g.addColorStop(0.33, "#ffe14a");
    g.addColorStop(0.5, "#4dff6a");
    g.addColorStop(0.66, "#3ec6ff");
    g.addColorStop(0.83, "#7c5cff");
    g.addColorStop(1, "#ff4fd8");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, 256, 64);
    const tex = new THREE.CanvasTexture(canvas);
    tex.colorSpace = THREE.SRGBColorSpace;
    this.texCache.set("rainbow-pad", tex);
    return tex;
  }

  padTexture(value, rainbow) {
    const key = `pad-${toVal(value).toString()}-${rainbow ? "r" : "n"}`;
    if (this.texCache.has(key)) return this.texCache.get(key);
    const { main, sub } = padLabel(value);
    const canvas = document.createElement("canvas");
    canvas.width = 512;
    canvas.height = 256;
    const ctx = canvas.getContext("2d");
    ctx.clearRect(0, 0, 512, 256);
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.lineJoin = "round";
    const size = main.length > 10 ? 36 : main.length > 6 ? 54 : 88;
    ctx.font = `900 ${size}px Nunito, sans-serif`;
    ctx.lineWidth = 14;
    ctx.strokeStyle = "#111111";
    ctx.strokeText(main, 256, sub ? 105 : 135);
    ctx.fillStyle = "#ffffff";
    ctx.fillText(main, 256, sub ? 105 : 135);
    if (sub) {
      ctx.font = "800 22px Nunito, sans-serif";
      ctx.lineWidth = 8;
      ctx.strokeText(sub, 256, 180);
      ctx.fillText(sub, 256, 180);
    }
    const tex = new THREE.CanvasTexture(canvas);
    tex.colorSpace = THREE.SRGBColorSpace;
    this.texCache.set(key, tex);
    return tex;
  }

  buildWinRunway() {
    this.disposeGroup(this.winGroup);
    this.winGroup = new THREE.Group();
    this.scene.add(this.winGroup);
    this.winPads = [];

    const tileW = 6.6;
    const tileL = 7.4;
    const gap = 0.18;
    const startZ = this.goalZ + tileL * 0.55;
    const playerTier = tierOf(this.player.value);
    const uncapped = this.maxValue == null;
    const last = uncapped ? Math.max(playerTier, 1) : Number(this.capTier());
    const floor = Number(this.floorExp());
    let first = this.isHalfKind() ? Math.max(floor, Math.min(playerTier, last) - 20) : uncapped ? Math.max(1, last - 31) : 1;
    if (last - first + 1 > 36) first = last - 35;
    const stepY = this.heavyFx() ? 0.92 : 1.28;

    for (let tier = first; tier <= last; tier++) {
      const value = fromTier(tier);
      const z = startZ + (tier - first) * (tileL + gap);
      const y = (tier - first) * stepY;
      const rainbow = isRainbow(value, this.maxValue);
      const color = rainbow ? 0xff6ad6 : padColor(value);
      const mat = new THREE.MeshStandardMaterial({
        color: rainbow ? 0xffffff : color,
        map: rainbow ? this.rainbowPadMap() : null,
        roughness: 0.32,
        metalness: 0.08,
        emissive: color,
        emissiveIntensity: rainbow ? 0.16 : 0.06,
      });
      const pad = new THREE.Mesh(new THREE.BoxGeometry(tileW, 0.42, tileL), mat);
      pad.position.set(0, y - 0.21, z);
      pad.receiveShadow = true;
      pad.castShadow = false;
      this.winGroup.add(pad);

      const num = new THREE.Mesh(
        new THREE.PlaneGeometry(5.4, 2.55),
        new THREE.MeshBasicMaterial({
          map: this.padTexture(value, rainbow),
          transparent: true,
          depthWrite: false,
        })
      );
      num.rotation.x = -Math.PI / 2;
      num.rotation.z = Math.PI;
      num.position.set(0, y + 0.06, z - 1.55);
      this.winGroup.add(num);

      this.winPads.push({ z, z0: z - tileL / 2, z1: z + tileL / 2, y, value, tier, mesh: pad, glow: rainbow ? 0.16 : 0.06 });
    }

    this.winStopZ = startZ + (playerTier - first) * (tileL + gap);
    this.ocean.position.z = startZ + (last - first + 1) * 4;
  }

  winSurfaceY(z) {
    const pads = this.winPads;
    if (!pads.length) return 0;
    if (z <= pads[0].z0) return pads[0].y;
    for (let i = 0; i < pads.length; i++) {
      const pad = pads[i];
      if (z >= pad.z0 && z <= pad.z1) return pad.y;
      const next = pads[i + 1];
      if (next && z > pad.z1 && z < next.z0) {
        const t = (z - pad.z1) / Math.max(0.001, next.z0 - pad.z1);
        return pad.y + (next.y - pad.y) * t;
      }
    }
    return pads[pads.length - 1].y;
  }

  updateWinRun(dt) {
    this.updateTrail(dt);
    for (const pad of this.winPads) {
      if (!pad.mesh?.material) continue;
      const base = pad.glow ?? 0.16;
      pad.mesh.material.emissiveIntensity += (base - pad.mesh.material.emissiveIntensity) * Math.min(1, 6 * dt);
    }
    const p = this.player;
    p.x += (0 - p.x) * Math.min(1, 8 * dt);
    this.squash += (1 - this.squash) * Math.min(1, 10 * dt);
    const target = this.winStopZ;
    if (!this.winSettling) {
      const dist = target - p.z;
      const speed = dist > 40 ? 22 : dist > 12 ? 16 : 9;
      p.z += speed * dt;
      p.spin += (speed * dt) / Math.max(0.2, p.r);
      p.mesh.rotation.x = p.spin;
      p.y = this.winSurfaceY(p.z) + p.r;
      let idx = -1;
      for (let i = 0; i < this.winPads.length; i++) {
        if (p.z >= this.winPads[i].z0) idx = i;
      }
      if (idx > this.winPadIndex) {
        this.winPadIndex = idx;
        const pad = this.winPads[idx];
        this.sfx.tile(0.55 + pad.tier * 0.08);
        this.burst(0, pad.y + 0.4, pad.z, pad.value);
        this.shockwave(0, pad.y + 0.15, pad.z, padColor(pad.value));
        this.fovPunch = Math.min(8, 2 + idx * 0.08);
        if (pad.mesh?.material) pad.mesh.material.emissiveIntensity = 0.4;
      }
      if (p.z >= target) {
        p.z = target;
        p.y = this.winSurfaceY(p.z) + p.r;
        this.winSettling = true;
        this.winTimer = 0;
        this.burst(p.x, p.y, p.z, p.value);
        this.confetti(p.x, p.y, p.z);
        this.confetti(p.x, p.y + 0.6, p.z + 1.2);
        this.shockwave(p.x, p.y, p.z, styleFor(p.value).color);
        this.flash(0.28);
        this.toast(shortValue(p.value));
        this.sfx.win(p.value);
      }
    } else {
      this.winTimer += dt;
      p.y = this.winSurfaceY(p.z) + p.r + Math.sin(this.winTimer * 6) * 0.08;
      p.spin += dt * 2.2;
      p.mesh.rotation.x = p.spin;
      if (this.winTimer > 1.8) this.finish("goal");
    }
  }

  finish(kind) {
    if (this.state === "end") return;
    this.state = "end";
    const value = this.player.value;
    if (this.best == null || magCmp(value, this.best) > 0) {
      this.best = value;
      localStorage.setItem(`${this.bestKey()}-e`, serializeVal(value));
      this.refreshBest();
    }

    const canNext = kind === "goal" && this.levelIndex < LEVEL_COUNT - 1;
    if (kind === "goal") {
      this.unlocked = Math.max(this.unlocked, this.levelIndex + 2);
      this.unlocked = Math.min(this.unlocked, LEVEL_COUNT);
      localStorage.setItem(UNLOCK_KEY, String(this.unlocked));
    }

    this.awardRunStars(kind);

    this.els.hud.classList.add("hidden");
    this.els.fever?.classList.add("hidden");
    this.els.pauseBtn?.classList.add("hidden");
    document.body.classList.toggle("cleared", kind === "goal");
    document.body.classList.remove("fever", "boosting");
    this.els.end.classList.remove("hidden");
    this.els.endNumber.textContent = shortValue(value);
    this.els.endNumber.classList.toggle("rainbow-text", isRainbow(value, this.maxValue));
    this.els.next.classList.toggle("hidden", !canNext);

    if (kind === "goal") {
      this.els.endKicker.textContent = `level ${this.level.id} clear`;
      if (this.endless) {
        this.els.endTitle.textContent = "∞∞";
        this.els.endMsg.textContent = `You rolled in as ${shortValue(value)} (2^${tierOf(value)}). Infinity does not end. This level did.`;
      } else if (this.sandbox) {
        this.els.endTitle.textContent = "SANDBOX";
        this.els.endMsg.textContent = `Started at ${shortValue(this.startValue())}, finished at ${shortValue(value)}.`;
      } else if (this.halfInf) {
        this.els.endTitle.textContent = isRainbow(value, this.maxValue) ? "HALF ∞" : "NICE";
        this.els.endMsg.textContent = `Icy climb. You rolled in as ${shortValue(value)}.`;
      } else if (this.half) {
        this.els.endTitle.textContent = isRainbow(value, this.maxValue) ? "HALF" : "NICE";
        this.els.endMsg.textContent = isRainbow(value, this.maxValue)
          ? `Rainbow from the frost. ${shortValue(value)}.`
          : `You rolled in as ${shortValue(value)}. ${this.level.name} is done.`;
      } else if (this.custom) {
        this.els.endTitle.textContent = isRainbow(value, this.maxValue) ? "CUSTOM" : "NICE";
        this.els.endMsg.textContent = isRainbow(value, this.maxValue)
          ? `You hit your ceiling ${expLabel(this.customCap)}.`
          : `You rolled in as ${shortValue(value)}. ${this.level.name} is done.`;
      } else {
        this.els.endTitle.textContent = isRainbow(value, this.maxValue)
          ? this.superMode
            ? "SUPER ∞"
            : this.infinity
              ? "INFINITY"
              : "2048"
          : "NICE";
        this.els.endMsg.textContent = isRainbow(value, this.maxValue)
          ? this.superMode
            ? `You hit ${shortValue(value)} (2^${this.capTier()}).`
            : this.infinity
              ? `You hit ${shortValue(value)}. That is the whole integer.`
              : `You made the rainbow ball (${shortValue(value)}). That is the whole game.`
          : `You rolled in as ${shortValue(value)}. ${this.level.name} is done.`;
      }
    } else if (kind === "spike") {
      this.els.endKicker.textContent = this.level.name;
      this.els.endTitle.textContent = "OOPS";
      this.els.endMsg.textContent = this.isHalfKind()
        ? `You hit a spike at ${shortValue(this.floorExp())}. That's the floor of this run.`
        : "You hit a spike at 2. That's the end of this run.";
    } else {
      this.els.endKicker.textContent = this.level.name;
      this.els.endTitle.textContent = "OOPS";
      this.els.endMsg.textContent = "You fell off the rail. Retry this level or pick another.";
    }
  }

  draw() {
    const p = this.player;
    const squash = this.squash || 1;
    p.mesh.position.set(p.x, p.y, p.z);
    p.mesh.scale.set(p.r / squash, p.r * squash, p.r / squash);

    if (this.sky) this.sky.position.copy(this.camera.position);

    const pal = styleFor(p.value);
    const live = this.state === "play" || this.state === "winrun" || this.state === "title" || this.state === "falling";
    if (this.aura) {
      this.aura.visible = live;
      this.aura.position.set(p.x, p.y + 0.02, p.z);
      const pulse = 1 + Math.sin(this.clock.elapsedTime * 6) * 0.08;
      this.aura.scale.setScalar(p.r * pulse * (this.shield ? 1.18 : 1));
      this.aura.material.color.setHex(this.shield ? 0x3ee0ff : this.fever > 0 ? 0xff4fd8 : pal.color);
      this.aura.rotation.z = this.clock.elapsedTime * (this.fever > 0 ? 5.5 : 2.2);
      this.aura.material.opacity = this.shield ? 0.55 : this.fever > 0 ? 0.5 : this.superMode ? 0.38 : 0.2;
    }
    if (this.glowDisk) {
      this.glowDisk.visible = p.y > -1 && this.state !== "falling";
      this.glowDisk.position.set(p.x, (this.state === "winrun" ? this.winSurfaceY(p.z) : 0.04) + 0.02, p.z);
      this.glowDisk.scale.setScalar(p.r * (1.6 + Math.sin(this.clock.elapsedTime * 7) * 0.15));
      this.glowDisk.material.color.setHex(pal.color);
    }

    this.blob.position.x = p.x;
    this.blob.position.z = p.z;
    const onStairs = this.state === "winrun" || (this.state === "end" && this.ocean.visible);
    this.blob.position.y = onStairs ? this.winSurfaceY(p.z) + 0.03 : 0.03;
    this.blob.scale.setScalar(p.r * (!onStairs && p.y > p.r + 0.2 ? 0.4 : 1.15));
    this.blob.visible = p.y > -1;

    if (
      this.state === "play" ||
      this.state === "paused" ||
      this.state === "falling" ||
      this.state === "end" ||
      this.state === "winrun"
    ) {
      const win = this.state === "winrun" || (this.state === "end" && this.ocean.visible);
      const shakeAmt = this.settings.shake ? this.shake : 0;
      const shakeX = (Math.random() - 0.5) * shakeAmt * 1.4;
      const shakeY = (Math.random() - 0.5) * shakeAmt * 0.9;
      const camX = p.x * (win ? 0.12 : 0.72) + shakeX;
      const camY = (win ? 6.2 + p.y + p.r * 0.35 : 4.15 + p.r * 1.35 + Math.max(0, -p.y) * 0.15) + shakeY;
      const camZ = p.z - (win ? 8.0 : 6.8 + p.r * 0.85);
      this.camera.position.x += (camX - this.camera.position.x) * 0.14;
      this.camera.position.y += (camY - this.camera.position.y) * 0.12;
      this.camera.position.z += (camZ - this.camera.position.z) * 0.18;
      this.camera.lookAt(p.x, Math.max(0.15, win ? p.y + 0.35 : p.y * 0.45), p.z + (win ? 13 : 8.5));
      if (this.combo >= 4 && this.state === "play") {
        this.camera.rotateZ(Math.sin(this.clock.elapsedTime * 10) * 0.028);
      }
      if (this.renderer.shadowMap.enabled) {
        this.sun.position.set(p.x - 18, 34 + (win ? p.y : 0), p.z + 8);
        this.sun.target.position.set(p.x, win ? p.y : 0, p.z + 6);
        this.sun.target.updateMatrixWorld();
      }
      if (!win) this.ground.position.z = p.z + 160;
      if (this.playerLight) {
        this.playerLight.position.set(p.x, p.y + 1.1, p.z);
        const pal = styleFor(p.value);
        this.playerLight.color.setHex(pal.color);
        this.playerLight.intensity = this.fever > 0 ? 1.05 : this.superMode ? 0.85 : 0.45;
        this.playerLight.distance = 14 + p.r * 6;
      }
      if (this.stars) this.stars.position.z = p.z - 40;
    }

    const bloom = this.useBloom && this.composer && this.settings.quality === "high";
    if (bloom) this.composer.render();
    else this.renderer.render(this.scene, this.camera);
  }
}
