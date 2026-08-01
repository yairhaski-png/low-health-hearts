// Mirrors the auto-difficulty rules in app.js so the level-up ladder is
// verifiable without a browser.

const EASY_PACE = { squat: 2.2, pushup: 2.5, jack: 0.95 };
const EASY_RUNS_TO_LEVEL_UP = 2;
const LEVEL_UP_RATIO = 1.15;
const MAX_TARGET_RATIO = 3;

function makeAdapter(exercise, baseTarget) {
  let target = baseTarget;
  let easy = 0;
  const ceiling = Math.round(baseTarget * MAX_TARGET_RATIO);
  return {
    get target() { return target; },
    // Returns a level-up descriptor, or null.
    run(reps, durationMs) {
      const pace = EASY_PACE[exercise];
      if (!pace || !reps || !durationMs) return null;
      const secPerRep = durationMs / 1000 / reps;
      if (secPerRep < pace) easy += 1;
      else easy = 0;
      if (easy < EASY_RUNS_TO_LEVEL_UP) return null;
      if (target >= ceiling) { easy = 0; return null; }
      const next = Math.min(ceiling, Math.max(target + 1, Math.round(target * LEVEL_UP_RATIO)));
      if (next === target) { easy = 0; return null; }
      const from = target;
      target = next;
      easy = 0;
      return { from, to: next };
    },
  };
}

let fails = 0;
function check(name, got, want) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) fails++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}: got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`);
}

// One fast session is not enough - a single good day shouldn't spike the bar.
{
  const a = makeAdapter("squat", 15);
  check("one fast run does not level up", a.run(15, 15 * 1500), null);
  check("target unchanged after one fast run", a.target, 15);
}

// Two consecutive fast sessions do level it up.
{
  const a = makeAdapter("squat", 15);
  a.run(15, 15 * 1500);
  check("second fast run levels up", a.run(15, 15 * 1500), { from: 15, to: 17 });
}

// A slow session in between resets the counter.
{
  const a = makeAdapter("squat", 15);
  a.run(15, 15 * 1500);        // fast
  a.run(15, 15 * 4000);        // slow - resets
  check("slow run resets the streak", a.run(15, 15 * 1500), null);
}

// Slow sessions never raise the target.
{
  const a = makeAdapter("pushup", 10);
  for (let i = 0; i < 6; i++) a.run(10, 10 * 5000);
  check("consistently slow keeps base target", a.target, 10);
}

// Repeated easy sessions climb, but stop at 3x.
{
  const a = makeAdapter("squat", 15);
  for (let i = 0; i < 60; i++) a.run(a.target, a.target * 1200);
  check("target climbs but is capped at 3x", a.target, 45);
}

// The bump is always at least +1 even when 15% rounds to nothing.
{
  const a = makeAdapter("jack", 4);
  a.run(4, 4 * 500);
  check("small targets still move by at least 1", a.run(4, 4 * 500), { from: 4, to: 5 });
}

console.log(fails === 0 ? "\nAll adapt tests passed." : `\n${fails} test(s) failed.`);
process.exit(fails === 0 ? 0 : 1);
