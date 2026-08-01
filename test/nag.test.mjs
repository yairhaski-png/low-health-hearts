// Mirror of the NAG_TIERS logic in app.js to verify the escalation ladder.
const NAG_TIERS = [
  { days: 0, title: "יאלה, קום" },
  { days: 1, title: "פספסת אתמול" },
  { days: 2, title: "יומיים. מה קורה?" },
  { days: 4, title: "אתה מאבד את זה" },
  { days: 7, title: "יא לוזר" },
];
function tierFor(d) {
  let picked = NAG_TIERS[0];
  for (const t of NAG_TIERS) if (d >= t.days) picked = t;
  return picked.title;
}
let fails = 0;
function check(d, want) {
  const got = tierFor(d);
  const ok = got === want;
  if (!ok) fails++;
  console.log(`${ok?"PASS":"FAIL"}  ${d} days idle -> "${got}"`);
}
check(0,  "יאלה, קום");
check(1,  "פספסת אתמול");
check(2,  "יומיים. מה קורה?");
check(3,  "יומיים. מה קורה?");
check(4,  "אתה מאבד את זה");
check(6,  "אתה מאבד את זה");
check(7,  "יא לוזר");
check(30, "יא לוזר");
console.log(fails===0 ? "\nEscalation ladder correct." : `\n${fails} failed.`);
process.exit(fails?1:0);
