(() => {
  "use strict";

  const KEY = "kesher-state";
  const SCHEMA = 10;
  const CHART_DAYS = 14;
  // Minimum distance the phone must have moved for a ריצה workout to count.
  const RUN_MIN_METERS_PER_10MIN = 600;

  // `workout: true` marks a slot the app will actually hold you to - those are
  // the ones that trigger a nag when their time comes and goes.
  const DEFAULT_ROUTINE = [
    { id: "wake", label: "השכמה", time: "" },
    { id: "morn", label: "אימון בוקר", time: "", workout: true },
    { id: "eve", label: "אימון ערב", time: "", workout: true },
    { id: "sleep", label: "שינה", time: "" },
  ];

  // How late a scheduled workout has to be before the coach says something.
  const SLOT_GRACE_MIN = 20;

  const DAY_SHORT = ["א", "ב", "ג", "ד", "ה", "ו", "ש"];
  const DAY_LONG = ["ראשון", "שני", "שלישי", "רביעי", "חמישי", "שישי", "שבת"];

  // Two schedules out of the box, because a school day and a weekend day are
  // not the same day.
  function defaultRoutines() {
    return [
      { id: "school", name: "יום לימודים", days: [0, 1, 2, 3, 4], items: DEFAULT_ROUTINE.map((r) => ({ ...r })) },
      { id: "free", name: "סוף שבוע", days: [5, 6], items: DEFAULT_ROUTINE.map((r) => ({ ...r })) },
    ];
  }

  const today = () => new Date().toISOString().slice(0, 10);
  const dayGap = (a, b) =>
    Math.round((new Date(b + "T00:00:00") - new Date(a + "T00:00:00")) / 86400000);

  // verify:
  //   "camera" - the phone camera watches you and counts real reps
  //   "timer"  - a real countdown you have to actually sit through
  //   "manual" - you mark it yourself
  const BASE_CHALLENGES = [
    { id: "squat", title: "סקוואטים", verify: "camera", exercise: "squat", target: 15, points: 15 },
    { id: "pushup", title: "שכיבות סמיכה", verify: "camera", exercise: "pushup", target: 10, points: 20 },
    { id: "jack", title: "קפיצות פישוק", verify: "camera", exercise: "jack", target: 25, points: 12 },
    { id: "lunge", title: "מכרעים", verify: "camera", exercise: "lunge", target: 12, points: 16 },
    { id: "highknee", title: "רגל למעלה", verify: "camera", exercise: "highknee", target: 30, points: 13 },
    { id: "wallsit", title: "סקוואט קיר", verify: "hold", hold: "wallsit", target: 30, points: 14 },
    { id: "plank", title: "פלאנק", verify: "timer", target: 45, points: 12 },
    { id: "run", title: "ריצה או הליכה", verify: "run", target: 600, minMeters: RUN_MIN_METERS_PER_10MIN, points: 22 },
  ];

  // Rotating bonus pool. Two of these fill the bonus slots and refresh every
  // 8 hours, so there's always something that isn't on the daily list.
  const BONUS_POOL = [
    { id: "situp", title: "כפיפות בטן", verify: "camera", exercise: "situp", target: 20, points: 16 },
    { id: "bridge", title: "גשר ירכיים", verify: "camera", exercise: "bridge", target: 15, points: 13 },
    { id: "dip", title: "דיפים", verify: "camera", exercise: "dip", target: 12, points: 18 },
    { id: "squatjump", title: "קפיצות סקוואט", verify: "camera", exercise: "squatjump", target: 12, points: 20 },
    { id: "lunge2", title: "מכרעים כפול", verify: "camera", exercise: "lunge", target: 20, points: 22 },
    { id: "jack2", title: "פישוק מהיר", verify: "camera", exercise: "jack", target: 40, points: 18 },
    { id: "wallsit2", title: "סקוואט קיר ארוך", verify: "hold", hold: "wallsit", target: 60, points: 24 },
    { id: "plank2", title: "פלאנק ארוך", verify: "timer", target: 90, points: 20 },
  ];

  const BONUS_SLOTS = 2;
  const BONUS_REFRESH_MS = 8 * 60 * 60 * 1000; // 8 hours
  const BONUS_MULTIPLIER = 1.5;

  // ---------- Auto difficulty ----------
  // Comfortable seconds-per-rep for each exercise. Finishing faster than this
  // twice in a row means the target is too easy for you now.
  const EASY_PACE = {
    squat: 2.2,
    pushup: 2.5,
    jack: 0.95,
    lunge: 2.5,
    highknee: 0.5,
    situp: 2.2,
    bridge: 2.0,
    dip: 2.5,
    squatjump: 2.0,
  };
  const EASY_RUNS_TO_LEVEL_UP = 2; // consecutive easy sessions before a bump
  const LEVEL_UP_RATIO = 1.15; // +15% each time
  const MAX_TARGET_RATIO = 3; // never grow past 3x the original target

  // ---------- App gate ----------
  const GATE_PASS_MS = 10 * 60 * 1000; // 10 minutes of access per unlock
  const GATE_TASK = {
    id: "gatetask",
    title: "שכיבות סמיכה",
    verify: "camera",
    exercise: "pushup",
    target: 10,
    points: 4,
  };

  const BASE_STORE = [
    { id: "r1", title: "שעה של גיימינג", cost: 60 },
    { id: "r2", title: "פרק בסדרה", cost: 45 },
    { id: "r3", title: "יום חופש מהאימונים", cost: 120 },
    { id: "r4", title: "משהו קטן שבא לך לקנות", cost: 200 },
    { id: "r5", title: "נעלי ספורט חדשות", cost: 600 },
  ];

  // How many days of skipping before a challenge starts being worth more.
  const BOOST_AFTER_DAYS = 3;
  const BOOST_PER_DAY = 5;

  function freshState() {
    return {
      v: SCHEMA,
      points: 0,
      totalEarned: 0,
      totalReps: 0,
      goal: "",
      streak: 0,
      lastDoneDate: null,
      today: today(),
      doneToday: [],
      challenges: BASE_CHALLENGES.map((c) => ({ ...c })),
      store: BASE_STORE.map((s) => ({ ...s })),
      redeemed: [],
      lastDoneBy: {},
      log: {},
      bestStreak: 0,
      remindOn: false,
      routine: DEFAULT_ROUTINE.map((r) => ({ ...r })),
      workoutCount: {},
      // Excuse verdicts turn into a per-day penalty multiplier applied to the
      // very next workout, matching what the coach said.
      penalty: 1.0,
      penaltyDate: null,
      excuseHistory: [],
      bonus: { pickedAt: 0, ids: [], doneIds: [] },
      lastNudgeAt: 0,
      adapt: {},
      gate: { until: 0, unlocks: 0 },
      playerName: "",
      boards: [],
      routines: defaultRoutines(),
      routinePick: null,
    };
  }

  let state = load();

  function load() {
    let saved = null;
    try {
      saved = JSON.parse(localStorage.getItem(KEY) || "null");
    } catch (e) {
      saved = null;
    }
    if (!saved) return freshState();
    if (saved.v === SCHEMA) return saved;

    // v3..v6 forward migrations preserve everything the user set up.
    if (saved.v >= 3 && saved.v < SCHEMA) {
      saved.log = saved.log || {};
      saved.bestStreak = saved.bestStreak || saved.streak || 0;
      saved.routine = saved.routine || DEFAULT_ROUTINE.map((r) => ({ ...r }));
      saved.workoutCount = saved.workoutCount || {};
      saved.penalty = saved.penalty || 1.0;
      saved.penaltyDate = saved.penaltyDate || null;
      saved.excuseHistory = saved.excuseHistory || [];
      saved.bonus = saved.bonus || { pickedAt: 0, ids: [], doneIds: [] };
      saved.lastNudgeAt = saved.lastNudgeAt || 0;
      saved.adapt = saved.adapt || {};
      saved.gate = saved.gate || { until: 0, unlocks: 0 };
      saved.playerName = saved.playerName || "";
      saved.boards = saved.boards || [];
      // Carry a single old routine forward as the weekday schedule.
      if (!saved.routines) {
        const rs = defaultRoutines();
        if (Array.isArray(saved.routine)) rs[0].items = saved.routine;
        saved.routines = rs;
      }
      saved.routinePick = saved.routinePick || null;
      // Remember where each challenge started so auto-difficulty has a floor.
      for (const c of saved.challenges) {
        if (c.baseTarget === undefined && c.target !== undefined) c.baseTarget = c.target;
      }
      // Ensure new base challenges (wallsit) exist without duplicating anything the user had.
      const have = new Set(saved.challenges.map((c) => c.id));
      for (const base of BASE_CHALLENGES) {
        if (!have.has(base.id)) saved.challenges.push({ ...base });
      }
      // Upgrade the run challenge to gps verification if the saved copy
      // still says "timer" - preserves the user's own points/target.
      const run = saved.challenges.find((c) => c.id === "run");
      if (run && run.verify !== "run") {
        run.verify = "run";
        run.minMeters = run.minMeters || RUN_MIN_METERS_PER_10MIN;
      }
      saved.v = SCHEMA;
      return saved;
    }

    // Anything older predates the fitness challenge set entirely. Keep
    // everything the user earned; take the new defaults for the rest.
    const base = freshState();
    base.points = saved.points || 0;
    base.totalEarned = saved.totalEarned || 0;
    base.goal = saved.goal || "";
    base.streak = saved.streak || 0;
    base.bestStreak = saved.streak || 0;
    base.redeemed = Array.isArray(saved.redeemed) ? saved.redeemed : [];
    if (Array.isArray(saved.storeItems)) base.store = saved.storeItems;
    else if (Array.isArray(saved.store)) base.store = saved.store;
    return base;
  }

  const save = () => localStorage.setItem(KEY, JSON.stringify(state));

  function rollDay() {
    const t = today();
    if (state.today !== t) {
      state.today = t;
      state.doneToday = [];
      // A streak only survives if yesterday had something in it.
      if (state.lastDoneDate && dayGap(state.lastDoneDate, t) > 1) state.streak = 0;
      save();
    }
  }

  const uid = (p) => p + Math.random().toString(36).slice(2, 8);

  const esc = (s) => {
    const d = document.createElement("div");
    d.textContent = s;
    return d.innerHTML;
  };

  const $ = (id) => document.getElementById(id);

  // ---------- Adaptive difficulty ----------
  // Skipping a workout makes it worth more, a little each day, so the thing
  // you keep avoiding slowly becomes the most rewarding thing on the list.

  function daysSkipped(c) {
    const last = state.lastDoneBy && state.lastDoneBy[c.id];
    if (!last) return null;
    return dayGap(last, today());
  }

  function boostOf(c) {
    const gap = daysSkipped(c);
    if (gap === null) return 0;
    if (gap < BOOST_AFTER_DAYS) return 0;
    return Math.min(c.points, (gap - BOOST_AFTER_DAYS + 1) * BOOST_PER_DAY);
  }

  // A penalty applies to the very next workout only, and covers both the
  // reward (more points earned) AND the effort (higher rep count / longer
  // time) - so "פי 1.5" means you actually work 1.5x harder.
  function activePenalty() {
    if (state.penaltyDate === today() && state.penalty > 1) return state.penalty;
    return 1;
  }

  function worthOf(c) {
    const base = c.points + boostOf(c);
    return Math.round(base * activePenalty());
  }

  function scaledTarget(c) {
    const mult = activePenalty();
    if (mult <= 1) return c.target;
    return Math.ceil(c.target * mult);
  }

  function topBoosted() {
    let best = null;
    for (const c of state.challenges) {
      const b = boostOf(c);
      if (b > 0 && (!best || b > boostOf(best))) best = c;
    }
    return best;
  }

  // ---------- Auto difficulty ----------
  // If you keep breezing through an exercise, the app quietly raises the bar.
  // It only ever moves after two consecutive easy sessions, so one good day
  // doesn't spike the target, and it never grows past 3x where it started.

  function recordPace(c, reps, durationMs) {
    if (!c || c.__bonus || c.__gate) return null; // bonus/gate runs don't retune the daily list
    if (!reps || !durationMs || durationMs <= 0) return null;
    const pace = EASY_PACE[c.exercise];
    if (!pace) return null;

    const secPerRep = durationMs / 1000 / reps;
    const a = (state.adapt[c.id] = state.adapt[c.id] || { easy: 0, lastPace: null });
    a.lastPace = Math.round(secPerRep * 10) / 10;

    if (secPerRep < pace) a.easy += 1;
    else a.easy = 0;

    if (a.easy < EASY_RUNS_TO_LEVEL_UP) return null;

    const live = state.challenges.find((x) => x.id === c.id);
    if (!live) return null;
    const base = live.baseTarget || live.target;
    const ceiling = Math.round(base * MAX_TARGET_RATIO);
    if (live.target >= ceiling) {
      a.easy = 0;
      return null;
    }
    const next = Math.min(ceiling, Math.max(live.target + 1, Math.round(live.target * LEVEL_UP_RATIO)));
    if (next === live.target) {
      a.easy = 0;
      return null;
    }
    const from = live.target;
    live.target = next;
    a.easy = 0;
    return { title: live.title, from, to: next };
  }

  function levelUpSheet(info) {
    openSheet(
      `<h2 class="sheet-title">עלית רמה</h2>
       <p class="sheet-note">${esc(info.title)} נעשה לך קל - העליתי את היעד.</p>
       <div class="levelup">
         <span class="levelup-from" dir="ltr">${info.from}</span>
         <span class="levelup-arrow" aria-hidden="true">→</span>
         <span class="levelup-to" dir="ltr">${info.to}</span>
       </div>
       <div class="sheet-actions">
         <button class="btn btn-fill" id="luOk">קדימה</button>
       </div>`,
      (r) => {
        r.querySelector("#luOk").onclick = closeSheet;
      }
    );
  }

  // ---------- App gate ----------

  const gateMsLeft = () => Math.max(0, (state.gate && state.gate.until ? state.gate.until : 0) - Date.now());
  const gateOpen = () => gateMsLeft() > 0;

  function grantGatePass() {
    state.gate = state.gate || { until: 0, unlocks: 0 };
    state.gate.until = Date.now() + GATE_PASS_MS;
    state.gate.unlocks = (state.gate.unlocks || 0) + 1;
    save();
    render();
  }

  function mmss(ms) {
    const total = Math.ceil(ms / 1000);
    return String(Math.floor(total / 60)).padStart(2, "0") + ":" + String(total % 60).padStart(2, "0");
  }

  // ---------- Bonus slots ----------
  // Two extra challenges drawn from a rotating pool. They refresh on their own
  // every 8 hours, and can be rerolled by hand - rerolling costs nothing
  // because you still have to actually do the exercise to get the points.

  function rollBonus(force) {
    const now = Date.now();
    const b = state.bonus || (state.bonus = { pickedAt: 0, ids: [], doneIds: [] });
    const stale = now - (b.pickedAt || 0) >= BONUS_REFRESH_MS;
    if (!force && !stale && b.ids && b.ids.length === BONUS_SLOTS) return false;

    const pool = BONUS_POOL.slice();
    const picked = [];
    while (picked.length < BONUS_SLOTS && pool.length) {
      picked.push(pool.splice(Math.floor(Math.random() * pool.length), 1)[0].id);
    }
    b.ids = picked;
    b.pickedAt = now;
    b.doneIds = []; // a fresh pair is a fresh chance
    return true;
  }

  const bonusById = (id) => BONUS_POOL.find((x) => x.id === id) || null;

  function bonusMsLeft() {
    const b = state.bonus || {};
    return Math.max(0, BONUS_REFRESH_MS - (Date.now() - (b.pickedAt || 0)));
  }

  function countdownText(ms) {
    const total = Math.ceil(ms / 1000);
    const h = Math.floor(total / 3600);
    const m = Math.floor((total % 3600) / 60);
    if (h > 0) return `${h}:${String(m).padStart(2, "0")} שעות`;
    return `${m} דקות`;
  }

  // ---------- Labels ----------

  const MODE = {
    camera: { icon: "i-camera", text: "המצלמה סופרת" },
    hold:   { icon: "i-camera", text: "המצלמה מוודאת" },
    timer:  { icon: "i-timer", text: "טיימר" },
    run:    { icon: "i-timer", text: "GPS + טיימר" },
    manual: { icon: "i-hand", text: "סימון ידני" },
  };

  const modeOf = (c) => MODE[c.verify] || MODE.manual;

  function targetLabel(c) {
    const t = scaledTarget(c);
    if (c.verify === "camera") return t + " חזרות";
    if (c.verify === "hold") return t + " שניות החזקה";
    if (c.verify === "timer" || c.verify === "run") {
      return t >= 60 ? Math.round(t / 60) + " דקות" : t + " שניות";
    }
    return "";
  }

  const clock = (s) =>
    String(Math.floor(s / 60)).padStart(2, "0") + ":" + String(s % 60).padStart(2, "0");

  // Hebrew takes the singular for exactly one.
  const plural = (n, one, many) => n + " " + (n === 1 ? one : many);
  const workouts = (n) => plural(n, "אימון", "אימונים");
  const pts = (n) => plural(n, "נקודה", "נקודות");
  const repCount = (n) => plural(n, "חזרה", "חזרות");

  // ---------- Sound ----------
  // Mid-rep you're looking at the floor, not the screen, so each counted rep
  // gets an audible blip. Built with an oscillator so there's no audio file
  // to load and nothing to cache.

  let audio = null;

  function primeAudio() {
    if (audio) return;
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    try {
      audio = new AC();
    } catch (e) {
      audio = null;
    }
  }

  function blip(freq = 660, ms = 90, gain = 0.16) {
    if (!audio) return;
    if (audio.state === "suspended") audio.resume().catch(() => {});
    try {
      const osc = audio.createOscillator();
      const amp = audio.createGain();
      osc.type = "sine";
      osc.frequency.value = freq;
      const t = audio.currentTime;
      amp.gain.setValueAtTime(0, t);
      amp.gain.linearRampToValueAtTime(gain, t + 0.012);
      amp.gain.exponentialRampToValueAtTime(0.0001, t + ms / 1000);
      osc.connect(amp).connect(audio.destination);
      osc.start(t);
      osc.stop(t + ms / 1000 + 0.02);
    } catch (e) {
      /* audio is a nicety - never let it break the workout */
    }
  }

  const cheer = () => {
    blip(760, 110);
    setTimeout(() => blip(1020, 190), 120);
  };

  // ---------- Screen wake lock ----------
  // A workout is minutes of not touching the phone, which is exactly when iOS
  // dims and locks the screen. Hold the screen awake while one is running.

  let wakeLock = null;

  async function keepAwake() {
    if (!("wakeLock" in navigator)) return;
    try {
      wakeLock = await navigator.wakeLock.request("screen");
    } catch (e) {
      wakeLock = null;
    }
  }

  function releaseAwake() {
    if (!wakeLock) return;
    const w = wakeLock;
    wakeLock = null;
    w.release().catch(() => {});
  }

  // iOS drops the lock whenever the app goes to the background; take it back
  // when the user returns and something is still running.
  document.addEventListener("visibilitychange", () => {
    const running = !$("camView").hidden || document.querySelector("#tClock");
    if (!document.hidden && running && !wakeLock) keepAwake();
  });

  // ---------- Toast ----------

  let toastTimer = null;
  function toast(msg) {
    const el = $("toast");
    el.textContent = msg;
    el.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => (el.hidden = true), 2600);
  }

  // ---------- Render ----------

  let lastPoints = state.points;
  function bumpPoints() {
    for (const el of [$("hudPoints"), $("ptsBalance")]) {
      if (!el) continue;
      el.classList.remove("bump");
      void el.offsetWidth;
      el.classList.add("bump");
    }
  }

  function render() {
    if (state.points !== lastPoints) {
      lastPoints = state.points;
      setTimeout(bumpPoints, 40);
    }
    $("hudPoints").textContent = state.points;
    $("hudStreakNum").textContent = state.streak;
    const streakVal = document.querySelector(".score-val.streak");
    if (streakVal) streakVal.classList.toggle("is-dead", state.streak === 0);
    renderNextUp();
    renderGate();
    renderToday();
    renderBonus();
    renderNudge();
    renderExcuse();
    renderGoal();
    renderStats();
    renderRoutine();
    renderProgress();
    renderStore();
    renderRemind();
  }

  function todaysExcuse() {
    const t = today();
    const h = state.excuseHistory || [];
    for (let i = h.length - 1; i >= 0; i--) if (h[i].date === t) return h[i];
    return null;
  }

  function renderExcuse() {
    const box = $("verdictBox");
    const btn = $("openExcuseBtn");
    const strip = $("proofStrip");
    const t = todaysExcuse();

    // The coach's file on you: how much he's heard lately.
    const hist = state.excuseHistory || [];
    const recent = hist.filter((e) => dayGap(e.date, today()) <= 14).length;
    const shots = hist.filter((e) => e.proof).slice(-6).reverse();
    strip.hidden = shots.length === 0;
    strip.innerHTML = shots
      .map((e) => `<img class="proof-thumb" src="${e.proof}" alt="הוכחה מ-${esc(e.date)}" title="${esc(e.date)}" />`)
      .join("");

    if (!t) {
      box.hidden = recent === 0;
      if (recent > 0) {
        box.className = "verdict " + (recent >= 3 ? "bad" : "warn");
        box.textContent =
          recent >= 3
            ? `הוא זוכר ${recent} תירוצים שלך בשבועיים. הבא יישפט בהתאם.`
            : `הוא זוכר ${plural(recent, "תירוץ", "תירוצים")} מהשבועיים האחרונים.`;
      }
      btn.disabled = false;
      btn.querySelector("span").textContent = "יש לי תירוץ";
      return;
    }

    const tone = t.verdict === "legit" ? "good" : t.verdict === "weak" ? "warn" : "bad";
    const label =
      t.verdict === "legit" ? "בסדר גמור להיום"
      : t.verdict === "weak" ? "נבדק - האימון הבא בפי 1.25"
      : "נקבע תירוץ - האימון הבא בפי 1.5";
    box.hidden = false;
    box.className = "verdict " + tone;
    box.textContent = label + (t.proof ? " · עם הוכחה" : "");
    btn.disabled = true;
    btn.querySelector("span").textContent = "תירוץ להיום כבר נרשם";
  }

  const pending = () => state.challenges.filter((c) => !state.doneToday.includes(c.id));

  function renderNextUp() {
    const left = pending();
    const card = $("nextUp");
    if (!left.length) {
      card.hidden = true;
      return;
    }
    card.hidden = false;
    // Lead with whatever has been neglected longest, otherwise just the first.
    const pick = left.slice().sort((a, b) => boostOf(b) - boostOf(a))[0];
    const m = modeOf(pick);
    $("nextUpTitle").textContent = pick.title + (targetLabel(pick) ? " · " + targetLabel(pick) : "");
    const mode = $("nextUpMode");
    mode.innerHTML = `<svg class="ico"><use href="#${m.icon}"/></svg><span>${esc(m.text)}</span>`;
    mode.classList.toggle("chip-cam", pick.verify === "camera");
    $("nextUpPts").textContent = "+" + worthOf(pick) + " נק'";
    $("nextUpGo").onclick = () => startChallenge(pick.id);
  }

  function renderToday() {
    const list = $("todayList");
    const left = pending();
    const total = state.challenges.length;
    const done = total - left.length;

    $("dayCount").textContent = done + " מתוך " + total;
    $("dayBar").style.width = total ? (done / total) * 100 + "%" : "0%";
    $("todayEmpty").hidden = left.length !== 0;

    list.innerHTML = "";
    for (const c of left) {
      const m = modeOf(c);
      const b = boostOf(c);
      const li = document.createElement("li");
      li.className = "row is-tappable";
      li.innerHTML = `
        <span class="launch${c.verify === "camera" ? " is-cam" : ""}"><svg class="ico"><use href="#${m.icon}"/></svg></span>
        <div class="row-main">
          <span class="row-title">${esc(c.title)}${targetLabel(c) ? " · " + esc(targetLabel(c)) : ""}</span>
          <span class="row-sub${c.verify === "camera" ? " is-cam" : ""}">${esc(m.text)}</span>
        </div>
        <span class="row-pts${b ? " is-boost" : ""}">+${worthOf(c)}</span>
        <button class="mini-x" aria-label="מחק אימון"><svg class="ico"><use href="#i-close"/></svg></button>
      `;
      li.querySelector(".mini-x").onclick = (e) => {
        e.stopPropagation();
        state.challenges = state.challenges.filter((x) => x.id !== c.id);
        state.doneToday = state.doneToday.filter((x) => x !== c.id);
        save();
        render();
      };
      const main = li.querySelector(".row-main");
      const launch = li.querySelector(".launch");
      const goStart = () => startChallenge(c.id);
      launch.onclick = goStart;
      main.onclick = goStart;
      list.appendChild(li);
    }
  }

  function renderGate() {
    const box = $("gateState");
    const btn = $("gateBtn");
    const open = gateOpen();
    box.className = "gate-state " + (open ? "is-open" : "is-shut");
    box.innerHTML = open
      ? `<svg class="ico"><use href="#i-unlock"/></svg>
         <div class="gate-copy">
           <span class="gate-big" id="gateClock" dir="ltr">${mmss(gateMsLeft())}</span>
           <span class="gate-sub">נשאר לך זמן פתוח</span>
         </div>`
      : `<svg class="ico"><use href="#i-lock"/></svg>
         <div class="gate-copy">
           <span class="gate-big">נעול</span>
           <span class="gate-sub">${state.gate && state.gate.unlocks ? `פתחת ${plural(state.gate.unlocks, "פעם", "פעמים")} עד היום` : "עוד לא פתחת היום"}</span>
         </div>`;
    btn.querySelector("span").textContent = open
      ? "עוד 10 דקות (עוד 10 שכיבות)"
      : "עשה 10 שכיבות כדי לפתוח";
  }

  function startGateTask() {
    primeAudio();
    openCamera({ ...GATE_TASK, __gate: true });
  }

  function gateHelpSheet() {
    openSheet(
      `<h2 class="sheet-title">איך נועלים את יוטיוב</h2>
       <p class="sheet-note">
         חשוב שתדע את האמת: <b>אתר לא יכול לחסום אפליקציות אחרות באייפון.</b>
         אין שום דרך שקוד באתר יעצור את יוטיוב - אפל לא נותנת גישה כזאת לדפדפן, לאף אתר בעולם.
       </p>
       <p class="sheet-note">
         אבל יש דרך אמיתית שכן עובדת, בעזרת אפליקציית <b>קיצורי דרך</b> של אפל:
       </p>
       <ol class="steps">
         <li>פתח <b>קיצורי דרך</b> ← לשונית <b>אוטומציה</b> ← <b>+</b></li>
         <li>בחר <b>אפליקציה</b> ← <b>בחר</b> ← סמן <b>YouTube</b> ← <b>נפתחת</b></li>
         <li>בחר <b>הפעל מיד</b> (בלי לשאול)</li>
         <li>הוסף פעולה <b>פתח אפליקציה</b> ← בחר <b>קשר</b></li>
         <li>שמור</li>
       </ol>
       <p class="sheet-note">
         מעכשיו, כל פעם שתפתח יוטיוב - האייפון יזרוק אותך לכאן. אם יש לך זמן פתוח, פשוט תחזור
         ליוטיוב וזה שלך. אם לא - תעשה 10 שכיבות סמיכה מול המצלמה ותקבל 10 דקות.
       </p>
       <p class="sheet-note dim">
         זה לא חסימה קשיחה - אפשר לחזור אחורה בלי לעשות כלום. זה חיכוך, וזה מספיק בשביל להפסיק
         לגלול אוטומטית. לחסימה אמיתית צריך "זמן מסך" של אפל עם קוד שההורים מחזיקים.
       </p>
       <div class="sheet-actions">
         <button class="btn btn-fill" id="ghOk">הבנתי</button>
       </div>`,
      (r) => {
        r.querySelector("#ghOk").onclick = closeSheet;
      }
    );
  }

  function renderBonus() {
    const list = $("bonusList");
    const timer = $("bonusTimer");
    timer.textContent = "מתחדש בעוד " + countdownText(bonusMsLeft());

    list.innerHTML = "";
    const done = (state.bonus && state.bonus.doneIds) || [];
    for (const id of (state.bonus && state.bonus.ids) || []) {
      const c = bonusById(id);
      if (!c) continue;
      const isDone = done.includes(id);
      const m = modeOf(c);
      const worth = Math.round(c.points * BONUS_MULTIPLIER * activePenalty());
      const li = document.createElement("li");
      li.className = "row bonus-row" + (isDone ? " is-done" : " is-tappable");
      li.innerHTML = `
        <span class="launch${c.verify === "camera" || c.verify === "hold" ? " is-cam" : ""}">
          <svg class="ico"><use href="#${m.icon}"/></svg>
        </span>
        <div class="row-main">
          <span class="row-title${isDone ? " is-done" : ""}">${esc(c.title)} · ${esc(targetLabel(c))}</span>
          <span class="row-sub${c.verify === "camera" || c.verify === "hold" ? " is-cam" : ""}">${isDone ? "הושלם" : esc(m.text)}</span>
        </div>
        <span class="row-pts is-bonus">+${worth}</span>
      `;
      if (!isDone) {
        li.setAttribute("role", "button");
        li.setAttribute("tabindex", "0");
        const go = () => startBonus(id);
        li.onclick = go;
        li.onkeydown = (e) => {
          if (e.key === "Enter" || e.key === " ") { e.preventDefault(); go(); }
        };
      }
      list.appendChild(li);
    }
  }

  function startBonus(id) {
    const c = bonusById(id);
    if (!c) return;
    const done = (state.bonus && state.bonus.doneIds) || [];
    if (done.includes(id)) return;
    primeAudio();
    // Bonus challenges award through the same verified paths as everything
    // else - they're worth more, not easier.
    const shim = { ...c, __bonus: true };
    if (c.verify === "camera") openCamera(shim);
    else if (c.verify === "hold") openHold(shim);
    else if (c.verify === "run") openRun(shim);
    else if (c.verify === "timer") openTimer(shim);
    else award(shim, 0);
  }

  function renderNudge() {
    const panel = $("nudgePanel");
    const mult = activePenalty();
    if (mult > 1) {
      panel.hidden = false;
      const percent = Math.round(mult * 100);
      $("nudgeText").innerHTML =
        `נקבע לך תירוץ שדורש השלמה. האימון הבא יהיה <b>פי ${mult}</b> - גם הכפול נקודות וגם ${percent}% מהיעד. אחרי אימון אחד כזה, הכל חוזר לרגיל.`;
      return;
    }
    const c = topBoosted();
    if (!c || state.doneToday.includes(c.id)) {
      panel.hidden = true;
      return;
    }
    panel.hidden = false;
    const gap = daysSkipped(c);
    $("nudgeText").innerHTML =
      `לא עשית <b>${esc(c.title)}</b> כבר ${plural(gap, "יום", "ימים")}, אז שווה עכשיו ` +
      `<b>${pts(worthOf(c))}</b> במקום ${c.points}. ככל שתמשיך לדלג, זה יעלה עוד.`;
  }

  function renderGoal() {
    const el = $("goalText");
    const has = state.goal && state.goal.trim();
    el.textContent = has ? state.goal : "קבע יעד שתרצה להגיע אליו";
    el.classList.toggle("is-empty", !has);
  }

  // The lobby summarises today; all-time totals live on the points tab, so the
  // two panels never repeat the same number.
  function renderStats() {
    const done = state.challenges.length - pending().length;
    const t = state.log[today()] || { n: 0, p: 0, r: 0 };
    const cells = [
      [done + "/" + state.challenges.length, "אימונים היום"],
      [t.p, "נקודות היום"],
      [t.r, "חזרות היום"],
      [state.redeemed.length, "פרסים שקנית"],
    ];
    $("statsGrid").innerHTML = cells
      .map(
        ([v, k]) =>
          `<div class="stat"><span class="stat-val">${esc(String(v))}</span><span class="stat-key">${esc(k)}</span></div>`
      )
      .join("");
  }

  // ---------- Progress ----------

  function lastDays(n) {
    const out = [];
    const now = new Date();
    for (let i = n - 1; i >= 0; i--) {
      const d = new Date(now);
      d.setDate(now.getDate() - i);
      const key = d.toISOString().slice(0, 10);
      const e = state.log[key] || { n: 0, p: 0, r: 0 };
      out.push({ key, date: d, n: e.n, p: e.p, r: e.r });
    }
    return out;
  }

  let chartAnimated = false;
  function renderProgress() {
    $("ptsBalance").textContent = state.points;
    $("ptsEarned").textContent = "צברת " + pts(state.totalEarned) + " מאז שהתחלת";

    const days = lastDays(CHART_DAYS);
    const peak = Math.max(...days.map((d) => d.p), 0);
    const t = today();
    const shouldAnimate = !chartAnimated;
    chartAnimated = true;

    const plot = $("chartPlot");
    const axis = $("chartAxis");
    plot.innerHTML = "";
    axis.innerHTML = "";

    for (const d of days) {
      const isToday = d.key === t;
      // Bars share one colour - height already encodes magnitude, so tinting
      // by value would spend the colour channel on nothing.
      const h = peak > 0 ? Math.round((d.p / peak) * 100) : 0;

      const btn = document.createElement("button");
      btn.className = "bar";
      btn.type = "button";
      btn.setAttribute(
        "aria-label",
        `${d.date.getDate()}/${d.date.getMonth() + 1}: ${pts(d.p)}, ${workouts(d.n)}`
      );
      const fill = document.createElement("span");
      fill.className =
        "bar-fill" + (d.p === 0 ? " is-zero" : "") + (isToday && d.p > 0 ? " is-today" : "");
      fill.style.height = d.p === 0 ? "3px" : Math.max(6, h) + "%";
      if (shouldAnimate) {
        // Stagger the grow-in from left-to-right on first paint only.
        fill.style.animationDelay = ((CHART_DAYS - 1 - days.indexOf(d)) * 26) + "ms";
      } else {
        fill.style.animation = "none";
      }
      btn.appendChild(fill);
      btn.onclick = () => pickDay(d, btn);
      plot.appendChild(btn);

      const tick = document.createElement("span");
      if (isToday) tick.className = "is-today";
      tick.textContent = d.date.getDate();
      axis.appendChild(tick);
    }

    // Direct-label only what matters instead of a number on every bar.
    const best = days.reduce((a, b) => (b.p > a.p ? b : a), days[0]);
    const readout = $("chartReadout");
    readout.classList.remove("is-live");
    if (peak === 0) {
      readout.textContent = "עוד אין נתונים. כל אימון שתסיים יופיע כאן.";
    } else {
      readout.textContent =
        `היום הכי טוב שלך: ${best.date.getDate()}/${best.date.getMonth() + 1} עם ${pts(best.p)}`;
    }

    const tbody = $("chartTable").querySelector("tbody");
    tbody.innerHTML = days
      .map(
        (d) =>
          `<tr><td>${d.date.getDate()}/${d.date.getMonth() + 1}</td><td>${d.n}</td><td>${d.p}</td></tr>`
      )
      .join("");

    renderRecords();
    renderBreakdown();
    renderBoards();
  }

  let recordFilter = "all";
  function renderRecords() {
    // Segmented tabs: הכל first, then each exercise the user has ever done.
    const seg = $("recordSeg");
    const options = [{ id: "all", title: "הכל" }];
    for (const c of state.challenges) {
      const wc = state.workoutCount && state.workoutCount[c.id];
      if (wc && wc.n > 0) options.push({ id: c.id, title: c.title });
    }
    // If the current filter was removed (challenge deleted), fall back to all.
    if (!options.some((o) => o.id === recordFilter)) recordFilter = "all";

    seg.innerHTML = options
      .map(
        (o) =>
          `<button class="seg-btn${o.id === recordFilter ? " is-on" : ""}" data-id="${o.id}">${esc(o.title)}</button>`
      )
      .join("");
    for (const b of seg.querySelectorAll(".seg-btn")) {
      b.onclick = () => {
        recordFilter = b.dataset.id;
        renderRecords();
      };
    }

    const recs = recordFilter === "all" ? overallRecords() : perExerciseRecords(recordFilter);
    $("recordGrid").innerHTML = recs
      .map(
        ([v, k]) =>
          `<div class="stat"><span class="stat-val">${esc(String(v))}</span><span class="stat-key">${esc(k)}</span></div>`
      )
      .join("");
  }

  function overallRecords() {
    const totalWorkouts = Object.values(state.log).reduce((s, e) => s + e.n, 0);
    const activeDays = Object.values(state.log).filter((e) => e.n > 0).length;
    return [
      [state.streak, "רצף נוכחי"],
      [state.bestStreak || 0, "הרצף הכי ארוך"],
      [totalWorkouts, "אימונים בסך הכל"],
      [state.totalReps, "חזרות שנספרו"],
      [activeDays, "ימים פעילים"],
      [state.redeemed.length, "פרסים שקנית"],
    ];
  }

  function perExerciseRecords(id) {
    const c = state.challenges.find((x) => x.id === id);
    const wc = (state.workoutCount && state.workoutCount[id]) || { n: 0, r: 0, p: 0 };
    // Best rep count OR seconds isn't tracked per-session yet - show what we have.
    const avgReps = wc.n > 0 ? Math.round(wc.r / wc.n) : 0;
    const avgPts = wc.n > 0 ? Math.round(wc.p / wc.n) : 0;
    const isCam = c && (c.verify === "camera" || c.verify === "hold");
    return [
      [wc.n, "פעמים עשית"],
      [wc.p, "נקודות מזה"],
      [isCam ? wc.r : "-", "חזרות נספרו"],
      [avgReps || "-", "ממוצע לאימון"],
      [avgPts, "ממוצע נקודות"],
      [c ? c.points : 0, "נקודות בסיס"],
    ];
  }

  // ---------- Leaderboards ----------

  let Board = null; // lazily imported
  async function board() {
    if (!Board) Board = await import("./board.js");
    return Board;
  }

  function myTotals() {
    const workouts = Object.values(state.log).reduce((s, e) => s + e.n, 0);
    return {
      name: state.playerName || "אני",
      points: state.totalEarned,
      reps: state.totalReps,
      streak: state.bestStreak || 0,
      workouts,
    };
  }

  async function renderBoards() {
    const wrap = $("boardList");
    const boards = state.boards || [];
    $("boardsEmpty").hidden = boards.length > 0;
    wrap.innerHTML = "";
    if (!boards.length) return;

    const B = await board();
    const mine = myTotals();

    boards.forEach((bd, bi) => {
      const entries = B.rank([mine, ...bd.entries], bd.metric);
      const label = (B.METRICS[bd.metric] || B.METRICS.points).label;
      const sec = document.createElement("div");
      sec.className = "board";
      sec.innerHTML = `
        <div class="board-head">
          <span class="board-name"><svg class="ico"><use href="#i-trophy"/></svg>${esc(bd.name)}</span>
          <span class="board-metric">${esc(label)}</span>
        </div>
        <ol class="board-rows"></ol>
        <div class="board-actions">
          <button class="mini-btn" data-add="${bi}">+ הוסף קוד</button>
          <button class="mini-btn quiet" data-del="${bi}">מחק טבלה</button>
        </div>
      `;
      const ol = sec.querySelector(".board-rows");
      const key = (B.METRICS[bd.metric] || B.METRICS.points).key;
      entries.forEach((e, i) => {
        const isMe = e === mine;
        const li = document.createElement("li");
        li.className = "board-row" + (isMe ? " is-me" : "");
        li.innerHTML = `
          <span class="board-place${i === 0 ? " is-first" : ""}">${i + 1}</span>
          <span class="board-who">${esc(e.name)}${isMe ? " (אתה)" : ""}</span>
          <span class="board-score">${e[key] ?? 0}</span>
        `;
        ol.appendChild(li);
      });
      sec.querySelector("[data-add]").onclick = () => addEntrySheet(bi);
      sec.querySelector("[data-del]").onclick = () => {
        state.boards.splice(bi, 1);
        save();
        render();
      };
      wrap.appendChild(sec);
    });
  }

  async function myCardSheet() {
    const B = await board();
    if (!state.playerName) {
      openSheet(
        `<h2 class="sheet-title">איך קוראים לך?</h2>
         <p class="sheet-note">השם הזה יופיע בטבלאות של החברים שלך.</p>
         <input class="field" id="pnIn" maxlength="18" placeholder="השם שלך" />
         <div class="sheet-actions">
           <button class="btn btn-quiet" id="pnNo">ביטול</button>
           <button class="btn btn-fill" id="pnYes">המשך</button>
         </div>`,
        (r) => {
          const inp = r.querySelector("#pnIn");
          inp.focus();
          r.querySelector("#pnNo").onclick = closeSheet;
          r.querySelector("#pnYes").onclick = () => {
            const v = inp.value.trim();
            if (!v) return;
            state.playerName = v;
            save();
            closeSheet();
            setTimeout(myCardSheet, 60);
          };
        }
      );
      return;
    }

    const code = B.makeCard(myTotals());
    openSheet(
      `<h2 class="sheet-title">הקוד שלך</h2>
       <p class="sheet-note">שלח את זה לחברים בוואטסאפ. הם מדביקים אותו בטבלה שלהם ואתה מופיע בדירוג.</p>
       <div class="code-box" id="codeBox" dir="ltr">${esc(code)}</div>
       <div class="sheet-actions">
         <button class="btn btn-quiet" id="ccName">שנה שם</button>
         <button class="btn btn-fill" id="ccCopy">העתק</button>
       </div>`,
      (r) => {
        r.querySelector("#ccName").onclick = () => {
          state.playerName = "";
          save();
          closeSheet();
          setTimeout(myCardSheet, 60);
        };
        r.querySelector("#ccCopy").onclick = async () => {
          try {
            await navigator.clipboard.writeText(code);
            toast("הקוד הועתק");
          } catch (e) {
            // Clipboard is blocked in some contexts; select it so a long-press
            // copy still works instead of leaving a dead button.
            const el = r.querySelector("#codeBox");
            const range = document.createRange();
            range.selectNodeContents(el);
            const sel = getSelection();
            sel.removeAllRanges();
            sel.addRange(range);
            toast("סמן והעתק ידנית");
          }
          closeSheet();
        };
      }
    );
  }

  async function newBoardSheet() {
    const B = await board();
    const opts = Object.entries(B.METRICS)
      .map(([id, m], i) => `<option value="${id}"${i === 0 ? " selected" : ""}>${esc(m.label)}</option>`)
      .join("");
    openSheet(
      `<h2 class="sheet-title">טבלה חדשה</h2>
       <input class="field" id="bnIn" maxlength="24" placeholder="שם הטבלה, למשל: הכיתה" />
       <label class="field-label">לפי מה מדרגים</label>
       <select class="field" id="bmIn">${opts}</select>
       <div class="sheet-actions">
         <button class="btn btn-quiet" id="bnNo">ביטול</button>
         <button class="btn btn-fill" id="bnYes">צור</button>
       </div>`,
      (r) => {
        r.querySelector("#bnIn").focus();
        r.querySelector("#bnNo").onclick = closeSheet;
        r.querySelector("#bnYes").onclick = () => {
          const name = r.querySelector("#bnIn").value.trim();
          if (!name) return;
          state.boards.push({
            name,
            metric: r.querySelector("#bmIn").value,
            entries: [],
          });
          save();
          render();
          closeSheet();
        };
      }
    );
  }

  async function addEntrySheet(bi) {
    const B = await board();
    openSheet(
      `<h2 class="sheet-title">הוסף חבר</h2>
       <p class="sheet-note">הדבק כאן את הקוד שהחבר שלך שלח.</p>
       <textarea class="field excuse-input" id="cdIn" rows="3" dir="ltr" placeholder="K1.…"></textarea>
       <p class="sheet-note dim" id="cdErr" hidden>הקוד לא תקין. בקש מהחבר לשלוח שוב.</p>
       <div class="sheet-actions">
         <button class="btn btn-quiet" id="cdNo">ביטול</button>
         <button class="btn btn-fill" id="cdYes">הוסף</button>
       </div>`,
      (r) => {
        const inp = r.querySelector("#cdIn");
        inp.focus();
        r.querySelector("#cdNo").onclick = closeSheet;
        r.querySelector("#cdYes").onclick = () => {
          const card = B.readCard(inp.value);
          if (!card) {
            r.querySelector("#cdErr").hidden = false;
            return;
          }
          const bd = state.boards[bi];
          // Re-pasting a friend's newer card updates them instead of
          // listing the same person twice.
          const at = bd.entries.findIndex((e) => e.name === card.name);
          if (at >= 0) bd.entries[at] = card;
          else bd.entries.push(card);
          save();
          render();
          closeSheet();
          toast(at >= 0 ? "עודכן: " + card.name : "נוסף: " + card.name);
        };
      }
    );
  }

  function boardHelpSheet() {
    openSheet(
      `<h2 class="sheet-title">למה אין טופ עולמי אמיתי</h2>
       <p class="sheet-note">
         טבלה עולמית אמיתית דורשת <b>שרת ומסד נתונים</b> שרצים 24/7 - מישהו צריך לתחזק ולשלם
         עליהם. האפליקציה הזאת בכוונה בלי שרת בכלל, ולכן היא גם עובדת בלי אינטרנט ולא עולה כלום.
       </p>
       <p class="sheet-note">
         במקום זה: כל אחד מייצר <b>קוד אישי</b> עם המספרים שלו, שולח בוואטסאפ, ואתה מדביק אותו
         בטבלה. הדירוג מחושב אצלך במכשיר. אפשר ליצור כמה טבלאות שרוצים - לפי נקודות, חזרות,
         רצף או מספר אימונים.
       </p>
       <p class="sheet-note dim">
         שים לב: הקוד מוגן מפני שגיאות הקלדה, אבל לא מפני מישהו שמחליט לשקר במספרים שלו.
         בין חברים זה בסדר. אם תרצה טבלה עולמית אמיתית - צריך להוסיף שרת, ואפשר לבנות את זה.
       </p>
       <div class="sheet-actions">
         <button class="btn btn-fill" id="bhOk">הבנתי</button>
       </div>`,
      (r) => {
        r.querySelector("#bhOk").onclick = closeSheet;
      }
    );
  }

  function renderBreakdown() {
    const list = $("breakdownList");
    list.innerHTML = "";
    const rows = state.challenges
      .map((c) => {
        const wc = (state.workoutCount && state.workoutCount[c.id]) || { n: 0, r: 0, p: 0 };
        return { c, wc };
      })
      .sort((a, b) => b.wc.n - a.wc.n);

    for (const { c, wc } of rows) {
      const li = document.createElement("li");
      li.className = "breakdown-item";
      const sub =
        c.verify === "camera" && wc.r > 0
          ? `<span class="breakdown-sub">${wc.r} חזרות בסך הכל</span>`
          : "";
      li.innerHTML = `
        <div class="breakdown-title"><span>${esc(c.title)}</span>${sub}</div>
        <div class="breakdown-nums">
          <span class="breakdown-count">${workouts(wc.n)}</span>
          <span class="breakdown-pts">${wc.p} נק'</span>
        </div>
      `;
      list.appendChild(li);
    }
  }

  function pickDay(d, btn) {
    for (const b of document.querySelectorAll(".bar")) b.classList.remove("is-picked");
    btn.classList.add("is-picked");
    const readout = $("chartReadout");
    readout.classList.add("is-live");
    const label = `${d.date.getDate()}/${d.date.getMonth() + 1}`;
    readout.textContent =
      d.n === 0
        ? `${label} — לא היה אימון`
        : `${label} — ${workouts(d.n)}, ${pts(d.p)}${d.r ? `, ${repCount(d.r)}` : ""}`;
  }

  // Whichever routine claims today, unless you've tapped another tab to peek.
  function routineForToday() {
    const dow = new Date().getDay();
    return (state.routines || []).find((r) => (r.days || []).includes(dow)) || null;
  }

  function shownRoutine() {
    const rs = state.routines || [];
    if (state.routinePick) {
      const picked = rs.find((r) => r.id === state.routinePick);
      if (picked) return picked;
    }
    return routineForToday() || rs[0] || null;
  }

  const minsNow = () => {
    const d = new Date();
    return d.getHours() * 60 + d.getMinutes();
  };
  const parseHM = (t) => {
    const m = /^(\d{1,2}):(\d{2})$/.exec(t || "");
    return m ? Number(m[1]) * 60 + Number(m[2]) : null;
  };

  /** Workout slots in today's routine, with their times resolved. */
  function todaysSlots() {
    const r = routineForToday();
    if (!r) return [];
    return r.items
      .filter((i) => i.workout && parseHM(i.time) !== null)
      .map((i) => ({ ...i, at: parseHM(i.time) }))
      .sort((a, b) => a.at - b.at);
  }

  /** The next slot still ahead of you today. */
  function nextSlot() {
    const now = minsNow();
    return todaysSlots().find((s) => s.at > now) || null;
  }

  /** A slot whose time has come and gone with nothing done. */
  function overdueSlot() {
    if (state.doneToday.length > 0) return null;
    const now = minsNow();
    const past = todaysSlots().filter((s) => now - s.at >= SLOT_GRACE_MIN);
    return past.length ? past[past.length - 1] : null;
  }

  function renderRoutine() {
    const rs = state.routines || [];
    const today = routineForToday();
    const shown = shownRoutine();
    const dow = new Date().getDay();

    $("routineToday").textContent = today
      ? `יום ${DAY_LONG[dow]} · ${today.name}`
      : `יום ${DAY_LONG[dow]}`;

    // Tabs only earn their space once there's more than one schedule.
    const seg = $("routineSeg");
    seg.hidden = rs.length < 2;
    seg.innerHTML = rs
      .map(
        (r) =>
          `<button class="seg-btn${shown && r.id === shown.id ? " is-on" : ""}" data-id="${esc(r.id)}">${esc(r.name)}${
            today && r.id === today.id ? " ·" : ""
          }</button>`
      )
      .join("");
    for (const b of seg.querySelectorAll(".seg-btn")) {
      b.onclick = () => {
        state.routinePick = b.dataset.id;
        save();
        renderRoutine();
      };
    }

    const list = $("routineList");
    list.innerHTML = "";
    $("routineEmpty").hidden = !!shown;
    if (!shown) return;

    // Only mark up/down state on the routine that actually governs today.
    const isToday = today && shown.id === today.id;
    const nxt = isToday ? nextSlot() : null;
    const late = isToday ? overdueSlot() : null;

    for (const item of shown.items) {
      const li = document.createElement("li");
      const isNext = nxt && nxt.id === item.id;
      const isLate = late && late.id === item.id;
      li.className =
        "routine-item" + (isNext ? " is-next" : "") + (isLate ? " is-late" : "");
      const at = parseHM(item.time);
      let note = "";
      if (isLate) {
        note = `<span class="routine-flag">עבר לפני ${plural(Math.round((minsNow() - at) / 60) || 1, "שעה", "שעות")}</span>`;
      } else if (isNext) {
        const left = at - minsNow();
        note = `<span class="routine-flag">בעוד ${left >= 60 ? plural(Math.round(left / 60), "שעה", "שעות") : plural(left, "דקה", "דקות")}</span>`;
      }
      li.innerHTML = `
        <span class="routine-time${item.time ? "" : " is-empty"}" dir="ltr">${esc(item.time || "לא נקבע")}</span>
        <span class="routine-key">${esc(item.label)}</span>
        ${note}
      `;
      list.appendChild(li);
    }
  }

  function renderStore() {
    $("storeBalance").textContent = state.points;
    const list = $("storeList");
    list.innerHTML = "";
    for (const it of state.store) {
      const can = state.points >= it.cost;
      const li = document.createElement("li");
      li.className = "row";
      li.innerHTML = `
        <div class="row-main">
          <span class="row-title">${esc(it.title)}</span>
          <span class="row-sub">${pts(it.cost)}</span>
        </div>
        <button class="buy"${can ? "" : " disabled"}>קנה</button>
        <button class="mini-x" aria-label="מחק"><svg class="ico"><use href="#i-close"/></svg></button>
      `;
      if (can) li.querySelector(".buy").onclick = () => buy(it.id);
      li.querySelector(".mini-x").onclick = () => {
        state.store = state.store.filter((x) => x.id !== it.id);
        save();
        render();
      };
      list.appendChild(li);
    }

    const hist = $("historyList");
    const recent = state.redeemed.slice(-8).reverse();
    $("historyEmpty").hidden = recent.length !== 0;
    hist.innerHTML = recent
      .map(
        (r) => `
      <li class="row">
        <div class="row-main">
          <span class="row-title">${esc(r.title)}</span>
          <span class="row-sub">${esc(r.date)}</span>
        </div>
        <span class="row-pts">-${r.cost}</span>
      </li>`
      )
      .join("");
  }

  // ---------- Earning ----------

  // Camera fallback: 30% points, no penalty consumption. Only unlocked after
  // the camera has actually tried and failed to detect the user for a while,
  // so it never becomes a one-tap shortcut.
  function partialAward(c) {
    const isBonus = !!c.__bonus;
    const doneList = isBonus ? (state.bonus.doneIds = state.bonus.doneIds || []) : state.doneToday;
    if (doneList.includes(c.id)) return;
    const t = today();
    const base = isBonus ? c.points * BONUS_MULTIPLIER : c.points + boostOf(c); // NOT multiplied by penalty
    const gained = Math.max(1, Math.round(base * 0.3));

    if (state.lastDoneDate !== t) {
      state.streak = state.lastDoneDate && dayGap(state.lastDoneDate, t) === 1 ? state.streak + 1 : 1;
      state.lastDoneDate = t;
    }
    if (state.streak > (state.bestStreak || 0)) state.bestStreak = state.streak;

    state.points += gained;
    state.totalEarned += gained;
    doneList.push(c.id);
    if (!isBonus) state.lastDoneBy[c.id] = t;

    const day = (state.log[t] = state.log[t] || { n: 0, p: 0, r: 0 });
    day.n += 1;
    day.p += gained;

    const wc = (state.workoutCount[c.id] = state.workoutCount[c.id] || { n: 0, r: 0, p: 0 });
    wc.n += 1;
    wc.p += gained;

    save();
    render();
    toast(`אישור ידני - ${gained} נקודות (30%)`);
  }

  function award(c, reps, durationMs) {
    // The gate task pays a pass, not a place on the daily list.
    if (c.__gate) {
      grantGatePass();
      cheer();
      burstConfetti();
      toast("נפתח ל-10 דקות");
      return;
    }
    const isBonus = !!c.__bonus;
    const doneList = isBonus ? (state.bonus.doneIds = state.bonus.doneIds || []) : state.doneToday;
    if (doneList.includes(c.id)) return;

    // Bonus challenges pay the 1.5x rate; regular ones pay their normal worth.
    const gained = isBonus
      ? Math.round(c.points * BONUS_MULTIPLIER * activePenalty())
      : worthOf(c);
    const t = today();

    if (state.lastDoneDate !== t) {
      state.streak = state.lastDoneDate && dayGap(state.lastDoneDate, t) === 1 ? state.streak + 1 : 1;
      state.lastDoneDate = t;
    }
    if (state.streak > (state.bestStreak || 0)) state.bestStreak = state.streak;

    state.points += gained;
    state.totalEarned += gained;
    if (reps) state.totalReps += reps;
    doneList.push(c.id);
    if (!isBonus) state.lastDoneBy[c.id] = t;

    // Daily log feeds the progress chart.
    const day = (state.log[t] = state.log[t] || { n: 0, p: 0, r: 0 });
    day.n += 1;
    day.p += gained;
    day.r += reps || 0;

    // Per-workout lifetime totals for the breakdown panel.
    const wc = (state.workoutCount[c.id] = state.workoutCount[c.id] || { n: 0, r: 0, p: 0 });
    wc.n += 1;
    wc.r += reps || 0;
    wc.p += gained;

    // The penalty is a one-shot: once you serve it (do the harder rep),
    // the debt is paid and further workouts today are at normal cost.
    if (activePenalty() > 1) {
      state.penalty = 1.0;
      state.penaltyDate = null;
    }

    const levelUp = recordPace(c, reps, durationMs);

    save();
    render();
    cheer();
    if (levelUp) {
      burstConfetti();
      setTimeout(() => levelUpSheet(levelUp), 900);
      toast(`+${gained} נקודות`);
    } else {
      showWin(gained);
    }
  }

  function buy(id) {
    const it = state.store.find((x) => x.id === id);
    if (!it || state.points < it.cost) return;
    state.points -= it.cost;
    state.redeemed.push({ title: it.title, cost: it.cost, date: today() });
    save();
    render();
    toast("קנית: " + it.title);
  }

  function showWin(pts) {
    burstConfetti();
    openSheet(
      `<h2 class="sheet-title">כל הכבוד</h2>
       <div class="win"><span class="win-num">+${pts}</span><span class="win-key">נקודות</span></div>`
    );
    setTimeout(closeSheet, 1400);
  }

  // A tiny SVG confetti burst on workout completion. All particles share the
  // same ember/warn palette so it feels like the scoreboard reacting, not
  // a foreign flourish, and cleans itself up in under a second.
  function burstConfetti() {
    if (matchMedia && matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const svgNS = "http://www.w3.org/2000/svg";
    const svg = document.createElementNS(svgNS, "svg");
    svg.setAttribute("class", "confetti");
    svg.setAttribute("viewBox", "0 0 100 100");
    svg.setAttribute("preserveAspectRatio", "none");
    const colors = ["#FF6B2C", "#FFB020", "#EDF0F4", "#38E1D0"];
    for (let i = 0; i < 22; i++) {
      const r = document.createElementNS(svgNS, "rect");
      const size = 1 + Math.random() * 2;
      r.setAttribute("width", size);
      r.setAttribute("height", size * (1 + Math.random()));
      r.setAttribute("x", 50);
      r.setAttribute("y", 50);
      r.setAttribute("fill", colors[i % colors.length]);
      r.setAttribute("transform", `rotate(${Math.random() * 360} 50 50)`);
      const dx = (Math.random() - 0.5) * 90;
      const dy = -Math.random() * 60 - 10;
      r.style.setProperty("--dx", dx + "px");
      r.style.setProperty("--dy", dy + "px");
      r.style.setProperty("--spin", Math.floor(Math.random() * 720) + "deg");
      r.style.animation = `confetti-fly ${700 + Math.random() * 400}ms cubic-bezier(0.22, 1, 0.36, 1) forwards`;
      r.style.animationDelay = Math.random() * 60 + "ms";
      svg.appendChild(r);
    }
    document.body.appendChild(svg);
    setTimeout(() => svg.remove(), 1300);
  }

  // ---------- Sheets ----------

  const scrim = $("scrim");
  const sheet = $("sheet");
  let onSheetClose = null;

  function openSheet(html, mount) {
    if (onSheetClose) {
      onSheetClose();
      onSheetClose = null;
    }
    sheet.innerHTML = html;
    scrim.hidden = false;
    if (mount) mount(sheet);
  }

  function closeSheet() {
    if (onSheetClose) {
      onSheetClose();
      onSheetClose = null;
    }
    scrim.hidden = true;
    sheet.innerHTML = "";
  }

  scrim.onclick = (e) => {
    if (e.target === scrim) closeSheet();
  };

  function goalSheet() {
    openSheet(
      `<h2 class="sheet-title">היעד שלך</h2>
       <input class="field" id="gIn" placeholder="למשל: 30 שכיבות סמיכה ברצף" value="${esc(state.goal || "")}" />
       <div class="sheet-actions">
         <button class="btn btn-quiet" id="gNo">ביטול</button>
         <button class="btn btn-fill" id="gYes">שמור</button>
       </div>`,
      (r) => {
        const inp = r.querySelector("#gIn");
        inp.focus();
        r.querySelector("#gNo").onclick = closeSheet;
        r.querySelector("#gYes").onclick = () => {
          state.goal = inp.value.trim();
          save();
          render();
          closeSheet();
        };
      }
    );
  }

  function addChallengeSheet() {
    openSheet(
      `<h2 class="sheet-title">אימון חדש</h2>
       <p class="sheet-note">אימון שאתה מוסיף בעצמך מסומן ידנית. ספירה במצלמה עובדת על התרגילים המובנים.</p>
       <input class="field" id="cT" placeholder="שם האימון" />
       <input class="field" id="cP" type="number" inputmode="numeric" min="1" value="10" placeholder="נקודות" />
       <div class="sheet-actions">
         <button class="btn btn-quiet" id="cNo">ביטול</button>
         <button class="btn btn-fill" id="cYes">הוסף</button>
       </div>`,
      (r) => {
        r.querySelector("#cT").focus();
        r.querySelector("#cNo").onclick = closeSheet;
        r.querySelector("#cYes").onclick = () => {
          const title = r.querySelector("#cT").value.trim();
          if (!title) return;
          const points = Math.max(1, parseInt(r.querySelector("#cP").value, 10) || 10);
          state.challenges.push({ id: uid("c"), title, points, verify: "manual" });
          save();
          render();
          closeSheet();
        };
      }
    );
  }

  // Shrinks a captured photo to a thumbnail before it ever touches storage -
  // the full-size shot is never kept, and nothing leaves the device.
  function shrinkPhoto(file, px = 128) {
    return new Promise((resolve) => {
      const url = URL.createObjectURL(file);
      const img = new Image();
      img.onload = () => {
        const scale = Math.min(1, px / Math.max(img.width, img.height));
        const cv = document.createElement("canvas");
        cv.width = Math.max(1, Math.round(img.width * scale));
        cv.height = Math.max(1, Math.round(img.height * scale));
        cv.getContext("2d").drawImage(img, 0, 0, cv.width, cv.height);
        URL.revokeObjectURL(url);
        try {
          resolve(cv.toDataURL("image/jpeg", 0.5));
        } catch (e) {
          resolve(null);
        }
      };
      img.onerror = () => {
        URL.revokeObjectURL(url);
        resolve(null);
      };
      img.src = url;
    });
  }

  function askForPhoto() {
    return new Promise((resolve) => {
      const inp = $("proofInput");
      inp.value = "";
      let settled = false;
      const finish = async (file) => {
        if (settled) return;
        settled = true;
        inp.removeEventListener("change", onChange);
        inp.removeEventListener("cancel", onCancel);
        resolve(file ? await shrinkPhoto(file) : null);
      };
      const onChange = () => finish(inp.files && inp.files[0]);
      // Backing out of the camera must clear the listener, otherwise a second
      // attempt stacks another one on the same input.
      const onCancel = () => finish(null);
      inp.addEventListener("change", onChange);
      inp.addEventListener("cancel", onCancel);
      inp.click();
    });
  }

  async function openExcuseSheet() {
    if (todaysExcuse()) return; // one excuse per day is the whole point
    const { judge } = await import("./excuse.js");
    openSheet(
      `<h2 class="sheet-title">מה קרה היום?</h2>
       <p class="sheet-note">כתוב במשפט או שניים למה אתה לא מתאמן. תכתוב אמת - הוא זוכר מה אמרת בעבר.</p>
       <textarea class="field excuse-input" id="exIn" rows="3" placeholder="לדוגמה: יש לי חום ולא ישנתי"></textarea>
       <div class="sheet-actions">
         <button class="btn btn-quiet" id="exNo">ביטול</button>
         <button class="btn btn-fill" id="exYes">שלח למאמן</button>
       </div>`,
      (r) => {
        const inp = r.querySelector("#exIn");
        inp.focus();
        r.querySelector("#exNo").onclick = closeSheet;
        r.querySelector("#exYes").onclick = async () => {
          const text = inp.value.trim();
          if (!text) return;
          const v = judge(text, {
            history: state.excuseHistory || [],
            today: today(),
            penaltyPending: activePenalty() > 1,
          });

          if (v.needsPhoto) {
            closeSheet();
            setTimeout(() => proofSheet(text, v), 50);
            return;
          }
          applyExcuse(text, v, null);
          closeSheet();
          setTimeout(() => showExcuseVerdict(v), 50);
        };
      }
    );
  }

  // The coach asked for proof. Refusing is allowed, but it costs the claim.
  function proofSheet(text, v) {
    openSheet(
      `<h2 class="sheet-title">תראה לי</h2>
       <p class="sheet-note">${esc(v.notes.join(" "))}</p>
       <p class="sheet-note">צלם עכשיו את מה שאתה מתאר - התמונה נשארת על המכשיר שלך בלבד ולא נשלחת לאף אחד.</p>
       <div class="sheet-actions">
         <button class="btn btn-quiet" id="pfSkip">אין לי תמונה</button>
         <button class="btn btn-fill" id="pfGo">פתח מצלמה</button>
       </div>`,
      (r) => {
        r.querySelector("#pfGo").onclick = async () => {
          const thumb = await askForPhoto();
          if (!thumb) return; // camera cancelled - stay on the sheet
          applyExcuse(text, v, thumb);
          closeSheet();
          setTimeout(() => showExcuseVerdict(v), 50);
        };
        r.querySelector("#pfSkip").onclick = () => {
          // No proof means the serious claim isn't credited.
          const denied = {
            ...v,
            verdict: "excuse",
            penalty: 1.5,
            label: "בלי הוכחה",
            tone: "bad",
            reply: "בלי תמונה אני לא יכול לקבל את זה. האימון הבא שווה 1.5.",
          };
          applyExcuse(text, denied, null);
          closeSheet();
          setTimeout(() => showExcuseVerdict(denied), 50);
        };
      }
    );
  }

  function applyExcuse(text, v, proof) {
    const t = today();
    state.excuseHistory = state.excuseHistory || [];
    state.excuseHistory.push({ date: t, text, verdict: v.verdict, penalty: v.penalty, proof: proof || null });
    // Keep the log short, and keep at most a few thumbnails - localStorage is
    // small and a photo is by far the biggest thing in here.
    if (state.excuseHistory.length > 30) state.excuseHistory = state.excuseHistory.slice(-30);
    const withProof = state.excuseHistory.filter((e) => e.proof);
    if (withProof.length > 6) {
      const drop = new Set(withProof.slice(0, withProof.length - 6));
      for (const e of state.excuseHistory) if (drop.has(e)) e.proof = null;
    }
    if (v.verdict === "legit") {
      // No penalty and the streak is protected for the day.
      state.penalty = 1.0;
      state.penaltyDate = null;
      state.lastDoneDate = t; // mark today as "handled" so streak doesn't die
    } else {
      state.penalty = v.penalty;
      state.penaltyDate = t;
    }
    save();
    render();
  }

  function showExcuseVerdict(v) {
    const toneEmoji = { good: "✓", warn: "!", bad: "✕" };
    openSheet(
      `<h2 class="sheet-title verdict-${v.tone}">
         <span class="verdict-mark">${toneEmoji[v.tone] || ""}</span>
         ${esc(v.label)}
       </h2>
       <p class="sheet-note verdict-reply">${esc(v.reply)}</p>
       <div class="sheet-actions">
         <button class="btn btn-fill" id="vOk">הבנתי</button>
       </div>`,
      (r) => {
        r.querySelector("#vOk").onclick = closeSheet;
      }
    );
  }

  function manageRoutinesSheet() {
    const rs = state.routines || [];
    const rows = rs
      .map((r, i) => {
        const days = (r.days || []).map((d) => DAY_SHORT[d]).join(" ") || "בלי ימים";
        return `<li class="rt-row">
          <button class="rt-main" data-edit="${i}">
            <span class="rt-name">${esc(r.name)}</span>
            <span class="rt-days">${esc(days)}</span>
          </button>
          <button class="mini-x" data-del="${i}" aria-label="מחק"><svg class="ico"><use href="#i-close"/></svg></button>
        </li>`;
      })
      .join("");

    openSheet(
      `<h2 class="sheet-title">סדרי יום</h2>
       <p class="sheet-note">אפשר להחזיק כמה סדרים - למשל יום לימודים וסוף שבוע - ולשייך לכל אחד ימים.</p>
       <ul class="rt-list">${rows || '<li class="done-note">אין סדרי יום</li>'}</ul>
       <div class="sheet-actions">
         <button class="btn btn-quiet" id="rmClose">סגור</button>
         <button class="btn btn-fill" id="rmNew">סדר חדש</button>
       </div>`,
      (r) => {
        r.querySelector("#rmClose").onclick = closeSheet;
        r.querySelector("#rmNew").onclick = () => editRoutineSheet(null);
        for (const b of r.querySelectorAll("[data-edit]")) {
          b.onclick = () => editRoutineSheet(Number(b.dataset.edit));
        }
        for (const b of r.querySelectorAll("[data-del]")) {
          b.onclick = () => {
            state.routines.splice(Number(b.dataset.del), 1);
            state.routinePick = null;
            save();
            render();
            manageRoutinesSheet();
          };
        }
      }
    );
  }

  function editRoutineSheet(index) {
    const isNew = index === null;
    const r = isNew
      ? { id: uid("rt"), name: "", days: [], items: DEFAULT_ROUTINE.map((x) => ({ ...x })) }
      : JSON.parse(JSON.stringify(state.routines[index]));

    const dayBtns = DAY_SHORT.map(
      (d, i) =>
        `<button class="day-btn${r.days.includes(i) ? " is-on" : ""}" data-day="${i}" type="button">${d}</button>`
    ).join("");

    const timeRows = r.items
      .map(
        (it) => `
      <label class="routine-edit">
        <span class="routine-edit-label">${esc(it.label)}</span>
        <input class="field routine-edit-time" type="time" data-id="${esc(it.id)}" value="${esc(it.time || "")}" />
      </label>`
      )
      .join("");

    openSheet(
      `<h2 class="sheet-title">${isNew ? "סדר יום חדש" : "עריכת סדר יום"}</h2>
       <input class="field" id="rtName" maxlength="20" placeholder="שם, למשל: יום לימודים" value="${esc(r.name)}" />
       <label class="field-label">באילו ימים</label>
       <div class="day-row" id="rtDays">${dayBtns}</div>
       ${timeRows}
       <div class="sheet-actions">
         <button class="btn btn-quiet" id="rtNo">ביטול</button>
         <button class="btn btn-fill" id="rtYes">שמור</button>
       </div>`,
      (root) => {
        const picked = new Set(r.days);
        for (const b of root.querySelectorAll(".day-btn")) {
          b.onclick = () => {
            const d = Number(b.dataset.day);
            if (picked.has(d)) picked.delete(d);
            else picked.add(d);
            b.classList.toggle("is-on", picked.has(d));
          };
        }
        root.querySelector("#rtNo").onclick = manageRoutinesSheet;
        root.querySelector("#rtYes").onclick = () => {
          const name = root.querySelector("#rtName").value.trim();
          if (!name) return;
          r.name = name;
          r.days = [...picked].sort();
          for (const inp of root.querySelectorAll(".routine-edit-time")) {
            const it = r.items.find((x) => x.id === inp.dataset.id);
            if (it) it.time = inp.value || "";
          }
          // A day can only belong to one routine, so claiming it takes it.
          for (const other of state.routines) {
            if (other.id !== r.id) other.days = (other.days || []).filter((d) => !r.days.includes(d));
          }
          if (isNew) state.routines.push(r);
          else state.routines[index] = r;
          save();
          render();
          manageRoutinesSheet();
        };
      }
    );
  }

  function routineSheet() {
    const rows = state.routine
      .map(
        (r) => `
      <label class="routine-edit">
        <span class="routine-edit-label">${esc(r.label)}</span>
        <input class="field routine-edit-time" type="time" data-id="${r.id}" value="${esc(r.time || "")}" />
      </label>`
      )
      .join("");

    openSheet(
      `<h2 class="sheet-title">סדר יום שלך</h2>
       <p class="sheet-note">קבע את הזמנים שאתה מתכוון להתאמן. אפשר להשאיר ריק.</p>
       ${rows}
       <div class="sheet-actions">
         <button class="btn btn-quiet" id="rNo">ביטול</button>
         <button class="btn btn-fill" id="rYes">שמור</button>
       </div>`,
      (r) => {
        r.querySelector("#rNo").onclick = closeSheet;
        r.querySelector("#rYes").onclick = () => {
          const inputs = r.querySelectorAll(".routine-edit-time");
          for (const inp of inputs) {
            const item = state.routine.find((x) => x.id === inp.dataset.id);
            if (item) item.time = inp.value || "";
          }
          save();
          render();
          closeSheet();
        };
      }
    );
  }

  function addRewardSheet() {
    openSheet(
      `<h2 class="sheet-title">פרס חדש</h2>
       <input class="field" id="sT" placeholder="מה תרצה לקנות לעצמך" />
       <input class="field" id="sC" type="number" inputmode="numeric" min="1" value="50" placeholder="מחיר בנקודות" />
       <div class="sheet-actions">
         <button class="btn btn-quiet" id="sNo">ביטול</button>
         <button class="btn btn-fill" id="sYes">הוסף</button>
       </div>`,
      (r) => {
        r.querySelector("#sT").focus();
        r.querySelector("#sNo").onclick = closeSheet;
        r.querySelector("#sYes").onclick = () => {
          const title = r.querySelector("#sT").value.trim();
          if (!title) return;
          const cost = Math.max(1, parseInt(r.querySelector("#sC").value, 10) || 50);
          state.store.push({ id: uid("s"), title, cost });
          save();
          render();
          closeSheet();
        };
      }
    );
  }

  // ---------- Starting a challenge ----------

  function startChallenge(id) {
    const c = state.challenges.find((x) => x.id === id);
    if (!c || state.doneToday.includes(id)) return;
    primeAudio(); // must happen inside the tap for iOS to allow sound later
    if (c.verify === "camera") openCamera(c);
    else if (c.verify === "hold") openHold(c);
    else if (c.verify === "run") openRun(c);
    else if (c.verify === "timer") openTimer(c);
    else award(c, 0);
  }

  // ---------- Timer ----------

  function openTimer(c) {
    let tick = null;
    const target = scaledTarget(c);
    openSheet(
      `<h2 class="sheet-title">${esc(c.title)}</h2>
       <p class="sheet-note">הטיימר רץ על השעון האמיתי. השאר את המסך פתוח עד הסוף.</p>
       <div class="win"><span class="win-num" id="tClock" dir="ltr">${clock(target)}</span></div>
       <div class="sheet-actions">
         <button class="btn btn-quiet" id="tNo">ביטול</button>
         <button class="btn btn-fill" id="tGo">התחל</button>
       </div>`,
      (r) => {
        const face = r.querySelector("#tClock");
        r.querySelector("#tNo").onclick = closeSheet;
        r.querySelector("#tGo").onclick = (e) => {
          const btn = e.currentTarget;
          btn.disabled = true;
          btn.textContent = "רץ";
          const started = Date.now();
          keepAwake();
          tick = setInterval(() => {
            const left = Math.max(0, target - Math.floor((Date.now() - started) / 1000));
            face.textContent = clock(left);
            if (left === 0) {
              clearInterval(tick);
              releaseAwake();
              onSheetClose = null;
              closeSheet();
              award(c, 0);
            }
          }, 200);
          onSheetClose = () => {
            clearInterval(tick);
            releaseAwake();
          };
        };
      }
    );
  }

  // ---------- Camera ----------

  const cam = {
    root: $("camView"),
    video: $("camVideo"),
    canvas: $("camCanvas"),
    num: $("camNum"),
    of: $("camOf"),
    tally: $("camTally"),
    name: $("camName"),
    hint: $("camHint"),
    depth: $("camDepth"),
    depthWrap: $("camDepthWrap"),
    close: $("camClose"),
    manual: $("camManual"),
    guide: $("frameGuide"),
    guideLabel: $("fgLabel"),
    countdown: $("camCountdown"),
  };

  // Paints the camera overlay for one of the four session phases. Keeping
  // this in one place is what stops the screen from ever showing a live
  // count while the detector is refusing to judge the frame.
  function paintCamPhase({ phase, hint, countdown }) {
    const counting = phase === "counting";
    const setup = phase === "setup";
    const paused = phase === "paused";

    cam.root.classList.toggle("is-paused", paused);
    cam.tally.hidden = setup;
    cam.depthWrap.hidden = !counting;
    cam.guide.hidden = !(setup || paused);
    cam.countdown.hidden = phase !== "countdown";

    if (phase === "countdown" && countdown != null) {
      const txt = String(countdown);
      if (cam.countdown.textContent !== txt) {
        cam.countdown.textContent = txt;
        cam.countdown.classList.remove("cd-anim");
        void cam.countdown.offsetWidth;
        cam.countdown.classList.add("cd-anim");
        blip(520 + (4 - countdown) * 90, 70);
      }
    }

    if (setup || paused) {
      const locked = !hint;
      cam.guide.classList.toggle("is-locked", locked);
      cam.guide.classList.toggle("is-searching", !locked);
      cam.guideLabel.textContent = paused
        ? "עצרנו - חזור למסגרת"
        : locked ? "נעול, מתחילים" : "מחפש אותך…";
    }
    if (hint) cam.hint.textContent = hint;
  }

  let camStop = null;

  function closeCamera() {
    if (camStop) {
      camStop();
      camStop = null;
    }
    releaseAwake();
    cam.root.hidden = true;
    cam.root.classList.remove("is-paused");
    cam.video.srcObject = null;
    cam.depth.style.width = "0%";
    cam.countdown.hidden = true;
    cam.manual.hidden = true;
  }

  cam.close.onclick = closeCamera;

  // Only reveal the manual fallback after this many milliseconds without a
  // successful detection - stops it from being a one-tap shortcut.
  const MANUAL_UNLOCK_MS = 20000;

  function armManualUnlock(c, condition) {
    cam.manual.hidden = true;
    const started = Date.now();
    const tick = setInterval(() => {
      if (cam.root.hidden) { clearInterval(tick); return; }
      if (condition() && Date.now() - started > MANUAL_UNLOCK_MS) {
        cam.manual.hidden = false;
      }
    }, 1000);
    cam.manual.onclick = () => {
      closeCamera();
      partialAward(c);
    };
    return () => clearInterval(tick);
  }

  async function openCamera(c) {
    const firstRun = !state.sawCamera;
    const target = scaledTarget(c);

    cam.root.hidden = false;
    keepAwake();
    cam.name.textContent = c.title;
    cam.num.textContent = "0";
    cam.of.textContent = "/ " + target;
    cam.hint.textContent = firstRun
      ? "מורידים את זיהוי התנועה, פעם אחת בלבד. עדיף על Wi-Fi…"
      : "מכינים את המצלמה…";
    cam.depth.style.width = "0%";
    // Start in the setup look; the session flips this once it can see you.
    paintCamPhase({ phase: "setup", hint: null });
    cam.guideLabel.textContent = "מכינים את המצלמה…";
    let lastRepAt = Date.now();
    const stopUnlock = armManualUnlock(c, () => Date.now() - lastRepAt > MANUAL_UNLOCK_MS);

    // Pace is measured from the first rep to the last, so fiddling with the
    // phone before you start doesn't make you look slow.
    let firstRepAt = null;
    let last = 0;
    try {
      const { startRepSession } = await import("./pose.js");
      camStop = await startRepSession({
        video: cam.video,
        canvas: cam.canvas,
        exercise: c.exercise,
        target,
        onUpdate: ({ phase, count, hint, depth, ready, countdown }) => {
          if (count !== last) {
            last = count;
            lastRepAt = Date.now();
            if (firstRepAt === null) firstRepAt = lastRepAt;
            cam.num.textContent = count;
            cam.num.classList.remove("pop");
            void cam.num.offsetWidth;
            cam.num.classList.add("pop");
            blip(620 + Math.min(count, target) * 12);
            if (navigator.vibrate) navigator.vibrate(28);
          }
          cam.depth.style.width = Math.round((depth || 0) * 100) + "%";
          if (!hint && ready && phase === "counting") {
            cam.hint.textContent = "ממשיכים, אתה בקצב טוב";
          }
          paintCamPhase({ phase, hint, countdown });
        },
        onDone: (count) => {
          stopUnlock();
          closeCamera();
          // Only the reps after the first one have a measurable gap.
          const span = firstRepAt ? Date.now() - firstRepAt : 0;
          award(c, count, span && count > 1 ? span / (count - 1) * count : 0);
        },
        onError: (kind) => {
          releaseAwake();
          cam.manual.hidden = false; // errors unlock manual immediately
          if (kind === "camera") {
            cam.hint.textContent =
              "אין גישה למצלמה. אשר בהגדרות, או פתח את האתר ישירות בספארי במקום מהאייקון.";
          } else if (kind === "model") {
            cam.hint.textContent = "לא הצלחתי לטעון את זיהוי התנועה. בדוק חיבור ונסה שוב.";
          } else {
            cam.hint.textContent = "משהו השתבש עם המצלמה.";
          }
        },
      });
      state.sawCamera = true;
      save();
    } catch (err) {
      releaseAwake();
      cam.manual.hidden = false;
      cam.hint.textContent = "זיהוי התנועה לא נתמך בדפדפן הזה.";
    }
  }

  async function openHold(c) {
    const target = scaledTarget(c);
    cam.root.hidden = false;
    keepAwake();
    cam.name.textContent = c.title;
    cam.num.textContent = "00";
    cam.of.textContent = "/ " + target + " שניות";
    cam.hint.textContent = "מכינים את המצלמה…";
    cam.depth.style.width = "0%";
    paintCamPhase({ phase: "setup", hint: null });
    cam.guideLabel.textContent = "מכינים את המצלמה…";
    let holdingSince = null;
    const stopUnlock = armManualUnlock(c, () => !holdingSince || Date.now() - holdingSince > MANUAL_UNLOCK_MS);

    try {
      const { startHoldSession } = await import("./pose.js");
      camStop = await startHoldSession({
        video: cam.video,
        canvas: cam.canvas,
        hold: c.hold,
        target,
        onUpdate: ({ elapsed, holding, hint }) => {
          const secs = Math.floor(elapsed);
          cam.num.textContent = String(secs).padStart(2, "0");
          cam.depth.style.width = Math.min(100, (elapsed / target) * 100) + "%";
          if (holding) {
            if (holdingSince === null) holdingSince = Date.now();
          } else {
            holdingSince = null;
          }
          // A hold that isn't being held is a paused hold - show it as one
          // rather than letting the seconds look like they're still ticking.
          paintCamPhase({
            phase: holding ? "counting" : "paused",
            hint: hint || (holding ? "יופי, החזק כך" : "רד לזווית של 90 מעלות"),
          });
        },
        onDone: () => {
          stopUnlock();
          closeCamera();
          award(c, 0);
        },
        onError: (kind) => {
          releaseAwake();
          cam.manual.hidden = false;
          if (kind === "camera") cam.hint.textContent = "אין גישה למצלמה.";
          else if (kind === "model") cam.hint.textContent = "לא הצלחתי לטעון את זיהוי התנועה.";
          else cam.hint.textContent = "משהו השתבש עם המצלמה.";
        },
      });
      state.sawCamera = true;
      save();
    } catch (err) {
      releaseAwake();
      cam.manual.hidden = false;
      cam.hint.textContent = "זיהוי התנועה לא נתמך בדפדפן הזה.";
    }
  }

  // ---------- Run tracker (GPS + timer) ----------

  function openRun(c) {
    const target = scaledTarget(c);
    const minMeters = Math.ceil((c.minMeters || RUN_MIN_METERS_PER_10MIN) * (target / 600));
    let gpsStop = null;
    let tick = null;
    let started = null;
    let liveMeters = 0;
    let liveAcc = null;

    openSheet(
      `<h2 class="sheet-title">${esc(c.title)}</h2>
       <p class="sheet-note">נבדוק גם שהטלפון באמת זז, לא רק שהזמן עבר. אשר גישה למיקום כשהמכשיר ישאל.</p>
       <div class="run-face">
         <div class="run-clock" id="rClock" dir="ltr">${clock(target)}</div>
         <div class="run-dist"><span id="rMeters">0</span> / ${minMeters} מ'</div>
         <div class="run-acc" id="rAcc">מכינים GPS…</div>
       </div>
       <div class="sheet-actions">
         <button class="btn btn-quiet" id="rNo">ביטול</button>
         <button class="btn btn-fill" id="rGo">התחל</button>
       </div>`,
      (r) => {
        const clockEl = r.querySelector("#rClock");
        const metersEl = r.querySelector("#rMeters");
        const accEl = r.querySelector("#rAcc");

        const cleanup = () => {
          if (tick) clearInterval(tick);
          if (gpsStop) gpsStop();
          gpsStop = null;
          releaseAwake();
        };

        r.querySelector("#rNo").onclick = () => {
          cleanup();
          closeSheet();
        };

        r.querySelector("#rGo").onclick = async (ev) => {
          const btn = ev.currentTarget;
          btn.disabled = true;
          btn.textContent = "רץ";
          keepAwake();
          started = Date.now();
          onSheetClose = cleanup;

          const { startRunTracker } = await import("./gps.js");
          gpsStop = startRunTracker({
            onUpdate: ({ meters, accuracy, moving }) => {
              liveMeters = meters;
              liveAcc = accuracy;
              metersEl.textContent = Math.round(meters);
              if (accuracy > 25) accEl.textContent = `GPS: דיוק ${Math.round(accuracy)}מ' - אולי בחוץ עדיף`;
              else if (moving) accEl.textContent = "טוב, ממשיכים לזוז";
              else accEl.textContent = "מזהה תנועה…";
            },
            onError: (kind) => {
              if (kind === "denied") accEl.textContent = "אין הרשאת מיקום. עצור וסמן ידנית אם צריך.";
              else if (kind === "unsupported") accEl.textContent = "המכשיר לא תומך ב-GPS.";
              else accEl.textContent = "בעיה עם ה-GPS. ננסה בכל זאת.";
            },
          });

          tick = setInterval(() => {
            const elapsed = Math.floor((Date.now() - started) / 1000);
            const left = Math.max(0, target - elapsed);
            clockEl.textContent = clock(left);
            if (left === 0) {
              if (liveMeters >= minMeters) {
                cleanup();
                onSheetClose = null;
                closeSheet();
                award(c, 0);
              } else {
                accEl.textContent = `הזמן נגמר אבל זזת רק ${Math.round(liveMeters)}מ' מ-${minMeters}. תמשיך לרוץ.`;
                // keep timer at 00 but keep GPS running until they hit min or cancel
                clockEl.textContent = "00:00";
                if (liveMeters >= minMeters) {
                  cleanup();
                  onSheetClose = null;
                  closeSheet();
                  award(c, 0);
                }
              }
            } else if (liveMeters >= minMeters && elapsed >= target * 0.7) {
              // If they hit distance and used ≥70% of time, count it - accepts fast runs.
              cleanup();
              onSheetClose = null;
              closeSheet();
              award(c, 0);
            }
          }, 300);
        };
      }
    );
  }

  // ---------- Reminders ----------
  // A static site has no push server, so these are local notifications: they
  // fire from the app itself, not from Apple's push network.

  // ---------- Nagging ----------
  // The tone escalates with how long you've been gone. Tier 0 is a friendly
  // poke; by tier 4 it is openly calling you out, which is what was asked for.
  // It only ever comments on showing up - never on your body.

  const NAG_TIERS = [
    {
      days: 0,
      title: "יאלה, קום",
      lines: [
        "עוד לא התאמנת היום. אימון אחד וזהו.",
        "היום עוד לא נסגר. 5 דקות מספיקות.",
        "הרצף שלך מחכה. אל תשבור אותו היום.",
      ],
    },
    {
      days: 1,
      title: "פספסת אתמול",
      lines: [
        "יום אחד בלי כלום. בוא נחזור לזה עכשיו.",
        "אתמול היה 0. היום זה לא חייב להיות ככה.",
      ],
    },
    {
      days: 2,
      title: "יומיים. מה קורה?",
      lines: [
        "יומיים ברצף בלי אימון. זה כבר מתחיל להיות הרגל.",
        "יומיים אפס. תעשה משהו קטן ותסגור את זה.",
      ],
    },
    {
      days: 4,
      title: "אתה מאבד את זה",
      lines: [
        "4 ימים. כל מה שבנית מתחיל להתפוגג.",
        "כמעט שבוע בלי כלום. תתעורר.",
      ],
    },
    {
      days: 7,
      title: "יא לוזר",
      lines: [
        "שבוע שלם. שבוע! תקום מהמיטה ותעשה 10 סקוואטים.",
        "שבוע בלי כלום. אתה יותר טוב מזה, תוכיח.",
        "שבוע. אפילו לא סקוואט אחד. בוא נגמור עם הבושה הזאת.",
      ],
    },
  ];

  function daysIdle() {
    if (!state.lastDoneDate) return 0;
    return Math.max(0, dayGap(state.lastDoneDate, today()));
  }

  function nagTier() {
    const d = daysIdle();
    let picked = NAG_TIERS[0];
    for (const t of NAG_TIERS) if (d >= t.days) picked = t;
    return picked;
  }

  function nagMessage() {
    // A missed slot from your own schedule beats a generic nudge - it quotes
    // the time you set for yourself.
    const late = overdueSlot();
    if (late) {
      const mins = minsNow() - late.at;
      const ago = mins >= 60 ? plural(Math.round(mins / 60), "שעה", "שעות") : plural(mins, "דקות", "דקות");
      return {
        title: late.label + " פספסת",
        body: `קבעת ${late.label} ב-${late.time}. עברו ${ago} ואפס אימונים היום.`,
      };
    }
    const tier = nagTier();
    const line = tier.lines[Math.floor(Math.random() * tier.lines.length)];
    return { title: tier.title, body: line };
  }

  // Prefer the service worker: on iOS a home-screen PWA can show a
  // registration notification in cases where `new Notification()` throws.
  async function fireNotification(title, body) {
    const opts = {
      body,
      icon: "icons/icon-192.png",
      badge: "icons/icon-192.png",
      tag: "kesher-nag",
      renotify: true,
    };
    try {
      if ("serviceWorker" in navigator) {
        const reg = await navigator.serviceWorker.ready;
        if (reg && reg.showNotification) {
          await reg.showNotification(title, opts);
          return true;
        }
      }
    } catch (e) {
      /* fall through to the direct constructor */
    }
    try {
      new Notification(title, opts);
      return true;
    } catch (e) {
      return false;
    }
  }

  function renderRemind() {
    const btn = $("remindBtn");
    const body = $("remindBody");
    const test = $("testNagBtn");
    if (!("Notification" in window)) {
      body.textContent = "הדפדפן הזה לא תומך בתזכורות.";
      btn.disabled = true;
      btn.querySelector("span").textContent = "לא זמין";
      if (test) test.hidden = true;
      return;
    }
    if (Notification.permission === "granted" && state.remindOn) {
      const d = daysIdle();
      body.textContent =
        d === 0
          ? "תזכורות פעילות. ככל שתעלים יותר ימים, ההודעות נעשות פחות נחמדות."
          : `תזכורות פעילות. ${plural(d, "יום", "ימים")} בלי אימון - ההודעות כבר בטון ${d >= 7 ? "הכי חריף" : "חריף יותר"}.`;
      btn.disabled = true;
      btn.querySelector("span").textContent = "מופעל";
      if (test) test.hidden = false;
    } else if (Notification.permission === "denied") {
      body.textContent = "חסמת תזכורות. אפשר להחזיר את זה בהגדרות של ספארי.";
      btn.disabled = true;
      btn.querySelector("span").textContent = "חסום";
      if (test) test.hidden = true;
    } else {
      body.textContent = "קבל דחיפה כשלא התאמנת. ככל שתעלים יותר ימים, ההודעה נעשית יותר בוטה.";
      btn.disabled = false;
      btn.querySelector("span").textContent = "הפעל תזכורות";
      if (test) test.hidden = true;
    }
  }

  $("remindBtn").onclick = async () => {
    if (!("Notification" in window)) return;
    const res = await Notification.requestPermission();
    state.remindOn = res === "granted";
    save();
    renderRemind();
    if (state.remindOn) {
      toast("תזכורות הופעלו");
      const m = nagMessage();
      fireNotification(m.title, m.body);
    }
  };

  $("testNagBtn").onclick = () => {
    const m = nagMessage();
    fireNotification(m.title, m.body);
    toast("שלחתי הודעת דוגמה");
  };

  // Nag on open, then keep checking while the app stays open. A static site
  // has no push server, so this is the honest ceiling: it fires when the app
  // is running or when you come back to it.
  const NAG_COOLDOWN_MS = 3 * 60 * 60 * 1000;

  function maybeNag(force) {
    if (!state.remindOn) return;
    if (!("Notification" in window) || Notification.permission !== "granted") return;
    if (state.doneToday.length > 0) return;
    if (todaysExcuse() && todaysExcuse().verdict === "legit") return; // he already told us why
    const now = Date.now();
    if (!force && now - (state.lastNudgeAt || 0) < NAG_COOLDOWN_MS) return;
    // Before evening, stay quiet unless you've been gone a day OR you've
    // actually blown a slot you scheduled yourself.
    if (!force && new Date().getHours() < 17 && daysIdle() === 0 && !overdueSlot()) return;
    const m = nagMessage();
    fireNotification(m.title, m.body);
    state.lastNudgeAt = now;
    save();
  }

  setInterval(() => maybeNag(false), 15 * 60 * 1000);

  // ---------- Tabs ----------

  const views = {
    lobby: $("view-lobby"),
    points: $("view-points"),
    store: $("view-store"),
  };

  for (const tab of document.querySelectorAll(".tab")) {
    tab.onclick = () => {
      document.querySelectorAll(".tab").forEach((t) => t.classList.remove("is-on"));
      tab.classList.add("is-on");
      for (const [name, el] of Object.entries(views)) el.hidden = name !== tab.dataset.view;
      document.getElementById("views").scrollTo({ top: 0 });
    };
  }

  $("editGoalBtn").onclick = goalSheet;
  $("goalText").onclick = goalSheet;
  $("addChallengeBtn").onclick = addChallengeSheet;
  $("addItemBtn").onclick = addRewardSheet;
  $("manageRoutinesBtn").onclick = manageRoutinesSheet;
  $("openExcuseBtn").onclick = openExcuseSheet;

  $("myCardBtn").onclick = myCardSheet;
  $("addBoardBtn").onclick = newBoardSheet;
  $("boardHelpBtn").onclick = boardHelpSheet;

  $("gateBtn").onclick = startGateTask;
  $("gateHelpBtn").onclick = gateHelpSheet;

  $("rerollBtn").onclick = () => {
    rollBonus(true);
    save();
    render();
    toast("אתגרים חדשים");
  };

  // Dev-only reset - removed before shipping.
  $("resetBtn").onclick = () => {
    openSheet(
      `<h2 class="sheet-title">לאפס הכל?</h2>
       <p class="sheet-note">כל הנקודות, ההיסטוריה, האימונים המותאמים והפרסים שהוספת יימחקו. זה בלתי הפיך.</p>
       <div class="sheet-actions">
         <button class="btn btn-quiet" id="xNo">ביטול</button>
         <button class="btn btn-fill" id="xYes">אפס הכל</button>
       </div>`,
      (r) => {
        r.querySelector("#xNo").onclick = closeSheet;
        r.querySelector("#xYes").onclick = () => {
          localStorage.removeItem(KEY);
          location.reload();
        };
      }
    );
  };

  // ---------- Boot ----------

  rollDay();
  rollBonus(false);
  save();
  render();
  maybeNag(false);

  // Deep link from the Shortcuts automation: opening YouTube bounces here.
  // With time left you're waved through; without it you go straight to the task.
  if (/[?&]gate=1/.test(location.search)) {
    if (gateOpen()) {
      toast("יש לך עוד " + mmss(gateMsLeft()) + " - חזור ליוטיוב");
    } else {
      $("gatePanel").scrollIntoView({ block: "center" });
      setTimeout(startGateTask, 400);
    }
  }

  // Keep the gate countdown ticking without redrawing the whole app.
  setInterval(() => {
    const clock = $("gateClock");
    if (clock) {
      const left = gateMsLeft();
      if (left <= 0) render(); // pass just expired - flip the panel to locked
      else clock.textContent = mmss(left);
    } else if (gateOpen()) {
      render(); // a pass was granted elsewhere
    }
  }, 1000);

  // Keep the bonus countdown honest without re-rendering the whole app.
  setInterval(() => {
    if (rollBonus(false)) {
      save();
      render();
    } else {
      const el = $("bonusTimer");
      if (el) el.textContent = "מתחדש בעוד " + countdownText(bonusMsLeft());
    }
  }, 30000);

  document.addEventListener("visibilitychange", () => {
    if (!document.hidden) {
      rollDay();
      if (rollBonus(false)) save();
      render();
      maybeNag(false);
    }
  });

  if ("serviceWorker" in navigator) {
    window.addEventListener("load", () => navigator.serviceWorker.register("sw.js").catch(() => {}));
    let reloaded = false;
    navigator.serviceWorker.addEventListener("controllerchange", () => {
      if (reloaded) return;
      reloaded = true;
      location.reload();
    });
  }
})();
