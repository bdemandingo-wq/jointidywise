/**
 * Render one branded CRM email.
 *
 * Throws if a {{token}} or {token} is still in the HTML after filling.
 * A literal placeholder must never be handed to a mail provider.
 */
import { TEMPLATES, type CrmSlug } from "./templates.ts";
import {
  DEFAULT_ORG_ACCENT,
  DEFAULT_ORG_PRIMARY,
  TIDYWISE_LOGO_URL,
  fillTemplate,
  findLeftoverTokens,
  htmlToText,
  safeColor,
  type FillInput,
} from "./fill.ts";

export {
  DEFAULT_ORG_ACCENT,
  DEFAULT_ORG_PRIMARY,
  TIDYWISE_LOGO_URL,
  UNSUBSCRIBE_URL_SENTINEL,
  safeColor,
} from "./fill.ts";
export type { CrmSlug } from "./templates.ts";
export type { FillInput, RepeatSpec } from "./fill.ts";

const BLOCKED_PHONE_DIGITS = "5615718725";

export function renderCrmEmail(slug: CrmSlug, input: FillInput = {}): { html: string; text: string } {
  const template = TEMPLATES[slug];
  if (!template) throw new Error(`Unknown CRM email template: ${slug}`);
  const vars = { ...input.vars };
  if (template.includes("{{LOGO_URL}}") && (vars.LOGO_URL === undefined || vars.LOGO_URL === null || vars.LOGO_URL === "")) {
    vars.LOGO_URL = TIDYWISE_LOGO_URL;
  }
  const html = fillTemplate(template, { ...input, vars });
  const leftovers = findLeftoverTokens(html);
  if (leftovers.length) {
    throw new Error(`CRM email ${slug} has unreplaced tokens: ${leftovers.join(", ")}`);
  }
  return { html, text: htmlToText(html) };
}

/** True when the rendered source contains TidyWise's own published phone number. */
export function containsBlockedPhone(value: string): boolean {
  return value.replace(/\D/g, "").includes(BLOCKED_PHONE_DIGITS);
}

export interface OrgBrandInput {
  companyName?: string | null;
  logoUrl?: string | null;
  primaryColor?: string | null;
  accentColor?: string | null;
  emailFooter?: string | null;
  /** Street plus city line, already joined. Empty when the org has none stored. */
  companyAddress?: string | null;
  /** Reply-to or from address. Empty when the org has none stored. */
  contactEmail?: string | null;
}

/** Tokens shared by every org-branded (client or staff) design. */
export function orgBrandVars(brand: OrgBrandInput = {}): Record<string, string> {
  const name = (brand.companyName || "Your business").trim() || "Your business";
  const footer = brand.emailFooter ? escapeFooter(brand.emailFooter) : "";
  const address = (brand.companyAddress || "").trim();
  const contact = (brand.contactEmail || "").trim();
  const orgContactLine = [name, address, contact].filter(Boolean).join(" · ");
  return {
    ORG_LOGO_URL: brand.logoUrl || "",
    primary_color: safeColor(brand.primaryColor, DEFAULT_ORG_PRIMARY),
    accent_color: safeColor(brand.accentColor, DEFAULT_ORG_ACCENT),
    email_footer: footer,
    companyName: name,
    company_name: name,
    orgName: name,
    biz: name,
    businessName: name,
    company_address: address,
    contact_email: contact,
    org_contact_line: orgContactLine,
  };
}

function escapeFooter(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;")
    .replace(/\n/g, "<br>");
}

export type AuthEmailKind = "signup" | "invite" | "magiclink" | "recovery" | "email_change" | "reauthentication";

const AUTH_SLUG: Record<AuthEmailKind, CrmSlug> = {
  signup: "auth-signup-confirm",
  invite: "auth-invite",
  magiclink: "auth-reset-code",
  recovery: "auth-password-recovery",
  email_change: "auth-email-change",
  reauthentication: "auth-reauthentication",
};

export function renderAuthEmail(
  kind: AuthEmailKind,
  props: { confirmationUrl?: string; token?: string; logoUrl?: string },
): { html: string; text: string } {
  return renderCrmEmail(AUTH_SLUG[kind], {
    vars: {
      confirmationUrl: props.confirmationUrl || "",
      token: props.token || "",
      LOGO_URL: props.logoUrl || TIDYWISE_LOGO_URL,
    },
  });
}
