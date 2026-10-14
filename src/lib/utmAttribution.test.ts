// First-touch UTM capture. The browser stores the raw query values. The
// normalized pair (trimmed, lowercased, source 'direct' when absent) is what
// the database writes, and this module mirrors that rule so the UI and the
// SQL stay aligned.
//
//   node --experimental-strip-types --test src/lib/utmAttribution.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  UTM_STORAGE_KEY,
  UTM_TTL_MS,
  attributionSaveSucceeded,
  captureUtmFromLocation,
  clearCapturedUtm,
  countWithAttribution,
  describeUtm,
  extractUtmFromSearch,
  hasAnyUtm,
  normalizeCapturedUtm,
  normalizeUtmValue,
  parseStoredAttribution,
  readCapturedUtm,
  referrerDomain,
  sanitizeLandingPath,
  shouldCaptureLanding,
  signupAttributionArgs,
  summariseUtm,
  type UtmCookieJar,
  type UtmStorage,
} from "./utmAttribution.ts";

function memoryStorage(seed: Record<string, string> = {}): UtmStorage {
  const map = new Map(Object.entries(seed));
  return {
    getItem: (key) => (map.has(key) ? (map.get(key) as string) : null),
    setItem: (key, value) => void map.set(key, value),
    removeItem: (key) => void map.delete(key),
  };
}

const landing = {
  href: "https://jointidywise.com/?utm_source=TikTok&utm_medium=Carousel&utm_campaign=Onboarding",
  origin: "https://jointidywise.com",
  pathname: "/",
  search: "?utm_source=TikTok&utm_medium=Carousel&utm_campaign=Onboarding",
  hash: "",
};

test("a real campaign is captured raw and readable", () => {
  const storage = memoryStorage();
  captureUtmFromLocation(landing, "https://www.tiktok.com/", storage, 1_700_000_000_000);
  const captured = readCapturedUtm(storage, 1_700_000_000_000);
  assert.equal(captured?.utm_source, "TikTok");
  assert.equal(captured?.utm_medium, "Carousel");
  assert.equal(captured?.utm_campaign, "Onboarding");
  assert.equal(captured?.referrer, "www.tiktok.com");
  assert.equal(captured?.landing_page, "/");
  const stored = storage.getItem(UTM_STORAGE_KEY) ?? "";
  assert.equal(stored.includes("utm_source=TikTok"), false);
  assert.equal(stored.includes("https://"), false);
});

test("a different campaign stays distinct", () => {
  const a = memoryStorage();
  const b = memoryStorage();
  captureUtmFromLocation(
    { ...landing, search: "?utm_source=instagram", href: "https://jointidywise.com/?utm_source=instagram" },
    null,
    a,
  );
  captureUtmFromLocation(
    { ...landing, search: "?utm_source=google", href: "https://jointidywise.com/?utm_source=google" },
    null,
    b,
  );
  assert.notEqual(readCapturedUtm(a)?.utm_source, readCapturedUtm(b)?.utm_source);
});

test("first touch wins, including a direct landing before a later campaign", () => {
  const storage = memoryStorage();
  captureUtmFromLocation(
    { href: "https://jointidywise.com/", origin: "https://jointidywise.com", pathname: "/", search: "", hash: "" },
    "",
    storage,
    10,
  );
  captureUtmFromLocation(landing, "https://www.tiktok.com/", storage, 20);
  const captured = readCapturedUtm(storage, 20);
  assert.equal(captured?.utm_source, null);
  assert.equal(captured?.landing_page, "/");
  assert.equal(captured?.capturedAt, 10);
});

test("values are not restricted to a list", () => {
  const extracted = extractUtmFromSearch(
    "?utm_source=SEO&utm_medium=Organic&utm_campaign=spring-launch&utm_term=house+cleaning&utm_content=hero",
  );
  assert.equal(hasAnyUtm(extracted), true);
  const normalized = normalizeCapturedUtm(extracted);
  assert.equal(normalized.utm_source_raw, "SEO");
  assert.equal(normalized.utm_source, "seo");
  assert.equal(normalized.utm_medium, "organic");
  assert.equal(normalized.utm_campaign, "spring-launch");
  assert.equal(normalized.utm_term, "house cleaning");
  assert.equal(normalized.utm_content, "hero");
  for (const word of ["tiktok", "instagram", "google", "meta", "seo", "winback", "sales", "carousel", "cpc", "email", "call", "onboarding"]) {
    assert.equal(normalizeUtmValue(word), word);
  }
});

test("normalized source is direct only when no source was received", () => {
  const none = normalizeCapturedUtm({});
  assert.equal(none.utm_source_raw, null);
  assert.equal(none.utm_source, "direct");
  assert.equal(none.utm_medium_raw, null);
  assert.equal(none.utm_medium, null);

  const blank = normalizeCapturedUtm({ utm_source: "   ", utm_medium: " CPC " });
  assert.equal(blank.utm_source_raw, null);
  assert.equal(blank.utm_source, "direct");
  assert.equal(blank.utm_medium_raw, " CPC ");
  assert.equal(blank.utm_medium, "cpc");
});

test("the word direct that was actually sent is kept as raw and normalized", () => {
  const sent = normalizeCapturedUtm({ utm_source: "Direct" });
  assert.equal(sent.utm_source_raw, "Direct");
  assert.equal(sent.utm_source, "direct");
});

test("a capture expires after 90 days and a later link can take its place", () => {
  const storage = memoryStorage();
  const start = Date.parse("2026-01-01T00:00:00.000Z");
  captureUtmFromLocation(landing, null, storage, start);
  assert.equal(readCapturedUtm(storage, start + UTM_TTL_MS)?.utm_source, "TikTok");
  assert.equal(readCapturedUtm(storage, start + UTM_TTL_MS + 1), null);
  captureUtmFromLocation(
    { ...landing, search: "?utm_source=google", href: "https://jointidywise.com/?utm_source=google" },
    null,
    storage,
    start + UTM_TTL_MS + 1,
  );
  assert.equal(readCapturedUtm(storage, start + UTM_TTL_MS + 1)?.utm_source, "google");
});

test("hash-router query params are captured", () => {
  const storage = memoryStorage();
  captureUtmFromLocation(
    {
      href: "https://jointidywise.com/#/signup?utm_source=meta&utm_medium=cpc",
      pathname: "/",
      search: "",
      hash: "#/signup?utm_source=meta&utm_medium=cpc",
    },
    null,
    storage,
  );
  assert.equal(readCapturedUtm(storage)?.utm_source, "meta");
  assert.equal(readCapturedUtm(storage)?.utm_medium, "cpc");
  assert.equal(readCapturedUtm(storage)?.landing_page, "/signup");
  assert.equal((storage.getItem(UTM_STORAGE_KEY) ?? "").includes("#"), false);
  assert.equal((storage.getItem(UTM_STORAGE_KEY) ?? "").includes("?"), false);
});

test("a dashboard visit does not become the first touch", () => {
  assert.equal(shouldCaptureLanding("/dashboard"), false);
  assert.equal(shouldCaptureLanding("/dashboard/customers"), false);
  assert.equal(shouldCaptureLanding("/set-password"), false);
  assert.equal(shouldCaptureLanding("/auth"), false);
  assert.equal(shouldCaptureLanding("/auth/callback"), false);
  assert.equal(shouldCaptureLanding("/accept-invite"), false);
  assert.equal(shouldCaptureLanding("/reset-password"), false);
  assert.equal(shouldCaptureLanding("/"), true);
  assert.equal(shouldCaptureLanding("/signup"), true);
  const storage = memoryStorage();
  captureUtmFromLocation(
    { href: "https://jointidywise.com/dashboard", pathname: "/dashboard", search: "", hash: "" },
    null,
    storage,
  );
  assert.equal(readCapturedUtm(storage), null);
  captureUtmFromLocation(
    { href: "https://jointidywise.com/dashboard?utm_source=winback", pathname: "/dashboard", search: "?utm_source=winback", hash: "" },
    null,
    storage,
  );
  assert.equal(readCapturedUtm(storage)?.utm_source, "winback");
});

const TOKEN = "invite-secret-value";

test("auth links are not stored, including token hashes", () => {
  for (const path of ["/set-password", "/auth", "/auth/confirm", "/accept-invite", "/reset-password"]) {
    const storage = memoryStorage();
    let cookie: string | null = null;
    const jar: UtmCookieJar = {
      get: () => cookie,
      set: (value) => { cookie = value; },
      clear: () => { cookie = null; },
    };
    captureUtmFromLocation(
      {
        href: `https://jointidywise.com${path}?token=${TOKEN}&code=${TOKEN}&type=recovery#access_token=${TOKEN}&refresh_token=${TOKEN}`,
        origin: "https://jointidywise.com",
        pathname: path,
        search: `?token=${TOKEN}&code=${TOKEN}&type=recovery`,
        hash: `#access_token=${TOKEN}&refresh_token=${TOKEN}`,
      },
      `https://mail.google.com/mail/u/0/?token=${TOKEN}`,
      storage,
      5,
      jar,
    );
    assert.equal(readCapturedUtm(storage, 5, jar), null);
    assert.equal(storage.getItem(UTM_STORAGE_KEY), null);
    assert.equal(cookie, null);
  }
});

test("a campaign on an auth url keeps utm values, the path, and the referrer domain", () => {
  const storage = memoryStorage();
  let cookie: string | null = null;
  const jar: UtmCookieJar = {
    get: () => cookie,
    set: (value) => { cookie = value; },
    clear: () => { cookie = null; },
  };
  captureUtmFromLocation(
    {
      href: `https://jointidywise.com/set-password?utm_source=email&utm_medium=lifecycle&token=${TOKEN}&code=${TOKEN}&type=recovery#access_token=${TOKEN}&refresh_token=${TOKEN}`,
      pathname: "/set-password",
      search: `?utm_source=email&utm_medium=lifecycle&token=${TOKEN}&code=${TOKEN}&type=recovery`,
      hash: `#access_token=${TOKEN}&refresh_token=${TOKEN}`,
    },
    `https://mail.google.com/mail/u/0/?token=${TOKEN}`,
    storage,
    5,
    jar,
  );
  const captured = readCapturedUtm(storage, 5, jar);
  assert.equal(captured?.utm_source, "email");
  assert.equal(captured?.utm_medium, "lifecycle");
  assert.equal(captured?.utm_campaign, null);
  assert.equal(captured?.utm_term, null);
  assert.equal(captured?.utm_content, null);
  assert.equal(captured?.landing_page, "/set-password");
  assert.equal(captured?.referrer, "mail.google.com");
  const blob = `${storage.getItem(UTM_STORAGE_KEY) ?? ""}\n${cookie ?? ""}`;
  assert.equal(blob.includes(TOKEN), false);
  assert.equal(blob.includes("access_token"), false);
  assert.equal(blob.includes("refresh_token"), false);
  assert.equal(blob.includes("https://"), false);
  assert.equal(blob.includes("?"), false);
  assert.equal(blob.includes("#"), false);
  const args = signupAttributionArgs(captured, 5);
  assert.equal(args.p_utm_source, "email");
  assert.equal(args.p_landing_page, "/set-password");
  assert.equal(args.p_referrer, "mail.google.com");
  assert.equal(JSON.stringify(args).includes(TOKEN), false);
});

test("signup args and a poisoned capture drop the query, hash, and referrer path", () => {
  assert.equal(sanitizeLandingPath(`https://jointidywise.com/pricing?utm_source=TikTok#access_token=${TOKEN}`), "/pricing");
  assert.equal(sanitizeLandingPath(`https://jointidywise.com/#/signup?utm_source=meta&access_token=${TOKEN}`), "/signup");
  assert.equal(referrerDomain(`https://user:pass@www.tiktok.com:443/tag/clean?x=${TOKEN}#frag`), "www.tiktok.com");
  const args = signupAttributionArgs({
    utm_source: "TikTok",
    utm_medium: null,
    utm_campaign: null,
    utm_term: null,
    utm_content: null,
    referrer: `https://www.tiktok.com/tag/clean?x=${TOKEN}`,
    landing_page: `https://jointidywise.com/set-password?token=${TOKEN}&type=recovery#access_token=${TOKEN}&refresh_token=${TOKEN}`,
    capturedAt: 10,
  });
  assert.equal(args.p_utm_source, "TikTok");
  assert.equal(args.p_landing_page, "/set-password");
  assert.equal(args.p_referrer, "www.tiktok.com");
  assert.equal(JSON.stringify(args).includes(TOKEN), false);

  const poisoned = JSON.stringify({
    utm_source: "google",
    utm_medium: null,
    utm_campaign: null,
    utm_term: null,
    utm_content: null,
    referrer: `https://mail.google.com/mail/u/0/?token=${TOKEN}`,
    landing_page: `https://jointidywise.com/pricing?code=${TOKEN}#access_token=${TOKEN}&refresh_token=${TOKEN}`,
    capturedAt: 10,
    expiresAt: 10 + UTM_TTL_MS,
  });
  const storage = memoryStorage({ [UTM_STORAGE_KEY]: poisoned });
  let cookie: string | null = poisoned;
  const jar: UtmCookieJar = {
    get: () => cookie,
    set: (value) => { cookie = value; },
    clear: () => { cookie = null; },
  };
  const captured = readCapturedUtm(storage, 10, jar);
  assert.equal(captured?.landing_page, "/pricing");
  assert.equal(captured?.referrer, "mail.google.com");
  assert.equal(captured?.utm_source, "google");
  const blob = `${storage.getItem(UTM_STORAGE_KEY) ?? ""}\n${cookie ?? ""}`;
  assert.equal(blob.includes(TOKEN), false);
  assert.equal(blob.includes("access_token"), false);
  assert.equal(blob.includes("refresh_token"), false);
});

test("a successful attribution save is what clears the capture", () => {
  assert.equal(attributionSaveSucceeded(null), true);
  assert.equal(attributionSaveSucceeded(undefined), true);
  assert.equal(attributionSaveSucceeded({ message: "permission denied" }), false);
  const source = readFileSync(new URL("./persistSignupAttribution.ts", import.meta.url), "utf8");
  const guardAt = source.indexOf("if (!attributionSaveSucceeded(error))");
  const clearAt = source.indexOf("clearCapturedUtm()");
  assert.ok(guardAt > 0);
  assert.ok(clearAt > guardAt);
});

test("the cookie is a fallback when localStorage is empty", () => {
  let cookie: string | null = null;
  const jar: UtmCookieJar = {
    get: () => cookie,
    set: (value) => { cookie = value; },
    clear: () => { cookie = null; },
  };
  const storage = memoryStorage();
  captureUtmFromLocation(landing, "https://instagram.com/reels/123?ref=1", storage, 50, jar);
  assert.ok(cookie?.includes("TikTok"));
  assert.equal(cookie?.includes("https://"), false);
  assert.equal(cookie?.includes("/reels/"), false);
  assert.equal(readCapturedUtm(storage, 50, jar)?.referrer, "instagram.com");
  const empty = memoryStorage();
  assert.equal(readCapturedUtm(empty, 50, jar)?.utm_campaign, "Onboarding");
  clearCapturedUtm(storage, jar);
  assert.equal(cookie, null);
  assert.equal(readCapturedUtm(storage, 50, jar), null);
});

test("storage that throws does not take the page down", () => {
  const throwing: UtmStorage = {
    getItem: () => { throw new Error("denied"); },
    setItem: () => { throw new Error("denied"); },
    removeItem: () => { throw new Error("denied"); },
  };
  assert.doesNotThrow(() => captureUtmFromLocation(landing, null, throwing));
  assert.equal(readCapturedUtm(throwing), null);
  assert.doesNotThrow(() => clearCapturedUtm(throwing));
});

test("signup args send the raw value and a timestamp", () => {
  const storage = memoryStorage();
  captureUtmFromLocation(landing, null, storage, Date.parse("2026-03-01T00:00:00.000Z"));
  const args = signupAttributionArgs(readCapturedUtm(storage, Date.parse("2026-03-01T00:00:00.000Z")));
  assert.equal(args.p_utm_source, "TikTok");
  assert.equal(args.p_utm_medium, "Carousel");
  assert.equal(args.p_captured_at, "2026-03-01T00:00:00.000Z");
  const missing = signupAttributionArgs(null, Date.parse("2026-03-02T00:00:00.000Z"));
  assert.equal(missing.p_utm_source, null);
  assert.equal(missing.p_captured_at, "2026-03-02T00:00:00.000Z");
});

test("whitespace-only UTM is null raw and direct source", () => {
  const normalized = normalizeCapturedUtm({
    utm_source: "   ",
    utm_medium: " \t ",
    utm_campaign: " Onboarding ",
  });
  assert.equal(normalized.utm_source_raw, null);
  assert.equal(normalized.utm_source, "direct");
  assert.equal(normalized.utm_medium_raw, null);
  assert.equal(normalized.utm_medium, null);
  assert.equal(normalized.utm_campaign_raw, " Onboarding ");
  assert.equal(normalized.utm_campaign, "onboarding");
});

test("analytics summary shows normalized source and medium together", () => {
  const row = {
    utm_source: "tiktok",
    utm_source_raw: "TikTok",
    utm_medium: "carousel",
    utm_medium_raw: "Carousel",
    utm_campaign: "onboarding",
    utm_campaign_raw: "Onboarding",
    referrer: "https://www.tiktok.com/",
    landing_page: "https://jointidywise.com/",
  };
  assert.equal(summariseUtm(row)?.primary, "tiktok / carousel");
  const lines = describeUtm(row);
  assert.equal(lines.find((line) => line.label === "Source")?.value, "tiktok");
  assert.equal(lines.find((line) => line.label === "Source as received")?.value, "TikTok");
  assert.equal(lines.find((line) => line.label === "Campaign")?.value, "onboarding");
  assert.equal(summariseUtm({ utm_source: "direct" })?.primary, "direct");
  assert.equal(parseStoredAttribution(null), null);
  assert.equal(countWithAttribution([{ attribution: row }, { attribution: null }, {}]), 1);
});

test("a corrupt stored value reads as nothing", () => {
  const storage = memoryStorage({ [UTM_STORAGE_KEY]: "{not json" });
  assert.equal(readCapturedUtm(storage), null);
});
