/**
 * Every wand is the same engine with different numbers.
 * Tune a wand here; you shouldn't need to touch garden.ts.
 */

export type ThemeKey = "flowers" | "stars" | "spells" | "creatures";

export type Theme = {
  key: ThemeKey;
  label: string;
  /** Swap these for your own drawings — see public/icons/. */
  icon: string;
  path: string;
  hint: string;
  accent: string;

  manifest: string;

  /** How particles appear as you move. */
  plantMode: "trail" | "dwell";
  /** 1 = spawns exactly at the fingertip. Lower = trail lags behind. */
  follow: number;
  spacing: number;
  dwellMs: number;

  sizeMin: number;
  sizeMax: number;

  /** Idle behaviour once placed. */
  breatheAmount: number;
  wander: number;
  twinkle: number;
  link: boolean;
  glow: boolean;
  /** Newest particles chase the fingertip after placement. 0 = stay put. */
  chase: number;
  /** Stretch along direction of travel. Sells "alive". */
  squash: number;
  /** Art has numbered evolution stages; 1/2/3 fingers switches between them. */
  evolves: boolean;
  /** A closed fist catches nearby creatures in an orb. */
  catchable: boolean;

  /** What an open palm does. */
  burstStyle: "explode" | "driftUp" | "levitate";
  gravity: number;
  drag: number;
  fade: number;

  maxParticles: number;
};

export const THEMES: Record<ThemeKey, Theme> = {
  flowers: {
    key: "flowers",
    label: "Flowers",
    icon: "/icons/flowers.svg",
    path: "/",
    hint: "Point to plant · Open your hand to scatter",
    accent: "#f0b4c4",
    manifest: "/art/flowers/manifest.json",
    plantMode: "trail",
    follow: 1,
    spacing: 14,
    dwellMs: 0,
    sizeMin: 34,
    sizeMax: 80,
    breatheAmount: 0.09,
    wander: 0,
    twinkle: 0,
    link: false,
    glow: false,
    chase: 0,
    squash: 0,
    evolves: false,
    catchable: false,
    burstStyle: "explode",
    gravity: 0.12,
    drag: 0.985,
    fade: 0.012,
    maxParticles: 500,
  },

  stars: {
    key: "stars",
    label: "Constellations",
    icon: "/icons/stars.svg",
    path: "/stars",
    hint: "Hold still to place a star · Open your hand to release",
    accent: "#cfe0ff",
    manifest: "/art/stars/manifest.json",
    plantMode: "dwell",
    follow: 1,
    spacing: 40,
    dwellMs: 300,
    sizeMin: 18,
    sizeMax: 46,
    breatheAmount: 0.04,
    wander: 0,
    twinkle: 0.45,
    link: true,
    glow: true,
    chase: 0,
    squash: 0,
    evolves: false,
    catchable: false,
    burstStyle: "driftUp",
    gravity: -0.012,
    drag: 0.995,
    fade: 0.005,
    maxParticles: 220,
  },

  spells: {
    key: "spells",
    label: "Spells",
    icon: "/icons/spells.svg",
    path: "/spells",
    hint: "Point to cast · Trace a circle or zigzag · Open your hand to lift",
    accent: "#c9a8ff",
    manifest: "/art/spells/manifest.json",
    plantMode: "trail",
    follow: 0.3, // sparks chase the fingertip — fast moves stretch the trail
    spacing: 9,
    dwellMs: 0,
    sizeMin: 20,
    sizeMax: 54,
    breatheAmount: 0.16,
    wander: 0.25,
    twinkle: 0.3,
    link: false,
    glow: true,
    chase: 0,
    squash: 0,
    evolves: false,
    catchable: false,
    burstStyle: "levitate",
    gravity: 0.04,
    drag: 0.97,
    fade: 0.02,
    maxParticles: 400,
  },

  creatures: {
    key: "creatures",
    label: "Creatures",
    icon: "/icons/creatures.svg",
    path: "/creatures",
    hint: "1 finger to summon · 2 or 3 to evolve · Fist to catch · Open hand to release",    accent: "#f6c98a",
    manifest: "/art/creatures/manifest.json",
    plantMode: "trail",
    follow: 0.55,
    spacing: 90, // sparse — these are characters, not confetti
    dwellMs: 0,
    sizeMin: 48,
    sizeMax: 96,
    breatheAmount: 0.13,
    wander: 1.6, // they drift on their own when you stop
    twinkle: 0,
    link: false,
    glow: false,
    chase: 0.035,
    squash: 0.5,
    evolves: true,
    catchable: true,
    burstStyle: "explode",
    gravity: 0.05,
    drag: 0.98,
    fade: 0.009,
    maxParticles: 40,
  },
};

export const THEME_LIST = Object.values(THEMES);

export function themeFromPath(pathname: string): Theme {
  return THEME_LIST.find((t) => t.path === pathname) ?? THEMES.flowers;
}
