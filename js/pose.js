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
 * Checks whether the camera can actually see enough of you to judge a rep,
 * and says exactly what's wrong when it can't. This runs before any exercise
 * logic, because "it isn't counting" is almost always a framing problem, not
 * a technique problem - and the person needs to be told which.
 *
 * Orientation-agnostic: it measures the body's largest extent, so it works
 * whether you're standing (tall) or lying down for push-ups (wide).
 */
function framingHint(lm) {
  const key = [
    L.shoulderL, L.shoulderR, L.hipL, L.hipR,
    L.kneeL, L.kneeR, L.ankleL, L.ankleR,
  ];
  const seen = key.filter((i) => lm[i] && (lm[i].visibility ?? 1) >= 0.5);
  if (seen.length < 3) return "לא רואה אותך טוב - כוון את המצלמה לגוף";

  const xs = seen.map((i) => lm[i].x);
  const ys = seen.map((i) => lm[i].y);
  const span = Math.max(
    Math.max(...ys) - Math.min(...ys),
    Math.max(...xs) - Math.min(...xs)
  );

  // Size only, measured across the whole body so it stays stable through a
  // rep - the joints an exercise measures naturally close up at the bottom of
  // the movement, which is not the same thing as walking away from the phone.
  //
  // Deliberately no "off the edge" checks. Doing push-ups with the phone on
  // the floor puts your hands and feet past the frame edge almost every time,
  // and an earlier version read that as "you left the frame" and blocked the
  // exercise outright. What stops cheating is the per-exercise joint
  // requirement below, not a bounding box.
  if (span < 0.25) return "אתה רחוק מדי - התקרב קצת";
  return null;
}

/**
 * The joints each exercise genuinely needs before a rep can mean anything.
 * `chain` is the measured triple (either side will do); `also` lists groups
 * where at least one member must be visible.
 *
 * The `also` entries are what stop a face-filling selfie from registering
 * reps: a push-up requires a hip in shot, a squat requires a shoulder. If the
 * camera can only see your head, it now refuses to count instead of guessing.
 */
const NEEDS = {
  squat:     { chain: [[L.hipL, L.kneeL, L.ankleL], [L.hipR, L.kneeR, L.ankleR]], also: [[L.shoulderL, L.shoulderR]] },
  squatjump: { chain: [[L.hipL, L.kneeL, L.ankleL], [L.hipR, L.kneeR, L.ankleR]], also: [[L.shoulderL, L.shoulderR]] },
  lunge:     { chain: [[L.hipL, L.kneeL, L.ankleL], [L.hipR, L.kneeR, L.ankleR]], also: [[L.shoulderL, L.shoulderR]] },
  wallsit:   { chain: [[L.hipL, L.kneeL, L.ankleL], [L.hipR, L.kneeR, L.ankleR]], also: [[L.shoulderL, L.shoulderR]] },
  // Push-ups demand both arms end to end - shoulder, elbow AND wrist on each
  // side - so half-visible arms can't be passed off as a rep.
  pushup: {
    chain: [[L.shoulderL, L.elbowL, L.wristL], [L.shoulderR, L.elbowR, L.wristR]],
    also: [[L.hipL, L.hipR]],
    requireAll: [
      [L.shoulderL, L.shoulderR],
      [L.elbowL, L.elbowR],
      [L.wristL, L.wristR],
    ],
  },
  dip: {
    chain: [[L.shoulderL, L.elbowL, L.wristL], [L.shoulderR, L.elbowR, L.wristR]],
    also: [[L.hipL, L.hipR]],
    requireAll: [[L.elbowL, L.elbowR], [L.wristL, L.wristR]],
  },
  situp:     { chain: [[L.shoulderL, L.hipL, L.kneeL], [L.shoulderR, L.hipR, L.kneeR]], also: [] },
  bridge:    { chain: [[L.shoulderL, L.hipL, L.kneeL], [L.shoulderR, L.hipR, L.kneeR]], also: [] },
  jack:      { chain: [[L.shoulderL, L.wristL, L.ankleL], [L.shoulderR, L.wristR, L.ankleR]], also: [[L.hipL, L.hipR]] },
  highknee:  { chain: [[L.hipL, L.kneeL, L.ankleL], [L.hipR, L.kneeR, L.ankleR]], also: [[L.shoulderL, L.shoulderR]] },
};

const PART_NAME = {
  [L.shoulderL]: "כתפיים", [L.shoulderR]: "כתפיים",
  [L.elbowL]: "מרפקים", [L.elbowR]: "מרפקים",
  [L.wristL]: "כפות ידיים", [L.wristR]: "כפות ידיים",
  [L.hipL]: "אגן", [L.hipR]: "אגן",
  [L.kneeL]: "ברכיים", [L.kneeR]: "ברכיים",
  [L.ankleL]: "קרסוליים", [L.ankleR]: "קרסוליים",
};

// Midpoint of a pair, using whichever side the camera can actually see.
function midOf(lm, a, b) {
  const va = lm[a] && (lm[a].visibility ?? 1) >= MIN_VISIBILITY;
  const vb = lm[b] && (lm[b].visibility ?? 1) >= MIN_VISIBILITY;
  if (va && vb) return { x: (lm[a].x + lm[b].x) / 2, y: (lm[a].y + lm[b].y) / 2 };
  if (va) return { x: lm[a].x, y: lm[a].y };
  if (vb) return { x: lm[b].x, y: lm[b].y };
  return null;
}

/**
 * Posture rules: is your body actually arranged the way this exercise
 * requires, before we look at any joint angle?
 *
 * This is what stops "bend your elbows while sitting on the sofa" from
 * reading as a push-up. The angle at the elbow is identical either way -
 * what differs is that a real push-up has your torso horizontal.
 */
const POSTURE = {
  pushup: (lm) => {
    const sh = midOf(lm, L.shoulderL, L.shoulderR);
    const hip = midOf(lm, L.hipL, L.hipR);
    if (!sh || !hip) return null;
    // Seen from the side, a plank separates shoulders and hips horizontally.
    if (Math.abs(sh.x - hip.x) <= Math.abs(sh.y - hip.y)) {
      return "שכב לפלאנק - הגוף צריך להיות אופקי מול המצלמה";
    }
    return null;
  },
  dip: (lm) => {
    const sh = midOf(lm, L.shoulderL, L.shoulderR);
    const hip = midOf(lm, L.hipL, L.hipR);
    if (!sh || !hip) return null;
    // Dips are upright: shoulders above hips.
    if (sh.y > hip.y - 0.05) return "שב זקוף - הכתפיים מעל האגן";
    return null;
  },
  squat: (lm) => {
    const sh = midOf(lm, L.shoulderL, L.shoulderR);
    const hip = midOf(lm, L.hipL, L.hipR);
    if (!sh || !hip) return null;
    if (sh.y > hip.y) return "עמוד זקוף מול המצלמה";
    return null;
  },
};
POSTURE.squatjump = POSTURE.squat;
POSTURE.lunge = POSTURE.squat;
POSTURE.wallsit = POSTURE.squat;

/**
 * Decides whether this frame is good enough to judge a rep at all, and if
 * not, says which body part is missing. This is a hard gate, not advice.
 */
function readiness(lm, exercise) {
  const need = NEEDS[exercise];
  if (!need) return { ok: true, hint: null };

  const seen = (i) => lm[i] && (lm[i].visibility ?? 1) >= MIN_VISIBILITY;

  // Some exercises need BOTH limbs fully in shot, not just the better side -
  // you can't judge push-up form from one arm.
  if (need.requireAll) {
    for (const group of need.requireAll) {
      const missing = group.find((i) => !seen(i));
      if (missing !== undefined) {
        return { ok: false, hint: `חייב לראות את שתי ה${PART_NAME[missing] || "גפיים"} במלואן` };
      }
    }
  }

  // The measured triple has to be fully visible on one side of the body.
  const chain = need.chain.find((trio) => trio.every(seen));
  if (!chain) {
    const missing = need.chain[0].find((i) => !seen(i));
    return { ok: false, hint: `לא רואה את ה${PART_NAME[missing] || "גוף"} - הזז את הטלפון` };
  }
  // Plus the anchors that prove this is a body and not a face close-up.
  for (const group of need.also) {
    if (!group.some(seen)) {
      return { ok: false, hint: `צריך לראות גם את ה${PART_NAME[group[0]] || "גוף"} - התרחק מהטלפון` };
    }
  }
  // Size sanity: are you close enough to measure reliably?
  const frame = framingHint(lm);
  if (frame) return { ok: false, hint: frame };

  // Finally, is the body actually in this exercise's posture?
  const posture = POSTURE[exercise];
  if (posture) {
    const bad = posture(lm);
    if (bad) return { ok: false, hint: bad };
  }

  return { ok: true, hint: null };
}

/**
 * Wraps a counter so it can never advance on a frame the camera can't judge.
 * The inner state machine isn't even called while blocked, so its position is
 * frozen rather than corrupted, and picks up where it left off.
 */
function guarded(exercise, inner) {
  return function step(lm) {
    const gate = readiness(lm, exercise);
    if (!gate.ok) return { rep: false, hint: gate.hint, depth: 0, ready: false };
    return inner(lm);
  };
}

/**
 * Rep counters are two-threshold state machines. A rep is only counted on the
 * full return trip (down -> up), and the two thresholds are deliberately far
 * apart so camera jitter around a single value can't double-count.
 *
 * Each returns { rep: bool, hint: string|null, depth: 0..1, ready: bool }.
 * `hint` is produced on EVERY frame, not just on rep events, so the screen
 * is always telling you what to fix rather than going silent.
 */

function makeSquatCounter() {
  let state = "up";
  let minAngle = 180;
  let shallowMsg = 0; // frames left to keep showing the "not deep enough" note
  return function step(lm) {
    const side = bestSide(lm, [L.hipL, L.kneeL, L.ankleL], [L.hipR, L.kneeR, L.ankleR]);
    if (!side) {
      return { rep: false, hint: "עמוד מהצד כדי שאראה את הברכיים", depth: 0, ready: false };
    }
    const ang = angleAt(lm[side[0]], lm[side[1]], lm[side[2]]);
    if (ang === null) return { rep: false, hint: null, depth: 0, ready: false };

    // 170 deg = standing straight, 90 = thighs parallel.
    const depth = Math.min(1, Math.max(0, (170 - ang) / 80));

    let rep = false;
    if (state === "up") {
      if (ang < minAngle) minAngle = ang;
      if (ang < 100) state = "down";
      else if (ang > 155 && minAngle < 145 && minAngle > 100) {
        // Came back up without ever getting deep enough.
        shallowMsg = 60;
        minAngle = 180;
      }
    } else if (ang > 155) {
      state = "up";
      minAngle = 180;
      rep = true;
    }

    // Framing problems always win - no point coaching depth if half of you
    // isn't on screen.
    let hint = null;
    if (!hint) {
      if (shallowMsg > 0) {
        shallowMsg--;
        hint = "לא ירדת מספיק - רד עד שהברכיים ב-90 מעלות";
      } else if (state === "down") {
        hint = "יופי, עכשיו תעלה עד סוף";
      } else if (ang < 150) {
        hint = "עוד קצת למטה";
      }
    }
    return { rep, hint, depth, ready: true };
  };
}

// Minimum vertical travel of the shoulders during a push-up, as a fraction of
// the frame. Bending your elbows without lowering your chest produces the same
// elbow angle as a real rep, so the body has to actually move.
const PUSHUP_MIN_TRAVEL = 0.035;

function makePushupCounter() {
  let state = "up";
  let minAngle = 180;
  let shallowMsg = 0;
  let noTravelMsg = 0;
  let topY = null;   // shoulder height at the top of this rep
  let lowY = null;   // lowest the shoulders reached during the descent
  return function step(lm) {
    const side = bestSide(
      lm,
      [L.shoulderL, L.elbowL, L.wristL],
      [L.shoulderR, L.elbowR, L.wristR]
    );
    if (!side) {
      return { rep: false, hint: "הנח את הטלפון בצד כדי שאראה את הידיים", depth: 0, ready: false };
    }
    const ang = angleAt(lm[side[0]], lm[side[1]], lm[side[2]]);
    if (ang === null) return { rep: false, hint: null, depth: 0, ready: false };

    const sh = midOf(lm, L.shoulderL, L.shoulderR);
    const shY = sh ? sh.y : null;
    const depth = Math.min(1, Math.max(0, (165 - ang) / 75));

    let rep = false;
    if (state === "up") {
      if (shY !== null && (topY === null || shY < topY)) topY = shY;
      if (ang < minAngle) minAngle = ang;
      if (ang < 100) {
        state = "down";
        lowY = shY;
      } else if (ang > 150 && minAngle < 140 && minAngle > 100) {
        shallowMsg = 60;
        minAngle = 180;
      }
    } else {
      if (shY !== null && (lowY === null || shY > lowY)) lowY = shY;
      if (ang > 150) {
        // The elbows straightened - but did the chest actually travel?
        const travel = topY !== null && lowY !== null ? lowY - topY : 0;
        if (travel >= PUSHUP_MIN_TRAVEL) rep = true;
        else noTravelMsg = 75;
        state = "up";
        minAngle = 180;
        topY = shY;
        lowY = null;
      }
    }

    let hint = null;
    if (noTravelMsg > 0) {
      noTravelMsg--;
      hint = "הגוף לא ירד - תוריד את החזה לרצפה";
    } else if (shallowMsg > 0) {
      shallowMsg--;
      hint = "לא ירדת מספיק - כופף את המרפקים עד 90";
    } else if (state === "down") {
      hint = "יופי, עכשיו דחוף למעלה";
    } else if (ang < 145) {
      hint = "עוד קצת למטה";
    }
    return { rep, hint, depth, ready: true };
  };
}

function makeJackCounter() {
  let state = "closed";
  return function step(lm) {
    // Jacks are the one exercise that genuinely needs both sides at once.
    if (!visible(lm, L.shoulderL, L.shoulderR, L.wristL, L.wristR, L.ankleL, L.ankleR)) {
      return { rep: false, hint: "התרחק עד שכל הגוף נראה", depth: 0, ready: false };
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
    if (!side) {
      return { holding: false, hint: "עמוד מהצד כדי שאראה את הברכיים", angle: null, ready: false };
    }
    const ang = angleAt(lm[side[0]], lm[side[1]], lm[side[2]]);
    if (ang === null) return { holding: false, hint: null, angle: null, ready: false };
    // Accept 70-115 deg as "wall sit" - roughly a right angle at the knees.
    // Framing problems block the hold, otherwise you could bank seconds while
    // half out of shot.
    const holding = ang >= 70 && ang <= 115;
    let hint = null;
    if (!hint) {
      if (ang > 115) hint = "רד יותר - הברכיים ב-90 מעלות";
      else if (ang < 70) hint = "אתה נמוך מדי, עלה מעט";
    }
    return { holding, hint, angle: ang, ready: true };
  };
}

// Lunges - one leg goes forward and knee dips. The pattern at the knee is
// the same big-angle-change as a squat, so we reuse that state machine but
// pick only ONE side to count so alternating legs doesn't double-count.
function makeLungeCounter() {
  let state = "up";
  let side = null;
  return function step(lm) {
    if (!side) side = bestSide(lm, [L.hipL, L.kneeL, L.ankleL], [L.hipR, L.kneeR, L.ankleR]);
    if (!side) return { rep: false, hint: "עמוד כך שכל הגוף נכנס למסך", depth: 0, ready: false };
    const ang = angleAt(lm[side[0]], lm[side[1]], lm[side[2]]);
    if (ang === null) return { rep: false, hint: null, depth: 0, ready: false };
    const depth = Math.min(1, Math.max(0, (170 - ang) / 80));
    if (state === "up" && ang < 105) state = "down";
    else if (state === "down" && ang > 155) {
      state = "up";
      return { rep: true, hint: null, depth, ready: true };
    }
    return { rep: false, hint: null, depth, ready: true };
  };
}

// High knees - one knee raises above hip height, then the other. Track the
// higher knee (smaller y = higher on screen) and count alternations.
function makeHighKneeCounter() {
  let lastSide = null; // "L" or "R" - which leg was up last
  return function step(lm) {
    if (!visible(lm, L.hipL, L.hipR, L.kneeL, L.kneeR)) {
      return { rep: false, hint: "עמוד כך שהחזה והברכיים במסך", depth: 0, ready: false };
    }
    const hipY = (lm[L.hipL].y + lm[L.hipR].y) / 2;
    const kneeLY = lm[L.kneeL].y;
    const kneeRY = lm[L.kneeR].y;
    // A knee is "raised" when it's clearly above hip level (smaller y).
    const leftUp = hipY - kneeLY > 0.05;
    const rightUp = hipY - kneeRY > 0.05;

    // Depth: how high the higher knee is above hip, normalized loosely.
    const depth = Math.min(1, Math.max(0, Math.max(hipY - kneeLY, hipY - kneeRY) / 0.2));

    if (leftUp && !rightUp && lastSide !== "L") {
      lastSide = "L";
      return { rep: true, hint: null, depth, ready: true };
    }
    if (rightUp && !leftUp && lastSide !== "R") {
      lastSide = "R";
      return { rep: true, hint: null, depth, ready: true };
    }
    return { rep: false, hint: null, depth, ready: true };
  };
}

// Sit-ups - lying on your back, the torso folds up. Measured at the hip
// (shoulder-hip-knee): ~150 deg lying flat, ~75 deg sitting up.
function makeSitupCounter() {
  let state = "down";
  let shallowMsg = 0;
  let minAngle = 180;
  return function step(lm) {
    const side = bestSide(lm, [L.shoulderL, L.hipL, L.kneeL], [L.shoulderR, L.hipR, L.kneeR]);
    if (!side) {
      return { rep: false, hint: "שכב עם הצד למצלמה", depth: 0, ready: false };
    }
    const ang = angleAt(lm[side[0]], lm[side[1]], lm[side[2]]);
    if (ang === null) return { rep: false, hint: null, depth: 0, ready: false };

    const depth = Math.min(1, Math.max(0, (150 - ang) / 70));

    let rep = false;
    if (state === "down") {
      if (ang < minAngle) minAngle = ang;
      if (ang < 85) state = "up";
      else if (ang > 135 && minAngle < 115 && minAngle > 85) {
        shallowMsg = 60;
        minAngle = 180;
      }
    } else if (ang > 135) {
      state = "down";
      minAngle = 180;
      rep = true;
    }

    let hint = null;
    if (!hint) {
      if (shallowMsg > 0) {
        shallowMsg--;
        hint = "לא עלית מספיק - תתקרב יותר לברכיים";
      } else if (state === "up") hint = "יופי, עכשיו רד לאט";
      else if (ang < 130) hint = "עוד קצת למעלה";
    }
    return { rep, hint, depth, ready: true };
  };
}

// Glute bridge - lying on your back, hips push up. Same hip angle as a
// sit-up but the opposite direction: ~120 deg hips down, ~165 straight.
function makeBridgeCounter() {
  let state = "down";
  return function step(lm) {
    const side = bestSide(lm, [L.shoulderL, L.hipL, L.kneeL], [L.shoulderR, L.hipR, L.kneeR]);
    if (!side) {
      return { rep: false, hint: "שכב עם הצד למצלמה", depth: 0, ready: false };
    }
    const ang = angleAt(lm[side[0]], lm[side[1]], lm[side[2]]);
    if (ang === null) return { rep: false, hint: null, depth: 0, ready: false };

    const depth = Math.min(1, Math.max(0, (ang - 110) / 55));

    let rep = false;
    if (state === "down" && ang > 160) state = "up";
    else if (state === "up" && ang < 125) {
      state = "down";
      rep = true;
    }

    let hint = null;
    if (!hint) {
      if (state === "up") hint = "יופי, עכשיו רד לאט";
      else if (ang > 140) hint = "עוד קצת למעלה - קו ישר מהברך לכתף";
      else hint = "דחוף את האגן למעלה";
    }
    return { rep, hint, depth, ready: true };
  };
}

// Tricep dips - same elbow hinge as a push-up, but you're upright with hands
// behind you, so the "down" threshold is shallower.
function makeDipCounter() {
  let state = "up";
  return function step(lm) {
    const side = bestSide(
      lm,
      [L.shoulderL, L.elbowL, L.wristL],
      [L.shoulderR, L.elbowR, L.wristR]
    );
    if (!side) {
      return { rep: false, hint: "שב עם הצד למצלמה", depth: 0, ready: false };
    }
    const ang = angleAt(lm[side[0]], lm[side[1]], lm[side[2]]);
    if (ang === null) return { rep: false, hint: null, depth: 0, ready: false };

    const depth = Math.min(1, Math.max(0, (170 - ang) / 70));

    let rep = false;
    if (state === "up" && ang < 110) state = "down";
    else if (state === "down" && ang > 158) {
      state = "up";
      rep = true;
    }

    let hint = null;
    if (!hint) {
      if (state === "down") hint = "יופי, עכשיו דחוף למעלה";
      else if (ang < 150) hint = "עוד קצת למטה";
    }
    return { rep, hint, depth, ready: true };
  };
}

// Squat jumps - a squat that must go deeper AND come back up fast, so a slow
// grind doesn't pass as a jump.
function makeSquatJumpCounter() {
  let state = "up";
  let wentDownAt = 0;
  return function step(lm) {
    const side = bestSide(lm, [L.hipL, L.kneeL, L.ankleL], [L.hipR, L.kneeR, L.ankleR]);
    if (!side) {
      return { rep: false, hint: "עמוד כך שכל הגוף נכנס למסך", depth: 0, ready: false };
    }
    const ang = angleAt(lm[side[0]], lm[side[1]], lm[side[2]]);
    if (ang === null) return { rep: false, hint: null, depth: 0, ready: false };

    const depth = Math.min(1, Math.max(0, (170 - ang) / 80));
    const now = Date.now();

    let rep = false;
    let slow = false;
    if (state === "up") {
      if (ang < 95) {
        state = "down";
        wentDownAt = now;
      }
    } else if (ang > 165) {
      state = "up";
      // A real jump snaps back up; anything over 1.4s is a plain squat.
      if (now - wentDownAt <= 1400) rep = true;
      else slow = true;
    }

    let hint = null;
    if (!hint) {
      if (slow) hint = "זה היה סקוואט רגיל - תתפוצץ למעלה מהר";
      else if (state === "down") hint = "עכשיו קפוץ!";
      else if (ang < 150) hint = "רד עמוק ואז קפוץ";
    }
    return { rep, hint, depth, ready: true };
  };
}

// Every counter goes through `guarded`, so no exercise can count a rep on a
// frame where the camera cannot actually see the relevant body parts.
const RAW_COUNTERS = {
  squat: makeSquatCounter,
  pushup: makePushupCounter,
  jack: makeJackCounter,
  lunge: makeLungeCounter,
  highknee: makeHighKneeCounter,
  situp: makeSitupCounter,
  bridge: makeBridgeCounter,
  dip: makeDipCounter,
  squatjump: makeSquatJumpCounter,
};

export const COUNTERS = Object.fromEntries(
  Object.entries(RAW_COUNTERS).map(([name, make]) => [name, () => guarded(name, make())])
);

export const HOLDS = {
  wallsit: () => {
    const inner = makeWallSitHold();
    return function step(lm) {
      const gate = readiness(lm, "wallsit");
      if (!gate.ok) return { holding: false, hint: gate.hint, angle: null, ready: false };
      return inner(lm);
    };
  },
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

  // The session runs through explicit phases so the screen never shows a
  // count while it can't actually see you:
  //   setup     - waiting for good framing
  //   countdown - framing held, 3..2..1 before the first rep counts
  //   counting  - live
  //   paused    - framing broke mid-set; the count freezes
  const HOLD_FRAMES_TO_LOCK = 12; // ~0.4s of good framing before we commit
  const COUNTDOWN_MS = 2600;
  let phase = "setup";
  let goodFrames = 0;
  let countdownAt = 0;

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
      goodFrames = 0;
      if (phase === "counting" || phase === "countdown") phase = "paused";
      onUpdate && onUpdate({
        phase, count, target,
        hint: "לא רואה אותך בכלל - התרחק כדי שכל הגוף ייכנס",
        depth: 0, ready: false,
      });
      return;
    }

    const out = step(lm);

    // Only paint the skeleton once the pose is actually judgeable - a partial
    // skeleton over a face close-up looks like the app is working when it
    // isn't.
    if (out.ready) drawSkeleton(lm);
    else ctx.clearRect(0, 0, canvas.width, canvas.height);

    if (out.ready) goodFrames += 1;
    else goodFrames = 0;

    if (phase === "setup") {
      if (goodFrames >= HOLD_FRAMES_TO_LOCK) {
        phase = "countdown";
        countdownAt = performance.now();
      }
      onUpdate && onUpdate({ phase, count, target, hint: out.hint, depth: out.depth, ready: out.ready });
      return;
    }

    if (phase === "countdown") {
      if (!out.ready) {
        phase = "setup";
        onUpdate && onUpdate({ phase, count, target, hint: out.hint, depth: 0, ready: false });
        return;
      }
      const left = COUNTDOWN_MS - (performance.now() - countdownAt);
      if (left <= 0) phase = "counting";
      onUpdate && onUpdate({
        phase, count, target, hint: out.hint, depth: out.depth, ready: true,
        countdown: Math.max(1, Math.ceil(left / 1000)),
      });
      return;
    }

    if (phase === "paused") {
      if (goodFrames >= HOLD_FRAMES_TO_LOCK) phase = "counting";
      onUpdate && onUpdate({ phase, count, target, hint: out.hint, depth: out.depth, ready: out.ready });
      return;
    }

    // counting
    if (!out.ready) {
      phase = "paused";
      onUpdate && onUpdate({ phase, count, target, hint: out.hint, depth: 0, ready: false });
      return;
    }

    if (out.rep) {
      count += 1;
      if (count >= target) {
        onUpdate && onUpdate({ phase: "counting", count, target, hint: null, depth: out.depth, ready: true });
        stop();
        onDone && onDone(count);
        return;
      }
    }
    onUpdate && onUpdate({ phase, count, target, hint: out.hint, depth: out.depth, ready: out.ready });
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
