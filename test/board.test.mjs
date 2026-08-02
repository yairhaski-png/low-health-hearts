import { makeCard, readCard, rank, METRICS } from "../js/board.js";

let fails = 0;
function check(name, got, want) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) fails++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}: got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`);
}

const me = { name: "יאיר", points: 1840, reps: 733, streak: 12, workouts: 96 };

// Round trip, including Hebrew names.
{
  const card = makeCard(me);
  const back = readCard(card);
  check("card round-trips all totals", back, me);
}

// Whitespace and casing from a pasted message.
{
  const card = makeCard(me);
  check("card survives stray whitespace", readCard("  " + card + " \n"), me);
}

// A damaged code must be refused, not silently mis-ranked.
{
  const card = makeCard(me);
  const broken = card.slice(0, -2) + (card.slice(-2) === "AA" ? "BB" : "AA");
  check("damaged checksum is rejected", readCard(broken), null);
}
{
  const card = makeCard(me);
  // Flip a digit in the points field.
  const i = card.indexOf(".", card.indexOf(".") + 1) + 1;
  const tampered = card.slice(0, i) + (card[i] === "Z" ? "Y" : "Z") + card.slice(i + 1);
  check("edited score is rejected", readCard(tampered), null);
}
check("garbage is rejected", readCard("hello"), null);
check("empty is rejected", readCard(""), null);
check("non-string is rejected", readCard(null), null);

// Zero is a legal score, not a parse failure.
{
  const card = makeCard({ name: "חדש", points: 0, reps: 0, streak: 0, workouts: 0 });
  check("zeroes round-trip", readCard(card), { name: "חדש", points: 0, reps: 0, streak: 0, workouts: 0 });
}

// Long names are clipped rather than corrupting the code.
{
  const card = makeCard({ ...me, name: "שם ארוך מאוד שלא נגמר אף פעם בכלל" });
  const back = readCard(card);
  check("long name still parses", back !== null, true);
  check("long name is clipped", back.name.length <= 18, true);
}

// Ranking
{
  const entries = [
    { name: "אבי", points: 100, reps: 900, streak: 2, workouts: 10 },
    { name: "בני", points: 300, reps: 100, streak: 9, workouts: 5 },
    { name: "גדי", points: 200, reps: 500, streak: 9, workouts: 20 },
  ];
  check("ranks by points", rank(entries, "points").map((e) => e.name), ["בני", "גדי", "אבי"]);
  check("ranks by reps", rank(entries, "reps").map((e) => e.name), ["אבי", "גדי", "בני"]);
  check("ranks by workouts", rank(entries, "workouts").map((e) => e.name), ["גדי", "אבי", "בני"]);
  // בני and גדי both have streak 9 - the tie-break must be stable, not random.
  check("ties break stably by name", rank(entries, "streak").map((e) => e.name), ["בני", "גדי", "אבי"]);
  check("unknown metric falls back to points", rank(entries, "nope").map((e) => e.name), ["בני", "גדי", "אבי"]);
  check("ranking does not mutate the input", entries[0].name, "אבי");
}

check("every metric has a label", Object.values(METRICS).every((m) => !!m.label), true);

console.log(fails === 0 ? "\nAll board tests passed." : `\n${fails} test(s) failed.`);
process.exit(fails === 0 ? 0 : 1);
