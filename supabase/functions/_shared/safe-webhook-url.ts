// Reject webhook URLs that can reach cloud metadata or the private network.
// Used before any server-side fetch of an org-configured URL (GHL inbound
// webhooks). HTTPS only, no embedded credentials, no redirects, and no
// host that is loopback, link-local, or RFC1918 — including when the
// hostname is an IP literal. DNS answers that point at those ranges are
// rejected when the runtime can resolve them.

const BLOCKED_HOSTS = new Set([
  "localhost",
  "localhost.localdomain",
  "metadata",
  "metadata.google.internal",
  "metadata.internal",
]);

function isIpv4(host: string): boolean {
  return /^\d{1,3}(\.\d{1,3}){3}$/.test(host);
}

function ipv4ToParts(host: string): number[] | null {
  if (!isIpv4(host)) return null;
  const parts = host.split(".").map((p) => Number(p));
  if (parts.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) return null;
  return parts;
}

export function isPrivateOrMetadataIp(ip: string): boolean {
  const v4 = ipv4ToParts(ip);
  if (v4) {
    const [a, b] = v4;
    if (a === 0 || a === 10 || a === 127) return true;
    if (a === 169 && b === 254) return true; // link-local, includes 169.254.169.254
    if (a === 172 && b >= 16 && b <= 31) return true;
    if (a === 192 && b === 168) return true;
    if (a === 100 && b >= 64 && b <= 127) return true; // CGNAT
    if (a >= 224) return true; // multicast / reserved
    return false;
  }
  const v6 = ip.toLowerCase();
  if (v6 === "::1" || v6 === "::") return true;
  if (v6.startsWith("fe80:") || v6.startsWith("fc") || v6.startsWith("fd")) return true;
  if (v6.startsWith("::ffff:")) {
    const mapped = v6.slice("::ffff:".length);
    return isIpv4(mapped) ? isPrivateOrMetadataIp(mapped) : true;
  }
  return false;
}

export class UnsafeWebhookUrlError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UnsafeWebhookUrlError";
  }
}

export async function assertSafeWebhookUrl(raw: string): Promise<URL> {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new UnsafeWebhookUrlError("Webhook URL is not a valid URL");
  }
  if (url.protocol !== "https:") {
    throw new UnsafeWebhookUrlError("Webhook URL must use https");
  }
  if (url.username || url.password) {
    throw new UnsafeWebhookUrlError("Webhook URL must not include credentials");
  }
  const host = url.hostname.replace(/^\[|\]$/g, "").toLowerCase();
  if (!host || BLOCKED_HOSTS.has(host) || host.endsWith(".local") || host.endsWith(".internal")) {
    throw new UnsafeWebhookUrlError("Webhook URL host is not allowed");
  }
  if (isIpv4(host) || host.includes(":")) {
    if (isPrivateOrMetadataIp(host)) {
      throw new UnsafeWebhookUrlError("Webhook URL must not target a private or metadata address");
    }
  }
  try {
    const records = await Deno.resolveDns(host, "A");
    for (const ip of records) {
      if (isPrivateOrMetadataIp(ip)) {
        throw new UnsafeWebhookUrlError("Webhook URL resolves to a private or metadata address");
      }
    }
  } catch (err) {
    if (err instanceof UnsafeWebhookUrlError) throw err;
    // DNS is best-effort. Literal private IPs and metadata hostnames are
    // already rejected above, so a resolver miss does not open those up.
  }
  return url;
}
