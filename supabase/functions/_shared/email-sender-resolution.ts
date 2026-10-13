/**
 * Which sender identity should an email use, and did it fall back?
 *
 * Deliberately ZERO imports and no Deno globals, so `node:test` can load it
 * directly (same shape as _shared/facebook-lead-mapping.ts). Tests:
 * src/lib/emailSenderResolution.test.ts
 *
 * WHY THIS EXISTS. Exactly one org of 30 ever received a payroll report. The other
 * 29 failed three different ways — 22 with no email settings row, 7 with an invalid
 * org-supplied Resend key, 1 with an unverified gmail.com sender domain — and not
 * one of those branches was reachable by a test, because the decision was welded to
 * `fetch` and `createClient`. Pulling the decision out makes every branch
 * addressable.
 *
 * See docs/superpowers/plans/2026-08-13-owner-email-platform-fallback.md
 */

/**
 * The platform sender. ONE named constant — inline copies of the From address
 * are how the domain drifts.
 *
 * jointidywise.com is the domain verified in Resend. A fallback sending from
 * the owner's separate cleaning-business domain (tidywisecleaning.com) or from
 * `noreply@resend.dev` would fail for the exact reason this fallback exists.
 * Never fall back to Resend's sandbox domain — the now-deleted
 * weekly-payroll-summary used to, and it was not a pattern to copy.
 *
 * This is the transactional noreply identity. Public support / reply-to is
 * TIDYWISE_SUPPORT_EMAIL in email-footer.ts (support@jointidywise.com).
 */
export const PLATFORM_SENDER_NAME = "TidyWise";
export const PLATFORM_SENDER_EMAIL = "noreply@jointidywise.com";
export const PLATFORM_SENDER_FROM = `${PLATFORM_SENDER_NAME} <${PLATFORM_SENDER_EMAIL}>`;

export type FallbackReason =
  | "org_settings_missing"
  | "org_settings_incomplete"
  | "org_send_failed";

export interface ResolvedSender {
  from: string;
  keySource: "org" | "platform";
  usedFallback: boolean;
  /** Non-null exactly when usedFallback. Written to the failure log. */
  fallbackReason: FallbackReason | null;
}

export interface OrgSenderSettings {
  from_name: string;
  from_email: string;
  resend_api_key: string | null;
}

export interface ResolveSenderInput {
  settings: OrgSenderSettings | null;
  platformFrom: string;
  platformKeyPresent: boolean;
  /** Owner-facing internal reports pass true. Customer-facing mail passes false. */
  allowPlatformFallback: boolean;
  /** Set on a retry, after the org identity has already failed once. */
  priorFailure?: string | null;
}

export type ResolveSenderResult =
  | { ok: true; sender: ResolvedSender }
  | { ok: false; error: string };

/**
 * Decide the sender for one send attempt.
 *
 * Pure: no I/O, no mutation of `input`, same answer for the same argument. The
 * caller performs the send and, on an identity-shaped failure, calls again with
 * `priorFailure` set to escalate.
 *
 * The asymmetry between owner-facing and customer-facing mail is the whole point
 * and is deliberate. An internal report to an owner about their own payroll should
 * not depend on that org having configured a customer-facing sender. A customer
 * email should still fail closed, because silently sending a business's customer
 * mail from TidyWise's address is a worse outcome than not sending it.
 */
export function resolveSender(input: ResolveSenderInput): ResolveSenderResult {
  const { settings, platformFrom, platformKeyPresent, allowPlatformFallback } = input;
  const priorFailure = input.priorFailure ?? null;

  // Every fallback route lands here, so the guards cannot be forgotten on one
  // path. NOT named usePlatform: eslint's react-hooks rule treats any `useX`
  // identifier as a React hook and errors on it outside a component.
  const fallBackToPlatform = (reason: FallbackReason, why: string): ResolveSenderResult => {
    if (!allowPlatformFallback) {
      return { ok: false, error: why };
    }
    // A fallback that cannot actually send is worse than no fallback: it turns a
    // legible failure into a claim of success.
    if (!platformKeyPresent) {
      return {
        ok: false,
        error: `${why} — and no platform Resend key is configured, so there is nothing to fall back to.`,
      };
    }
    if (!platformFrom.trim()) {
      return {
        ok: false,
        error: `${why} — and no platform sender address was supplied, so the From header would be empty.`,
      };
    }
    return {
      ok: true,
      sender: { from: platformFrom, keySource: "platform", usedFallback: true, fallbackReason: reason },
    };
  };

  // Checked first: a prior failure means the org identity has already been tried
  // and rejected, so re-deriving it from settings would just repeat the failure.
  // This covers BOTH an invalid org key and an unverified org domain — the latter
  // is why the retry must change the From and not only the API key.
  if (priorFailure) {
    return fallBackToPlatform(
      "org_send_failed",
      `The organisation's own email identity failed to send (${priorFailure}).`,
    );
  }

  if (!settings) {
    return fallBackToPlatform(
      "org_settings_missing",
      "Email settings not configured for this organization.",
    );
  }

  // A row exists but is unusable. Kept distinct from "missing" so the log can tell
  // a never-configured org from a half-configured one — they need different
  // messages to their owner.
  if (!settings.from_name?.trim() || !settings.from_email?.trim()) {
    return fallBackToPlatform(
      "org_settings_incomplete",
      "Email settings incomplete: both a From Name and a From Email are required.",
    );
  }

  // The org identity is usable. Borrowing the platform KEY is not a fallback: the
  // sender the recipient sees is unchanged, so nothing is masked and nothing is
  // logged as degraded. This preserves send-org-email.ts:163's behaviour.
  const keySource: "org" | "platform" = settings.resend_api_key ? "org" : "platform";
  if (keySource === "platform" && !platformKeyPresent) {
    return {
      ok: false,
      error:
        "No Resend API key available: the organisation has not supplied one and no platform key is configured.",
    };
  }

  return {
    ok: true,
    sender: {
      from: `${settings.from_name} <${settings.from_email}>`,
      keySource,
      usedFallback: false,
      fallbackReason: null,
    },
  };
}
