/**
 * Database side of the org-owner referral programme.
 *
 * The decisions live in saas-referral-logic.ts. This file applies them:
 * record who referred whom, count the first paid invoice once, grant one
 * banked or applied month per pair, and reverse that month when a qualifying
 * payment is refunded or disputed inside 30 days.
 *
 * Stripe is only asked to move customer balance. The amount passed to
 * createBalanceTransaction is always negative for a credit and positive only
 * when undoing one. This module never creates a charge.
 */
import {
  balanceCreditAmount,
  balanceReversalAmount,
  creditApplication,
  decideInvoiceEffect,
  initialReferralStatus,
  monthCreditCents,
  reconcileRewards,
  selfReferralReason,
  shouldReverseReferral,
  type RewardReferral,
  type RewardRow,
} from "./saas-referral-logic.ts";

export interface BalanceClient {
  createBalanceTransaction(
    customerId: string,
    body: { amount: number; currency: string; description: string },
    options: { idempotencyKey: string },
  ): Promise<{ id: string }>;
}

export interface ClaimInput {
  organizationId: string;
  userId: string;
  email: string | null;
  code: string | null;
}

function normalizeCode(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const cleaned = String(raw).toUpperCase().replace(/[^A-Z0-9]/g, "");
  return cleaned.length === 0 ? null : cleaned;
}

async function ownerEmail(admin: any, userId: string | null): Promise<string | null> {
  if (!userId) return null;
  const { data, error } = await admin.auth.admin.getUserById(userId);
  if (error) throw error;
  return data?.user?.email ?? null;
}

async function stripeCustomerId(admin: any, organizationId: string): Promise<string | null> {
  const sub = await latestSubscription(admin, organizationId);
  return sub?.stripe_customer_id ?? null;
}

async function latestSubscription(admin: any, organizationId: string): Promise<any | null> {
  const { data, error } = await admin
    .from("stripe_subscriptions")
    .select("id, status, stripe_customer_id, plan, billing_interval, updated_at")
    .eq("organization_id", organizationId)
    .order("updated_at", { ascending: false })
    .order("id", { ascending: false });
  if (error) throw error;
  const rows = data ?? [];
  return rows.find((row: any) => row.status === "active") ?? rows[0] ?? null;
}

export async function claimSaasReferral(
  admin: any,
  input: ClaimInput,
): Promise<{ outcome: string; status?: string }> {
  const code = normalizeCode(input.code);
  if (!code) return { outcome: "no_code" };

  const { data: referred, error: referredError } = await admin
    .from("organizations")
    .select("id, owner_id, plan_type, name")
    .eq("id", input.organizationId)
    .maybeSingle();
  if (referredError) throw referredError;
  if (!referred || referred.owner_id !== input.userId) return { outcome: "forbidden" };

  const { data: codeRow, error: codeError } = await admin
    .from("referral_codes")
    .select("id, code, organization_id")
    .eq("code", code)
    .maybeSingle();
  if (codeError) throw codeError;
  if (!codeRow) return { outcome: "invalid_code" };

  const { data: referrer, error: referrerError } = await admin
    .from("organizations")
    .select("id, owner_id")
    .eq("id", codeRow.organization_id)
    .maybeSingle();
  if (referrerError) throw referrerError;
  if (!referrer) return { outcome: "invalid_code" };

  const { data: existing, error: existingError } = await admin
    .from("referral_signups")
    .select("id, referrer_org_id, referred_org_name")
    .eq("referred_org_id", referred.id)
    .maybeSingle();
  if (existingError) throw existingError;
  if (existing) {
    if (referred.name && referred.name !== existing.referred_org_name) {
      await admin
        .from("referral_signups")
        .update({ referred_org_name: referred.name })
        .eq("id", existing.id);
    }
    await admin
      .from("organizations")
      .update({ referred_by: existing.referrer_org_id })
      .eq("id", referred.id);
    return { outcome: "already_recorded" };
  }

  const [referrerEmail, referrerCustomer, referredCustomer] = await Promise.all([
    ownerEmail(admin, referrer.owner_id),
    stripeCustomerId(admin, referrer.id),
    stripeCustomerId(admin, referred.id),
  ]);

  const reason = selfReferralReason(
    {
      orgId: referrer.id,
      userId: referrer.owner_id,
      email: referrerEmail,
      stripeCustomerId: referrerCustomer,
    },
    {
      orgId: referred.id,
      userId: input.userId,
      email: input.email,
      stripeCustomerId: referredCustomer,
    },
  );
  if (reason) {
    console.log("[saas-referral] blocked", reason, referred.id);
    return { outcome: "not_eligible" };
  }

  const status = initialReferralStatus(referred.plan_type);
  const { error: insertError } = await admin.from("referral_signups").insert({
    referral_code_id: codeRow.id,
    code: codeRow.code,
    referrer_org_id: referrer.id,
    referred_org_id: referred.id,
    referred_user_id: input.userId,
    referred_email: input.email,
    referred_org_name: referred.name,
    status,
  });
  if (insertError) {
    if (insertError.code === "23505") return { outcome: "already_recorded" };
    throw insertError;
  }

  const { error: referredByError } = await admin
    .from("organizations")
    .update({ referred_by: referrer.id })
    .eq("id", referred.id);
  if (referredByError) throw referredByError;

  return { outcome: "recorded", status };
}

async function loadLedger(admin: any, referrerOrgId: string): Promise<{
  referrals: RewardReferral[];
  rewards: RewardRow[];
  rawRewards: any[];
}> {
  const [referralRes, rewardRes] = await Promise.all([
    admin
      .from("referral_signups")
      .select("id, status, paid_at, block_reason")
      .eq("referrer_org_id", referrerOrgId)
      .order("paid_at", { ascending: true })
      .order("id", { ascending: true }),
    admin
      .from("referral_rewards")
      .select("id, reward_index, status, source_referral_ids, amount_cents, currency, stripe_customer_id")
      .eq("organization_id", referrerOrgId)
      .order("reward_index", { ascending: true })
      .order("id", { ascending: true }),
  ]);
  if (referralRes.error) throw referralRes.error;
  if (rewardRes.error) throw rewardRes.error;

  const referrals: RewardReferral[] = (referralRes.data ?? []).map((row: any) => ({
    id: row.id,
    status: row.status,
    paidAt: row.paid_at,
    blockReason: row.block_reason,
  }));
  const rawRewards = rewardRes.data ?? [];
  const rewards: RewardRow[] = rawRewards.map((row: any) => ({
    id: row.id,
    rewardIndex: row.reward_index,
    status: row.status,
    sourceReferralIds: row.source_referral_ids ?? [],
  }));
  return { referrals, rewards, rawRewards };
}

async function applyCredit(
  admin: any,
  stripe: BalanceClient,
  reward: any,
  customerId: string,
  cents: number,
): Promise<void> {
  const amount = balanceCreditAmount(cents);
  if (amount >= 0) throw new Error("Refusing to create a referral balance entry that is not a credit");
  const txn = await stripe.createBalanceTransaction(
    customerId,
    {
      amount,
      currency: reward.currency || "usd",
      description: "TidyWise referral reward — 1 free month",
    },
    { idempotencyKey: `saas-referral-reward-${reward.id}` },
  );
  const { error } = await admin
    .from("referral_rewards")
    .update({
      status: "applied",
      amount_cents: cents,
      stripe_customer_id: customerId,
      stripe_balance_transaction_id: txn.id,
      applied_at: new Date().toISOString(),
    })
    .eq("id", reward.id)
    .eq("status", "banked");
  if (error) throw error;
}

async function reverseCredit(admin: any, stripe: BalanceClient, reward: any): Promise<void> {
  if (reward.status === "applied" && reward.stripe_customer_id && reward.amount_cents) {
    const amount = balanceReversalAmount(reward.amount_cents);
    const txn = await stripe.createBalanceTransaction(
      reward.stripe_customer_id,
      {
        amount,
        currency: reward.currency || "usd",
        description: "Reversal of TidyWise referral reward",
      },
      { idempotencyKey: `saas-referral-reversal-${reward.id}` },
    );
    const { error } = await admin
      .from("referral_rewards")
      .update({
        status: "reversed",
        reversed_at: new Date().toISOString(),
        reversal_balance_transaction_id: txn.id,
      })
      .eq("id", reward.id)
      .eq("status", "applied");
    if (error) throw error;
    return;
  }

  const { error } = await admin
    .from("referral_rewards")
    .update({ status: "reversed", reversed_at: new Date().toISOString() })
    .eq("id", reward.id)
    .eq("status", "banked");
  if (error) throw error;
}

async function reconcileAndPersist(admin: any, stripe: BalanceClient, referrerOrgId: string): Promise<void> {
  const { referrals, rewards, rawRewards } = await loadLedger(admin, referrerOrgId);
  const decision = reconcileRewards(referrals, rewards);
  const sub = await latestSubscription(admin, referrerOrgId);
  const mode = creditApplication(sub?.status ?? null);
  const cents = monthCreditCents({
    unitAmount: null,
    interval: sub?.billing_interval ?? null,
    plan: sub?.plan ?? null,
  });

  for (const grant of decision.grants) {
    const { data: inserted, error } = await admin
      .from("referral_rewards")
      .insert({
        organization_id: referrerOrgId,
        reward_index: grant.rewardIndex,
        months: 1,
        status: "banked",
        amount_cents: cents,
        currency: "usd",
        source_referral_ids: grant.sourceReferralIds,
      })
      .select("id, reward_index, status, amount_cents, currency, stripe_customer_id")
      .maybeSingle();
    if (error) {
      if (error.code === "23505") continue;
      throw error;
    }
    if (
      inserted &&
      mode === "apply" &&
      sub?.stripe_customer_id &&
      cents
    ) {
      await applyCredit(admin, stripe, inserted, sub.stripe_customer_id, cents);
    }
  }

  for (const update of decision.referralStatusUpdates) {
    const { error } = await admin
      .from("referral_signups")
      .update({ status: update.status })
      .eq("id", update.id);
    if (error) throw error;
  }

  for (const reversal of decision.reversals) {
    const reward = rawRewards.find((row: any) => row.id === reversal.rewardId);
    if (!reward || reward.status === "reversed") continue;
    await reverseCredit(admin, stripe, reward);
  }
}

export async function applyBankedRewards(
  admin: any,
  stripe: BalanceClient,
  organizationId: string,
): Promise<void> {
  const sub = await latestSubscription(admin, organizationId);
  if (creditApplication(sub?.status ?? null) !== "apply") return;
  if (!sub?.stripe_customer_id) return;
  const cents = monthCreditCents({
    unitAmount: null,
    interval: sub.billing_interval ?? null,
    plan: sub.plan ?? null,
  });
  if (!cents) return;

  const { data, error } = await admin
    .from("referral_rewards")
    .select("id, status, amount_cents, currency, stripe_customer_id")
    .eq("organization_id", organizationId)
    .eq("status", "banked")
    .order("reward_index", { ascending: true })
    .order("id", { ascending: true });
  if (error) throw error;

  for (const reward of data ?? []) {
    const amount = reward.amount_cents ?? cents;
    if (!amount) continue;
    await applyCredit(admin, stripe, reward, sub.stripe_customer_id, amount);
  }
}

export interface InvoicePaidInput {
  invoiceId: string;
  amountPaid: number;
  organizationId: string | null;
  subscriptionId: string | null;
  stripeCustomerId: string | null;
  chargeId: string | null;
  paidAt: string;
  /** Stripe metadata purpose. Customer invoices must not count as a SaaS payment. */
  purpose: string | null;
}

async function resolveOrganizationId(admin: any, input: InvoicePaidInput): Promise<string | null> {
  // A cleaning-customer invoice can carry organization_id and even a subscription
  // id. Only the TidyWise plan subscription counts as "this org started paying".
  if (input.subscriptionId) {
    const { data, error } = await admin
      .from("stripe_subscriptions")
      .select("organization_id")
      .eq("stripe_subscription_id", input.subscriptionId)
      .maybeSingle();
    if (error) throw error;
    if (data?.organization_id) return data.organization_id;
  }
  if (input.purpose === "tidywise_saas_subscription" && input.organizationId) {
    return input.organizationId;
  }
  return null;
}

export async function recordReferralInvoicePaid(
  admin: any,
  input: InvoicePaidInput,
  stripe: BalanceClient,
): Promise<void> {
  const orgId = await resolveOrganizationId(admin, input);
  if (!orgId) return;

  if (input.amountPaid > 0) {
    await applyBankedRewards(admin, stripe, orgId);
  }

  const { data: referral, error } = await admin
    .from("referral_signups")
    .select("id, status, referrer_org_id, referred_org_id, qualifying_invoice_id, block_reason, paid_at")
    .eq("referred_org_id", orgId)
    .maybeSingle();
  if (error) throw error;
  if (!referral) return;

  if (input.stripeCustomerId && !referral.block_reason) {
    const referrerCustomer = await stripeCustomerId(admin, referral.referrer_org_id);
    const reason = selfReferralReason(
      { orgId: referral.referrer_org_id, userId: null, email: null, stripeCustomerId: referrerCustomer },
      { orgId, userId: null, email: null, stripeCustomerId: input.stripeCustomerId },
    );
    if (reason === "same_stripe_customer") {
      await admin.from("referral_signups").update({ block_reason: reason }).eq("id", referral.id);
      return;
    }
  }

  const decision = decideInvoiceEffect(
    {
      status: referral.status,
      qualifyingInvoiceId: referral.qualifying_invoice_id,
      blockReason: referral.block_reason,
    },
    { id: input.invoiceId, amountPaid: input.amountPaid },
  );

  if (decision.action === "ignore") return;

  if (decision.action === "mark_trialing") {
    const { error: trialError } = await admin
      .from("referral_signups")
      .update({ status: "trialing" })
      .eq("id", referral.id)
      .eq("status", "signed_up");
    if (trialError) throw trialError;
    return;
  }

  const { data: updated, error: paidError } = await admin
    .from("referral_signups")
    .update({
      status: "paid",
      qualifying_invoice_id: input.invoiceId,
      qualifying_charge_id: input.chargeId,
      paid_at: input.paidAt,
      stripe_customer_id: input.stripeCustomerId,
    })
    .eq("id", referral.id)
    .in("status", ["signed_up", "trialing"])
    .is("qualifying_invoice_id", null)
    .select("id")
    .maybeSingle();
  if (paidError) {
    if (paidError.code === "23505") return;
    throw paidError;
  }
  if (!updated) return;

  await reconcileAndPersist(admin, stripe, referral.referrer_org_id);
}

export interface ReversalInput {
  chargeId: string | null;
  invoiceId: string | null;
  /**
   * Basil invoice.parent.subscription_details.subscription, else invoice.subscription.
   * Reversal does not use it. A subscription id is not the qualifying charge.
   */
  subscriptionId?: string | null;
  eventAt: string;
  reason: "refund" | "dispute";
}

export async function recordReferralReversal(
  admin: any,
  input: ReversalInput,
  stripe: BalanceClient,
): Promise<void> {
  let referral: any = null;
  if (input.chargeId) {
    const { data, error } = await admin
      .from("referral_signups")
      .select("id, status, paid_at, referrer_org_id")
      .eq("qualifying_charge_id", input.chargeId)
      .maybeSingle();
    if (error) throw error;
    referral = data;
  }
  if (!referral && input.invoiceId) {
    const { data, error } = await admin
      .from("referral_signups")
      .select("id, status, paid_at, referrer_org_id")
      .eq("qualifying_invoice_id", input.invoiceId)
      .maybeSingle();
    if (error) throw error;
    referral = data;
  }
  // Do not fall back to "any referral for this subscription's org".
  // A later refund of a different charge on the same subscription is not
  // the qualifying charge, and reversing it would claw back a reward the
  // referrer already earned.
  if (!referral) return;
  if (!shouldReverseReferral({ status: referral.status, paidAt: referral.paid_at, eventAt: input.eventAt })) {
    return;
  }

  const { data: updated, error } = await admin
    .from("referral_signups")
    .update({
      status: "reversed",
      reversed_at: input.eventAt,
      reversal_reason: input.reason,
    })
    .eq("id", referral.id)
    .in("status", ["paid", "rewarded"])
    .select("id")
    .maybeSingle();
  if (error) throw error;
  if (!updated) return;

  await reconcileAndPersist(admin, stripe, referral.referrer_org_id);
}
