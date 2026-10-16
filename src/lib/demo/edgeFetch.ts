/**
 * fetch() to /functions/v1 bypasses the Supabase client's functions getter.
 * Streaming chat uses that URL. The same allowlist applies.
 */
import { toast } from 'sonner';
import { demoInvokeKind } from '@/lib/demo/blocklist';
import { isSampleDemoOn } from '@/lib/demo/session';

function functionName(input: RequestInfo | URL): string | null {
  const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
  const match = url.match(/\/functions\/v1\/([^/?]+)/);
  return match ? decodeURIComponent(match[1]) : null;
}

export async function demoAwareFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const name = functionName(input);
  if (name && isSampleDemoOn()) {
    const kind = demoInvokeKind(name);
    if (kind === 'block' || kind === 'silent') {
      if (kind === 'block') toast('Disabled in demo mode', { id: 'demo-blocked' });
      return new Response(JSON.stringify({ error: 'Disabled in demo mode' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }
  }
  return fetch(input, init);
}
