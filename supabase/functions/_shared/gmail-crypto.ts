// Symmetric encryption for Gmail refresh tokens.
// Uses AES-GCM with a key derived from SUPABASE_SERVICE_ROLE_KEY (server-only).

const enc = new TextEncoder();
const dec = new TextDecoder();

async function getKey(): Promise<CryptoKey> {
  const secret = Deno.env.get("GMAIL_TOKEN_ENC_KEY") || Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!secret) throw new Error("Missing encryption key");
  const hash = await crypto.subtle.digest("SHA-256", enc.encode("gmail-refresh:" + secret));
  return crypto.subtle.importKey("raw", hash, { name: "AES-GCM" }, false, ["encrypt", "decrypt"]);
}

function b64(bytes: Uint8Array): string {
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s);
}
function unb64(s: string): Uint8Array {
  const bin = atob(s);
  const out = new Uint8Array(new ArrayBuffer(bin.length));
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export async function encryptToken(plain: string): Promise<string> {
  const key = await getKey();
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, enc.encode(plain)));
  return `v1:${b64(iv)}:${b64(ct)}`;
}

export async function decryptToken(payload: string): Promise<string> {
  const parts = payload.split(":");
  if (parts.length !== 3 || parts[0] !== "v1") throw new Error("Invalid encrypted token format");
  const iv = unb64(parts[1]);
  const ct = unb64(parts[2]);
  const key = await getKey();
  const pt = await crypto.subtle.decrypt({ name: "AES-GCM", iv }, key, ct as unknown as ArrayBuffer);
  return dec.decode(pt);
}

// HMAC-signed state token (compact JWT-like)
export async function signState(payload: Record<string, unknown>): Promise<string> {
  const secret = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const body = { ...payload, iat: Date.now(), nonce: crypto.randomUUID() };
  const json = JSON.stringify(body);
  const data = btoa(json).replace(/=+$/, "").replace(/\+/g, "-").replace(/\//g, "_");
  const key = await crypto.subtle.importKey(
    "raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]
  );
  const sig = new Uint8Array(await crypto.subtle.sign("HMAC", key, enc.encode(data)));
  const sigB64 = b64(sig).replace(/=+$/, "").replace(/\+/g, "-").replace(/\//g, "_");
  return `${data}.${sigB64}`;
}

export async function verifyState(token: string, maxAgeMs = 15 * 60 * 1000): Promise<Record<string, any> | null> {
  const [data, sig] = token.split(".");
  if (!data || !sig) return null;
  const secret = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const key = await crypto.subtle.importKey(
    "raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["verify"]
  );
  const sigBytes = unb64(sig.replace(/-/g, "+").replace(/_/g, "/") + "==".slice((sig.length + 2) % 4));
  const ok = await crypto.subtle.verify("HMAC", key, sigBytes as unknown as ArrayBuffer, enc.encode(data) as unknown as ArrayBuffer);
  if (!ok) return null;
  try {
    const json = atob(data.replace(/-/g, "+").replace(/_/g, "/") + "==".slice((data.length + 2) % 4));
    const payload = JSON.parse(json);
    if (typeof payload.iat !== "number" || Date.now() - payload.iat > maxAgeMs) return null;
    return payload;
  } catch {
    return null;
  }
}
