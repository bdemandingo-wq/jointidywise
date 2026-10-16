/**
 * Canonical activation milestones.
 *
 * The database check constraint in
 * supabase/migrations/20261014230000_activation_tracking_and_signup_utm.sql
 * must list the same keys. A milestone row is the first time something
 * happened. It is not the live status.
 *
 * The setup checklist reads live data for services, staff, OpenPhone, and
 * Stripe. Disconnecting or deleting those leaves the milestone row in place
 * and the step becomes needs_attention.
 *
 * first_payment_received is a client paying this cleaning business. It is
 * not TidyWise subscription revenue.
 */

import { stripeConnectAvailable } from "./invoiceCardPayments.ts";

export const ACTIVATION_MILESTONE_KEYS = [
  "trial_signup",
  "service_added",
  "staff_added",
  "openphone_connected",
  "stripe_connected",
  "first_job_booked",
  "clients_imported",
  "first_payment_received",
] as const;

export type ActivationMilestoneKey = (typeof ACTIVATION_MILESTONE_KEYS)[number];

/** created_via / source values that are imports, not native TidyWise writes. */
export const IMPORTED_CREATED_VIA = ["migration_import", "csv_import"] as const;

export type SetupStepState = "never_done" | "done" | "needs_attention";

export interface ActivationMilestone {
  key: ActivationMilestoneKey;
  /** Display label. Checklist steps use the in-app wording. */
  label: string;
  description: string;
  /** Shown on the setup checklist. The other keys are analytics-only. */
  inChecklist: boolean;
  link?: string;
  icon?: string;
  /** Shown when the milestone exists and the live check is false. */
  attention?: string;
}

export const ACTIVATION_MILESTONES: readonly ActivationMilestone[] = [
  {
    key: "trial_signup",
    label: "Trial signup",
    description: "The organization was created on a trial or free plan.",
    inChecklist: false,
  },
  {
    key: "service_added",
    label: "Add your first service",
    description: "Define the cleaning services you offer with pricing",
    inChecklist: true,
    link: "/dashboard/services",
    icon: "🧹",
    attention: "Needs attention, add an active service",
  },
  {
    key: "staff_added",
    label: "Add your first staff member",
    description: "Invite cleaners to start assigning jobs",
    inChecklist: true,
    link: "/dashboard/staff",
    icon: "👥",
    attention: "Needs attention, add an active staff member",
  },
  {
    key: "openphone_connected",
    label: "Connect OpenPhone",
    description: "Unlock SMS, calls, AI assistant, and daily reports",
    inChecklist: true,
    link: "/dashboard/settings?tab=sms",
    icon: "📱",
    attention: "Needs attention, reconnect OpenPhone",
  },
  {
    key: "stripe_connected",
    label: "Connect Stripe",
    description: "Accept payments and set up cleaner payouts",
    inChecklist: true,
    link: "/dashboard/payment-integration",
    icon: "💳",
    attention: "Needs attention, reconnect Stripe",
  },
  {
    key: "first_job_booked",
    label: "Create your first booking",
    description: "Schedule your first cleaning job",
    inChecklist: true,
    link: "/dashboard/bookings",
    icon: "📅",
    attention: "Needs attention, book a job",
  },
  {
    key: "clients_imported",
    label: "Clients imported",
    description: "Clients were brought in from a CSV or another system.",
    inChecklist: false,
  },
  {
    key: "first_payment_received",
    label: "First client payment received",
    description:
      "A client paid this cleaning business. This is not TidyWise subscription revenue.",
    inChecklist: false,
  },
];

export function checklistMilestones(): ActivationMilestone[] {
  return ACTIVATION_MILESTONES.filter((milestone) => milestone.inChecklist);
}

/**
 * Live completion wins. A recorded milestone with no live completion means
 * the org did it once and has since disconnected or removed it.
 */
export function setupStepState(liveComplete: boolean, milestoneRecorded: boolean): SetupStepState {
  if (liveComplete) return "done";
  if (milestoneRecorded) return "needs_attention";
  return "never_done";
}

export function isImportedCreatedVia(value: string | null | undefined): boolean {
  if (typeof value !== "string") return false;
  const normalized = value.trim().toLowerCase();
  return (IMPORTED_CREATED_VIA as readonly string[]).includes(normalized);
}

function flagTrue(value: unknown): boolean {
  if (value === true) return true;
  if (typeof value === "number") return value === 1;
  if (typeof value !== "string") return false;
  return ["true", "t", "1", "yes"].includes(value.trim().toLowerCase());
}

/**
 * Same rule as public.booking_is_real_job. Imported jobs, drafts, and test
 * rows do not complete "Create your first booking".
 */
export function bookingIsRealJob(row: {
  is_test?: unknown;
  is_draft?: unknown;
  created_via?: string | null;
  source?: string | null;
  notes?: string | null;
} | null | undefined): boolean {
  if (!row) return false;
  if (flagTrue(row.is_test) || flagTrue(row.is_draft)) return false;
  if (isImportedCreatedVia(row.created_via) || isImportedCreatedVia(row.source)) return false;
  const notes = typeof row.notes === "string" ? row.notes.trim() : "";
  if (notes.length > 0 && notes.toLowerCase().startsWith("[imported")) return false;
  return true;
}

/** Same rule as public.org_openphone_is_connected. Both pieces must be saved. */
export function openPhoneLiveConnected(
  hasApiKey: boolean,
  phoneNumberId: string | null | undefined,
): boolean {
  return hasApiKey === true && typeof phoneNumberId === "string" && phoneNumberId.trim().length > 0;
}

/**
 * Same rule as public.org_stripe_is_connected for the columns this app
 * actually stores. charges_enabled is not on org_stripe_settings.
 * Manual keys set is_connected and leave stripe_account_id null.
 * needs_reconnect is not live, even when an account id is still stored.
 */
export function stripeLiveConnected(
  row: {
    is_connected?: boolean | null;
    stripe_account_id?: string | null;
    connected?: boolean;
    needs_reconnect?: boolean;
    status?: string | null;
    account_id?: string | null;
  } | null | undefined,
): boolean {
  return stripeConnectAvailable(row);
}
