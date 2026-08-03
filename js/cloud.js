// Google sign-in and the worldwide leaderboard, over plain fetch.
//
// No Firebase SDK and no build step: sign-in uses Google Identity Services,
// and the board is read and written through the Firestore REST API. That
// keeps this project what it has always been - a folder of static files.
//
// Everything here is optional. With cloud-config.js left blank, none of it
// loads and the app behaves exactly as it did before.

import { CLOUD, cloudReady } from "./cloud-config.js";

const GIS_SRC = "https://accounts.google.com/gsi/client";
const IDP = "https://identitytoolkit.googleapis.com/v1";
const FS = "https://firestore.googleapis.com/v1";

const docsUrl = () =>
  `${FS}/projects/${CLOUD.projectId}/databases/(default)/documents`;

// ---------- Firestore value encoding ----------
// The REST API wants every field tagged with its type.

const num = (n) => ({ integerValue: String(Math.max(0, Math.round(n || 0))) });
const str = (s) => ({ stringValue: String(s == null ? "" : s) });

function decodeFields(fields) {
  const out = {};
  for (const [k, v] of Object.entries(fields || {})) {
    if ("integerValue" in v) out[k] = Number(v.integerValue);
    else if ("doubleValue" in v) out[k] = Number(v.doubleValue);
    else if ("stringValue" in v) out[k] = v.stringValue;
    else if ("booleanValue" in v) out[k] = v.booleanValue;
    else if ("timestampValue" in v) out[k] = v.timestampValue;
  }
  return out;
}

// ---------- Google Identity Services ----------

let gisLoading = null;
function loadGis() {
  if (window.google && window.google.accounts) return Promise.resolve();
  if (gisLoading) return gisLoading;
  gisLoading = new Promise((resolve, reject) => {
    const s = document.createElement("script");
    s.src = GIS_SRC;
    s.async = true;
    s.onload = () => resolve();
    s.onerror = () => {
      gisLoading = null;
      reject(new Error("gis-load-failed"));
    };
    document.head.appendChild(s);
  });
  return gisLoading;
}

/**
 * Renders Google's own sign-in button into `mount`. Google requires their
 * button rather than a custom one, so this hands back whatever they draw.
 * Resolves with the Firebase session once the user completes sign-in.
 */
export async function signInWithGoogle(mount) {
  if (!cloudReady()) throw new Error("cloud-not-configured");
  await loadGis();

  const credential = await new Promise((resolve, reject) => {
    try {
      window.google.accounts.id.initialize({
        client_id: CLOUD.googleClientId,
        callback: (res) => resolve(res && res.credential),
        cancel_on_tap_outside: true,
      });
      mount.innerHTML = "";
      window.google.accounts.id.renderButton(mount, {
        theme: "filled_black",
        size: "large",
        shape: "pill",
        text: "signin_with",
        locale: "he",
      });
    } catch (err) {
      reject(err);
    }
  });

  if (!credential) throw new Error("no-credential");
  return exchangeForFirebase(credential);
}

/** Trades the Google credential for a Firebase session. */
async function exchangeForFirebase(googleIdToken) {
  const res = await fetch(`${IDP}/accounts:signInWithIdp?key=${CLOUD.apiKey}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      postBody: `id_token=${encodeURIComponent(googleIdToken)}&providerId=google.com`,
      requestUri: location.origin,
      returnSecureToken: true,
    }),
  });
  if (!res.ok) throw new Error("firebase-signin-failed");
  const d = await res.json();
  return {
    uid: d.localId,
    idToken: d.idToken,
    refreshToken: d.refreshToken,
    expiresAt: Date.now() + Number(d.expiresIn || 3600) * 1000,
    // Google's own name and picture, offered as defaults the user can change.
    suggestedNick: (d.displayName || "").split(" ")[0] || "",
    photo: d.photoUrl || "",
  };
}

/** Sessions are short-lived; swap the refresh token for a fresh one. */
export async function refreshSession(session) {
  if (!session || !session.refreshToken) return null;
  if (session.expiresAt && Date.now() < session.expiresAt - 60000) return session;
  const res = await fetch(`https://securetoken.googleapis.com/v1/token?key=${CLOUD.apiKey}`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: `grant_type=refresh_token&refresh_token=${encodeURIComponent(session.refreshToken)}`,
  });
  if (!res.ok) return null;
  const d = await res.json();
  return {
    ...session,
    idToken: d.id_token,
    refreshToken: d.refresh_token,
    expiresAt: Date.now() + Number(d.expires_in || 3600) * 1000,
  };
}

// ---------- The board ----------

/**
 * Writes your row. The document id is your uid, so you can only ever
 * overwrite yourself - the security rules in the README enforce that, plus
 * sane bounds on how much a score may jump in one write.
 */
export async function publishScore(session, entry) {
  if (!cloudReady() || !session) throw new Error("not-signed-in");
  const body = {
    fields: {
      nick: str(entry.nick),
      photo: str(entry.photo || ""),
      points: num(entry.points),
      reps: num(entry.reps),
      streak: num(entry.streak),
      workouts: num(entry.workouts),
      updated: { timestampValue: new Date().toISOString() },
    },
  };
  const res = await fetch(`${docsUrl()}/leaderboard/${session.uid}`, {
    method: "PATCH",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${session.idToken}`,
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error("publish-failed:" + res.status + ":" + detail.slice(0, 120));
  }
  return true;
}

/** Reads the top of the table. Public, so it works signed out too. */
export async function fetchTop(metric = "points", limit = 50) {
  if (!cloudReady()) throw new Error("cloud-not-configured");
  const field = ["points", "reps", "streak", "workouts"].includes(metric) ? metric : "points";
  const res = await fetch(`${docsUrl()}:runQuery`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      structuredQuery: {
        from: [{ collectionId: "leaderboard" }],
        orderBy: [{ field: { fieldPath: field }, direction: "DESCENDING" }],
        limit,
      },
    }),
  });
  if (!res.ok) throw new Error("fetch-failed:" + res.status);
  const rows = await res.json();
  return rows
    .filter((r) => r.document)
    .map((r) => {
      const f = decodeFields(r.document.fields);
      return {
        uid: r.document.name.split("/").pop(),
        nick: f.nick || "בלי שם",
        photo: f.photo || "",
        points: f.points || 0,
        reps: f.reps || 0,
        streak: f.streak || 0,
        workouts: f.workouts || 0,
      };
    });
}

export { cloudReady };
