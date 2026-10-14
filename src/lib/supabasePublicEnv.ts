/**
 * Public Supabase URL and anon key.
 *
 * The anon key is public by design — row access is enforced by RLS, not by
 * hiding this value. It used to be copied into several files. One module
 * means a rotation is one edit, and `VITE_SUPABASE_URL` /
 * `VITE_SUPABASE_PUBLISHABLE_KEY` override the fallback when the build sets
 * them. The fallback stays so a Lovable build that does not inject the env
 * var still reaches the live project.
 *
 * Vite only inlines `import.meta.env.NAME` when the access is static, so the
 * two names are read that way. Node scripts (sitemap, prerender) do not get
 * Vite's env object; they read `process.env` through globalThis so this file
 * typechecks in the browser project, which has no Node types.
 */

const FALLBACK_URL = "https://slwfkaqczvwvvvavkgpr.supabase.co";
const FALLBACK_ANON_KEY =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InNsd2ZrYXFjenZ3dnZ2YXZrZ3ByIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjYwNjk4OTQsImV4cCI6MjA4MTY0NTg5NH0.M0OhzHsrqA0oYh6Ykx_4gVK_SrdSi1V_CiFxU-n4Lec";

function nodeEnv(name: string): string | undefined {
  const proc = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process;
  const value = proc?.env?.[name];
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function pick(fromMeta: string | undefined, name: string, fallback: string): string {
  if (typeof fromMeta === "string" && fromMeta.trim()) return fromMeta.trim();
  return nodeEnv(name) || fallback;
}

/**
 * Vite inlines a static `import.meta.env.VITE_*` access. Node (tsx sitemap
 * and prerender) has no `import.meta.env`, and reading `.VITE_*` off
 * undefined throws before the fallback can run. The member expression stays
 * static so the production bundle still inlines the build-time value.
 */
function viteEnv(read: () => unknown): string | undefined {
  try {
    const value = read();
    return typeof value === "string" && value.trim() ? value.trim() : undefined;
  } catch {
    return undefined;
  }
}

export const SUPABASE_PUBLIC_URL = pick(
  viteEnv(() => import.meta.env.VITE_SUPABASE_URL),
  "VITE_SUPABASE_URL",
  FALLBACK_URL,
);

export const SUPABASE_PUBLIC_ANON_KEY = pick(
  viteEnv(() => import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY),
  "VITE_SUPABASE_PUBLISHABLE_KEY",
  FALLBACK_ANON_KEY,
);
