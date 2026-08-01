(() => {
  "use strict";

  const STORAGE_KEY = "kesher-state-v1";
  const CHALLENGES_VERSION = 2;
  const todayStr = () => new Date().toISOString().slice(0, 10);

  // verify: "manual" - trust-based tap to complete
  //         "reps"   - counts discrete reps via the phone's motion sensor (target = rep count)
  //         "timer"  - pure countdown using the real clock, can't be skipped (target = seconds)
  //         "cardio" - countdown + motion sensor, needs both time AND minimum movement (target = seconds, minReps = peak count)
  const DEFAULT_CHALLENGES = [
    { id: "c1", title: "סקוואטים - 20 חזרות", points: 15, verify: "reps", target: 20 },
    { id: "c2", title: "קפיצות פישוק - 25 חזרות", points: 15, verify: "reps", target: 25 },
    {
      id: "c3",
      title: "שכיבות סמיכה - 15 חזרות",
      points: 15,
      verify: "manual",
      note: "החיישן לא אמין כשהטלפון לא צמוד לגוף - מסמנים ידנית",
    },
    { id: "c4", title: "פלאנק - להחזיק 60 שניות", points: 10, verify: "timer", target: 60 },
    { id: "c5", title: "הליכה / ריצה - 10 דקות", points: 20, verify: "cardio", target: 600, minReps: 150 },
    { id: "c6", title: "אימון כושר מלא - 25 דקות", points: 25, verify: "cardio", target: 1500, minReps: 300 },
  ];

  const DEFAULT_STORE_ITEMS = [
    { id: "s1", title: "פינוק אישי (קפה / ממתק)", cost: 40 },
    { id: "s2", title: "שעה של סרט / גיימינג", cost: 60 },
    { id: "s3", title: "יום חופש מהמשימות", cost: 100 },
    { id: "s4", title: "לקנות לעצמי משהו קטן", cost: 150 },
    { id: "s5", title: "ציוד כושר / נעליים חדשות", cost: 300 },
  ];

  const QUOTES = [
    "הגוף הזה שלך - תתייחס אליו כמו לציוד היקר ביותר שיש לך.",
    "צעד קטן היום שווה יותר מתוכנית מושלמת שלא מתחילה.",
    "אתה לא צריך מוטיבציה, אתה צריך הרגל. תתחיל, גם בלי חשק.",
    "כל התחלה קשה. היום הוא רק צעד אחד.",
    "הרצף הוא להתמיד, לא להיות מושלם.",
    "נקודה אחת בכל יום שווה שנה בסוף השנה.",
    "האימון הכי טוב הוא זה שבאמת עשית - לא זה המושלם שרק תכננת.",
  ];

  function loadState() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) return JSON.parse(raw);
    } catch (e) {}
    return {
      points: 0,
      totalEarned: 0,
      goal: "",
      streak: 0,
      lastActiveDate: null,
      today: todayStr(),
      doneToday: [],
      challenges: DEFAULT_CHALLENGES,
      challengesVersion: CHALLENGES_VERSION,
      storeItems: DEFAULT_STORE_ITEMS,
      redeemed: [],
    };
  }

  let state = loadState();

  function migrateChallengesIfNeeded() {
    if (state.challengesVersion !== CHALLENGES_VERSION) {
      state.challenges = DEFAULT_CHALLENGES;
      const validIds = new Set(DEFAULT_CHALLENGES.map((c) => c.id));
      state.doneToday = state.doneToday.filter((id) => validIds.has(id));
      state.challengesVersion = CHALLENGES_VERSION;
    }
  }

  function save() {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  }

  function rolloverDayIfNeeded() {
    const t = todayStr();
    if (state.today !== t) {
      const yesterday = state.today;
      const didSomethingYesterday = state.doneToday.length > 0;
      if (didSomethingYesterday && isConsecutiveDay(yesterday, t)) {
        state.streak += 1;
      } else if (!didSomethingYesterday) {
        state.streak = 0;
      }
      state.today = t;
      state.doneToday = [];
      save();
    }
  }

  function isConsecutiveDay(prev, curr) {
    if (!prev) return false;
    const p = new Date(prev + "T00:00:00");
    const c = new Date(curr + "T00:00:00");
    const diff = Math.round((c - p) / 86400000);
    return diff === 1;
  }

  function uid(prefix) {
    return prefix + Math.random().toString(36).slice(2, 9);
  }

  // ---------- Rendering ----------

  function renderAll() {
    document.getElementById("topPoints").textContent = state.points + " נק'";
    renderLobby();
    renderPoints();
    renderStore();
  }

  function renderLobby() {
    document.getElementById("lobbyPoints").textContent = state.points;
    document.getElementById("lobbyStreak").textContent = "רצף: " + state.streak + " ימים";

    document.getElementById("goalText").textContent =
      state.goal && state.goal.trim() ? state.goal : "לחץ כדי להגדיר יעד";

    const list = document.getElementById("todayList");
    list.innerHTML = "";
    const remaining = state.challenges.filter((c) => !state.doneToday.includes(c.id));
    document.getElementById("todayEmpty").hidden = remaining.length !== 0;

    remaining.forEach((c) => {
      const li = document.createElement("li");
      li.className = "item-row";
      li.innerHTML = `
        <div class="checkbox" data-id="${c.id}">✓</div>
        <div class="item-info">
          <div class="item-title">${escapeHtml(c.title)}</div>
        </div>
        <div class="pts-badge">+${c.points}</div>
      `;
      li.querySelector(".checkbox").addEventListener("click", () => handleChallengeTap(c.id));
      list.appendChild(li);
    });

    const dayIndex = new Date().getDate() % QUOTES.length;
    document.getElementById("quoteText").textContent = QUOTES[dayIndex];

    const summary = document.getElementById("summaryGrid");
    summary.innerHTML = "";
    const doneToday = state.doneToday.length;
    const totalChallenges = state.challenges.length;
    const items = [
      { num: doneToday + "/" + totalChallenges, label: "בוצע היום" },
      { num: state.totalEarned, label: "נקודות שנצברו בסה\"כ" },
      { num: state.redeemed.length, label: "פריטים שנקנו" },
      { num: state.streak, label: "ימי רצף" },
    ];
    items.forEach((it) => {
      const div = document.createElement("div");
      div.className = "summary-item";
      div.innerHTML = `<div class="summary-num">${it.num}</div><div class="summary-label">${it.label}</div>`;
      summary.appendChild(div);
    });
  }

  function renderPoints() {
    document.getElementById("pointsPagePoints").textContent = state.points;
    const list = document.getElementById("challengeList");
    list.innerHTML = "";
    state.challenges.forEach((c) => {
      const done = state.doneToday.includes(c.id);
      const li = document.createElement("li");
      li.className = "item-row";
      li.innerHTML = `
        <div class="checkbox ${done ? "done" : ""}" data-id="${c.id}">✓</div>
        <div class="item-info">
          <div class="item-title ${done ? "done" : ""}">${escapeHtml(c.title)}</div>
          <div class="item-sub">${done ? "בוצע היום" : verifySubLabel(c)}</div>
          ${c.note ? `<div class="item-sub">${escapeHtml(c.note)}</div>` : ""}
        </div>
        <div class="pts-badge">+${c.points}</div>
        <button class="del-btn" data-del="${c.id}">✕</button>
      `;
      li.querySelector(".checkbox").addEventListener("click", () => {
        if (!done) handleChallengeTap(c.id);
      });
      li.querySelector("[data-del]").addEventListener("click", () => deleteChallenge(c.id));
      list.appendChild(li);
    });
  }

  function verifySubLabel(c) {
    if (c.verify === "reps") return "לחץ כדי לספור חזרות עם חיישן התנועה";
    if (c.verify === "timer") return "לחץ כדי להפעיל טיימר";
    if (c.verify === "cardio") return "לחץ כדי לעקוב עם חיישן תנועה";
    return "לחץ לביצוע";
  }

  function renderStore() {
    document.getElementById("storePagePoints").textContent = state.points;
    const list = document.getElementById("storeList");
    list.innerHTML = "";
    state.storeItems.forEach((it) => {
      const canAfford = state.points >= it.cost;
      const li = document.createElement("li");
      li.className = "item-row";
      li.innerHTML = `
        <div class="item-info">
          <div class="item-title">${escapeHtml(it.title)}</div>
        </div>
        <div class="pts-badge">${it.cost}</div>
        <button class="buy-btn" ${canAfford ? "" : "disabled"} data-buy="${it.id}">קנה</button>
        <button class="del-btn" data-del="${it.id}">✕</button>
      `;
      const buyBtn = li.querySelector("[data-buy]");
      if (canAfford) buyBtn.addEventListener("click", () => buyItem(it.id));
      li.querySelector("[data-del]").addEventListener("click", () => deleteStoreItem(it.id));
      list.appendChild(li);
    });

    const hist = document.getElementById("historyList");
    hist.innerHTML = "";
    const recent = state.redeemed.slice(-10).reverse();
    document.getElementById("historyEmpty").hidden = recent.length !== 0;
    recent.forEach((r) => {
      const li = document.createElement("li");
      li.className = "item-row";
      li.innerHTML = `
        <div class="item-info">
          <div class="item-title">${escapeHtml(r.title)}</div>
          <div class="item-sub">${r.date}</div>
        </div>
        <div class="pts-badge">-${r.cost}</div>
      `;
      hist.appendChild(li);
    });
  }

  function escapeHtml(s) {
    const div = document.createElement("div");
    div.textContent = s;
    return div.innerHTML;
  }

  // ---------- Actions ----------

  function completeChallenge(id) {
    if (state.doneToday.includes(id)) return;
    const c = state.challenges.find((x) => x.id === id);
    if (!c) return;
    state.points += c.points;
    state.totalEarned += c.points;
    state.doneToday.push(id);
    state.lastActiveDate = todayStr();
    save();
    renderAll();
  }

  function deleteChallenge(id) {
    state.challenges = state.challenges.filter((c) => c.id !== id);
    state.doneToday = state.doneToday.filter((x) => x !== id);
    save();
    renderAll();
  }

  function handleChallengeTap(id) {
    if (state.doneToday.includes(id)) return;
    const c = state.challenges.find((x) => x.id === id);
    if (!c) return;
    if (!c.verify || c.verify === "manual") {
      completeChallenge(id);
    } else {
      openWorkoutSheet(c);
    }
  }

  function buyItem(id) {
    const it = state.storeItems.find((x) => x.id === id);
    if (!it || state.points < it.cost) return;
    state.points -= it.cost;
    state.redeemed.push({ title: it.title, cost: it.cost, date: todayStr() });
    save();
    renderAll();
  }

  function deleteStoreItem(id) {
    state.storeItems = state.storeItems.filter((x) => x.id !== id);
    save();
    renderAll();
  }

  // ---------- Sheets (modals) ----------

  const sheetBackdrop = document.getElementById("sheetBackdrop");
  const sheetEl = document.getElementById("sheet");
  let activeSheetCleanup = null;

  function openSheet(html, onMount) {
    if (activeSheetCleanup) {
      activeSheetCleanup();
      activeSheetCleanup = null;
    }
    sheetEl.innerHTML = html;
    sheetBackdrop.hidden = false;
    if (onMount) onMount(sheetEl);
  }
  function closeSheet() {
    if (activeSheetCleanup) {
      activeSheetCleanup();
      activeSheetCleanup = null;
    }
    sheetBackdrop.hidden = true;
    sheetEl.innerHTML = "";
  }
  sheetBackdrop.addEventListener("click", (e) => {
    if (e.target === sheetBackdrop) closeSheet();
  });

  // ---------- Motion sensor engine ----------
  // Pure on-device peak-detection over the phone's accelerometer. No AI, no
  // network calls, no external service - just a threshold + debounce check
  // so a challenge can't be marked done with a single tap.

  async function requestMotionPermission() {
    if (typeof DeviceMotionEvent !== "undefined" && typeof DeviceMotionEvent.requestPermission === "function") {
      try {
        const res = await DeviceMotionEvent.requestPermission();
        return res === "granted";
      } catch (e) {
        return false;
      }
    }
    return typeof DeviceMotionEvent !== "undefined";
  }

  function createMotionCounter(onPeak, { threshold = 2.2, minIntervalMs = 350 } = {}) {
    let smoothed = null;
    let lastPeakTime = 0;

    function handler(e) {
      const a = e.accelerationIncludingGravity || e.acceleration;
      if (!a || a.x === null) return;
      const mag = Math.sqrt((a.x || 0) ** 2 + (a.y || 0) ** 2 + (a.z || 0) ** 2);
      if (smoothed === null) smoothed = mag;
      smoothed = smoothed * 0.9 + mag * 0.1;
      const delta = mag - smoothed;
      const now = Date.now();
      if (delta > threshold && now - lastPeakTime > minIntervalMs) {
        lastPeakTime = now;
        onPeak();
      }
    }

    return {
      start() {
        window.addEventListener("devicemotion", handler);
      },
      stop() {
        window.removeEventListener("devicemotion", handler);
      },
    };
  }

  function formatClock(totalSeconds) {
    const m = Math.floor(totalSeconds / 60);
    const s = totalSeconds % 60;
    return String(m).padStart(2, "0") + ":" + String(s).padStart(2, "0");
  }

  function openWorkoutSheet(c) {
    if (c.verify === "reps") openRepsWorkoutSheet(c);
    else if (c.verify === "timer") openTimerWorkoutSheet(c);
    else if (c.verify === "cardio") openCardioWorkoutSheet(c);
  }

  function openRepsWorkoutSheet(c) {
    let count = 0;
    let counter = null;

    openSheet(
      `
      <div class="sheet-title">${escapeHtml(c.title)}</div>
      <div class="workout-counter" id="wCount" dir="ltr">0 / ${c.target}</div>
      <div class="workout-sub" id="wStatus">לחץ "התחל" והחזק את הטלפון ביד תוך כדי התרגיל</div>
      <div class="sheet-actions">
        <button class="btn-secondary" id="wCancel">ביטול</button>
        <button class="btn-primary" id="wStart">התחל</button>
      </div>
      `,
      (root) => {
        const countEl = root.querySelector("#wCount");
        const statusEl = root.querySelector("#wStatus");
        root.querySelector("#wCancel").addEventListener("click", closeSheet);
        root.querySelector("#wStart").addEventListener("click", async (ev) => {
          const ok = await requestMotionPermission();
          if (!ok) {
            statusEl.textContent = "אין גישה לחיישן התנועה במכשיר הזה - אפשר לסמן ידנית.";
            ev.target.outerHTML = '<button class="btn-primary" id="wManual">סמן כבוצע (ללא אימות)</button>';
            root.querySelector("#wManual").addEventListener("click", () => {
              completeChallenge(c.id);
              closeSheet();
            });
            return;
          }
          ev.target.disabled = true;
          ev.target.textContent = "עוקב...";
          statusEl.textContent = "זוז! (סקוואט / קפיצה מלאה לכל חזרה)";
          counter = createMotionCounter(() => {
            count += 1;
            countEl.textContent = count + " / " + c.target;
            if (count >= c.target) {
              activeSheetCleanup = null;
              counter.stop();
              completeChallenge(c.id);
              openSheet(`
                <div class="sheet-title">כל הכבוד! 💪</div>
                <div class="workout-counter">+${c.points} נק'</div>
              `);
              setTimeout(closeSheet, 1200);
            }
          });
          counter.start();
          activeSheetCleanup = () => counter.stop();
        });
      }
    );
  }

  function openTimerWorkoutSheet(c) {
    let startedAt = null;
    let intervalId = null;

    openSheet(
      `
      <div class="sheet-title">${escapeHtml(c.title)}</div>
      <div class="workout-counter" id="wClock" dir="ltr">${formatClock(c.target)}</div>
      <div class="workout-sub">לחץ "התחל" והישאר בעמוד עד שהטיימר מגיע לאפס</div>
      <div class="sheet-actions">
        <button class="btn-secondary" id="wCancel">ביטול</button>
        <button class="btn-primary" id="wStart">התחל</button>
      </div>
      `,
      (root) => {
        const clockEl = root.querySelector("#wClock");
        root.querySelector("#wCancel").addEventListener("click", closeSheet);
        root.querySelector("#wStart").addEventListener("click", (ev) => {
          ev.target.disabled = true;
          ev.target.textContent = "רץ...";
          startedAt = Date.now();
          intervalId = setInterval(() => {
            const elapsed = Math.floor((Date.now() - startedAt) / 1000);
            const remaining = Math.max(0, c.target - elapsed);
            clockEl.textContent = formatClock(remaining);
            if (remaining <= 0) {
              clearInterval(intervalId);
              activeSheetCleanup = null;
              completeChallenge(c.id);
              openSheet(`
                <div class="sheet-title">כל הכבוד! 💪</div>
                <div class="workout-counter">+${c.points} נק'</div>
              `);
              setTimeout(closeSheet, 1200);
            }
          }, 250);
          activeSheetCleanup = () => clearInterval(intervalId);
        });
      }
    );
  }

  function openCardioWorkoutSheet(c) {
    let peaks = 0;
    let counter = null;
    let startedAt = null;
    let intervalId = null;

    function finishIfReady(statusEl) {
      const elapsed = Math.floor((Date.now() - startedAt) / 1000);
      const timeUp = elapsed >= c.target;
      if (timeUp && peaks >= c.minReps) {
        clearInterval(intervalId);
        counter.stop();
        activeSheetCleanup = null;
        completeChallenge(c.id);
        openSheet(`
          <div class="sheet-title">כל הכבוד! 💪</div>
          <div class="workout-counter">+${c.points} נק'</div>
        `);
        setTimeout(closeSheet, 1200);
      } else if (timeUp) {
        statusEl.textContent = "הזמן נגמר אבל לא זוהתה מספיק תנועה - תמשיך לזוז כדי לסיים.";
      }
    }

    openSheet(
      `
      <div class="sheet-title">${escapeHtml(c.title)}</div>
      <div class="workout-counter" id="wClock" dir="ltr">${formatClock(c.target)}</div>
      <div class="workout-sub" id="wStatus">התחל, שים את הטלפון בכיס/ביד, ותזוז לאורך כל הזמן</div>
      <div class="sheet-actions">
        <button class="btn-secondary" id="wCancel">ביטול</button>
        <button class="btn-primary" id="wStart">התחל</button>
      </div>
      `,
      (root) => {
        const clockEl = root.querySelector("#wClock");
        const statusEl = root.querySelector("#wStatus");
        root.querySelector("#wCancel").addEventListener("click", closeSheet);
        root.querySelector("#wStart").addEventListener("click", async (ev) => {
          const ok = await requestMotionPermission();
          if (!ok) {
            statusEl.textContent = "אין גישה לחיישן התנועה במכשיר הזה - אפשר לסמן ידנית.";
            ev.target.outerHTML = '<button class="btn-primary" id="wManual">סמן כבוצע (ללא אימות)</button>';
            root.querySelector("#wManual").addEventListener("click", () => {
              completeChallenge(c.id);
              closeSheet();
            });
            return;
          }
          ev.target.disabled = true;
          ev.target.textContent = "עוקב...";
          startedAt = Date.now();
          counter = createMotionCounter(() => {
            peaks += 1;
          });
          counter.start();
          intervalId = setInterval(() => {
            const elapsed = Math.floor((Date.now() - startedAt) / 1000);
            const remaining = Math.max(0, c.target - elapsed);
            clockEl.textContent = formatClock(remaining);
            statusEl.textContent = "תנועה שזוהתה: " + peaks + " / " + c.minReps;
            finishIfReady(statusEl);
          }, 250);
          activeSheetCleanup = () => {
            clearInterval(intervalId);
            counter.stop();
          };
        });
      }
    );
  }

  function openGoalSheet() {
    openSheet(
      `
      <div class="sheet-title">היעד הקרוב שלך</div>
      <input type="text" id="goalInput" placeholder="לדוגמה: לסיים מסכת ברכות" value="${escapeHtml(state.goal || "")}" />
      <div class="sheet-actions">
        <button class="btn-secondary" id="goalCancel">ביטול</button>
        <button class="btn-primary" id="goalSave">שמור</button>
      </div>
      `,
      (root) => {
        const input = root.querySelector("#goalInput");
        input.focus();
        root.querySelector("#goalCancel").addEventListener("click", closeSheet);
        root.querySelector("#goalSave").addEventListener("click", () => {
          state.goal = input.value.trim();
          save();
          renderAll();
          closeSheet();
        });
      }
    );
  }

  function openAddChallengeSheet() {
    openSheet(
      `
      <div class="sheet-title">אתגר חדש</div>
      <input type="text" id="chTitle" placeholder="שם האתגר" />
      <input type="number" id="chPoints" placeholder="כמה נקודות?" min="1" value="10" />
      <div class="sheet-actions">
        <button class="btn-secondary" id="chCancel">ביטול</button>
        <button class="btn-primary" id="chSave">הוסף</button>
      </div>
      `,
      (root) => {
        root.querySelector("#chTitle").focus();
        root.querySelector("#chCancel").addEventListener("click", closeSheet);
        root.querySelector("#chSave").addEventListener("click", () => {
          const title = root.querySelector("#chTitle").value.trim();
          const points = parseInt(root.querySelector("#chPoints").value, 10) || 10;
          if (!title) return;
          state.challenges.push({ id: uid("c"), title, points });
          save();
          renderAll();
          closeSheet();
        });
      }
    );
  }

  function openAddItemSheet() {
    openSheet(
      `
      <div class="sheet-title">פריט חדש בחנות</div>
      <input type="text" id="itTitle" placeholder="שם הפריט" />
      <input type="number" id="itCost" placeholder="מחיר בנקודות" min="1" value="50" />
      <div class="sheet-actions">
        <button class="btn-secondary" id="itCancel">ביטול</button>
        <button class="btn-primary" id="itSave">הוסף</button>
      </div>
      `,
      (root) => {
        root.querySelector("#itTitle").focus();
        root.querySelector("#itCancel").addEventListener("click", closeSheet);
        root.querySelector("#itSave").addEventListener("click", () => {
          const title = root.querySelector("#itTitle").value.trim();
          const cost = parseInt(root.querySelector("#itCost").value, 10) || 50;
          if (!title) return;
          state.storeItems.push({ id: uid("s"), title, cost });
          save();
          renderAll();
          closeSheet();
        });
      }
    );
  }

  // ---------- Tabs ----------

  const views = {
    lobby: document.getElementById("view-lobby"),
    points: document.getElementById("view-points"),
    store: document.getElementById("view-store"),
  };

  document.querySelectorAll(".tab").forEach((btn) => {
    btn.addEventListener("click", () => {
      const target = btn.dataset.view;
      document.querySelectorAll(".tab").forEach((b) => b.classList.remove("active"));
      btn.classList.add("active");
      Object.entries(views).forEach(([name, el]) => {
        el.hidden = name !== target;
      });
    });
  });

  document.getElementById("editGoalBtn").addEventListener("click", openGoalSheet);
  document.getElementById("goalText").addEventListener("click", openGoalSheet);
  document.getElementById("addChallengeBtn").addEventListener("click", openAddChallengeSheet);
  document.getElementById("addItemBtn").addEventListener("click", openAddItemSheet);

  // ---------- Init ----------

  rolloverDayIfNeeded();
  migrateChallengesIfNeeded();
  save();
  renderAll();

  if ("serviceWorker" in navigator) {
    window.addEventListener("load", () => {
      navigator.serviceWorker.register("sw.js").catch(() => {});
    });
  }
})();
