(() => {
  "use strict";

  const KEY = "kesher-state";
  const SCHEMA = 4;
  const CHART_DAYS = 14;

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
    { id: "plank", title: "פלאנק", verify: "timer", target: 45, points: 12 },
    { id: "run", title: "ריצה או הליכה", verify: "timer", target: 600, points: 22 },
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

    // v3 only lacked the daily log, so migrate in place and keep the user's
    // own challenges and rewards rather than resetting them.
    if (saved.v === 3) {
      saved.log = saved.log || {};
      saved.bestStreak = saved.bestStreak || saved.streak || 0;
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

  const worthOf = (c) => c.points + boostOf(c);

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
    timer: { icon: "i-timer", text: "טיימר" },
    manual: { icon: "i-hand", text: "סימון ידני" },
  };

  const modeOf = (c) => MODE[c.verify] || MODE.manual;

  function targetLabel(c) {
    if (c.verify === "camera") return c.target + " חזרות";
    if (c.verify === "timer") {
      return c.target >= 60 ? Math.round(c.target / 60) + " דקות" : c.target + " שניות";
    }
    return "";
  }

  const clock = (s) =>
    String(Math.floor(s / 60)).padStart(2, "0") + ":" + String(s % 60).padStart(2, "0");

  // Hebrew takes the singular for exactly one.
  const plural = (n, one, many) => n + " " + (n === 1 ? one : many);
  const workouts = (n) => plural(n, "אימון", "אימונים");
  const pts = (n) => plural(n, "נקודה", "נקודות");
  const reps = (n) => plural(n, "חזרה", "חזרות");

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

  function render() {
    $("hudPoints").textContent = state.points;
    $("hudStreakNum").textContent = state.streak;
    renderNextUp();
    renderToday();
    renderNudge();
    renderGoal();
    renderStats();
    renderProgress();
    renderTrain();
    renderStore();
    renderRemind();
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
      `;
      li.setAttribute("role", "button");
      li.setAttribute("tabindex", "0");
      li.onclick = () => startChallenge(c.id);
      li.onkeydown = (e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          startChallenge(c.id);
        }
      };
      list.appendChild(li);
    }
  }

  function renderNudge() {
    const c = topBoosted();
    const panel = $("nudgePanel");
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

  function renderProgress() {
    $("ptsBalance").textContent = state.points;
    $("ptsEarned").textContent = "צברת " + pts(state.totalEarned) + " מאז שהתחלת";

    const days = lastDays(CHART_DAYS);
    const peak = Math.max(...days.map((d) => d.p), 0);
    const t = today();

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

    const totalWorkouts = Object.values(state.log).reduce((s, e) => s + e.n, 0);
    const recs = [
      [state.streak, "רצף נוכחי"],
      [state.bestStreak || 0, "הרצף הכי ארוך"],
      [state.totalReps, "חזרות שנספרו"],
      [totalWorkouts, "אימונים שהשלמת"],
    ];
    $("recordGrid").innerHTML = recs
      .map(
        ([v, k]) =>
          `<div class="stat"><span class="stat-val">${esc(String(v))}</span><span class="stat-key">${esc(k)}</span></div>`
      )
      .join("");
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
        : `${label} — ${workouts(d.n)}, ${pts(d.p)}${d.r ? `, ${reps(d.r)}` : ""}`;
  }

  function renderTrain() {
    const list = $("challengeList");
    list.innerHTML = "";
    for (const c of state.challenges) {
      const isDone = state.doneToday.includes(c.id);
      const m = modeOf(c);
      const b = boostOf(c);
      const li = document.createElement("li");
      li.className = "row";
      li.innerHTML = `
        <button class="tick${isDone ? " is-done" : ""}" aria-label="${esc(c.title)}"><svg class="ico"><use href="#i-check"/></svg></button>
        <div class="row-main">
          <span class="row-title${isDone ? " is-done" : ""}">${esc(c.title)}${targetLabel(c) ? " · " + esc(targetLabel(c)) : ""}</span>
          <span class="row-sub${c.verify === "camera" ? " is-cam" : ""}">
            <svg class="ico"><use href="#${m.icon}"/></svg>${isDone ? "הושלם היום" : esc(m.text)}
          </span>
        </div>
        <span class="row-pts${b ? " is-boost" : ""}">+${worthOf(c)}</span>
        <button class="mini-x" aria-label="מחק"><svg class="ico"><use href="#i-close"/></svg></button>
      `;
      li.querySelector(".tick").onclick = () => {
        if (!isDone) startChallenge(c.id);
      };
      li.querySelector(".mini-x").onclick = () => {
        state.challenges = state.challenges.filter((x) => x.id !== c.id);
        state.doneToday = state.doneToday.filter((x) => x !== c.id);
        save();
        render();
      };
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
    else if (c.verify === "timer") openTimer(c);
    else award(c, 0);
  }

  // ---------- Timer ----------

  function openTimer(c) {
    let tick = null;
    openSheet(
      `<h2 class="sheet-title">${esc(c.title)}</h2>
       <p class="sheet-note">הטיימר רץ על השעון האמיתי. השאר את המסך פתוח עד הסוף.</p>
       <div class="win"><span class="win-num" id="tClock" dir="ltr">${clock(c.target)}</span></div>
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
            const left = Math.max(0, c.target - Math.floor((Date.now() - started) / 1000));
            face.textContent = clock(left);
            if (left === 0) {
              clearInterval(tick);
              releaseAwake();
              onSheetClose = null;
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

    cam.root.hidden = false;
    keepAwake();
    cam.name.textContent = c.title;
    cam.num.textContent = "0";
    cam.of.textContent = "/ " + c.target;
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
        target: c.target,
        onUpdate: ({ count, hint, depth, ready }) => {
          if (count !== last) {
            last = count;
            cam.num.textContent = count;
            cam.num.classList.remove("pop");
            void cam.num.offsetWidth;
            cam.num.classList.add("pop");
            blip(620 + Math.min(count, c.target) * 12);
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
            // A known iOS quirk: the camera sometimes only works from Safari
            // itself, not from the icon on the home screen.
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
