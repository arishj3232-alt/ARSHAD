import { createRoot } from "react-dom/client";
import "./index.css";
import {
  getMissingFirebaseEnvKeys,
  MissingEnvScreen,
  BootErrorScreen,
} from "./envGate";

const rootEl = document.getElementById("root")!;
const root = createRoot(rootEl);
const missing = getMissingFirebaseEnvKeys();

if (missing.length > 0) {
  root.render(<MissingEnvScreen keys={missing} />);
} else {
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
