// Shared organization-branded email renderer.
// Single source of truth for HTML used in:
//   - Real customer emails (booking confirmation, reminder, etc.)
//   - Preview Email dialog in Settings → Emails
//   - Send Test Email from Settings → Emails
// The identical function is used for all three paths so previews match reality.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { formatBookingTotal, renderSectionsToHtml, sanitizeSectionHtml, sectionCardContent, type EmailSection } from "./email-sections.ts";
import { orgBrandVars, renderCrmEmail } from "./crm-email/render.ts";

export interface OrgBrand {
  companyName: string;
  logoUrl: string | null;
  primaryColor: string;
  accentColor: string;
  fromName: string;
  fromEmail: string;
  replyToEmail: string;
  emailFooter: string | null;
  companyAddress: string;
  contactEmail: string;
}

export interface BookingEmailData {
  customer_name: string;
  booking_number: string;
  service_name: string;
  scheduled_date: string;
  scheduled_time: string;
  address: string;
  total_amount: string;
  company_name: string;
}

export const SAMPLE_BOOKING_DATA: BookingEmailData = {
  customer_name: "Jane Doe",
  booking_number: "BK-10234",
  service_name: "Deep Cleaning",
  scheduled_date: "January 15, 2026",
  scheduled_time: "10:00 AM",
  address: "123 Main Street, Anytown",
  total_amount: "185.00",
  company_name: "Your Company",
};

function escapeHtml(s: string): string {
  return String(s ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

export function replaceBookingVariables(text: string, data: BookingEmailData): string {
  if (!text) return "";
  let out = text;
  for (const [key, val] of Object.entries(data)) {
    out = out.replaceAll(`{{${key}}}`, String(val ?? ""));
  }
  return out;
}

/**
 * Resolve a `storage:<bucket>:<path>` reference or a raw URL into a browser-accessible
 * image URL, then HEAD-verify it returns an image content-type. Returns null on failure
 * so callers can fall back to rendering the company name as text (no broken image).
 */
export async function resolveLogoUrl(
  logoUrl: string | null,
  supabaseUrl: string,
  admin: ReturnType<typeof createClient>,
): Promise<string | null> {
  if (!logoUrl) return null;
  let candidate: string | null = null;

  if (logoUrl.startsWith("storage:")) {
    const [, bucket, ...pathParts] = logoUrl.split(":");
    const path = pathParts.join(":");
    if (!bucket || !path) return null;

    // Check if the bucket is public; if so a public URL works, otherwise sign it.
    const { data: bucketInfo } = await admin.storage.getBucket(bucket);
    if (bucketInfo?.public) {
      candidate = `${supabaseUrl}/storage/v1/object/public/${bucket}/${path}`;
    } else {
      const { data: signed } = await admin.storage
        .from(bucket)
        .createSignedUrl(path, 60 * 60 * 24 * 7); // 7 days
      candidate = signed?.signedUrl ?? null;
    }
  } else if (/^https?:\/\//i.test(logoUrl)) {
    candidate = logoUrl;
  }

  if (!candidate) return null;

  // Verify content-type; if unreachable or non-image, skip the logo entirely.
  try {
    const head = await fetch(candidate, { method: "HEAD" });
    if (!head.ok) return null;
    const ct = head.headers.get("content-type") || "";
    if (!ct.startsWith("image/")) return null;
    return candidate;
  } catch {
    return null;
  }
}

/** Load full branding for an org (business_settings + organization_email_settings). */
export async function loadOrgBrand(organizationId: string): Promise<
  { success: true; brand: OrgBrand } | { success: false; error: string }
> {
  if (!organizationId) {
    return { success: false, error: "Missing organizationId" };
  }
  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const supabase = createClient(supabaseUrl, supabaseKey);

  const [{ data: bs, error: bsErr }, { data: es, error: esErr }] = await Promise.all([
    supabase
      .from("business_settings")
      .select("company_name, logo_url, primary_color, accent_color, company_address, company_city, company_state, company_zip, company_email")
      .eq("organization_id", organizationId)
      .maybeSingle(),
    supabase
      .from("organization_email_settings")
      .select("from_name, from_email, reply_to_email, email_footer")
      .eq("organization_id", organizationId)
      .maybeSingle(),
  ]);

  if (bsErr) return { success: false, error: `business_settings: ${bsErr.message}` };
  if (esErr) return { success: false, error: `organization_email_settings: ${esErr.message}` };
  if (!es || !es.from_name || !es.from_email) {
    return {
      success: false,
      error:
        "Email identity not configured. Set From Name and From Email in Settings → Emails.",
    };
  }

  const brand: OrgBrand = {
    companyName: bs?.company_name || es.from_name,
    logoUrl: await resolveLogoUrl(bs?.logo_url ?? null, supabaseUrl, supabase as any),
    primaryColor: bs?.primary_color || "#1e5bb0",
    accentColor: bs?.accent_color || "#14b8a6",
    fromName: es.from_name,
    fromEmail: es.from_email,
    replyToEmail: es.reply_to_email || es.from_email,
    emailFooter: es.email_footer ?? null,
    companyAddress: formatStoredAddress(bs),
    contactEmail: (es.reply_to_email || es.from_email || bs?.company_email || "").trim(),
  };
  return { success: true, brand };
}

export interface RenderOptions {
  brand: OrgBrand;
  subject: string;
  /** Legacy plain-text body (fallback when no sections). Supports \n and {{vars}}. */
  bodyText?: string;
  /** Preferred: structured rich-text sections built in the UI. */
  sections?: EmailSection[];
  /** Booking data used for variable substitution and appointment card */
  data: BookingEmailData;
  /** If true, renders a structured appointment card under the body */
  showAppointmentCard?: boolean;
  /** Label shown in the banner (e.g. "Booking Confirmed" or "Appointment Reminder") */
  bannerLabel?: string;
}

/**
 * Renders a fully branded, responsive HTML email using the org's identity.
 * If `sections` are provided, they take precedence over `bodyText`.
 */
function bookingSlotHtml(body: string, data: BookingEmailData): string {
  const replaced = replaceBookingVariables(body || "", data);
  return replaced
    .split(/\n{2,}/)
    .map((para) => {
      const lines = para.split(/\n/).map((line) => escapeHtml(line)).join("<br>");
      return `<p style="margin:0 0 16px 0;">${lines}</p>`;
    })
    .join("");
}

function sectionCards(sections: EmailSection[] | undefined, data: BookingEmailData): Array<Record<string, string>> {
  const active = [...(sections ?? [])].filter((s) => s.enabled).sort((a, b) => a.order - b.order);
  const rows: Array<Record<string, string>> = [];
  for (const section of active) {
    const resolved = sectionCardContent(section);
    if (!resolved) continue;
    const body = sanitizeSectionHtml(resolved.html);
    let filled = body;
    for (const [k, v] of Object.entries(data)) {
      filled = filled.split(`{{${k}}}`).join(escapeHtml(String(v ?? "")));
    }
    let titleFilled = resolved.title;
    for (const [k, v] of Object.entries(data)) {
      titleFilled = titleFilled.split(`{{${k}}}`).join(String(v ?? ""));
    }
    rows.push({ "section.title": titleFilled, "section.body": filled });
  }
  return rows;
}

/**
 * Booking confirmation uses the branded design as a wrapper. The owner's
 * subject, body and sections stay owner-editable and render inside it.
 * Reminder previews keep the previous shell — that email has no production
 * sender and no design in the set.
 */
function renderConfirmationDesign(opts: RenderOptions): { subject: string; html: string } {
  const { brand, data } = opts;
  const subject = replaceBookingVariables(opts.subject || "", data);
  const useSections = !!opts.sections && opts.sections.some((s) => s.enabled);
  const slot = useSections ? "" : bookingSlotHtml(opts.bodyText || "", data);
  const { html } = renderCrmEmail("booking-confirmation", {
    vars: {
      ...orgBrandVars({
        companyName: brand.companyName,
        logoUrl: brand.logoUrl,
        primaryColor: brand.primaryColor,
        accentColor: brand.accentColor,
        emailFooter: brand.emailFooter,
        companyAddress: brand.companyAddress,
        contactEmail: brand.contactEmail || brand.replyToEmail,
      }),
      customer_name: data.customer_name,
      booking_number: data.booking_number,
      service_name: data.service_name,
      scheduled_date: data.scheduled_date,
      scheduled_time: data.scheduled_time,
      address: data.address,
      total_amount: formatBookingTotal(data.total_amount),
      company_name: data.company_name || brand.companyName,
    },
    slots: [slot],
    repeats: [{ prefix: "section.", rows: useSections ? sectionCards(opts.sections, data) : [] }],
    rawKeys: ["section.body", "email_footer"],
  });
  return { subject, html };
}

export function renderBrandedEmail(opts: RenderOptions): { subject: string; html: string } {
  if (opts.bannerLabel !== "Appointment Reminder") {
    return renderConfirmationDesign(opts);
  }
  const { brand, data } = opts;
  const subject = replaceBookingVariables(opts.subject || "", data);

  let bodyHtml = "";
  if (opts.sections && opts.sections.length > 0) {
    bodyHtml = renderSectionsToHtml(opts.sections, data, brand.primaryColor);
  } else {
    const bodyReplaced = replaceBookingVariables(opts.bodyText || "", data);
    bodyHtml = bodyReplaced
      .split(/\n{2,}/)
      .map((para) => {
        const lines = para.split(/\n/).map(escapeHtml).join("<br />");
        return `<p style="margin:0 0 16px 0;font-size:15px;color:#374151;line-height:1.65;">${lines}</p>`;
      })
      .join("");
  }


  const primary = brand.primaryColor;
  const accent = brand.accentColor;
  const companyName = escapeHtml(brand.companyName);
  const logo = brand.logoUrl;
  const banner = escapeHtml(opts.bannerLabel || "");
  const footerCustom = brand.emailFooter
    ? `<p style="color:#9ca3af;font-size:12px;margin:0 0 6px;line-height:1.5;">${escapeHtml(brand.emailFooter)}</p>`
    : "";

  // If the logo URL is present it has already been HEAD-verified upstream. The
  // inline onerror handler is a belt-and-braces safeguard for the preview iframe
  // (email clients strip event handlers, which is fine — the URL is verified).
  const headerBlock = logo
    ? `<img src="${escapeHtml(logo)}" alt="${companyName}" height="56" style="max-height:56px;display:block;margin:0 auto;background:#fff;padding:6px 10px;border-radius:8px;" onerror="this.outerHTML='&lt;div style=&quot;font-size:28px;font-weight:700;color:#ffffff;letter-spacing:0.3px;&quot;&gt;${companyName}&lt;/div&gt;';" />`
    : `<div style="font-size:28px;font-weight:700;color:#ffffff;letter-spacing:0.3px;">${companyName}</div>`;

  const bannerBlock = banner
    ? `<tr><td style="background-color:${accent};padding:14px;text-align:center;">
         <span style="color:#ffffff;font-size:15px;font-weight:600;letter-spacing:0.5px;text-transform:uppercase;">${banner}</span>
       </td></tr>`
    : "";

  const appointmentCard = opts.showAppointmentCard
    ? `
    <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%" style="background-color:#f9fafb;border-radius:12px;margin:8px 0 24px;border:1px solid #e5e7eb;">
      <tr><td style="padding:22px 24px;">
        <h3 style="margin:0 0 14px;color:${primary};font-size:12px;text-transform:uppercase;letter-spacing:1.2px;font-weight:700;">Appointment Details</h3>
        <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%" style="font-size:14px;color:#1f2937;">
          <tr><td style="padding:6px 0;color:#6b7280;width:130px;">Booking #</td><td style="padding:6px 0;font-weight:600;">${escapeHtml(data.booking_number)}</td></tr>
          <tr><td style="padding:6px 0;color:#6b7280;">Service</td><td style="padding:6px 0;font-weight:600;">${escapeHtml(data.service_name)}</td></tr>
          <tr><td style="padding:6px 0;color:#6b7280;">Date</td><td style="padding:6px 0;font-weight:600;">${escapeHtml(data.scheduled_date)}</td></tr>
          <tr><td style="padding:6px 0;color:#6b7280;">Time</td><td style="padding:6px 0;font-weight:600;">${escapeHtml(data.scheduled_time)}</td></tr>
          <tr><td style="padding:6px 0;color:#6b7280;">Address</td><td style="padding:6px 0;font-weight:600;">${escapeHtml(data.address)}</td></tr>
          <tr><td style="padding:6px 0;color:#6b7280;">Total</td><td style="padding:6px 0;font-weight:700;color:${primary};">$${escapeHtml(data.total_amount)}</td></tr>
        </table>
      </td></tr>
    </table>`
    : "";

  const html = `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${escapeHtml(subject)}</title>
</head>
<body style="margin:0;padding:0;background-color:#f5f5f5;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,'Helvetica Neue',Arial,sans-serif;color:#333;line-height:1.6;">
  <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%" style="background-color:#f5f5f5;">
    <tr><td style="padding:24px 12px;">
      <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="600" style="margin:0 auto;max-width:600px;background-color:#ffffff;border-radius:14px;overflow:hidden;box-shadow:0 4px 14px rgba(0,0,0,0.06);">
        <tr>
          <td style="background:linear-gradient(135deg, ${primary} 0%, ${accent} 100%);padding:36px 24px;text-align:center;">
            ${headerBlock}
          </td>
        </tr>
        ${bannerBlock}
        <tr>
          <td style="padding:32px 28px 8px;">
            ${bodyHtml}
            ${appointmentCard}
          </td>
        </tr>
        <tr>
          <td style="padding:8px 28px 28px;">
            <hr style="border:none;border-top:1px solid #e5e7eb;margin:8px 0 18px;" />
            <p style="margin:0;text-align:center;font-size:13px;color:#6b7280;">
              Questions? Reply to this email — it goes straight to ${escapeHtml(brand.replyToEmail)}.
            </p>
          </td>
        </tr>
        <tr>
          <td style="background-color:#111827;padding:22px 24px;text-align:center;">
            <p style="color:#ffffff;font-size:15px;font-weight:600;margin:0 0 4px;">${companyName}</p>
            ${footerCustom}
            <p style="color:#9ca3af;font-size:11px;margin:6px 0 0;">© ${new Date().getFullYear()} ${companyName}. All rights reserved.</p>
          </td>
        </tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;

  return { subject, html };
}

/** Branding for org-colored mail. Missing settings fall back; they do not block the send. */
export function formatStoredAddress(bs: {
  company_address?: string | null;
  company_city?: string | null;
  company_state?: string | null;
  company_zip?: string | null;
} | null | undefined): string {
  if (!bs) return "";
  const street = (bs.company_address || "").trim();
  const city = (bs.company_city || "").trim();
  const state = (bs.company_state || "").trim();
  const zip = (bs.company_zip || "").trim();
  const region = [state, zip].filter(Boolean).join(" ");
  const cityLine = [city, region].filter(Boolean).join(", ");
  return [street, cityLine].filter(Boolean).join(", ");
}

export async function loadLooseBrand(organizationId: string): Promise<{
  companyName: string;
  logoUrl: string | null;
  primaryColor: string | null;
  accentColor: string | null;
  emailFooter: string | null;
  companyAddress: string;
  contactEmail: string;
}> {
  const empty = {
    companyName: "Your business",
    logoUrl: null as string | null,
    primaryColor: null as string | null,
    accentColor: null as string | null,
    emailFooter: null as string | null,
    companyAddress: "",
    contactEmail: "",
  };
  if (!organizationId) return empty;
  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (!supabaseUrl || !supabaseKey) return empty;
    const admin = createClient(supabaseUrl, supabaseKey);
    const [{ data: bs }, { data: es }] = await Promise.all([
      admin
        .from("business_settings")
        .select("company_name, logo_url, primary_color, accent_color, company_address, company_city, company_state, company_zip, company_email")
        .eq("organization_id", organizationId)
        .maybeSingle(),
      admin
        .from("organization_email_settings")
        .select("from_name, from_email, reply_to_email, email_footer")
        .eq("organization_id", organizationId)
        .maybeSingle(),
    ]);
    return {
      companyName: bs?.company_name || es?.from_name || "Your business",
      logoUrl: await resolveLogoUrl(bs?.logo_url ?? null, supabaseUrl, admin as any),
      primaryColor: bs?.primary_color ?? null,
      accentColor: bs?.accent_color ?? null,
      emailFooter: es?.email_footer ?? null,
      companyAddress: formatStoredAddress(bs),
      contactEmail: (es?.reply_to_email || es?.from_email || bs?.company_email || "").trim(),
    };
  } catch (err) {
    console.error("[loadLooseBrand]", err);
    return empty;
  }
}
