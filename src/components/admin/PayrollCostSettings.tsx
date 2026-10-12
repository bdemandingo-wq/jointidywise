import { useEffect, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Loader2, Clock, AlertTriangle } from 'lucide-react';
import { toast } from 'sonner';
import { supabase } from '@/lib/supabase';
import { useOrganization } from '@/contexts/OrganizationContext';
import { clampClockHours } from '@/lib/wageCalculation';

/**
 * The payroll_settings row, which had no UI at all until now — every org has
 * been running on hardcoded defaults nobody chose.
 *
 * WHAT IS DELIBERATELY NOT HERE
 * payroll_settings also holds payroll_week_start_day, include_taxes_in_pay_base
 * and include_tips_in_pay_base. All three are read by NOTHING — grep of src/ and
 * supabase/functions/ finds zero readers. Giving them controls would be worse
 * than leaving them out: an owner would tick "include tips in pay base",
 * reasonably conclude their cleaners now get tips counted, and nothing at all
 * would happen. Add the control when something reads the column.
 * (Period settings that DO work live in business_settings, managed by
 * PayrollPeriodSettings above this card.)
 */

type FeeMode = 'none' | 'percent';
type VendorMode = 'none' | 'flat' | 'percent';

interface Settings {
  hours_overage_cap_ratio: number;
  hours_absolute_ceiling: number;
  processing_fee_mode: FeeMode;
  processing_fee_percent: number;
  processing_fee_flat: number;
  vendor_cost_mode: VendorMode;
  vendor_cost_flat: number;
  vendor_cost_percent: number;
  labor_percent_warning_threshold: number;
  margin_percent_good_threshold: number;
}

/** Must match PayrollPage.DEFAULT_SETTINGS and StaffPortal's inline fallbacks. */
const DEFAULTS: Settings = {
  hours_overage_cap_ratio: 1.25,
  hours_absolute_ceiling: 12,
  processing_fee_mode: 'percent',
  processing_fee_percent: 2.9,
  processing_fee_flat: 0.30,
  vendor_cost_mode: 'none',
  vendor_cost_flat: 0,
  vendor_cost_percent: 0,
  labor_percent_warning_threshold: 60,
  margin_percent_good_threshold: 30,
};

const num = (v: unknown, fallback: number): number => {
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) ? n : fallback;
};

/**
 * The worked example under the hours fields.
 *
 * Uses clampClockHours, the same function the job card, earnings, payroll,
 * and completion use. A short clock pays the scheduled length; a long clock
 * stops at scheduled × ratio and the ceiling.
 */
function payableHours(scheduled: number, clocked: number, ratio: number, ceiling: number): number {
  return clampClockHours(clocked, scheduled, { overageCapRatio: ratio, absoluteCeiling: ceiling });
}

const hrs = (n: number) => (Number.isFinite(n) ? `${Math.round(n * 100) / 100}h` : '—');

export function PayrollCostSettings() {
  const { organization } = useOrganization();
  const orgId = organization?.id;
  const queryClient = useQueryClient();
  const [form, setForm] = useState<Settings>(DEFAULTS);
  const [saving, setSaving] = useState(false);

  const { data, isLoading } = useQuery({
    queryKey: ['payroll-settings-editor', orgId],
    enabled: !!orgId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('payroll_settings')
        .select('*')
        .eq('organization_id', orgId!)
        .maybeSingle();
      // Not swallowed into defaults: showing an editable form full of default
      // values when the real row failed to load would let an owner "save"
      // over settings they never saw (CLAUDE.md rule 5).
      if (error) throw error;
      return data;
    },
  });

  useEffect(() => {
    if (!data) return;
    setForm({
      hours_overage_cap_ratio: num(data.hours_overage_cap_ratio, DEFAULTS.hours_overage_cap_ratio),
      hours_absolute_ceiling: num(data.hours_absolute_ceiling, DEFAULTS.hours_absolute_ceiling),
      processing_fee_mode: (data.processing_fee_mode as FeeMode) ?? DEFAULTS.processing_fee_mode,
      processing_fee_percent: num(data.processing_fee_percent, DEFAULTS.processing_fee_percent),
      processing_fee_flat: num(
        (data as Record<string, unknown>).processing_fee_flat, DEFAULTS.processing_fee_flat,
      ),
      vendor_cost_mode: (data.vendor_cost_mode as VendorMode) ?? DEFAULTS.vendor_cost_mode,
      vendor_cost_flat: num(data.vendor_cost_flat, DEFAULTS.vendor_cost_flat),
      vendor_cost_percent: num(data.vendor_cost_percent, DEFAULTS.vendor_cost_percent),
      labor_percent_warning_threshold: num(data.labor_percent_warning_threshold, DEFAULTS.labor_percent_warning_threshold),
      margin_percent_good_threshold: num(data.margin_percent_good_threshold, DEFAULTS.margin_percent_good_threshold),
    });
  }, [data]);

  const set = <K extends keyof Settings>(key: K, value: Settings[K]) =>
    setForm((prev) => ({ ...prev, [key]: value }));

  const handleSave = async () => {
    if (!orgId) return;

    if (form.hours_overage_cap_ratio < 1) {
      toast.error("The overage multiplier can't be below 1. That would pay less than the clock for every job.");
      return;
    }
    if (form.hours_absolute_ceiling <= 0) {
      toast.error('The hours ceiling must be more than 0.');
      return;
    }

    setSaving(true);
    try {
      // payroll_settings carries UNIQUE (organization_id), so one atomic upsert
      // is correct. An earlier version read-then-updated-or-inserted on the
      // mistaken belief that the constraint was absent; that left a race where
      // two concurrent saves could both find no row and both try to insert.
      const { error } = await supabase
        .from('payroll_settings')
        .upsert({ ...form, organization_id: orgId }, { onConflict: 'organization_id' });
      if (error) throw error;

      await queryClient.invalidateQueries({ queryKey: ['payroll-settings-editor', orgId] });
      await queryClient.invalidateQueries({ queryKey: ['payroll-settings', orgId] });
      toast.success('Payroll settings saved');
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not save payroll settings');
    } finally {
      setSaving(false);
    }
  };

  if (isLoading) {
    return (
      <Card>
        <CardContent className="py-10 flex justify-center">
          <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
        </CardContent>
      </Card>
    );
  }

  const ratio = form.hours_overage_cap_ratio;
  const ceiling = form.hours_absolute_ceiling;
  const shortJob = payableHours(4, 6, ratio, ceiling);
  const longJob = payableHours(10, 14, ratio, ceiling);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Pay limits and cost inputs</CardTitle>
        <CardDescription>
          These have been running on built-in defaults. Setting them here makes them yours.
        </CardDescription>
      </CardHeader>

      <CardContent className="space-y-8">
        {/* ── Tier 1: changes what cleaners are paid ─────────────────────── */}
        <section className="space-y-3">
          <div className="flex items-center gap-2">
            <Clock className="h-4 w-4 text-warning" />
            <h3 className="text-sm font-semibold">Hours limits</h3>
          </div>
          <p className="text-sm text-muted-foreground">
            The only settings on this page that change what a cleaner is paid. A clock
            shorter than the booking still pays the scheduled time. A longer clock pays
            up to the scheduled time times the multiplier, and never more than the ceiling.
          </p>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="cap-ratio" className="text-xs">Overage multiplier</Label>
              <Input
                id="cap-ratio" type="number" step="0.05" min="1" inputMode="decimal"
                value={ratio}
                onChange={(e) => set('hours_overage_cap_ratio', num(e.target.value, 0))}
              />
              <p className="text-[11px] text-muted-foreground">
                Most they can be paid, as a multiple of the scheduled time.
              </p>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="ceiling" className="text-xs">Hours ceiling</Label>
              <Input
                id="ceiling" type="number" step="0.5" min="0.5" inputMode="decimal"
                value={ceiling}
                onChange={(e) => set('hours_absolute_ceiling', num(e.target.value, 0))}
              />
              <p className="text-[11px] text-muted-foreground">
                Hard limit for any single job, however long the clock says.
              </p>
            </div>
          </div>

          {/*
            A live worked example rather than a confirmation dialog. A confirm
            trains people to click through; understanding the number is what
            stops the mistake. Recomputed from the fields as they are typed, so
            it is never describing a setting the owner isn't looking at.
          */}
          <div className="rounded-md border bg-muted/40 p-3 space-y-1.5">
            <p className="text-xs font-medium">With these settings</p>
            <p className="text-sm">
              A cleaner scheduled <strong>4h</strong> who clocks <strong>6h</strong> is paid{' '}
              <strong>{hrs(shortJob)}</strong>
              {shortJob < 6 ? ` (capped by the ${ratio}× multiplier)` : ' (not capped)'}
            </p>
            <p className="text-sm">
              A cleaner scheduled <strong>10h</strong> who clocks <strong>14h</strong> is paid{' '}
              <strong>{hrs(longJob)}</strong>
              {longJob === ceiling && ceiling < 10 * ratio
                ? ` (capped by the ${ceiling}h ceiling)`
                : longJob < 14
                  ? ` (capped by the ${ratio}× multiplier)`
                  : ' (not capped)'}
            </p>
          </div>

          <div className="rounded-md border border-warning/40 bg-warning/5 p-3">
            <div className="flex items-start gap-2">
              <AlertTriangle className="h-4 w-4 text-warning shrink-0 mt-0.5" />
              <div className="space-y-1.5 text-sm">
                <p>
                  <strong>This is the same limit everywhere pay is shown.</strong> Changing
                  it changes the hours on the job card, earnings, Cleaner Wages, and payroll,
                  including jobs already clocked out, unless that job's pay is locked.
                  Payroll reports that were already emailed are not regenerated.
                </p>
                {/*
                  Verified 2026-07-31 and worth saying out loud: the caps are applied in
                  StaffPortal at cleaner check-out (:709-715) and NOWHERE else. Neither
                  wageCalculation.ts nor the payout engine contains any cap logic, and
                  BookingsPage.handleStatusChange writes only `status`. So a job an admin
                  marks complete never passes through this limit.
                */}
                <p className="text-muted-foreground">
                  These limits are applied when a <strong>cleaner checks out in the staff app</strong>.
                  A job you mark complete yourself doesn't go through them — if the clock is
                  wrong on one of those, correct the pay on the job itself.
                </p>
              </div>
            </div>
          </div>
        </section>

        {/* ── Tier 2: changes reported profit, not pay ───────────────────── */}
        <section className="space-y-3">
          <h3 className="text-sm font-semibold">Your costs</h3>
          <p className="text-sm text-muted-foreground">
            Used to work out profit on the payroll and booking reports. Nobody is paid
            differently because of these — but every profit figure you see depends on them
            being right.
          </p>

          {/*
            Stated up front rather than left to be noticed. Two corrections
            shipped together and they pull in opposite directions, so an owner
            comparing this month to last needs to know the numbers moved because
            the maths got more accurate, not because the business changed.
          */}
          <div className="rounded-md border bg-muted/40 p-3 space-y-1.5">
            <p className="text-xs font-medium">Your profit figures have just changed — here&apos;s why</p>
            <p className="text-sm text-muted-foreground">
              Card fees are now worked out the way processors actually charge, and only on
              jobs that were really paid through Stripe.
            </p>
            <ul className="text-sm text-muted-foreground list-disc pl-4 space-y-0.5">
              <li>Jobs paid by card: profit drops by the fixed fee — about 30¢ each.</li>
              <li>
                Jobs paid in cash, by cheque or bank transfer: no card fee is charged now, so
                profit goes <strong>up</strong> by the full percentage.
              </li>
            </ul>
            <p className="text-sm text-muted-foreground">
              Most businesses will see total profit rise. Nothing about what you earned has
              changed — only how accurately it&apos;s reported.
            </p>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label className="text-xs">Card processing</Label>
              <Select
                value={form.processing_fee_mode}
                onValueChange={(v) => set('processing_fee_mode', v as FeeMode)}
              >
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="percent">Percentage of each job</SelectItem>
                  <SelectItem value="none">Don't count it</SelectItem>
                </SelectContent>
              </Select>
              {form.processing_fee_mode === 'percent' && (
                <>
                  <Input
                    type="number" step="0.1" min="0" inputMode="decimal"
                    value={form.processing_fee_percent}
                    onChange={(e) => set('processing_fee_percent', num(e.target.value, 0))}
                  />
                  <p className="text-[11px] text-muted-foreground">
                    % of the amount charged.
                  </p>
                  <Label htmlFor="fee-flat" className="text-xs">Plus, per payment</Label>
                  <Input
                    id="fee-flat" type="number" step="0.01" min="0" inputMode="decimal"
                    value={form.processing_fee_flat}
                    onChange={(e) => set('processing_fee_flat', num(e.target.value, 0))}
                  />
                  <p className="text-[11px] text-muted-foreground">
                    Most processors charge a percentage <em>plus</em> a fixed amount. Stripe&apos;s
                    US standard is 2.9% + 30¢. Set this to 0 if yours has no fixed fee.
                  </p>
                </>
              )}
            </div>

            <div className="space-y-1.5">
              <Label className="text-xs">Supplies and other costs</Label>
              <Select
                value={form.vendor_cost_mode}
                onValueChange={(v) => set('vendor_cost_mode', v as VendorMode)}
              >
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">Don't count them</SelectItem>
                  <SelectItem value="flat">A fixed amount per job</SelectItem>
                  <SelectItem value="percent">A percentage of each job</SelectItem>
                </SelectContent>
              </Select>
              {form.vendor_cost_mode === 'flat' && (
                <Input
                  type="number" step="0.5" min="0" inputMode="decimal"
                  value={form.vendor_cost_flat}
                  onChange={(e) => set('vendor_cost_flat', num(e.target.value, 0))}
                />
              )}
              {form.vendor_cost_mode === 'percent' && (
                <Input
                  type="number" step="0.5" min="0" inputMode="decimal"
                  value={form.vendor_cost_percent}
                  onChange={(e) => set('vendor_cost_percent', num(e.target.value, 0))}
                />
              )}
            </div>
          </div>
        </section>

        {/* ── Tier 3: only changes when a number turns orange ────────────── */}
        <section className="space-y-3">
          <h3 className="text-sm font-semibold">When to flag a job</h3>
          <p className="text-sm text-muted-foreground">
            Colour only. Changing these highlights different jobs on the reports; it doesn't
            change any money.
          </p>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="labor-warn" className="text-xs">Warn when labour is above</Label>
              <Input
                id="labor-warn" type="number" step="1" min="0" max="100" inputMode="decimal"
                value={form.labor_percent_warning_threshold}
                onChange={(e) => set('labor_percent_warning_threshold', num(e.target.value, 0))}
              />
              <p className="text-[11px] text-muted-foreground">% of what the job earned.</p>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="margin-good" className="text-xs">Call the margin healthy above</Label>
              <Input
                id="margin-good" type="number" step="1" min="0" max="100" inputMode="decimal"
                value={form.margin_percent_good_threshold}
                onChange={(e) => set('margin_percent_good_threshold', num(e.target.value, 0))}
              />
              <p className="text-[11px] text-muted-foreground">% profit left after costs.</p>
            </div>
          </div>
        </section>

        <div className="flex justify-end">
          <Button onClick={handleSave} disabled={saving}>
            {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Save settings
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
