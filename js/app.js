(() => {
  "use strict";

  const KEY = "kesher-state";
  const SCHEMA = 6;
  const CHART_DAYS = 14;
  // Minimum distance the phone must have moved for a ריצה workout to count.
  const RUN_MIN_METERS_PER_10MIN = 600;

  const DEFAULT_ROUTINE = [
    { id: "wake", label: "השכמה", time: "" },
    { id: "morn", label: "אימון בוקר", time: "" },
    { id: "eve", label: "אימון ערב", time: "" },
    { id: "sleep", label: "שינה", time: "" },
  ];

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
    { id: "wallsit", title: "סקוואט קיר", verify: "hold", hold: "wallsit", target: 30, points: 14 },
    { id: "plank", title: "פלאנק", verify: "timer", target: 45, points: 12 },
    { id: "run", title: "ריצה או הליכה", verify: "run", target: 600, minMeters: RUN_MIN_METERS_PER_10MIN, points: 22 },
  ];

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

    // v3/v4/v5 forward migrations preserve everything the user set up.
    if (saved.v === 3 || saved.v === 4 || saved.v === 5) {
      saved.log = saved.log || {};
      saved.bestStreak = saved.bestStreak || saved.streak || 0;
      saved.routine = saved.routine || DEFAULT_ROUTINE.map((r) => ({ ...r }));
      saved.workoutCount = saved.workoutCount || {};
      saved.penalty = saved.penalty || 1.0;
      saved.penaltyDate = saved.penaltyDate || null;
      saved.excuseHistory = saved.excuseHistory || [];
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
    renderToday();
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
    const t = todaysExcuse();
    if (!t) {
      box.hidden = true;
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
    box.textContent = label;
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

  function renderRoutine() {
    const list = $("routineList");
    list.innerHTML = "";
    for (const item of state.routine) {
      const li = document.createElement("li");
      li.className = "routine-item";
      const time = item.time || "לא נקבע";
      li.innerHTML = `
        <span class="routine-time${item.time ? "" : " is-empty"}" dir="ltr">${esc(time)}</span>
        <span class="routine-key">${esc(item.label)}</span>
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

  function award(c, reps) {
    if (state.doneToday.includes(c.id)) return;
    const gained = worthOf(c);
    const t = today();

    if (state.lastDoneDate !== t) {
      state.streak = state.lastDoneDate && dayGap(state.lastDoneDate, t) === 1 ? state.streak + 1 : 1;
      state.lastDoneDate = t;
    }
    if (state.streak > (state.bestStreak || 0)) state.bestStreak = state.streak;

    state.points += gained;
    state.totalEarned += gained;
    if (reps) state.totalReps += reps;
    state.doneToday.push(c.id);
    state.lastDoneBy[c.id] = t;

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

    save();
    render();
    cheer();
    showWin(gained);
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
    openSheet(
      `<h2 class="sheet-title">כל הכבוד</h2>
       <div class="win"><span class="win-num">+${pts}</span><span class="win-key">נקודות</span></div>`
    );
    setTimeout(closeSheet, 1400);
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

  async function openExcuseSheet() {
    if (todaysExcuse()) return; // one excuse per day is the whole point
    const { classifyExcuse } = await import("./excuse.js");
    openSheet(
      `<h2 class="sheet-title">מה קרה היום?</h2>
       <p class="sheet-note">כתוב במשפט או שניים למה אתה לא מתאמן. תכתוב אמת.</p>
       <textarea class="field excuse-input" id="exIn" rows="3" placeholder="לדוגמה: יש לי חום ולא ישנתי"></textarea>
       <div class="sheet-actions">
         <button class="btn btn-quiet" id="exNo">ביטול</button>
         <button class="btn btn-fill" id="exYes">שלח למאמן</button>
       </div>`,
      (r) => {
        const inp = r.querySelector("#exIn");
        inp.focus();
        r.querySelector("#exNo").onclick = closeSheet;
        r.querySelector("#exYes").onclick = () => {
          const text = inp.value.trim();
          if (!text) return;
          const v = classifyExcuse(text);
          applyExcuse(text, v);
          closeSheet();
          setTimeout(() => showExcuseVerdict(v), 50);
        };
      }
    );
  }

  function applyExcuse(text, v) {
    const t = today();
    state.excuseHistory = state.excuseHistory || [];
    state.excuseHistory.push({ date: t, text, verdict: v.verdict, penalty: v.penalty });
    if (state.excuseHistory.length > 30) state.excuseHistory = state.excuseHistory.slice(-30);
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
    name: $("camName"),
    hint: $("camHint"),
    depth: $("camDepth"),
    close: $("camClose"),
    manual: $("camManual"),
  };

  let camStop = null;

  function closeCamera() {
    if (camStop) {
      camStop();
      camStop = null;
    }
    releaseAwake();
    cam.root.hidden = true;
    cam.video.srcObject = null;
    cam.depth.style.width = "0%";
  }

  cam.close.onclick = closeCamera;

  async function openCamera(c) {
    const firstRun = !state.sawCamera;
    const target = scaledTarget(c);

    cam.root.hidden = false;
    keepAwake();
    cam.name.textContent = c.title;
    cam.num.textContent = "0";
    cam.of.textContent = "/ " + target;
    // The detection engine is a one-time ~17MB download; say so rather than
    // leaving a silent spinner on a slow connection.
    cam.hint.textContent = firstRun
      ? "מורידים את זיהוי התנועה, פעם אחת בלבד. עדיף על Wi-Fi…"
      : "מכינים את המצלמה…";
    cam.depth.style.width = "0%";
    cam.manual.onclick = () => {
      closeCamera();
      award(c, 0);
    };

    let last = 0;
    try {
      const { startRepSession } = await import("./pose.js");
      camStop = await startRepSession({
        video: cam.video,
        canvas: cam.canvas,
        exercise: c.exercise,
        target,
        onUpdate: ({ count, hint, depth, ready }) => {
          if (count !== last) {
            last = count;
            cam.num.textContent = count;
            cam.num.classList.remove("pop");
            void cam.num.offsetWidth;
            cam.num.classList.add("pop");
            blip(620 + Math.min(count, target) * 12);
            if (navigator.vibrate) navigator.vibrate(28);
          }
          cam.depth.style.width = Math.round((depth || 0) * 100) + "%";
          if (hint) cam.hint.textContent = hint;
          else if (ready) cam.hint.textContent = "ממשיכים, אתה בקצב טוב";
        },
        onDone: (count) => {
          closeCamera();
          award(c, count);
        },
        onError: (kind) => {
          releaseAwake();
          if (kind === "camera") {
            cam.hint.textContent =
              "אין גישה למצלמה. אשר בהגדרות, או פתח את האתר ישירות בספארי במקום מהאייקון.";
          } else if (kind === "model") {
            cam.hint.textContent = "לא הצלחתי לטעון את זיהוי התנועה. בדוק חיבור ונסה שוב.";
          } else {
            cam.hint.textContent = "משהו השתבש עם המצלמה. אפשר לסמן ידנית.";
          }
        },
      });
      state.sawCamera = true;
      save();
    } catch (err) {
      releaseAwake();
      cam.hint.textContent = "זיהוי התנועה לא נתמך בדפדפן הזה. אפשר לסמן ידנית.";
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
    cam.manual.onclick = () => {
      closeCamera();
      award(c, 0);
    };

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
          if (hint) cam.hint.textContent = hint;
          else if (holding) cam.hint.textContent = "יופי, החזק כך";
          else cam.hint.textContent = "רד לזווית של 90 מעלות";
        },
        onDone: () => {
          closeCamera();
          award(c, 0);
        },
        onError: (kind) => {
          releaseAwake();
          if (kind === "camera") cam.hint.textContent = "אין גישה למצלמה.";
          else if (kind === "model") cam.hint.textContent = "לא הצלחתי לטעון את זיהוי התנועה.";
          else cam.hint.textContent = "משהו השתבש עם המצלמה.";
        },
      });
      state.sawCamera = true;
      save();
    } catch (err) {
      releaseAwake();
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

  function renderRemind() {
    const btn = $("remindBtn");
    const body = $("remindBody");
    if (!("Notification" in window)) {
      body.textContent = "הדפדפן הזה לא תומך בתזכורות.";
      btn.disabled = true;
      btn.querySelector("span").textContent = "לא זמין";
      return;
    }
    if (Notification.permission === "granted" && state.remindOn) {
      body.textContent =
        "תזכורות פעילות. הן מופיעות כשאתה פותח את האפליקציה ועוד לא התאמנת היום.";
      btn.disabled = true;
      btn.querySelector("span").textContent = "מופעל";
    } else if (Notification.permission === "denied") {
      body.textContent = "חסמת תזכורות. אפשר להחזיר את זה בהגדרות של ספארי.";
      btn.disabled = true;
      btn.querySelector("span").textContent = "חסום";
    } else {
      body.textContent = "קבל תזכורת כשהרצף שלך בסכנה ועוד לא התאמנת היום.";
      btn.disabled = false;
      btn.querySelector("span").textContent = "הפעל תזכורת";
    }
  }

  $("remindBtn").onclick = async () => {
    if (!("Notification" in window)) return;
    const res = await Notification.requestPermission();
    state.remindOn = res === "granted";
    save();
    renderRemind();
    if (state.remindOn) toast("תזכורות הופעלו");
  };

  function maybeRemind() {
    if (!state.remindOn) return;
    if (!("Notification" in window) || Notification.permission !== "granted") return;
    if (state.doneToday.length > 0) return;
    if (new Date().getHours() < 17) return;
    try {
      new Notification("הרצף שלך בסכנה", {
        body: "עוד לא התאמנת היום. אימון אחד מספיק כדי לשמור על " + state.streak + " ימי רצף.",
        icon: "icons/icon-192.png",
      });
    } catch (e) {
      /* Safari throws in some standalone contexts; the in-app banner covers it. */
    }
  }

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
  $("editRoutineBtn").onclick = routineSheet;
  $("openExcuseBtn").onclick = openExcuseSheet;

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
  save();
  render();
  maybeRemind();

  document.addEventListener("visibilitychange", () => {
    if (!document.hidden) {
      rollDay();
      render();
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
