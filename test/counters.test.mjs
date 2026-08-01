import { COUNTERS } from "../js/pose.js";

const rad = (d) => (d * Math.PI) / 180;
let fails = 0;
function check(name, got, want) {
  const ok = got === want;
  if (!ok) fails++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}: got ${got}, want ${want}`);
}

// Build a 33-slot landmark array with everything visible.
function blank() {
  return Array.from({ length: 33 }, () => ({ x: 0.5, y: 0.5, visibility: 1 }));
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

// ---- push-ups: elbow angle (shoulder 11, elbow 13, wrist 15) ----
{
  const step = COUNTERS.pushup();
  const reps = sweep(step, [11, 13, 15], cycle(80, 170, 4));
  check("pushup counts 4 full reps", reps, 4);
}
{
  const step = COUNTERS.pushup();
  const reps = sweep(step, [11, 13, 15], cycle(115, 170, 4));
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
  const step = COUNTERS.squat();
  const lm = blank();
  limb(lm, [23, 25, 27], 170, 0.5, 0.6);
  // Push the feet below the bottom edge.
  lm[27] = { x: 0.5, y: 1.0, visibility: 1 };
  lm[28] = { x: 0.5, y: 1.0, visibility: 1 };
  lm[11] = { x: 0.45, y: 0.2, visibility: 1 };
  lm[12] = { x: 0.55, y: 0.2, visibility: 1 };
  const out = step(lm);
  check("framing hint catches feet off-screen", /הרגליים יוצאות/.test(out.hint || ""), true);
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
