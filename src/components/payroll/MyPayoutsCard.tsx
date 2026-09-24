import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from '@/components/ui/accordion';
import { Banknote, Loader2, RefreshCw } from 'lucide-react';
import { QueryError } from '@/components/QueryError';
import { PayoutStatusBadge, PayoutTimeline, expectedDepositLabel, type PayoutRecord } from './PayoutTimeline';
import { toast } from 'sonner';

type MyPayout = PayoutRecord & { id: string; week_start: string; amount: number | null };

/** Cleaner-facing list of their own payouts with status timeline + expected deposit date. */
export function MyPayoutsCard({ organizationId }: { organizationId: string }) {
  const qc = useQueryClient();
  const { data = [], isLoading, error, refetch } = useQuery({
    queryKey: ['my-payouts', organizationId],
    enabled: !!organizationId,
    queryFn: async () => {
      const { data, error } = await (supabase.rpc as any)('get_my_payouts', { _organization_id: organizationId });
      if (error) throw error;
      return (data ?? []) as MyPayout[];
    },
  });

  const refresh = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.functions.invoke('sync-staff-payout-status', { body: { organization_id: organizationId } });
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['my-payouts', organizationId] }),
    onError: () => toast.error("Couldn't check with Stripe right now. Try again in a minute."),
  });

  return (
    <Card>
      <CardHeader className="pb-3 flex flex-row items-center justify-between space-y-0">
        <CardTitle className="text-base flex items-center gap-2">
          <Banknote className="w-4 h-4" /> My payouts
        </CardTitle>
        <Button variant="ghost" size="sm" onClick={() => refresh.mutate()} disabled={refresh.isPending} aria-label="Refresh payout status">
          {refresh.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
        </Button>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <div className="flex justify-center py-6"><Loader2 className="w-5 h-5 animate-spin text-muted-foreground" /></div>
        ) : error ? (
          <QueryError subject="payouts" onRetry={() => refetch()} />
        ) : data.length === 0 ? (
          <p className="text-sm text-muted-foreground">No payouts yet. When you're paid, you'll see the status and expected deposit date here.</p>
        ) : (
          <Accordion type="single" collapsible className="w-full">
            {data.map((p) => {
              const dep = expectedDepositLabel(p);
              return (
                <AccordionItem key={p.id} value={p.id}>
                  <AccordionTrigger className="hover:no-underline">
                    <div className="flex flex-1 items-center justify-between gap-3 pr-2 text-left">
                      <div>
                        <p className="text-sm font-medium">${Number(p.amount ?? 0).toFixed(2)}</p>
                        <p className="text-xs text-muted-foreground">{dep ?? `Week of ${p.week_start}`}</p>
                      </div>
                      <PayoutStatusBadge record={p} />
                    </div>
                  </AccordionTrigger>
                  <AccordionContent>
                    <PayoutTimeline record={p} />
                  </AccordionContent>
                </AccordionItem>
              );
            })}
          </Accordion>
        )}
      </CardContent>
    </Card>
  );
}
