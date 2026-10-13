import { useQuery } from '@tanstack/react-query';
import { AdminLayout } from '@/components/admin/AdminLayout';
import { SEOHead } from '@/components/SEOHead';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { supabase } from '@/lib/supabase';
import { saasReferralStatusLabel } from '@/lib/referralProgram';
import { formatInOrgTz } from '@/lib/orgDateRange';

type AdminReferral = {
  id: string;
  code: string;
  status: string;
  block_reason: string | null;
  referred_email: string | null;
  referred_org_name: string | null;
  referrer_org_id: string;
  referred_org_id: string;
  paid_at: string | null;
  created_at: string;
  reversal_reason: string | null;
};

/**
 * Every org-to-org referral. Platform admins only — RLS enforces the same
 * boundary as this route.
 */
export default function PlatformReferralsPage() {
  const { data, isPending, error, refetch } = useQuery({
    queryKey: ['platform-saas-referrals'],
    queryFn: async (): Promise<AdminReferral[]> => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const db = supabase as any;
      const { data: rows, error: queryError } = await db
        .from('referral_signups')
        .select('id, code, status, block_reason, referred_email, referred_org_name, referrer_org_id, referred_org_id, paid_at, created_at, reversal_reason')
        .order('created_at', { ascending: false })
        .order('id', { ascending: false });
      if (queryError) throw queryError;
      return (rows ?? []) as AdminReferral[];
    },
  });

  return (
    <AdminLayout title="Referrals">
      <SEOHead title="Referrals | TidyWise" description="Org referral ledger" noIndex />
      <div className="space-y-4 p-4 md:p-6">
        <div>
          <h1 className="text-2xl font-semibold">Referrals</h1>
          <p className="text-sm text-muted-foreground">
            Every business referred to TidyWise, and whether it has started paying.
          </p>
        </div>

        <Card>
          <CardHeader>
            <CardTitle>All referrals</CardTitle>
          </CardHeader>
          <CardContent>
            {isPending ? (
              <p className="text-sm text-muted-foreground">Loading…</p>
            ) : error ? (
              <div className="space-y-2">
                <p className="text-sm text-destructive">Couldn't load referrals.</p>
                <button type="button" className="text-sm underline" onClick={() => void refetch()}>
                  Try again
                </button>
              </div>
            ) : !data || data.length === 0 ? (
              <p className="text-sm text-muted-foreground">No referrals yet.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b text-left text-muted-foreground">
                      <th className="py-2 pr-3 font-medium">When</th>
                      <th className="py-2 pr-3 font-medium">Referred</th>
                      <th className="py-2 pr-3 font-medium">Code</th>
                      <th className="py-2 pr-3 font-medium">Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.map((row) => (
                      <tr key={row.id} className="border-b border-border/60">
                        <td className="py-2 pr-3 whitespace-nowrap">
                          {formatInOrgTz(new Date(row.created_at), 'UTC', {
                            year: 'numeric',
                            month: 'short',
                            day: 'numeric',
                          })}
                        </td>
                        <td className="py-2 pr-3">
                          <span className="block">{row.referred_org_name || 'Untitled business'}</span>
                          <span className="block text-xs text-muted-foreground">{row.referred_email || row.referred_org_id}</span>
                        </td>
                        <td className="py-2 pr-3 font-mono text-xs">{row.code}</td>
                        <td className="py-2 pr-3">
                          <Badge variant={row.status === 'paid' || row.status === 'rewarded' ? 'default' : 'secondary'}>
                            {row.status}
                          </Badge>
                          <span className="ml-2 text-xs text-muted-foreground">
                            {saasReferralStatusLabel(row.status, row.block_reason)}
                            {row.reversal_reason ? ` (${row.reversal_reason})` : ''}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </AdminLayout>
  );
}
