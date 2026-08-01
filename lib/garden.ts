import type { Theme } from "./themes";

/**
 * One particle engine, four wands. All behaviour differences come from the
 * Theme passed in — see lib/themes.ts.
 */

export type Particle = {
  x: number;
  y: number;
  homeX: number;
  homeY: number;
  img: HTMLImageElement;
  size: number;
  rot: number;
  spin: number;
  born: number;
  phase: number;
  vx: number;
  vy: number;
  alpha: number;
  state: "planted" | "burst";
  prev: Particle | null; // for constellation lines
  pop: number; // 0–1 extra scale, used by the throw gesture
  /** Evolution line this particle belongs to, if the wand has stages. */
  family: HTMLImageElement[] | null;
  stage: number; // 0-indexed into family
  caught: boolean; // hidden while being sucked into an orb
};

const rand = (a: number, b: number) => a + Math.random() * (b - a);

const easeOutBack = (x: number) =>
  1 + 2.70158 * Math.pow(x - 1, 3) + 1.70158 * Math.pow(x - 1, 2);

const GROW_MS = 260;
const BREATHE_MS = 620;

/** Shuffled bag: every image appears once before any repeats. */
let bag: number[] = [];
let lastDrawn = -1;

export function resetBag() {
  bag = [];
  lastDrawn = -1;
}

function nextImageIndex(count: number): number {
  if (bag.length === 0) {
    bag = Array.from({ length: count }, (_, i) => i);
    for (let i = bag.length - 1; i > 0; i--) {
      const j = (Math.random() * (i + 1)) | 0;
      [bag[i], bag[j]] = [bag[j], bag[i]];
    }
    if (bag.length > 1 && bag[bag.length - 1] === lastDrawn) {
      [bag[bag.length - 1], bag[0]] = [bag[0], bag[bag.length - 1]];
    }
  }
  lastDrawn = bag.pop()!;
  return lastDrawn;
}

function spawn(
  garden: Particle[],
  x: number,
  y: number,
  images: HTMLImageElement[],
  theme: Theme,
  pop = 0,
  families?: HTMLImageElement[][]
) {
  const prev =
    theme.link && garden.length > 0 ? garden[garden.length - 1] : null;

  // Evolution wands pick a whole family and start at stage 1.
  let family: HTMLImageElement[] | null = null;
  let img: HTMLImageElement;
  if (theme.evolves && families && families.length > 0) {
    family = families[(Math.random() * families.length) | 0];
    img = family[0];
  } else {
    img = images[nextImageIndex(images.length)];
  }

  garden.push({
    x,
    y,
    homeX: x,
    homeY: y,
    img,
    size: rand(theme.sizeMin, theme.sizeMax),
    rot: theme.link || theme.chase > 0 ? 0 : rand(0, Math.PI * 2),
    spin: rand(-0.04, 0.04),
    born: performance.now(),
    phase: rand(0, Math.PI * 2),
    vx: 0,
    vy: 0,
    alpha: 1,
    state: "planted",
    prev: prev && prev.state === "planted" ? prev : null,
    pop,
    family,
    stage: 0,
    caught: false,
  });

  if (garden.length > theme.maxParticles) garden.shift();
}

/**
 * Plant along the path from lastPoint to (x, y). Hand detection only runs at
 * camera frame rate, so a fast stroke would otherwise leave visible gaps.
 */
export function plant(
  garden: Particle[],
  x: number,
  y: number,
  images: HTMLImageElement[],
  lastPoint: { x: number; y: number } | null,
  theme: Theme,
  families?: HTMLImageElement[][]
): { x: number; y: number } | null {
  if (images.length === 0) return lastPoint;

  if (!lastPoint) {
    spawn(garden, x, y, images, theme, 0, families);
    return { x, y };
  }

  const dx = x - lastPoint.x;
  const dy = y - lastPoint.y;
  const dist = Math.hypot(dx, dy);
  if (dist < theme.spacing) return lastPoint;

  const steps = Math.min(Math.floor(dist / theme.spacing), 10);
  for (let i = 1; i <= steps; i++) {
    const t = i / steps;
    spawn(garden, lastPoint.x + dx * t, lastPoint.y + dy * t, images, theme, 0, families);
  }

  return { x, y };
}

/** Place one particle regardless of spacing — dwell mode and the throw gesture. */
export function place(
  garden: Particle[],
  x: number,
  y: number,
  images: HTMLImageElement[],
  theme: Theme,
  pop = 0,
  families?: HTMLImageElement[][]
) {
  if (images.length === 0) return;
  spawn(garden, x, y, images, theme, pop, families);
}

/**
 * Open palm.
 *   explode  — firework outward from the wrist
 *   driftUp  — the whole composition lifts away and shrinks
 *   levitate — freeze, then rise slowly and wink out
 */
export function burst(
  garden: Particle[],
  originX: number,
  originY: number,
  theme: Theme
) {
  for (const p of garden) {
    if (p.state === "burst") continue;
    p.state = "burst";

    if (theme.burstStyle === "driftUp") {
      p.vx = rand(-0.5, 0.5);
      p.vy = rand(-1.6, -0.6);
      p.spin = rand(-0.01, 0.01);
    } else if (theme.burstStyle === "levitate") {
      p.vx = rand(-0.25, 0.25);
      p.vy = rand(-0.9, -0.3);
      p.spin = rand(-0.03, 0.03);
    } else {
      const angle = Math.atan2(p.y - originY, p.x - originX) + rand(-0.3, 0.3);
      const power = rand(6, 15);
      p.vx = Math.cos(angle) * power;
      p.vy = Math.sin(angle) * power - 3;
      p.spin = rand(-0.12, 0.12);
    }
  }
}

/** Cast a traced shape: a ring of particles around a center. */
export function castRing(
  garden: Particle[],
  cx: number,
  cy: number,
  radius: number,
  images: HTMLImageElement[],
  theme: Theme,
  count = 26
) {
  for (let i = 0; i < count; i++) {
    const a = (Math.PI * 2 * i) / count;
    spawn(
      garden,
      cx + Math.cos(a) * radius,
      cy + Math.sin(a) * radius,
      images,
      theme,
      0.6
    );
  }
}

/** Cast a bolt: particles along a jagged vertical path. */
export function castBolt(
  garden: Particle[],
  x: number,
  y: number,
  images: HTMLImageElement[],
  theme: Theme,
  height = 260
) {
  const steps = 22;
  let px = x;
  for (let i = 0; i < steps; i++) {
    const t = i / steps;
    px += rand(-26, 26);
    spawn(garden, px, y - height * t, images, theme, 0.5);
  }
}

/**
 * Move every planted particle to a given evolution stage.
 * Returns true if anything changed, so the caller can show a label.
 */
export function setStage(garden: Particle[], stage: number): boolean {
  let changed = false;
  for (const p of garden) {
    if (p.state !== "planted" || !p.family || p.caught) continue;
    const target = Math.min(stage, p.family.length - 1);
    if (target === p.stage) continue;
    p.stage = target;
    p.img = p.family[target];
    p.pop = 0.55; // squash-and-settle on the swap
    changed = true;
  }
  return changed;
}

/** Extra size multiplier per stage — later forms read as bigger. */
export function stageScale(stage: number): number {
  return 1 + stage * 0.3;
}

/* ---------------------------------------------------------------- catching */

export type Catcher = {
  x: number;
  y: number;
  born: number;
  targets: Particle[];
  from: { x: number; y: number }[];
};

const CATCH_OPEN = 260;
const CATCH_SUCK = 460;
const CATCH_WOBBLE = 1150;
const CATCH_VANISH = 420;
export const CATCH_TOTAL = CATCH_OPEN + CATCH_SUCK + CATCH_WOBBLE + CATCH_VANISH;

export function startCatch(
  garden: Particle[],
  x: number,
  y: number,
  radius = 320,
  max = 3
): Catcher | null {
  const near = garden
    .filter((p) => p.state === "planted" && !p.caught)
    .map((p) => ({ p, d: Math.hypot(p.x - x, p.y - y) }))
    .filter((v) => v.d < radius)
    .sort((a, b) => a.d - b.d)
    .slice(0, max)
    .map((v) => v.p);

  if (near.length === 0) return null;
  for (const p of near) p.caught = true;

  return {
    x,
    y,
    born: performance.now(),
    targets: near,
    from: near.map((p) => ({ x: p.x, y: p.y })),
  };
}

export function stepCatchers(
  catchers: Catcher[],
  garden: Particle[],
  ctx: CanvasRenderingContext2D,
  t: number,
  orb: HTMLImageElement | null,
  accent: string
): Catcher[] {
  const alive: Catcher[] = [];

  for (const c of catchers) {
    const age = t - c.born;
    if (age > CATCH_TOTAL) {
      for (const p of c.targets) {
        const i = garden.indexOf(p);
        if (i >= 0) garden.splice(i, 1);
      }
      continue;
    }
    alive.push(c);

    let scale = 1;
    let tilt = 0;
    const SIZE = 92;

    if (age < CATCH_OPEN) {
      scale = easeOutBack(age / CATCH_OPEN);
    } else if (age < CATCH_OPEN + CATCH_SUCK) {
      const k = (age - CATCH_OPEN) / CATCH_SUCK;
      c.targets.forEach((p, i) => {
        const f = c.from[i];
        p.x = f.x + (c.x - f.x) * k;
        p.y = f.y + (c.y - f.y) * k;
        const s = p.size * (1 - k);
        ctx.save();
        ctx.globalAlpha = 1 - k * 0.4;
        ctx.translate(p.x, p.y);
        ctx.rotate(p.rot + k * 4);
        ctx.drawImage(p.img, -s / 2, -s / 2, s, s);
        ctx.restore();
      });
    } else if (age < CATCH_OPEN + CATCH_SUCK + CATCH_WOBBLE) {
      const k = (age - CATCH_OPEN - CATCH_SUCK) / CATCH_WOBBLE;
      tilt = Math.sin(k * Math.PI * 6) * 0.34 * (1 - k);
      scale = 1 + Math.sin(k * Math.PI * 6) * 0.06 * (1 - k);
    } else {
      const k = (age - CATCH_OPEN - CATCH_SUCK - CATCH_WOBBLE) / CATCH_VANISH;
      scale = 1 - k;
    }

    if (scale <= 0) continue;

    const s = SIZE * scale;
    ctx.save();
    ctx.globalAlpha = Math.min(1, scale);
    ctx.translate(c.x, c.y);
    ctx.rotate(tilt);
    if (orb) {
      ctx.drawImage(orb, -s / 2, -s / 2, s, s);
    } else {
      ctx.beginPath();
      ctx.arc(0, 0, s / 2, 0, Math.PI * 2);
      ctx.fillStyle = accent;
      ctx.fill();
      ctx.lineWidth = 3;
      ctx.strokeStyle = "rgba(11,15,12,0.85)";
      ctx.beginPath();
      ctx.moveTo(-s / 2, 0);
      ctx.lineTo(s / 2, 0);
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(0, 0, s * 0.16, 0, Math.PI * 2);
      ctx.fillStyle = "rgba(11,15,12,0.85)";
      ctx.fill();
    }
    ctx.restore();
  }

  return alive;
}

/**
 * Advance and draw one frame.
 * `tip` is the current fingertip, used by themes with chase > 0.
 */
export function step(
  garden: Particle[],
  ctx: CanvasRenderingContext2D,
  t: number,
  theme: Theme,
  tip: { x: number; y: number } | null
) {
  // Constellation lines first, so they sit behind the art.
  if (theme.link) {
    ctx.save();
    ctx.strokeStyle = "rgba(207, 224, 255, 0.32)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (const p of garden) {
      if (!p.prev || p.state === "burst" || p.prev.state === "burst") continue;
      ctx.moveTo(p.prev.x, p.prev.y);
      ctx.lineTo(p.x, p.y);
    }
    ctx.stroke();
    ctx.restore();
  }

  if (theme.glow) ctx.globalCompositeOperation = "lighter";

  // Only the few most recent creatures chase the finger; the rest settle.
  const chaseFrom = garden.length - 3;

  for (let i = garden.length - 1; i >= 0; i--) {
    const p = garden[i];
    if (p.caught) continue; // the catch orb draws these itself
    let scale = 1;
    let alpha = p.alpha;
    let sx = 1;
    let sy = 1;

    if (p.state === "planted") {
      const grow = Math.min(1, (t - p.born) / GROW_MS);
      const breathe = 1 + Math.sin(t / BREATHE_MS + p.phase) * theme.breatheAmount;
      scale = easeOutBack(grow) * breathe;

      if (p.pop > 0) {
        scale *= 1 + p.pop;
        p.pop *= 0.86; // decays back to normal
      }

      p.rot += p.spin * 0.15;

      // Chase the fingertip with lag, then squash along the direction of travel.
      if (theme.chase > 0 && tip && i >= chaseFrom) {
        const dx = tip.x - p.x;
        const dy = tip.y - p.y;
        p.vx += dx * theme.chase;
        p.vy += dy * theme.chase;
        p.vx *= 0.82;
        p.vy *= 0.82;
        p.x += p.vx;
        p.y += p.vy;
        p.homeX = p.x;
        p.homeY = p.y;

        const speed = Math.hypot(p.vx, p.vy);
        const stretch = Math.min(speed / 26, 1) * theme.squash;
        sx = 1 + stretch;
        sy = 1 - stretch * 0.6;
        p.rot = speed > 0.6 ? Math.atan2(p.vy, p.vx) : p.rot;
      } else if (theme.wander > 0) {
        // Slow self-directed drift — what makes creatures feel alive.
        p.x = p.homeX + Math.sin(t / 1400 + p.phase) * theme.wander * 6;
        p.y = p.homeY + Math.cos(t / 1900 + p.phase * 1.7) * theme.wander * 4;
      }

      if (theme.twinkle > 0) {
        alpha = 1 - theme.twinkle * (0.5 + 0.5 * Math.sin(t / 380 + p.phase));
      }
    } else {
      p.x += p.vx;
      p.y += p.vy;
      p.vy += theme.gravity;
      p.vx *= theme.drag;
      p.vy *= theme.drag;
      p.rot += p.spin;
      p.alpha -= theme.fade;
      alpha = p.alpha;
      scale =
        theme.burstStyle === "explode"
          ? 1 + (1 - p.alpha) * 0.5 // blooms outward
          : 1 - (1 - p.alpha) * 0.4; // shrinks into the sky
      if (p.alpha <= 0) {
        garden.splice(i, 1);
        continue;
      }
    }

    const s = p.size * scale * (p.family ? stageScale(p.stage) : 1);
    ctx.save();
    ctx.globalAlpha = Math.max(0, Math.min(1, alpha));
    ctx.translate(p.x, p.y);
    ctx.rotate(p.rot);
    ctx.drawImage(p.img, (-s * sx) / 2, (-s * sy) / 2, s * sx, s * sy);
    ctx.restore();
  }

  ctx.globalCompositeOperation = "source-over";
}
