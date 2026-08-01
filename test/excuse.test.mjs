import { classifyExcuse } from "../js/excuse.js";

let fails = 0;
function check(name, got, want) {
  const ok = got === want;
  if (!ok) fails++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}: got "${got}", want "${want}"`);
}

// Legit
check("sick",       classifyExcuse("יש לי חום גבוה מאז אתמול").verdict, "legit");
check("injury",     classifyExcuse("נפצעתי בברך אתמול").verdict,        "legit");
check("stomach",    classifyExcuse("אני בהקאות כל היום").verdict,        "legit");
check("family",     classifyExcuse("סבתא שלי בבית חולים היום").verdict,  "legit");
check("broken",     classifyExcuse("שברתי את היד בבית ספר").verdict,     "legit");

// Weak
check("exam",       classifyExcuse("יש לי מבחן מחר וצריך ללמוד").verdict, "weak");
check("no-sleep",   classifyExcuse("לא ישנתי בכלל אתמול").verdict,        "weak");
check("weather",    classifyExcuse("יורד גשם חזק בחוץ").verdict,          "weak");

// Excuse
check("lazy",       classifyExcuse("אין לי כח היום בכלל").verdict,        "excuse");
check("distract",   classifyExcuse("אני עסוק במשחק במחשב").verdict,       "excuse");
check("vague",      classifyExcuse("פשוט לא בא לי כלום").verdict,         "excuse");
check("nomotiv",    classifyExcuse("אין חשק אני לא מרגיש כמו").verdict,   "excuse");

// Edge cases
check("too-short",  classifyExcuse("חולה").verdict,                       "excuse");  // below 6 chars
check("empty",      classifyExcuse("").verdict,                            "excuse");
check("unknown",    classifyExcuse("משהו קרה היום ולא הצלחתי").verdict,    "excuse"); // no keyword => strict

// The overlap rule: sickness beats laziness when both appear.
check("mixed",      classifyExcuse("חולה עם חום ואני גם עצל").verdict,    "legit");

console.log(fails === 0 ? "\nAll excuse tests passed." : `\n${fails} test(s) failed.`);
process.exit(fails === 0 ? 0 : 1);
