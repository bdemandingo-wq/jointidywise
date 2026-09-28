import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useOrganization } from '@/contexts/OrganizationContext';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { Loader2, History, AlertTriangle } from 'lucide-react';
import { QueryError } from '@/components/QueryError';
import { format, subDays } from 'date-fns';
import { OrgTimestamp } from '@/components/OrgTimestamp';

const REASON_LABELS: Record<string, string> = {
  changed_banks: 'Changed banks',
  wrong_account: 'Wrong account',
  verification_failed: 'Verification failed',
  closed_account: 'Closed account',
  admin_requested: 'Admin-requested',
  other: 'Other',
};

export function StripeResetHistoryPanel() {
  const { organization } = useOrganization();

  const { data: resetHistory = [], isLoading, error: resetHistoryError } = useQuery({
    queryKey: ['stripe-reset-history', organization?.id],
    queryFn: async () => {
      if (!organization?.id) return [];
      const { data, error } = await supabase
        .from('stripe_reset_history')
        .select('*, staff:staff(name)')
        .eq('organization_id', organization.id)
        .order('created_at', { ascending: false })
        .limit(50);
      if (error) throw error;
      return data || [];
    },
    enabled: !!organization?.id,
  });

  // Flag cleaners with 3+ resets in the last 30 days
  const thirtyDaysAgo = subDays(new Date(), 30);
  const recentResetCounts = new Map<string, number>();
  resetHistory.forEach((r: any) => {
    if (new Date(r.created_at) >= thirtyDaysAgo) {
      recentResetCounts.set(r.staff_id, (recentResetCounts.get(r.staff_id) || 0) + 1);
    }
  });
  const flaggedStaff = new Set(
    Array.from(recentResetCounts.entries())
      .filter(([, count]) => count > 2)
      .map(([id]) => id)
  );

  if (resetHistoryError) {
    return <QueryError subject="Stripe reset history" />;
  }

  if (isLoading) {
    return (
      <Card>
        <CardContent className="flex items-center justify-center py-8">
          <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <div>
            <CardTitle className="text-base flex items-center gap-2">
              <History className="w-4 h-4" />
              Reset History
              {flaggedStaff.size > 0 && (
                <Badge variant="destructive" className="ml-2">
                  <AlertTriangle className="w-3 h-3 mr-1" />
                  {flaggedStaff.size} flagged
                </Badge>
              )}
            </CardTitle>
            <CardDescription>
              All payout setup resets with reasons and audit trail
            </CardDescription>
          </div>
        </div>
      </CardHeader>
      <CardContent>
        {resetHistory.length === 0 ? (
          <p className="text-sm text-muted-foreground text-center py-4">No resets recorded yet.</p>
        ) : (
          <div className="rounded-lg border overflow-hidden">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Cleaner</TableHead>
                  <TableHead>Date</TableHead>
                  <TableHead>Reason</TableHead>
                  <TableHead className="hidden md:table-cell">Old Account</TableHead>
                  <TableHead className="hidden md:table-cell">New Account</TableHead>
                  <TableHead>By</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {resetHistory.map((reset: any) => (
                  <TableRow key={reset.id}>
                    <TableCell>
                      <div className="flex items-center gap-1.5">
                        <span className="font-medium text-sm">{reset.staff?.name || 'Unknown'}</span>
                        {flaggedStaff.has(reset.staff_id) && (
                          <span title="3+ resets in 30 days"><AlertTriangle className="w-3.5 h-3.5 text-destructive" /></span>
                        )}
                      </div>
                    </TableCell>
                    <TableCell className="text-sm">
                      <OrgTimestamp value={reset.created_at} />
                    </TableCell>
                    <TableCell>
                      <span className="text-sm">{REASON_LABELS[reset.reason] || reset.reason || '—'}</span>
                    </TableCell>
                    <TableCell className="hidden md:table-cell text-xs text-muted-foreground font-mono">
                      {reset.previous_stripe_account_id ? `...${reset.previous_stripe_account_id.slice(-8)}` : '—'}
                    </TableCell>
                    <TableCell className="hidden md:table-cell text-xs text-muted-foreground font-mono">
                      {reset.new_stripe_account_id ? `...${reset.new_stripe_account_id.slice(-8)}` : '—'}
                    </TableCell>
                    <TableCell>
                      <Badge variant={reset.initiated_by === 'admin' ? 'default' : 'outline'} className="text-[10px]">
                        {reset.initiated_by === 'admin' ? 'Admin' : 'Cleaner'}
                      </Badge>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
