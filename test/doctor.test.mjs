import { judge, readMemory, similarity } from "../js/excuse.js";

let fails = 0;
function check(name, got, want) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) fails++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}: got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`);
}

const day = (n) => {
  const d = new Date("2026-08-01T00:00:00");
  d.setDate(d.getDate() - n);
  return d.toISOString().slice(0, 10);
};
const TODAY = day(0);

// With no history at all, the coach takes you at your word.
{
  const v = judge("יש לי חום גבוה ולא ישנתי", { history: [], today: TODAY });
  check("first sickness claim is accepted", v.verdict, "legit");
  check("first claim needs no photo", v.needsPhoto, false);
}

// Saying the same thing again gets called out and downgraded.
{
  const history = [{ date: day(4), text: "אין לי כח היום בכלל", verdict: "excuse" }];
  const v = judge("אין לי כח היום בכלל", { history, today: TODAY });
  check("repeated wording is noticed", v.notes.some((n) => n.includes(day(4))), true);
}
{
  const history = [{ date: day(3), text: "יש לי מבחן מחר וצריך ללמוד", verdict: "weak" }];
  const v = judge("יש לי מבחן מחר וצריך ללמוד המון", { history, today: TODAY });
  check("reused weak excuse drops to excuse", v.verdict, "excuse");
  check("reuse is flagged as a downgrade", v.downgraded, true);
}

// Leaning on excuses in general makes everything stricter.
{
  const history = [
    { date: day(2), text: "לא בא לי", verdict: "excuse" },
    { date: day(5), text: "עסוק במשחק", verdict: "excuse" },
    { date: day(9), text: "יצאתי עם חברים", verdict: "excuse" },
  ];
  const v = judge("יש לי מבחן מחר", { history, today: TODAY });
  check("fourth excuse in a fortnight is downgraded", v.verdict, "excuse");
  check("the count is stated", v.notes.some((n) => n.includes("בשבועיים")), true);
}

// A serious claim needs proof once you've already used one.
{
  const history = [{ date: day(6), text: "הייתי חולה עם חום", verdict: "legit" }];
  const v = judge("נפצעתי בברך", { history, today: TODAY });
  check("second injury/illness claim asks for a photo", v.needsPhoto, true);
}
{
  const v = judge("נפצעתי בברך", { history: [], today: TODAY });
  check("a first injury claim does not", v.needsPhoto, false);
}

// Excusing again while still owing the previous makeup workout.
{
  const v = judge("יש לי מבחן מחר", { history: [], today: TODAY, penaltyPending: true });
  check("unserved penalty downgrades", v.verdict, "excuse");
  check("unserved penalty is named", v.notes.some((n) => n.includes("הקודם")), true);
}

// A weekday pattern is spotted and, for a legit claim, costs it its pass.
{
  // 2026-08-01 is a Saturday; build three prior Saturdays.
  const history = [7, 14, 21].map((n) => ({ date: day(n), text: "לא בא לי היום", verdict: "excuse" }));
  const v = judge("יש לי חום", { history, today: TODAY });
  check("weekday pattern is called out", v.notes.some((n) => n.includes("שבת")), true);
  check("weekday pattern downgrades a legit claim", v.verdict, "weak");
}

// readMemory
{
  const history = [
    { date: day(1), text: "a", verdict: "excuse" },
    { date: day(3), text: "b", verdict: "legit" },
    { date: day(30), text: "c", verdict: "excuse" }, // outside the window
  ];
  const m = readMemory(history, TODAY);
  check("counts all history", m.total, 3);
  check("counts only the last 14 days as recent", m.recent, 2);
  check("counts recent legit separately", m.recentLegit, 1);
}

// similarity
check("identical text scores 1", similarity("אין לי כח היום", "אין לי כח היום"), 1);
check("unrelated text scores 0", similarity("יש לי חום", "יצאתי לשחק כדורגל"), 0);
check("empty input is safe", similarity("", "משהו"), 0);

// The coach never softens a verdict, only holds or hardens it.
{
  const history = [
    { date: day(1), text: "לא בא לי", verdict: "excuse" },
    { date: day(2), text: "עסוק", verdict: "excuse" },
    { date: day(3), text: "משעמם", verdict: "excuse" },
  ];
  const v = judge("אין לי כח", { history, today: TODAY, penaltyPending: true });
  check("a bad excuse cannot get better with history", v.verdict, "excuse");
}

console.log(fails === 0 ? "\nAll doctor tests passed." : `\n${fails} test(s) failed.`);
process.exit(fails === 0 ? 0 : 1);
