import { createStripeClient } from "../_shared/stripe-client.ts";
import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import Stripe from "https://esm.sh/stripe@18.5.0";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.2";
import { billingSecretKey } from "../_shared/billing-stripe.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};


const log = (step: string, details?: any) => {
  const detailsStr = details ? ` - ${JSON.stringify(details)}` : "";
  console.log(`[ADMIN-CANCEL-SUB] ${step}${detailsStr}`);
};

const isMissingSubscriptionError = (error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  return message.includes("No such subscription");
};

const findCancelableSubscriptionByEmail = async (
  stripe: Stripe,
  customerEmail: string,
) => {
  const customers = await stripe.customers.list({ email: customerEmail, limit: 1 });
  if (customers.data.length === 0) {
    return { error: "No Stripe customer found" as const };
  }

  const subs = await stripe.subscriptions.list({
    customer: customers.data[0].id,
    status: "all",
    limit: 10,
  });
  const active = subs.data.find((s) => ["active", "trialing", "past_due"].includes(s.status));

  if (!active) {
    return { error: "No cancelable subscription found" as const };
  }

  return { subscriptionId: active.id };
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const stripeKey = billingSecretKey();
    if (!stripeKey) throw new Error("STRIPE_BILLING_SECRET_KEY is not set");

    // Verify the user is a platform admin via the canonical RPC.
    // Hardcoding a single email here previously locked out the second
    // platform admin (is_platform_admin() in SQL allows two emails;
    // this function only allowed one).
    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const userClient = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_ANON_KEY") ?? "",
      { global: { headers: { Authorization: authHeader } } },
    );
    const { data: udata } = await userClient.auth.getUser(
      authHeader.replace("Bearer ", ""),
    );
    if (!udata?.user) {
      return new Response(JSON.stringify({ error: "Invalid token" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const { data: isAdmin, error: adminErr } = await userClient.rpc(
      "is_platform_admin",
    );
    if (adminErr || !isAdmin) {
      return new Response(JSON.stringify({ error: "Platform admin access only" }), {
        status: 403,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Service-role client for the privileged DB writes the gate authorized.
    const supabaseClient = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
      { auth: { persistSession: false } }
    );

    const body = await req.json().catch(() => ({}));
    let { subscriptionId, customerEmail, immediate } = body as {
      subscriptionId?: string;
      customerEmail?: string;
      immediate?: boolean;
    };

    const stripe = await createStripeClient(stripeKey, { apiVersion: "2025-08-27.basil" });

    if (subscriptionId) {
      try {
        await stripe.subscriptions.retrieve(subscriptionId);
      } catch (error) {
        if (!customerEmail || !isMissingSubscriptionError(error)) {
          throw error;
        }

        log("Provided subscriptionId was stale, retrying lookup by email", {
          subscriptionId,
          customerEmail,
        });
        subscriptionId = undefined;
      }
    }

    // If no valid subscriptionId given, look it up by email
    if (!subscriptionId) {
      if (!customerEmail) {
        return new Response(
          JSON.stringify({ error: "subscriptionId or customerEmail required" }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
      const lookup = await findCancelableSubscriptionByEmail(stripe, customerEmail);
      if ("error" in lookup) {
        return new Response(JSON.stringify({ error: lookup.error }), {
          status: 404,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      subscriptionId = lookup.subscriptionId;
    }

    log("Cancelling subscription", { subscriptionId, immediate, by: udata.user.email });

    let result;

    try {
      result = immediate
        ? await stripe.subscriptions.cancel(subscriptionId)
        : await stripe.subscriptions.update(subscriptionId, { cancel_at_period_end: true });
    } catch (error) {
      if (!customerEmail || !isMissingSubscriptionError(error)) {
        throw error;
      }

      log("Subscription disappeared during cancel request, retrying lookup by email", {
        subscriptionId,
        customerEmail,
      });

      const lookup = await findCancelableSubscriptionByEmail(stripe, customerEmail);
      if ("error" in lookup) {
        return new Response(JSON.stringify({ error: lookup.error }), {
          status: 404,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      subscriptionId = lookup.subscriptionId;
      result = immediate
        ? await stripe.subscriptions.cancel(subscriptionId)
        : await stripe.subscriptions.update(subscriptionId, { cancel_at_period_end: true });
    }

    // Fire cancellation notifications (email + SMS to customer, alert
    // to platform admin). Need the customer email + period end for the
    // user-facing message. Failures are non-fatal.
    try {
      let notifyEmail = customerEmail ?? null;
      if (!notifyEmail) {
        try {
          const refreshed = await stripe.subscriptions.retrieve(result.id, {
            expand: ["customer"],
          });
          const cust = refreshed.customer as Stripe.Customer | null;
          notifyEmail = cust?.email ?? null;
        } catch { /* ignore */ }
      }
      if (notifyEmail) {
        const periodEndSec =
          (result as any).items?.data?.[0]?.current_period_end ??
          (result as any).current_period_end;
        const periodEnd = periodEndSec
          ? new Date(periodEndSec * 1000).toISOString()
          : null;
        await supabaseClient.functions.invoke("notify-tidywise-cancellation", {
          body: {
            user_email: notifyEmail,
            period_end_date: periodEnd,
            plan: (result as any).items?.data?.[0]?.price?.id || null,
            triggered_by: "admin",
          },
        });
      } else {
        log("WARN: no customer email available, skipping notification");
      }
    } catch (notifyErr) {
      log("WARN: notification dispatch failed", String(notifyErr));
    }

    return new Response(
      JSON.stringify({
        success: true,
        subscriptionId: result.id,
        status: result.status,
        cancel_at_period_end: (result as any).cancel_at_period_end ?? false,
      }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    log("ERROR", { msg });
    return new Response(JSON.stringify({ error: msg }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
