import { createRoot } from "react-dom/client";
import { HelmetProvider } from "react-helmet-async";
import App from "./App.tsx";
import "./index.css";
import { setupDeepLinkListener } from "@/lib/nativeOAuth";
import { initSentry, Sentry } from "@/lib/sentry";
import { initSitePong } from "@/lib/sitepong";

// Initialize observability before anything renders — earlier init means
// the bootstrap error path (e.g. the chunk-load recovery below) is also
// captured. No-op when the respective DSN is unset.
initSentry();
initSitePong();

// Auto-recover from stale-deploy chunk load failures.
//
// An open tab holds the old index.html; a deploy replaces the hashed chunks it
// references, so the next lazy import 404s. One hard reload fetches the fresh
// index.html. All of the deciding — web-only, online-only, once PER CHUNK —
// lives in lib/chunkReload so this file, the ErrorBoundary and the Vite hook
// below cannot drift apart. There were three separate copies of the matching
// regexes before, each with its own guard.
import {
  maybeReloadForStaleChunk,
  clearChunkReloadGuard,
} from "@/lib/chunkReload";

// Makes TidyWise installable on desktop. Registered AFTER the chunk-recovery
// listeners above are attached, so a failure during registration still lands in
// the same handling as any other bootstrap error. No-op on native and in dev —
// see lib/registerPwa for why both are excluded.
import { registerPwa } from "@/lib/registerPwa";
import { initInstallPrompt } from "@/lib/installPrompt";

// Vite's own signal, and the one that actually fires for a failed lazy import.
// React catches the import rejection itself and routes it through Suspense to
// an error boundary, so the generic 'error' / 'unhandledrejection' listeners
// below never see it — which is why a stale chunk could still reach the crash
// panel despite them. This fires before React is involved at all.
window.addEventListener("vite:preloadError", (event) => {
  const e = event as Event & { payload?: unknown };
  if (maybeReloadForStaleChunk(e.payload ?? e)) {
    event.preventDefault();
  }
});

window.addEventListener("error", (event) => {
  if (maybeReloadForStaleChunk(event.error || event.message)) {
    event.preventDefault();
  }
});

window.addEventListener("unhandledrejection", (event) => {
  if (maybeReloadForStaleChunk(event.reason)) {
    event.preventDefault();
  }
});

// Clear the guard once the app has actually bootstrapped, so a later deploy in
// the same tab can recover again.
window.addEventListener("load", () => {
  setTimeout(clearChunkReloadGuard, 5000);
});

// Set up deep link listener for native OAuth callbacks (Guideline 4.0)
// Must run before React renders so we don't miss the callback
const deepLinkCleanup = setupDeepLinkListener();

// Installability. Deliberately last of the bootstrap side effects: registration
// is not required for the app to work, so nothing above it should wait on it.
registerPwa();

// Must listen BEFORE React mounts. Chrome fires beforeinstallprompt once, often
// during initial load, so a listener attached when a component mounts misses it
// and the Install button never appears. See lib/installPrompt.
initInstallPrompt();

createRoot(document.getElementById("root")!).render(
  <Sentry.ErrorBoundary
    fallback={({ resetError }) => (
      <div
        role="alert"
        style={{
          minHeight: "100vh",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          flexDirection: "column",
          gap: "1rem",
          padding: "2rem",
          textAlign: "center",
          fontFamily: "system-ui, sans-serif",
        }}
      >
        {/* The last thing anyone sees. This fires only for what the in-app
            ErrorBoundary did not catch — i.e. the app failed before or outside
            it — so "couldn't start" is accurate where the inner boundary's
            "this part stopped working" would not be.

            "We've been told" is true HERE and only here: this is
            Sentry.ErrorBoundary, which captures. The inner boundary writes to
            system_logs instead and says "logged" rather than claiming Sentry.

            An email address appears at this level and no lower, because by this
            point reloading is the only other thing left to suggest. */}
        <h1 style={{ fontSize: "1.25rem", margin: 0 }}>TidyWise couldn't start</h1>
        <p style={{ color: "#666", margin: 0, maxWidth: "32rem" }}>
          The app failed while loading. We've been told. Try reloading — if it
          keeps happening, email support@tidywisecleaning.com.
        </p>
        <button
          onClick={() => {
            resetError();
            window.location.reload();
          }}
          style={{
            padding: "0.5rem 1rem",
            border: "1px solid #ddd",
            borderRadius: "0.5rem",
            background: "white",
            cursor: "pointer",
          }}
        >
          Refresh
        </button>
      </div>
    )}
  >
    <HelmetProvider>
      <App />
    </HelmetProvider>
  </Sentry.ErrorBoundary>
);
