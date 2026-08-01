import { FilesetResolver, HandLandmarker } from "@mediapipe/tasks-vision";

const WASM_PATH =
  "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/wasm";

export async function createHandLandmarker(): Promise<HandLandmarker> {
  const fileset = await FilesetResolver.forVisionTasks(WASM_PATH);

  return HandLandmarker.createFromOptions(fileset, {
    baseOptions: {
      // Served from Google's CDN, not your own hosting. This file is 7.8MB —
      // self-hosting it was ~65% of all bandwidth used.
      modelAssetPath:
        "https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task",
      delegate: "GPU",
    },
    runningMode: "VIDEO",
    numHands: 2,
    minHandDetectionConfidence: 0.5,
    minHandPresenceConfidence: 0.5,
    minTrackingConfidence: 0.5,
  });
}

/** MediaPipe landmark indices. */
export const INDEX_TIP = 8;
export const WRIST = 0;

type Landmark = { x: number; y: number; z: number };

// [tip, pip] pairs for index, middle, ring, pinky.
const FINGERS: [number, number][] = [
  [8, 6],
  [12, 10],
  [16, 14],
  [20, 18],
];

/** Open palm: all four non-thumb fingers clearly extended above their joints. */
export function isOpenHand(lm: Landmark[]): boolean {
  return FINGERS.every(([tip, pip]) => lm[tip].y < lm[pip].y - 0.04);
}

/** Pointing: index up, the other three curled. This is the drawing pose. */
export function isPointing(lm: Landmark[]): boolean {
  const indexUp = lm[8].y < lm[6].y - 0.03;
  const othersDown =
    lm[12].y > lm[10].y && lm[16].y > lm[14].y && lm[20].y > lm[18].y;
  return indexUp && othersDown;
}

/** Bone pairs for drawing the hand skeleton. */
export const HAND_CONNECTIONS: [number, number][] = [
  [0, 1], [1, 2], [2, 3], [3, 4],
  [0, 5], [5, 6], [6, 7], [7, 8],
  [5, 9], [9, 10], [10, 11], [11, 12],
  [9, 13], [13, 14], [14, 15], [15, 16],
  [13, 17], [17, 18], [18, 19], [19, 20],
  [0, 17],
];

/**
 * Rough apparent size of the hand (wrist to middle-finger MCP).
 * Grows as the hand moves toward the camera — used to detect a throw.
 */
export function handSpan(lm: { x: number; y: number }[]): number {
  return Math.hypot(lm[9].x - lm[0].x, lm[9].y - lm[0].y);
}

/**
 * How many non-thumb fingers are extended (0–4).
 *
 * Counts *any* N fingers rather than requiring specific ones: extending
 * ring-without-pinky is physically hard for many people, since those tendons
 * are linked. Requiring an exact set would lock people out.
 */
export function extendedCount(lm: Landmark[]): number {
  let n = 0;
  for (const [tip, pip] of FINGERS) {
    if (lm[tip].y < lm[pip].y - 0.03) n++;
  }
  return n;
}

/** Closed fist: every finger curled, tips gathered near the palm. */
export function isFist(lm: Landmark[]): boolean {
  if (extendedCount(lm) > 0) return false;
  const palmX = lm[9].x;
  const palmY = lm[9].y;
  const span = handSpan(lm) || 0.001;
  return FINGERS.every(([tip]) => {
    const d = Math.hypot(lm[tip].x - palmX, lm[tip].y - palmY);
    return d < span * 1.5;
  });
}