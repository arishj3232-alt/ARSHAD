import { createRoot } from "react-dom/client";
import "./index.css";
import {
  getMissingFirebaseEnvKeys,
  MissingEnvScreen,
  BootErrorScreen,
} from "./envGate";
console.log("ENV CHECK:", import.meta.env);
console.log("BUILD VERSION:", "v2-new");
const rootEl = document.getElementById("root")!;
const root = createRoot(rootEl);
const missing = getMissingFirebaseEnvKeys();

if (missing.length > 0) {
  root.render(<MissingEnvScreen keys={missing} />);
} else {
  if (typeof navigator !== "undefined" && "serviceWorker" in navigator) {
    const base = import.meta.env.BASE_URL ?? "/";
    const swPath = `${String(base).replace(/\/?$/, "/")}firebase-messaging-sw.js`;
    void navigator.serviceWorker.register(swPath).catch(() => {});
  }

  void import("./lib/firebase")
    .then(() => import("./App"))
    .then(({ default: App }) =>
      import("./components/ErrorBoundary").then(({ default: ErrorBoundary }) => {
        root.render(
          <ErrorBoundary>
            <App />
          </ErrorBoundary>,
        );
      }),
    )
    .catch((err: unknown) => {
      const message = err instanceof Error ? err.message : String(err);
      root.render(<BootErrorScreen message={message} />);
    });
}
