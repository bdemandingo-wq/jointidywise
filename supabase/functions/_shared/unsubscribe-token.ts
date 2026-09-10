/**
 * Mint-or-fetch the unsubscribe token for an email address.
 *
 * Tokens come in two flavours, distinguished by organization_id:
 *
 *  - organization_id IS NULL  — the platform/global token. Used by broadcasts
 *    and the Morning/Evening Briefs. Clicking it writes the global
 *    suppressed_emails row and opts nobody out of a specific org.
 *  - organization_id IS NOT NULL — an org-scoped token, minted by
 *    _shared/send-org-email.ts for marketing sends. Clicking it opts the
 *    recipient out of THAT org's marketing only.
 *
 * The table carries two partial unique indexes matching that split
 * (uniq_unsub_token_email_global / uniq_unsub_token_email_org), so the same
 * address can hold one platform token plus one token per org without collision.
 *
 * Follow-up: fold _shared/emailEligibility.ts's inline mint onto this helper.
 */
export async function ensureUnsubscribeToken(
  supabase: { from: (t: string) => any },
  email: string,
  organizationId?: string | null,
): Promise<string | null> {
  const normalized = email.trim().toLowerCase();
  const orgId = organizationId ?? null;

  const scoped = (q: any) =>
    orgId ? q.eq('organization_id', orgId) : q.is('organization_id', null);

  const { data: existing } = await scoped(
    supabase.from('email_unsubscribe_tokens').select('token').eq('email', normalized),
  ).maybeSingle();
  if (existing?.token) return existing.token;

  const token = crypto.randomUUID().replace(/-/g, '');
  const { error } = await supabase
    .from('email_unsubscribe_tokens')
    .insert({ email: normalized, token, organization_id: orgId });

  if (error) {
    // 23505 means a concurrent mint won the race — re-read rather than fail,
    // because a missing token would silently downgrade a marketing send into
    // one with no way out.
    if (error.code === '23505') {
      const { data: raced } = await scoped(
        supabase.from('email_unsubscribe_tokens').select('token').eq('email', normalized),
      ).maybeSingle();
      return raced?.token ?? null;
    }
    console.error('[unsubscribe-token] mint failed', { error });
    return null;
  }
  return token;
}
