/**
 * SitePong initialization.
 *
 * No-op when VITE_SITEPONG_DSN is unset or malformed, so this can ship
 * before the DSN is wired up in the build environment. Same guard model
 * as src/lib/sentry.ts.
 *
 * The DSN is a URL in the format:
 *   https://sp_live_xxx@api.sitepong.com/project-id
 * The apiKey is the username portion (sp_live_xxx). The sp_live_ prefix
 * is a publishable key — safe to embed in client bundles (same model as
 * Sentry DSNs and Supabase anon keys).
 */

import { init, isInitialized } from "sitepong";

let initialized = false;

export function initSitePong(): void {
  if (initialized) return;

  const dsn = import.meta.env.VITE_SITEPONG_DSN as string | undefined;
  if (!dsn) {
    if (import.meta.env.DEV) {
      console.info("[sitepong] DSN unset — disabled");
    }
    return;
  }

  let apiKey: string;
  try {
    const url = new URL(dsn);
    apiKey = url.username;
  } catch {
    if (import.meta.env.DEV) {
      console.warn("[sitepong] DSN is not a valid URL — disabled");
    }
    return;
  }

  if (!apiKey) {
    if (import.meta.env.DEV) {
      console.warn("[sitepong] No apiKey in DSN — disabled");
    }
    return;
  }

  if (!isInitialized()) {
    init({
      apiKey,
      environment: import.meta.env.PROD ? "production" : "development",
    });
  }

  initialized = true;
}
