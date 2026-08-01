// Camera-based rep counting.
//
// Everything here runs on the device: the camera frames go into a local
// WebAssembly pose model and are thrown away immediately. Nothing is
// recorded, stored, or sent anywhere - there is no network call in this file.

const MP_BUNDLE = "../vendor/mediapipe/vision_bundle.mjs";
const WASM_BASE = "vendor/mediapipe/wasm";
const MODEL_PATH = "models/pose_landmarker_lite.task";

// MediaPipe BlazePose landmark indices we care about.
const L = {
  nose: 0,
  shoulderL: 11,
  shoulderR: 12,
  elbowL: 13,
  elbowR: 14,
  wristL: 15,
  wristR: 16,
  hipL: 23,
  hipR: 24,
  kneeL: 25,
  kneeR: 26,
  ankleL: 27,
  ankleR: 28,
};

// Bones drawn in the on-screen skeleton overlay.
const BONES = [
  [11, 12], [11, 23], [12, 24], [23, 24],
  [11, 13], [13, 15], [12, 14], [14, 16],
  [23, 25], [25, 27], [24, 26], [26, 28],
];

const MIN_VISIBILITY = 0.6;

function angleAt(a, b, c) {
  // Angle at vertex b, in degrees, for the path a-b-c.
  const abx = a.x - b.x, aby = a.y - b.y;
  const cbx = c.x - b.x, cby = c.y - b.y;
  const dot = abx * cbx + aby * cby;
  const magA = Math.hypot(abx, aby);
  const magC = Math.hypot(cbx, cby);
  if (magA === 0 || magC === 0) return null;
  const cos = Math.min(1, Math.max(-1, dot / (magA * magC)));
  return (Math.acos(cos) * 180) / Math.PI;
}

function visible(lm, ...idxs) {
  return idxs.every((i) => lm[i] && (lm[i].visibility ?? 1) >= MIN_VISIBILITY);
}

// Picks whichever side of the body the camera can see best, so it still
// counts when you're standing at an angle.
function bestSide(lm, leftIdxs, rightIdxs) {
  const score = (idxs) =>
    idxs.reduce((s, i) => s + (lm[i] ? (lm[i].visibility ?? 1) : 0), 0) / idxs.length;
  const ls = score(leftIdxs);
  const rs = score(rightIdxs);
  if (Math.max(ls, rs) < MIN_VISIBILITY) return null;
  return ls >= rs ? leftIdxs : rightIdxs;
}

/**
 * Rep counters are two-threshold state machines. A rep is only counted on the
 * full return trip (down -> up), and the two thresholds are deliberately far
 * apart so camera jitter around a single value can't double-count.
 *
 * Each returns { rep: bool, hint: string|null, depth: 0..1, ready: bool }.
 */

function makeSquatCounter() {
  let state = "up";
  let minAngle = 180;
  return function step(lm) {
    const side = bestSide(lm, [L.hipL, L.kneeL, L.ankleL], [L.hipR, L.kneeR, L.ankleR]);
    if (!side) return { rep: false, hint: "עמוד כך שכל הגוף נכנס למסך", depth: 0, ready: false };
    const ang = angleAt(lm[side[0]], lm[side[1]], lm[side[2]]);
    if (ang === null) return { rep: false, hint: null, depth: 0, ready: false };

    // 170 deg = standing straight, 90 = thighs parallel.
    const depth = Math.min(1, Math.max(0, (170 - ang) / 80));

    if (state === "up") {
      if (ang < minAngle) minAngle = ang;
      if (ang < 100) state = "down";
    } else if (ang > 155) {
      state = "up";
      minAngle = 180;
      return { rep: true, hint: null, depth, ready: true };
    }

    let hint = null;
    if (state === "up" && minAngle < 140 && minAngle > 100 && ang > 155) {
      hint = "כמעט! נסה לרדת קצת יותר עמוק";
      minAngle = 180;
    }
    return { rep: false, hint, depth, ready: true };
  };
}

function makePushupCounter() {
  let state = "up";
  let minAngle = 180;
  return function step(lm) {
    const side = bestSide(
      lm,
      [L.shoulderL, L.elbowL, L.wristL],
      [L.shoulderR, L.elbowR, L.wristR]
    );
    if (!side) return { rep: false, hint: "כוון את המצלמה מהצד כדי לראות את הידיים", depth: 0, ready: false };
    const ang = angleAt(lm[side[0]], lm[side[1]], lm[side[2]]);
    if (ang === null) return { rep: false, hint: null, depth: 0, ready: false };

    const depth = Math.min(1, Math.max(0, (165 - ang) / 75));

    if (state === "up") {
      if (ang < minAngle) minAngle = ang;
      if (ang < 100) state = "down";
    } else if (ang > 150) {
      state = "up";
      minAngle = 180;
      return { rep: true, hint: null, depth, ready: true };
    }

    let hint = null;
    if (state === "up" && minAngle < 135 && minAngle > 100 && ang > 150) {
      hint = "כמעט! כופף את המרפקים קצת יותר";
      minAngle = 180;
    }
    return { rep: false, hint, depth, ready: true };
  };
}

function makeJackCounter() {
  let state = "closed";
  return function step(lm) {
    if (!visible(lm, L.shoulderL, L.shoulderR, L.wristL, L.wristR, L.ankleL, L.ankleR)) {
      return { rep: false, hint: "התרחק מהמצלמה עד שכל הגוף נראה", depth: 0, ready: false };
    }
    const shoulderY = (lm[L.shoulderL].y + lm[L.shoulderR].y) / 2;
    const wristY = (lm[L.wristL].y + lm[L.wristR].y) / 2;
    const shoulderSpan = Math.abs(lm[L.shoulderL].x - lm[L.shoulderR].x) || 0.001;
    const ankleSpan = Math.abs(lm[L.ankleL].x - lm[L.ankleR].x);

    // y grows downward, so wrists above shoulders means a smaller y.
    const armsUp = wristY < shoulderY;
    const legsApart = ankleSpan > shoulderSpan * 1.3;
    const armsDown = wristY > shoulderY + shoulderSpan * 0.4;
    const legsTogether = ankleSpan < shoulderSpan * 0.9;

    const depth = Math.min(1, Math.max(0, (shoulderY - wristY) / (shoulderSpan || 1)));

    if (state === "closed" && armsUp && legsApart) {
      state = "open";
    } else if (state === "open" && armsDown && legsTogether) {
      state = "closed";
      return { rep: true, hint: null, depth, ready: true };
    }
    return { rep: false, hint: null, depth, ready: true };
  };
}

/**
 * Wall-sit hold detector. Not a counter - it reports whether the person is
 * currently in the "held" position (knee bent ~90 deg). The caller ticks a
 * timer only while holding is true, so no seconds are earned by cheating.
 * Returns { holding: bool, hint: string|null, angle: number|null, ready: bool }.
 */
function makeWallSitHold() {
  return function step(lm) {
    const side = bestSide(lm, [L.hipL, L.kneeL, L.ankleL], [L.hipR, L.kneeR, L.ankleR]);
    if (!side) return { holding: false, hint: "עמוד כך שכל הגוף נכנס למסך", angle: null, ready: false };
    const ang = angleAt(lm[side[0]], lm[side[1]], lm[side[2]]);
    if (ang === null) return { holding: false, hint: null, angle: null, ready: false };
    // Accept 70-115 deg as "wall sit" - roughly a right angle at the knees.
    const holding = ang >= 70 && ang <= 115;
    let hint = null;
    if (!holding) {
      if (ang > 115) hint = "רד יותר, שהברכיים יהיו בזווית 90 מעלות";
      else if (ang < 70) hint = "אתה נמוך מדי, עלה מעט";
    }
    return { holding, hint, angle: ang, ready: true };
  };
}

export const COUNTERS = {
  squat: makeSquatCounter,
  pushup: makePushupCounter,
  jack: makeJackCounter,
};

export const HOLDS = {
  wallsit: makeWallSitHold,
};

let landmarkerPromise = null;

async function getLandmarker() {
  if (!landmarkerPromise) {
    landmarkerPromise = (async () => {
      const { FilesetResolver, PoseLandmarker } = await import(MP_BUNDLE);
      const fileset = await FilesetResolver.forVisionTasks(WASM_BASE);
      const build = (delegate) =>
        PoseLandmarker.createFromOptions(fileset, {
          baseOptions: { modelAssetPath: MODEL_PATH, delegate },
          runningMode: "VIDEO",
          numPoses: 1,
        });
      try {
        return await build("GPU");
      } catch (err) {
        // Some browsers and older phones can't hand the model to the GPU.
        // CPU is slower but works everywhere.
        return build("CPU");
      }
    })().catch((err) => {
      landmarkerPromise = null;
      throw err;
    });
  }
  return landmarkerPromise;
}

/**
 * Runs a camera rep-counting session.
 *
 * onUpdate({ count, hint, depth, ready }) fires on every processed frame;
 * onDone() fires once the target rep count is reached.
 * Returns a stop() function - always call it to release the camera.
 */
export async function startRepSession({
  video,
  canvas,
  exercise,
  target,
  onUpdate,
  onDone,
  onError,
}) {
  let stream = null;
  let rafId = null;
  let stopped = false;
  let count = 0;
  let lastVideoTime = -1;
  const step = (COUNTERS[exercise] || makeSquatCounter)();

  function stop() {
    stopped = true;
    if (rafId) cancelAnimationFrame(rafId);
    if (stream) stream.getTracks().forEach((t) => t.stop());
    stream = null;
  }

  try {
    stream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: "user", width: { ideal: 640 }, height: { ideal: 480 } },
      audio: false,
    });
  } catch (err) {
    onError && onError("camera", err);
    return stop;
  }

  if (stopped) {
    stream.getTracks().forEach((t) => t.stop());
    return stop;
  }

  video.srcObject = stream;
  video.setAttribute("playsinline", "");
  video.muted = true;
  try {
    await video.play();
  } catch (err) {
    onError && onError("play", err);
    stop();
    return stop;
  }

  let landmarker;
  try {
    landmarker = await getLandmarker();
  } catch (err) {
    onError && onError("model", err);
    stop();
    return stop;
  }

  if (stopped) return stop;

  const ctx = canvas.getContext("2d");

  function drawSkeleton(lm) {
    const w = canvas.width;
    const h = canvas.height;
    ctx.clearRect(0, 0, w, h);
    ctx.lineWidth = Math.max(2, w * 0.006);
    ctx.strokeStyle = "#38E1D0";
    ctx.fillStyle = "#38E1D0";
    ctx.lineCap = "round";

    for (const [a, b] of BONES) {
      const pa = lm[a];
      const pb = lm[b];
      if (!pa || !pb) continue;
      if ((pa.visibility ?? 1) < MIN_VISIBILITY || (pb.visibility ?? 1) < MIN_VISIBILITY) continue;
      ctx.beginPath();
      ctx.moveTo(pa.x * w, pa.y * h);
      ctx.lineTo(pb.x * w, pb.y * h);
      ctx.stroke();
    }
    const dotR = Math.max(3, w * 0.009);
    for (const i of Object.values(L)) {
      const p = lm[i];
      if (!p || (p.visibility ?? 1) < MIN_VISIBILITY) continue;
      ctx.beginPath();
      ctx.arc(p.x * w, p.y * h, dotR, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  function frame() {
    if (stopped) return;
    rafId = requestAnimationFrame(frame);

    if (video.readyState < 2) return;
    if (canvas.width !== video.videoWidth && video.videoWidth) {
      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;
    }
    if (video.currentTime === lastVideoTime) return;
    lastVideoTime = video.currentTime;

    let result;
    try {
      result = landmarker.detectForVideo(video, performance.now());
    } catch (err) {
      return;
    }

    const lm = result && result.landmarks && result.landmarks[0];
    if (!lm) {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      onUpdate && onUpdate({ count, hint: "לא רואה אותך - התרחק קצת מהמצלמה", depth: 0, ready: false });
      return;
    }

    drawSkeleton(lm);
    const out = step(lm);
    if (out.rep) {
      count += 1;
      if (count >= target) {
        onUpdate && onUpdate({ count, hint: null, depth: out.depth, ready: true });
        stop();
        onDone && onDone(count);
        return;
      }
    }
    onUpdate && onUpdate({ count, hint: out.hint, depth: out.depth, ready: out.ready });
  }

  rafId = requestAnimationFrame(frame);
  return stop;
}

/**
 * Runs a camera-verified HOLD session (wall sit).
 * The timer only advances while the pose is actually held.
 *
 * onUpdate({ elapsed, target, holding, hint }) fires every frame.
 * onDone() fires once elapsed >= target.
 */
export async function startHoldSession({
  video,
  canvas,
  hold,
  target, // seconds of held-time required
  onUpdate,
  onDone,
  onError,
}) {
  let stream = null;
  let rafId = null;
  let stopped = false;
  let elapsedMs = 0;
  let lastTick = null;
  let lastVideoTime = -1;
  const step = (HOLDS[hold] || makeWallSitHold)();

  function stop() {
    stopped = true;
    if (rafId) cancelAnimationFrame(rafId);
    if (stream) stream.getTracks().forEach((t) => t.stop());
    stream = null;
  }

  try {
    stream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: "user", width: { ideal: 640 }, height: { ideal: 480 } },
      audio: false,
    });
  } catch (err) {
    onError && onError("camera", err);
    return stop;
  }
  if (stopped) { stream.getTracks().forEach((t) => t.stop()); return stop; }

  video.srcObject = stream;
  video.setAttribute("playsinline", "");
  video.muted = true;
  try { await video.play(); } catch (err) { onError && onError("play", err); stop(); return stop; }

  let landmarker;
  try { landmarker = await getLandmarker(); }
  catch (err) { onError && onError("model", err); stop(); return stop; }
  if (stopped) return stop;

  const ctx = canvas.getContext("2d");

  function drawSkeleton(lm) {
    const w = canvas.width, h = canvas.height;
    ctx.clearRect(0, 0, w, h);
    ctx.lineWidth = Math.max(2, w * 0.006);
    ctx.strokeStyle = "#38E1D0";
    ctx.fillStyle = "#38E1D0";
    ctx.lineCap = "round";
    for (const [a, b] of BONES) {
      const pa = lm[a], pb = lm[b];
      if (!pa || !pb) continue;
      if ((pa.visibility ?? 1) < MIN_VISIBILITY || (pb.visibility ?? 1) < MIN_VISIBILITY) continue;
      ctx.beginPath();
      ctx.moveTo(pa.x * w, pa.y * h);
      ctx.lineTo(pb.x * w, pb.y * h);
      ctx.stroke();
    }
    const dotR = Math.max(3, w * 0.009);
    for (const i of Object.values(L)) {
      const p = lm[i];
      if (!p || (p.visibility ?? 1) < MIN_VISIBILITY) continue;
      ctx.beginPath();
      ctx.arc(p.x * w, p.y * h, dotR, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  function frame() {
    if (stopped) return;
    rafId = requestAnimationFrame(frame);
    if (video.readyState < 2) return;
    if (canvas.width !== video.videoWidth && video.videoWidth) {
      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;
    }
    if (video.currentTime === lastVideoTime) return;
    lastVideoTime = video.currentTime;

    let result;
    try { result = landmarker.detectForVideo(video, performance.now()); }
    catch (err) { return; }

    const lm = result && result.landmarks && result.landmarks[0];
    const now = performance.now();
    if (!lm) {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      lastTick = now;
      onUpdate && onUpdate({ elapsed: elapsedMs / 1000, target, holding: false, hint: "לא רואה אותך" });
      return;
    }
    drawSkeleton(lm);
    const out = step(lm);
    if (lastTick !== null && out.holding) elapsedMs += now - lastTick;
    lastTick = now;
    onUpdate && onUpdate({ elapsed: elapsedMs / 1000, target, holding: out.holding, hint: out.hint });
    if (elapsedMs / 1000 >= target) {
      stop();
      onDone && onDone();
    }
  }
  rafId = requestAnimationFrame(frame);
  return stop;
}
