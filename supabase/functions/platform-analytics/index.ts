import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import Stripe from "https://esm.sh/stripe@18.5.0";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.2";
import { billingSecretKey } from "../_shared/billing-stripe.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// Caller allowlist keyed on login email. Not the public support inbox.
const FREE_ACCOUNTS = new Set([
  "support@tidywisecleaning.com",
  "applereview@tidywise.com",
]);

function normalizeEmail(email: string | null | undefined): string | null {
  return email ? email.trim().toLowerCase() : null;
}

function resolveSubscriptionStatus(email: string | null | undefined, status: string): string {
  const normalizedEmail = normalizeEmail(email);
  if (normalizedEmail && FREE_ACCOUNTS.has(normalizedEmail)) {
    return "active";
  }

  return status;
}

// Safe date formatter
function safeFormatDate(timestamp: number | undefined | null): string {
  if (!timestamp || isNaN(timestamp)) return 'Unknown';
  try {
    return new Date(timestamp * 1000).toISOString();
  } catch {
    return 'Unknown';
  }
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const supabaseClient = createClient(
    Deno.env.get("SUPABASE_URL") ?? "",
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
    { auth: { persistSession: false } }
  );

  try {
    console.log("[PLATFORM-ANALYTICS] Starting...");
    
    // Verify the user is the platform admin
    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const token = authHeader.replace("Bearer ", "");
    // getUser() checks the token with GoTrue, so a revoked or deleted
    // account cannot keep using a still-unexpired JWT the way getClaims()
    // allowed. Authorization is the DB helper is_platform_admin() (the
    // same allowlist the rest of the app uses) plus any extra addresses
    // in PLATFORM_ADMIN_EMAILS, not a single email baked into this file.
    const { data: userData, error: userError } = await supabaseClient.auth.getUser(token);
    if (userError || !userData?.user) {
      return new Response(JSON.stringify({ error: "Authentication error: Invalid token" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const userEmail = userData.user.email;
    console.log("[PLATFORM-ANALYTICS] User email:", userEmail);

    const anonKey = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
    const userClient = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      anonKey,
      { global: { headers: { Authorization: `Bearer ${token}` } }, auth: { persistSession: false } },
    );
    const { data: platformAdmin, error: adminErr } = await userClient.rpc("is_platform_admin");
    const extraAdmins = (Deno.env.get("PLATFORM_ADMIN_EMAILS") ?? "")
      .split(",")
      .map((e) => e.trim().toLowerCase())
      .filter(Boolean);
    const emailAllowed = !!userEmail && extraAdmins.includes(userEmail.trim().toLowerCase());
    if (!emailAllowed && (adminErr || !platformAdmin)) {
      if (adminErr) console.error("[PLATFORM-ANALYTICS] is_platform_admin failed:", adminErr.message);
      return new Response(JSON.stringify({ error: "Unauthorized: Platform admin access only" }), {
        status: 403,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Get total signups (profiles count)
    const { count: totalSignups } = await supabaseClient
      .from('profiles')
      .select('*', { count: 'exact', head: true });
    console.log("[PLATFORM-ANALYTICS] Total signups:", totalSignups);

    // Get recent signups (last 30 days)
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
    
    const { data: recentSignups } = await supabaseClient
      .from('profiles')
      .select('id, email, created_at')
      .gte('created_at', thirtyDaysAgo.toISOString())
      .order('created_at', { ascending: false });

    // Enrich signups with organization names via org_memberships AND staff table
    const enrichedSignups = [];
    if (recentSignups && recentSignups.length > 0) {
      const userIds = recentSignups.map(s => s.id);
      
      // Check org_memberships (owners/admins)
      const { data: memberships } = await supabaseClient
        .from('org_memberships')
        .select('user_id, role, organization:organizations(id, name, onboarding_answers)')
        .in('user_id', userIds);

      // Check staff table (staff/cleaners who signed up)
      const { data: staffRecords } = await supabaseClient
        .from('staff')
        .select('user_id, name, organization_id, organization:organizations(id, name, onboarding_answers)')
        .in('user_id', userIds);

      // onboarding_answers is typed `unknown` on purpose. The column is jsonb and
      // holds {teamSize:[],bookingMethod:[],biggestPain:[],revenueGoal:[],howHeard:[]}
      // for organizations created since 2026-08-13, but it is NULL for every older
      // one and was never backfilled. Declaring a concrete shape here would be a
      // claim this function cannot honour; the client normalises it.
      const orgMap = new Map<string, { org_name: string; org_id: string; role: string; onboarding_answers: unknown }>();
      
      // Map from org_memberships first (owners/admins)
      if (memberships) {
        for (const m of memberships) {
          const org = m.organization as any;
          if (org && !orgMap.has(m.user_id)) {
            orgMap.set(m.user_id, {
              org_name: org.name,
              org_id: org.id,
              role: m.role,
              onboarding_answers: org.onboarding_answers ?? null,
            });
          }
        }
      }
      
      // Fill gaps from staff table (cleaners/staff who aren't in org_memberships)
      if (staffRecords) {
        for (const s of staffRecords) {
          if (s.user_id && !orgMap.has(s.user_id)) {
            const org = s.organization as any;
            if (org) {
              orgMap.set(s.user_id, {
                org_name: org.name,
                org_id: org.id,
                role: 'staff',
                onboarding_answers: org.onboarding_answers ?? null,
              });
            }
          }
        }
      }

      for (const signup of recentSignups) {
        const orgInfo = orgMap.get(signup.id);
        enrichedSignups.push({
          ...signup,
          org_name: orgInfo?.org_name || null,
          org_id: orgInfo?.org_id || null,
          role: orgInfo?.role || null,
          onboarding_answers: orgInfo?.onboarding_answers ?? null,
        });
      }
    }

    // Get organizations count
    const { count: totalOrganizations } = await supabaseClient
      .from('organizations')
      .select('*', { count: 'exact', head: true });
    console.log("[PLATFORM-ANALYTICS] Total organizations:", totalOrganizations);

    // Get recent organizations
    const { data: recentOrganizations } = await supabaseClient
      .from('organizations')
      .select('id, name, created_at')
      .gte('created_at', thirtyDaysAgo.toISOString())
      .order('created_at', { ascending: false });

    // Get subscription data - ONLY TidyWise CRM subscribers (filter by product ID).
    // The product set is DERIVED at runtime from the configured price-id secrets,
    // so adding a new plan price secret automatically includes its product here.
    let activeSubscriptions = 0;
    let trialSubscriptions = 0;
    let canceledSubscriptions = 0;
    let subscriptionList: any[] = [];
    let subscribersList: any[] = [];
    let totalSubscribers = 0;
    let recentSubscribers = 0;

    const stripeKey = billingSecretKey();
    if (stripeKey) {
      console.log("[PLATFORM-ANALYTICS] Fetching Stripe subscription data...");
      const stripe = new Stripe(stripeKey, { apiVersion: "2025-08-27.basil" });
      const thirtyDaysAgoTimestamp = Math.floor(thirtyDaysAgo.getTime() / 1000);

      // Reuse the single client constructed above (same API version).
      const stripeForProducts = stripe;

      // Derived, not hardcoded. create-subscription sells exactly these six
      // prices; resolving each to its product means a new plan appears on this
      // dashboard as soon as its secret is set, instead of silently dropping
      // every customer on it until someone remembers to edit this file.
      const PRICE_ID_SECRETS = [
        "STRIPE_BASIC_MONTHLY_PRICE_ID",
        "STRIPE_BASIC_YEARLY_PRICE_ID",
        "STRIPE_PRO_MONTHLY_PRICE_ID",
        "STRIPE_PRO_YEARLY_PRICE_ID",
        "STRIPE_CUSTOM_MONTHLY_PRICE_ID",
        "STRIPE_CUSTOM_YEARLY_PRICE_ID",
        // Lifetime is sold outside create-subscription, which is why it was
        // missed when this list was derived from that function's six prices.
        // Its product resolved under the old hardcoded set, so omitting it here
        // dropped every lifetime business off the dashboard — the exact silent
        // drop this change was meant to end.
        "STRIPE_LIFETIME_PRICE_ID",
      ];

      // Extra products that cannot be derived from the price secrets.
      // They lived on the old Stripe account, so they are omitted unless
      // STRIPE_BILLING_LEGACY_PRODUCT_IDS lists prod_ ids for the account
      // this function is actually reading (comma-separated).
      const LEGACY_PRODUCT_IDS = new Set(
        (Deno.env.get("STRIPE_BILLING_LEGACY_PRODUCT_IDS") || "")
          .split(",")
          .map((id) => id.trim())
          .filter((id) => id.startsWith("prod_")),
      );

      const derivedProductIds = new Set<string>();
      const priceResolution: Array<{ secret: string; price: string | null; product: string | null; error?: string }> = [];

      for (const secretName of PRICE_ID_SECRETS) {
        const priceId = Deno.env.get(secretName);
        if (!priceId) {
          priceResolution.push({ secret: secretName, price: null, product: null, error: "secret not set" });
          continue;
        }
        try {
          const price = await stripeForProducts.prices.retrieve(priceId);
          const productId = typeof price.product === "string" ? price.product : price.product?.id ?? null;
          if (productId) derivedProductIds.add(productId);
          priceResolution.push({ secret: secretName, price: priceId, product: productId });
        } catch (e) {
          // Do NOT swallow this. A price that fails to resolve is a product
          // missing from the filter, which is a group of paying customers
          // missing from the dashboard.
          priceResolution.push({
            secret: secretName,
            price: priceId,
            product: null,
            error: e instanceof Error ? e.message : String(e),
          });
        }
      }

      console.log("[PLATFORM-ANALYTICS] price -> product resolution:", JSON.stringify(priceResolution));
      console.log("[PLATFORM-ANALYTICS] derived product ids:", [...derivedProductIds]);
      console.log("[PLATFORM-ANALYTICS] legacy product ids:", [...LEGACY_PRODUCT_IDS]);

      // Hard stop, and it checks the DERIVED set specifically — not the union
      // below. Legacy ids are optional. A total failure of the price secrets
      // must not report an empty or legacy-only set as the whole business.
      if (derivedProductIds.size === 0) {
        throw new Error(
          "platform-analytics: no CRM product ids could be derived from the six " +
          "STRIPE_*_PRICE_ID secrets. Refusing to report subscription counts " +
          "built only from the legacy fallback. Resolution detail: " +
          JSON.stringify(priceResolution),
        );
      }

      const TIDYWISE_CRM_PRODUCT_IDS = new Set<string>([
        ...derivedProductIds,
        ...LEGACY_PRODUCT_IDS,
      ]);
      console.log("[PLATFORM-ANALYTICS] counted product ids (derived + legacy):", [...TIDYWISE_CRM_PRODUCT_IDS]);

      try {
        const crmSubscriptions: Stripe.Subscription[] = [];
        let totalSubscriptionsSeen = 0;
        let controlMatches = 0;
        const unmatchedProductCounts: Record<string, number> = {};

        // A product id that cannot exist. If this ever matches anything, the
        // comparison itself is broken and every other count here is meaningless.
        const CONTROL_PRODUCT_ID = "prod_thisDoesNotExist000";

        // Bounded, and the bound is logged. The bug being fixed is a silent
        // truncation at 100; replacing it with a silent truncation at 5000 would
        // be the same bug wearing a bigger number.
        const MAX_SUBSCRIPTIONS_SCANNED = 5000;
        let truncated = false;

        // `expand: ['data.customer']` inlines the full customer object on every
        // subscription in the SAME list request. This replaces one sequential
        // stripe.customers.retrieve() per subscription (38 round trips at
        // 100-500ms each) with zero extra calls. Stripe allows expanding
        // `data.<field>` on list endpoints; customer objects returned this way
        // are identical to a retrieve, except a deleted customer comes back as
        // { id, deleted: true }, which the consumer below already handles.
        const customerById = new Map<string, Stripe.Customer>();

        await stripe.subscriptions
          .list({ limit: 100, status: "all", expand: ["data.customer"] })
          .autoPagingEach((sub: Stripe.Subscription) => {

            if (totalSubscriptionsSeen >= MAX_SUBSCRIPTIONS_SCANNED) {
              truncated = true;
              return false; // returning false stops autoPagingEach
            }
            totalSubscriptionsSeen++;

            const productId = sub.items.data[0]?.price?.product as string | undefined;
            if (!productId) return;

            if (productId === CONTROL_PRODUCT_ID) controlMatches++;

            if (TIDYWISE_CRM_PRODUCT_IDS.has(productId)) {
              crmSubscriptions.push(sub);
              // Capture the expanded customer object; the loop below reads it
              // from this map instead of issuing a retrieve per subscription.
              if (sub.customer && typeof sub.customer !== "string" && !("deleted" in sub.customer && sub.customer.deleted)) {
                customerById.set(sub.customer.id, sub.customer as Stripe.Customer);
              }
            } else {
              unmatchedProductCounts[productId] = (unmatchedProductCounts[productId] ?? 0) + 1;
            }
          });


        if (truncated) {
          console.error(
            `[PLATFORM-ANALYTICS] TRUNCATED at ${MAX_SUBSCRIPTIONS_SCANNED} subscriptions — counts below are incomplete`,
          );
        }

        console.log("[PLATFORM-ANALYTICS] subscriptions scanned:", totalSubscriptionsSeen);
        console.log("[PLATFORM-ANALYTICS] matched CRM subscriptions:", crmSubscriptions.length);
        console.log("[PLATFORM-ANALYTICS] CONTROL matches (must be 0):", controlMatches);
        console.log("[PLATFORM-ANALYTICS] products seen but NOT counted:", JSON.stringify(unmatchedProductCounts));



        // Build a set of emails belonging to staff-only users (not org owners/admins).
        // We hide them from the Subscribers tab because they appear via their
        // personal trial sub but are really cleaners, not paying customers.
        const { data: staffRows } = await supabaseClient
          .from('staff')
          .select('email, user_id');
        const staffEmails = new Set<string>();
        const staffUserIds = new Set<string>();
        for (const s of (staffRows || [])) {
          if (s.email) staffEmails.add(String(s.email).toLowerCase());
          if (s.user_id) staffUserIds.add(s.user_id);
        }
        // Owners/admins always count as subscribers even if also listed as staff.
        const { data: ownerMems } = await supabaseClient
          .from('org_memberships')
          .select('user_id')
          .in('role', ['owner', 'admin']);
        const ownerUserIds = new Set((ownerMems || []).map((m: any) => m.user_id));
        const { data: ownerProfiles } = ownerUserIds.size
          ? await supabaseClient.from('profiles').select('email').in('id', Array.from(ownerUserIds))
          : { data: [] as any[] };
        const ownerEmails = new Set((ownerProfiles || []).map((p: any) => String(p.email || '').toLowerCase()).filter(Boolean));

        // Track unique customers with subscriptions
        const subscriberEmails = new Set<string>();


        // Backfill: any customer the expansion did not deliver (should be none).
        // Stripe's customer list endpoint cannot filter by an array of ids, so
        // the only correct recovery is a retrieve — but these run in parallel,
        // not sequentially, and the miss count is logged so a silent regression
        // in expansion behaviour is visible rather than just slow.
        const missingCustomerIds = Array.from(new Set(
          crmSubscriptions
            .map((s) => (typeof s.customer === "string" ? s.customer : s.customer?.id))
            .filter((id): id is string => !!id && !customerById.has(id)),
        ));
        if (missingCustomerIds.length > 0) {
          console.log("[PLATFORM-ANALYTICS] customers not delivered by expansion:", missingCustomerIds.length);
          const fetched = await Promise.all(missingCustomerIds.map(async (id) => {
            try {
              const c = await stripe.customers.retrieve(id);
              return c && !(c as any).deleted ? (c as Stripe.Customer) : null;
            } catch (e) {
              console.log("[PLATFORM-ANALYTICS] Could not fetch customer:", id, e);
              return null;
            }
          }));
          for (const c of fetched) if (c) customerById.set(c.id, c);
        }

        for (const sub of crmSubscriptions) {
          // Customer details come from the expanded subscription list above.
          let customerEmail = 'Unknown';
          let customerName = null;
          let customerId = '';
          let customerCreated = 0;

          if (sub.customer) {
            customerId = typeof sub.customer === 'string' ? sub.customer : sub.customer.id;
            const customer = customerById.get(customerId);
            if (customer?.email) {
              customerEmail = customer.email;
              customerName = customer.name || null;
              customerCreated = customer.created;
            }
          }



          const emailLower = customerEmail.toLowerCase();
          const isStaffOnly = staffEmails.has(emailLower) && !ownerEmails.has(emailLower);
          if (isStaffOnly) {
            // Skip staff members entirely from the Subscribers tab — they
            // appear here only because they self-signed-up with a trial.
            continue;
          }

          const resolvedStatus = resolveSubscriptionStatus(customerEmail, sub.status);

          if (resolvedStatus === 'active') activeSubscriptions++;
          if (resolvedStatus === 'trialing') trialSubscriptions++;
          if (resolvedStatus === 'canceled') canceledSubscriptions++;


          
          subscriptionList.push({
            id: sub.id,
            customer_email: customerEmail,
            status: resolvedStatus,
            created: safeFormatDate(sub.created),
            current_period_end: safeFormatDate(sub.current_period_end),
          });
          
          if (customerEmail !== 'Unknown' && !subscriberEmails.has(customerEmail)) {
            subscriberEmails.add(customerEmail);
            totalSubscribers++;
            
            if (sub.created >= thirtyDaysAgoTimestamp) {
              recentSubscribers++;
            }
            
            subscribersList.push({
              id: customerId,
              email: customerEmail,
              name: customerName,
              created: safeFormatDate(customerCreated),
              subscriptionStatus: resolvedStatus,
              subscriptionCreated: safeFormatDate(sub.created),
              subscriptionId: sub.id,
              source: 'tidywise_subscriber',
            });
          }
        }

        console.log("[PLATFORM-ANALYTICS] Total TidyWise subscribers:", totalSubscribers);
        
        // Sort by subscription created date (most recent first)
        subscribersList.sort((a, b) => {
          const dateA = a.subscriptionCreated !== 'Unknown' ? new Date(a.subscriptionCreated).getTime() : 0;
          const dateB = b.subscriptionCreated !== 'Unknown' ? new Date(b.subscriptionCreated).getTime() : 0;
          return dateB - dateA;
        });
        
      } catch (stripeError) {
        console.error("[PLATFORM-ANALYTICS] Stripe error:", stripeError);
      }
    } else {
      console.log("[PLATFORM-ANALYTICS] No Stripe key found");
    }

    // ---- Comped access section ----
    const nowIso = new Date().toISOString();
    const thirtyDaysAgoIso = thirtyDaysAgo.toISOString();
    const { data: allComps } = await supabaseClient
      .from('comped_access')
      .select('id, organization_id, expires_at, granted_by, reason, revoked_at, created_at, access_code_id, organizations:organization_id(id,name), access_codes:access_code_id(code,email_lock)')
      .order('created_at', { ascending: false })
      .limit(500);

    // Owner emails
    const compOrgIds = Array.from(new Set((allComps ?? []).map((c: any) => c.organization_id).filter(Boolean)));
    const ownerEmailByOrg = new Map<string, string>();
    if (compOrgIds.length) {
      const { data: mems } = await supabaseClient
        .from('org_memberships')
        .select('organization_id, user_id, role')
        .in('organization_id', compOrgIds)
        .in('role', ['owner', 'admin']);
      const uids = Array.from(new Set((mems ?? []).map((m: any) => m.user_id)));
      const { data: profs } = uids.length
        ? await supabaseClient.from('profiles').select('id,email').in('id', uids)
        : { data: [] as any[] };
      const emailById = new Map<string, string>();
      for (const p of profs ?? []) emailById.set(p.id, p.email ?? '');
      const sorted = (mems ?? []).sort((a: any, b: any) => (a.role === 'owner' ? -1 : 1));
      for (const m of sorted) {
        if (!ownerEmailByOrg.has(m.organization_id)) {
          const em = emailById.get(m.user_id);
          if (em) ownerEmailByOrg.set(m.organization_id, em);
        }
      }
    }

    const shape = (c: any) => {
      const expiresMs = c.expires_at ? new Date(c.expires_at).getTime() : 0;
      const daysRemaining = Math.max(0, Math.ceil((expiresMs - Date.now()) / 86400000));
      return {
        id: c.id,
        organization_id: c.organization_id,
        organization_name: c.organizations?.name ?? null,
        owner_email: ownerEmailByOrg.get(c.organization_id) ?? null,
        code: c.access_codes?.code ?? null,
        email_lock: c.access_codes?.email_lock ?? null,
        source: c.access_codes?.code ? 'code' : 'direct',
        granted_at: c.created_at,
        expires_at: c.expires_at,
        revoked_at: c.revoked_at,
        days_remaining: daysRemaining,
        reason: c.reason,
      };
    };

    const activeCompsList = (allComps ?? []).filter((c: any) => !c.revoked_at && c.expires_at > nowIso).map(shape);
    const expiredCompsList = (allComps ?? [])
      .filter((c: any) => (c.revoked_at || c.expires_at <= nowIso) && (c.revoked_at ?? c.expires_at) >= thirtyDaysAgoIso)
      .map(shape);
    const compedOrgIds = new Set(activeCompsList.map((c) => c.organization_id));

    console.log("[PLATFORM-ANALYTICS] Returning data...");
    return new Response(JSON.stringify({
      signups: {
        total: totalSignups || 0,
        recent: enrichedSignups || [],
        last30Days: enrichedSignups?.length || 0,
      },
      organizations: {
        total: totalOrganizations || 0,
        recent: recentOrganizations || [],
        last30Days: recentOrganizations?.length || 0,
      },
      subscriptions: {
        active: activeSubscriptions,
        trialing: trialSubscriptions,
        canceled: canceledSubscriptions,
        list: subscriptionList.slice(0, 50),
      },
      subscribers: {
        total: totalSubscribers,
        recent: subscribersList.slice(0, 100),
        last30Days: recentSubscribers,
      },
      compedAccess: {
        activeCount: activeCompsList.length,
        active: activeCompsList,
        recentlyExpired: expiredCompsList,
        compedOrgIds: Array.from(compedOrgIds),
      },
    }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
      status: 200,
    });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error("[PLATFORM-ANALYTICS] Error:", errorMessage);
    return new Response(JSON.stringify({ error: errorMessage }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
      status: error instanceof Error && error.message.includes("Unauthorized") ? 403 : 500,
    });
  }
});
