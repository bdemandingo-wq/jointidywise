import { createContext, useContext, useState, ReactNode, useEffect, useMemo, useCallback } from 'react';
import { useCustomers, useServices, useStaff, BookingWithDetails } from '@/hooks/useBookings';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { squareFootageRanges, frequencyOptions } from '@/data/pricingData';
import { useServicePricing } from '@/hooks/useServicePricing';
import { useOrganizationSettings, DEFAULT_ROOM_REDUCTION_PRICES } from '@/hooks/useOrganizationSettings';
import { useOrgId } from '@/hooks/useOrgId';
import { useAuth } from '@/hooks/useAuth';
import { useOrgTimezone } from '@/hooks/useOrgTimezone';
import { getLocalDateInTimezone, getTimeInTimezone } from '@/lib/timezoneUtils';
import { calculateBasePrice } from '@/lib/pricingEngine';
import { useRecurringDiscounts } from '@/hooks/useRecurringDiscounts';
import { getFrequencyDiscountMultiplier } from '@/lib/recurringDiscount';
import { useCustomFrequencies, resolveCustomFrequencyDiscountPct } from '@/hooks/useCustomFrequencies';
import { toast } from 'sonner';

interface CardInfo {
  hasCard: boolean;
  last4?: string;
  brand?: string;
  expMonth?: number;
  expYear?: number;
  paymentMethodId?: string;
}

interface AppliedDiscount {
  id: string;
  code: string;
  discount_type: 'percentage' | 'flat';
  discount_value: number;
  discountAmount: number;
}

interface BookingFormState {
  // Customer
  customerTab: 'existing' | 'new';
  selectedCustomerId: string;
  newCustomer: {
    first_name: string;
    last_name: string;
    email: string;
    phone: string;
    address: string;
    city: string;
    state: string;
    zip_code: string;
  };
  
  // Property
  address: string;
  aptSuite: string;
  city: string;
  state: string;
  zipCode: string;
  /** From Google Places when the address was picked from autocomplete. */
  latitude: number | null;
  longitude: number | null;

  // Service
  selectedServiceId: string;
  squareFootage: string;
  bedrooms: string;
  bathrooms: string;
  frequency: string;
  customFrequencyDays: number | null;
  recurringDaysOfWeek: number[] | null;
  selectedExtras: string[];
  
  // New pricing fields
  pricingMode: 'sqft' | 'bedroom';
  homeCondition: number;
  petOption: string;
  roomReductions: Record<'bedroom' | 'bathroom' | 'full_bath', number>;
  reductionsTotal: number;
  
  
  // Schedule
  selectedDate: Date | undefined;
  selectedTime: string;
  selectedStaffId: string;
  isTeamMode: boolean;
  selectedTeamMembers: string[];
  teamMemberPay: Record<string, number>; // staffId -> pay amount
  
  // Conflict override
  conflictOverride: boolean;
  
  notes: string;
  /**
   * The customer's own words from the booking they submitted. READ-ONLY — there
   * is deliberately no setCustomerNotes on this context. The save path writes
   * `notes` only, so an exposed setter would be a trap that silently discards
   * edits. Rendered by CustomerNotesBlock, never bound to a form control.
   */
  customerNotes: string;
  totalAmount: number;
  cleanerWage: string;
  cleanerWageType: string;
  cleanerOverrideHours: string;
  sendConfirmationEmail: boolean;
  sendConfirmationSms: boolean;
  sendQuoteSms: boolean;
  sendQuoteEmail: boolean;
  
  // Card info
  cardInfo: CardInfo | null;
  loadingCard: boolean;
  
  // Checklist
  selectedChecklistId: string | null;
  
  // Discount
  appliedDiscount: AppliedDiscount | null;
}

interface SavedLocation {
  id: string;
  name: string;
  address: string | null;
  apt_suite: string | null;
  city: string | null;
  state: string | null;
  zip_code: string | null;
  is_primary: boolean | null;
  price_override: number | null;
}

interface BookingFormContextType extends BookingFormState {
  // Editing context
  editingBookingId: string | null;
  
  // Data
  customers: ReturnType<typeof useCustomers>['data'];
  services: ReturnType<typeof useServices>['data'];
  staff: ReturnType<typeof useStaff>['data'];
  
  // Computed
  customerLocations: SavedLocation[];
  selectedLocationId: string | null;
  selectedLocationPriceOverride: number | null;
  selectedService: any;
  selectedCustomer: any;
  customerEmail: string;
  customerName: string;
  extrasTotal: number;
  conditionTotal: number;
  petTotal: number;
  calculatedPrice: number;
  finalPrice: number;
  appliedDiscount: AppliedDiscount | null;
  
  // Setters
  setCustomerTab: (tab: 'existing' | 'new') => void;
  setSelectedCustomerId: (id: string) => void;
  setNewCustomer: (customer: BookingFormState['newCustomer']) => void;
  updateNewCustomer: (field: keyof BookingFormState['newCustomer'], value: string) => void;
  setAddress: (address: string) => void;
  setAptSuite: (aptSuite: string) => void;
  setCity: (city: string) => void;
  setState: (state: string) => void;
  setZipCode: (zipCode: string) => void;
  setLatitude: (lat: number | null) => void;
  setLongitude: (lng: number | null) => void;
  setSelectedServiceId: (id: string) => void;
  setSquareFootage: (sqft: string) => void;
  setBedrooms: (bedrooms: string) => void;
  setBathrooms: (bathrooms: string) => void;
  setFrequency: (frequency: string) => void;
  setCustomFrequencyDays: (days: number | null) => void;
  setRecurringDaysOfWeek: (days: number[] | null) => void;
  toggleExtra: (extraId: string) => void;
  setPricingMode: (mode: 'sqft' | 'bedroom') => void;
  setHomeCondition: (condition: number) => void;
  setPetOption: (option: string) => void;
  setRoomReductions: (reductions: Record<'bedroom' | 'bathroom' | 'full_bath', number>) => void;
  setSelectedDate: (date: Date | undefined) => void;
  setSelectedTime: (time: string) => void;
  setSelectedStaffId: (id: string) => void;
  setIsTeamMode: (mode: boolean) => void;
  setSelectedTeamMembers: (members: string[]) => void;
  setTeamMemberPay: (pay: Record<string, number>) => void;
  updateTeamMemberPay: (staffId: string, amount: number) => void;
  setConflictOverride: (override: boolean) => void;
  setNotes: (notes: string) => void;
  setTotalAmount: (amount: number) => void;
  setCleanerWage: (wage: string) => void;
  setCleanerWageType: (type: string) => void;
  setCleanerOverrideHours: (hours: string) => void;
  setSendConfirmationEmail: (send: boolean) => void;
  setSendConfirmationSms: (send: boolean) => void;
  setSendQuoteSms: (send: boolean) => void;
  setSendQuoteEmail: (send: boolean) => void;
  setCardInfo: (info: CardInfo | null) => void;
  setAppliedDiscount: (discount: AppliedDiscount | null) => void;
  setSelectedChecklistId: (id: string | null) => void;
  setSelectedLocationId: (id: string | null) => void;
  loadCardInfo: (email: string) => Promise<void>;
  resetForm: () => void;
  prefillFromBooking: (booking: BookingWithDetails) => void;
  /** Non-null when the service pricing query failed. The form must not submit
   *  a price it cannot verify — it would fall back to hardcoded defaults. */
  pricingError: Error | null;
}

const BookingFormContext = createContext<BookingFormContextType | undefined>(undefined);

const initialNewCustomer = {
  first_name: '',
  last_name: '',
  email: '',
  phone: '',
  address: '',
  city: '',
  state: '',
  zip_code: ''
};

export function BookingFormProvider({ 
  children, 
  defaultDate,
  booking,
  defaultCustomerId,
}: { 
  children: ReactNode;
  defaultDate?: Date;
  booking?: BookingWithDetails | null;
  defaultCustomerId?: string | null;
}) {
  const { data: customers = [] } = useCustomers();
  const { data: services = [] } = useServices();
  const { data: staff = [] } = useStaff();
  const { organizationId } = useOrgId();
  const { session } = useAuth();
  const { timezone: orgTimezone } = useOrgTimezone();
  
  // Service-specific pricing from database
  const { getServicePricing, loading: pricingLoading, error: pricingError } = useServicePricing();
  const { settings: orgSettings } = useOrganizationSettings();
  // Per-org recurring discount config (one_time / monthly / biweekly / weekly).
  // Falls back to the previous hardcoded values when business_settings is
  // missing the columns or the row hasn't been created yet.
  const { config: recurringDiscountConfig } = useRecurringDiscounts();
  const { customFrequencies } = useCustomFrequencies(organizationId);
  
  // Customer state
  const [customerTab, setCustomerTab] = useState<'existing' | 'new'>('existing');
  const [selectedCustomerId, setSelectedCustomerId] = useState(defaultCustomerId || '');
  const [newCustomer, setNewCustomer] = useState(initialNewCustomer);
  
  // Property state
  const [address, setAddress] = useState('');
  const [aptSuite, setAptSuite] = useState('');
  const [city, setCity] = useState('');
  const [state, setState] = useState('');
  const [zipCode, setZipCode] = useState('');
  const [latitude, setLatitude] = useState<number | null>(null);
  const [longitude, setLongitude] = useState<number | null>(null);
  
  // Service state
  const [selectedServiceId, setSelectedServiceId] = useState('');
  const [squareFootage, setSquareFootage] = useState('');
  const [bedrooms, setBedrooms] = useState('1');
  const [bathrooms, setBathrooms] = useState('1');
  const [frequency, setFrequency] = useState('one_time');
  const [customFrequencyDays, setCustomFrequencyDays] = useState<number | null>(null);
  const [recurringDaysOfWeek, setRecurringDaysOfWeek] = useState<number[] | null>(null);
  const [selectedExtras, setSelectedExtras] = useState<string[]>([]);
  // New pricing fields
  const [pricingMode, setPricingMode] = useState<'sqft' | 'bedroom'>('sqft');
  const [homeCondition, setHomeCondition] = useState(1);
  const [petOption, setPetOption] = useState('no_pets');
  const [roomReductions, setRoomReductions] = useState<Record<'bedroom' | 'bathroom' | 'full_bath', number>>({ bedroom: 0, bathroom: 0, full_bath: 0 });
  
  // Schedule state
  const [selectedDate, setSelectedDate] = useState<Date | undefined>(defaultDate);
  const [selectedTime, setSelectedTime] = useState('');
  const [selectedStaffId, setSelectedStaffId] = useState('');
  const [isTeamMode, setIsTeamMode] = useState(false);
  const [selectedTeamMembers, setSelectedTeamMembers] = useState<string[]>([]);
  const [teamMemberPay, setTeamMemberPay] = useState<Record<string, number>>({});
  const [conflictOverride, setConflictOverride] = useState(false);
  
  const updateTeamMemberPay = (staffId: string, amount: number) => {
    setTeamMemberPay(prev => ({ ...prev, [staffId]: amount }));
  };
  // Payment/Notes state
  const [notes, setNotes] = useState('');
  // The setter stays local — resetForm and prefillFromBooking need it, but it is
  // not exported on the context. See the interface note above.
  const [customerNotes, setCustomerNotes] = useState('');
  const [totalAmount, setTotalAmount] = useState(0);
  const [cleanerWage, setCleanerWage] = useState('');
  const [cleanerWageType, setCleanerWageType] = useState('hourly');
  const [cleanerOverrideHours, setCleanerOverrideHours] = useState('');
  // Default ON so confirmation email + SMS auto-fire on booking create
  const [sendConfirmationEmail, setSendConfirmationEmail] = useState(true);
  const [sendConfirmationSms, setSendConfirmationSms] = useState(true);
  const [sendQuoteSms, setSendQuoteSms] = useState(false);
  const [sendQuoteEmail, setSendQuoteEmail] = useState(false);
  
  // Card state
  const [cardInfo, setCardInfo] = useState<CardInfo | null>(null);
  const [loadingCard, setLoadingCard] = useState(false);
  
  // Discount state
  const [appliedDiscount, setAppliedDiscount] = useState<AppliedDiscount | null>(null);
  
  // Checklist state
  const [selectedChecklistId, setSelectedChecklistId] = useState<string | null>(null);
  
  // Location state for price override
  const [selectedLocationId, setSelectedLocationId] = useState<string | null>(null);
  
  const selectedService = services.find(s => s.id === selectedServiceId);
  const selectedCustomer = customers.find(c => c.id === selectedCustomerId);

  // Fetch saved locations for the selected customer
  const { data: customerLocations = [], error: customerLocationsError } = useQuery({
    queryKey: ['customer-locations', selectedCustomerId, organizationId],
    queryFn: async () => {
      if (!selectedCustomerId || !organizationId) return [];
      const { data, error } = await supabase
        .from('locations')
        .select('id, name, address, apt_suite, city, state, zip_code, is_primary, price_override')
        .eq('customer_id', selectedCustomerId)
        .eq('organization_id', organizationId)
        .order('is_primary', { ascending: false });
      if (error) throw error;
      return (data || []) as SavedLocation[];
    },
    enabled: !!selectedCustomerId && !!organizationId,
  });

  useEffect(() => {
    if (customerLocationsError) toast.error('Could not load saved addresses');
  }, [customerLocationsError]);
  
  // Empty string, not null: every consumer here treats falsy as "no email"
  // and the card-on-file lookup below is already guarded on truthiness.
  const customerEmail = customerTab === 'existing' && selectedCustomer 
    ? (selectedCustomer.email ?? '')
    : newCustomer.email;

  const customerName = customerTab === 'existing' && selectedCustomer
    ? `${selectedCustomer.first_name} ${selectedCustomer.last_name}`
    : `${newCustomer.first_name} ${newCustomer.last_name}`;

  // Get service-specific pricing data
  const servicePricing = useMemo(() => {
    if (!selectedServiceId) return null;
    return getServicePricing(selectedServiceId);
  }, [selectedServiceId, getServicePricing]);

  // Calculate extras total from service-specific pricing
  const extrasTotal = useMemo(() => {
    if (!servicePricing) return 0;
    return selectedExtras.reduce((total, extraId) => {
      const extra = servicePricing.extras.find((e) => e.id === extraId);
      return total + (extra?.price || 0);
    }, 0);
  }, [servicePricing, selectedExtras]);

  // Calculate condition price from service-specific pricing
  const conditionTotal = useMemo(() => {
    if (!servicePricing) return 0;
    const option = servicePricing.home_condition_options.find((o) => o.id === homeCondition);
    return option?.price || 0;
  }, [servicePricing, homeCondition]);

  // Calculate pet price from service-specific pricing
  const petTotal = useMemo(() => {
    if (!servicePricing) return 0;
    const option = servicePricing.pet_options.find((o) => o.id === petOption);
    return option?.price || 0;
  }, [servicePricing, petOption]);

  // Room reduction total from org settings prices
  const reductionsTotal = useMemo(() => {
    const prices = { ...DEFAULT_ROOM_REDUCTION_PRICES, ...(orgSettings?.room_reduction_prices || {}) };
    return (Object.keys(roomReductions) as Array<'bedroom' | 'bathroom' | 'full_bath'>)
      .reduce((sum, k) => sum + (roomReductions[k] || 0) * (prices[k] || 0), 0);
  }, [roomReductions, orgSettings]);


  // Get price override from selected location
  const selectedLocationPriceOverride = useMemo(() => {
    if (!selectedLocationId) return null;
    const loc = customerLocations.find(l => l.id === selectedLocationId);
    return loc?.price_override ?? null;
  }, [selectedLocationId, customerLocations]);

  // Calculate price from service-specific pricing (or property override)
  const calculatedPrice = useMemo(() => {
    // If the selected property has a price override, use it as the base
    if (selectedLocationPriceOverride != null && selectedLocationPriceOverride > 0) {
      let basePrice = selectedLocationPriceOverride;
      
      // Apply frequency discount — pulled from per-org business_settings.
      // For triweekly/anyday (not yet configurable per-org) the helper
      // falls back to the legacy hardcoded values from pricingData.
      const customPct = resolveCustomFrequencyDiscountPct({
        frequencyId: frequency,
        customFrequencyDays,
        recurringDaysOfWeek,
        customFrequencies,
      });
      const discountMult = customPct > 0
        ? customPct / 100
        : getFrequencyDiscountMultiplier(frequency, recurringDiscountConfig);
      if (discountMult > 0 && basePrice > 0) {
        basePrice = Math.round(basePrice * (1 - discountMult));
      }

      return Math.max(0, basePrice + extrasTotal + conditionTotal + petTotal - reductionsTotal);
    }

    if (!selectedService) return 0;
    
    let basePrice = 0;
    
    const hasCustomPricing = servicePricing && (
      (servicePricing.sqft_prices && servicePricing.sqft_prices.length > 0 && servicePricing.sqft_prices.some(p => p > 0)) ||
      (servicePricing.bedroom_pricing && servicePricing.bedroom_pricing.length > 0)
    );
    
    if (hasCustomPricing) {
      const result = calculateBasePrice({
        sqftPrices: servicePricing!.sqft_prices,
        bedroomPricing: servicePricing!.bedroom_pricing,
        minimumPrice: undefined, // applied below alongside the pre-existing path
        squareFootageLabel: squareFootage || null,
        bedrooms: bedrooms || null,
        bathrooms: bathrooms || null,
        pricingMode,
      });
      basePrice = result.base;
    }
    
    if (basePrice === 0 && selectedService.price && selectedService.price > 0) {
      basePrice = Number(selectedService.price);
    }
    
    const customPct = resolveCustomFrequencyDiscountPct({
      frequencyId: frequency,
      customFrequencyDays,
      recurringDaysOfWeek,
      customFrequencies,
    });
    const discountMult = customPct > 0
      ? customPct / 100
      : getFrequencyDiscountMultiplier(frequency, recurringDiscountConfig);
    if (discountMult > 0 && basePrice > 0) {
      basePrice = Math.round(basePrice * (1 - discountMult));
    }

    if (servicePricing?.minimum_price && basePrice > 0 && basePrice < servicePricing.minimum_price) {
      basePrice = servicePricing.minimum_price;
    }
    
    return Math.max(0, basePrice + extrasTotal + conditionTotal + petTotal - reductionsTotal);
  }, [selectedService, servicePricing, pricingMode, squareFootage, bedrooms, bathrooms, frequency, customFrequencyDays, recurringDaysOfWeek, extrasTotal, conditionTotal, petTotal, reductionsTotal, selectedLocationPriceOverride, recurringDiscountConfig, customFrequencies]);

  // Calculate final price after discount
  const finalPrice = useMemo(() => {
    const baseAmount = totalAmount > 0 ? totalAmount : calculatedPrice;
    if (!appliedDiscount) return baseAmount;
    return Math.max(0, baseAmount - appliedDiscount.discountAmount);
  }, [totalAmount, calculatedPrice, appliedDiscount]);

  const updateNewCustomer = (field: keyof typeof initialNewCustomer, value: string) => {
    setNewCustomer(prev => ({ ...prev, [field]: value }));
  };

  const toggleExtra = (extraId: string) => {
    setSelectedExtras(prev => 
      prev.includes(extraId) 
        ? prev.filter(id => id !== extraId)
        : [...prev, extraId]
    );
  };

  const loadCardInfo = useCallback(async (email: string) => {
    if (!email || !organizationId) {
      setCardInfo({ hasCard: false });
      return;
    }
    
    // Check for valid session before making authenticated request
    if (!session?.access_token) {
      console.warn('No active session for loadCardInfo - skipping card lookup');
      setCardInfo({ hasCard: false });
      return;
    }
    
    setLoadingCard(true);
    try {
      // SECURITY FIX: Pass organizationId and auth token to prevent cross-tenant card access
      const { data, error } = await supabase.functions.invoke('get-customer-card', {
        body: { email, organizationId },
        headers: {
          Authorization: `Bearer ${session.access_token}`
        }
      });
      if (error) throw error;
      setCardInfo(data);
    } catch (error) {
      console.error('Error loading card info:', error);
      setCardInfo({ hasCard: false });
    } finally {
      setLoadingCard(false);
    }
  }, [organizationId, session?.access_token]);

  const resetForm = () => {
    setCustomerTab('existing');
    setSelectedCustomerId('');
    setNewCustomer(initialNewCustomer);
    setSelectedServiceId('');
    setSelectedStaffId('');
    setSelectedDate(undefined);
    setSelectedTime('');
    setNotes('');
    setCustomerNotes('');
    setTotalAmount(0);
    setAddress('');
    setAptSuite('');
    setCity('');
    setState('');
    setZipCode('');
    setLatitude(null);
    setLongitude(null);
    setFrequency('one_time');
    setCustomFrequencyDays(null);
    setRecurringDaysOfWeek(null);
    setBedrooms('1');
    // Must match the useState default and the prefill fallback. Without this a
    // bathroom count carries from one booking into the next in the same session.
    setBathrooms('1');
    setSquareFootage('');
    setSelectedExtras([]);
    setCardInfo(null);
    setIsTeamMode(false);
    setSelectedTeamMembers([]);
    setCleanerWage('');
    setCleanerWageType('hourly');
    setCleanerOverrideHours('');
    setPricingMode('sqft');
    setHomeCondition(1);
    setPetOption('no_pets');
    setConflictOverride(false);
    setSelectedChecklistId(null);
    setSelectedLocationId(null);
  };

  const prefillFromBooking = (booking: BookingWithDetails) => {
    if (booking.customer) {
      setCustomerTab('existing');
      setSelectedCustomerId(booking.customer.id);
    }
    if (booking.service) {
      setSelectedServiceId(booking.service.id);
    }
    if (booking.staff) {
      setSelectedStaffId(booking.staff.id);
    }
    // Parse the scheduled_at in the org timezone so the date/time shown matches what was intended
    const scheduledDate = getLocalDateInTimezone(booking.scheduled_at, orgTimezone);
    setSelectedDate(scheduledDate);
    const timeStr = getTimeInTimezone(booking.scheduled_at, orgTimezone);
    setSelectedTime(timeStr);
    setNotes(booking.notes || '');
    // Cast because BookingWithDetails does not declare customer_notes — the same
    // cast BookingDialogs.tsx uses. Widening that shared interface would touch
    // every consumer and is not this change.
    setCustomerNotes(
      (booking as { customer_notes?: string | null }).customer_notes || '',
    );
    // booking.total_amount is stored post-discount. Restore the pre-discount
    // subtotal so re-applying/removing a coupon during edit doesn't stack on
    // top of an already-discounted total.
    const bookingDiscountAmount = Number((booking as unknown as { discount_amount?: number | null })?.discount_amount ?? 0) || 0;
    const bookingDiscountId = (booking as unknown as { discount_id?: string | null })?.discount_id ?? null;
    setTotalAmount((booking.total_amount || 0) + bookingDiscountAmount);
    if (bookingDiscountId && bookingDiscountAmount > 0 && organizationId) {
      supabase
        .from('discounts')
        .select('id, code, discount_type, discount_value')
        .eq('id', bookingDiscountId)
        .eq('organization_id', organizationId)
        .maybeSingle()
        .then(({ data }) => {
          if (data) {
            setAppliedDiscount({
              id: data.id,
              code: data.code,
              discount_type: data.discount_type as 'percentage' | 'flat',
              discount_value: Number(data.discount_value) || 0,
              discountAmount: bookingDiscountAmount,
            });
          }
        });
    } else {
      setAppliedDiscount(null);
    }
    setAddress(booking.address || '');
    setAptSuite(booking.apt_suite || '');
    setCity(booking.city || '');
    setState(booking.state || '');
    setZipCode(booking.zip_code || '');
    setLatitude((booking as any).latitude ?? null);
    setLongitude((booking as any).longitude ?? null);
    setSelectedLocationId((booking as any).location_id || null);
    setFrequency(booking.frequency || 'one_time');
    setCustomFrequencyDays((booking as any).custom_frequency_days || null);
    setRecurringDaysOfWeek((booking as any).recurring_days_of_week || null);
    setBedrooms(booking.bedrooms || '1');
    // setBathrooms was previously never called anywhere, so an existing booking
    // rendered the useState default ('1') no matter what its row held — a row
    // with "2.5" showed "1 ba". tsc could not see it: the interface entry, the
    // state and the provider value were all present; only the call was missing.
    //
    // `||` not `??`: '' is as unrenderable as null to the Select, whose options
    // are ['1','1.5','2','2.5','3','3.5','4','4.5','5','5.5','6'].
    setBathrooms(booking.bathrooms || '1');
    setSquareFootage(booking.square_footage || '');
    // Handle extras which can be array of objects or strings from Json type
    const rawExtras = booking.extras;
    let extrasStringArray: string[] = [];
    if (Array.isArray(rawExtras)) {
      extrasStringArray = rawExtras.map((e: unknown) => 
        typeof e === 'string' ? e : (e as Record<string, unknown>)?.id as string || ''
      ).filter(Boolean);
    }
    setSelectedExtras(extrasStringArray);
    const bookingAny = booking as any;
    setCleanerWage(bookingAny.cleaner_wage ? String(bookingAny.cleaner_wage) : '');
    setCleanerWageType(bookingAny.cleaner_wage_type || 'hourly');
    setCleanerOverrideHours(bookingAny.cleaner_override_hours ? String(bookingAny.cleaner_override_hours) : '');

    // Load existing checklist template for this booking
    if (booking.id && organizationId) {
      supabase
        .from('booking_checklists')
        .select('template_id')
        .eq('booking_id', booking.id)
        .eq('organization_id', organizationId)
        .not('template_id', 'is', null)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle()
        .then(({ data }) => {
          if (data?.template_id) {
            setSelectedChecklistId(data.template_id);
          }
        });

      // Load team assignments for this booking (org-scoped)
      supabase
        .from('booking_team_assignments')
        .select('staff_id, pay_share')
        .eq('booking_id', booking.id)
        .eq('organization_id', organizationId ?? '')
        .then(({ data: teamData }) => {
          if (teamData && teamData.length > 0) {
            const memberIds = teamData.map(t => t.staff_id);
            // Include primary staff if not already in team
            if (booking.staff && !memberIds.includes(booking.staff.id)) {
              memberIds.unshift(booking.staff.id);
            }
          // Only enable team mode if there are MULTIPLE people assigned
            const isActualTeam = memberIds.length > 1;
            setIsTeamMode(isActualTeam);
            if (isActualTeam) {
              setSelectedTeamMembers(memberIds);
            } else {
              // Reset team members when not in team mode to prevent stale state
              setSelectedTeamMembers([]);
            }
            // Load pay shares
            const payMap: Record<string, number> = {};
            teamData.forEach(t => {
              if (t.pay_share != null) {
                payMap[t.staff_id] = t.pay_share;
              }
            });
            setTeamMemberPay(payMap);
          }
        });
    }
  };

  // Auto-fill property when existing customer selected — prefer default saved location
  useEffect(() => {
    if (customerTab === 'existing' && selectedCustomer && !booking) {
      const defaultLoc = customerLocations.find(l => l.is_primary) || customerLocations[0];
      if (defaultLoc) {
        setAddress(defaultLoc.address || '');
        setAptSuite(defaultLoc.apt_suite || '');
        setCity(defaultLoc.city || '');
        setState(defaultLoc.state || '');
        setZipCode(defaultLoc.zip_code || '');
        setSelectedLocationId(defaultLoc.id);
      } else {
        setAddress(selectedCustomer.address || '');
        setAptSuite((selectedCustomer as any).apt_suite || '');
        setCity(selectedCustomer.city || '');
        setState(selectedCustomer.state || '');
        setZipCode(selectedCustomer.zip_code || '');
        setSelectedLocationId(null);
      }
    }
  }, [selectedCustomerId, selectedCustomer, customerTab, booking, customerLocations]);

  // Load card info when customer email or organization changes
  useEffect(() => {
    if (customerEmail && organizationId) {
      loadCardInfo(customerEmail);
    } else {
      setCardInfo(null);
    }
  }, [customerEmail, organizationId, loadCardInfo]);

  // Note: We no longer auto-set totalAmount - user must manually enter if they want to override
  // The calculated price is displayed in ServiceStep but doesn't auto-populate the override field

  // Prefill form when editing
  useEffect(() => {
    if (booking) {
      prefillFromBooking(booking);
    } else if (defaultDate) {
      setSelectedDate(defaultDate);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps -- prefillFromBooking is recreated each render; runs once when booking prop arrives
  }, [booking, defaultDate]);

  return (
    <BookingFormContext.Provider value={{
      // Editing context
      editingBookingId: booking?.id || null,
      
      // State
      customerTab,
      selectedCustomerId,
      newCustomer,
      address,
      aptSuite,
      city,
      state,
      zipCode,
      latitude,
      longitude,
      selectedServiceId,
      squareFootage,
      bedrooms,
      bathrooms,
      frequency,
      customFrequencyDays,
      recurringDaysOfWeek,
      selectedExtras,
      pricingMode,
      homeCondition,
      petOption,
      roomReductions,
      reductionsTotal,
      selectedDate,
      selectedTime,
      selectedStaffId,
      isTeamMode,
      selectedTeamMembers,
      teamMemberPay,
      conflictOverride,
      notes,
      // Value only — no setCustomerNotes below. Read-only by construction.
      customerNotes,
      totalAmount,
      cleanerWage,
      cleanerWageType,
      cleanerOverrideHours,
      sendConfirmationEmail,
      sendConfirmationSms,
      sendQuoteSms,
      sendQuoteEmail,
      cardInfo,
      loadingCard,
      selectedChecklistId,
      customerLocations,
      selectedLocationId,
      selectedLocationPriceOverride,
      
      customers,
      services,
      staff,
      
      // Computed
      selectedService,
      selectedCustomer,
      customerEmail,
      customerName,
      extrasTotal,
      conditionTotal,
      petTotal,
      calculatedPrice,
      finalPrice,
      appliedDiscount,
      
      // Setters
      setCustomerTab,
      setSelectedCustomerId,
      setNewCustomer,
      updateNewCustomer,
      setAddress,
      setAptSuite,
      setCity,
      setState,
      setZipCode,
      setLatitude,
      setLongitude,
      setSelectedServiceId,
      setSquareFootage,
      setBedrooms,
      setBathrooms,
      setFrequency,
      setCustomFrequencyDays,
      setRecurringDaysOfWeek,
      toggleExtra,
      setPricingMode,
      setHomeCondition,
      setPetOption,
      setRoomReductions,
      setSelectedDate,
      setSelectedTime,
      setSelectedStaffId,
      setIsTeamMode,
      setSelectedTeamMembers,
      setTeamMemberPay,
      updateTeamMemberPay,
      setConflictOverride,
      setNotes,
      setTotalAmount,
      setCleanerWage,
      setCleanerWageType,
      setCleanerOverrideHours,
      setSendConfirmationEmail,
      setSendConfirmationSms,
      setSendQuoteSms,
      setSendQuoteEmail,
      setCardInfo,
      setAppliedDiscount,
      setSelectedChecklistId,
      setSelectedLocationId,
      
      loadCardInfo,
      resetForm,
      prefillFromBooking,
      pricingError,
    }}>
      {children}
    </BookingFormContext.Provider>
  );
}

export function useBookingForm() {
  const context = useContext(BookingFormContext);
  if (!context) {
    throw new Error('useBookingForm must be used within BookingFormProvider');
  }
  return context;
}
