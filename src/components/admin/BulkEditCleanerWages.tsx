import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { computeExpectedPay, syncCleanerPayShare } from '@/lib/cleanerPay';
import { resolveCleanerPay, type WageBooking, type WageStaff } from '@/lib/wageCalculation';
import { useHourCaps } from '@/hooks/useHourCaps';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { toast } from '@/hooks/use-toast';
import { Loader2, Save, Search, DollarSign, Percent } from 'lucide-react';
import { format } from 'date-fns';
import { useOrgTimezone } from '@/hooks/useOrgTimezone';
import { formatInTimezone } from '@/lib/timezoneUtils';
import { useOrganization } from '@/contexts/OrganizationContext';
import { QueryError } from '@/components/QueryError';

interface BookingWithWage {
  id: string;
  booking_number: number;
  scheduled_at: string;
  total_amount: number;
  duration: number;
  cleaner_wage: number | null;
  cleaner_wage_type: string | null;
  cleaner_checkin_at: string | null;
  cleaner_checkout_at: string | null;
  cleaner_override_hours: number | null;
  pay_locked: boolean | null;
  customer: {
    first_name: string;
    last_name: string;
  } | null;
  service: {
    name: string;
  } | null;
  staff: {
    name: string;
    hourly_rate: number | null;
    percentage_rate: number | null;
  } | null;
}

export function BulkEditCleanerWages() {
  const { organization } = useOrganization();
  const organizationId = organization?.id;
  const { timezone: orgTz } = useOrgTimezone();
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedBookings, setSelectedBookings] = useState<Set<string>>(new Set());
  const [bulkWageType, setBulkWageType] = useState<string>('');
  const [bulkWageValue, setBulkWageValue] = useState<string>('');
  const [bulkJobTotal, setBulkJobTotal] = useState<string>('');
  const [localEdits, setLocalEdits] = useState<Record<string, { type: string; value: string; jobTotal?: string }>>({}); 
  const [saving, setSaving] = useState(false);

  const queryClient = useQueryClient();
  const { caps: hourCaps } = useHourCaps(organizationId);

  const { data: bookings = [], isLoading, error: bookingsError } = useQuery({
    queryKey: ['bookings-wages', organizationId],
    queryFn: async () => {
      if (!organizationId) return [];
      // Use type workaround for Supabase deep type inference
      const client: any = supabase;
      const { data, error } = await client
        .from('bookings')
        .select(`
          id, booking_number, scheduled_at, total_amount, duration,
          cleaner_wage, cleaner_wage_type,
          cleaner_checkin_at, cleaner_checkout_at, cleaner_override_hours, pay_locked,
          customer:customers(first_name, last_name),
          service:services(name),
          staff:staff(name, hourly_rate, percentage_rate)
        `)
        .eq('organization_id', organizationId)
        .order('scheduled_at', { ascending: false })
        .limit(200);

      if (error) throw error;
      return data as BookingWithWage[];
    },
    enabled: !!organizationId,
  });

  const filteredBookings = bookings.filter((booking) => {
    const customerName = booking.customer
      ? `${booking.customer.first_name} ${booking.customer.last_name}`.toLowerCase()
      : '';
    const bookingNum = booking.booking_number.toString();
    return (
      customerName.includes(searchTerm.toLowerCase()) ||
      bookingNum.includes(searchTerm)
    );
  });

  const toggleSelectAll = () => {
    if (selectedBookings.size === filteredBookings.length) {
      setSelectedBookings(new Set());
    } else {
      setSelectedBookings(new Set(filteredBookings.map((b) => b.id)));
    }
  };

  const toggleSelectBooking = (id: string) => {
    setSelectedBookings((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  };

  const handleLocalEdit = (bookingId: string, field: 'type' | 'value' | 'jobTotal', val: string) => {
    setLocalEdits((prev) => ({
      ...prev,
      [bookingId]: {
        ...prev[bookingId],
        [field]: val,
      },
    }));
  };

  const applyBulkWageEdit = () => {
    if (!bulkWageType || selectedBookings.size === 0) return;

    const updates: Record<string, { type: string; value: string; jobTotal?: string }> = {};
    selectedBookings.forEach((id) => {
      updates[id] = {
        ...localEdits[id],
        type: bulkWageType,
        value: bulkWageValue || '',
      };
    });

    setLocalEdits((prev) => ({ ...prev, ...updates }));
    toast({
      title: 'Bulk Wage Edit Applied',
      description: `Updated ${selectedBookings.size} bookings locally. Click "Save All Changes" to persist.`,
    });
  };

  const applyBulkJobTotalEdit = () => {
    if (!bulkJobTotal || selectedBookings.size === 0) return;

    const updates: Record<string, { type: string; value: string; jobTotal?: string }> = {};
    selectedBookings.forEach((id) => {
      updates[id] = {
        ...localEdits[id],
        type: localEdits[id]?.type || '',
        value: localEdits[id]?.value || '',
        jobTotal: bulkJobTotal,
      };
    });

    setLocalEdits((prev) => ({ ...prev, ...updates }));
    toast({
      title: 'Bulk Job Total Applied',
      description: `Updated ${selectedBookings.size} bookings locally. Click "Save All Changes" to persist.`,
    });
  };

  const saveAllChanges = async () => {
    const editedIds = Object.keys(localEdits);
    if (editedIds.length === 0) {
      toast({ title: 'No changes', description: 'No edits to save' });
      return;
    }

    if (!organizationId) {
      toast({ title: 'Error', description: 'No organization context', variant: 'destructive' });
      return;
    }

    setSaving(true);
    let successCount = 0;
    let failedCount = 0;
    const errors: string[] = [];

    try {
      const results = await Promise.allSettled(
        editedIds.map(async (id) => {
          const edit = localEdits[id];
          const wageValue = edit.value ? parseFloat(edit.value) : null;
          const jobTotalValue = edit.jobTotal ? parseFloat(edit.jobTotal) : undefined;
          const booking = bookings.find((b) => b.id === id);

          const updateData: Record<string, unknown> = {
            cleaner_wage_type: edit.type || null,
            cleaner_wage: wageValue,
          };

          if (jobTotalValue !== undefined) {
            updateData.total_amount = jobTotalValue;
          }

          const pricedBooking = booking && jobTotalValue !== undefined
            ? { ...booking, total_amount: jobTotalValue }
            : booking;
          const wageDerivedPay = pricedBooking
            ? calculatePay(pricedBooking, edit.type || 'hourly', edit.value)
            : computeExpectedPay(edit.type || 'hourly', edit.value, '', booking?.duration ?? 0, jobTotalValue ?? 0);
          updateData.cleaner_pay_expected = wageDerivedPay;
          if (wageDerivedPay != null) {
            updateData.cleaner_actual_payment = null;
          }

          const { error } = await supabase
            .from('bookings')
            .update(updateData)
            .eq('id', id)
            .eq('organization_id', organizationId);

          if (error) throw error;
          await syncCleanerPayShare(id, organizationId, wageDerivedPay);
        })
      );
      for (const r of results) {
        if (r.status === 'fulfilled') successCount++;
        else {
          failedCount++;
          errors.push((r.reason as Error).message);
        }
      }

      if (failedCount > 0) {
        toast({
          title: 'Partial Update',
          description: `${successCount} saved, ${failedCount} failed: ${errors[0]}`,
          variant: 'destructive',
        });
      } else {
        toast({
          title: 'Changes Saved',
          description: `Updated ${successCount} bookings successfully`,
        });
        setLocalEdits({});
        setSelectedBookings(new Set());
      }
      
      queryClient.invalidateQueries({ queryKey: ['bookings-wages', organizationId] });
      queryClient.invalidateQueries({ queryKey: ['bookings'] });
    } catch (error) {
      console.error('Failed to save changes:', error);
      toast({
        title: 'Error',
        description: 'Failed to save changes. Please try again.',
        variant: 'destructive',
      });
    } finally {
      setSaving(false);
    }
  };

  const getEffectiveWage = (booking: BookingWithWage) => {
    const edit = localEdits[booking.id];
    if (edit) {
      return {
        type: edit.type,
        value: edit.value,
        isEdited: true,
      };
    }
    return {
      type: booking.cleaner_wage_type || '',
      value: booking.cleaner_wage?.toString() || '',
      isEdited: false,
    };
  };

  const calculatePay = (booking: BookingWithWage, wageType: string, wageValue: string) => {
    const parsed = wageValue.trim() === '' ? null : Number(wageValue);
    const wage = parsed != null && Number.isFinite(parsed) ? parsed : null;
    const staff: WageStaff = {
      hourly_rate: booking.staff?.hourly_rate ?? null,
      base_wage: null,
      default_hours: null,
      percentage_rate: booking.staff?.percentage_rate ?? null,
    };
    const priced: WageBooking = {
      cleaner_actual_payment: null,
      cleaner_pay_expected: null,
      pay_locked: false,
      cleaner_wage: wage,
      cleaner_wage_type: wageType || null,
      cleaner_checkin_at: booking.cleaner_checkin_at,
      cleaner_checkout_at: booking.cleaner_checkout_at,
      cleaner_override_hours: booking.cleaner_override_hours,
      duration: booking.duration,
      total_amount: booking.total_amount,
    };
    // Solo preview. Team shares are edited on the booking, not in this grid.
    return resolveCleanerPay(priced, staff, null, 1, hourCaps).calculatedPay;
  };

  const hasUnsavedChanges = Object.keys(localEdits).length > 0;

  if (bookingsError) {
    return <QueryError subject="bookings" />;
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div>
          <h2 className="text-xl font-semibold">Bulk Edit Cleaner Wages</h2>
          <p className="text-sm text-muted-foreground">
            Set whether each booking pays cleaners hourly or percentage
          </p>
        </div>
        {hasUnsavedChanges && (
          <Button onClick={saveAllChanges} disabled={saving} className="gap-2">
            {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
            Save All Changes ({Object.keys(localEdits).length})
          </Button>
        )}
      </div>

      {/* Bulk Edit Controls */}
      <div className="bg-secondary/30 rounded-xl p-4 border space-y-4">
        <p className="text-sm font-medium">Bulk Edit Selected ({selectedBookings.size})</p>
        
        {/* Job Total Bulk Edit */}
        <div className="flex flex-wrap gap-3 items-end pb-4 border-b border-border/50">
          <div className="space-y-1">
            <label className="text-xs text-muted-foreground">Job Total ($)</label>
            <Input
              type="number"
              placeholder="150"
              value={bulkJobTotal}
              onChange={(e) => setBulkJobTotal(e.target.value)}
              className="w-[120px]"
            />
          </div>
          <Button
            variant="secondary"
            onClick={applyBulkJobTotalEdit}
            disabled={!bulkJobTotal || selectedBookings.size === 0}
          >
            Apply Job Total
          </Button>
        </div>

        {/* Wage Bulk Edit */}
        <div className="flex flex-wrap gap-3 items-end">
          <div className="space-y-1">
            <label className="text-xs text-muted-foreground">Wage Type</label>
            <Select value={bulkWageType} onValueChange={setBulkWageType}>
              <SelectTrigger className="w-[140px]">
                <SelectValue placeholder="Select type" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="percentage">Percentage</SelectItem>
                <SelectItem value="hourly">Hourly</SelectItem>
                <SelectItem value="flat">Flat Rate</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <label className="text-xs text-muted-foreground">
              {bulkWageType === 'percentage' ? 'Percentage (%)' : bulkWageType === 'flat' ? 'Flat Amount ($)' : 'Rate ($/hr)'}
            </label>
            <Input
              type="number"
              placeholder={bulkWageType === 'percentage' ? '40' : bulkWageType === 'flat' ? '100' : '25'}
              value={bulkWageValue}
              onChange={(e) => setBulkWageValue(e.target.value)}
              className="w-[100px]"
            />
          </div>
          <Button
            variant="secondary"
            onClick={applyBulkWageEdit}
            disabled={!bulkWageType || selectedBookings.size === 0}
          >
            Apply Wage
          </Button>
        </div>
      </div>

      {/* Search */}
      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
        <Input
          placeholder="Search by customer name or booking #..."
          value={searchTerm}
          onChange={(e) => setSearchTerm(e.target.value)}
          className="pl-10"
        />
      </div>

      {/* Table */}
      <div className="bg-card rounded-xl border overflow-hidden">
        {isLoading ? (
          <div className="flex items-center justify-center h-48">
            <Loader2 className="w-8 h-8 animate-spin text-muted-foreground" />
          </div>
        ) : (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow className="bg-secondary/30">
                  <TableHead className="w-[50px]">
                    <Checkbox
                      checked={selectedBookings.size === filteredBookings.length && filteredBookings.length > 0}
                      onCheckedChange={toggleSelectAll}
                    />
                  </TableHead>
                  <TableHead>Booking</TableHead>
                  <TableHead>Customer</TableHead>
                  <TableHead>Service</TableHead>
                  <TableHead>Cleaner</TableHead>
                  <TableHead>Job Total</TableHead>
                  <TableHead>Wage Type</TableHead>
                  <TableHead>Rate</TableHead>
                  <TableHead>Est. Cleaner Pay</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredBookings.map((booking) => {
                  const wage = getEffectiveWage(booking);
                  const estPay = calculatePay(booking, wage.type, wage.value);

                  return (
                    <TableRow
                      key={booking.id}
                      className={wage.isEdited ? 'bg-amber-50/50 dark:bg-amber-950/20' : ''}
                    >
                      <TableCell>
                        <Checkbox
                          checked={selectedBookings.has(booking.id)}
                          onCheckedChange={() => toggleSelectBooking(booking.id)}
                        />
                      </TableCell>
                      <TableCell>
                        <span className="font-mono text-sm font-bold text-primary">
                          #{booking.booking_number}
                        </span>
                        <p className="text-xs text-muted-foreground">
                          {formatInTimezone(booking.scheduled_at, orgTz, { month: 'short', day: 'numeric', year: 'numeric' })}
                        </p>
                      </TableCell>
                      <TableCell>
                        {booking.customer
                          ? `${booking.customer.first_name} ${booking.customer.last_name}`
                          : 'Unknown'}
                      </TableCell>
                      <TableCell>{booking.service?.name || (booking.total_amount === 0 ? 'Re-clean' : 'Service')}</TableCell>
                      <TableCell>
                        {booking.staff?.name || (
                          <span className="text-muted-foreground italic">Unassigned</span>
                        )}
                        {booking.staff?.hourly_rate != null && (
                          <p className="text-xs text-muted-foreground">${booking.staff.hourly_rate}/hr</p>
                        )}
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center gap-1">
                          <span className="text-muted-foreground">$</span>
                          <Input
                            type="number"
                            value={localEdits[booking.id]?.jobTotal ?? ''}
                            onChange={(e) => handleLocalEdit(booking.id, 'jobTotal', e.target.value)}
                            placeholder={booking.total_amount.toFixed(2)}
                            className="w-[90px] h-8"
                          />
                        </div>
                      </TableCell>
                      <TableCell>
                        <Select
                          value={wage.type || 'none'}
                          onValueChange={(val) =>
                            handleLocalEdit(booking.id, 'type', val === 'none' ? '' : val)
                          }
                        >
                          <SelectTrigger className="w-[120px] h-8">
                            <SelectValue placeholder="Not set" />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="none">Not set</SelectItem>
                            <SelectItem value="percentage">
                              <span className="flex items-center gap-1">
                                <Percent className="w-3 h-3" /> Percentage
                              </span>
                            </SelectItem>
                            <SelectItem value="flat">
                              <span className="flex items-center gap-1">
                                <DollarSign className="w-3 h-3" /> Flat Rate
                              </span>
                            </SelectItem>
                            <SelectItem value="hourly">
                              <span className="flex items-center gap-1">
                                <DollarSign className="w-3 h-3" /> Hourly
                              </span>
                            </SelectItem>
                          </SelectContent>
                        </Select>
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center gap-1">
                          {wage.type === 'percentage' && <span className="text-muted-foreground">%</span>}
                          {(wage.type === 'hourly' || wage.type === 'flat') && <span className="text-muted-foreground">$</span>}
                          <Input
                            type="number"
                            value={wage.value}
                            onChange={(e) => handleLocalEdit(booking.id, 'value', e.target.value)}
                            placeholder={
                              wage.type === 'percentage'
                                ? (booking.staff?.percentage_rate != null ? String(booking.staff.percentage_rate) : '')
                                : wage.type === 'flat'
                                  ? ''
                                  : (booking.staff?.hourly_rate != null ? String(booking.staff.hourly_rate) : '')
                            }
                            title={
                              wage.type === 'hourly' || !wage.type
                                ? 'Blank uses the staff hourly rate shown on the cleaner'
                                : undefined
                            }
                            className="w-[70px] h-8"
                          />
                          {wage.type === 'hourly' && <span className="text-muted-foreground text-xs">/hr</span>}
                          {wage.type === 'flat' && <span className="text-muted-foreground text-xs">flat</span>}
                        </div>
                      </TableCell>
                      <TableCell>
                        <Badge
                          variant={wage.isEdited ? 'default' : 'outline'}
                          className={wage.isEdited ? 'bg-amber-500' : ''}
                        >
                          ${estPay.toFixed(2)}
                        </Badge>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        )}
      </div>
    </div>
  );
}
