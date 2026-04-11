const requiredFirebaseVars = [
  "VITE_FIREBASE_API_KEY",
  "VITE_FIREBASE_AUTH_DOMAIN",
  "VITE_FIREBASE_PROJECT_ID",
  "VITE_FIREBASE_STORAGE_BUCKET",
  "VITE_FIREBASE_MESSAGING_SENDER_ID",
  "VITE_FIREBASE_APP_ID",
  "VITE_FIREBASE_DATABASE_URL",
] as const;

export function validateClientEnv(): void {
  const missingFirebase = requiredFirebaseVars.filter((key) => !import.meta.env[key]);
  if (missingFirebase.length > 0) {
    console.warn(
      `[env] Missing Firebase variables: ${missingFirebase.join(", ")}. Realtime, auth, and messaging may fail.`,
    );
  }
}
