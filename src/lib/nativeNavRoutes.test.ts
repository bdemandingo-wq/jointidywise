// Admin and cleaner links must resolve on BOTH routers.
//
// iOS uses HashRouter with its own <Routes> table. A path that exists only on
// the web BrowserRouter is the "Oops! Page not found" page in the app. The
// legacy /admin/* route is not a real page either: it renders the dashboard,
// so a link that only matches that splat is still broken.
//
// Runner:
//   node --experimental-strip-types --test src/lib/nativeNavRoutes.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { matchPath } from 'react-router-dom';

const ROOT = new URL('../..', import.meta.url).pathname;

const LINK_ROOTS = [
  'src/components/admin',
  'src/components/mobile',
  'src/components/staff',
  'src/components/settings',
  'src/pages/admin',
  'src/pages/staff',
  'src/lib/notificationCatalog.ts',
  'src/lib/sidebarSections.ts',
  'src/hooks/useOnboardingChecklist.ts',
  'src/lib/activationMilestones.ts',
];

function walk(rel: string): string[] {
  const abs = join(ROOT, rel);
  const info = statSync(abs);
  if (info.isFile()) return [abs];
  const out: string[] = [];
  for (const name of readdirSync(abs)) {
    if (name.endsWith('.test.ts') || name.endsWith('.test.tsx')) continue;
    const child = join(abs, name);
    const childInfo = statSync(child);
    if (childInfo.isDirectory()) out.push(...walk(join(rel, name)));
    else if (name.endsWith('.ts') || name.endsWith('.tsx')) out.push(child);
  }
  return out;
}

function routerBlock(src: string, which: 'native' | 'web'): string {
  const hash = src.indexOf('<HashRouter>');
  const browser = src.indexOf('<BrowserRouter>');
  if (hash < 0 || browser < 0 || hash > browser) {
    throw new Error('Could not find the native HashRouter block ahead of BrowserRouter');
  }
  return which === 'native' ? src.slice(hash, browser) : src.slice(browser);
}

function routePatterns(block: string): string[] {
  return [...block.matchAll(/<Route\s+path="([^"]+)"/g)].map((m) => m[1]);
}

function score(pattern: string): number {
  if (pattern === '*') return -100;
  const segs = pattern.split('/').filter(Boolean);
  let staticCount = 0;
  let params = 0;
  let splat = 0;
  for (const seg of segs) {
    if (seg === '*') splat += 1;
    else if (seg.startsWith(':')) params += 1;
    else staticCount += 1;
  }
  return staticCount * 10 - params - splat * 8;
}

/** Legacy dashboard sink. A more specific link that only hits this is broken. */
function isSink(pattern: string): boolean {
  return pattern === '*' || pattern === '/admin' || pattern === '/admin/*';
}

function bestMatch(pathname: string, patterns: string[]): string | null {
  let best: string | null = null;
  let bestScore = -Infinity;
  for (const pattern of patterns) {
    if (!matchPath({ path: pattern, end: true }, pathname)) continue;
    const next = score(pattern);
    if (next > bestScore) {
      best = pattern;
      bestScore = next;
    }
  }
  return best;
}

function concretePath(raw: string): string | null {
  const trimmed = raw.trim();
  if (!trimmed.startsWith('/')) return null;
  if (trimmed.startsWith('//')) return null;
  const noQuery = trimmed.split('?')[0].split('#')[0];
  const concrete = noQuery.replace(/\$\{[^}]+\}/g, ':param');
  if (!concrete.startsWith('/') || concrete.includes('${')) return null;
  return concrete.length > 1 && concrete.endsWith('/') ? concrete.slice(0, -1) : concrete;
}

function linksIn(source: string): string[] {
  const found = new Set<string>();
  const patterns = [
    /\bto=(?:\{)?["'`]([^"'`]+)["'`]/g,
    /\bhref:\s*["'`]([^"'`]+)["'`]/g,
    /\bto:\s*["'`]([^"'`]+)["'`]/g,
    /\broute:\s*["'`]([^"'`]+)["'`]/g,
    /\blink:\s*["'`]([^"'`]+)["'`]/g,
    /\bnavigate\(\s*["'`]([^"'`]+)["'`]/g,
  ];
  for (const pattern of patterns) {
    for (const match of source.matchAll(pattern)) {
      const path = concretePath(match[1]);
      if (path) found.add(path);
    }
  }
  return [...found];
}

const appSrc = readFileSync(join(ROOT, 'src/App.tsx'), 'utf8');
const nativePatterns = routePatterns(routerBlock(appSrc, 'native'));
const webPatterns = routePatterns(routerBlock(appSrc, 'web'));

const links = new Map<string, string[]>();
for (const file of LINK_ROOTS.flatMap(walk)) {
  for (const path of linksIn(readFileSync(file, 'utf8'))) {
    const rel = file.startsWith(ROOT) ? file.slice(ROOT.length).replace(/^\//, '') : file;
    const owners = links.get(path) ?? [];
    owners.push(rel);
    links.set(path, owners);
  }
}

function brokenOn(patterns: string[]): string[] {
  const broken: string[] = [];
  for (const [path, owners] of [...links.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    const match = bestMatch(path, patterns);
    if (!match || isSink(match)) {
      broken.push(`${path}  (${owners[0]})  → ${match ?? 'no route'}`);
    }
  }
  return broken;
}

test('native and web routers both include the feedback and referral pages', () => {
  for (const path of ['/dashboard/feedback', '/dashboard/platform-feedback', '/dashboard/platform-referrals']) {
    assert.equal(isSink(bestMatch(path, nativePatterns) ?? '*'), false, `native missing ${path}`);
    assert.equal(isSink(bestMatch(path, webPatterns) ?? '*'), false, `web missing ${path}`);
  }
});

test('every admin and cleaner link resolves to a real route on iOS and web', () => {
  const nativeBroken = brokenOn(nativePatterns);
  const webBroken = brokenOn(webPatterns);
  assert.deepEqual(nativeBroken, [], `iOS 404 or dashboard sink:\n${nativeBroken.join('\n')}`);
  assert.deepEqual(webBroken, [], `web 404 or dashboard sink:\n${webBroken.join('\n')}`);
});
