(() => {
  "use strict";

  const STORAGE_KEY = "kesher-state-v1";
  const todayStr = () => new Date().toISOString().slice(0, 10);

  const DEFAULT_CHALLENGES = [
    { id: "c1", title: "לימוד תורה - 15 דקות", points: 15 },
    { id: "c2", title: "לימוד פרשת השבוע", points: 20 },
    { id: "c3", title: "תפילה בכוונה", points: 10 },
    { id: "c4", title: "שכיבות שמיכה - 20 חזרות", points: 10 },
    { id: "c5", title: "הליכה / ריצה - 20 דקות", points: 15 },
    { id: "c6", title: "אימון כושר מלא - 30 דקות", points: 25 },
  ];

  const DEFAULT_STORE_ITEMS = [
    { id: "s1", title: "פינוק אישי (קפה / ממתק)", cost: 40 },
    { id: "s2", title: "שעה של סרט / גיימינג", cost: 60 },
    { id: "s3", title: "יום חופש מהמשימות", cost: 100 },
    { id: "s4", title: "לקנות לעצמי משהו קטן", cost: 150 },
    { id: "s5", title: "ספר תורני חדש", cost: 300 },
  ];

  const QUOTES = [
    "“אין אדם עומד על דברי תורה אלא אם כושל בהן” - מסכת גיטין",
    "צעד קטן 15 דקות של לימוד שווה שעה של וויתור.",
    "הגוף והנשמה עובדים ביחד - דאג גם במנוחה.",
    "כל התחלה קשה. היום הוא רק צעד אחד.",
    "הרצף הוא להתמיד, לא להיות מושלם.",
    "“בכל דרכיך דעהו והוא יישר ארחותיך” - משלי",
    "נקודה אחת בכל יום שווה שנה בסוף השנה.",
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
      storeItems: DEFAULT_STORE_ITEMS,
      redeemed: [],
    };
  }

  let state = loadState();

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
      li.querySelector(".checkbox").addEventListener("click", () => completeChallenge(c.id));
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
          <div class="item-sub">${done ? "בוצע היום" : "לחץ לביצוע"}</div>
        </div>
        <div class="pts-badge">+${c.points}</div>
        <button class="del-btn" data-del="${c.id}">✕</button>
      `;
      li.querySelector(".checkbox").addEventListener("click", () => {
        if (!done) completeChallenge(c.id);
      });
      li.querySelector("[data-del]").addEventListener("click", () => deleteChallenge(c.id));
      list.appendChild(li);
    });
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

  function openSheet(html, onMount) {
    sheetEl.innerHTML = html;
    sheetBackdrop.hidden = false;
    if (onMount) onMount(sheetEl);
  }
  function closeSheet() {
    sheetBackdrop.hidden = true;
    sheetEl.innerHTML = "";
  }
  sheetBackdrop.addEventListener("click", (e) => {
    if (e.target === sheetBackdrop) closeSheet();
  });

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
  save();
  renderAll();

  if ("serviceWorker" in navigator) {
    window.addEventListener("load", () => {
      navigator.serviceWorker.register("sw.js").catch(() => {});
    });
  }
})();
