import { corsHeaders } from 'npm:@supabase/supabase-js@2/cors';
import { createClient } from 'npm:@supabase/supabase-js@2';
import { resolveCallerOrg } from '../_shared/require-caller-org.ts';
import { assertSafeWebhookUrl, UnsafeWebhookUrlError } from '../_shared/safe-webhook-url.ts';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

interface DispatchBody {
  organization_id: string;
  event_type?: string;
  payload?: Record<string, unknown>;
  mode?: 'dispatch' | 'test' | 'validate' | 'retry';
  retry_log_id?: string;
  // When provided in test mode, overrides the saved event mapping for a one-off preview.
  override_mapping?: EventMapping;
}

interface EventMapping {
  enabled: boolean;
  mappings: Array<{ ghl_field: string; source: string; static_value?: string | null }>;
  tags?: string[];
}

const MAX_ATTEMPTS = 4;
const BACKOFF_MS = [500, 1500, 4000];
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function getByPath(obj: unknown, path: string): unknown {
  if (!path) return undefined;
  return path.split('.').reduce<any>((acc, key) => {
    if (acc == null) return undefined;
    return acc[key];
  }, obj);
}

function buildGhlBody(
  eventType: string,
  organizationId: string,
  payload: Record<string, unknown>,
  mapping: EventMapping | null,
): Record<string, unknown> {
  const meta = {
    event_type: eventType,
    organization_id: organizationId,
    occurred_at: new Date().toISOString(),
    source: 'tidywise_crm',
  };
  if (!mapping || !Array.isArray(mapping.mappings) || mapping.mappings.length === 0) {
    // No explicit mapping configured: send the raw payload plus meta.
    return { ...meta, ...payload };
  }
  const out: Record<string, unknown> = { ...meta };
  for (const m of mapping.mappings) {
    if (!m.ghl_field) continue;
    const value =
      m.static_value !== undefined && m.static_value !== null && m.static_value !== ''
        ? m.static_value
        : getByPath(payload, m.source);
    if (value !== undefined) out[m.ghl_field] = value;
  }
  if (Array.isArray(mapping.tags) && mapping.tags.length > 0) {
    out.tags = mapping.tags;
  }
  return out;
}

function classifyError(status: number | null, error: string | null): { code: string; hint: string } {
  if (status === 401 || status === 403) {
    return {
      code: 'AUTH_REJECTED',
      hint:
        'GoHighLevel rejected the auth token. In GHL, open Settings → Private Integrations, regenerate the token, and paste it back into the GHL settings card.',
    };
  }
  if (status === 404) {
    return {
      code: 'WEBHOOK_NOT_FOUND',
      hint:
        'GHL returned 404 — the Inbound Webhook URL is wrong or the workflow was deleted. Open the workflow in GHL and copy the current Inbound Webhook URL again.',
    };
  }
  if (status === 429) {
    return {
      code: 'RATE_LIMITED',
      hint: 'GHL is rate-limiting your account. Retries will resume automatically with backoff.',
    };
  }
  if (status && status >= 500) {
    return {
      code: 'GHL_SERVER_ERROR',
      hint: `GHL responded ${status}. Their service is having issues — retries already happened, try again in a minute.`,
    };
  }
  if (status && status >= 400) {
    return {
      code: 'BAD_REQUEST',
      hint:
        'GHL rejected the payload (4xx). Check your event mapping — the Inbound Webhook trigger expects fields like email, phone, firstName.',
    };
  }
  if (error && /private|metadata|https|not allowed|redirected|credentials/i.test(error)) {
    return {
      code: 'UNSAFE_URL',
      hint: 'That webhook URL is not allowed. Use the https Inbound Webhook URL from your GoHighLevel workflow. Private networks, metadata addresses, and redirects are blocked.',
    };
  }
  if (error && /fetch|network|timed?out|ENOTFOUND/i.test(error)) {
    return {
      code: 'NETWORK_ERROR',
      hint: 'Could not reach the GHL webhook URL. Verify the URL is reachable from the public internet.',
    };
  }
  return { code: 'UNKNOWN', hint: error ?? 'Unknown delivery error.' };
}

async function deliver(
  url: string,
  body: string,
  authHeaderName: string | null,
  authToken: string | null,
) {
  let target: string;
  try {
    target = (await assertSafeWebhookUrl(url)).toString();
  } catch (err) {
    const message = err instanceof UnsafeWebhookUrlError ? err.message : 'Webhook URL is not allowed';
    return {
      success: false,
      status: null as number | null,
      attempts: 0,
      latency_ms: 0,
      response_snippet: null as string | null,
      error: message,
    };
  }
  let lastStatus: number | null = null;
  let lastError: string | null = null;
  let lastSnippet: string | null = null;
  const started = Date.now();
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      const headers: Record<string, string> = { 'Content-Type': 'application/json' };
      if (authHeaderName && authToken) {
        headers[authHeaderName] =
          authHeaderName.toLowerCase() === 'authorization' && !/^bearer\s/i.test(authToken)
            ? `Bearer ${authToken}`
            : authToken;
      }
      // redirect: 'manual' so a public URL cannot 302 to instance metadata.
      const resp = await fetch(target, { method: 'POST', headers, body, redirect: 'manual' });
      if (resp.status >= 300 && resp.status < 400) {
        return {
          success: false,
          status: resp.status,
          attempts: attempt,
          latency_ms: Date.now() - started,
          response_snippet: null as string | null,
          error: 'Webhook URL redirected; redirects are not followed',
        };
      }
      lastStatus = resp.status;
      lastSnippet = (await resp.text().catch(() => '')).slice(0, 500);
      if (resp.ok) {
        return {
          success: true,
          status: resp.status,
          attempts: attempt,
          latency_ms: Date.now() - started,
          response_snippet: lastSnippet,
          error: null as string | null,
        };
      }
      if (resp.status < 500 && resp.status !== 429) {
        return {
          success: false,
          status: resp.status,
          attempts: attempt,
          latency_ms: Date.now() - started,
          response_snippet: lastSnippet,
          error: lastSnippet,
        };
      }
      lastError = lastSnippet;
    } catch (e) {
      lastError = e instanceof Error ? e.message : String(e);
    }
    if (attempt < MAX_ATTEMPTS) {
      const base = BACKOFF_MS[attempt - 1] ?? 4000;
      await sleep(base + Math.floor(Math.random() * 250));
    }
  }
  return {
    success: false,
    status: lastStatus,
    attempts: MAX_ATTEMPTS,
    latency_ms: Date.now() - started,
    response_snippet: lastSnippet,
    error: lastError,
  };
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  try {
    const body = (await req.json()) as DispatchBody;
    const {
      event_type,
      payload,
      mode = 'dispatch',
      retry_log_id,
      override_mapping,
    } = body || ({} as DispatchBody);

    // SECURITY: never trust organization_id from the request body — resolve
    // it from the caller's own JWT + org_memberships instead.
    const callerOrg = await resolveCallerOrg(req, body?.organization_id ?? null);
    if (!callerOrg.ok) {
      return new Response(JSON.stringify({ error: callerOrg.error }), {
        status: callerOrg.status,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }
    const organization_id = callerOrg.ctx.organizationId;

    const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

    // Load config via SECURITY DEFINER RPC so we can read the auth_token column.
    const { data: cfgRows, error: cfgErr } = await supabase.rpc('get_org_ghl_dispatch_config', {
      _org_id: organization_id,
    });
    const cfg: any = Array.isArray(cfgRows) ? cfgRows[0] : cfgRows;

    if (cfgErr) {
      return new Response(JSON.stringify({ error: 'config_lookup_failed', detail: cfgErr.message }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // -------- validate mode: just ping the webhook --------
    if (mode === 'validate') {
      if (!cfg?.webhook_url) {
        return new Response(
          JSON.stringify({
            success: false,
            error: 'No GHL webhook URL configured for this organization.',
            error_code: 'NOT_CONFIGURED',
          }),
          { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
        );
      }
      const pingBody = JSON.stringify({
        event_type: 'webhook.validate',
        organization_id,
        occurred_at: new Date().toISOString(),
        source: 'tidywise_crm',
        ping: true,
      });
      const r = await deliver(cfg.webhook_url, pingBody, cfg.auth_header_name, cfg.auth_token);
      const cls = r.success ? { code: 'OK', hint: '' } : classifyError(r.status, r.error);
      return new Response(
        JSON.stringify({
          success: r.success,
          status: r.status,
          attempts: r.attempts,
          latency_ms: r.latency_ms,
          response_snippet: r.response_snippet,
          error_code: cls.code,
          error_hint: cls.hint,
        }),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      );
    }

    // -------- retry mode: re-send a stored failed log row --------
    if (mode === 'retry') {
      if (!retry_log_id) {
        return new Response(JSON.stringify({ error: 'retry_log_id is required' }), {
          status: 400,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
      const { data: logRow } = await supabase
        .from('ghl_dispatch_log')
        .select('id, organization_id, event_type, payload, webhook_url')
        .eq('id', retry_log_id)
        .eq('organization_id', organization_id)
        .maybeSingle();
      if (!logRow) {
        return new Response(JSON.stringify({ error: 'log row not found' }), {
          status: 404,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
      const url = (logRow as any).webhook_url || cfg?.webhook_url;
      if (!url) {
        return new Response(JSON.stringify({ error: 'no webhook url available for retry' }), {
          status: 410,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
      const body = JSON.stringify((logRow as any).payload ?? {});
      const r = await deliver(url, body, cfg?.auth_header_name, cfg?.auth_token);
      const cls = r.success ? { code: 'OK', hint: '' } : classifyError(r.status, r.error);
      await supabase.from('ghl_dispatch_log').insert({
        organization_id,
        event_type: (logRow as any).event_type,
        status: r.success ? 'success' : 'failed',
        http_status: r.status,
        attempt: r.attempts,
        latency_ms: r.latency_ms,
        webhook_url: url,
        payload: (logRow as any).payload,
        response_snippet: r.response_snippet,
        error_code: r.success ? null : cls.code,
        error_hint: r.success ? null : cls.hint,
      });
      return new Response(
        JSON.stringify({
          retried: true,
          success: r.success,
          status: r.status,
          attempts: r.attempts,
          latency_ms: r.latency_ms,
          error_code: cls.code,
          error_hint: cls.hint,
        }),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      );
    }

    // -------- dispatch / test: require event_type --------
    if (!event_type) {
      return new Response(JSON.stringify({ error: 'event_type is required' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    if (!cfg?.webhook_url) {
      return new Response(
        JSON.stringify({
          dispatched: 0,
          skipped_reason: 'NOT_CONFIGURED',
          message: 'GHL integration is not configured for this organization.',
        }),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      );
    }

    const isTest = mode === 'test';
    if (!isTest && !cfg.enabled) {
      return new Response(
        JSON.stringify({ dispatched: 0, skipped_reason: 'DISABLED' }),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      );
    }

    const eventConfig: Record<string, EventMapping> = (cfg.event_config ?? {}) as any;
    const mapping = override_mapping ?? eventConfig[event_type] ?? null;

    if (!isTest && (!mapping || mapping.enabled === false)) {
      return new Response(
        JSON.stringify({ dispatched: 0, skipped_reason: 'EVENT_DISABLED' }),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      );
    }

    const ghlBody = buildGhlBody(event_type, organization_id, payload ?? {}, mapping);
    const r = await deliver(cfg.webhook_url, JSON.stringify(ghlBody), cfg.auth_header_name, cfg.auth_token);
    const cls = r.success ? { code: 'OK', hint: '' } : classifyError(r.status, r.error);

    await supabase.from('ghl_dispatch_log').insert({
      organization_id,
      event_type,
      status: r.success ? 'success' : 'failed',
      http_status: r.status,
      attempt: r.attempts,
      latency_ms: r.latency_ms,
      webhook_url: cfg.webhook_url,
      payload: ghlBody,
      response_snippet: r.response_snippet,
      error_code: r.success ? null : cls.code,
      error_hint: r.success ? null : cls.hint,
    });

    return new Response(
      JSON.stringify({
        dispatched: 1,
        success: r.success,
        status: r.status,
        attempts: r.attempts,
        latency_ms: r.latency_ms,
        sent_body: ghlBody,
        response_snippet: r.response_snippet,
        error_code: r.success ? null : cls.code,
        error_hint: r.success ? null : cls.hint,
      }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    );
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error('ghl-dispatch error', msg);
    return new Response(JSON.stringify({ error: msg }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
