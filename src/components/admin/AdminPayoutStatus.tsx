import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { useOrgId } from '@/hooks/useOrgId';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { Banknote, CheckCircle2, Clock, AlertCircle, RefreshCw, Loader2, AlertTriangle, ExternalLink } from 'lucide-react';
import { toast } from 'sonner';
import { QueryError } from '@/components/QueryError';
import { OrgTimestamp } from '@/components/OrgTimestamp';

interface AdminPayoutStatusProps {
  staffId: string;
  staffName: string;
}

export function AdminPayoutStatus({ staffId, staffName }: AdminPayoutStatusProps) {
  const { organizationId } = useOrgId();
  const queryClient = useQueryClient();
  const [isRefreshing, setIsRefreshing] = useState(false);

  const { data: payoutAccount, isLoading, error: payoutError } = useQuery({
    queryKey: ['admin-staff-payout', staffId, organizationId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('staff_payout_accounts')
        .select('*')
        .eq('staff_id', staffId)
        .eq('organization_id', organizationId!)
        .maybeSingle();
      if (error) throw error;
      return data;
    },
    enabled: !!staffId && !!organizationId,
  });

  const handleRefreshStatus = async () => {
    setIsRefreshing(true);
    try {
      const { data, error } = await supabase.functions.invoke('check-staff-payout-status', {
        body: { staffId, organizationId },
      });
      if (error) throw error;
      // Invalidate cached queries to pick up the updated DB record
      queryClient.invalidateQueries({ queryKey: ['admin-staff-payout', staffId, organizationId] });
      toast.success(`Payout status refreshed for ${staffName}`);
    } catch (err: any) {
      toast.error('Failed to refresh status: ' + (err.message || 'Unknown error'));
    } finally {
      setIsRefreshing(false);
    }
  };

  const getStatusBadge = () => {
    if (!payoutAccount) {
      return <Badge variant="outline" className="text-muted-foreground"><AlertCircle className="w-3 h-3 mr-1" />Not Set Up</Badge>;
    }
    switch (payoutAccount.account_status) {
      case 'active':
        return <Badge className="bg-success/20 text-success border-success/30"><CheckCircle2 className="w-3 h-3 mr-1" />Active</Badge>;
      case 'pending_verification':
        return <Badge className="bg-warning/20 text-warning border-warning/30"><Clock className="w-3 h-3 mr-1" />Pending Verification</Badge>;
      case 'onboarding':
        return <Badge className="bg-info/20 text-info border-info/30"><Clock className="w-3 h-3 mr-1" />Onboarding Incomplete</Badge>;
      default:
        return <Badge variant="outline"><AlertCircle className="w-3 h-3 mr-1" />Not Set Up</Badge>;
    }
  };

  const requirementsDue = (payoutAccount as any)?.requirements_currently_due as string[] | null;
  const requirementsPending = (payoutAccount as any)?.requirements_pending_verification as string[] | null;
  const disabledReason = (payoutAccount as any)?.disabled_reason as string | null;
  const requirementsErrors = (payoutAccount as any)?.stripe_requirements_errors as any[] | null;
  const lastWebhook = (payoutAccount as any)?.last_webhook_at as string | null;

  const hasBlockingRequirements = requirementsDue && requirementsDue.length > 0;
  const hasPendingVerification = requirementsPending && requirementsPending.length > 0;
  const hasErrors = requirementsErrors && requirementsErrors.length > 0;

  const formatRequirement = (req: string) => {
    return req
      .replace(/_/g, ' ')
      .replace(/\./g, ' → ')
      .replace(/\b\w/g, l => l.toUpperCase());
  };

  if (payoutError) return <QueryError subject="payout status" onRetry={() => queryClient.invalidateQueries({ queryKey: ['admin-staff-payout', staffId, organizationId] })} />;

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <p className="text-sm font-medium flex items-center gap-2">
          <Banknote className="w-4 h-4" />
          Payout Status
        </p>
        <div className="flex items-center gap-2">
          {getStatusBadge()}
          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-7 w-7"
                  onClick={handleRefreshStatus}
                  disabled={isRefreshing || !payoutAccount?.stripe_account_id}
                >
                  {isRefreshing ? (
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  ) : (
                    <RefreshCw className="w-3.5 h-3.5" />
                  )}
                </Button>
              </TooltipTrigger>
              <TooltipContent>Refresh status from Stripe</TooltipContent>
            </Tooltip>
          </TooltipProvider>
        </div>
      </div>

      {payoutAccount?.bank_last4 && (
        <p className="text-xs text-muted-foreground">
          Bank: •••• {payoutAccount.bank_last4}
        </p>
      )}

      {/* Pending bank verification */}
      {hasPendingVerification && (
        <div className="p-2.5 rounded-lg bg-warning/10 border border-warning/20 text-xs space-y-1">
          <p className="font-medium text-warning flex items-center gap-1.5">
            <Clock className="w-3.5 h-3.5" />
            Pending Bank Verification (~2-3 business days)
          </p>
          <ul className="text-muted-foreground pl-5 list-disc space-y-0.5">
            {requirementsPending.map((req, i) => (
              <li key={i}>{formatRequirement(req)}</li>
            ))}
          </ul>
        </div>
      )}

      {/* Action required */}
      {hasBlockingRequirements && (
        <div className="p-2.5 rounded-lg bg-destructive/10 border border-destructive/20 text-xs space-y-1">
          <p className="font-medium text-destructive flex items-center gap-1.5">
            <AlertTriangle className="w-3.5 h-3.5" />
            Action Required
          </p>
          <ul className="text-muted-foreground pl-5 list-disc space-y-0.5">
            {requirementsDue.map((req, i) => (
              <li key={i}>{formatRequirement(req)}</li>
            ))}
          </ul>
        </div>
      )}

      {/* Errors from Stripe */}
      {hasErrors && (
        <div className="p-2.5 rounded-lg bg-destructive/10 border border-destructive/20 text-xs space-y-1">
          <p className="font-medium text-destructive flex items-center gap-1.5">
            <AlertCircle className="w-3.5 h-3.5" />
            Stripe Errors
          </p>
          <ul className="text-muted-foreground pl-5 list-disc space-y-0.5">
            {requirementsErrors.map((err, i) => (
              <li key={i}>{err.reason || err.code || 'Unknown error'}</li>
            ))}
          </ul>
        </div>
      )}

      {/* Disabled reason */}
      {disabledReason && (
        <p className="text-xs text-destructive flex items-center gap-1">
          <AlertCircle className="w-3 h-3" />
          Disabled: {disabledReason.replace(/_/g, ' ')}
        </p>
      )}

      {/* Not set up */}
      {!payoutAccount && (
        <p className="text-xs text-muted-foreground">
          {staffName} hasn't set up their payout account yet.
        </p>
      )}

      {/* Last webhook timestamp */}
      {lastWebhook && (
        <p className="text-[10px] text-muted-foreground/60">
          Last synced: <OrgTimestamp value={lastWebhook} />
        </p>
      )}
    </div>
  );
}
