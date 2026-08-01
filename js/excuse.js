// Local excuse classifier - no network, no AI credits, always works.
//
// A 14-year-old writes something like "אין לי כח היום" or "יש לי חום 39",
// and the app returns one of three verdicts:
//   legit  - real reason, skip today is fine, no penalty
//   weak   - not ideal but understandable, next workout worth 1.25x
//   excuse - just laziness, next workout worth 1.5x (or same-day makeup)
//
// The classifier is deliberately conservative: unknown text defaults to
// "excuse" so a vague reply doesn't cash a free skip.

const NORMALIZE = (s) =>
  (s || "")
    .toLowerCase()
    .replace(/[֑-ׇ]/g, "") // strip Hebrew nikud
    .replace(/[.,!?;:"'()\[\]{}\-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

// Keywords are matched as substrings on the normalized string. Order below
// is priority order — we walk tiers legit -> weak -> excuse and take the
// first match, so a "חולה אבל עצל" reads as legit (physical takes precedence).

const TIERS = [
  {
    verdict: "legit",
    penalty: 1.0,
    label: "בסדר גמור",
    tone: "good",
    reply: "מה שכתבת נשמע אמיתי. תנוח היום, הרצף שלך לא נפגע. חזור מחר בכוח.",
    keywords: [
      // sickness
      "חולה", "חום", "מחלה", "שפעת", "קורונה", "בהקאות", "מקיא", "בוקה",
      "שלשול", "כאב ראש חזק", "מיגרנה", "כאב בטן חזק",
      // real injury
      "נפצעתי", "פצע", "פציעה", "שברתי", "שבור", "גבס", "ניתוח", "אופרציה",
      "פגיעה", "עוותי", "נקעתי", "כאב חד", "נפילה קשה",
      // family emergency
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
      // school / work
      "מבחן מחר", "בוחן מחר", "מבחן היום", "פרויקט להגיש", "עבודה להגיש",
      "מטלה דחופה", "אני מאחר", "הכנתי מבחן", "לומד למבחן",
      // real tired
      "לא ישנתי בכלל", "לא ישנתי כלום", "עייף מאוד", "מותש", "כואב לי הגוף",
      // physical light
      "כואב לי קצת", "עצבים בגוף", "שריר תפוס", "כאב שריר",
      // weather (outdoor)
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
      // laziness (main bucket)
      "עצל", "אין לי כח", "אין כח", "לא בא לי", "משעמם", "אין חשק",
      "לא מתחשק", "לא מרגיש", "אין לי כוח", "לא בעניין", "בעצלנות",
      // distractions
      "משחק במחשב", "משחק בפלאפון", "סרט", "סדרה", "יוטיוב", "טיקטוק",
      "פיפא", "פורטנייט", "מיינקראפט", "עסוק במשחק",
      // social
      "עם חברים", "אצל חבר", "יצאתי לבלות", "מסיבה",
      // vague
      "פשוט לא", "לא היום", "אחר כך", "מחר אולי", "לא רוצה", "שכחתי",
      "אין לי זמן", "עסוק",
    ],
  },
];

// A minimum-length gate stops one-word replies from cashing a legit skip.
const MIN_CHARS = 6;

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
      if (norm.includes(kw)) {
        return { ...tier, matched: kw };
      }
    }
  }
  // Nothing matched - default strict.
  return {
    verdict: "excuse",
    penalty: 1.5,
    label: "לא בטוח",
    tone: "bad",
    reply: "לא זיהיתי סיבה אמיתית. אם באמת יש משהו רפואי או משפחתי, רשום את זה ברור.",
    matched: null,
  };
}
