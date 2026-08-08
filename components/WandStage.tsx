"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import type { HandLandmarker } from "@mediapipe/tasks-vision";
import {
  burst,
  castBolt,
  castRing,
  place,
  plant,
  resetBag,
  drawHeldBall,
  frameDelta,
  newCatch,
  setStage,
  step,
  stepCatch,
  summon,
  tryCatch,
  type Catch,
  type Particle,
} from "@/lib/garden";
import {
  createHandLandmarker,
  extendedCount,
  HAND_CONNECTIONS,
  handSpan,
  INDEX_TIP,
  isFist,
  isOpenHand,
  isPointing,
  WRIST,
} from "@/lib/hands";
import { loadImages, loadOne, type ArtSet } from "@/lib/loadImages";
import {
  addToDex,
  buildCatalog,
  dexNumber,
  dexTotal,
  dexUnique,
  speciesName,
  type Dex,
  type Entry,
} from "@/lib/dex";
import { THEME_LIST, themeFromPath, type Theme } from "@/lib/themes";
import { ShapeTracer } from "@/lib/shapes";
import { capturePhoto, Recorder, saveOrShare } from "@/lib/capture";

const BURST_FRAMES = 4;
const BURST_COOLDOWN_MS = 800;
const DWELL_RADIUS = 26;
const THROW_COOLDOWN_MS = 700;
/** How fast the hand must grow (moving toward camera) to count as a throw. */
const THROW_RATE = 0.055;
/** Frames a stage pose must hold before evolving — stops flicker on transitions. */
const EVOLVE_FRAMES = 3;
const FIST_FRAMES = 4;
const CATCH_COOLDOWN_MS = 900;
/** Frames a summon pose must hold before it fires. */
const SUMMON_FRAMES = 5;
/** Don't let one held pose spray creatures. */
const SUMMON_COOLDOWN_MS = 900;

type Point = { x: number; y: number };
type Mode = "photo" | "video";

export default function WandStage() {
  const pathname = usePathname();
  const theme = themeFromPath(pathname);

  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  const gardenRef = useRef<Particle[]>([]);
  const artRef = useRef<ArtSet>({ images: [], families: [] });
  const ballRef = useRef<HTMLImageElement | null>(null);
  const ballOpenRef = useRef<HTMLImageElement | null>(null);
  /** Star art borrowed from the constellation wand, for the catch burst. */
  const starsRef = useRef<HTMLImageElement[]>([]);
  const catchesRef = useRef<Catch[]>([]);
  /** Ball resting in an open hand: where it is and when it appeared. */
  const heldRef = useRef<{ x: number; y: number; born: number } | null>(null);
  const stagePoseRef = useRef<{ n: number; frames: number }>({ n: 0, frames: 0 });
  const fistFramesRef = useRef(0);
  const lastCatchRef = useRef(0);
  const lastSummonRef = useRef(0);
  const litRef = useRef(0);
  const landmarkerRef = useRef<HandLandmarker | null>(null);
  const themeRef = useRef<Theme>(theme);
  const rafRef = useRef(0);
  const lastVideoTimeRef = useRef(-1);
  const lastPointsRef = useRef<(Point | null)[]>([null, null]);
  const smoothRef = useRef<(Point | null)[]>([null, null]);
  const tipRef = useRef<Point | null>(null);
  const dwellRef = useRef<{ at: Point; since: number; placed: boolean } | null>(null);
  const handsRef = useRef<Point[][]>([]);
  const openFramesRef = useRef(0);
  const lastBurstRef = useRef(0);
  const tracerRef = useRef(new ShapeTracer());
  const spanRef = useRef<number | null>(null);
  const lastThrowRef = useRef(0);
  const recorderRef = useRef(new Recorder());
  const skeletonRef = useRef(true);
  const fitRef = useRef<"cover" | "contain">("cover");

  const [running, setRunning] = useState(false);
  const [status, setStatus] = useState("");
  const [error, setError] = useState("");
  const [showSkeleton, setShowSkeleton] = useState(true);
  const [mode, setMode] = useState<Mode>("photo");
  const [recording, setRecording] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [flash, setFlash] = useState(false);
  const [toast, setToast] = useState("");
  const [dex, setDex] = useState<Dex>({});
  const [showDex, setShowDex] = useState(false);
  /** Every catchable species, built from the art once it's loaded. */
  const [catalog, setCatalog] = useState<Entry[]>([]);

  skeletonRef.current = showSkeleton;

  /** Normalized landmark -> mirrored, object-fit:cover screen coords. */
  const toScreen = useCallback((nx: number, ny: number): Point => {
    const video = videoRef.current!;
    const canvas = canvasRef.current!;
    const cw = canvas.clientWidth;
    const ch = canvas.clientHeight;
    const vw = video.videoWidth || cw;
    const vh = video.videoHeight || ch;

    const scale =
      fitRef.current === "contain"
        ? Math.min(cw / vw, ch / vh)
        : Math.max(cw / vw, ch / vh);
    const dw = vw * scale;
    const dh = vh * scale;

    return {
      x: (cw - dw) / 2 + (1 - nx) * dw, // 1 - nx mirrors to match the video
      y: (ch - dh) / 2 + ny * dh,
    };
  }, []);

  const openCamera = useCallback(async () => {
    const video = videoRef.current;
    if (!video) return;

    const old = video.srcObject as MediaStream | null;
    old?.getTracks().forEach((t) => t.stop());

    const stream = await navigator.mediaDevices.getUserMedia({
      video: {
        facingMode: "user",
        // Resolution hint only — NOT a shape. aspectRatio, or a width/height
        // pair, asks for a shape the sensor may not have, and gets satisfied
        // by cropping it (that was the phone zoom). A lone width just nudges
        // the camera toward its best native mode instead of its low-res default.
        width: { ideal: 1920 },
      },
      audio: false,
    });

    video.srcObject = stream;
    await video.play();
  }, []);

  const updateFit = useCallback(() => {
    const video = videoRef.current;
    const canvas = canvasRef.current;
    if (!video || !canvas || !video.videoWidth) return;

    const screenRatio = canvas.clientWidth / canvas.clientHeight;
    const videoRatio = video.videoWidth / video.videoHeight;
    const mismatch = Math.max(
      videoRatio / screenRatio,
      screenRatio / videoRatio
    );

    // Crop when the shapes are close (fills the screen, barely trims anything).
    // Letterbox when they're badly mismatched, rather than cropping 40%+ away.
    const fit = mismatch > 1.25 ? "contain" : "cover";
    fitRef.current = fit;
    video.style.objectFit = fit;
  }, []);

  const resizeCanvas = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = canvas.clientWidth * dpr;
    canvas.height = canvas.clientHeight * dpr;
    canvas.getContext("2d")?.setTransform(dpr, 0, 0, dpr, 0, 0);
  }, []);

  const loop = useCallback(() => {
    rafRef.current = requestAnimationFrame(loop);

    const video = videoRef.current;
    const canvas = canvasRef.current;
    const landmarker = landmarkerRef.current;
    if (!video || !canvas || !landmarker || video.readyState < 2) return;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const t = performance.now();
    const th = themeRef.current;

    if (video.currentTime !== lastVideoTimeRef.current) {
      lastVideoTimeRef.current = video.currentTime;
      const hands = landmarker.detectForVideo(video, t).landmarks ?? [];
      handsRef.current = hands.map((lm) => lm.map((p) => toScreen(p.x, p.y)));

      const anyOpen = hands.some(isOpenHand);
      openFramesRef.current = anyOpen ? openFramesRef.current + 1 : 0;
      const cooling = t - lastBurstRef.current < BURST_COOLDOWN_MS;

      if (th.summonMode === "summon") {
        // ---- Pokémon-style loop: summon by finger count, catch with a ball.
        const hand = hands[0];

        if (hand && isOpenHand(hand)) {
          // Ball rests in the open palm and tracks it.
          const at = toScreen(hand[9].x, hand[9].y);
          if (heldRef.current) {
            heldRef.current.x = at.x;
            heldRef.current.y = at.y;
          } else {
            heldRef.current = { x: at.x, y: at.y, born: t };
          }
        } else if (hand && isFist(hand) && heldRef.current) {
          // Fist closes over the ball — catch whatever it's covering.
          const { x, y } = heldRef.current;
          if (t - lastCatchRef.current > CATCH_COOLDOWN_MS) {
            const got = tryCatch(gardenRef.current, x, y);
            lastCatchRef.current = t;
            heldRef.current = null;
            if (got) {
              catchesRef.current.push(newCatch(x, y));
              const name = speciesName(got.familyName, got.stage);
              setDex((d) => addToDex(d, name));
              setToast(`caught ${name}!`);
            } else {
              setToast("so close…");
            }
          }
        } else if (hand && !isOpenHand(hand)) {
          // Holding up N fingers summons one at stage N.
          const n = extendedCount(hand);
          const pose = stagePoseRef.current;
          if (n === pose.n) pose.frames++;
          else {
            pose.n = n;
            pose.frames = 1;
          }
          if (
            n >= 1 &&
            n <= 3 &&
            pose.frames === SUMMON_FRAMES &&
            t - lastSummonRef.current > SUMMON_COOLDOWN_MS
          ) {
            const p = summon(
              gardenRef.current,
              n - 1,
              canvas.clientWidth,
              canvas.clientHeight,
              artRef.current.images,
              th,
              artRef.current.families
            );
            if (p) {
              lastSummonRef.current = t;
              setToast(n === 1 ? "a wild one appeared!" : `stage ${n}!`);
            }
          }
        }

        if (!hand) {
          heldRef.current = null;
          stagePoseRef.current = { n: 0, frames: 0 };
        }
      } else if (openFramesRef.current >= BURST_FRAMES && !cooling) {
        const open = hands.find(isOpenHand)!;
        const origin = toScreen(open[WRIST].x, open[WRIST].y);
        burst(gardenRef.current, origin.x, origin.y, th);
        lastBurstRef.current = t;
        lastPointsRef.current = [null, null];
        smoothRef.current = [null, null];
        dwellRef.current = null;
        tracerRef.current.clear();
        tipRef.current = null;
        litRef.current = 0; // next constellation starts unlit
      } else if (!anyOpen) {
        // --- fist: light the constellation
        // Stars are placed unlit. Holding a fist ramps the glow up over ~0.6s
        // and it stays lit; opening the hand releases them entirely.
        // Only light stars that are still planted — not ones mid-flight.
        // Otherwise a fist during the release re-lights the departing stars.
        if (th.litByFist && hands.some(isFist)) {
          const anyPlanted = gardenRef.current.some((p) => p.state === "planted");
          if (anyPlanted) {
            litRef.current = Math.min(1, litRef.current + 0.035);
          }
        }

        // Throw: hand growing quickly means it's moving toward the camera.
        if (th.chase > 0 && hands.length > 0) {
          const span = handSpan(hands[0]);
          const prev = spanRef.current;
          if (
            prev !== null &&
            (span - prev) / prev > THROW_RATE &&
            t - lastThrowRef.current > THROW_COOLDOWN_MS
          ) {
            const tip = toScreen(hands[0][INDEX_TIP].x, hands[0][INDEX_TIP].y);
            place(
              gardenRef.current,
              tip.x,
              tip.y,
              artRef.current.images,
              th,
              0.9,
              artRef.current.families
            );
            lastThrowRef.current = t;
          }
          spanRef.current = span;
        }

        hands.forEach((lm, i) => {
          if (i > 1) return;
          if (!isPointing(lm)) {
            lastPointsRef.current[i] = null;
            smoothRef.current[i] = null;
            if (i === 0) {
              dwellRef.current = null;
              tracerRef.current.clear();
              tipRef.current = null;
            }
            return;
          }

          const raw = toScreen(lm[INDEX_TIP].x, lm[INDEX_TIP].y);

          // follow < 1 makes the trail lag the fingertip (spells, creatures)
          const prev = smoothRef.current[i];
          const target: Point = prev
            ? {
                x: prev.x + (raw.x - prev.x) * th.follow,
                y: prev.y + (raw.y - prev.y) * th.follow,
              }
            : raw;
          smoothRef.current[i] = target;
          if (i === 0) tipRef.current = raw;

          // Spell shapes trace the raw tip, not the lagged one.
          if (th.key === "spells" && i === 0) {
            const tracer = tracerRef.current;
            tracer.push(raw);
            const shape = tracer.detect(t);
            if (shape === "circle") {
              const c = tracer.center() ?? raw;
              castRing(
                gardenRef.current,
                c.x,
                c.y,
                Math.max(70, tracer.radius()),
                artRef.current.images,
                th
              );
              setToast("✦ shield");
            } else if (shape === "zigzag") {
              castBolt(gardenRef.current, raw.x, raw.y, artRef.current.images, th);
              setToast("⚡ bolt");
            }
          }

          if (th.plantMode === "dwell") {
            if (i > 0) return; // one star at a time keeps the line readable
            const d = dwellRef.current;
            if (!d || Math.hypot(d.at.x - target.x, d.at.y - target.y) > DWELL_RADIUS) {
              dwellRef.current = { at: target, since: t, placed: false };
            } else if (!d.placed && t - d.since >= th.dwellMs) {
              place(gardenRef.current, target.x, target.y, artRef.current.images, th);
              d.placed = true;
            }
            return;
          }

          lastPointsRef.current[i] = plant(
            gardenRef.current,
            target.x,
            target.y,
            artRef.current.images,
            lastPointsRef.current[i],
            th,
            artRef.current.families
          );
        });

        for (let i = hands.length; i < 2; i++) {
          lastPointsRef.current[i] = null;
          smoothRef.current[i] = null;
        }
      }

      if (hands.length === 0) {
        spanRef.current = null;
        tipRef.current = null;
        fistFramesRef.current = 0;
        stagePoseRef.current = { n: 0, frames: 0 };
      }
    }

    ctx.clearRect(0, 0, canvas.clientWidth, canvas.clientHeight);
    step(gardenRef.current, ctx, t, th, tipRef.current, litRef.current);
    if (heldRef.current) {
      const held = heldRef.current;
      drawHeldBall(
        ctx,
        held.x,
        held.y,
        ballOpenRef.current ?? ballRef.current,
        th.accent,
        (t - held.born) / 220
      );
    }

    if (catchesRef.current.length > 0) {
      const d = frameDelta();
      catchesRef.current = catchesRef.current.filter((c) =>
        stepCatch(
          c,
          gardenRef.current,
          ctx,
          t,
          ballRef.current,
          th.accent,
          starsRef.current,
          d
        )
      );
    }

    if (skeletonRef.current) {
      ctx.lineWidth = 2;
      for (const pts of handsRef.current) {
        ctx.strokeStyle = "rgba(243, 239, 230, 0.45)";
        ctx.beginPath();
        for (const [a, b] of HAND_CONNECTIONS) {
          ctx.moveTo(pts[a].x, pts[a].y);
          ctx.lineTo(pts[b].x, pts[b].y);
        }
        ctx.stroke();

        for (let i = 0; i < pts.length; i++) {
          const isTip = i === INDEX_TIP;
          ctx.beginPath();
          ctx.arc(pts[i].x, pts[i].y, isTip ? 7 : 3, 0, Math.PI * 2);
          ctx.fillStyle = isTip
            ? themeRef.current.accent
            : "rgba(243, 239, 230, 0.8)";
          ctx.fill();
        }
      }
    }
  }, [toScreen]);

  useEffect(() => {
    if (!toast) return;
    const id = setTimeout(() => setToast(""), 1100);
    return () => clearTimeout(id);
  }, [toast]);

  useEffect(() => {
    if (!recording) return;
    const started = Date.now();
    const id = setInterval(
      () => setElapsed(Math.floor((Date.now() - started) / 1000)),
      250
    );
    return () => clearInterval(id);
  }, [recording]);

  /** Swap art when the route changes. Camera and model keep running. */
  useEffect(() => {
    themeRef.current = theme;
    if (!running) return;
    let cancelled = false;
    setStatus("Loading…");
    loadImages(theme.manifest)
      .then((imgs) => {
        if (cancelled) return;
        artRef.current = imgs;
        if (theme.summonMode === "summon") {
          setCatalog(buildCatalog(imgs.families));
        }
        gardenRef.current = [];
        catchesRef.current = [];
        heldRef.current = null;
        litRef.current = 0;
        lastPointsRef.current = [null, null];
        smoothRef.current = [null, null];
        dwellRef.current = null;
        tracerRef.current.clear();
        resetBag();
        setStatus("");
      })
      .catch(() => !cancelled && setStatus(""));
    return () => {
      cancelled = true;
    };
  }, [theme, running]);

  const start = useCallback(async () => {
    setError("");
    try {
      setStatus("Loading art…");
      artRef.current = await loadImages(themeRef.current.manifest);
      if (themeRef.current.summonMode === "summon") {
        setCatalog(buildCatalog(artRef.current.families));
      }

      // Both optional — a drawn fallback ball is used if either is missing.
      ballRef.current = await loadOne("/catch/ball.webp");
      ballOpenRef.current = await loadOne("/catch/ball-open.webp");

      // Reuse the constellation art for the catch sparkle.
      try {
        starsRef.current = (await loadImages("/art/stars/manifest.json")).images;
      } catch {
        starsRef.current = [];
      }
      setStatus("Loading hand tracking…");
      landmarkerRef.current = await createHandLandmarker();

      setStatus("Starting camera…");
      await openCamera();

      setRunning(true);
      setStatus("");
      resizeCanvas();
      updateFit();
      rafRef.current = requestAnimationFrame(loop);
    } catch (err) {
      setStatus("");
      setError(
        err instanceof Error && err.name === "NotAllowedError"
          ? "Camera permission denied. Allow access and try again."
          : err instanceof Error
            ? err.message
            : "Something went wrong."
      );
    }
  }, [loop, openCamera, resizeCanvas, updateFit]);

  /** Hide the skeleton for a capture, then restore it. */
  const withSkeletonHidden = useCallback(
    async <T,>(fn: () => Promise<T>): Promise<T> => {
      const was = skeletonRef.current;
      skeletonRef.current = false;
      await new Promise((r) =>
        requestAnimationFrame(() => requestAnimationFrame(r))
      );
      try {
        return await fn();
      } finally {
        skeletonRef.current = was;
      }
    },
    []
  );

  const takePhoto = useCallback(async () => {
    const video = videoRef.current;
    const canvas = canvasRef.current;
    if (!video || !canvas) return;

    setFlash(true);
    setTimeout(() => setFlash(false), 180);

    const blob = await withSkeletonHidden(() =>
      capturePhoto({ video, canvas, fit: fitRef.current })
    );
    if (blob) await saveOrShare(blob, `${themeRef.current.key}-wand.png`);
  }, [withSkeletonHidden]);

  const toggleRecording = useCallback(async () => {
    const video = videoRef.current;
    const canvas = canvasRef.current;
    if (!video || !canvas) return;

    if (recorderRef.current.active) {
      const result = await recorderRef.current.stop();
      setRecording(false);
      skeletonRef.current = showSkeleton;
      if (result) {
        await saveOrShare(
          result.blob,
          `${themeRef.current.key}-wand.${result.ext}`
        );
      }
    } else {
      skeletonRef.current = false; // keep the overlay out of the recording
      setElapsed(0);
      recorderRef.current.start({ video, canvas, fit: fitRef.current });
      setRecording(true);
    }
  }, [showSkeleton]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "s") setShowSkeleton((v) => !v);
    };
    let wasPortrait = window.innerHeight > window.innerWidth;

    const onResize = () => {
      resizeCanvas();
      const nowPortrait = window.innerHeight > window.innerWidth;
      if (nowPortrait !== wasPortrait && videoRef.current?.srcObject) {
        wasPortrait = nowPortrait;
        openCamera()
          .then(updateFit)
          .catch(() => updateFit());
      } else {
        updateFit();
      }
    };
    window.addEventListener("resize", onResize);
    window.addEventListener("orientationchange", onResize);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("resize", onResize);
      window.removeEventListener("orientationchange", onResize);
      window.removeEventListener("keydown", onKey);
      cancelAnimationFrame(rafRef.current);
      landmarkerRef.current?.close();
      const stream = videoRef.current?.srcObject as MediaStream | null;
      stream?.getTracks().forEach((t) => t.stop());
    };
  }, [openCamera, resizeCanvas, updateFit]);

  const mmss = `${String(Math.floor(elapsed / 60)).padStart(2, "0")}:${String(
    elapsed % 60
  ).padStart(2, "0")}`;

  return (
    <main className="stage" style={{ ["--accent" as string]: theme.accent }}>
      <video
        ref={videoRef}
        playsInline
        muted
        onLoadedMetadata={updateFit}
      />
      <canvas ref={canvasRef} />

      {flash && <div className="flash" aria-hidden />}

      {!running && (
        <div className="start">
          <div className="start-icon" aria-hidden>
            <svg viewBox="0 0 24 24" width="32" height="32">
              <path
                d="M12 1.5 L13.9 9.4 L21.5 12 L13.9 14.6 L12 22.5 L10.1 14.6 L2.5 12 L10.1 9.4 Z"
                fill="currentColor"
              />
              <circle cx="19.6" cy="4.8" r="1.5" fill="currentColor" />
              <circle cx="4.6" cy="18.8" r="1.1" fill="currentColor" />
            </svg>
          </div>
          <h1>Magical Wands</h1>
          <h4>Your current abilities:</h4> <p>Draw Flowers, Create Constellations, Spawn and Catch Pokemon!</p>
          <h4>Your upcoming abilities:</h4> <p>I'm trying to do something to do with Harry Potter...</p>
          <p>Created by Jessica Shen</p>
          {error && <p className="error">{error}</p>}
          <button className="primary" onClick={start} disabled={status !== ""}>
            {status || "Start camera"}
          </button>
          <p className="fineprint">
            Just added the capture and recording feature for y'all!
          </p>
        </div>
      )}

      {running && (
        <>
          <nav className="wands" aria-label="Choose a wand">
            {THEME_LIST.map((t) => (
              <Link
                key={t.key}
                href={t.path}
                className={t.key === theme.key ? "wand active" : "wand"}
                style={{ ["--wand-accent" as string]: t.accent }}
                aria-label={t.label}
                aria-current={t.key === theme.key ? "page" : undefined}
                title={t.label}
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={t.icon} alt="" />
              </Link>
            ))}
          </nav>

          {theme.summonMode === "summon" && (
            <button
              className="dex-badge"
              onClick={() => setShowDex(true)}
              aria-label="View your collection"
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src="/catch/ball.webp" alt="" />
              <span>{dexTotal(dex)}</span>
            </button>
          )}

          {showDex && (
            <div
              className="dex-sheet"
              role="dialog"
              aria-label="Your collection"
              onClick={() => setShowDex(false)}
            >
              <div className="dex-panel" onClick={(e) => e.stopPropagation()}>
                <header>
                  <h2>Your collection</h2>
                  <p>
                    {dexUnique(dex)} of {catalog.length} found ·{" "}
                    {dexTotal(dex)} caught
                  </p>
                </header>

                <ul className="dex-grid">
                  {catalog.map((entry, i) => {
                    const n = dex[entry.name] ?? 0;
                    return (
                      <li
                        key={entry.name}
                        className={n > 0 ? "dex-cell found" : "dex-cell"}
                      >
                        <div className="dex-art">
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img src={entry.src} alt="" />
                          {n > 1 && <span className="dex-x">×{n}</span>}
                        </div>
                        <span className="dex-num">{dexNumber(i)}</span>
                        <span className="dex-name">
                          {n > 0 ? entry.name : "???"}
                        </span>
                      </li>
                    );
                  })}
                </ul>

                <button
                  className="primary dex-close"
                  onClick={() => setShowDex(false)}
                >
                  Close
                </button>
              </div>
            </div>
          )}

          {recording && (
            <div className="rec">
              <span className="dot" /> {mmss}
            </div>
          )}

          {toast && <div className="toast">{toast}</div>}

          <div className="hud">{status || theme.hint}</div>

          <div className="camera-bar">
            <div className="modes" role="tablist" aria-label="Capture mode">
              <button
                role="tab"
                aria-selected={mode === "photo"}
                className={mode === "photo" ? "on" : ""}
                onClick={() => !recording && setMode("photo")}
                disabled={recording}
              >
                PHOTO
              </button>
              <button
                role="tab"
                aria-selected={mode === "video"}
                className={mode === "video" ? "on" : ""}
                onClick={() => !recording && setMode("video")}
                disabled={recording}
              >
                VIDEO
              </button>
            </div>

            <button
              className={`shutter ${mode} ${recording ? "recording" : ""}`}
              onClick={mode === "photo" ? takePhoto : toggleRecording}
              aria-label={
                mode === "photo"
                  ? "Take a photo"
                  : recording
                    ? "Stop recording"
                    : "Start recording"
              }
            >
              <span className="inner" />
            </button>
          </div>
        </>
      )}
    </main>
  );
}
