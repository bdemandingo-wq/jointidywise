import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react-swc";
import path from "path";
import { execSync } from "node:child_process";
import { componentTagger } from "lovable-tagger";
import { ViteImageOptimizer } from "vite-plugin-image-optimizer";
import { mcpPlugin } from "@lovable.dev/mcp-js/stacks/supabase/vite";
import { VitePWA } from "vite-plugin-pwa";

function resolveAppBuildId(): string {
  const fromEnv = process.env.GITHUB_SHA
    || process.env.VERCEL_GIT_COMMIT_SHA
    || process.env.CF_PAGES_COMMIT_SHA
    || "";
  if (fromEnv.trim()) return fromEnv.trim();
  try {
    const sha = execSync("git rev-parse HEAD", { stdio: ["ignore", "pipe", "ignore"] }).toString().trim();
    if (sha) return sha;
  } catch {
    /* no git metadata in this build */
  }
  return `build-${Date.now()}`;
}

const APP_BUILD_ID = resolveAppBuildId();

function appVersionPlugin(buildId: string): Plugin {
  return {
    name: "tidywise-app-version",
    config() {
      return {
        define: {
          "import.meta.env.VITE_APP_BUILD_ID": JSON.stringify(buildId),
        },
      };
    },
    generateBundle() {
      this.emitFile({
        type: "asset",
        fileName: "version.json",
        source: JSON.stringify({ buildId }),
      });
    },
  };
}

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
  // esbuild minify honors this drop list, so production bundles (web and the
  // Capacitor iOS build, which ships the same dist/) do not include console.*.
  esbuild: mode === 'production' ? { drop: ['console', 'debugger'] } : undefined,
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
      // svgo is a direct devDependency. Without it the plugin skips every
      // SVG and logs a failed import, which is how the public SVGs shipped raw.
      svg: {
        multipass: true,
        plugins: [
          {
            name: 'preset-default',
            params: {
              overrides: {
                cleanupNumericValues: false,
                removeViewBox: false,
                cleanupIds: { minify: false, remove: false },
                convertPathData: false,
              },
            },
          },
          'sortAttrs',
          {
            name: 'addAttributesToSVGElement',
            params: { attributes: [{ xmlns: 'http://www.w3.org/2000/svg' }] },
          },
        ],
      },
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
    appVersionPlugin(APP_BUILD_ID),
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
        cleanupOutdatedCaches: false,
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
        // The app shell only. Precaching every lazy route (379 files, ~7.7MB)
        // made the service worker install compete with first paint. Route
        // chunks are cached on use via runtimeCaching below.
        globPatterns: ["assets/index-*.js", "assets/index-*.css", "assets/vendor-*.js"],
        globIgnores: ["**/images/**", "**/blog/**", "**/locations/**", "**/version.json"],
        navigateFallback: null,
        runtimeCaching: [
          {
            urlPattern: ({ url }) =>
              url.pathname.startsWith('/assets/') && /\.(?:js|css)$/.test(url.pathname),
            handler: 'CacheFirst',
            options: {
              cacheName: 'app-chunks',
              expiration: { maxEntries: 80, maxAgeSeconds: 60 * 60 * 24 * 14 },
            },
          },
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
        manualChunks(id) {
          if (!id.includes('node_modules')) return;
          if (id.includes('recharts') || id.includes('/d3-')) return 'vendor-charts';
          if (id.includes('leaflet')) return 'vendor-maps';
          if (id.includes('jspdf') || id.includes('xlsx') || id.includes('html2canvas')) return 'vendor-export';
          if (id.includes('@supabase')) return 'vendor-supabase';
          if (id.includes('@tanstack')) return 'vendor-query';
          if (id.includes('date-fns') || id.includes('react-day-picker')) return 'vendor-dates';
          if (id.includes('react-hook-form') || id.includes('@hookform') || id.includes('/zod/')) return 'vendor-forms';
          if (
            id.includes('node_modules/react/') ||
            id.includes('node_modules/react-dom/') ||
            id.includes('react-router') ||
            id.includes('@radix-ui/')
          ) return 'vendor-react';
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
