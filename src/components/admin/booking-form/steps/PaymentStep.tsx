import { useState, useMemo, useEffect, useRef, useCallback } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Separator } from '@/components/ui/separator';
import { Badge } from '@/components/ui/badge';
import { 
  CreditCard, 
  FileText, 
  Loader2, 
  CheckCircle, 
  AlertCircle, 
  RefreshCw,
  User,
  DollarSign,
  Phone,
  Tag,
  X,
  Save
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { supabase } from '@/lib/supabase';
import { readEdgeFunctionError } from '@/lib/edgeFunctionError';
import { toast } from 'sonner';
import { invokeSmsFunction } from '@/lib/smsErrorHandler';
import { StripeCardForm } from '@/components/stripe/StripeCardForm';
import { Capacitor } from '@capacitor/core';
import { useOrgId } from '@/hooks/useOrgId';
import { computeExpectedPay, syncCleanerPayShare } from '@/lib/cleanerPay';
import { useBookingForm } from '../BookingFormContext';
import { useDiscounts } from '@/hooks/useDiscounts';
import { useOrganizationSettings } from '@/hooks/useOrganizationSettings';
import { preloadStripeModules } from '@/lib/stripe';
import { useAuth } from '@/hooks/useAuth';
import { fmt } from '@/lib/activeCurrency';
import { mustAffectRows } from '@/lib/mustAffectRows';
import { CustomerNotesBlock } from '@/components/CustomerNotesBlock';
import { Checkbox } from '@/components/ui/checkbox';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { mirroredCleanerWage, teamSummary, teamFieldsForSave } from '@/lib/teamJobs';

// computeExpectedPay now lives in @/lib/cleanerPay (shared across all pay write sites).

export function PaymentStep() {
  const {
    editingBookingId,
    notes,
    customerNotes,
    setNotes,
    cleanerWage,
    setCleanerWage,
    cleanerWageType,
    setCleanerWageType,
    cleanerOverrideHours,
    setCleanerOverrideHours,
    teamNeeded,
    setTeamNeeded,
    teamCount,
    setTeamCount,
    teamPay,
    setTeamPay,
    teamPayType,
    setTeamPayType,
    cardInfo,
    setCardInfo,
    loadingCard,
    loadCardInfo,
    customerEmail,
    customerName,
    selectedService,
    totalAmount,
    setTotalAmount,
    customerTab,
    selectedCustomer,
    newCustomer,
    calculatedPrice,
    finalPrice,
    appliedDiscount,
    setAppliedDiscount,
    isTeamMode,
    selectedTeamMembers,
    teamMemberPay,
    staff,
  } = useBookingForm();

  const { organizationId } = useOrgId();
  const { user } = useAuth();
  const { validateCoupon, calculateDiscountAmount } = useDiscounts();
  const { settings: orgSettings } = useOrganizationSettings();

  const [sendingLinkSms, setSendingLinkSms] = useState(false);
  const [chargeError, setChargeError] = useState<string | null>(null);
  const [couponCode, setCouponCode] = useState('');
  const [validatingCoupon, setValidatingCoupon] = useState(false);
  const [couponError, setCouponError] = useState<string | null>(null);
  const [paymentCollectionMethod, setPaymentCollectionMethod] = useState<'card' | 'in_person'>('card');
  const [stripeConfigured, setStripeConfigured] = useState<boolean | null>(null);

  // Check if Stripe is configured for this org
  useEffect(() => {
    if (!organizationId) return;
    let cancelled = false;
    supabase
      .rpc('get_org_stripe_settings_safe', { p_organization_id: organizationId })
      .then(({ data: rows }) => {
        if (!cancelled) setStripeConfigured(!!rows?.[0]?.is_connected);
      });
    return () => { cancelled = true; };
  }, [organizationId]);
  
  // Autosave state for cleaner pay
  const [paySaveStatus, setPaySaveStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Pre-load Stripe modules when payment step is rendered
  useEffect(() => {
    preloadStripeModules();
  }, []);

  // Compute expected pay from current form values
  const computedExpectedPay = useMemo(() => {
    const base = finalPrice > 0 ? finalPrice : (totalAmount > 0 ? totalAmount : calculatedPrice);
    return computeExpectedPay(
      cleanerWageType,
      cleanerWage,
      cleanerOverrideHours,
      selectedService?.duration || 60,
      base,
    );
  }, [cleanerWageType, cleanerWage, cleanerOverrideHours, selectedService, finalPrice, totalAmount, calculatedPrice]);

  // Autosave cleaner pay to DB when editing an existing booking (debounced 500ms)
  const autosavePayToDb = useCallback(async () => {
    if (!editingBookingId) return; // Only autosave for existing bookings
    
    const base = finalPrice > 0 ? finalPrice : (totalAmount > 0 ? totalAmount : calculatedPrice);
    const wage = mirroredCleanerWage(teamNeeded, teamPay, teamPayType, cleanerWage, cleanerWageType);
    const expectedPay = computeExpectedPay(
      wage.wageType,
      wage.wage,
      cleanerOverrideHours,
      selectedService?.duration || 60,
      base,
    );

    setPaySaveStatus('saving');
    try {
      await mustAffectRows(
        supabase
          .from('bookings')
          .update({
            cleaner_wage: wage.wage ? parseFloat(wage.wage) : null,
            cleaner_wage_type: wage.wageType,
            cleaner_override_hours: cleanerOverrideHours ? parseFloat(cleanerOverrideHours) : null,
            cleaner_pay_expected: expectedPay,
            ...teamFieldsForSave(teamNeeded, teamCount, teamPay, teamPayType),
            pay_last_saved_at: new Date().toISOString(),
            pay_last_saved_by: user?.id || null,
          })
          .eq('id', editingBookingId),
        'Cleaner pay not saved. This booking was not writable.',
        { table: 'bookings' },
      );

      await syncCleanerPayShare(editingBookingId, organizationId, expectedPay);
      setPaySaveStatus('saved');
      // Reset to idle after 3 seconds
      setTimeout(() => setPaySaveStatus((prev) => prev === 'saved' ? 'idle' : prev), 3000);
    } catch (err) {
      console.error('Failed to autosave cleaner pay:', err);
      setPaySaveStatus('error');
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps -- organizationId is stable per session; including it would not change behavior
  }, [editingBookingId, cleanerWage, cleanerWageType, cleanerOverrideHours, teamNeeded, teamCount, teamPay, teamPayType, selectedService, finalPrice, totalAmount, calculatedPrice, user?.id]);

  // Trigger debounced save when pay fields change
  useEffect(() => {
    if (!editingBookingId) return;
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(() => {
      autosavePayToDb();
    }, 500);
    return () => {
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    };
  }, [cleanerWage, cleanerWageType, cleanerOverrideHours, editingBookingId, autosavePayToDb]);

  // Get customer phone
  const customerPhone = customerTab === 'existing' && selectedCustomer 
    ? selectedCustomer.phone 
    : newCustomer.phone;

  // Use override amount if set, otherwise use calculated price
  const effectiveAmount = totalAmount > 0 ? totalAmount : calculatedPrice;

  // Calculate with proper order: Subtotal → Discount → Tax → Total
  const pricingBreakdown = useMemo(() => {
    const subtotal = effectiveAmount;
    const discountAmount = appliedDiscount?.discountAmount || 0;
    const discountedSubtotal = Math.max(0, subtotal - discountAmount);
    const taxRate = orgSettings?.sales_tax_percent || 0;
    const taxAmount = taxRate > 0 ? (discountedSubtotal * taxRate) / 100 : 0;
    const grandTotal = discountedSubtotal + taxAmount;
    
    return {
      subtotal,
      discountAmount,
      discountedSubtotal,
      taxRate,
      taxAmount,
      grandTotal,
    };
  }, [effectiveAmount, appliedDiscount, orgSettings]);

  const handleApplyCoupon = async () => {
    if (!couponCode.trim()) {
      setCouponError('Please enter a coupon code');
      return;
    }

    setValidatingCoupon(true);
    setCouponError(null);

    try {
      const discount = await validateCoupon(couponCode.trim(), effectiveAmount);
      
      if (!discount) {
        setCouponError('Invalid or expired coupon code');
        return;
      }

      const discountAmount = calculateDiscountAmount(discount, effectiveAmount);
      
      setAppliedDiscount({
        id: discount.id,
        code: discount.code,
        discount_type: discount.discount_type,
        discount_value: discount.discount_value,
        discountAmount,
      });
      
      setCouponCode('');
      toast.success(`Coupon applied! You saved ${fmt(discountAmount)}`);
    } catch (error) {
      setCouponError('Failed to validate coupon');
    } finally {
      setValidatingCoupon(false);
    }
  };

  const handleRemoveCoupon = () => {
    setAppliedDiscount(null);
    toast.info('Coupon removed');
  };

  const handleSendPaymentLinkSms = async () => {
    if (!customerPhone || !customerName) {
      toast.error('Please enter customer phone number and name first');
      return;
    }

    const amountToCharge = pricingBreakdown.grandTotal;
    if (!amountToCharge || amountToCharge <= 0) {
      toast.error('Please select a service and property details to calculate the price');
      return;
    }

    setSendingLinkSms(true);
    try {
      const result = await invokeSmsFunction(supabase, 'send-card-link-sms', {
        phone: customerPhone,
        email: customerEmail,
        customerName,
        organizationId: organizationId ?? undefined,
        amount: amountToCharge,
      });

      if (!result.success) return;
      toast.success(`Payment link for ${fmt(amountToCharge)} sent via SMS`);
    } catch (error: any) {
      toast.error(error.message || 'Failed to send payment link via SMS');
    } finally {
      setSendingLinkSms(false);
    }
  };

  const handleCardSaved = (info: { last4: string; brand: string; paymentMethodId: string }) => {
    setCardInfo({
      hasCard: true,
      last4: info.last4,
      brand: info.brand,
      paymentMethodId: info.paymentMethodId,
    });
    toast.success(`Card saved: ${info.brand} ending in ${info.last4}`);
  };

  const [removingCard, setRemovingCard] = useState(false);

  const handleRemoveCard = async () => {
    if (!customerEmail || !organizationId || !cardInfo?.paymentMethodId) {
      toast.error('Cannot remove card: missing information');
      return;
    }
    setRemovingCard(true);
    try {
      const { data: session } = await supabase.auth.getSession();
      const { data, error } = await supabase.functions.invoke('remove-customer-card', {
        body: {
          email: customerEmail,
          organizationId,
          paymentMethodId: cardInfo.paymentMethodId,
        },
        headers: {
          Authorization: `Bearer ${session?.session?.access_token}`,
        },
      });
      if (error) throw error;
      if (!data?.success) throw new Error(data?.error || 'Failed to remove card');

      // Reset state to null, then re-fetch fresh from Stripe
      setCardInfo(null);
      toast.success('Card removed successfully');
      // Force re-fetch to get fresh state from Stripe
      await loadCardInfo(customerEmail);
    } catch (err: any) {
      console.error('Failed to remove card:', err);
      toast.error(await readEdgeFunctionError(err, 'Failed to remove card'));
    } finally {
      setRemovingCard(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3 mb-6">
        <div className="p-3 rounded-xl bg-gradient-to-br from-rose-500/20 to-rose-600/10">
          <CreditCard className="h-6 w-6 text-rose-600 dark:text-rose-400" />
        </div>
        <div>
          <h3 className="text-lg font-semibold">Payment & Notes</h3>
          <p className="text-sm text-muted-foreground">Manage payment method and add notes</p>
        </div>
      </div>

      {/* Notes Section */}
      <Card className="border-border/50 shadow-sm">
        <CardContent className="pt-6">
          {/* Above the field, not below: it is context for what the admin is
              about to type. Read-only — the customer's words, and the save path
              writes `notes` only. Renders nothing when there is no note, which
              is most bookings. */}
          <CustomerNotesBlock value={customerNotes} className="mb-4" />
          <div className="flex items-center gap-2 mb-4">
            <FileText className="h-4 w-4 text-muted-foreground" />
            <Label className="text-sm font-medium">Special Instructions</Label>
          </div>
          <Textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="Any special instructions, access codes, pet info, areas to focus on..."
            rows={4}
            className="bg-secondary/30 border-border/50 resize-none"
          />
        </CardContent>
      </Card>

      {/* Discount Code Section */}
      <Card className="border-border/50 shadow-sm">
        <CardContent className="pt-6">
          <div className="flex items-center gap-2 mb-4">
            <Tag className="h-4 w-4 text-muted-foreground" />
            <Label className="text-sm font-medium">Discount Code</Label>
          </div>
          
          {appliedDiscount ? (
            <div className="flex items-center justify-between p-4 bg-success/10 rounded-xl border border-success/20">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-full bg-success/15 flex items-center justify-center">
                  <CheckCircle className="h-5 w-5 text-success" />
                </div>
                <div>
                  <p className="font-medium text-success">
                    {appliedDiscount.code}
                  </p>
                  <p className="text-xs text-success">
                    {appliedDiscount.discount_type === 'percentage' 
                      ? `${appliedDiscount.discount_value}% off` 
                      : `$${appliedDiscount.discount_value} off`}
                    {' '}- Saving ${appliedDiscount.discountAmount.toFixed(2)}
                  </p>
                </div>
              </div>
              <Button
                variant="ghost"
                size="sm"
                onClick={handleRemoveCoupon}
                className="h-9 w-9 p-0 text-destructive hover:text-destructive"
              >
                <X className="h-4 w-4" />
              </Button>
            </div>
          ) : (
            <div className="space-y-3">
              <div className="flex gap-2">
                <Input
                  value={couponCode}
                  onChange={(e) => {
                    setCouponCode(e.target.value.toUpperCase());
                    setCouponError(null);
                  }}
                  placeholder="Enter coupon code"
                  className="h-11 bg-secondary/30 border-border/50 uppercase"
                />
                <Button
                  onClick={handleApplyCoupon}
                  disabled={validatingCoupon || !couponCode.trim()}
                  className="h-11 px-6"
                >
                  {validatingCoupon ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    'Apply'
                  )}
                </Button>
              </div>
              {couponError && (
                <p className="text-sm text-destructive flex items-center gap-1">
                  <AlertCircle className="h-4 w-4" />
                  {couponError}
                </p>
              )}
            </div>
          )}
          
          {/* Price Summary with Tax + Discount */}
          {pricingBreakdown.subtotal > 0 && (
            <div className="mt-4 pt-4 border-t border-border/50 space-y-2">
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">Subtotal</span>
                <span>{fmt(pricingBreakdown.subtotal)}</span>
              </div>
              {appliedDiscount && (
                <div className="flex justify-between text-sm text-success">
                  <span>Discount ({appliedDiscount.code})</span>
                  <span>-${pricingBreakdown.discountAmount.toFixed(2)}</span>
                </div>
              )}
              {appliedDiscount && pricingBreakdown.taxRate > 0 && (
                <div className="flex justify-between text-sm text-muted-foreground">
                  <span>Discounted Subtotal</span>
                  <span>{fmt(pricingBreakdown.discountedSubtotal)}</span>
                </div>
              )}
              {pricingBreakdown.taxRate > 0 && (
                <div className="flex justify-between text-sm">
                  <span className="text-muted-foreground">Sales Tax ({pricingBreakdown.taxRate}%)</span>
                  <span>{fmt(pricingBreakdown.taxAmount)}</span>
                </div>
              )}
              <div className="flex justify-between font-semibold text-lg pt-2 border-t border-border/30">
                <span>Grand Total</span>
                <span className={appliedDiscount ? 'text-success' : ''}>
                  ${pricingBreakdown.grandTotal.toFixed(2)}
                </span>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Adjust Price Override */}
      <Card className="border-border/50 shadow-sm">
        <CardContent className="pt-6">
          <div className="flex items-center gap-2 mb-4">
            <DollarSign className="h-4 w-4 text-muted-foreground" />
            <Label className="text-sm font-medium">Adjust Price (Override)</Label>
          </div>
          <Input
            type="number"
            step="0.01"
            min="0"
            placeholder="Leave empty to use calculated price"
            value={totalAmount > 0 ? totalAmount : ''}
            onChange={(e) => setTotalAmount(parseFloat(e.target.value) || 0)}
            className="h-11 bg-secondary/30 border-border/50"
          />
          <p className="text-xs text-muted-foreground mt-2">
            Enter a value only if you want to override the calculated price
          </p>
        </CardContent>
      </Card>

      {/* Cleaner Payment Section - Only show if NOT in team mode */}
      {!(isTeamMode && selectedTeamMembers.length > 0) && (
        <Card className="border-border/50 shadow-sm">
          <CardContent className="pt-6">
            <div className="flex items-center gap-2 mb-4">
              <DollarSign className="h-4 w-4 text-muted-foreground" />
              <Label className="text-sm font-medium">Cleaner Payment (Optional)</Label>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label className="text-xs text-muted-foreground">Payment Type</Label>
                <Select value={cleanerWageType} onValueChange={setCleanerWageType}>
                  <SelectTrigger className="mt-2 h-11 bg-secondary/30 border-border/50" aria-label="Cleaner payment type">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent className="bg-popover border-border">
                    <SelectItem value="hourly">Hourly Rate</SelectItem>
                    <SelectItem value="flat">Flat Rate</SelectItem>
                    <SelectItem value="percentage">Percentage</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label className="text-xs text-muted-foreground">
                  {cleanerWageType === 'hourly' ? 'Hourly Rate ($)' : 
                   cleanerWageType === 'flat' ? 'Flat Amount ($)' : 'Percentage (%)'}
                </Label>
                <Input
                  type="number"
                  value={cleanerWage}
                  onChange={(e) => setCleanerWage(e.target.value)}
                  placeholder="0.00"
                  className="mt-2 h-11 bg-secondary/30 border-border/50"
                />
              </div>
            </div>
            
            {cleanerWageType === 'hourly' && (
              <div className="mt-4">
                <Label className="text-xs text-muted-foreground">Override Hours</Label>
                <Input
                  type="number"
                  value={cleanerOverrideHours}
                  onChange={(e) => setCleanerOverrideHours(e.target.value)}
                  placeholder="Default: 5.0 hrs"
                  className="mt-2 h-11 bg-secondary/30 border-border/50"
                />
              </div>
            )}

            {/* Team job: several cleaners can claim this booking */}
            <div className="mt-4 rounded-lg border border-border/50 p-3 space-y-3">
              <label className="flex items-center gap-3 min-h-11 cursor-pointer">
                <Checkbox
                  checked={teamNeeded}
                  onCheckedChange={(v) => setTeamNeeded(v === true)}
                  aria-label="Team needed"
                />
                <span className="text-sm font-medium">Team needed</span>
              </label>
              {teamNeeded && (
                <>
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <Label className="text-xs text-muted-foreground">Number of cleaners</Label>
                      <Select value={String(teamCount)} onValueChange={(v) => setTeamCount(Number(v))}>
                        <SelectTrigger className="mt-2 h-11 bg-secondary/30 border-border/50" aria-label="Number of cleaners">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent className="bg-popover border-border">
                          {[2, 3, 4, 5, 6].map((n) => (
                            <SelectItem key={n} value={String(n)}>{n} cleaners</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <div>
                      <Label className="text-xs text-muted-foreground">
                        {teamPayType === 'hourly' ? 'Pay per cleaner ($/hr)' : 'Pay per cleaner ($)'}
                      </Label>
                      <Input
                        type="number"
                        min="0"
                        inputMode="decimal"
                        value={teamPay}
                        onChange={(e) => setTeamPay(e.target.value)}
                        placeholder="0.00"
                        className="mt-2 h-11 bg-secondary/30 border-border/50"
                        aria-label="Pay per cleaner"
                      />
                    </div>
                  </div>
                  <ToggleGroup
                    type="single"
                    value={teamPayType}
                    onValueChange={(v) => v && setTeamPayType(v as 'flat' | 'hourly')}
                    className="justify-start"
                    aria-label="Team pay type"
                  >
                    <ToggleGroupItem value="flat" className="h-11 px-4">Flat</ToggleGroupItem>
                    <ToggleGroupItem value="hourly" className="h-11 px-4">Hourly</ToggleGroupItem>
                  </ToggleGroup>
                  <p className="text-sm text-muted-foreground">
                    {teamSummary(teamFieldsForSave(true, teamCount, teamPay, teamPayType))}
                  </p>
                </>
              )}
            </div>

            {/* Save Status Indicator */}
            {editingBookingId && paySaveStatus !== 'idle' && (
              <div className="mt-3 flex items-center gap-2 text-xs">
                {paySaveStatus === 'saving' && (
                  <><Loader2 className="h-3 w-3 animate-spin text-muted-foreground" /><span className="text-muted-foreground">Saving…</span></>
                )}
                {paySaveStatus === 'saved' && (
                  <><CheckCircle className="h-3 w-3 text-success" /><span className="text-success">Saved ✓</span></>
                )}
                {paySaveStatus === 'error' && (
                  <><AlertCircle className="h-3 w-3 text-destructive" /><span className="text-destructive">Error saving</span>
                    <Button variant="ghost" size="sm" className="h-6 px-2 text-xs" onClick={autosavePayToDb}>Retry</Button>
                  </>
                )}
              </div>
            )}

            {cleanerWage && (
              <div className="mt-4 p-4 bg-success/10 rounded-xl border border-success/20">
                <p className="text-xs text-success">Estimated Cleaner Pay</p>
                <p className="text-xl font-bold text-success">
                  ${computedExpectedPay != null ? computedExpectedPay.toFixed(2) : '0.00'}
                </p>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* Team Mode Pay Summary */}
      {isTeamMode && selectedTeamMembers.length > 0 && (
        <Card className="border-border/50 shadow-sm">
          <CardContent className="pt-6">
            <div className="flex items-center gap-2 mb-4">
              <DollarSign className="h-4 w-4 text-muted-foreground" />
              <Label className="text-sm font-medium">Team Pay Summary</Label>
            </div>
            <div className="space-y-2">
              {selectedTeamMembers.map((staffId, index) => {
                const staffMember = staff?.find(s => s.id === staffId);
                const pay = teamMemberPay[staffId] || 0;
                return (
                  <div key={staffId} className="flex items-center justify-between p-3 bg-secondary/30 rounded-lg">
                    <div className="flex items-center gap-2">
                      {index === 0 && (
                        <Badge className="bg-primary text-primary-foreground text-xs">Lead</Badge>
                      )}
                      <span className="font-medium">{staffMember?.name || 'Unknown'}</span>
                    </div>
                    <span className="font-semibold text-success">
                      ${pay.toFixed(2)}
                    </span>
                  </div>
                );
              })}
              <div className="flex justify-between pt-2 border-t border-border/50 font-semibold">
                <span>Total Team Pay</span>
                <span className="text-success">
                  ${Object.values(teamMemberPay).reduce((sum, pay) => sum + pay, 0).toFixed(2)}
                </span>
              </div>
            </div>
            <p className="text-xs text-muted-foreground mt-3">
              Individual pay was set in the Schedule step. Each cleaner will see their assigned amount.
            </p>
          </CardContent>
        </Card>
      )}

      {/* Payment Card Section */}
      <Card className="border-border/50 shadow-sm">
        <CardContent className="pt-6">
          <div className="flex items-center gap-2 mb-4">
            <CreditCard className="h-4 w-4 text-muted-foreground" />
            <Label className="text-sm font-medium">Customer Payment Method</Label>
          </div>

          {/* Payment collection method toggle */}
          <div className="flex gap-2 mb-4">
            <Button
              type="button"
              variant={paymentCollectionMethod === 'card' ? 'default' : 'outline'}
              size="sm"
              onClick={() => setPaymentCollectionMethod('card')}
              className="flex-1"
            >
              <CreditCard className="h-4 w-4 mr-2" />
              Card on File
            </Button>
            <Button
              type="button"
              variant={paymentCollectionMethod === 'in_person' ? 'default' : 'outline'}
              size="sm"
              onClick={() => setPaymentCollectionMethod('in_person')}
              className="flex-1"
            >
              <DollarSign className="h-4 w-4 mr-2" />
              In-Person Payment
            </Button>
          </div>

          {paymentCollectionMethod === 'in_person' ? (
            <div className="flex items-center gap-3 p-4 bg-info/10 rounded-xl border border-info/20">
              <div className="w-10 h-10 rounded-full bg-info/15 flex items-center justify-center flex-shrink-0">
                <DollarSign className="h-5 w-5 text-info" />
              </div>
              <div>
                <p className="font-medium text-info">In-Person Payment</p>
                <p className="text-xs text-info">
                  Payment will be collected in person (cash, Venmo, Zelle, etc.). No card on file required.
                </p>
              </div>
            </div>
          ) : stripeConfigured === false ? (
            <div className="space-y-3">
              <div className="flex items-center gap-3 p-4 bg-warning/10 rounded-xl border border-warning/20">
                <AlertCircle className="h-5 w-5 text-warning flex-shrink-0" />
                <div>
                  <p className="font-medium text-warning">Stripe Not Connected</p>
                  <p className="text-xs text-warning">
                    To save cards on file, connect your Stripe account in Settings → Payment Integration. Or use "In-Person Payment" to skip card collection.
                  </p>
                </div>
              </div>
            </div>
          ) : loadingCard ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="h-6 w-6 animate-spin text-primary" />
            </div>
          ) : cardInfo?.hasCard ? (
            <div className="space-y-4">
              <div className="flex items-center justify-between p-4 bg-success/10 rounded-xl border border-success/20">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-full bg-success/15 flex items-center justify-center">
                    <CheckCircle className="h-5 w-5 text-success" />
                  </div>
                  <div>
                    <p className="font-medium capitalize text-success">
                      {cardInfo.brand} •••• {cardInfo.last4}
                    </p>
                    <p className="text-xs text-success">
                      Expires {cardInfo.expMonth}/{cardInfo.expYear}
                    </p>
                  </div>
                </div>
                <div className="flex gap-2">
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => loadCardInfo(customerEmail)}
                    className="h-9 w-9 p-0"
                    title="Refresh card"
                  >
                    <RefreshCw className="h-4 w-4" />
                  </Button>
                  <Button
                    variant="destructive"
                    size="sm"
                    onClick={handleRemoveCard}
                    disabled={removingCard}
                    className="text-xs"
                  >
                    {removingCard ? <Loader2 className="h-3 w-3 animate-spin mr-1" /> : null}
                    Remove Card
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setCardInfo({ hasCard: false })}
                    className="text-xs"
                  >
                    Add New Card
                  </Button>
                </div>
              </div>
            </div>
          ) : customerEmail ? (
            <div className="space-y-4">
              <div className="flex items-center gap-2 p-4 bg-warning/10 border border-warning/20 rounded-xl text-warning">
                <AlertCircle className="h-5 w-5 flex-shrink-0" />
                <p className="text-sm">No card on file for this customer</p>
              </div>

              <Separator />

              <div className="space-y-3">
                <p className="text-sm font-medium">Add Card Now</p>
                {/* Card entry works on native too: Stripe Elements runs fine in
                    the Capacitor WebView, and Apple rule 3.1.1 (IAP) does NOT
                    apply — cleaning is a physical service (3.1.3(e)), same as
                    Uber/DoorDash collecting cards in-app. */}
                <StripeCardForm
                  email={customerEmail}
                  customerName={customerName}
                  organizationId={organizationId || ''}
                  onCardSaved={handleCardSaved}
                  onError={(error) => setChargeError(error)}
                  showHoldOption={true}
                  defaultHoldAmount={pricingBreakdown.grandTotal || 50}
                />
              </div>

              <div className="relative">
                <div className="absolute inset-0 flex items-center">
                  <span className="w-full border-t" />
                </div>
                <div className="relative flex justify-center text-xs uppercase">
                  <span className="bg-background px-2 text-muted-foreground">Or</span>
                </div>
              </div>

              <Button
                variant="outline"
                className="h-11 w-full"
                onClick={handleSendPaymentLinkSms}
                disabled={sendingLinkSms || !customerPhone || !pricingBreakdown.grandTotal}
                title={!customerPhone ? "Customer phone required" : !pricingBreakdown.grandTotal ? "Select service and details first" : `Send card collection link for ${fmt(pricingBreakdown.grandTotal)} service`}
              >
                {sendingLinkSms ? (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                ) : (
                  <CreditCard className="mr-2 h-4 w-4" />
                )}
                Send Add Card Link
              </Button>
            </div>
          ) : (
            <div className="flex flex-col items-center justify-center py-8 text-center">
              <div className="w-14 h-14 rounded-full bg-secondary/50 flex items-center justify-center mb-3">
                <User className="w-7 h-7 text-muted-foreground" />
              </div>
              <p className="text-sm text-muted-foreground">
                Select a customer to manage payment
              </p>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
