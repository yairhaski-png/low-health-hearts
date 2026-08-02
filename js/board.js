// Leaderboards without a server.
//
// A true worldwide table needs a database somebody runs and pays for. This app
// has deliberately never had a backend, so instead every phone can mint a
// short "score card" for itself, and boards are assembled from cards your
// friends send you. Ranking happens locally.
//
// The trade-off is honest and stated in the UI: nothing here is anonymous
// global competition, and a card can be edited by whoever made it. It works
// offline, forever, with no account and no running cost.

const VERSION = 1;

// A compact, URL-safe alphabet. No lookalike characters, so a code read aloud
// or retyped from a screenshot survives.
const ALPHA = "23456789ABCDEFGHJKLMNPQRSTUVWXYZ";

function toBase32(n) {
  if (n === 0) return "2";
  let out = "";
  while (n > 0) {
    out = ALPHA[n % 32] + out;
    n = Math.floor(n / 32);
  }
  return out;
}

function fromBase32(s) {
  let n = 0;
  for (const ch of s) {
    const i = ALPHA.indexOf(ch);
    if (i < 0) return null;
    n = n * 32 + i;
  }
  return n;
}

// Names travel as percent-encoded UTF-8 so Hebrew survives the round trip.
const encName = (s) => encodeURIComponent(String(s || "").slice(0, 18));
const decName = (s) => {
  try {
    return decodeURIComponent(s);
  } catch (e) {
    return s;
  }
};

function checksum(body) {
  let h = 7;
  for (let i = 0; i < body.length; i++) h = (h * 31 + body.charCodeAt(i)) % 1024;
  return toBase32(h);
}

/**
 * Turns a set of totals into a shareable card like:
 *   K1.%D7%99%D7%90%D7%99%D7%A8.5F.3K.C.7-N4
 */
export function makeCard({ name, points, reps, streak, workouts }) {
  const parts = [
    "K" + VERSION,
    encName(name),
    toBase32(Math.max(0, Math.round(points || 0))),
    toBase32(Math.max(0, Math.round(reps || 0))),
    toBase32(Math.max(0, Math.round(streak || 0))),
    toBase32(Math.max(0, Math.round(workouts || 0))),
  ];
  const body = parts.join(".");
  return body + "-" + checksum(body);
}

/**
 * Parses a card. Returns null when the code is damaged, so a mistyped card
 * is rejected rather than silently ranked with wrong numbers.
 */
export function readCard(code) {
  if (typeof code !== "string") return null;
  const trimmed = code.trim().replace(/\s+/g, "");
  const cut = trimmed.lastIndexOf("-");
  if (cut < 0) return null;
  const body = trimmed.slice(0, cut);
  const sum = trimmed.slice(cut + 1);
  if (checksum(body) !== sum) return null;

  const parts = body.split(".");
  if (parts.length !== 6) return null;
  if (parts[0] !== "K" + VERSION) return null;

  const nums = parts.slice(2).map(fromBase32);
  if (nums.some((n) => n === null)) return null;

  return {
    name: decName(parts[1]) || "בלי שם",
    points: nums[0],
    reps: nums[1],
    streak: nums[2],
    workouts: nums[3],
  };
}

// What each board type ranks on. Kept separate from the card so one card can
// be dropped into several boards and compared different ways.
export const METRICS = {
  points: { key: "points", label: "נקודות" },
  reps: { key: "reps", label: "חזרות" },
  streak: { key: "streak", label: "רצף" },
  workouts: { key: "workouts", label: "אימונים" },
};

/** Highest first, with a stable tie-break so equal scores don't jump around. */
export function rank(entries, metric) {
  const key = (METRICS[metric] || METRICS.points).key;
  return entries
    .slice()
    .sort((a, b) => (b[key] || 0) - (a[key] || 0) || a.name.localeCompare(b.name, "he"));
}
