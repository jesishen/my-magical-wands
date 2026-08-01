# Magical Wand

Your finger is a wand. Draw in the air with your camera.

Four wands share one camera, one hand-tracking model, and one particle engine —
only the numbers and the art change.

| wand | how you draw | what an open palm does |
|---|---|---|
| **Flowers** | continuous trail from your fingertip | scatter like fireworks |
| **Constellations** | hold still ~300ms to place a star; stars auto-link | the whole composition lifts away |
| **Spells** | sparks chase your fingertip with lag; trace a **circle** for a shield ring or a **zigzag** for a bolt | everything levitates and winks out |
| **Creatures** | sparse; the newest follow your finger and squash-stretch as they move; push your hand toward the camera to throw one | scatter |

## Setup

```bash
npm install
npm run dev
```

Open http://localhost:3000 and allow camera access.

No model download step — MediaPipe loads from Google's CDN.

## Adding your art

1. Drop full-size drawings into `art-source/<wand>/` (PNG, any size)
2. Run `npm run compress <wand>` — or `npm run compress` for all four

That resizes to 256px, converts to WebP, writes to `public/art/<wand>/`, and
regenerates the manifest. Don't edit `public/art/` by hand; it gets overwritten.

Draw at whatever size is comfortable (1024 or 2048 is fine). Keep the subject
centered with ~15% padding so rotation doesn't clip the corners.

### Swapping the wand icons

`public/icons/*.svg` — replace with your own. They render at 24px in the
switcher, so bold silhouettes read best. SVG is preferred; PNG works if you
update the paths in `lib/themes.ts`.

## Why the art is small

Particles render at most ~96px on screen. At 2x device pixel ratio that's
~192px, and a burst scales up ~1.5x. 256px covers it with headroom — 512px was
shipping 4x the pixels for no visible difference. WebP then roughly halves what
PNG costs at the same quality.

Art also loads lazily and is cached: opening `/stars` downloads only the star
images, and switching back to a wand you've already used costs nothing.

**Per visit: ~250KB**, versus ~12MB for the original single-wand version.
The 7.8MB model was the bulk of that and now comes from Google's CDN.

## Camera

A capture bar sits at the bottom, modelled on the iOS camera.

- **PHOTO** — shutter fires a flash and saves a PNG
- **VIDEO** — shutter turns into a stop square, timer appears top-right, saves
  MP4 on Safari/iOS and WebM elsewhere

On mobile both open the native share sheet so you can save straight to Photos.
On desktop they download. The hand skeleton is hidden automatically during any
capture, so it never ends up in your footage.

## Controls

- **S** — toggle the hand skeleton overlay

## Tuning

`lib/themes.ts` holds everything that makes the wands feel different: spacing,
sizes, gravity, follow lag, wander, twinkle, chase, squash, burst style. You
shouldn't need to touch `lib/garden.ts` to change how a wand behaves.

Gesture sensitivity lives in `lib/hands.ts` (y-thresholds) and at the top of
`components/WandStage.tsx` (`BURST_FRAMES`, `THROW_RATE`, `DWELL_RADIUS`).

Spell shape recognition is in `lib/shapes.ts` and is deliberately forgiving —
straight lines and small scribbles are ignored so you don't cast by accident
while drawing normally.

Adding a fifth wand: add an entry to `THEMES`, create `app/<name>/page.tsx`
returning `null`, add `art-source/<name>/`, and drop an icon in `public/icons/`.

## Deploying

Push to GitHub, import in Vercel or Cloudflare Pages. No env vars.
Camera access requires HTTPS, which both provide.
