# MP2048

Merge, dodge, and roll. Steer a numbered ball down a 3D rail, smash matching numbers, and grow a rainbow **2048**.

## Play on PC

```bash
npm install
npm run dev
```

Open the URL Vite prints (usually `http://localhost:5173`).

Production build:

```bash
npm run build
npm run preview
```

## iPhone

This is a web game. On iPhone, open it in Safari → **Share** → **Add to Home Screen**. It launches as **MP2048**.

Apple App Store submission needs an Apple Developer account, Xcode, signing, screenshots, and App Store Connect. That cannot be done from this repo alone.

## How to play

- Steer with **mouse / touch**, or **A/D** and **arrow keys**. Esc pauses.
- Hit a ball with the **same number** to merge: 2 → 4 → 8 → … → 2048.
- **Spikes** cut your number in half. At **2**, a spike ends the run (Half modes go down to 2⁻³¹).
- Fall off the rail and the run ends.
- Grab shields, magnets, boosts, hearts, and stars. Spend stars on upgrades.
- **96 levels**, from First Roll to MP Forever.
- Modes: **2048**, **Infinity**, **Super ∞**, **∞∞**, **Custom**, **Half**, **Half ∞**, and **Sandbox**.
- **Half** starts at 2, has gold **×1.5 walls** (2 becomes 3), 1.5× spikes, and can split down to 2⁻³¹. **Half ∞** is Half with an Infinity climb. Rainbow balls keep merging. Bigger Ball has no rank cap.
