import { COUNTERS } from "../js/pose.js";

const rad = (d) => (d * Math.PI) / 180;
let fails = 0;
function check(name, got, want) {
  const ok = got === want;
  if (!ok) fails++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}: got ${got}, want ${want}`);
}

// A plausibly-framed standing body, filling a sensible part of the frame.
// Counters now hard-refuse frames they can't judge, so fixtures have to look
// like a real person rather than a cloud of points at the centre.
function blank() {
  const lm = Array.from({ length: 33 }, () => ({ x: 0.5, y: 0.5, visibility: 1 }));
  const put = (i, x, y) => { lm[i] = { x, y, visibility: 1 }; };
  put(0,  0.50, 0.16);                      // nose
  put(11, 0.42, 0.26); put(12, 0.58, 0.26); // shoulders
  put(13, 0.38, 0.40); put(14, 0.62, 0.40); // elbows
  put(15, 0.36, 0.53); put(16, 0.64, 0.53); // wrists
  put(23, 0.45, 0.52); put(24, 0.55, 0.52); // hips
  put(25, 0.45, 0.72); put(26, 0.55, 0.72); // knees
  put(27, 0.45, 0.90); put(28, 0.55, 0.90); // ankles
  return lm;
}

// Place a joint triple so the angle at the middle joint equals `deg`.
function limb(lm, [aI, bI, cI], deg, bx = 0.5, by = 0.6) {
  lm[bI] = { x: bx, y: by, visibility: 1 };
  lm[cI] = { x: bx, y: by + 0.2, visibility: 1 };
  lm[aI] = {
    x: bx + 0.2 * Math.sin(rad(deg)),
    y: by + 0.2 * Math.cos(rad(deg)),
    visibility: 1,
  };
}

function sweep(step, idx, angles) {
  let reps = 0;
  for (const a of angles) {
    const lm = blank();
    limb(lm, idx, a);
    // mirror onto the other side so bestSide() has a clear winner either way
    if (step.__mirror) limb(lm, step.__mirror, a);
    if (step(lm).rep) reps++;
  }
  return reps;
}

function cycle(down, up, n, steps = 6) {
  const out = [];
  for (let i = 0; i < n; i++) {
    for (let s = 0; s <= steps; s++) out.push(up + ((down - up) * s) / steps);
    for (let s = 0; s <= steps; s++) out.push(down + ((up - down) * s) / steps);
  }
  return out;
}

// ---- squats: knee angle, left side (hip 23, knee 25, ankle 27) ----
{
  const step = COUNTERS.squat();
  const reps = sweep(step, [23, 25, 27], cycle(85, 175, 5));
  check("squat counts 5 full reps", reps, 5);
}
{
  const step = COUNTERS.squat();
  // Only dipping to 120 deg never crosses the 100 deg "down" threshold.
  const reps = sweep(step, [23, 25, 27], cycle(120, 175, 5));
  check("squat ignores shallow dips", reps, 0);
}
{
  const step = COUNTERS.squat();
  // Jitter around the down threshold must not ratchet up extra reps.
  const noisy = [];
  for (let i = 0; i < 40; i++) noisy.push(99 + (i % 2 === 0 ? -3 : 3));
  const reps = sweep(step, [23, 25, 27], noisy);
  check("squat ignores jitter at threshold", reps, 0);
}

// shoulderY is the real shoulder height, independent of the elbow angle - so
// a test can bend the arms while the body stays exactly where it was.
// The elbow sits below the shoulder; the wrist swings to make the angle.
function pushupFrame(elbowDeg, shoulderY, opts = {}) {
  const lm = blank();
  const off = opts.offEdge ? 0.34 : 0;
  // Torso laid out horizontally: shoulders left of hips.
  lm[11] = { x: 0.30, y: shoulderY,        visibility: 0.95 };
  lm[12] = { x: 0.32, y: shoulderY + 0.02, visibility: 0.95 };
  lm[23] = { x: 0.62, y: shoulderY + 0.06, visibility: 0.92 };
  lm[24] = { x: 0.64, y: shoulderY + 0.08, visibility: 0.92 };
  lm[25] = { x: 0.82 + off, y: shoulderY + 0.10, visibility: 0.85 };
  lm[26] = { x: 0.84 + off, y: shoulderY + 0.12, visibility: 0.85 };
  lm[27] = { x: 0.96 + off, y: shoulderY + 0.14, visibility: 0.8 };
  lm[28] = { x: 0.98 + off, y: shoulderY + 0.16, visibility: 0.8 };

  const r = rad(elbowDeg);
  for (const [s, e, w, dx] of [[11, 13, 15, 0], [12, 14, 16, 0.02]]) {
    const ex = lm[s].x + dx, ey = lm[s].y + 0.16;
    lm[e] = { x: ex, y: ey, visibility: 0.9 };
    lm[w] = {
      x: ex + 0.16 * Math.sin(r),
      y: ey - 0.16 * Math.cos(r),
      visibility: 0.9,
    };
  }
  return lm;
}

// Push-ups are covered by the dedicated form tests further down, which use a
// realistic prone pose - the generic single-limb fixture can't satisfy the
// posture and both-arms rules the exercise now enforces.
{
  // Half reps: elbows only reach 115 deg, never crossing the 100 deg mark.
  const step = COUNTERS.pushup();
  let reps = 0;
  for (let i = 0; i < 4; i++) {
    for (const [a, y] of [[170, 0.40], [140, 0.42], [115, 0.43], [140, 0.42], [170, 0.40]]) {
      if (step(pushupFrame(a, y)).rep) reps++;
    }
  }
  check("pushup ignores half reps", reps, 0);
}

// ---- jumping jacks ----
function jackFrame(open) {
  const lm = blank();
  lm[11] = { x: 0.45, y: 0.3, visibility: 1 }; // shoulder L
  lm[12] = { x: 0.55, y: 0.3, visibility: 1 }; // shoulder R
  if (open) {
    lm[15] = { x: 0.35, y: 0.18, visibility: 1 };
    lm[16] = { x: 0.65, y: 0.18, visibility: 1 };
    lm[27] = { x: 0.33, y: 0.9, visibility: 1 };
    lm[28] = { x: 0.67, y: 0.9, visibility: 1 };
  } else {
    lm[15] = { x: 0.44, y: 0.62, visibility: 1 };
    lm[16] = { x: 0.56, y: 0.62, visibility: 1 };
    lm[27] = { x: 0.485, y: 0.9, visibility: 1 };
    lm[28] = { x: 0.515, y: 0.9, visibility: 1 };
  }
  return lm;
}
{
  const step = COUNTERS.jack();
  let reps = 0;
  for (let i = 0; i < 6; i++) {
    for (const o of [true, true, false, false]) if (step(jackFrame(o)).rep) reps++;
  }
  check("jack counts 6 open/close cycles", reps, 6);
}
{
  const step = COUNTERS.jack();
  let reps = 0;
  // Staying open the whole time is not a rep.
  for (let i = 0; i < 20; i++) if (step(jackFrame(true)).rep) reps++;
  check("jack needs the return to closed", reps, 0);
}

// ---- lunges (same knee-angle pattern as squats) ----
{
  const step = COUNTERS.lunge();
  const reps = sweep(step, [23, 25, 27], cycle(85, 175, 4));
  check("lunge counts 4 full reps", reps, 4);
}

// ---- high knees ----
function kneeFrame(leftUp, rightUp) {
  const lm = blank();
  lm[23] = { x: 0.45, y: 0.55, visibility: 1 }; // hip L
  lm[24] = { x: 0.55, y: 0.55, visibility: 1 }; // hip R
  lm[25] = { x: 0.45, y: leftUp ? 0.42 : 0.72, visibility: 1 }; // knee L
  lm[26] = { x: 0.55, y: rightUp ? 0.42 : 0.72, visibility: 1 }; // knee R
  return lm;
}
{
  const step = COUNTERS.highknee();
  let reps = 0;
  for (let i = 0; i < 8; i++) {
    if (step(kneeFrame(true, false)).rep) reps++;
    if (step(kneeFrame(false, true)).rep) reps++;
  }
  check("highknee counts 16 alternations", reps, 16);
}
{
  const step = COUNTERS.highknee();
  let reps = 0;
  // Only ever raising the same leg is not counted.
  for (let i = 0; i < 20; i++) if (step(kneeFrame(true, false)).rep) reps++;
  check("highknee ignores single-leg spam", reps, 1);
}

// ---- sit-ups: hip angle (shoulder 11, hip 23, knee 25) ----
{
  const step = COUNTERS.situp();
  const reps = sweep(step, [11, 23, 25], cycle(75, 150, 5));
  check("situp counts 5 full reps", reps, 5);
}
{
  const step = COUNTERS.situp();
  // Barely lifting the torso never crosses the 85 deg "up" threshold.
  const reps = sweep(step, [11, 23, 25], cycle(120, 150, 5));
  check("situp ignores tiny lifts", reps, 0);
}

// ---- glute bridge: same joints, opposite direction ----
{
  const step = COUNTERS.bridge();
  const reps = sweep(step, [11, 23, 25], cycle(168, 115, 4));
  check("bridge counts 4 full reps", reps, 4);
}
{
  const step = COUNTERS.bridge();
  const reps = sweep(step, [11, 23, 25], cycle(150, 130, 4));
  check("bridge ignores partial lifts", reps, 0);
}

// ---- dips: elbow angle ----
{
  const step = COUNTERS.dip();
  const reps = sweep(step, [11, 13, 15], cycle(100, 170, 4));
  check("dip counts 4 full reps", reps, 4);
}

// ---- squat jumps: must be fast, not a slow grind ----
{
  const step = COUNTERS.squatjump();
  // Immediate frames are well under the 1400ms limit, so these count.
  const reps = sweep(step, [23, 25, 27], cycle(88, 172, 3));
  check("squatjump counts 3 fast reps", reps, 3);
}
{
  // A slow squat: hold the bottom past the jump window, so it must NOT count.
  const step = COUNTERS.squatjump();
  const lm = blank();
  limb(lm, [23, 25, 27], 172);
  step(lm);
  limb(lm, [23, 25, 27], 88);
  step(lm); // now in "down"
  const slept = Date.now() + 1500;
  while (Date.now() < slept) { /* busy wait past the 1400ms jump window */ }
  limb(lm, [23, 25, 27], 172);
  const out = step(lm);
  check("squatjump rejects a slow grind", out.rep, false);
  check("squatjump explains why it rejected", /סקוואט רגיל/.test(out.hint || ""), true);
}

// ---- framing feedback ----
{
  const step = COUNTERS.squat();
  const lm = blank();
  // A whole body squeezed into a 0.15-tall band: standing much too far away.
  lm[11] = { x: 0.48, y: 0.50, visibility: 1 };
  lm[12] = { x: 0.52, y: 0.50, visibility: 1 };
  lm[23] = { x: 0.48, y: 0.56, visibility: 1 };
  lm[24] = { x: 0.52, y: 0.56, visibility: 1 };
  lm[25] = { x: 0.48, y: 0.60, visibility: 1 };
  lm[26] = { x: 0.52, y: 0.60, visibility: 1 };
  lm[27] = { x: 0.48, y: 0.65, visibility: 1 };
  lm[28] = { x: 0.52, y: 0.65, visibility: 1 };
  const out = step(lm);
  check("framing hint fires when body is tiny in frame", /רחוק/.test(out.hint || ""), true);
}
{
  // Running off the bottom edge is normal and must NOT block. An earlier
  // version rejected it, which made whole exercises impossible to start.
  const step = COUNTERS.squat();
  const lm = blank();
  limb(lm, [23, 25, 27], 170, 0.5, 0.6);
  lm[27] = { x: 0.5, y: 1.0, visibility: 1 };
  lm[28] = { x: 0.5, y: 1.0, visibility: 1 };
  lm[11] = { x: 0.45, y: 0.2, visibility: 1 };
  lm[12] = { x: 0.55, y: 0.2, visibility: 1 };
  const out = step(lm);
  check("feet at the bottom edge do not block", out.ready, true);
}

// ---- regression: a face-filling selfie must never count reps ----
// Reproduces a real screen recording where the counter climbed 0->9 while the
// user just held the phone in front of their face and the app itself was
// saying "can't see you".
{
  const step = COUNTERS.pushup();
  let reps = 0;
  let sawRefusal = false;
  for (let i = 0; i < 200; i++) {
    const lm = blank();
    // Head and shoulders only, filling the frame - no hips, no legs.
    lm[11] = { x: 0.30, y: 0.55, visibility: 0.95 };
    lm[12] = { x: 0.70, y: 0.55, visibility: 0.95 };
    // Elbows/wrists flicker in and out with the jitter a close-up produces.
    const wobble = Math.sin(i / 3) * 0.25;
    lm[13] = { x: 0.22, y: 0.75 + wobble, visibility: 0.7 };
    lm[15] = { x: 0.18, y: 0.95 + wobble, visibility: 0.7 };
    lm[14] = { x: 0.78, y: 0.75 - wobble, visibility: 0.7 };
    lm[16] = { x: 0.82, y: 0.95 - wobble, visibility: 0.7 };
    // Hips and below are out of shot entirely.
    for (const j of [23, 24, 25, 26, 27, 28]) lm[j] = { x: 0.5, y: 0.5, visibility: 0.05 };
    const out = step(lm);
    if (out.rep) reps++;
    if (out.ready === false && out.hint) sawRefusal = true;
  }
  check("selfie framing counts zero push-ups", reps, 0);
  check("selfie framing explains what's missing", sawRefusal, true);
}


// ---- regression: real push-up setups run past the frame edges ----
// Phone on the floor beside you puts hands and feet off-screen almost every
// time. An earlier framing check treated that as "you're out of frame" and
// blocked the exercise permanently.
{
  const step = COUNTERS.pushup();
  let reps = 0;
  let blocked = 0;
  for (let i = 0; i < 4; i++) {
    for (const [a, y] of [[170, 0.40], [120, 0.44], [80, 0.47], [120, 0.44], [170, 0.40]]) {
      const out = step(pushupFrame(a, y, { offEdge: true })); // knees/ankles past x=1
      if (out.rep) reps++;
      if (out.ready === false) blocked++;
    }
  }
  check("push-up counts with limbs past the frame edge", reps, 4);
  check("push-up is never blocked by edge overflow", blocked, 0);
}

// ---- push-up form rules ----
// A correct rep: both arms fully in shot, torso horizontal, chest travels.
{
  const step = COUNTERS.pushup();
  let reps = 0;
  for (let i = 0; i < 4; i++) {
    // Chest genuinely drops 6% of the frame and comes back up.
    for (const [a, y] of [[170, 0.40], [120, 0.44], [80, 0.47], [120, 0.44], [170, 0.40]]) {
      if (step(pushupFrame(a, y)).rep) reps++;
    }
  }
  check("push-up with real chest travel counts", reps, 4);
}
{
  // Elbows hinge through the full range, but the body never lowers - the
  // classic "do it sitting up" cheat.
  const step = COUNTERS.pushup();
  let reps = 0;
  let toldWhy = false;
  for (let i = 0; i < 4; i++) {
    for (const a of [170, 120, 80, 120, 170]) {
      const out = step(pushupFrame(a, 0.40));
      if (out.rep) reps++;
      if (/הגוף לא ירד/.test(out.hint || "")) toldWhy = true;
    }
  }
  check("push-up without chest travel counts zero", reps, 0);
  check("push-up explains the body never moved", toldWhy, true);
}
{
  // One arm out of shot: not enough to judge form.
  const step = COUNTERS.pushup();
  const lm = pushupFrame(90, 0.45);
  lm[14] = { ...lm[14], visibility: 0.1 };
  lm[16] = { ...lm[16], visibility: 0.1 };
  const out = step(lm);
  check("push-up refuses with one arm hidden", out.ready, false);
  check("push-up asks for both arms", /שתי/.test(out.hint || ""), true);
}
{
  // Upright body, elbows bending: a push-up posture check must reject it.
  const step = COUNTERS.pushup();
  const lm = blank(); // blank() is a standing figure
  limb(lm, [11, 13, 15], 90, 0.42, 0.40);
  const out = step(lm);
  check("push-up rejects an upright body", out.ready, false);
}

// ---- the live requirement checklist ----
{
  // A good push-up frame: everything the exercise needs is satisfied.
  const step = COUNTERS.pushup();
  const out = step(pushupFrame(150, 0.42));
  check("all checks pass on a good frame", out.checks.every((c) => c.ok), true);
  check("checklist covers every requirement", out.checks.map((c) => c.label).join(","),
    "שתי הגפיים,ידיים,אגן,מרחק,תנוחה");
}
{
  // One arm hidden: that single check fails, the rest still report.
  const step = COUNTERS.pushup();
  const lm = pushupFrame(150, 0.42);
  lm[14] = { ...lm[14], visibility: 0.1 };
  lm[16] = { ...lm[16], visibility: 0.1 };
  const out = step(lm);
  const byLabel = Object.fromEntries(out.checks.map((c) => [c.label, c.ok]));
  check("hidden arm fails only the both-limbs check", byLabel["שתי הגפיים"], false);
  check("the hip check still passes", byLabel["אגן"], true);
  check("checks are reported even when blocked", out.checks.length > 1, true);
}
{
  // Standing upright: posture is the thing that's wrong, and it says so.
  const step = COUNTERS.pushup();
  const lm = blank();
  limb(lm, [11, 13, 15], 90, 0.42, 0.40);
  const out = step(lm);
  const byLabel = Object.fromEntries(out.checks.map((c) => [c.label, c.ok]));
  check("upright body fails the posture check", byLabel["תנוחה"], false);
}

// ---- occlusion ----
{
  const step = COUNTERS.squat();
  const lm = blank();
  limb(lm, [23, 25, 27], 90);
  for (const i of [23, 25, 27, 24, 26, 28]) lm[i].visibility = 0.1;
  const out = step(lm);
  check("squat reports not-ready when joints hidden", out.ready, false);
}

console.log(fails === 0 ? "\nAll counter tests passed." : `\n${fails} test(s) failed.`);
process.exit(fails === 0 ? 0 : 1);
