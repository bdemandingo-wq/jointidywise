import { corsHeaders } from 'npm:@supabase/supabase-js@2/cors';
import { createClient } from 'npm:@supabase/supabase-js@2';
import { verifyAdminAuth, createUnauthorizedResponse, createForbiddenResponse } from '../_shared/verify-admin-auth.ts';
import { escapeHtml } from '../_shared/escapeHtml.ts';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const INTERNAL_SECRET = Deno.env.get('ZAPIER_DISPATCH_INTERNAL_SECRET');

interface DispatchBody {
  organization_id: string;
  event_type: string;
  payload?: Record<string, unknown>;
  test_webhook_id?: string;
  // When set, re-dispatches a stored log row's payload to its original webhook
  retry_log_id?: string;
  // When set, performs a lightweight ping to validate a single webhook URL
  validate_webhook_id?: string;
}

const MAX_ATTEMPTS = 4;
const BACKOFF_MS = [500, 1500, 4000];
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function deliverWithRetry(url: string, body: string) {
  let lastStatus: number | null = null;
  let lastError: string | null = null;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      const resp = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body,
      });
      lastStatus = resp.status;
      if (resp.ok) {
        return { success: true, status: resp.status, attempts: attempt, error: null as string | null };
      }
      if (resp.status < 500 && resp.status !== 429) {
        lastError = await resp.text().catch(() => null);
        return { success: false, status: resp.status, attempts: attempt, error: lastError };
      }
      lastError = await resp.text().catch(() => null);
    } catch (e) {
      lastError = e instanceof Error ? e.message : String(e);
    }
    if (attempt < MAX_ATTEMPTS) {
      const base = BACKOFF_MS[attempt - 1] ?? 4000;
      const jitter = Math.floor(Math.random() * 250);
      await sleep(base + jitter);
    }
  }
  return { success: false, status: lastStatus, attempts: MAX_ATTEMPTS, error: lastError };
}

async function checkAndFireAlert(
  supabase: ReturnType<typeof createClient>,
  organization_id: string,
) {
  try {
    const { data: settings } = await supabase
      .from('org_zapier_alert_settings')
      .select('*')
      .eq('organization_id', organization_id)
      .maybeSingle();
    if (!settings || !(settings as any).enabled) return;
    const s: any = settings;
    const windowMs = (s.window_minutes ?? 15) * 60_000;
    const cooldownMs = (s.cooldown_minutes ?? 30) * 60_000;
    if (s.last_alerted_at && Date.now() - new Date(s.last_alerted_at).getTime() < cooldownMs) {
      return;
    }
    const since = new Date(Date.now() - windowMs).toISOString();
    const { count } = await supabase
      .from('zapier_dispatch_log')
      .select('id', { count: 'exact', head: true })
      .eq('organization_id', organization_id)
      .eq('success', false)
      .gte('created_at', since);
    const fails = count ?? 0;
    if (fails < (s.failure_threshold ?? 5)) return;

    const title = 'Zapier delivery failures';
    const message = `${fails} Zapier dispatch failure${fails === 1 ? '' : 's'} in the last ${s.window_minutes} minutes. Check Settings → Integrations → Dispatch log.`;

    if (s.notify_inapp) {
      await supabase.from('admin_system_notifications').insert({
        organization_id,
        type: 'zapier_failure_alert',
        title,
        message,
        link: '/admin/settings?tab=integrations',
        metadata: { fails, window_minutes: s.window_minutes },
        dedupe_key: `zapier_alert_${organization_id}_${Math.floor(Date.now() / cooldownMs)}`,
      });
    }

    if (s.notify_email && s.recipient_email) {
      try {
        await supabase.functions.invoke('send-transactional-email', {
          body: {
            to: s.recipient_email,
            subject: `[Alert] ${title}`,
            html: `<p>${escapeHtml(message)}</p>`,
            purpose: 'transactional',
            template_name: 'zapier_failure_alert',
          },
        });
      } catch (_) { /* email is best-effort */ }
    }

    await supabase
      .from('org_zapier_alert_settings')
      .update({ last_alerted_at: new Date().toISOString() })
      .eq('organization_id', organization_id);
  } catch (e) {
    console.warn('alert check failed', e);
  }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  try {
    const authHeader = req.headers.get('Authorization');
    const internalSecretHeader = req.headers.get('x-internal-secret');

    const body = (await req.json()) as DispatchBody;
    const { organization_id, event_type, payload, test_webhook_id, retry_log_id, validate_webhook_id } =
      body || ({} as DispatchBody);

    if (!organization_id) {
      return new Response(JSON.stringify({ error: 'organization_id is required' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // SECURITY: trusted internal callers (other edge functions dispatching
    // system events) present a shared secret. Everyone else must be an
    // authenticated org admin whose organization matches organization_id.
    const isInternalCall = !!INTERNAL_SECRET && internalSecretHeader === INTERNAL_SECRET;

    if (!isInternalCall) {
      // Verify admin membership IN THE REQUESTED org — an arbitrary first
      // membership breaks users who belong to multiple organizations.
      const authResult = await verifyAdminAuth(authHeader, {
        requireAdmin: true,
        requireOrganizationId: organization_id,
      });
      if (!authResult.success) {
        return createForbiddenResponse(authResult.error || 'Unauthorized', corsHeaders);
      }
    }

    const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

    // --- Validate-only mode: ping the webhook with a minimal payload ---
    if (validate_webhook_id) {
      const { data: hook, error: hErr } = await supabase
        .from('org_zapier_webhooks')
        .select('id, webhook_url, organization_id')
        .eq('id', validate_webhook_id)
        .eq('organization_id', organization_id)
        .maybeSingle();
      if (hErr || !hook) {
        return new Response(JSON.stringify({ error: 'webhook not found' }), {
          status: 404,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
      const pingBody = JSON.stringify({
        event: 'webhook.validate',
        organization_id,
        occurred_at: new Date().toISOString(),
        data: { ping: true },
      });
      const r = await deliverWithRetry((hook as any).webhook_url, pingBody);
      return new Response(
        JSON.stringify({ validated: true, success: r.success, status: r.status, error: r.error }),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      );
    }

    // --- Retry mode: re-send a stored failed log row ---
    if (retry_log_id) {
      const { data: logRow, error: lErr } = await supabase
        .from('zapier_dispatch_log')
        .select('id, organization_id, webhook_id, event_type, payload')
        .eq('id', retry_log_id)
        .eq('organization_id', organization_id)
        .maybeSingle();
      if (lErr || !logRow) {
        return new Response(JSON.stringify({ error: 'log row not found' }), {
          status: 404,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
      const lr: any = logRow;
      if (!lr.webhook_id) {
        return new Response(JSON.stringify({ error: 'original webhook no longer exists' }), {
          status: 410,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
      const { data: hook } = await supabase
        .from('org_zapier_webhooks')
        .select('id, webhook_url')
        .eq('id', lr.webhook_id)
        .eq('organization_id', organization_id)
        .maybeSingle();
      if (!hook) {
        return new Response(JSON.stringify({ error: 'webhook not found' }), {
          status: 404,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
      const envelope = lr.payload ?? {
        event: lr.event_type,
        organization_id,
        occurred_at: new Date().toISOString(),
        data: {},
      };
      const r = await deliverWithRetry((hook as any).webhook_url, JSON.stringify(envelope));
      await supabase.from('zapier_dispatch_log').insert({
        organization_id,
        webhook_id: lr.webhook_id,
        event_type: lr.event_type,
        status_code: r.status,
        success: r.success,
        error_message: r.success ? null : `[retry attempts:${r.attempts}] ${r.error ?? 'delivery failed'}`,
        payload: envelope,
      });
      if (!r.success) await checkAndFireAlert(supabase, organization_id);
      return new Response(
        JSON.stringify({ retried: true, success: r.success, status: r.status, attempts: r.attempts, error: r.error }),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      );
    }

    if (!event_type) {
      return new Response(JSON.stringify({ error: 'event_type is required' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    let query = supabase
      .from('org_zapier_webhooks')
      .select('id, webhook_url, organization_id, event_type, is_active')
      .eq('organization_id', organization_id)
      .eq('is_active', true);

    if (test_webhook_id) query = query.eq('id', test_webhook_id);
    else query = query.eq('event_type', event_type);

    const { data: hooks, error } = await query;
    if (error) {
      console.error('zapier-dispatch lookup error', error);
      return new Response(JSON.stringify({ error: error.message }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Enrich booking.* events with customer + service + property details
    // so Zapier/GHL automations have phone, name parts, and property info.
    let enrichedData: Record<string, unknown> = payload ?? {};
    if (event_type.startsWith('booking.') && (payload as any)?.id) {
      try {
        const { data: full } = await supabase
          .from('bookings')
          .select(`
            id, booking_number, status, payment_status, scheduled_at, duration,
            address, city, state, zip_code, bedrooms, bathrooms, square_footage,
            frequency, notes, total_amount, subtotal, organization_id,
            customer:customers(id, first_name, last_name, email, phone),
            service:services(id, name, description)
          `)
          .eq('id', (payload as any).id)
          .eq('organization_id', organization_id)
          .maybeSingle();
        if (full) {
          const f: any = full;
          const c = f.customer || {};
          const s = f.service || {};
          const fullName = [c.first_name, c.last_name].filter(Boolean).join(' ') || null;
          enrichedData = {
            id: f.id,
            booking_number: f.booking_number,
            status: f.status,
            payment_status: f.payment_status,
            scheduled_at: f.scheduled_at,
            duration_minutes: f.duration,
            frequency: f.frequency,
            notes: f.notes,
            total_amount: f.total_amount,
            subtotal: f.subtotal,
            // Nested objects (clean structure for Zapier)
            customer: {
              id: c.id ?? null,
              first_name: c.first_name ?? null,
              last_name: c.last_name ?? null,
              full_name: fullName,
              email: c.email ?? null,
              phone: c.phone ?? null,
            },
            service: {
              id: s.id ?? null,
              name: s.name ?? null,
              description: s.description ?? null,
            },
            property: {
              address: f.address ?? null,
              city: f.city ?? null,
              state: f.state ?? null,
              zip_code: f.zip_code ?? null,
              bedrooms: f.bedrooms ?? null,
              bathrooms: f.bathrooms ?? null,
              square_footage: f.square_footage ?? null,
            },
            // Flat keys (easier mapping in GHL / LeadConnector)
            customer_id: c.id ?? null,
            customer_first_name: c.first_name ?? null,
            customer_last_name: c.last_name ?? null,
            customer_full_name: fullName,
            customer_name: fullName,
            customer_email: c.email ?? null,
            customer_phone: c.phone ?? null,
            service_id: s.id ?? null,
            service_name: s.name ?? null,
            service_description: s.description ?? null,
            property_address: f.address ?? null,
            property_city: f.city ?? null,
            property_state: f.state ?? null,
            property_zip_code: f.zip_code ?? null,
            property_bedrooms: f.bedrooms ?? null,
            property_bathrooms: f.bathrooms ?? null,
            property_square_footage: f.square_footage ?? null,
          };
        }
      } catch (enrichErr) {
        console.warn('booking payload enrich failed', enrichErr);
      }
    }

    const envelope = {
      event: event_type,
      organization_id,
      occurred_at: new Date().toISOString(),
      data: enrichedData,
    };
    const envelopeBody = JSON.stringify(envelope);


    const results = await Promise.all(
      (hooks ?? []).map(async (hook: any) => {
        const r = await deliverWithRetry(hook.webhook_url, envelopeBody);
        await supabase.from('zapier_dispatch_log').insert({
          organization_id,
          webhook_id: hook.id,
          event_type,
          status_code: r.status,
          success: r.success,
          error_message: r.success
            ? null
            : `[attempts:${r.attempts}] ${r.error ?? 'delivery failed'}`,
          payload: envelope,
        });
        return {
          webhook_id: hook.id,
          status: r.status,
          success: r.success,
          attempts: r.attempts,
          error: r.error,
        };
      }),
    );

    if (results.some((r) => !r.success)) {
      await checkAndFireAlert(supabase, organization_id);
    }

    return new Response(
      JSON.stringify({ dispatched: results.length, envelope, results }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    );
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error('zapier-dispatch error', msg);
    return new Response(JSON.stringify({ error: msg }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
