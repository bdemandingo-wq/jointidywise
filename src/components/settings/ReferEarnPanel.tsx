import { useState } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Copy, Check, Gift, Share2, Mail, MessageSquare } from 'lucide-react';
import { useSaasReferrals } from '@/hooks/useSaasReferrals';
import {
  REFERRAL_OFFER,
  emailShareHref,
  ownerReferralLink,
  referralShareCopy,
  saasReferralStatusLabel,
  smsShareHref,
} from '@/lib/referralProgram';
import { formatInOrgTz } from '@/lib/orgDateRange';
import { useOrgTimezone } from '@/hooks/useOrgTimezone';

/**
 * Settings → Refer & earn.
 *
 * The link, the progress toward the next free month, and the history. Sharing
 * is a copy, the system share sheet, and prefilled SMS and email.
 */
const ReferEarnPanel = () => {
  const { data, isPending, error } = useSaasReferrals();
  const { timezone: timeZone } = useOrgTimezone();
  const [copied, setCopied] = useState(false);

  if (isPending) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Refer & earn</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">Loading…</p>
        </CardContent>
      </Card>
    );
  }

  if (error) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Refer & earn</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-destructive">
            Couldn't load your referrals. Please try again.
          </p>
        </CardContent>
      </Card>
    );
  }

  if (!data) return null;

  const link = ownerReferralLink(data.code);
  const share = link ? referralShareCopy(link) : null;

  const copy = async () => {
    if (!link) return;
    try {
      await navigator.clipboard.writeText(link);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard denied. The field is selectable.
    }
  };

  const shareNative = async () => {
    if (!link || !share) return;
    if (typeof navigator.share === 'function') {
      try {
        await navigator.share({ title: 'TidyWise', text: share.sms, url: link });
        return;
      } catch (err) {
        if (err instanceof DOMException && err.name === 'AbortError') return;
      }
    }
    await copy();
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Gift className="w-5 h-5 text-primary" aria-hidden="true" />
          Refer & earn
        </CardTitle>
        <CardDescription>
          One free month for every two cleaning businesses you refer, once they start paying.
        </CardDescription>
      </CardHeader>

      <CardContent className="space-y-6">
        <ol className="space-y-2 rounded-lg border border-border bg-muted/40 p-4">
          {REFERRAL_OFFER.map((term, i) => (
            <li key={term} className="flex gap-3 text-sm">
              <span
                className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-primary/10 text-xs font-semibold text-primary"
                aria-hidden="true"
              >
                {i + 1}
              </span>
              <span className="text-foreground">{term}</span>
            </li>
          ))}
        </ol>

        {link && share ? (
          <div className="space-y-3">
            <label htmlFor="refer-earn-link" className="text-sm font-medium">
              Your referral link
            </label>
            <div className="flex flex-col gap-2 sm:flex-row">
              <Input id="refer-earn-link" readOnly value={link} className="font-mono text-sm" />
              <div className="flex gap-2">
                <Button onClick={copy} variant="outline" className="shrink-0">
                  {copied ? (
                    <>
                      <Check className="w-4 h-4 mr-1" aria-hidden="true" /> Copied
                    </>
                  ) : (
                    <>
                      <Copy className="w-4 h-4 mr-1" aria-hidden="true" /> Copy
                    </>
                  )}
                </Button>
                <Button onClick={shareNative} variant="outline" className="shrink-0">
                  <Share2 className="w-4 h-4 mr-1" aria-hidden="true" /> Share
                </Button>
              </div>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button variant="secondary" size="sm" asChild>
                <a href={smsShareHref(share.sms)}>
                  <MessageSquare className="w-4 h-4 mr-1" aria-hidden="true" /> Text
                </a>
              </Button>
              <Button variant="secondary" size="sm" asChild>
                <a href={emailShareHref(share.emailSubject, share.emailBody)}>
                  <Mail className="w-4 h-4 mr-1" aria-hidden="true" /> Email
                </a>
              </Button>
            </div>
            <p className="text-xs text-muted-foreground">
              Code <span className="font-mono font-semibold">{data.code}</span>. The link stays attached for 30 days after someone opens it.
            </p>
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">
            Your referral link is being set up. Check back shortly.
          </p>
        )}

        <div className="rounded-lg border border-border p-4">
          <p className="text-2xl font-semibold">{data.progressLabel}</p>
          <p className="text-sm text-muted-foreground mt-1">
            {data.monthsEarned === 0
              ? 'No free months earned yet.'
              : `${data.monthsEarned} free month${data.monthsEarned === 1 ? '' : 's'} earned.`}
            {data.monthsBanked > 0
              ? ` ${data.monthsBanked} saved until you subscribe.`
              : ''}
          </p>
        </div>

        <div className="space-y-2 border-t border-border pt-4">
          <p className="text-sm font-medium">Referral history</p>
          {data.rows.length === 0 ? (
            <p className="text-sm text-muted-foreground">No referrals yet.</p>
          ) : (
            <ul className="space-y-2">
              {data.rows.map((row) => (
                <li key={row.id} className="flex items-center justify-between gap-3 text-sm">
                  <span className="min-w-0">
                    <span className="block truncate">
                      {row.referred_org_name || row.referred_email || 'New signup'}
                    </span>
                    <span className="block text-xs text-muted-foreground">
                      {formatInOrgTz(new Date(row.created_at), timeZone, {
                        year: 'numeric',
                        month: 'short',
                        day: 'numeric',
                      })}
                      {' · '}
                      {saasReferralStatusLabel(row.status, row.block_reason)}
                    </span>
                  </span>
                  <Badge variant={row.status === 'rewarded' || row.status === 'paid' ? 'default' : 'secondary'}>
                    {row.status}
                  </Badge>
                </li>
              ))}
            </ul>
          )}
        </div>
      </CardContent>
    </Card>
  );
};

export default ReferEarnPanel;
