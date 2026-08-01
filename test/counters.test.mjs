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
