import { useState, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Loader2, Banknote, ExternalLink, CheckCircle2, Clock, AlertCircle, ShieldCheck, RefreshCw, History } from 'lucide-react';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Label } from '@/components/ui/label';
import { PayoutRequirementsChecklist } from './PayoutRequirementsChecklist';
import { toast } from 'sonner';
import { format } from 'date-fns';
import { PayoutResetSection } from './PayoutResetSection';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { useSearchParams } from 'react-router-dom';
import { QueryError } from '@/components/QueryError';
import { readEdgeFunctionError } from '@/lib/edgeFunctionError';
import { openExternalUrl } from '@/lib/openExternalUrl';

interface StaffPayoutSetupProps {
  staffId: string;
  organizationId: string;
}

const PRODUCTION_BASE = 'https://jointidywise.com';

type EdgeErrorPayload = {
  error?: string;
  message?: string;
  code?: string;
  reason?: string;
  action?: string;
  details?: Record<string, unknown>;
};

async function extractEdgeError(error: unknown): Promise<EdgeErrorPayload & { _fallback: string }> {
  const fallback = error instanceof Error ? error.message : 'Failed to start payout setup';
  const out: EdgeErrorPayload & { _fallback: string } = { _fallback: fallback };

  if (typeof error !== 'object' || error === null || !('context' in error)) return out;
  const context = (error as { context?: Response }).context;
  if (!(context instanceof Response)) return out;

  try {
    const payload = await context.clone().json();
    return { ...payload, _fallback: fallback };
  } catch {
    try {
      const text = await context.clone().text();
      if (text) out.error = text;
    } catch {}
    return out;
  }
}

async function extractFunctionErrorMessage(error: unknown): Promise<string> {
  const p = await extractEdgeError(error);
  return p.message || p.error || p._fallback;
}

function buildUserFacingError(p: EdgeErrorPayload & { _fallback: string }): { title: string; description: string } {
  const code = p.code?.toUpperCase();
  const raw = (p.error || p.message || p._fallback || '').toLowerCase();

  // Structured errors from the edge function take priority
  if (code === 'STAFF_NOT_FOUND') {
    return {
      title: 'Staff record not found',
      description: p.action || 'Ask an owner/admin to verify this staff member exists in Settings → Staff.',
    };
  }
  if (code === 'ACCESS_DENIED') {
    return {
      title: 'Not authorized to set up this payout',
      description: `${p.reason ?? ''} ${p.action ?? 'Sign in as the staff member, or have an owner/admin complete this step.'}`.trim(),
    };
  }
  if (code === 'ORG_MISMATCH') {
    return {
      title: 'Wrong organization selected',
      description: p.action || 'Switch to the correct business in the top-left switcher and try again.',
    };
  }

  // Legacy / unstructured fallbacks
  if (raw.includes('org_stripe_not_connected') || raw.includes('stripe not configured')) {
    return { title: 'Employer payment account not connected', description: 'Ask an owner/admin to finish Settings → Payment Setup, then retry.' };
  }
  if (raw.includes('platform payment configuration') || raw.includes('platform_stripe_not_configured')) {
    return { title: 'Payouts temporarily unavailable', description: 'Try again in a few minutes or contact support.' };
  }
  if (raw.includes('country') && (raw.includes('cannot') || raw.includes('invalid') || raw.includes('not supported'))) {
    return { title: 'Country not supported', description: 'Use Reset Payout Setup below and pick the country where your bank is located.' };
  }
  if (raw.includes('email') && raw.includes('already')) {
    return { title: 'Email already in use', description: 'Use Reset Payout Setup below to start fresh.' };
  }
  if (raw.includes('rate limit') || raw.includes('too many requests')) {
    return { title: 'Too many attempts', description: 'Please wait a minute and try again.' };
  }
  if (raw.includes('network') || raw.includes('failed to fetch') || raw.includes('timeout')) {
    return { title: 'Network issue', description: 'Check your connection and try again.' };
  }
  return { title: 'Payout setup failed', description: p._fallback };
}

function mapErrorMessage(raw: string): string {
  // Legacy helper retained for any string-only callsites.
  return raw;
}




// Best-effort default country from browser locale (Stripe Express supported subset).
const SUPPORTED_COUNTRIES = ['US','AU','CA','GB','NZ','IE','DE','FR','ES','IT','NL','SG','HK','JP','MX','BR'];
function detectDefaultCountry(): string {
  try {
    const region = new Intl.Locale(navigator.language).maximize().region;
    if (region && SUPPORTED_COUNTRIES.includes(region)) return region;
  } catch {}
  return 'US';
}

export function StaffPayoutSetup({ staffId, organizationId }: StaffPayoutSetupProps) {
  const queryClient = useQueryClient();
  const [openingDashboard, setOpeningDashboard] = useState(false);
  const [searchParams] = useSearchParams();
  const [onboardingUrl, setOnboardingUrl] = useState<string | null>(null);
  const [isCheckingReturn, setIsCheckingReturn] = useState(false);
  const [country, setCountry] = useState<string>(() => detectDefaultCountry());

  // Detect return from Stripe onboarding via URL params
  const setupComplete = searchParams.get('setup') === 'complete' || searchParams.get('payout') === 'success';
  const [justSubmitted, setJustSubmitted] = useState(false);

  // Instant load from local DB cache (no edge function, no Stripe API)
  const { data: cachedStatus, isLoading: isCacheLoading, error: cachedStatusError } = useQuery({
    queryKey: ['staff-payout-cached', staffId, organizationId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('staff_payout_accounts')
        .select('*')
        .eq('staff_id', staffId)
        .eq('organization_id', organizationId)
        .maybeSingle();
      if (error) throw error;
      if (!data) return null;
      return {
        status: data.account_status || 'not_started',
        payoutsEnabled: data.payouts_enabled || false,
        chargesEnabled: data.charges_enabled || false,
        detailsSubmitted: data.details_submitted || false,
        bankLast4: data.bank_last4 || null,
        accountHolderName: data.account_holder_name || null,
      };
    },
  });

  // Background refresh from Stripe (runs after initial render, not blocking)
  const { data: liveStatus, isLoading: isLiveLoading, error: liveStatusError } = useQuery({
    queryKey: ['staff-payout-status', staffId, organizationId],
    queryFn: async () => {
      const { data, error } = await supabase.functions.invoke('check-staff-payout-status', {
        body: { staffId, organizationId },
      });
      if (error) throw error;
      queryClient.setQueryData(['staff-payout-cached', staffId, organizationId], data);
      return data as {
        status: string;
        payoutsEnabled: boolean;
        chargesEnabled: boolean;
        detailsSubmitted: boolean;
        bankLast4: string | null;
        accountHolderName: string | null;
      };
    },
    refetchInterval: 30000,
    refetchOnWindowFocus: true,
    enabled: !isCacheLoading,
  });

  // If returning from Stripe setup, show checking state and force refresh
  useEffect(() => {
    if (setupComplete) {
      setIsCheckingReturn(true);
      setJustSubmitted(true);
      // Force immediate refresh
      queryClient.invalidateQueries({ queryKey: ['staff-payout-status', staffId, organizationId] });
      queryClient.invalidateQueries({ queryKey: ['staff-payout-cached', staffId, organizationId] });
    }
  }, [setupComplete, staffId, organizationId, queryClient]);

  // Clear checking state once live data arrives
  useEffect(() => {
    if (isCheckingReturn && liveStatus && !isLiveLoading) {
      setIsCheckingReturn(false);
      if (liveStatus.payoutsEnabled) {
        toast.success('Payout setup complete! Your account is active.');
        setJustSubmitted(false);
      } else if (liveStatus.detailsSubmitted) {
        toast.info('Details submitted! Stripe is reviewing your application.');
      }
    }
  }, [isCheckingReturn, liveStatus, isLiveLoading]);

  const payoutStatus = liveStatus || cachedStatus;
  const isLoading = isCacheLoading;

  const refetch = () => {
    queryClient.invalidateQueries({ queryKey: ['staff-payout-status', staffId, organizationId] });
    queryClient.invalidateQueries({ queryKey: ['staff-payout-cached', staffId, organizationId] });
  };

  // Fetch payout history from bookings
  const { data: payoutHistory = [], error: payoutHistoryError } = useQuery({
    queryKey: ['staff-payout-history', staffId, organizationId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('bookings')
        .select(`
          id, booking_number, scheduled_at, total_amount,
          cleaner_actual_payment, cleaner_wage, cleaner_wage_type,
          payment_status, status,
          customer:customers(first_name, last_name)
        `)
        .eq('staff_id', staffId)
        .eq('organization_id', organizationId)
        .eq('status', 'completed')
        .order('scheduled_at', { ascending: false })
        .limit(20);

      if (error) throw error;
      return data || [];
    },
    enabled: payoutStatus?.status === 'active',
  });

  // Start or resume Stripe Connect onboarding
  const startOnboarding = useMutation({
    mutationFn: async () => {
      const { data, error } = await supabase.functions.invoke('create-staff-connect-account', {
        body: {
          staffId,
          organizationId,
          returnUrl: PRODUCTION_BASE,
          country,
        },
      });

      if (error) {
        const payload = await extractEdgeError(error);
        const ui = buildUserFacingError(payload);
        const err = new Error(ui.title) as Error & { ui?: { title: string; description: string } };
        err.ui = ui;
        throw err;
      }

      if (!data?.url) {
        const serverError = data?.error || data?.message || 'No onboarding link was returned. Please try again.';
        throw new Error(serverError);
      }

      return data as { url: string; accountId: string };
    },
    onSuccess: (data) => {
      setOnboardingUrl(data.url);
      toast.success('Redirecting to secure payout setup...');
      window.location.href = data.url;
    },
    onError: (error: Error & { ui?: { title: string; description: string } }) => {
      if (error.ui) {
        toast.error(error.ui.title, { description: error.ui.description, duration: 8000 });
      } else {
        toast.error(mapErrorMessage(error.message), { duration: 6000 });
      }
    },
  });


  // Direct redirect handler — called from a real user tap
  const handleOpenStripeSetup = () => {
    if (onboardingUrl) {
      window.location.href = onboardingUrl;
    }
  };

  const getStatusBadge = () => {
    if (!payoutStatus) return null;
    
    switch (payoutStatus.status) {
      case 'active':
        return <Badge className="bg-success/20 text-success border-success/30"><CheckCircle2 className="w-3 h-3 mr-1" />Active</Badge>;
      case 'pending_verification':
        return <Badge className="bg-warning/20 text-warning border-warning/30"><Clock className="w-3 h-3 mr-1" />Pending Verification</Badge>;
      case 'onboarding':
        return <Badge className="bg-info/20 text-info border-info/30"><AlertCircle className="w-3 h-3 mr-1" />Setup Incomplete</Badge>;
      default:
        return <Badge variant="outline"><AlertCircle className="w-3 h-3 mr-1" />Not Set Up</Badge>;
    }
  };

  if (cachedStatusError || liveStatusError || payoutHistoryError) {
    return <QueryError subject="payout setup" />;
  }

  if (isLoading || isCheckingReturn) {
    return (
      <Card>
        <CardContent className="flex flex-col items-center justify-center py-8 gap-2">
          <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
          {isCheckingReturn && (
            <p className="text-sm text-muted-foreground">Checking your setup status...</p>
          )}
        </CardContent>
      </Card>
    );
  }

  const isOrgNotConnected = payoutStatus?.status === 'org_not_connected';
  const isSetUp = payoutStatus?.status === 'active';
  const isOnboarding = payoutStatus?.status === 'onboarding' && !justSubmitted;
  const isPending = payoutStatus?.status === 'pending_verification' || (justSubmitted && payoutStatus?.detailsSubmitted);

  const openStripeDashboard = async () => {
    setOpeningDashboard(true);
    try {
      const { data, error } = await supabase.functions.invoke('staff-payout-dashboard-link', {
        body: { staffId, organizationId },
      });
      if (error) throw new Error(await readEdgeFunctionError(error, 'Could not open your payout page'));
      if (!data?.url) throw new Error('Could not open your payout page');
      await openExternalUrl(data.url);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not open your payout page');
    } finally {
      setOpeningDashboard(false);
    }
  };

  return (
    <div className="space-y-4">
      {/* Requirements checklist — shows status card and action items */}
      <PayoutRequirementsChecklist staffId={staffId} organizationId={organizationId} />

      {(isSetUp || isPending || payoutStatus?.detailsSubmitted) && (
        <Card>
          <CardContent className="pt-4 space-y-2">
            <p className="text-sm text-muted-foreground">
              Pay goes straight to your bank automatically — you never need to accept it. To see your balance, deposits or anything Stripe needs from you:
            </p>
            <Button onClick={openStripeDashboard} disabled={openingDashboard} className="w-full min-h-[44px] gap-2">
              {openingDashboard ? <Loader2 className="w-4 h-4 animate-spin" /> : <ExternalLink className="w-4 h-4" />}
              View my payouts on Stripe
            </Button>
          </CardContent>
        </Card>
      )}

      <div>
        <h2 className="text-lg font-semibold flex items-center gap-2">
          <Banknote className="w-5 h-5" />
          Payout Setup
        </h2>
        <p className="text-sm text-muted-foreground">Set up your bank account for direct payouts</p>
      </div>

      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <CardTitle className="text-base">Payment Account</CardTitle>
            <div className="flex items-center gap-2">
              {getStatusBadge()}
              <Button
                variant="ghost"
                size="icon"
                className="h-8 w-8"
                onClick={() => refetch()}
                title="Refresh status"
              >
                <RefreshCw className="w-4 h-4" />
              </Button>
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          {isSetUp ? (
            <>
              <div className="p-4 rounded-lg bg-success/10 border border-success/20">
                <div className="flex items-center gap-3">
                  <ShieldCheck className="w-8 h-8 text-success" />
                  <div>
                    <p className="font-medium">✅ Payout Account Connected</p>
                    <p className="text-sm text-muted-foreground">
                      Your bank account is connected and payouts are enabled.
                    </p>
                  </div>
                </div>
              </div>

              {payoutStatus.bankLast4 && (
                <div className="flex items-center justify-between p-3 rounded-lg border bg-card">
                  <div>
                    <p className="text-sm text-muted-foreground">Bank Account</p>
                    <p className="font-medium">•••• {payoutStatus.bankLast4}</p>
                  </div>
                  <Banknote className="w-5 h-5 text-muted-foreground" />
                </div>
              )}

              {payoutStatus.accountHolderName && (
                <div className="flex items-center justify-between p-3 rounded-lg border bg-card">
                  <div>
                    <p className="text-sm text-muted-foreground">Account Holder</p>
                    <p className="font-medium">{payoutStatus.accountHolderName}</p>
                  </div>
                </div>
              )}

              <Button
                variant="outline"
                className="w-full"
                onClick={() => startOnboarding.mutate()}
                disabled={startOnboarding.isPending}
              >
                {startOnboarding.isPending ? (
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                ) : (
                  <ExternalLink className="w-4 h-4 mr-2" />
                )}
                Update Bank Account
              </Button>

              {onboardingUrl && (
                <Button
                  className="w-full"
                  size="lg"
                  onClick={handleOpenStripeSetup}
                >
                  <ExternalLink className="w-4 h-4 mr-2" />
                  Open Stripe Setup →
                </Button>
              )}
            </>
          ) : isPending ? (
            <>
              <div className="p-4 rounded-lg bg-warning/10 border border-warning/20">
                <div className="flex items-center gap-3">
                  <Clock className="w-8 h-8 text-warning" />
                  <div>
                    <p className="font-medium">✅ Submitted to Stripe for Review</p>
                    <p className="text-sm text-muted-foreground">
                      Your application has been submitted. Stripe typically reviews and approves accounts within 1-2 business days. You'll see your status update here automatically.
                    </p>
                  </div>
                </div>
              </div>

              <div className="p-3 rounded-lg border bg-card text-sm text-muted-foreground space-y-1">
                <p><strong>What happens next:</strong></p>
                <ul className="list-disc pl-4 space-y-1">
                  <li>Stripe verifies your identity and bank details</li>
                  <li>Once approved, your status will change to <span className="text-success font-medium">Active</span></li>
                  <li>You'll then receive payouts directly to your bank account</li>
                </ul>
              </div>

              <Button
                variant="outline"
                className="w-full"
                onClick={() => refetch()}
              >
                <RefreshCw className="w-4 h-4 mr-2" />
                Check for Updates
              </Button>
            </>
          ) : isOrgNotConnected ? (
            <div className="p-4 rounded-lg bg-destructive/10 border border-destructive/20">
              <div className="flex items-center gap-3">
                <AlertCircle className="w-8 h-8 text-destructive" />
                <div>
                  <p className="font-medium">Payment Account Not Available</p>
                  <p className="text-sm text-muted-foreground">
                    Your employer hasn't connected their payment account yet. Please ask them to go to Settings → Payment Setup and connect their account before you can set up payouts.
                  </p>
                </div>
              </div>
            </div>
          ) : (
            <>
              <div className="p-4 rounded-lg bg-muted/50 border">
                <p className="text-sm text-muted-foreground mb-3">
                  {isOnboarding
                    ? "You started the payout setup but didn't finish. Continue where you left off."
                    : "Set up your bank account to receive direct payouts for your work. This is a secure process powered by Stripe."}
                </p>
                <ul className="text-sm text-muted-foreground space-y-1">
                  <li className="flex items-center gap-2">
                    <ShieldCheck className="w-4 h-4 text-success" />
                    Bank-level security
                  </li>
                  <li className="flex items-center gap-2">
                    <ShieldCheck className="w-4 h-4 text-success" />
                    Your info is never shared with your employer
                  </li>
                  <li className="flex items-center gap-2">
                    <ShieldCheck className="w-4 h-4 text-success" />
                    Takes about 5 minutes to complete
                  </li>
                </ul>
              </div>

              {/* Step 1: Generate the setup link */}
              {!onboardingUrl && (
                <>
                  {!isOnboarding && (
                    <div className="space-y-2">
                      <Label htmlFor="payout-country">Bank account country</Label>
                      <Select value={country} onValueChange={setCountry}>
                        <SelectTrigger id="payout-country">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="US">🇺🇸 United States</SelectItem>
                          <SelectItem value="AU">🇦🇺 Australia</SelectItem>
                          <SelectItem value="CA">🇨🇦 Canada</SelectItem>
                          <SelectItem value="GB">🇬🇧 United Kingdom</SelectItem>
                          <SelectItem value="NZ">🇳🇿 New Zealand</SelectItem>
                          <SelectItem value="IE">🇮🇪 Ireland</SelectItem>
                          <SelectItem value="DE">🇩🇪 Germany</SelectItem>
                          <SelectItem value="FR">🇫🇷 France</SelectItem>
                          <SelectItem value="ES">🇪🇸 Spain</SelectItem>
                          <SelectItem value="IT">🇮🇹 Italy</SelectItem>
                          <SelectItem value="NL">🇳🇱 Netherlands</SelectItem>
                          <SelectItem value="SG">🇸🇬 Singapore</SelectItem>
                          <SelectItem value="HK">🇭🇰 Hong Kong</SelectItem>
                          <SelectItem value="JP">🇯🇵 Japan</SelectItem>
                          <SelectItem value="MX">🇲🇽 Mexico</SelectItem>
                          <SelectItem value="BR">🇧🇷 Brazil</SelectItem>
                        </SelectContent>
                      </Select>
                      <div className="flex items-start gap-2 p-2 rounded-md bg-warning/10 border border-warning/20">
                        <AlertCircle className="w-4 h-4 text-warning mt-0.5 shrink-0" />
                        <p className="text-xs text-muted-foreground">
                          Pick the country where your bank account is held. Stripe locks the country once setup starts — to change it later you'll need to use <strong>Reset Payout Setup</strong> below.
                        </p>
                      </div>
                    </div>
                  )}
                  {isOnboarding && (
                    <div className="flex items-start gap-2 p-3 rounded-lg bg-info/10 border border-info/20">
                      <AlertCircle className="w-4 h-4 text-info mt-0.5 shrink-0" />
                      <p className="text-xs text-muted-foreground">
                        Your account was started for a specific country and Stripe locks that selection. If your bank is in a different country, use <strong>Reset Payout Setup</strong> below and start over.
                      </p>
                    </div>
                  )}

                  <Button
                    className="w-full"
                    onClick={() => startOnboarding.mutate()}
                    disabled={startOnboarding.isPending}
                    size="lg"
                  >
                    {startOnboarding.isPending ? (
                      <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                    ) : (
                      <Banknote className="w-4 h-4 mr-2" />
                    )}
                    {isOnboarding ? 'Continue Payout Setup' : 'Set Up Payouts'}
                  </Button>
                </>
              )}

              {/* Step 2: Show prominent redirect button */}
              {onboardingUrl && (
                <div className="space-y-3">
                  <div className="p-3 rounded-lg bg-info/10 border border-info/20 text-sm text-center">
                    ✅ Setup link is ready! Tap the button below to continue.
                  </div>
                  <Button
                    className="w-full min-h-[52px] text-base font-semibold"
                    size="lg"
                    onClick={handleOpenStripeSetup}
                  >
                    <ExternalLink className="w-5 h-5 mr-2" />
                    Open Payout Setup →
                  </Button>
                </div>
              )}
            </>
          )}
        </CardContent>
      </Card>

      {/* Payout History */}
      {isSetUp && payoutHistory.length > 0 && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2">
              <History className="w-4 h-4" />
              Payout History
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Date</TableHead>
                    <TableHead>Booking</TableHead>
                    <TableHead>Customer</TableHead>
                    <TableHead className="text-right">Amount</TableHead>
                    <TableHead>Status</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {payoutHistory.map((booking: any) => {
                    const payAmount = booking.cleaner_actual_payment || booking.cleaner_wage || 0;
                    return (
                      <TableRow key={booking.id}>
                        <TableCell className="text-sm">
                          {format(new Date(booking.scheduled_at), 'MMM d, yyyy')}
                        </TableCell>
                        <TableCell className="text-sm font-medium">
                          #{booking.booking_number}
                        </TableCell>
                        <TableCell className="text-sm">
                          {booking.customer
                            ? `${booking.customer.first_name} ${booking.customer.last_name}`
                            : '—'}
                        </TableCell>
                        <TableCell className="text-sm text-right font-medium">
                          ${payAmount.toFixed(2)}
                        </TableCell>
                        <TableCell>
                          <Badge
                            variant="outline"
                            className={
                              booking.payment_status === 'paid'
                                ? 'bg-success/10 text-success border-success/30'
                                : 'text-muted-foreground'
                            }
                          >
                            {booking.payment_status === 'paid' ? 'Paid' : booking.payment_status || 'Pending'}
                          </Badge>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Reset Payout Setup — collapsible at the bottom */}
      <PayoutResetSection
        staffId={staffId}
        organizationId={organizationId}
        currentStatus={payoutStatus?.status || null}
        chargesEnabled={payoutStatus?.chargesEnabled || false}
      />
    </div>
  );
}
