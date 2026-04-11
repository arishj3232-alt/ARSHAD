/** Vars required before Firebase can initialize (must match build-time VITE_* on Vercel). */
export const REQUIRED_VITE_FIREBASE = [
  "VITE_FIREBASE_API_KEY",
  "VITE_FIREBASE_AUTH_DOMAIN",
  "VITE_FIREBASE_PROJECT_ID",
  "VITE_FIREBASE_STORAGE_BUCKET",
  "VITE_FIREBASE_MESSAGING_SENDER_ID",
  "VITE_FIREBASE_APP_ID",
  "VITE_FIREBASE_DATABASE_URL",
] as const;

export function getMissingFirebaseEnvKeys(): string[] {
  return REQUIRED_VITE_FIREBASE.filter((key) => {
    const v = import.meta.env[key as keyof ImportMetaEnv];
    return typeof v !== "string" || v.trim() === "";
  }).map(String);
}

export function MissingEnvScreen({ keys }: { keys: string[] }) {
  return (
    <div className="min-h-screen bg-[#080810] text-white flex flex-col items-center justify-center p-8 font-sans">
      <h1 className="text-xl font-semibold mb-2 text-center">Environment variables missing</h1>
      <p className="text-white/60 text-sm text-center max-w-md mb-6">
        Add these in Vercel → Project → Settings → Environment Variables (Production), then redeploy. Values
        come from your Firebase project / local <span className="font-mono text-white/80">.env</span>.
      </p>
      <ul className="text-left text-sm font-mono text-pink-300 space-y-1.5 max-w-lg w-full">
        {keys.map((k) => (
          <li key={k}>{k}</li>
        ))}
      </ul>
    </div>
  );
}

export function BootErrorScreen({ message }: { message: string }) {
  return (
    <div className="min-h-screen bg-[#080810] text-white flex flex-col items-center justify-center p-8 font-sans">
      <h1 className="text-xl font-semibold mb-2 text-center">Could not start the app</h1>
      <p className="text-white/60 text-sm text-center max-w-md mb-4">
        Firebase failed to initialize. Check the browser console and your Vercel env values.
      </p>
      <p className="text-white/40 text-xs font-mono break-all max-w-lg text-center">{message}</p>
    </div>
  );
}
