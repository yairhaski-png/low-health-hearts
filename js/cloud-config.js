// Fill this in to switch on Google sign-in and the worldwide leaderboard.
// Until you do, the app ignores all of it and the local code-based boards
// keep working exactly as before - nothing here is required to use קשר.
//
// Setup is in the README under "טופ עולמי". It takes about five minutes and
// costs nothing on Firebase's free tier.
//
// These values are NOT secrets. A Firebase web apiKey is designed to be
// public; what actually protects your data is the Firestore security rules
// in the README. Do not put anything private in this file.

export const CLOUD = {
  // From Firebase console -> Project settings -> Your apps -> Web app
  apiKey: "",
  projectId: "",

  // From Google Cloud console -> Credentials -> OAuth 2.0 Client IDs -> Web
  googleClientId: "",
};

export const cloudReady = () =>
  Boolean(CLOUD.apiKey && CLOUD.projectId && CLOUD.googleClientId);
