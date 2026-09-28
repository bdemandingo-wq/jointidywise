import { useState, useEffect, useCallback } from "react";
import { useSearchParams } from "react-router-dom";
import { AdminLayout } from "@/components/admin/AdminLayout";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Checkbox } from "@/components/ui/checkbox";
import {
  CreditCard,
  CheckCircle2,
  Loader2,
  Trash2,
  ExternalLink,
  AlertCircle,
  Zap,
  DollarSign,
  Users,
  BarChart3,
  Link2,
  Banknote,
  AlertTriangle,
  ShieldAlert,
} from "lucide-react";
import { toast } from "sonner";
import { showChargeFailureToastSonner, extractFailureReason } from "@/lib/chargeErrorToast";
import { supabase } from "@/lib/supabase";
import { readEdgeFunctionError } from "@/lib/edgeFunctionError";
import { useOrganization } from "@/contexts/OrganizationContext";
import { useOrgRole } from "@/hooks/useOrgRole";
import { SEOHead } from "@/components/SEOHead";
import { format } from "date-fns";
import { Capacitor } from "@capacitor/core";
import { openExternalUrl } from "@/lib/openExternalUrl";
import { fmt } from '@/lib/activeCurrency';
import { OrgTimestamp } from '@/components/OrgTimestamp';


interface ConnectionStatus {
  connected: boolean;
  legacy?: boolean;
  account_id?: string;
  email?: string;
  display_name?: string;
  payouts_enabled?: boolean;
  connected_at?: string;
  default_currency?: string;
  has_publishable_key?: boolean;
  needs_business_name_change?: boolean;
}

interface ManualPayment {
  id: string;
  customer_name: string;
  amount: number;
  description: string | null;
  stripe_charge_id: string | null;
  created_at: string;
}

export default function PaymentIntegrationPage() {
  const { organization } = useOrganization();
  const { isOwner } = useOrgRole();
  const [searchParams] = useSearchParams();
  const [isLoading, setIsLoading] = useState(true);
  const [isConnecting, setIsConnecting] = useState(false);
  const [isDisconnecting, setIsDisconnecting] = useState(false);
  const [disconnectConfirmOpen, setDisconnectConfirmOpen] = useState(false);
  const [connectionStatus, setConnectionStatus] = useState<ConnectionStatus | null>(null);
  const [oauthMessage, setOauthMessage] = useState<string | null>(null);
  const [oauthError, setOauthError] = useState<string | null>(null);

  // Manual key entry state
  const [showManualKeys, setShowManualKeys] = useState(false);
  const [manualSecretKey, setManualSecretKey] = useState("");
  const [manualPublishableKey, setManualPublishableKey] = useState("");
  const [savingKeys, setSavingKeys] = useState(false);
  const [confirmedOwnership, setConfirmedOwnership] = useState(false);

  // Charge modal state
  const [chargeOpen, setChargeOpen] = useState(false);
  const [chargeName, setChargeName] = useState("");
  const [chargeAmount, setChargeAmount] = useState("");
  const [chargeDesc, setChargeDesc] = useState("");
  const [charging, setCharging] = useState(false);

  // Recent manual payments
  const [recentPayments, setRecentPayments] = useState<ManualPayment[]>([]);

  // Check for OAuth callback code
  useEffect(() => {
    const code = searchParams.get("code");
    const state = searchParams.get("state");

    if (code && organization?.id) {
      handleOAuthCallback(code, state);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps -- handleOAuthCallback is recreated each render; runs once when OAuth code arrives
  }, [searchParams, organization?.id]);

  // Load connection status
  useEffect(() => {
    if (organization?.id && !searchParams.get("code")) {
      fetchConnectionStatus();
      fetchRecentPayments();
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps -- fetchConnectionStatus/fetchRecentPayments/searchParams are recreated each render; runs once per org
  }, [organization?.id]);

  const fetchConnectionStatus = async () => {
    if (!organization?.id) return;
    setIsLoading(true);
    try {
      const { data, error } = await supabase.functions.invoke("stripe-connect-oauth", {
        body: { action: "get_status", organization_id: organization.id },
      });
      if (error) throw new Error(await readEdgeFunctionError(error, "Failed to check Stripe connection"));
      setConnectionStatus(data);
    } catch (err) {
      console.error("Error fetching status:", err);
      setConnectionStatus({ connected: false });
    } finally {
      setIsLoading(false);
    }
  };

  const fetchRecentPayments = async () => {
    if (!organization?.id) return;
    const { data } = await supabase
      .from("manual_payments")
      .select("id, customer_name, amount, description, stripe_charge_id, created_at")
      .eq("organization_id", organization.id)
      .order("created_at", { ascending: false })
      .limit(10);
    setRecentPayments(data || []);
  };

  const handleOAuthCallback = async (code: string, state: string | null) => {
    if (!organization?.id) return;
    setIsConnecting(true);
    setIsLoading(false);
    setOauthMessage("Connecting your Stripe account...");
    setOauthError(null);
    try {
      const { data, error } = await supabase.functions.invoke("stripe-connect-oauth", {
        body: { action: "exchange_code", organization_id: organization.id, code, state },
      });
      if (error) throw new Error(await readEdgeFunctionError(error, "Failed to connect Stripe"));
      if (data?.error) throw new Error(data.error);

      setOauthMessage(null);
      toast.success("✅ Stripe Connected Successfully");
      window.history.replaceState({}, "", window.location.pathname);
      await fetchConnectionStatus();
    } catch (err: any) {
      console.error("OAuth callback error:", err);
      setOauthMessage(null);
      setOauthError(err.message || "Failed to connect Stripe");
      toast.error(err.message || "Failed to connect Stripe");
      window.history.replaceState({}, "", window.location.pathname);
    } finally {
      setIsConnecting(false);
    }
  };

  const handleConnect = async () => {
    if (!organization?.id) return;
    setIsConnecting(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      const { data, error } = await supabase.functions.invoke("stripe-connect-oauth", {
        body: { action: "get_oauth_url", organization_id: organization.id, email: user?.email || "" },
      });
      if (error) throw new Error(await readEdgeFunctionError(error, "Failed to start Stripe onboarding"));
      if (data?.url) {
        window.location.href = data.url;
      } else {
        throw new Error("No OAuth URL returned");
      }
    } catch (err: any) {
      console.error("Connect error:", err);
      toast.error(err.message || "Failed to start connection");
      setIsConnecting(false);
    }
  };

  const extractInvokeErrorMessage = async (err: any) => {
    if (err?.context && typeof err.context.json === "function") {
      try {
        const body = await err.context.json();
        if (body?.error) return body.error as string;
      } catch {
        // Ignore body parse failures and fall back to generic message.
      }
    }

    return err?.message || "Failed to save API keys";
  };

  const validateManualStripeKeys = () => {
    const secret = manualSecretKey.trim();
    const publishable = manualPublishableKey.trim();

    if (!secret) return "Stripe secret key is required.";
    if (secret.startsWith("mk_")) {
      return "Management keys (mk_...) won't work here. Use your Stripe secret key (sk_live_... or sk_test_...) instead.";
    }
    if (secret.startsWith("pk_")) {
      return "You entered a publishable key in the secret key field. Please paste your Stripe secret key (sk_live_... or sk_test_...).";
    }
    if (!secret.startsWith("sk_live_") && !secret.startsWith("sk_test_") && !secret.startsWith("rk_live_") && !secret.startsWith("rk_test_")) {
      return "Secret key must start with sk_live_, sk_test_, rk_live_, or rk_test_.";
    }
    if (publishable && !publishable.startsWith("pk_live_") && !publishable.startsWith("pk_test_")) {
      return "Publishable key must start with pk_live_ or pk_test_.";
    }

    return null;
  };

  const handleSaveManualKeys = async () => {
    if (!organization?.id || !manualSecretKey.trim()) return;

    const validationError = validateManualStripeKeys();
    if (validationError) {
      toast.error(validationError);
      return;
    }

    setSavingKeys(true);
    try {
      const { data, error } = await supabase.functions.invoke("stripe-connect-oauth", {
        body: {
          action: "save_manual_keys",
          organization_id: organization.id,
          secret_key: manualSecretKey.trim(),
          publishable_key: manualPublishableKey.trim() || null,
        },
      });
      if (error) throw new Error(await readEdgeFunctionError(error, "Failed to save Stripe API keys"));
      if (data?.error) throw new Error(data.error);

      setConnectionStatus({
        connected: true,
        legacy: true,
        email: data?.email ?? undefined,
        display_name: data?.display_name ?? undefined,
        payouts_enabled: data?.payouts_enabled ?? true,
        has_publishable_key: !!manualPublishableKey.trim(),
      });
      toast.success("Stripe API keys saved successfully!");
      if (data?.warning) {
        toast.message(data.warning);
      }
      setManualSecretKey("");
      setManualPublishableKey("");
      setShowManualKeys(false);
      fetchConnectionStatus();
    } catch (err: any) {
      console.error("Manual key save error:", err);
      toast.error(await extractInvokeErrorMessage(err));
    } finally {
      setSavingKeys(false);
    }
  };

  const handleDisconnect = () => {
    if (!organization?.id) return;
    setDisconnectConfirmOpen(true);
  };

  const executeDisconnect = async () => {
    setDisconnectConfirmOpen(false);
    setIsDisconnecting(true);
    try {
      const { data, error } = await supabase.functions.invoke("stripe-connect-oauth", {
        // The disconnect button only renders for a connected org, but that is
        // a UI guarantee TypeScript cannot see.
        body: { action: "disconnect", organization_id: organization?.id },
      });
      if (error) throw new Error(await readEdgeFunctionError(error, "Failed to disconnect Stripe"));
      setConnectionStatus({ connected: false });
      toast.success("Stripe disconnected successfully");
    } catch (err) {
      console.error("Disconnect error:", err);
      toast.error("Failed to disconnect Stripe");
    } finally {
      setIsDisconnecting(false);
    }
  };

  const handleChargeCard = async () => {
    if (!organization?.id || !chargeName.trim() || !chargeAmount) return;
    setCharging(true);
    try {
      const { data, error } = await supabase.functions.invoke("charge-card-manual", {
        body: {
          organization_id: organization.id,
          customer_name: chargeName.trim(),
          amount: parseFloat(chargeAmount),
          description: chargeDesc.trim() || null,
        },
      });
      if (error) throw new Error(await readEdgeFunctionError(error, "Failed to create payment intent"));
      if (data?.error) {
        showChargeFailureToastSonner({
          failureReason: extractFailureReason(data),
          declineCode: data?.decline_code || data?.declineCode,
          declined: !!data?.declined,
          customer: { name: chargeName.trim() },
          organizationId: organization.id,
          amount: parseFloat(chargeAmount),
        });
        return;
      }

      toast.success(`Payment intent created for ${fmt(parseFloat(chargeAmount))}`);
      setChargeOpen(false);
      setChargeName("");
      setChargeAmount("");
      setChargeDesc("");
      fetchRecentPayments();
    } catch (err: any) {
      showChargeFailureToastSonner({
        failureReason: err?.message || "Failed to create charge",
        customer: { name: chargeName.trim() },
        organizationId: organization?.id ?? null,
        amount: parseFloat(chargeAmount) || 0,
      });
    } finally {
      setCharging(false);
    }
  };

  const stripeLinks = [
    { label: "View Charges", icon: CreditCard, emoji: "💳", url: "https://dashboard.stripe.com/charges" },
    { label: "View Payouts", icon: Banknote, emoji: "💰", url: "https://dashboard.stripe.com/payouts" },
    { label: "View Customers", icon: Users, emoji: "👥", url: "https://dashboard.stripe.com/customers" },
    { label: "View Dashboard", icon: BarChart3, emoji: "📊", url: "https://dashboard.stripe.com" },
    { label: "Create Payment Link", icon: Link2, emoji: "🔄", url: "https://dashboard.stripe.com/payment-links/create" },
  ];

  // Show OAuth connecting state
  if (oauthMessage) {
    return (
      <AdminLayout title="Payment Integration" subtitle="Connect your Stripe account to accept payments">
<div className="portal-v2 portal-v2-scroll">
        <SEOHead title="Payment Integration | TidyWise" description="Connect and manage payment processing" noIndex />
        <div className="flex flex-col items-center justify-center py-16 gap-4">
          <Loader2 className="h-10 w-10 animate-spin text-[#635BFF]" />
          <p className="text-lg font-semibold text-foreground">{oauthMessage}</p>
          <p className="text-sm text-muted-foreground">Please wait while we verify your account...</p>
        </div>
      </div>
</AdminLayout>
    );
  }

  if (isLoading) {
    return (
      <AdminLayout title="Payment Integration" subtitle="Connect your Stripe account to accept payments">
<div className="portal-v2 portal-v2-scroll">
        <SEOHead title="Payment Integration | TidyWise" description="Connect and manage payment processing" noIndex />
        <div className="flex items-center justify-center py-12">
          <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
        </div>
      </div>
</AdminLayout>
    );
  }

  return (
    <AdminLayout title="Payment Integration" subtitle="Connect your Stripe account to accept payments">
<div className="portal-v2 portal-v2-scroll">
      <SEOHead title="Payment Integration | TidyWise" description="Connect and manage payment processing" noIndex />
      <div className="space-y-6 max-w-3xl">

        {/* OAuth error banner */}
        {oauthError && (
          <Card className="border-destructive/30 bg-destructive/5">
            <CardContent className="pt-6">
              <div className="flex items-start gap-3">
                <AlertCircle className="h-5 w-5 text-destructive flex-shrink-0 mt-0.5" />
                <div>
                  <p className="font-semibold text-foreground">Stripe Connection Failed</p>
                  <p className="text-sm text-muted-foreground mt-1">{oauthError}</p>
                  <Button size="sm" variant="outline" className="mt-3" onClick={() => setOauthError(null)}>
                    Dismiss
                  </Button>
                </div>
              </div>
            </CardContent>
          </Card>
        )}

        {connectionStatus?.connected ? (
          <>
            <Card className="border-success/30 bg-success/5">
              <CardContent className="pt-6">
                <div className="flex items-start justify-between gap-4">
                  <div className="flex items-start gap-3">
                    <CheckCircle2 className="h-6 w-6 text-success flex-shrink-0 mt-0.5" />
                    <div>
                      <p className="font-semibold text-foreground text-lg">
                        ✅ Stripe Connected {connectionStatus.legacy && "(API Keys)"}
                      </p>
                      {connectionStatus.email && (
                        <p className="text-sm text-muted-foreground mt-1">
                          {connectionStatus.display_name || connectionStatus.email}
                        </p>
                      )}
                      {connectionStatus.connected_at && (
                        <p className="text-xs text-muted-foreground mt-1">
                          {/* eslint-disable-next-line local/no-device-local-dates -- viewer-local display of a stored instant */}
                          Connected since {new Date(connectionStatus.connected_at).toLocaleDateString()}
                        </p>
                      )}
                    </div>
                  </div>
                  {isOwner && (
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={handleDisconnect}
                      disabled={isDisconnecting}
                      className="text-destructive hover:text-destructive flex-shrink-0"
                    >
                      {isDisconnecting ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : (
                        <Trash2 className="h-4 w-4" />
                      )}
                      <span className="ml-2 hidden sm:inline">Disconnect</span>
                    </Button>
                  )}
                </div>
              </CardContent>
            </Card>

            {/* Suspicious business name warning */}
            {connectionStatus.needs_business_name_change && (
              <Card className="border-destructive/50 bg-destructive/5">
                <CardContent className="pt-6">
                  <div className="flex items-start gap-3">
                    <ShieldAlert className="h-6 w-6 text-destructive flex-shrink-0 mt-0.5" />
                    <div className="flex-1">
                      <p className="font-semibold text-destructive text-base">
                        ⚠️ Your Stripe business name says &ldquo;{connectionStatus.display_name}&rdquo;
                      </p>
                      <p className="text-sm text-muted-foreground mt-1">
                        This looks wrong. Your Stripe account should have <strong>YOUR</strong> business name, not TidyWise&apos;s. 
                        This probably means you typed &ldquo;TidyWise&rdquo; during Stripe signup by mistake.
                      </p>
                      <p className="text-sm text-muted-foreground mt-2">
                        <strong>To fix it:</strong> go to your Stripe dashboard → Settings → Business → Public details 
                        and change the business name to your actual business.
                      </p>
                      <Button
                        size="sm"
                        variant="outline"
                        className="mt-3 gap-2"
                        onClick={() => openExternalUrl("https://dashboard.stripe.com/settings/business")}
                      >
                        <ExternalLink className="h-4 w-4" />
                        Open Stripe Settings
                      </Button>
                    </div>
                  </div>
                </CardContent>
              </Card>
            )}

            {/* Legacy upgrade prompt */}
            {connectionStatus.legacy && isOwner && (
              <Card className="border-warning/30 bg-warning/5">
                <CardContent className="pt-6">
                  <div className="flex items-start gap-3">
                    <AlertCircle className="h-5 w-5 text-warning flex-shrink-0 mt-0.5" />
                    <div className="flex-1">
                      <p className="font-semibold text-foreground">Upgrade to Stripe Connect (Recommended)</p>
                      <p className="text-sm text-muted-foreground mt-1">
                        You're currently using manual API keys. Upgrade to Stripe Connect OAuth for a more secure, one-click setup with automatic account management.
                      </p>
                      <Button
                        size="sm"
                        onClick={handleConnect}
                        disabled={isConnecting}
                        className="mt-3 bg-[#635BFF] hover:bg-[#5851DB] text-white gap-2"
                      >
                        {isConnecting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Zap className="h-4 w-4" />}
                        Upgrade to Connect
                      </Button>
                    </div>
                  </div>
                </CardContent>
              </Card>
            )}

            {/* Account Details */}
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Account Details</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="grid gap-3 sm:grid-cols-2">
                  <div className="p-3 rounded-lg bg-muted/50">
                    <p className="text-xs text-muted-foreground">Account Email</p>
                    <p className="font-medium text-sm mt-0.5">{connectionStatus.email || "—"}</p>
                  </div>
                  <div className="p-3 rounded-lg bg-muted/50">
                    <p className="text-xs text-muted-foreground">Business Name</p>
                    <p className="font-medium text-sm mt-0.5">{connectionStatus.display_name || "—"}</p>
                  </div>
                  <div className="p-3 rounded-lg bg-muted/50">
                    <p className="text-xs text-muted-foreground">Payouts</p>
                    <p className="font-medium text-sm mt-0.5">
                      {connectionStatus.payouts_enabled ? "✅ Enabled" : "⚠️ Not yet enabled"}
                    </p>
                  </div>
                  <div className="p-3 rounded-lg bg-muted/50">
                    <p className="text-xs text-muted-foreground">Currency</p>
                    <p className="font-medium text-sm mt-0.5 uppercase">{connectionStatus.default_currency || "usd"}</p>
                  </div>
                </div>
              </CardContent>
            </Card>

            {/* ═══════════════════════════════════════════ */}
            {/* My Personal Stripe Account */}
            {/* ═══════════════════════════════════════════ */}
            <Card>
              <CardHeader>
                <CardTitle className="text-base flex items-center gap-2">
                  <CreditCard className="h-4 w-4 text-[#635BFF]" />
                  My Personal Stripe Account
                </CardTitle>
                <CardDescription>Quick access to your Stripe dashboard and tools</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                {/* Quick access links */}
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                  {stripeLinks.map((link) => (
                    <a
                      key={link.label}
                      href={link.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center justify-center rounded-md border border-input bg-background hover:bg-accent hover:text-accent-foreground h-auto py-3 px-3 flex-col gap-1.5 text-center cursor-pointer"
                      onClick={(e) => {
                        if (Capacitor.isNativePlatform()) {
                          e.preventDefault();
                          openExternalUrl(link.url);
                        }
                      }}
                    >
                      <span className="text-lg">{link.emoji}</span>
                      <span className="text-xs font-medium leading-tight">{link.label}</span>
                    </a>
                  ))}
                </div>

                {/* Quick Charge Button */}
                <Button
                  className="w-full gap-2 bg-[#635BFF] hover:bg-[#5851DB] text-white"
                  onClick={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    setChargeOpen(true);
                  }}
                >
                  <Zap className="h-4 w-4" />
                  Charge a Card
                </Button>
              </CardContent>
            </Card>

            {/* Recent Manual Payments */}
            {recentPayments.length > 0 && (
              <Card>
                <CardHeader>
                  <CardTitle className="text-base flex items-center gap-2">
                    <DollarSign className="h-4 w-4 text-success" />
                    Recent Manual Charges
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="space-y-2">
                    {recentPayments.map((p) => (
                      <div key={p.id} className="flex items-center justify-between p-3 rounded-lg bg-muted/50">
                        <div className="min-w-0">
                          <p className="font-medium text-sm truncate">{p.customer_name}</p>
                          {p.description && (
                            <p className="text-xs text-muted-foreground truncate">{p.description}</p>
                          )}
                          <p className="text-xs text-muted-foreground mt-0.5">
                            <OrgTimestamp value={p.created_at} />
                          </p>
                        </div>
                        <div className="text-right shrink-0 ml-3">
                          <p className="font-semibold text-sm text-success">{fmt(p.amount)}</p>
                          {p.stripe_charge_id && (
                            <p className="text-[10px] text-muted-foreground font-mono truncate max-w-[100px]">
                              {p.stripe_charge_id.slice(0, 16)}...
                            </p>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                </CardContent>
              </Card>
            )}
          </>
        ) : !isOwner ? (
          <Card className="border-warning/30 bg-warning/5">
            <CardContent className="pt-6">
              <div className="flex items-start gap-3">
                <AlertCircle className="h-5 w-5 text-warning flex-shrink-0 mt-0.5" />
                <div>
                  <p className="font-semibold text-foreground">Stripe isn't connected yet</p>
                  <p className="text-sm text-muted-foreground mt-1">
                    Only the workspace owner can connect this organization's Stripe
                    account. Ask an owner to open Payment Integration and finish setup.
                    Once connected, you'll be able to charge saved cards using the
                    workspace's Stripe account. You don't need your own.
                  </p>
                </div>
              </div>
            </CardContent>
          </Card>
        ) : (
          <>
            {/* Pre-connect warning */}
            <Card className="border-warning/30 bg-warning/5">
              <CardContent className="pt-6">
                <div className="flex items-start gap-3">
                  <AlertTriangle className="h-6 w-6 text-warning flex-shrink-0 mt-0.5" />
                  <div>
                    <p className="font-semibold text-foreground">Before you connect: this must be YOUR Stripe account</p>
                    <ul className="text-sm text-muted-foreground mt-2 space-y-1.5">
                      <li>✕ Do NOT connect the TidyWise platform&apos;s Stripe account</li>
                      <li>✓ You need your OWN Stripe account with your business name, EIN, and bank account</li>
                      <li className="font-bold text-foreground">✓ If you don&apos;t have one yet, create it at <a href="https://dashboard.stripe.com/register" target="_blank" rel="noopener noreferrer" className="text-primary underline hover:no-underline">dashboard.stripe.com/register</a> first</li>
                      <li>✓ During Stripe signup, enter YOUR business name — NOT &ldquo;TidyWise&rdquo;</li>
                      <li>✓ All charges will go directly to YOUR bank account</li>
                    </ul>
                  </div>
                </div>
              </CardContent>
            </Card>

            {/* Connect Button - Hero Card */}
            <Card className="border-[#635BFF]/30 overflow-hidden">
              <div className="bg-gradient-to-br from-[#635BFF]/10 to-[#635BFF]/5 p-8 text-center">
                <div className="mx-auto w-16 h-16 rounded-2xl bg-[#635BFF] flex items-center justify-center mb-4">
                  <CreditCard className="h-8 w-8 text-white" />
                </div>
                <h2 className="text-2xl font-bold text-foreground mb-2">Connect with Stripe</h2>
                <p className="text-muted-foreground mb-6 max-w-md mx-auto">
                  Connect your Stripe account in one click — no API keys needed. Start accepting credit cards, Apple Pay, and bank transfers.
                </p>
                <Button
                  size="lg"
                  onClick={handleConnect}
                  disabled={isConnecting}
                  className="bg-[#635BFF] hover:bg-[#5851DB] text-white px-8 py-3 text-base font-semibold gap-2"
                >
                  {isConnecting ? (
                    <Loader2 className="h-5 w-5 animate-spin" />
                  ) : (
                    <Zap className="h-5 w-5" />
                  )}
                  {isConnecting ? "Connecting..." : "Connect with Stripe"}
                </Button>
                <p className="text-xs text-muted-foreground mt-3">
                  Already have a Stripe account? You&apos;ll be asked to log in — no need to create a new one.
                </p>
              </div>
            </Card>

            {/* Manual API Key Entry */}
            <Card className="border-border">
              <CardContent className="pt-6">
                <div className="flex items-start gap-3">
                  <CreditCard className="h-5 w-5 text-muted-foreground flex-shrink-0 mt-0.5" />
                  <div className="flex-1">
                    <p className="font-semibold text-foreground">Use API Keys Instead</p>
                    <p className="text-sm text-muted-foreground mt-1">
                      If you're the platform owner or Connect isn't working, you can enter your Stripe API keys directly.
                    </p>
                    {!showManualKeys ? (
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => setShowManualKeys(true)}
                        className="mt-3 gap-2"
                      >
                        <CreditCard className="h-4 w-4" />
                        Enter API Keys
                      </Button>
                    ) : (
                      <div className="mt-4 space-y-3">
                        <div>
                          <Label>Secret Key <span className="text-destructive">*</span></Label>
                          <Input
                            type="password"
                            placeholder="sk_live_..."
                            value={manualSecretKey}
                            onChange={(e) => setManualSecretKey(e.target.value)}
                          />
                          <p className="text-xs text-muted-foreground mt-1">
                            Found in your{" "}
                            <a href="https://dashboard.stripe.com/apikeys" target="_blank" rel="noopener noreferrer" className="text-primary hover:underline">
                              Stripe Dashboard → API Keys
                            </a>
                          </p>
                          <p className="text-xs text-muted-foreground mt-1">
                            Use the Secret key only — management keys (mk_...) and publishable keys (pk_...) will be rejected.
                          </p>
                        </div>
                        <div>
                          <Label>Publishable Key (optional)</Label>
                          <Input
                            placeholder="pk_live_..."
                            value={manualPublishableKey}
                            onChange={(e) => setManualPublishableKey(e.target.value)}
                          />
                        </div>

                        {/* Ownership confirmation checkbox */}
                        <div className="flex items-start gap-3 p-3 rounded-lg border border-border bg-muted/30">
                          <Checkbox
                            id="confirm-ownership"
                            checked={confirmedOwnership}
                            onCheckedChange={(v) => setConfirmedOwnership(v === true)}
                            className="mt-0.5"
                          />
                          <label htmlFor="confirm-ownership" className="text-sm cursor-pointer">
                            <span className="font-medium text-foreground">I confirm this is MY Stripe account</span>
                            <p className="text-xs text-muted-foreground mt-1">
                              I am the legal owner of the Stripe account I&apos;m connecting. The business name, 
                              EIN/SSN, and bank account belong to my business, not to TidyWise or any other company.
                            </p>
                          </label>
                        </div>

                        <div className="flex gap-2 pt-1">
                          <Button
                            onClick={handleSaveManualKeys}
                            disabled={savingKeys || !manualSecretKey.trim() || !confirmedOwnership}
                            className="gap-2 bg-[#635BFF] hover:bg-[#5851DB] text-white"
                          >
                            {savingKeys ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}
                            {savingKeys ? "Validating..." : "Connect My Stripe Account"}
                          </Button>
                          <Button variant="ghost" onClick={() => { setShowManualKeys(false); setManualSecretKey(""); setManualPublishableKey(""); setConfirmedOwnership(false); }}>
                            Cancel
                          </Button>
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              </CardContent>
            </Card>

            {/* How it works */}
            <Card>
              <CardHeader>
                <CardTitle className="text-base">How it works</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                {[
                  { step: "1", title: "Click Connect", desc: "You'll be redirected to Stripe's secure login page" },
                  { step: "2", title: "Log in or sign up", desc: "Use your existing Stripe account or create a new one for free" },
                  { step: "3", title: "Authorize TidyWise", desc: "Grant permission to process payments on your behalf" },
                  { step: "4", title: "Start accepting payments", desc: "Payments go directly to your Stripe account. TidyWise takes no cut." },
                ].map((item) => (
                  <div key={item.step} className="flex gap-4 p-3 rounded-lg bg-secondary/30 border border-border/50">
                    <div className="flex-shrink-0 w-8 h-8 rounded-full bg-primary text-primary-foreground flex items-center justify-center text-sm font-bold">
                      {item.step}
                    </div>
                    <div>
                      <p className="font-semibold text-foreground">{item.title}</p>
                      <p className="text-sm text-muted-foreground mt-0.5">{item.desc}</p>
                    </div>
                  </div>
                ))}
              </CardContent>
            </Card>
          </>
        )}

        {/* What you can accept */}
        <Card className="bg-secondary/30">
          <CardContent className="pt-6">
            <div className="flex items-start gap-3">
              <CheckCircle2 className="h-5 w-5 text-success flex-shrink-0 mt-0.5" />
              <div>
                <p className="font-semibold text-foreground">What You Can Accept with Stripe</p>
                <ul className="text-sm text-muted-foreground mt-2 space-y-1">
                  <li>• Credit & debit cards (Visa, Mastercard, Amex, etc.)</li>
                  <li>• Apple Pay & Google Pay</li>
                  <li>• ACH bank transfers</li>
                  <li>• Recurring subscriptions</li>
                  <li>• Automatic payouts to your bank account</li>
                  <li>• Built-in fraud protection</li>
                </ul>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Help */}
        <Card className="border-primary/20 bg-primary/5">
          <CardContent className="pt-6">
            <div className="flex items-start gap-4">
              <div className="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center flex-shrink-0">
                <CreditCard className="h-5 w-5 text-primary" />
              </div>
              <div>
                <h3 className="font-semibold text-foreground">Need Help?</h3>
                <p className="text-sm text-muted-foreground mt-1">
                  Having trouble connecting Stripe? Contact us at{" "}
                  <a href="mailto:support@tidywisecleaning.com" className="text-primary hover:underline">
                    support@tidywisecleaning.com
                  </a>
                </p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Charge Card Modal */}
      <Dialog open={chargeOpen} onOpenChange={setChargeOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Zap className="h-5 w-5 text-[#635BFF]" />
              Charge a Card
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div>
              <Label>Customer Name</Label>
              <Input
                placeholder="e.g. John Smith"
                value={chargeName}
                onChange={(e) => setChargeName(e.target.value)}
              />
            </div>
            <div>
              <Label>Amount ($)</Label>
              <Input
                type="number"
                step="0.01"
                min="0.50"
                placeholder="0.00"
                value={chargeAmount}
                onChange={(e) => setChargeAmount(e.target.value)}
              />
            </div>
            <div>
              <Label>Description (optional)</Label>
              <Textarea
                placeholder="e.g. Deep cleaning service"
                value={chargeDesc}
                onChange={(e) => setChargeDesc(e.target.value)}
                rows={2}
                className="resize-none"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setChargeOpen(false)}>Cancel</Button>
            <Button
              onClick={handleChargeCard}
              disabled={charging || !chargeName.trim() || !chargeAmount || parseFloat(chargeAmount) < 0.5}
              className="gap-2 bg-[#635BFF] hover:bg-[#5851DB] text-white"
            >
              {charging ? <Loader2 className="h-4 w-4 animate-spin" /> : <Zap className="h-4 w-4" />}
              {charging ? "Processing..." : `Charge $${chargeAmount ? parseFloat(chargeAmount).toFixed(2) : "0.00"}`}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={disconnectConfirmOpen} onOpenChange={setDisconnectConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Disconnect Stripe?</AlertDialogTitle>
            <AlertDialogDescription>
              This will disable all payment features for your organization. You can reconnect at any time.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={executeDisconnect}
            >
              Disconnect
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
</AdminLayout>
  );
}
