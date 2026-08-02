// The excuse coach - local, no network, no AI credits.
//
// Two layers:
//   classifyExcuse(text)          - what the words say, on their own
//   judge(text, memory)           - what they say GIVEN your history
//
// The second layer is the point. A first "I'm sick" is taken at face value.
// The fourth one this fortnight, in the same words, on the same weekday you
// always skip, is not - and the coach says so out loud.

const VERSION = 2;

const NORMALIZE = (s) =>
  (s || "")
    .toLowerCase()
    .replace(/[֑-ׇ]/g, "") // strip Hebrew nikud
    .replace(/[.,!?;:"'()\[\]{}\-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

const TIERS = [
  {
    verdict: "legit",
    penalty: 1.0,
    label: "בסדר גמור",
    tone: "good",
    reply: "מה שכתבת נשמע אמיתי. תנוח היום, הרצף שלך לא נפגע. חזור מחר בכוח.",
    keywords: [
      "חולה", "חום", "מחלה", "שפעת", "קורונה", "בהקאות", "מקיא", "בוקה",
      "שלשול", "כאב ראש חזק", "מיגרנה", "כאב בטן חזק",
      "נפצעתי", "פצע", "פציעה", "שברתי", "שבור", "גבס", "ניתוח", "אופרציה",
      "פגיעה", "עוותי", "נקעתי", "כאב חד", "נפילה קשה",
      "לוויה", "אבל", "אישפוז", "בית חולים", "אמבולנס", "מקרה חירום",
      "פחדתי", "פאניקה חזקה",
    ],
  },
  {
    verdict: "weak",
    penalty: 1.25,
    label: "נבדוק",
    tone: "warn",
    reply: "מבין שזה יום עמוס, אבל זה לא בלתי אפשרי. האימון הבא שווה 1.25 מהרגיל כדי לפצות.",
    keywords: [
      "מבחן מחר", "בוחן מחר", "מבחן היום", "פרויקט להגיש", "עבודה להגיש",
      "מטלה דחופה", "אני מאחר", "הכנתי מבחן", "לומד למבחן",
      "לא ישנתי בכלל", "לא ישנתי כלום", "עייף מאוד", "מותש", "כואב לי הגוף",
      "כואב לי קצת", "עצבים בגוף", "שריר תפוס", "כאב שריר",
      "יורד גשם חזק", "סערה", "ברד",
    ],
  },
  {
    verdict: "excuse",
    penalty: 1.5,
    label: "תירוץ",
    tone: "bad",
    reply: "זה תירוץ. הגוף שלך יכול, פשוט לא בא לך. האימון הבא שווה 1.5 מהרגיל, או תעשה משהו קצר עכשיו וזה מתאפס.",
    keywords: [
      "עצל", "אין לי כח", "אין כח", "לא בא לי", "משעמם", "אין חשק",
      "לא מתחשק", "לא מרגיש", "אין לי כוח", "לא בעניין", "בעצלנות",
      "משחק במחשב", "משחק בפלאפון", "סרט", "סדרה", "יוטיוב", "טיקטוק",
      "פיפא", "פורטנייט", "מיינקראפט", "עסוק במשחק",
      "עם חברים", "אצל חבר", "יצאתי לבלות", "מסיבה",
      "פשוט לא", "לא היום", "אחר כך", "מחר אולי", "לא רוצה", "שכחתי",
      "אין לי זמן", "עסוק",
    ],
  },
];

// Claims that are serious enough to be worth proving. If you say you're
// injured for the second time in a fortnight, the coach wants a photo.
const PROVABLE = [
  "נפצעתי", "פצע", "פציעה", "שברתי", "שבור", "גבס", "ניתוח", "אופרציה",
  "חום", "חולה", "מחלה", "בית חולים", "נקעתי",
];

const MIN_CHARS = 6;
const TIER_ORDER = ["legit", "weak", "excuse"];

function tierByVerdict(v) {
  return TIERS.find((t) => t.verdict === v) || TIERS[2];
}

/** Drops a verdict one step toward "excuse". */
function downgrade(verdict, steps = 1) {
  const i = TIER_ORDER.indexOf(verdict);
  return TIER_ORDER[Math.min(TIER_ORDER.length - 1, i + steps)];
}

export function classifyExcuse(text) {
  const norm = NORMALIZE(text);
  if (norm.length < MIN_CHARS) {
    return {
      verdict: "excuse",
      penalty: 1.5,
      label: "לא ברור",
      tone: "bad",
      reply: "כתוב יותר כדי שאבין. משפט אחד לפחות.",
      matched: null,
    };
  }
  for (const tier of TIERS) {
    for (const kw of tier.keywords) {
      if (norm.includes(kw)) return { ...tier, matched: kw };
    }
  }
  return {
    verdict: "excuse",
    penalty: 1.5,
    label: "לא בטוח",
    tone: "bad",
    reply: "לא זיהיתי סיבה אמיתית. אם באמת יש משהו רפואי או משפחתי, רשום את זה ברור.",
    matched: null,
  };
}

// ---------- Memory ----------

/** Jaccard overlap on words - close enough to catch a copy-paste excuse. */
export function similarity(a, b) {
  const A = new Set(NORMALIZE(a).split(" ").filter((w) => w.length > 2));
  const B = new Set(NORMALIZE(b).split(" ").filter((w) => w.length > 2));
  if (!A.size || !B.size) return 0;
  let hit = 0;
  for (const w of A) if (B.has(w)) hit++;
  return hit / (A.size + B.size - hit);
}

const daysBetween = (a, b) =>
  Math.round((new Date(b + "T00:00:00") - new Date(a + "T00:00:00")) / 86400000);

/**
 * Reads the student's record and returns what the coach knows about them.
 * `history` entries are { date, text, verdict }.
 */
export function readMemory(history, today) {
  const h = Array.isArray(history) ? history : [];
  const recent = h.filter((e) => e.date && daysBetween(e.date, today) <= 14);
  const byDay = {};
  for (const e of h) {
    const d = new Date(e.date + "T00:00:00").getDay();
    byDay[d] = (byDay[d] || 0) + 1;
  }
  const worstDay = Object.entries(byDay).sort((a, b) => b[1] - a[1])[0];
  return {
    total: h.length,
    recent: recent.length,
    recentLegit: recent.filter((e) => e.verdict === "legit").length,
    recentExcuse: recent.filter((e) => e.verdict === "excuse").length,
    // The weekday they bail on most, once there's enough data to mean anything.
    worstDay: worstDay && worstDay[1] >= 3 ? Number(worstDay[0]) : null,
    worstDayCount: worstDay ? worstDay[1] : 0,
    lastText: h.length ? h[h.length - 1].text : null,
  };
}

const DAY_NAME = ["ראשון", "שני", "שלישי", "רביעי", "חמישי", "שישי", "שבת"];

/**
 * The full verdict, with the student's history taken into account.
 *
 * memory: { history, today, penaltyPending }
 */
export function judge(text, memory = {}) {
  const today = memory.today || new Date().toISOString().slice(0, 10);
  const history = memory.history || [];
  const base = classifyExcuse(text);
  const mem = readMemory(history, today);
  const norm = NORMALIZE(text);

  let verdict = base.verdict;
  const notes = [];
  let needsPhoto = false;

  // 1. Reusing an old excuse almost word for word.
  const twin = history.find((e) => similarity(e.text, text) >= 0.6);
  if (twin) {
    verdict = downgrade(verdict);
    notes.push(`כתבת כמעט בדיוק את זה ב-${twin.date}.`);
  }

  // 2. Leaning on excuses generally.
  if (mem.recent >= 3) {
    verdict = downgrade(verdict);
    notes.push(`זה התירוץ ה-${mem.recent + 1} שלך בשבועיים.`);
  }

  // 3. A pattern on one weekday.
  const dow = new Date(today + "T00:00:00").getDay();
  if (mem.worstDay === dow) {
    notes.push(`שמתי לב שיום ${DAY_NAME[dow]} הוא היום שאתה הכי בורח ממנו.`);
    if (verdict === "legit") verdict = downgrade(verdict);
  }

  // 4. Serious claims get checked once you've used them before.
  const claimsProvable = PROVABLE.some((k) => norm.includes(k));
  if (claimsProvable && (mem.recentLegit >= 1 || twin)) {
    needsPhoto = true;
    notes.push("בפעם הזאת אני רוצה לראות הוכחה.");
  }

  // 5. Excusing again while you still owe a workout from the last one.
  if (memory.penaltyPending) {
    verdict = downgrade(verdict);
    notes.push("עוד לא השלמת את האימון מהתירוץ הקודם.");
  }

  const tier = tierByVerdict(verdict);
  const softened = verdict === base.verdict;

  return {
    verdict,
    penalty: tier.penalty,
    label: tier.label,
    tone: tier.tone,
    reply: notes.length ? notes.join(" ") + " " + tier.reply : tier.reply,
    needsPhoto,
    notes,
    downgraded: !softened,
    baseVerdict: base.verdict,
    matched: base.matched,
    version: VERSION,
  };
}
