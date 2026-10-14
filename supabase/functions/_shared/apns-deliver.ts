/**
 * The only APNs delivery. Demo organizations are logged and skipped before
 * any request to Apple.
 */
import { DemoSendBlocked, demoSendShouldSkip } from "./demo-guard.ts";

let cachedJwt: { token: string; exp: number } | null = null;

async function getApnsJwt(): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  if (cachedJwt && cachedJwt.exp > now + 60) return cachedJwt.token;

  const keyId = Deno.env.get("APNS_KEY_ID")!;
  const teamId = Deno.env.get("APNS_TEAM_ID")!;
  const p8Key = Deno.env.get("APNS_PRIVATE_KEY")!;

  const header = { alg: "ES256", kid: keyId };
  const payload = { iss: teamId, iat: now };
  const enc = (obj: object) =>
    btoa(JSON.stringify(obj)).replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_");
  const signingInput = `${enc(header)}.${enc(payload)}`;

  const pemBody = p8Key
    .replace(/-----BEGIN PRIVATE KEY-----/, "")
    .replace(/-----END PRIVATE KEY-----/, "")
    .replace(/\s/g, "");
  const keyDer = Uint8Array.from(atob(pemBody), (c) => c.charCodeAt(0));
  const cryptoKey = await crypto.subtle.importKey(
    "pkcs8",
    keyDer,
    { name: "ECDSA", namedCurve: "P-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign(
    { name: "ECDSA", hash: "SHA-256" },
    cryptoKey,
    new TextEncoder().encode(signingInput),
  );
  const sig64 = btoa(String.fromCharCode(...new Uint8Array(signature)))
    .replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_");
  const token = `${signingInput}.${sig64}`;
  cachedJwt = { token, exp: now + 3600 };
  return token;
}

export type ApnsEnv = "sandbox" | "production";

export type ApnsResult =
  | { ok: true }
  | { ok: false; status: number; reason: string };

function hostFor(env: ApnsEnv): string {
  return env === "production" ? "api.push.apple.com" : "api.sandbox.push.apple.com";
}

/** Unset APNS_ENV prefers production so TestFlight/App Store tokens work. */
export function defaultApnsEnv(): ApnsEnv {
  return Deno.env.get("APNS_ENV") === "sandbox" ? "sandbox" : "production";
}

export function otherApnsEnv(env: ApnsEnv): ApnsEnv {
  return env === "production" ? "sandbox" : "production";
}

export async function deliverApns(
  deviceToken: string,
  env: ApnsEnv,
  title: string,
  body: string,
  data?: Record<string, string>,
  organizationId?: string | null,
): Promise<ApnsResult> {
  const reason = await demoSendShouldSkip({ channel: "push", organizationId });
  if (reason) throw new DemoSendBlocked("push");

  const bundleId = Deno.env.get("APNS_BUNDLE_ID") || "com.TidyWiseApp.app";
  const jwt = await getApnsJwt();
  const payload = {
    ...(data ?? {}),
    aps: {
      alert: { title, body },
      sound: "tidywise_chime.caf",
      badge: 1,
    },
  };
  const url = `https://${hostFor(env)}/3/device/${deviceToken}`;
  const res = await fetch(url, {
    method: "POST",
    headers: {
      authorization: `bearer ${jwt}`,
      "apns-topic": bundleId,
      "apns-push-type": "alert",
      "apns-priority": "10",
      "content-type": "application/json",
    },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    const errText = await res.text();
    let failure = errText;
    try {
      const parsed = JSON.parse(errText) as { reason?: string };
      if (parsed?.reason) failure = parsed.reason;
    } catch { /* body was not JSON */ }
    console.log(`[PUSH] APNs error — ${JSON.stringify({ status: res.status, reason: failure, env, deviceToken: deviceToken.slice(0, 8) + "..." })}`);
    return { ok: false, status: res.status, reason: failure };
  }
  return { ok: true };
}
