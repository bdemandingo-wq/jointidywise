import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react-swc";
import path from "path";
import { execSync } from "node:child_process";
import { componentTagger } from "lovable-tagger";
import { ViteImageOptimizer } from "vite-plugin-image-optimizer";
import { mcpPlugin } from "@lovable.dev/mcp-js/stacks/supabase/vite";
import { VitePWA } from "vite-plugin-pwa";

// Runs the sitemap generator after the production build completes so
// public/sitemap.xml stays in sync with the routes declared in src/App.tsx.
function sitemapPlugin(): Plugin {
  return {
    name: "tidywise-sitemap",
    apply: "build",
    buildEnd() {
      try {
        const output = execSync("npx tsx src/lib/generate-sitemap.ts", {
          stdio: ["ignore", "pipe", "pipe"],
        }).toString().trim();
        if (output) this.info(output);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        // A route in the sitemap with no STATIC_ROUTE_META entry is not a
        // transient problem — it ships a page that tells Google the wrong title
        // and description, and it is invisible unless someone inspects dist/.
        // That one FAILS the build. Everything else (a blog-slug fetch timing
        // out, say) still only warns, as before.
        if (message.includes("SITEMAP_ROUTE_META_MISMATCH")) {
          this.error(message);
        }
        this.warn(`sitemap generation failed: ${message}`);
      }
    },
  };
}

// Emits per-route static HTML (dist/<route>/index.html) with correct title /
// description / canonical / og / twitter / h1 tags so non-JS crawlers see real
// per-page SEO instead of the homepage placeholder served to the SPA shell.
function prerenderPlugin(): Plugin {
  return {
    name: "tidywise-prerender",
    apply: "build",
    closeBundle() {
      try {
        const output = execSync("npx tsx src/lib/prerender-routes.ts", {
          stdio: ["ignore", "pipe", "pipe"],
        }).toString().trim();
        if (output) this.info(output);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        this.warn(`prerender failed: ${message}`);
      }
    },
  };
}

// https://vitejs.dev/config/
export default defineConfig(({ mode }) => ({
  server: {
    host: "::",
    port: 8080,
  },
  plugins: [
    react(),
    mode === "development" && componentTagger(),
    // Compress raster images in /public during build. Cuts the
    // tidywise-logo.png (1.4 MB), email-logo.png (1.4 MB), favicon.png
    // (1.4 MB) and og image (1.2 MB) down by 60-85% with no visible
    // quality loss. Only runs on build, not dev.
    ViteImageOptimizer({
      png: { quality: 80 },
      jpeg: { quality: 80 },
      jpg: { quality: 80 },
      webp: { quality: 80 },
      avif: { quality: 70 },
      includePublic: true,
      logStats: true,
    }),
    /*
      Installable desktop app (Chrome/Edge on macOS + Windows, and Safari's
      "Add to Dock" on Sonoma, which reads the manifest and needs no worker).

      THIS INTERACTS WITH src/lib/chunkReload.ts. That code exists because a tab
      holding an old index.html requests a hashed chunk that no longer exists,
      404s, and reloads once to pull the fresh index. A precaching worker
      changes that failure rather than just coexisting with it:

        - Normally the worker serves the old chunk from cache, so the 404 never
          happens and the reload never fires. Strictly better.
        - But if outdated caches were purged while the old worker still served
          the old index.html, the reload would fetch the SAME stale index from
          cache. The per-chunk sessionStorage guard stops an infinite loop, and
          the user is then stuck with the recovery already spent.

      Hence cleanupOutdatedCaches:false — old chunk versions accumulate (a few
      MB per deploy) and a returning tab can always still resolve them. A stuck
      tab is worse than the storage.

      registerType is 'prompt', never 'autoUpdate'. autoUpdate implies
      skipWaiting, which swaps assets underneath a live tab mid-session — that
      is the CAUSE of chunk-load errors, not a fix for them.
    */
    VitePWA({
      registerType: "prompt",
      // Registration is done by hand in src/lib/registerPwa.ts so it can be
      // skipped on native. Capacitor bundles its own assets with no server.url,
      // and a worker caching inside that WebView would strand the app in the
      // one environment where a reload cannot clear it.
      injectRegister: null,
      includeAssets: ["favicon.ico", "favicon.png", "apple-touch-icon.png"],
      manifest: {
        name: "TidyWise",
        short_name: "TidyWise",
        description:
          "Scheduling, CRM, payroll and invoicing for cleaning businesses.",
        // Derived from --primary: 230 100% 50% in src/index.css. There is no
        // canonical brand hex in the repo; if one exists in a brand doc it wins.
        theme_color: "#002aff",
        background_color: "#ffffff",
        display: "standalone",
        // An installed app opens to the product, not the marketing homepage.
        // AdminRoute bounces to login when there is no session.
        start_url: "/dashboard",
        scope: "/",
        icons: [
          { src: "/pwa-192x192.png", sizes: "192x192", type: "image/png" },
          { src: "/pwa-512x512.png", sizes: "512x512", type: "image/png" },
          {
            src: "/pwa-512x512-maskable.png",
            sizes: "512x512",
            type: "image/png",
            purpose: "maskable",
          },
        ],
      },
      workbox: {
        cleanupOutdatedCaches: true,
        /*
          Precache the app shell only. dist/ carries hundreds of PRERENDERED
          marketing pages (blog, locations, compare) that exist for SEO — the
          default glob would sweep every one of them into the precache, bloating
          it and, worse, letting the worker answer those navigations from cache
          with content search engines and visitors expect to come from the
          server.
        */
        // Icons (pwa-*.png) and favicon.ico are NOT listed here — they are
        // already injected by manifest.icons and includeAssets respectively.
        // Listing them here too produces duplicate precache entries with
        // conflicting revision hashes, which crashes the service worker.
        // index.html is deliberately NOT precached: precache serves "/" from
        // the cached copy (directoryIndex), so returning visitors saw a stale
        // homepage — including the SEO text flash — until they accepted an
        // update. Page HTML now always comes network-first (below).
        globPatterns: ["**/*.{js,css}"],
        globIgnores: ["**/images/**", "**/blog/**", "**/locations/**"],
        navigateFallback: null,
        runtimeCaching: [
          {
            // Newest HTML from the server; cached copy only when offline.
            urlPattern: ({ request, url }) =>
              request.mode === "navigate" &&
              /^\/(dashboard|staff|portal|auth)/.test(url.pathname),
            handler: "NetworkFirst",
            options: {
              cacheName: "app-shell-html",
              networkTimeoutSeconds: 4,
              expiration: { maxEntries: 20 },
            },
          },
        ],
        /*
          And the same boundary for navigations: the SPA shell is only ever
          served for app routes. Every marketing and prerendered route falls
          through to the network and keeps its server-rendered HTML.
        */
        navigateFallbackAllowlist: [
          /^\/dashboard/,
          /^\/staff/,
          /^\/portal/,
          /^\/auth/,
        ],
        // Chunks are hashed and a few exceed the 2 MB default.
        maximumFileSizeToCacheInBytes: 6 * 1024 * 1024,
      },
    }),
    mcpPlugin(),
    sitemapPlugin(),
    prerenderPlugin(),
  ].filter(Boolean),
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
    dedupe: ['react', 'react-dom', 'react/jsx-runtime'],
  },
  build: {
    sourcemap: false,
    rollupOptions: {
      output: {
        manualChunks: {
          // Keep React + Radix UI together to prevent duplicate React instances
          'vendor-react': ['react', 'react-dom', 'react-router-dom', '@radix-ui/react-dialog', '@radix-ui/react-dropdown-menu', '@radix-ui/react-popover', '@radix-ui/react-select', '@radix-ui/react-tabs', '@radix-ui/react-tooltip'],
          'vendor-query': ['@tanstack/react-query'],
          'vendor-charts': ['recharts'],
          'vendor-forms': ['react-hook-form', '@hookform/resolvers', 'zod'],
          'vendor-dates': ['date-fns', 'react-day-picker'],
          'vendor-supabase': ['@supabase/supabase-js'],
        },
      },
    },
    chunkSizeWarningLimit: 800,
    target: 'es2020',
    minify: 'esbuild',
    cssCodeSplit: true,
  },
  optimizeDeps: {
    include: [
      'react',
      'react-dom',
      'react-router-dom',
      '@tanstack/react-query',
      'date-fns',
    ],
  },
}));
