import { useState, useEffect, useMemo, useCallback } from 'react';
import { AddressAutocomplete } from '@/components/address/AddressAutocomplete';
import { isSafeHttpUrl } from '@/lib/websiteUrl';
import { useParams } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Calendar } from '@/components/ui/calendar';
import { Badge } from '@/components/ui/badge';
import { TermsOfServiceDialog } from '@/components/legal/TermsOfServiceDialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Calendar as CalendarIcon,
  Clock,
  Check,
  ArrowRight,
  ArrowLeft,
  MapPin,
  User,
  Mail,
  Phone,
  DollarSign,
  Ruler,
  Loader2,
  Star,
  Gift,
  CreditCard,
  Lock,
  Globe,
  X,
  PawPrint,
  Minus,
  Plus,
  ChevronDown,
} from 'lucide-react';
import { Switch } from '@/components/ui/switch';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { cn } from '@/lib/utils';
import { Link } from 'react-router-dom';
import { squareFootageRanges } from '@/data/pricingData';
import { usePublicOrgPricing } from '@/hooks/usePublicOrgPricing';
import { calculateBasePrice } from '@/lib/pricingEngine';
import { isUsHoliday } from '@/lib/usHolidays';
import { readEdgeFunctionErrorBody, firstFieldError } from '@/lib/edgeFunctionError';
import {
  configFromBusinessSettings,
  getFrequencyDiscountMultiplier,
  getFrequencyDiscountPct,
  HARDCODED_DEFAULTS,
  type RecurringDiscountConfig,
} from '@/lib/recurringDiscount';
import { useCustomFrequencies, resolveCustomFrequencyDiscountPct } from '@/hooks/useCustomFrequencies';
import { supabase } from '@/lib/supabase';
import { isValidPhone } from '@/lib/errorHandling';
import { toast } from 'sonner';
import { applyPublicBranding, clearPublicBranding } from '@/hooks/useBrandingColors';
import { StripeCardForm } from '@/components/stripe/StripeCardForm';
import { selectedDateTimeToUTCISO } from '@/lib/timezoneUtils';
import { orgDateKey, calendarDayKey } from '@/lib/orgDateRange';
import { SEOHead } from '@/components/SEOHead';
import { TrackingPixels, trackConversion } from '@/components/TrackingPixels';
import { fireAndForget } from '@/lib/mustAffectRows';

// Abandoned-booking telemetry goes through SECURITY DEFINER routines that take
// the visitor's session token as an argument. Typed loosely because the
// generated types lag new routines; the runtime contract is { error }.
const markAbandonedProgress = (args: {
  _session_token: string;
  _step_reached?: number;
  _converted?: boolean;
}) =>
  (supabase.rpc as unknown as (fn: string, a: Record<string, unknown>) => Promise<unknown>)(
    'mark_abandoned_booking_progress',
    args,
  );


interface AvailabilitySlot {
  time: string; // "HH:mm" in org timezone
  available: boolean;
}

// Format 24h time to 12h display
function formatTime24to12(time24: string): string {
  const [h, m] = time24.split(':').map(Number);
  const period = h >= 12 ? 'PM' : 'AM';
  const displayHour = h === 0 ? 12 : h > 12 ? h - 12 : h;
  return `${displayHour}:${String(m).padStart(2, '0')} ${period}`;
}

export default function PublicBookingPage() {
  const { orgSlug } = useParams<{ orgSlug: string }>();
  
  // Track booking link ref parameter for link tracking
  const [trackingRef] = useState(() => {
    const params = new URLSearchParams(window.location.search);
    return params.get('ref') || null;
  });
  const [step, setStep] = useState(1);
  const [selectedService, setSelectedService] = useState<string | null>(null);
  const [selectedSqFtIndex, setSelectedSqFtIndex] = useState<number | null>(null);
  const [selectedExtras, setSelectedExtras] = useState<string[]>([]);
  const [selectedBedrooms, setSelectedBedrooms] = useState<string | null>(null);
  const [selectedBathrooms, setSelectedBathrooms] = useState<string | null>(null);
  const [hasPets, setHasPets] = useState<boolean>(false);
  const [selectedHomeCondition, setSelectedHomeCondition] = useState<string | null>(null);
  // Customer-selected room count reductions ("don't need entire home cleaned")
  const [roomReductions, setRoomReductions] = useState<Record<'bedroom' | 'bathroom' | 'full_bath', number>>({
    bedroom: 0, bathroom: 0, full_bath: 0,
  });
  const [reducerOpen, setReducerOpen] = useState(false);
  const [selectedFrequency, setSelectedFrequency] = useState<string>('one-time');
  const [selectedDate, setSelectedDate] = useState<Date | undefined>(undefined);
  const [selectedTime, setSelectedTime] = useState<string | null>(null); // "HH:mm" 24h format
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [confirmationNumber, setConfirmationNumber] = useState<string>('');
  const [cardSaved, setCardSaved] = useState(false);
  const [availableSlots, setAvailableSlots] = useState<AvailabilitySlot[]>([]);
  const [loadingSlots, setLoadingSlots] = useState(false);
  const [orgTimezone, setOrgTimezone] = useState<string>('America/New_York');
  const [surgeSettings, setSurgeSettings] = useState<{
    surge_weekend_enabled: boolean; surge_weekend_multiplier: number;
    surge_lastminute_enabled: boolean; surge_lastminute_hours: number; surge_lastminute_multiplier: number;
    surge_holiday_enabled: boolean; surge_holiday_multiplier: number;
  } | null>(null);
  const [trackingIds, setTrackingIds] = useState<{ meta_pixel_id: string | null; google_analytics_id: string | null }>({ meta_pixel_id: null, google_analytics_id: null });
  const [recurringDiscountConfig, setRecurringDiscountConfig] =
    useState<RecurringDiscountConfig>(HARDCODED_DEFAULTS);
  const [schedulingMode, setSchedulingMode] = useState<'specific' | 'arrival_window'>('specific');
  const [arrivalWindows, setArrivalWindows] = useState<Array<{ id: string; label?: string; start_time: string; end_time: string; sort_order: number; enabled: boolean }>>([]);
  // Per-org pet + exclude-parameters config (from get_public_booking_settings RPC).
  const [petFee, setPetFee] = useState<number>(25);
  const [petToggleEnabled, setPetToggleEnabled] = useState<boolean>(true);
  const [excludedRoomTypes, setExcludedRoomTypes] = useState<Array<'bedroom' | 'bathroom' | 'full_bath'>>([]);
  const [roomReductionPrices, setRoomReductionPrices] = useState<Record<'bedroom' | 'bathroom' | 'full_bath', number>>({
    bedroom: 25, bathroom: 20, full_bath: 25,
  });
  const [customerTimezone] = useState<string>(() => Intl.DateTimeFormat().resolvedOptions().timeZone);
  const [customerInfo, setCustomerInfo] = useState({
    name: '',
    email: '',
    phone: '',
    address: '',
    city: '',
    state: '',
    zipCode: '',
    latitude: null as number | null,
    longitude: null as number | null,
    notes: '',
    // Opt-in for the abandoned-booking recovery text. Unticked by default and
    // deliberately its own checkbox — never folded into the terms agreement.
    smsConsent: false,
  });

  // Use organization-specific pricing
  const { 
    services, 
    extras, 
    organizationName, 
    organizationId,
    logoUrl,
    websiteUrl,
    primaryColor,
    accentColor,
    bookingFormTheme,
    formColors,
    displaySettings,
    bedroomPricing,
    petOptions,
    homeConditionOptions,
    loading: pricingLoading 
  } = usePublicOrgPricing(orgSlug);

  // Layer 2 of the website_url guard. The render path does not trust the
  // database — a javascript: value reaching an href here would be stored XSS
  // against every anonymous visitor to this form.
  const safeWebsiteUrl = isSafeHttpUrl(websiteUrl) ? websiteUrl : null;

  const { customFrequencies: customFrequenciesFromHook } = useCustomFrequencies(organizationId);
  const [customFrequenciesFromRpc, setCustomFrequenciesFromRpc] = useState<
    Array<{ id: string; name: string; interval_days: number; days_of_week: number[] | null; is_active: boolean; discount_pct: number }>
  >([]);
  const customFrequencies = customFrequenciesFromRpc.length > 0
    ? customFrequenciesFromRpc
    : customFrequenciesFromHook;

  const isLight = bookingFormTheme === 'light';

  // Apply org branding colors once when loaded (no re-renders)
  // Fetch availability when date or service changes
  const fetchAvailability = useCallback(async () => {
    if (!selectedDate || !organizationId) return;
    setLoadingSlots(true);
    setSelectedTime(null);
    try {
      // The day the customer clicked on the calendar. Correct to read from the
      // picker token as-is — see calendarDayKey.
      const dateStr = calendarDayKey(selectedDate);

      const { data, error } = await supabase.functions.invoke('check-availability', {
        body: { organization_id: organizationId, date: dateStr, service_id: selectedService },
      });

      if (error) throw error;
      setAvailableSlots(data?.slots || []);
      if (data?.timezone) setOrgTimezone(data.timezone);
    } catch (err) {
      console.error('Failed to fetch availability:', err);
      setAvailableSlots([]);
    } finally {
      setLoadingSlots(false);
    }
  }, [selectedDate, organizationId, selectedService]);

  useEffect(() => {
    fetchAvailability();
  }, [fetchAvailability]);
  useEffect(() => {
    // If a custom accent color is set via form colors, use it as the primary branding color
    const effectivePrimary = formColors.accent || primaryColor;
    const effectiveAccent = formColors.accent || accentColor;
    if (effectivePrimary || effectiveAccent) {
      applyPublicBranding(effectivePrimary, effectiveAccent);
    }
    return () => clearPublicBranding();
  }, [primaryColor, accentColor, formColors.accent]);

  // Fetch surge pricing + recurring discount settings + custom frequencies via
  // a security-definer RPC so anonymous visitors can read booking-safe fields
  // even though business_settings itself is admin-only.
  useEffect(() => {
    if (!organizationId) return;
    (supabase.rpc as any)('get_public_booking_settings', { p_org_id: organizationId })
      .then(({ data, error }: any) => {
        if (error || !data) return;
        setSurgeSettings({
          surge_weekend_enabled: !!data.surge_weekend_enabled,
          surge_weekend_multiplier: Number(data.surge_weekend_multiplier) || 1,
          surge_lastminute_enabled: !!data.surge_lastminute_enabled,
          surge_lastminute_hours: Number(data.surge_lastminute_hours) || 0,
          surge_lastminute_multiplier: Number(data.surge_lastminute_multiplier) || 1,
          surge_holiday_enabled: !!data.surge_holiday_enabled,
          surge_holiday_multiplier: Number(data.surge_holiday_multiplier) || 1,
        });
        setTrackingIds({
          meta_pixel_id: data.meta_pixel_id ?? null,
          google_analytics_id: data.google_analytics_id ?? null,
        });
        setRecurringDiscountConfig(configFromBusinessSettings(data));
        if (Array.isArray(data.custom_frequencies)) {
          setCustomFrequenciesFromRpc(data.custom_frequencies);
        }
        if (typeof data.pet_fee !== 'undefined') setPetFee(Number(data.pet_fee) || 0);
        if (typeof data.pet_toggle_enabled !== 'undefined') setPetToggleEnabled(!!data.pet_toggle_enabled);
        if (Array.isArray(data.excluded_room_types)) setExcludedRoomTypes(data.excluded_room_types);
        if (data.room_reduction_prices && typeof data.room_reduction_prices === 'object') {
          setRoomReductionPrices((prev) => ({ ...prev, ...data.room_reduction_prices }));
        }
        const rawMode = data.scheduling_mode;
        const mode: 'specific' | 'arrival_window' = rawMode === 'arrival_window' ? 'arrival_window' : 'specific';
        const windows = Array.isArray(data.arrival_windows)
          ? (data.arrival_windows as typeof arrivalWindows)
              .filter((w) => w && typeof w.start_time === 'string' && typeof w.end_time === 'string')
              .sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0))
          : [];
        // Fallback: if arrival mode but no enabled windows, stay on specific
        if (mode === 'arrival_window' && windows.filter((w) => w.enabled).length === 0) {
          setSchedulingMode('specific');
        } else {
          setSchedulingMode(mode);
        }
        setArrivalWindows(windows);
      });
  }, [organizationId]);

  // Track link_opened when ref param exists.
  // Deliberately fire-and-forget: link tracking is marketing telemetry with no
  // user-visible consequence, and it must never interrupt a booking in progress.
  useEffect(() => {
    if (trackingRef && organizationId) {
      fireAndForget(
        supabase
          .from('booking_link_tracking' as any)
          .update({ link_opened_at: new Date().toISOString(), status: 'opened' })
          .eq('tracking_ref', trackingRef),
        'booking_link_tracking: link opened',
      );
    }
  }, [trackingRef, organizationId]);

  // Track abandoned bookings - save progress when user has contact info
  // Resuming from a recovery SMS reuses that session's token so we continue the
  // existing row instead of opening a second one for the same person.
  const resumeToken = useState(() => {
    const params = new URLSearchParams(window.location.search);
    return params.get('resume') || null;
  })[0];
  const sessionTokenRef = useState(() => resumeToken || crypto.randomUUID())[0];
  const abandonedTrackedRef = useState({ tracked: !!resumeToken })[0];
  const consentSentRef = useState({ sent: false })[0];

  // Everything needed to put the form back exactly where they left it. The six
  // dedicated columns only cover contact details and service, which is nowhere
  // near enough to rehydrate this form.
  const buildFormSnapshot = () => {
    // Consent is deliberately excluded: form_snapshot is client-writable, so
    // anything in it is forgeable and must never be treated as permission.
    const { smsConsent: _omitConsent, ...contact } = customerInfo;
    return {
    v: 1,
    step,
    selectedService,
    selectedSqFtIndex,
    selectedExtras,
    selectedBedrooms,
    selectedBathrooms,
    hasPets,
    selectedHomeCondition,
    roomReductions,
    selectedFrequency,
    selectedDate: selectedDate ? selectedDate.toISOString() : null,
    selectedTime,
    schedulingMode,
    customerInfo: contact,
    };
  };

  useEffect(() => {
    // Only write a row once there is a complete phone number to write.
    //
    // This used to test `customerInfo.phone` for truthiness, which is true on
    // the FIRST digit typed, and latched `tracked` synchronously — so every
    // prospect was stored with a phone of "2" or "7" and could never be
    // contacted. The row was never corrected afterwards either: the update
    // below only touches step_reached.
    //
    // Note isValidPhone('') returns true (it treats phone as an optional
    // field), so the emptiness check has to come first.
    if (step < 3 || !organizationId) return;
    if (!customerInfo.phone || !isValidPhone(customerInfo.phone)) return;

    // Debounced: write once the number has stopped changing, not per keystroke.
    const timer = setTimeout(() => {
      if (!customerInfo.phone || !isValidPhone(customerInfo.phone)) return;
      const nameParts = customerInfo.name.trim().split(/\s+/);
      // Writes go through a SECURITY DEFINER routine that takes the session
      // token as an argument. The previous path relied on an RLS policy that
      // compared the row's token to a request header — a value the caller sets
      // freely, so it proved nothing. The routine also whitelists the columns
      // it will touch, and never sms_consent: consent is granted server-side.
      (supabase.rpc as unknown as (fn: string, args: Record<string, unknown>) => Promise<{ error: { message: string } | null }>)(
        'save_abandoned_booking',
        {
          _session_token: sessionTokenRef,
          _organization_id: organizationId,
          _first_name: nameParts[0] || null,
          _last_name: nameParts.slice(1).join(' ') || null,
          _email: customerInfo.email || null,
          _phone: customerInfo.phone,
          _service_id: selectedService || null,
          _step_reached: step,
          _form_snapshot: buildFormSnapshot(),
        },
      ).then(({ error }) => {
        if (error) {
          console.log('Abandoned tracking skipped:', error.message);
          return;
        }
        abandonedTrackedRef.tracked = true;
      });
    }, 800);
    return () => clearTimeout(timer);
  // eslint-disable-next-line react-hooks/exhaustive-deps -- ref values (abandonedTrackedRef, buildFormSnapshot, sessionTokenRef) are stable across renders
  }, [step, customerInfo, organizationId, selectedService, selectedSqFtIndex, selectedExtras,
      selectedBedrooms, selectedBathrooms, hasPets, selectedHomeCondition, selectedFrequency,
      selectedDate, selectedTime, schedulingMode, roomReductions]);

  // Ask the server to record consent. The client cannot write sms_consent
  // itself by design, so this is the only path that grants it — and if the
  // endpoint is unavailable the failure mode is "no consent recorded", which
  // means no text is ever sent. Fails safe.
  useEffect(() => {
    if (!customerInfo.smsConsent || !abandonedTrackedRef.tracked || consentSentRef.sent) return;
    if (!organizationId) return;
    consentSentRef.sent = true;
    supabase.functions
      .invoke('record-booking-consent', {
        body: { session_token: sessionTokenRef, organization_id: organizationId },
      })
      .then(({ error }) => {
        if (error) {
          consentSentRef.sent = false;
          console.log('Consent not recorded:', error.message);
        }
      });
  // eslint-disable-next-line react-hooks/exhaustive-deps -- ref values (abandonedTrackedRef.tracked, consentSentRef, sessionTokenRef) are stable across renders
  }, [customerInfo.smsConsent, organizationId, step]);

  // Rehydrate from a recovery SMS link: /book/{slug}?resume={token}.
  // Anonymous visitors cannot SELECT this table, so the read goes through an
  // edge function. Any failure — unknown token, expired, endpoint not deployed
  // — silently starts a normal booking. Never surface an error here: that would
  // tell a stranger whether a token is real.
  useEffect(() => {
    if (!resumeToken || !orgSlug) return;
    let cancelled = false;
    supabase.functions
      .invoke('resume-abandoned-booking', { body: { slug: orgSlug, token: resumeToken } })
      .then(({ data, error }) => {
        if (cancelled || error || !data) return;
        const snap = (data as { form_snapshot?: Record<string, unknown> } | null)?.form_snapshot;
        if (!snap || snap.v !== 1) return;
        const s = snap as ReturnType<typeof buildFormSnapshot>;
        if (s.customerInfo) setCustomerInfo((prev) => ({ ...prev, ...s.customerInfo, smsConsent: prev.smsConsent }));
        if (s.selectedService) setSelectedService(s.selectedService);
        if (s.selectedSqFtIndex !== null && s.selectedSqFtIndex !== undefined) setSelectedSqFtIndex(s.selectedSqFtIndex);
        if (Array.isArray(s.selectedExtras)) setSelectedExtras(s.selectedExtras);
        if (s.selectedBedrooms) setSelectedBedrooms(s.selectedBedrooms);
        if (s.selectedBathrooms) setSelectedBathrooms(s.selectedBathrooms);
        if (typeof s.hasPets === 'boolean') setHasPets(s.hasPets);
        if (s.selectedHomeCondition) setSelectedHomeCondition(s.selectedHomeCondition);
        if (s.roomReductions) setRoomReductions(s.roomReductions);
        if (s.selectedFrequency) setSelectedFrequency(s.selectedFrequency);
        if (s.selectedTime) setSelectedTime(s.selectedTime);
        if (s.schedulingMode) setSchedulingMode(s.schedulingMode);
        // Date is intentionally NOT restored — a slot chosen days ago may no
        // longer be available, and showing it as still selected is worse than
        // asking again.
        if (typeof s.step === 'number') setStep(Math.min(Math.max(s.step, 1), 3));
      });
    return () => { cancelled = true; };
  }, [resumeToken, orgSlug]);

  // Update step_reached if already tracked. Deliberately fire-and-forget:
  // funnel-step telemetry only. Goes through the same SECURITY DEFINER routine
  // as the initial save, which only ever touches step/converted here.
  useEffect(() => {
    if (abandonedTrackedRef.tracked && step > 3) {
      fireAndForget(
        markAbandonedProgress({ _session_token: sessionTokenRef, _step_reached: step }),
        'abandoned_bookings: step reached',
      );
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps -- ref values (abandonedTrackedRef.tracked, sessionTokenRef) are stable across renders
  }, [step]);

  // Mark as converted when booking completes. Both writes are abandonment
  // telemetry — the booking itself is already created and confirmed by this
  // point, so a failure here must not surface to the customer.
  useEffect(() => {
    if (confirmationNumber && abandonedTrackedRef.tracked) {
      fireAndForget(
        markAbandonedProgress({ _session_token: sessionTokenRef, _converted: true }),
        'abandoned_bookings: converted',
      );
    }
    // Also mark link tracking as completed
    if (confirmationNumber && trackingRef) {
      fireAndForget(
        supabase
          .from('booking_link_tracking' as any)
          .update({ booking_completed_at: new Date().toISOString(), status: 'completed' })
          .eq('tracking_ref', trackingRef),
        'booking_link_tracking: booking completed',
      );
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps -- ref values (abandonedTrackedRef.tracked, sessionTokenRef, trackingRef) are stable across renders
  }, [confirmationNumber]);

  const service = services.find(s => s.id === selectedService);

  const calculateTotal = () => {
    let total = 0;

    if (service) {
      const result = calculateBasePrice({
        sqftPrices: service.prices,
        bedroomPricing: (service.bedroomPricing ?? bedroomPricing) as any,
        minimumPrice: service.minimumPrice,
        squareFootageIndex: selectedSqFtIndex,
        bedrooms: selectedBedrooms,
        bathrooms: selectedBathrooms,
        // Prefer bed/bath when both selected (matches previous behavior).
        pricingMode: (selectedBedrooms || selectedBathrooms) ? 'bedroom' : 'sqft',
        fallbackBasePrice: service.minimumPrice,
      });
      total = result.base;
    }

    // Add extras
    const extrasTotal = selectedExtras.reduce((sum, extraId) => {
      const extra = extras.find(e => e.id === extraId);
      return sum + (extra?.price || 0);
    }, 0);
    total += extrasTotal;

    // Add pet fee (single org-wide toggle)
    if (hasPets && petFee > 0) total += petFee;

    // Apply room-reduction discounts ("don't need entire home cleaned").
    // Each excluded room type is skipped; each remaining type reduces total by
    // (count * reduction price). Never allow the base to go below service minimum.
    const reductionsTotal = (Object.keys(roomReductions) as Array<keyof typeof roomReductions>)
      .filter((k) => !excludedRoomTypes.includes(k))
      .reduce((sum, k) => sum + (roomReductions[k] || 0) * (roomReductionPrices[k] || 0), 0);
    if (reductionsTotal > 0) {
      const floor = service?.minimumPrice ?? 0;
      total = Math.max(floor, total - reductionsTotal);
    }

    // Add home condition fee
    if (selectedHomeCondition && homeConditionOptions.length > 0) {
      const condition = homeConditionOptions.find(c => String(c.id) === selectedHomeCondition);
      if (condition) total += condition.price;
    }

    // Apply frequency discount — pulled from per-org business_settings.
    // The helper handles both 'bi-weekly' (public form) and 'biweekly'
    // (admin form) ids and falls back to the prior hardcoded values when
    // business_settings is missing the columns. Custom frequencies
    // (id shape "custom:<uuid>") take precedence via their own discount_pct.
    if (selectedFrequency !== 'one-time') {
      const customPct = resolveCustomFrequencyDiscountPct({
        frequencyId: selectedFrequency,
        customFrequencies,
      });
      const discountMult = customPct > 0
        ? customPct / 100
        : getFrequencyDiscountMultiplier(selectedFrequency, recurringDiscountConfig);
      if (discountMult > 0) total = total * (1 - discountMult);
    }

    // Apply surge multiplier
    const surge = getSurgeMultiplier();
    if (surge > 1) total = total * surge;

    return Math.round(total);
  };

  // Compute surge multiplier based on selected date/time and org settings
  const getSurgeMultiplier = (): number => {
    if (!selectedDate || !surgeSettings) return 1;
    const { surge_weekend_enabled, surge_weekend_multiplier, surge_lastminute_enabled, surge_lastminute_hours, surge_lastminute_multiplier, surge_holiday_enabled, surge_holiday_multiplier } = surgeSettings;
    let multiplier = 1;

    // Weekend
    // selectedDate is a date-picker token, and a calendar date falls on the same
    // weekday in every timezone. 1 Aug 2026 is a Saturday in Manila and in Miami
    // alike, so there is nothing to convert here.
    // eslint-disable-next-line local/no-device-local-dates
    const dow = selectedDate.getDay(); // 0=Sun, 6=Sat
    if (surge_weekend_enabled && (dow === 0 || dow === 6)) {
      multiplier = Math.max(multiplier, surge_weekend_multiplier);
    }

    // Last-minute (booking date within N hours from now)
    if (surge_lastminute_enabled && selectedTime) {
      // toISOString() gave the UTC calendar date, which is the PREVIOUS day for
      // anyone east of UTC — so a customer there had last-minute surge priced
      // off the wrong day. selectedDateTimeToUTCISO resolves the picked day and
      // time against the ORG's clock, which is what "9am" on that booking means.
      const scheduledMs = new Date(
        selectedDateTimeToUTCISO(selectedDate, selectedTime, orgTimezone),
      ).getTime();
      const hoursUntil = (scheduledMs - Date.now()) / 3600000;
      if (hoursUntil > 0 && hoursUntil <= surge_lastminute_hours) {
        multiplier = Math.max(multiplier, surge_lastminute_multiplier);
      }
    }

    // Holiday. Computed per year, not a frozen month/day list: six US federal
    // holidays are observed-date and move annually (Thanksgiving, MLK,
    // Presidents', Memorial, Labor, Columbus). The previous hardcoded array was
    // already a day or two off for 2026 and would have surcharged customers on
    // ordinary days from 2027 while missing the real holidays.
    if (surge_holiday_enabled && isUsHoliday(selectedDate)) {
      multiplier = Math.max(multiplier, surge_holiday_multiplier);
    }

    return multiplier;
  };

  const buildScheduledAt = () => {
    if (!selectedDate || !selectedTime) return new Date().toISOString();
    // selectedTime is "HH:mm" in org timezone, convert to UTC
    return selectedDateTimeToUTCISO(selectedDate, selectedTime, orgTimezone);
  };

  const handleNext = async () => {
    if (step === 4) {
      // Step 4 is card step — submit booking after card is saved
      setIsSubmitting(true);
      
      try {
        const extraNames = selectedExtras.map(id => extras.find(e => e.id === id)?.name).filter(Boolean) as string[];
        const scheduledAt = buildScheduledAt();
        const nameParts = customerInfo.name.trim().split(/\s+/);
        const firstName = nameParts[0] || '';
        const lastName = nameParts.slice(1).join(' ') || '';

        // public-booking-submit, not external-booking-webhook: the latter requires
        // an x-webhook-secret this browser cannot hold, and has 401'd every public
        // submission since ~2026-05-09. The new endpoint takes no secret and is
        // defended by per-IP/org/email rate limits instead.
        //
        // Response shape is UNCHANGED — it returns createBookingFromPayload()
        // directly, and that module was a pure extraction from the old webhook.
        // Verified byte-identical: { success, booking_id, booking_number,
        // customer_id, message } on 200, and { success:false, error, conflict:true }
        // on 409. total_amount is still absent, so the fallback below stays correct.
        const { data: webhookResult, error: webhookError } = await supabase.functions.invoke('public-booking-submit', {
          body: {
            first_name: firstName,
            last_name: lastName,
            email: customerInfo.email,
            phone: customerInfo.phone,
            address: customerInfo.address,
            city: customerInfo.city,
            state: customerInfo.state,
            zip_code: customerInfo.zipCode,
            latitude: customerInfo.latitude ?? undefined,
            longitude: customerInfo.longitude ?? undefined,
            service_name: service?.name || '',
            scheduled_at: scheduledAt,
            duration: service?.duration || 120,
            total_amount: calculateTotal(),
            frequency: selectedFrequency,
            notes: customerInfo.notes || undefined,
            extras: selectedExtras.length > 0 ? { names: extraNames } : undefined,
            organization_id: organizationId || undefined,
            organization_slug: orgSlug || undefined,
            square_footage: selectedSqFtIndex !== null ? squareFootageRanges[selectedSqFtIndex].label : undefined,
            has_pets: hasPets,
            room_reductions: roomReductions,
            ...(schedulingMode === 'arrival_window' && selectedTime
              ? (() => {
                  const w = arrivalWindows.find((x) => x.enabled && x.start_time === selectedTime);
                  return w
                    ? {
                        is_arrival_window: true,
                        arrival_window_start: w.start_time,
                        arrival_window_end: w.end_time,
                      }
                  : {};
              })()
            : {}),
            ...(trackingRef ? { referral_code: trackingRef } : {}),
          },
        });

        if (webhookError) {
          console.error('Booking creation error:', webhookError);

          // The body has to be read off error.context. supabase.functions.invoke
          // sets `data` to null on ANY non-2xx, so the previous
          // `webhookResult?.conflict` was always undefined and this branch had
          // never once fired — a double-booking showed the same generic message
          // as everything else, and never sent the customer back to re-pick.
          const body = await readEdgeFunctionErrorBody(webhookError);
          const serverMessage = typeof body?.error === 'string' && body.error.trim()
            ? body.error.trim()
            : null;

          // Conflict: the slot went while they were filling the form. Send them
          // back to step 2 with fresh availability, which was always the intent.
          if (body?.conflict === true || webhookResult?.conflict === true) {
            toast.error(serverMessage || 'That time was just booked — pick another time.');
            setStep(2);
            fetchAvailability(); // Refresh slots
            setIsSubmitting(false);
            return;
          }

          // Field-level validation beats "Invalid input" — the function returns
          // zod's flatten().fieldErrors under `details`.
          const fieldMessage = firstFieldError(body?.details);

          // Prefer whatever the function actually said. It writes for customers:
          // "Too many booking attempts. Please wait a few minutes and try again."
          // is both true and actionable, where the old fallback told a
          // rate-limited customer to retry — the one thing being throttled.
          toast.error(fieldMessage || serverMessage || 'Failed to create booking. Please try again.');
          setIsSubmitting(false);
          return;
        }

        const bookingNumber = webhookResult?.booking_number || '';
        const newConfirmationNumber = bookingNumber ? `BK-${bookingNumber}` : `BK-${Math.random().toString(36).substr(2, 9).toUpperCase()}`;
        setConfirmationNumber(newConfirmationNumber);

        // Fire conversion events to Meta Pixel + GA4 for the org's ad manager.
        //
        // Purchase reports the PERSISTED total returned by the webhook, not
        // calculateTotal(). The browser-computed number is client-supplied and
        // therefore forgeable — reporting it means a forged booking total also
        // forges this org's reported ad revenue, corrupting ROAS in Meta and GA4
        // and any spend decision made from them. See
        // docs/security/2026-07-29-booking-price-authority.md.
        //
        // If the webhook did not return a total (older deployed version), fall
        // back to the estimate so a conversion is not lost — but report it, since
        // a silent fallback would mean this fix appears done while still sending
        // the forgeable number.
        const serverTotal = typeof webhookResult?.total_amount === 'number'
          ? webhookResult.total_amount
          : null;

        // NOTE: external-booking-webhook does not return total_amount yet — the
        // Lovable prompt for that is queued, not deployed
        // (docs/superpowers/prompts/, "webhook returns the total"). So this
        // fallback is currently the ONLY path, on every booking in every org.
        //
        // The Sentry warning that was here fired on all of them. A warning that
        // is always true is not a signal, it is noise that buries the real ones,
        // so it is removed until the webhook actually returns the value — at
        // which point a fallback becomes genuinely exceptional and worth
        // reporting again. Re-add it in the same change that deploys the webhook.

        trackConversion('Purchase', {
          value: serverTotal ?? calculateTotal(),
          currency: 'USD',
          content_name: service?.name || 'Cleaning Service',
          transaction_id: newConfirmationNumber,
        });

        toast.success(`Booking confirmed! Your confirmation number is ${newConfirmationNumber}. You'll receive an SMS confirmation shortly.`);
        setStep(5);
      } catch (err) {
        console.error('Failed to create booking:', err);
        toast.error('Something went wrong. Please try again.');
      } finally {
        setIsSubmitting(false);
      }
    } else if (step < 5) {
      // Lead event when customer completes contact info (step 3 → 4)
      if (step === 3 && customerInfo.email && customerInfo.phone) {
        trackConversion('Lead', {
          value: calculateTotal(),
          currency: 'USD',
          content_name: service?.name || 'Cleaning Service',
        });
      }
      // InitiateCheckout event when moving to payment step (step 4)
      if (step === 3) {
        trackConversion('InitiateCheckout', {
          value: calculateTotal(),
          currency: 'USD',
          content_name: service?.name || 'Cleaning Service',
        });
      }
      setStep(step + 1);
    }
  };

  const handleBack = () => {
    if (step > 1) setStep(step - 1);
  };

  const toggleExtra = (extraId: string) => {
    setSelectedExtras(prev => 
      prev.includes(extraId) 
        ? prev.filter(id => id !== extraId)
        : [...prev, extraId]
    );
  };

  const canProceed = () => {
    switch (step) {
      case 1: return selectedService !== null;
      case 2: return selectedDate !== undefined && selectedTime !== null;
      case 3: return customerInfo.name && customerInfo.email && customerInfo.phone && customerInfo.address;
      case 4: return cardSaved;
      default: return true;
    }
  };

  // Steps config — 5 steps now (card step added)
  const steps = [
    { num: 1, label: 'Select Service' },
    { num: 2, label: 'Choose Time' },
    { num: 3, label: 'Your Details' },
    { num: 4, label: 'Payment Method' },
    { num: 5, label: 'Confirmation' },
  ];

  if (pricingLoading) {
    return (
      <>
      <SEOHead title="Book a Cleaning Service | TidyWise" description="Book your cleaning service online in minutes." noIndex />
      <div className="portal-v2 portal-v2-scroll min-h-screen bg-background flex items-center justify-center">
        <div className="text-center space-y-4">
          <div className="w-16 h-16 rounded-full bg-primary/10 flex items-center justify-center mx-auto animate-pulse">
            <CalendarIcon className="w-8 h-8 text-primary" />
          </div>
          <Loader2 className="w-8 h-8 animate-spin text-primary mx-auto" />
          <p className="text-muted-foreground">Loading booking form...</p>
        </div>
      </div>
      </>
    );
  }

  // Build custom style overrides from formColors
  const customColorStyles: React.CSSProperties = {};
  if (formColors.bg) customColorStyles.backgroundColor = formColors.bg;
  if (formColors.text) customColorStyles.color = formColors.text;

  const baseThemeStyles: React.CSSProperties = isLight ? {
    '--background': '0 0% 100%',
    '--foreground': '222 47% 11%',
    '--card': '220 20% 97%',
    '--card-foreground': '222 47% 11%',
    '--popover': '0 0% 100%',
    '--popover-foreground': '222 47% 11%',
    '--primary': '221 83% 46%',
    '--primary-foreground': '210 40% 98%',
    '--secondary': '220 20% 93%',
    '--secondary-foreground': '222 47% 11%',
    '--muted': '220 14% 90%',
    '--muted-foreground': '215 20% 40%',
    '--accent': '220 16% 90%',
    '--accent-foreground': '222 47% 11%',
    '--border': '220 20% 82%',
    '--input': '220 20% 82%',
    '--ring': '221 83% 46%',
    '--success': '142 76% 30%',
    '--success-foreground': '0 0% 100%',
  } as React.CSSProperties : {};

  // Merge custom card/button colors as CSS custom properties
  if (formColors.card) {
    (baseThemeStyles as any)['--form-card-bg'] = formColors.card;
  }
  if (formColors.button) {
    (baseThemeStyles as any)['--form-button-bg'] = formColors.button;
  }
  if (formColors.buttonText) {
    (baseThemeStyles as any)['--form-button-text'] = formColors.buttonText;
  }
  if (formColors.accent) {
    (baseThemeStyles as any)['--form-accent'] = formColors.accent;
  }

  return (
    <div
      className={cn("min-h-screen", isLight ? "bg-white text-gray-900" : "bg-background")}
      style={{ ...baseThemeStyles, ...customColorStyles }}
    >
      <TrackingPixels metaPixelId={trackingIds.meta_pixel_id} googleAnalyticsId={trackingIds.google_analytics_id} />
      {/* Header */}
      <header className={cn(isLight ? "bg-secondary border-b border-border" : "bg-sidebar text-sidebar-foreground")}>
        <div className="container mx-auto px-4 py-4">
          <div className="flex items-center justify-between">
            {(() => {
              const brand = (
                <>
                  {logoUrl ? (
                    <img src={logoUrl} alt={organizationName} className="w-10 h-10 rounded-xl object-cover" width={40} height={40} loading="lazy" />
                  ) : (
                    <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-primary to-accent flex items-center justify-center">
                      <CalendarIcon className="w-6 h-6 text-primary-foreground" />
                    </div>
                  )}
                  <div>
                    <h1 className="text-xl font-bold">{organizationName || 'Book Your Service'}</h1>
                    <p className={cn("text-sm", isLight ? "text-muted-foreground" : "text-sidebar-foreground/70")}>Book your service online</p>
                  </div>
                </>
              );
              // target="_top" rather than _self: standalone it behaves as the
              // same tab, embedded it breaks the customer out of the iframe
              // instead of loading the site inside the booking widget.
              return safeWebsiteUrl ? (
                <a
                  href={safeWebsiteUrl}
                  target="_top"
                  rel="noopener"
                  className="flex items-center gap-3 rounded-xl transition-all hover:brightness-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  aria-label={organizationName ? `Return to ${organizationName}` : 'Return to website'}
                >
                  {brand}
                </a>
              ) : (
                <div className="flex items-center gap-3">{brand}</div>
              );
            })()}
          </div>
        </div>
      </header>

      {/* Progress Steps */}
      <div className={cn("border-b", isLight ? "border-border bg-secondary" : "border-border bg-card")}>
        <div className="container mx-auto px-4 py-3">
          <div className="flex items-center justify-center gap-4 md:gap-8 overflow-x-auto">
            {steps.map((s, i) => (
              <div key={s.num} className="flex items-center gap-2 md:gap-3 shrink-0">
                <div
                  className={cn(
                    'w-8 h-8 rounded-full flex items-center justify-center text-sm font-medium transition-colors',
                    step > s.num
                      ? 'bg-success text-success-foreground'
                      : step === s.num
                      ? 'bg-primary text-primary-foreground'
                      : 'bg-muted text-muted-foreground'
                  )}
                >
                  {step > s.num ? <Check className="w-4 h-4" /> : s.num}
                </div>
                <span
                  className={cn(
                    'text-sm font-medium hidden sm:block',
                    step >= s.num ? 'text-foreground' : 'text-muted-foreground'
                  )}
                >
                  {s.label}
                </span>
                {i < steps.length - 1 && (
                  <div className="w-8 md:w-12 h-0.5 bg-border hidden md:block" />
                )}
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Main Content */}
      <main className="container mx-auto px-4 py-6">
        <div className="max-w-4xl mx-auto">
          {/* Step 1: Select Service & Square Footage */}
          {step === 1 && (
            <div className="animate-fade-in space-y-6">

              {/* Service Selection */}
              <div>
                <h2 className="text-2xl font-bold mb-2">Select a Service</h2>
                <p className="text-muted-foreground mb-4">Choose the cleaning type you need</p>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {services.map((svc) => {
                    // Bug fix: use the same pricing engine as the summary/add-ons flow so the
                    // per-service card shows a real amount whether the user is in sqft mode OR
                    // bed/bath mode. Previously this only read sqft prices, so bed/bath selections
                    // never populated the service amount.
                    const svcPricing = calculateBasePrice({
                      sqftPrices: svc.prices,
                      bedroomPricing: (svc.bedroomPricing ?? bedroomPricing) as any,
                      minimumPrice: svc.minimumPrice,
                      squareFootageIndex: selectedSqFtIndex,
                      bedrooms: selectedBedrooms,
                      bathrooms: selectedBathrooms,
                      pricingMode: (selectedBedrooms || selectedBathrooms) ? 'bedroom' : 'sqft',
                      fallbackBasePrice: svc.minimumPrice,
                    });
                    const price = svcPricing.base;
                    const isMinPrice = selectedSqFtIndex === null && !selectedBedrooms && !selectedBathrooms;
                    
                    return (
                      <Card
                        key={svc.id}
                        className={cn(
                          'cursor-pointer transition-all hover:shadow-md',
                          selectedService === svc.id && 'ring-2 ring-primary'
                        )}
                        onClick={() => setSelectedService(svc.id)}
                      >
                        <CardContent className="p-5">
                          <div className="flex items-start gap-4">
                            <div
                              className="w-12 h-12 rounded-xl flex items-center justify-center shrink-0"
                              style={{ backgroundColor: `${svc.color}20`, color: svc.color }}
                            >
                              <CalendarIcon className="w-6 h-6" />
                            </div>
                            <div className="flex-1 min-w-0">
                              <h3 className="font-semibold">{svc.name}</h3>
                              <p className="text-sm text-muted-foreground mt-1 line-clamp-2">{svc.description}</p>
                              <div className="flex items-center gap-2 mt-3">
                                <div className="flex items-center gap-1 text-lg font-bold text-success">
                                  <DollarSign className="w-5 h-5" />
                                  {price}
                                </div>
                                {isMinPrice && (
                                  <span className="text-xs text-muted-foreground">(min price)</span>
                                )}
                              </div>
                            </div>
                            {selectedService === svc.id && (
                              <div className="w-6 h-6 rounded-full bg-primary flex items-center justify-center shrink-0">
                                <Check className="w-4 h-4 text-primary-foreground" />
                              </div>
                            )}
                          </div>
                        </CardContent>
                      </Card>
                    );
                  })}
                </div>
              </div>
              {/* Square Footage Selection */}
              {displaySettings.show_sqft_on_booking && (
                <div>
                  <h2 className="text-2xl font-bold mb-2">Home Size</h2>
                  <p className="text-muted-foreground mb-4">Select your home's square footage</p>
                  <Card>
                    <CardContent className="p-5">
                      <div className="flex items-center gap-3 mb-4">
                        <Ruler className="w-5 h-5 text-primary" />
                        <Label className="text-base">Square Footage</Label>
                      </div>
                      <Select 
                        value={selectedSqFtIndex?.toString() ?? ''} 
                        onValueChange={(val) => setSelectedSqFtIndex(parseInt(val))}
                      >
                        <SelectTrigger className="w-full">
                          <SelectValue placeholder="Select your home size" />
                        </SelectTrigger>
                        <SelectContent>
                          {squareFootageRanges.map((range, index) => (
                            <SelectItem key={index} value={index.toString()}>
                              {range.label}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </CardContent>
                  </Card>
                </div>
              )}

              {/* Bed & Bath Selection */}
              {displaySettings.show_bed_bath_on_booking && bedroomPricing.length > 0 && (
                <div>
                  <h2 className="text-2xl font-bold mb-2">Bedrooms & Bathrooms</h2>
                  <p className="text-muted-foreground mb-4">Select your home layout</p>
                  <Card>
                    <CardContent className="p-5 space-y-4">
                      {!excludedRoomTypes.includes('bedroom') && (
                        <div>
                          <Label className="text-base mb-2 block">Bedrooms</Label>
                          <div className="flex flex-wrap gap-2">
                            {[...new Set(bedroomPricing.map(bp => bp.bedrooms))].sort((a, b) => a - b).map(bed => (
                              <Button
                                key={bed}
                                type="button"
                                variant={selectedBedrooms === String(bed) ? 'default' : 'outline'}
                                onClick={() => setSelectedBedrooms(String(bed))}
                                className="min-w-[60px]"
                              >
                                {bed}
                              </Button>
                            ))}
                          </div>
                        </div>
                      )}
                      {!excludedRoomTypes.includes('bathroom') && (
                        <div>
                          <Label className="text-base mb-2 block">Bathrooms</Label>
                          <div className="flex flex-wrap gap-2">
                            {[...new Set(bedroomPricing.map(bp => bp.bathrooms))]
                              .sort((a, b) => a - b)
                              .map(bath => (

                                <Button
                                  key={bath}
                                  type="button"
                                  variant={selectedBathrooms === String(bath) ? 'default' : 'outline'}
                                  onClick={() => setSelectedBathrooms(String(bath))}
                                  className="min-w-[60px]"
                                >
                                  {bath}
                                </Button>
                              ))}
                          </div>
                        </div>
                      )}
                    </CardContent>
                  </Card>
                </div>
              )}

              {/* Room reducer — customer can skip rooms for a discount */}
              {(selectedBedrooms || selectedBathrooms) && (
                <Collapsible open={reducerOpen} onOpenChange={setReducerOpen}>
                  <CollapsibleTrigger asChild>
                    <Button variant="ghost" size="sm" className="text-muted-foreground">
                      {reducerOpen ? '−' : '+'} Don't need the entire home cleaned?
                    </Button>
                  </CollapsibleTrigger>
                  <CollapsibleContent>
                    <Card className="mt-2">
                      <CardContent className="p-5 space-y-4">
                        <p className="text-sm text-muted-foreground">
                          Skip rooms you don't need cleaned and lower your total.
                        </p>
                        {(['bedroom','bathroom','full_bath'] as const)
                          .filter((k) => !excludedRoomTypes.includes(k))
                          .map((k) => {
                            const labels = { bedroom: 'Bedrooms to skip', bathroom: 'Bathrooms to skip', full_bath: 'Full baths to skip' };
                            const price = roomReductionPrices[k] || 0;
                            const value = roomReductions[k] || 0;
                            return (
                              <div key={k} className="flex items-center justify-between gap-3">
                                <div>
                                  <div className="font-medium text-sm">{labels[k]}</div>
                                  <div className="text-xs text-muted-foreground">-${price} each</div>
                                </div>
                                <div className="flex items-center gap-2">
                                  <Button
                                    type="button"
                                    variant="outline"
                                    size="icon"
                                    className="h-8 w-8"
                                    onClick={() => setRoomReductions((prev) => ({ ...prev, [k]: Math.max(0, (prev[k] || 0) - 1) }))}
                                    disabled={value === 0}
                                    aria-label={`Decrease ${labels[k]}`}
                                  >
                                    <Minus className="h-3 w-3" />
                                  </Button>
                                  <span className="w-6 text-center font-medium">{value}</span>
                                  <Button
                                    type="button"
                                    variant="outline"
                                    size="icon"
                                    className="h-8 w-8"
                                    onClick={() => setRoomReductions((prev) => ({ ...prev, [k]: (prev[k] || 0) + 1 }))}
                                    aria-label={`Increase ${labels[k]}`}
                                  >
                                    <Plus className="h-3 w-3" />
                                  </Button>
                                </div>
                              </div>
                            );
                          })}
                      </CardContent>
                    </Card>
                  </CollapsibleContent>
                </Collapsible>
              )}





              {/* Extras */}
              {displaySettings.show_addons_on_booking && service && !service.name.toLowerCase().includes('deep') && (
                <div>
                  <h2 className="text-2xl font-bold mb-2">Add Extras</h2>
                  <p className="text-muted-foreground mb-4">Optional add-on services</p>
                  <Card>
                    <CardContent className="p-5">
                      <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3">
                        {extras.map((extra) => (
                          <button
                            type="button"
                            key={extra.id}
                            onClick={() => toggleExtra(extra.id)}
                            aria-pressed={selectedExtras.includes(extra.id)}
                            className={cn(
                              "flex flex-col items-center justify-center text-center p-4 min-h-[88px] rounded-lg border-2 cursor-pointer transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
                              selectedExtras.includes(extra.id)
                                ? "border-primary bg-primary/10"
                                : "border-border hover:border-primary/50"
                            )}
                          >
                            <span className="font-medium text-sm mb-1 text-foreground">{extra.name}</span>
                            <span className="text-primary font-semibold text-base">+${extra.price}</span>
                          </button>
                        ))}
                      </div>
                    </CardContent>
                  </Card>
                </div>
              )}

              {/* Frequency Discount */}
              {displaySettings.show_frequency_discount && (
                <div>
                  <h2 className="text-2xl font-bold mb-2">Service Frequency</h2>
                  <p className="text-muted-foreground mb-4">Save with recurring service</p>
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                    {([
                      { id: 'one-time', label: 'One-Time' },
                      { id: 'weekly', label: 'Weekly' },
                      { id: 'bi-weekly', label: 'Bi-Weekly' },
                      { id: 'monthly', label: 'Monthly' },
                    ] as const).map((base) => {
                      // Pull the actual % from the org's settings so the badge
                      // matches the price applied. 0% renders no badge.
                      const pct = getFrequencyDiscountPct(base.id, recurringDiscountConfig);
                      const freq = { ...base, discount: pct > 0 ? `${pct}% off` : null };
                      return (
                      <Card
                        key={freq.id}
                        className={cn(
                          'cursor-pointer transition-all hover:shadow-md text-center',
                          selectedFrequency === freq.id && 'ring-2 ring-primary'
                        )}
                        onClick={() => setSelectedFrequency(freq.id)}
                      >
                        <CardContent className="p-4">
                          <p className="font-semibold">{freq.label}</p>
                          {freq.discount && (
                            <Badge variant="secondary" className="mt-1 text-success">
                              {freq.discount}
                            </Badge>
                          )}
                        </CardContent>
                      </Card>
                      );
                    })}
                    {customFrequencies.map((cf) => {
                      const dayLabels = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
                      const sub = cf.days_of_week && cf.days_of_week.length > 0
                        ? cf.days_of_week.map((d) => dayLabels[d]).join('/')
                        : `Every ${cf.interval_days} day${cf.interval_days !== 1 ? 's' : ''}`;
                      const id = `custom:${cf.id}`;
                      return (
                        <Card
                          key={cf.id}
                          className={cn(
                            'cursor-pointer transition-all hover:shadow-md text-center',
                            selectedFrequency === id && 'ring-2 ring-primary'
                          )}
                          onClick={() => setSelectedFrequency(id)}
                        >
                          <CardContent className="p-4">
                            <p className="font-semibold">{cf.name}</p>
                            <p className="text-xs text-muted-foreground mt-0.5">{sub}</p>
                            {cf.discount_pct > 0 && (
                              <Badge variant="secondary" className="mt-1 text-success">
                                {cf.discount_pct}% off
                              </Badge>
                            )}
                          </CardContent>
                        </Card>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* Pets — single boolean toggle (org configurable) */}
              {displaySettings.show_pet_options && petToggleEnabled && (
                <div>
                  <h2 className="text-2xl font-bold mb-2">Pets</h2>
                  <p className="text-muted-foreground mb-4">Do you have any pets in the home?</p>
                  <Card>
                    <CardContent className="p-4 flex items-center justify-between gap-4">
                      <div className="flex items-center gap-3">
                        <PawPrint className="h-5 w-5 text-primary" />
                        <div>
                          <p className="font-semibold">Pets in the home</p>
                          {petFee > 0 && (
                            <p className="text-xs text-muted-foreground">
                              A ${petFee} pet fee will be added when enabled.
                            </p>
                          )}
                        </div>
                      </div>
                      <Switch
                        checked={hasPets}
                        onCheckedChange={setHasPets}
                        aria-label="Toggle pet fee"
                      />
                    </CardContent>
                  </Card>
                </div>
              )}




              {/* Home Condition */}
              {displaySettings.show_home_condition && homeConditionOptions.length > 0 && (
                <div>
                  <h2 className="text-2xl font-bold mb-2">Home Condition</h2>
                  <p className="text-muted-foreground mb-4">Rate your home's current condition</p>
                  <div className="space-y-2">
                    {homeConditionOptions.map((condition) => (
                      <Card
                        key={String(condition.id)}
                        className={cn(
                          'cursor-pointer transition-all hover:shadow-md',
                          selectedHomeCondition === String(condition.id) && 'ring-2 ring-primary'
                        )}
                        onClick={() => setSelectedHomeCondition(String(condition.id))}
                      >
                        <CardContent className="p-4 flex items-center justify-between">
                          <span className="font-medium text-sm">{condition.label}</span>
                          {condition.price > 0 && (
                            <span className="text-primary font-semibold text-sm">+${condition.price}</span>
                          )}
                        </CardContent>
                      </Card>
                    ))}
                  </div>
                </div>
              )}
              
              {service && service.description && (
                <div className="p-4 bg-primary/10 border border-primary/20 rounded-lg">
                  <p className="text-sm font-medium text-primary">
                    ✨ {service.description}
                  </p>
                </div>
              )}

              {/* Price Summary */}
              {selectedService && (
                <Card className="bg-primary/5 border-primary/20">
                  <CardContent className="p-5">
                    <div className="flex items-center justify-between">
                      <div>
                        <p className="text-sm text-muted-foreground">Estimated Total</p>
                        <p className="text-3xl font-bold text-primary">${calculateTotal()}</p>
                        {selectedFrequency !== 'one-time' && (
                          <p className="text-xs text-success font-medium mt-1">
                            {selectedFrequency.startsWith('custom:')
                              ? `${customFrequencies.find((c) => `custom:${c.id}` === selectedFrequency)?.name ?? 'Custom'} discount applied`
                              : `${selectedFrequency} discount applied`}
                          </p>
                        )}
                      </div>
                      <div className="text-right">
                        <p className="font-medium">{service?.name}</p>
                        {selectedSqFtIndex !== null && (
                          <p className="text-sm text-muted-foreground">
                            {squareFootageRanges[selectedSqFtIndex].label}
                          </p>
                        )}
                      </div>
                    </div>
                  </CardContent>
                </Card>
              )}
            </div>
          )}

          {/* Step 2: Choose Date & Time */}
          {step === 2 && (
            <div className="animate-fade-in">
              <h2 className="text-2xl font-bold mb-2">Choose Date & Time</h2>
              <p className="text-muted-foreground mb-6">Select your preferred appointment slot</p>
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                <Card>
                  <CardHeader>
                    <CardTitle className="text-lg">Select Date</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <Calendar
                      mode="single"
                      selected={selectedDate}
                      onSelect={setSelectedDate}
                      disabled={(date) => {
                        // "Today" must be the BUSINESS's today, not the
                        // visitor's. This compared against a device-local
                        // midnight, so a customer ahead of the business saw
                        // today already greyed out while the business would
                        // still take the booking — and one behind could pick a
                        // day the business had finished. Across US zones that
                        // is a 3-hour window each evening.
                        //
                        // `date` is a picker token for a calendar cell, so its
                        // day is read as-is; only the comparison point moves.
                        // getDay() is left alone deliberately: the weekday of a
                        // calendar date is the same in every timezone.
                        const cell = calendarDayKey(date);
                        const orgToday = orgDateKey(new Date(), orgTimezone);
                        // eslint-disable-next-line local/no-device-local-dates -- weekday of a calendar date is timezone-independent
                        return cell < orgToday || date.getDay() === 0;
                      }}
                      className="rounded-md border"
                    />
                  </CardContent>
                </Card>
                <Card>
                  <CardHeader>
                    <CardTitle className="text-lg flex items-center gap-2">
                      Select Time
                      <span className="text-xs font-normal text-muted-foreground flex items-center gap-1">
                        <Globe className="w-3 h-3" />
                        {orgTimezone.replace(/_/g, ' ')}
                      </span>
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    {!selectedDate ? (
                      <p className="text-muted-foreground text-center py-8">
                        Please select a date first
                      </p>
                    ) : loadingSlots ? (
                      <div className="flex items-center justify-center py-8 gap-2">
                        <Loader2 className="w-5 h-5 animate-spin text-primary" />
                        <span className="text-muted-foreground">Loading availability...</span>
                      </div>
                    ) : schedulingMode === 'arrival_window' ? (
                      (() => {
                        const enabledWindows = arrivalWindows.filter((w) => w.enabled);
                        if (enabledWindows.length === 0) {
                          return (
                            <div className="text-center py-8">
                              <p className="text-muted-foreground">No arrival windows configured.</p>
                            </div>
                          );
                        }
                        const toMin = (t: string) => {
                          const [h, m] = t.split(':').map(Number);
                          return h * 60 + m;
                        };
                        return (
                          <div className="flex flex-wrap gap-2 max-h-[400px] overflow-y-auto pr-1">
                            {enabledWindows.map((w) => {
                              const startMin = toMin(w.start_time);
                              const endMin = toMin(w.end_time);
                              const anyAvailable = availableSlots.length === 0
                                ? true
                                : availableSlots.some((s) => {
                                    const sMin = toMin(s.time);
                                    return s.available && sMin >= startMin && sMin < endMin;
                                  });
                              const active = selectedTime === w.start_time;
                              return (
                                <Button
                                  key={w.id}
                                  variant={active ? 'default' : 'outline'}
                                  className={cn(
                                    'h-14 px-4 transition-all duration-200 justify-center text-sm whitespace-nowrap',
                                    active && 'ring-2 ring-primary/30 shadow-md',
                                    !anyAvailable && 'opacity-40 cursor-not-allowed line-through'
                                  )}
                                  disabled={!anyAvailable}
                                  onClick={() => setSelectedTime(w.start_time)}
                                >
                                  <Clock className="w-4 h-4 mr-2 shrink-0" />
                                  {w.label || `${formatTime24to12(w.start_time)} - ${formatTime24to12(w.end_time)}`}
                                </Button>
                              );
                            })}
                          </div>
                        );
                      })()
                    ) : availableSlots.length === 0 ? (
                      <div className="text-center py-8">
                        <p className="text-muted-foreground mb-2">No available time slots for this date.</p>
                        <p className="text-sm text-muted-foreground">Please select a different date.</p>
                      </div>
                    ) : (
                      <div className="grid grid-cols-2 gap-2 max-h-[400px] overflow-y-auto pr-1">
                        {availableSlots.map((slot) => (
                          <Button
                            key={slot.time}
                            variant={selectedTime === slot.time ? 'default' : 'outline'}
                            className={cn(
                              'h-12 transition-all duration-200',
                              selectedTime === slot.time && 'ring-2 ring-primary/30 shadow-md',
                              !slot.available && 'opacity-40 cursor-not-allowed line-through'
                            )}
                            disabled={!slot.available}
                            onClick={() => setSelectedTime(slot.time)}
                          >
                            <Clock className="w-4 h-4 mr-2" />
                            {formatTime24to12(slot.time)}
                          </Button>
                        ))}
                      </div>
                    )}
                  </CardContent>
                </Card>
              </div>
            </div>
          )}

          {/* Step 3: Customer Details */}
          {step === 3 && (
            <div className="animate-fade-in">
              <h2 className="text-2xl font-bold mb-2">Your Details</h2>
              <p className="text-muted-foreground mb-6">Please provide your contact information</p>
              <Card>
                <CardContent className="p-6 space-y-4">
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <Label htmlFor="name">Full Name <span className="text-destructive" aria-hidden="true">*</span></Label>
                      <div className="relative">
                        <User className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                        <Input id="name" required placeholder="John Doe" className="pl-9" value={customerInfo.name} onChange={(e) => setCustomerInfo({ ...customerInfo, name: e.target.value })} />
                      </div>
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="email">Email Address <span className="text-destructive" aria-hidden="true">*</span></Label>
                      <div className="relative">
                        <Mail className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                        <Input id="email" required type="email" inputMode="email" autoComplete="email" placeholder="john@example.com" className="pl-9" value={customerInfo.email} onChange={(e) => setCustomerInfo({ ...customerInfo, email: e.target.value })} />
                      </div>
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="phone">Phone Number <span className="text-destructive" aria-hidden="true">*</span></Label>
                      <div className="relative">
                        <Phone className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                        <Input id="phone" required type="tel" inputMode="tel" autoComplete="tel" placeholder="(555) 123-4567" className="pl-9" value={customerInfo.phone} onChange={(e) => setCustomerInfo({ ...customerInfo, phone: e.target.value })} />
                      </div>
                      {/* Its own checkbox, unticked by default, and the label
                          says a text is coming. This is the only record of
                          permission we will ever have — it must not be bundled
                          into the terms agreement below. */}
                      <div className="flex items-start gap-2 pt-1">
                        <Checkbox
                          id="smsConsent"
                          checked={customerInfo.smsConsent}
                          onCheckedChange={(checked) =>
                            setCustomerInfo({ ...customerInfo, smsConsent: checked === true })
                          }
                          className="mt-0.5"
                        />
                        <Label htmlFor="smsConsent" className="text-xs font-normal text-muted-foreground leading-snug cursor-pointer">
                          If I don't finish booking, send me a text so I can pick up where I left off. Message and data rates may apply. Reply STOP to opt out.
                        </Label>
                      </div>
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="address">Street Address <span className="text-destructive" aria-hidden="true">*</span></Label>
                      <div className="relative">
                        <MapPin className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                        <AddressAutocomplete
                          id="address"
                          required
                          value={customerInfo.address}
                          onChange={(v) => setCustomerInfo({ ...customerInfo, address: v, latitude: null, longitude: null })}
                          onResolved={(r) => setCustomerInfo((prev) => ({
                            ...prev,
                            city: r.city || prev.city,
                            state: r.state || prev.state,
                            zipCode: r.zip || prev.zipCode,
                            latitude: r.lat,
                            longitude: r.lng,
                          }))}
                          placeholder="123 Main Street"
                          inputClassName="pl-9"
                        />
                      </div>
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="city">City</Label>
                      <Input id="city" autoComplete="address-level2" placeholder="City" value={customerInfo.city} onChange={(e) => setCustomerInfo({ ...customerInfo, city: e.target.value })} />
                    </div>
                    <div className="grid grid-cols-2 gap-3">
                      <div className="space-y-2">
                        <Label htmlFor="state">State</Label>
                        <Input id="state" autoComplete="address-level1" placeholder="State" value={customerInfo.state} onChange={(e) => setCustomerInfo({ ...customerInfo, state: e.target.value })} />
                      </div>
                      <div className="space-y-2">
                        <Label htmlFor="zipCode">ZIP Code</Label>
                        <Input id="zipCode" inputMode="numeric" autoComplete="postal-code" placeholder="12345" value={customerInfo.zipCode} onChange={(e) => setCustomerInfo({ ...customerInfo, zipCode: e.target.value })} />
                      </div>
                    </div>
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="notes">Special Instructions (Optional)</Label>
                    <Textarea id="notes" placeholder="Any special requests or access instructions..." value={customerInfo.notes} onChange={(e) => setCustomerInfo({ ...customerInfo, notes: e.target.value })} />
                  </div>
                </CardContent>
              </Card>

              {/* Price Summary */}
              <Card className="mt-6 bg-primary/5 border-primary/20">
                <CardContent className="p-6">
                  <div className="space-y-2">
                    <div className="flex justify-between">
                      <span>{service?.name}</span>
                      {/* Bug fix: use pricing engine (same source as service card + total)
                          so the summary populates from bed/bath OR sqft, not just sqft. */}
                      <span>${service ? calculateBasePrice({
                        sqftPrices: service.prices,
                        bedroomPricing: (service.bedroomPricing ?? bedroomPricing) as any,
                        minimumPrice: service.minimumPrice,
                        squareFootageIndex: selectedSqFtIndex,
                        bedrooms: selectedBedrooms,
                        bathrooms: selectedBathrooms,
                        pricingMode: (selectedBedrooms || selectedBathrooms) ? 'bedroom' : 'sqft',
                        fallbackBasePrice: service.minimumPrice,
                      }).base : 0}</span>
                    </div>
                    {selectedExtras.map(extraId => {
                      const extra = extras.find(e => e.id === extraId);
                      if (!extra) return null;
                      return (
                        <div key={extraId} className="flex justify-between items-center text-sm text-muted-foreground gap-2">
                          <button
                            type="button"
                            onClick={() => toggleExtra(extraId)}
                            aria-label={`Remove ${extra.name}`}
                            className="inline-flex items-center justify-center w-5 h-5 rounded-full bg-muted hover:bg-destructive hover:text-destructive-foreground transition-colors shrink-0"
                          >
                            <X className="w-3 h-3" />
                          </button>
                          <span className="flex-1">{extra.name}</span>
                          <span>+${extra.price}</span>
                        </div>
                      );
                    })}
                    {hasPets && petFee > 0 && (
                      <div className="flex justify-between items-center text-sm text-muted-foreground">
                        <span className="flex items-center gap-1"><PawPrint className="h-3 w-3" /> Pet fee</span>
                        <span>+${petFee}</span>
                      </div>
                    )}
                    {(['bedroom','bathroom','full_bath'] as const)
                      .filter((k) => !excludedRoomTypes.includes(k) && (roomReductions[k] || 0) > 0)
                      .map((k) => {
                        const labels = { bedroom: 'Bedrooms skipped', bathroom: 'Bathrooms skipped', full_bath: 'Full baths skipped' };
                        const amt = (roomReductions[k] || 0) * (roomReductionPrices[k] || 0);
                        return (
                          <div key={k} className="flex justify-between items-center text-sm text-success">
                            <span>{labels[k]} × {roomReductions[k]}</span>
                            <span>-${amt}</span>
                          </div>
                        );
                      })}
                    <div className="border-t pt-2 flex justify-between font-bold text-lg">
                      <span>Total</span>
                      <span className="text-primary">${calculateTotal()}</span>
                    </div>
                  </div>
                </CardContent>
              </Card>
            </div>
          )}

          {/* Step 4: Card on File (Required) */}
          {step === 4 && (
            <div className="animate-fade-in space-y-6">
              <h2 className="text-2xl font-bold mb-2">Payment Method</h2>
              <p className="text-muted-foreground mb-6">A card on file is required to complete your booking. Your card will <strong>not</strong> be charged now.</p>
              
              <Card>
                <CardContent className="p-6 space-y-4">
                  <div className="flex items-center gap-3 mb-2">
                    <div className="p-2 rounded-lg bg-primary/10">
                      <CreditCard className="w-5 h-5 text-primary" />
                    </div>
                    <div>
                      <h3 className="font-semibold">Add Card on File</h3>
                      <p className="text-sm text-muted-foreground">Securely stored — only charged when services are rendered</p>
                    </div>
                  </div>

                  {cardSaved ? (
                    <div className="p-4 bg-success/10 border border-success/20 rounded-lg flex items-center gap-3">
                      <Check className="w-5 h-5 text-success" />
                      <div>
                        <p className="font-medium text-success">Card saved successfully!</p>
                        <p className="text-sm text-muted-foreground">You can now complete your booking.</p>
                      </div>
                    </div>
                  ) : organizationId ? (
                    <StripeCardForm
                      email={customerInfo.email}
                      customerName={customerInfo.name}
                      organizationId={organizationId}
                      showHoldOption={false}
                      publicBooking={true}
                      onCardSaved={(cardInfo) => {
                        setCardSaved(true);
                        toast.success(`Card saved: ${cardInfo.brand} ending in ${cardInfo.last4}`);
                      }}
                      onError={(error) => {
                        toast.error(error);
                      }}
                    />
                  ) : (
                    <div className="p-4 bg-destructive/10 border border-destructive/20 rounded-lg">
                      <p className="text-sm text-destructive">Unable to load payment form. Please try again.</p>
                    </div>
                  )}

                  <div className="flex items-center gap-2 text-xs text-muted-foreground pt-2">
                    <Lock className="w-3.5 h-3.5" />
                    <span>Your card info is encrypted and securely processed via Stripe. We never store raw card details.</span>
                  </div>
                </CardContent>
              </Card>

              {/* Price Summary */}
              <Card className="bg-primary/5 border-primary/20">
                <CardContent className="p-5">
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-sm text-muted-foreground">Estimated Total (charged after service)</p>
                      <p className="text-3xl font-bold text-primary">${calculateTotal()}</p>
                    </div>
                    <div className="text-right">
                      <p className="font-medium">{service?.name}</p>
                      <p className="text-sm text-muted-foreground">
                        {selectedSqFtIndex !== null ? squareFootageRanges[selectedSqFtIndex].label : ''}
                      </p>
                    </div>
                  </div>
                </CardContent>
              </Card>
            </div>
          )}

          {/* Step 5: Confirmation */}
          {step === 5 && (
            <div className="animate-fade-in space-y-6">
              <div className="text-center mb-8">
                <div className="w-16 h-16 rounded-full bg-success/20 flex items-center justify-center mx-auto mb-4">
                  <Check className="w-8 h-8 text-success" />
                </div>
                <h2 className="text-2xl font-bold mb-2">Booking Confirmed!</h2>
                <p className="text-muted-foreground">
                  Your appointment has been scheduled. You'll receive an SMS confirmation shortly.
                </p>
              </div>

              {/* Loyalty Points Earned Card */}
              <Card className="bg-gradient-to-br from-primary/10 via-accent/10 to-primary/5 border-primary/20">
                <CardContent className="p-6">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-4">
                      <div className="w-14 h-14 rounded-full bg-gradient-to-br from-primary to-accent flex items-center justify-center">
                        <Star className="w-7 h-7 text-primary-foreground fill-primary-foreground" />
                      </div>
                      <div>
                        <p className="text-sm text-muted-foreground">You earned</p>
                        <p className="text-3xl font-bold text-primary">
                          +{Math.floor(calculateTotal())} <span className="text-lg font-medium">points</span>
                        </p>
                      </div>
                    </div>
                    <div className="text-right">
                      <div className="flex items-center gap-2 text-muted-foreground">
                        <Gift className="w-4 h-4" />
                        <span className="text-sm">Loyalty Rewards</span>
                      </div>
                      <p className="text-xs text-muted-foreground mt-1">
                        1 point per $1 spent
                      </p>
                    </div>
                  </div>
                  <div className="mt-4 pt-4 border-t border-primary/20">
                     <p className="text-sm text-muted-foreground">
                       Track your loyalty progress and tier benefits with each booking!
                     </p>
                  </div>
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle>Booking Summary</CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <p className="text-sm text-muted-foreground">Service</p>
                      <p className="font-medium">{service?.name}</p>
                    </div>
                    <div>
                      <p className="text-sm text-muted-foreground">Home Size</p>
                      <p className="font-medium">
                        {selectedSqFtIndex !== null ? squareFootageRanges[selectedSqFtIndex].label : '-'}
                      </p>
                    </div>
                    <div>
                      <p className="text-sm text-muted-foreground">Total Price</p>
                      <p className="font-semibold text-success">${calculateTotal()}</p>
                    </div>
                    <div>
                      <p className="text-sm text-muted-foreground">Date</p>
                      <p className="font-medium">
                        {/* eslint-disable-next-line local/no-device-local-dates -- renders the day the customer picked, not an instant */}
                        {selectedDate?.toLocaleDateString('en-US', {
                          weekday: 'long',
                          year: 'numeric',
                          month: 'long',
                          day: 'numeric',
                        })}
                      </p>
                    </div>
                    <div>
                      <p className="text-sm text-muted-foreground">Time</p>
                      <p className="font-medium">
                        {(() => {
                          if (!selectedTime) return '';
                          if (schedulingMode === 'arrival_window') {
                            const w = arrivalWindows.find((x) => x.enabled && x.start_time === selectedTime);
                            if (w) {
                              return w.label || `${formatTime24to12(w.start_time)} - ${formatTime24to12(w.end_time)}`;
                            }
                          }
                          return formatTime24to12(selectedTime);
                        })()}
                      </p>
                    </div>
                    <div>
                      <p className="text-sm text-muted-foreground">Customer</p>
                      <p className="font-medium">{customerInfo.name}</p>
                    </div>
                    <div className="col-span-2">
                      <p className="text-sm text-muted-foreground">Address</p>
                      <p className="font-medium">
                        {customerInfo.address}
                        {customerInfo.city && `, ${customerInfo.city}`}
                        {customerInfo.state && `, ${customerInfo.state}`}
                        {customerInfo.zipCode && ` ${customerInfo.zipCode}`}
                      </p>
                    </div>
                    {selectedExtras.length > 0 && (
                      <div className="col-span-2">
                        <p className="text-sm text-muted-foreground">Extras</p>
                        <p className="font-medium">
                          {selectedExtras.map(id => extras.find(e => e.id === id)?.name).join(', ')}
                        </p>
                      </div>
                    )}
                  </div>
                  <div className="pt-4 border-t">
                    <Badge className="bg-success/20 text-success border-success/30">
                      Confirmation #{confirmationNumber}
                    </Badge>
                  </div>
                </CardContent>
              </Card>
            </div>
          )}

          {/* Navigation Buttons */}
          <div className="flex flex-col-reverse sm:flex-row items-stretch sm:items-center justify-between gap-3 mt-8">
            {step > 1 && step < 5 ? (
              <Button variant="outline" size="lg" onClick={handleBack} className="gap-2 sm:w-auto">
                <ArrowLeft className="w-4 h-4" />
                Back
              </Button>
            ) : (
              <span className="hidden sm:block" />
            )}
            {step < 5 && (
              <Button
                onClick={handleNext}
                size="lg"
                disabled={!canProceed() || isSubmitting}
                className="gap-2 sm:w-auto sm:ml-auto"
                style={formColors.button ? {
                  backgroundColor: formColors.button,
                  color: formColors.buttonText || '#ffffff',
                  borderColor: formColors.button,
                } : undefined}
              >
                {isSubmitting ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" />
                    Confirming...
                  </>
                ) : (
                  <>
                    {step === 4 ? 'Confirm Booking' : 'Continue'}
                    <ArrowRight className="w-4 h-4" />
                  </>
                )}
              </Button>
            )}
            {step === 5 && (
              <div className="flex flex-col-reverse sm:flex-row items-stretch sm:items-center gap-3 sm:mx-auto">
                <Button size="lg" variant="outline" onClick={() => { setStep(1); setCardSaved(false); }}>
                  Book Another Service
                </Button>
                {safeWebsiteUrl && (
                  <Button size="lg" asChild>
                    <a href={safeWebsiteUrl} target="_top" rel="noopener">
                      Return to {organizationName || 'our website'}
                    </a>
                  </Button>
                )}
              </div>
            )}
          </div>
        </div>
      </main>

      <footer className="border-t border-border py-6">
        <div className="container mx-auto px-4 text-center text-xs text-muted-foreground">
          <span>By booking you agree to our </span>
          <TermsOfServiceDialog>
            <button className="underline underline-offset-4 hover:text-foreground transition-colors">Terms</button>
          </TermsOfServiceDialog>
          <span> and acknowledge our </span>
          <Link
            to="/privacy-policy"
            className="underline underline-offset-4 hover:text-foreground transition-colors"
          >
            Privacy Policy
          </Link>
          <span>.</span>
        </div>
      </footer>
    </div>
  );
}
