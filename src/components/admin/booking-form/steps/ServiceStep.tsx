import { useEffect, useState } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { Switch } from '@/components/ui/switch';
import { Checkbox } from '@/components/ui/checkbox';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { FileText, CheckCircle, DollarSign, PawPrint, Home, Ruler, BedDouble, ClipboardCheck, Camera, ChevronDown, DoorClosed } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useBookingForm } from '../BookingFormContext';
import { useServicePricing } from '@/hooks/useServicePricing';
import { useOrganizationSettings } from '@/hooks/useOrganizationSettings';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { useOrganization } from '@/contexts/OrganizationContext';
import {
  squareFootageRanges,
  bedroomOptions,
  bathroomOptions,
  frequencyOptions
} from '@/data/pricingData';
import { useRecurringDiscounts } from '@/hooks/useRecurringDiscounts';
import { QueryError } from '@/components/QueryError';
import { getFrequencyDiscountPct } from '@/lib/recurringDiscount';

interface ChecklistTemplate {
  id: string;
  name: string;
  description: string | null;
  service_id: string | null;
  items: Array<{
    id: string;
    title: string;
    description: string | null;
    requires_photo: boolean;
  }>;
}

export function ServiceStep() {
  const { organization } = useOrganization();
  const {
    services,
    selectedServiceId,
    setSelectedServiceId,
    squareFootage,
    setSquareFootage,
    bedrooms,
    setBedrooms,
    bathrooms,
    setBathrooms,
    frequency,
    setFrequency,
    customFrequencyDays,
    setCustomFrequencyDays,
    recurringDaysOfWeek,
    setRecurringDaysOfWeek,
    selectedExtras,
    toggleExtra,
    extrasTotal,
    totalAmount,
    setTotalAmount,
    pricingMode,
    setPricingMode,
    homeCondition,
    setHomeCondition,
    petOption,
    setPetOption,
    roomReductions,
    setRoomReductions,
    reductionsTotal,
    conditionTotal,
    petTotal,
    calculatedPrice,
    selectedChecklistId,
    setSelectedChecklistId,
  } = useBookingForm();
  const { config: recurringDiscountConfig } = useRecurringDiscounts();

  // Use service-specific pricing
  const { getServicePricing, loading: pricingLoading } = useServicePricing();
  const { settings: orgSettings } = useOrganizationSettings();
  const [showCustomInput, setShowCustomInput] = useState(false);

  // Fetch custom frequencies for this organization
  const { data: customFrequencies = [], error: customFrequenciesError } = useQuery({
    queryKey: ['custom-frequencies', organization?.id],
    queryFn: async () => {
      // Unreachable: the query is gated by `enabled: !!organization?.id`.
      // Present so the guarantee is provable rather than asserted.
      const orgId = organization?.id;
      if (!orgId) return [];
      const { data, error } = await supabase
        .from('custom_frequencies')
        .select('*')
        .eq('organization_id', orgId)
        .eq('is_active', true)
        .order('interval_days', { ascending: true });
      if (error) throw error;
      return data as { id: string; name: string; interval_days: number; days_of_week: number[] | null; discount_pct: number }[];
    },
    enabled: !!organization?.id,
  });
  
  // Fetch active checklist templates
  const { data: checklistTemplates = [], error: checklistTemplatesError } = useQuery({
    queryKey: ['checklist-templates-active', organization?.id],
    queryFn: async () => {
      // Unreachable: the query is gated by `enabled: !!organization?.id`.
      // Present so the guarantee is provable rather than asserted.
      const orgId = organization?.id;
      if (!orgId) return [];
      const { data, error } = await supabase
        .from('checklist_templates')
        .select(`
          id,
          name,
          description,
          service_id,
          items:checklist_items(id, title, description, requires_photo, sort_order)
        `)
        .eq('organization_id', orgId)
        .eq('is_active', true)
        .order('name');
      
      if (error) throw error;
      
      return data.map(t => ({
        ...t,
        items: (t.items || []).sort((a: any, b: any) => a.sort_order - b.sort_order)
      })) as ChecklistTemplate[];
    },
    enabled: !!organization?.id
  });
  
  // Get pricing for selected service
  const servicePricing = selectedServiceId ? getServicePricing(selectedServiceId) : null;
  
  // Use service-specific extras, pets, condition options or defaults
  const extras = servicePricing?.extras || [];
  const petOptions = servicePricing?.pet_options || [];
  const homeConditionOptions = servicePricing?.home_condition_options || [];

  // Pet toggle helpers — first pet option with a price is used when toggled on
  const paidPetOption = petOptions.find((p) => p.price > 0) || petOptions.find((p) => p.id !== 'no_pets');
  const petsOn = petOption !== 'no_pets' && !!paidPetOption && petOption === paidPetOption.id;
  const petFee = paidPetOption?.price ?? 0;

  // Exclude parameters (room reductions) from org settings
  const excludedRoomTypes = (orgSettings?.excluded_room_types ?? []) as Array<'bedroom' | 'bathroom' | 'full_bath'>;
  const roomReductionPrices = orgSettings?.room_reduction_prices ?? { bedroom: 0, bathroom: 0, full_bath: 0 };
  const [excludeOpen, setExcludeOpen] = useState(false);
  const roomOptions: Array<{ key: 'bedroom' | 'bathroom' | 'full_bath'; label: string; max: number }> = [
    { key: 'bedroom', label: 'Bedrooms', max: Math.max(0, parseInt(bedrooms || '0')) },
    { key: 'bathroom', label: 'Bathrooms', max: Math.max(0, parseInt(bathrooms || '0')) },
    { key: 'full_bath', label: 'Full Baths', max: Math.max(0, parseInt(bathrooms || '0')) },
  ];
  const availableRooms = roomOptions.filter((r) => !excludedRoomTypes.includes(r.key) && r.max > 0);

  const totalAddOns = extrasTotal + conditionTotal + petTotal;
  
  // Check visibility settings
  const showSqft = orgSettings?.show_sqft_on_booking !== false;
  const showBedBath = orgSettings?.show_bed_bath_on_booking !== false;
  const showAddons = orgSettings?.show_addons_on_booking !== false;
  const showFrequency = orgSettings?.show_frequency_discount !== false;
  const showPets = orgSettings?.show_pet_options !== false;
  const showCondition = orgSettings?.show_home_condition !== false;
  
  // Filter templates: show service-specific ones first, then generic ones
  const availableChecklists = checklistTemplates.filter(t => 
    !t.service_id || t.service_id === selectedServiceId
  );
  
  // Get selected checklist for preview
  const selectedChecklist = checklistTemplates.find(t => t.id === selectedChecklistId);

  // If sqft pricing is hidden, force Bed & Bath pricing so totals can compute
  useEffect(() => {
    if (!showSqft && showBedBath && pricingMode !== 'bedroom') {
      setPricingMode('bedroom');
    }
    if (showSqft && pricingMode === 'bedroom' && !showBedBath) {
      setPricingMode('sqft');
    }
  }, [showSqft, showBedBath, pricingMode, setPricingMode]);

  if (customFrequenciesError || checklistTemplatesError) {
    return <QueryError subject="service options" />;
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3 mb-6">
        <div className="p-3 rounded-xl bg-gradient-to-br from-purple-500/20 to-purple-600/10">
          <FileText className="h-6 w-6 text-purple-600 dark:text-purple-400" />
        </div>
        <div>
          <h3 className="text-lg font-semibold">Service Selection</h3>
          <p className="text-sm text-muted-foreground">Choose the service type and property details</p>
        </div>
      </div>

      <Card className="border-border/50 shadow-sm">
        <CardContent className="pt-6 space-y-5">
          <div>
            <Label className="text-sm font-medium">Service Type *</Label>
            <Select value={selectedServiceId} onValueChange={(value) => {
              setSelectedServiceId(value);
              // Auto-set price to $0 for Re-clean (use special constant)
              if (value === 'reclean') {
                setTotalAmount(0);
              }
            }}>
              <SelectTrigger className="mt-2 h-11 bg-secondary/30 border-border/50" aria-label="Service type">
                <SelectValue placeholder="Select a service" />
              </SelectTrigger>
              <SelectContent className="bg-popover border-border">
                <SelectItem value="reclean">
                  Re-clean ($0)
                </SelectItem>
                {services?.map((service) => (
                  <SelectItem key={service.id} value={service.id}>
                    {service.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Calculated Price Display */}
          {selectedServiceId && (
            <div className="p-4 bg-success/10 rounded-xl border border-success/20">
              <p className="text-xs text-success">Calculated Price (from pricing sheet)</p>
              <p className="text-2xl font-bold text-success">
                ${calculatedPrice.toFixed(2)}
              </p>
              <p className="text-xs text-muted-foreground mt-1">
                Base + extras + condition + pets
              </p>
            </div>
          )}

          {/* Pricing Mode Tabs - Only show sqft if enabled */}
          {showSqft ? (
            <div>
              <Label className="text-sm font-medium mb-2 block">Pricing Method</Label>
              <Tabs value={pricingMode} onValueChange={(v) => setPricingMode(v as 'sqft' | 'bedroom')}>
                <TabsList className="grid w-full grid-cols-2">
                  <TabsTrigger value="sqft" className="flex items-center gap-2">
                    <Ruler className="h-4 w-4" />
                    Square Footage
                  </TabsTrigger>
                  {showBedBath && (
                    <TabsTrigger value="bedroom" className="flex items-center gap-2">
                      <BedDouble className="h-4 w-4" />
                      Bed & Bath
                    </TabsTrigger>
                  )}
                </TabsList>
                
                <TabsContent value="sqft" className="mt-4">
                  <div>
                    <Label className="text-sm font-medium">Square Footage</Label>
                    <Select value={squareFootage} onValueChange={setSquareFootage}>
                      <SelectTrigger className="mt-2 h-11 bg-secondary/30 border-border/50" aria-label="Square footage range">
                        <SelectValue placeholder="Select sq ft range" />
                      </SelectTrigger>
                      <SelectContent className="bg-popover border-border">
                        {squareFootageRanges.map((range) => (
                          <SelectItem key={range.label} value={range.label}>
                            {range.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                </TabsContent>
                
                {showBedBath && (
                  <TabsContent value="bedroom" className="mt-4">
                    <div className="grid grid-cols-2 gap-4">
                      <div>
                        <Label className="text-sm font-medium">Bedrooms</Label>
                        <Select value={bedrooms} onValueChange={setBedrooms}>
                          <SelectTrigger className="mt-2 h-11 bg-secondary/30 border-border/50" aria-label="Bedrooms">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent className="bg-popover border-border">
                            {bedroomOptions.map((opt) => (
                              <SelectItem key={opt} value={opt}>{opt} Bedroom{opt !== '1' && opt !== '0' ? 's' : ''}</SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                      <div>
                        <Label className="text-sm font-medium">Bathrooms</Label>
                        <Select value={bathrooms} onValueChange={setBathrooms}>
                          <SelectTrigger className="mt-2 h-11 bg-secondary/30 border-border/50" aria-label="Bathrooms">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent className="bg-popover border-border">
                            {bathroomOptions.map((opt) => (
                              <SelectItem key={opt} value={opt}>{opt} Bath{opt !== '1' ? 's' : ''}</SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                    </div>
                    <p className="text-xs text-muted-foreground mt-2">
                      Base price calculated from bedroom/bathroom combination
                    </p>
                  </TabsContent>
                )}
              </Tabs>
            </div>
          ) : showBedBath ? (
            /* Bed/Bath only mode when sqft is hidden but bed/bath is enabled */
            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label className="text-sm font-medium">Bedrooms</Label>
                <Select value={bedrooms} onValueChange={setBedrooms}>
                  <SelectTrigger className="mt-2 h-11 bg-secondary/30 border-border/50" aria-label="Bedrooms">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent className="bg-popover border-border">
                    {bedroomOptions.map((opt) => (
                      <SelectItem key={opt} value={opt}>{opt} Bedroom{opt !== '1' && opt !== '0' ? 's' : ''}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label className="text-sm font-medium">Bathrooms</Label>
                <Select value={bathrooms} onValueChange={setBathrooms}>
                  <SelectTrigger className="mt-2 h-11 bg-secondary/30 border-border/50" aria-label="Bathrooms">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent className="bg-popover border-border">
                    {bathroomOptions.map((opt) => (
                      <SelectItem key={opt} value={opt}>{opt} Bath{opt !== '1' ? 's' : ''}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
          ) : null}

          {/* Always show bed/bath for reference when in sqft mode and bed/bath is enabled */}
          {showSqft && showBedBath && pricingMode === 'sqft' && (
            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label className="text-sm font-medium">Bedrooms</Label>
                <Select value={bedrooms} onValueChange={setBedrooms}>
                  <SelectTrigger className="mt-2 h-11 bg-secondary/30 border-border/50" aria-label="Bedrooms">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent className="bg-popover border-border">
                    {bedroomOptions.map((opt) => (
                      <SelectItem key={opt} value={opt}>{opt}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label className="text-sm font-medium">Bathrooms</Label>
                <Select value={bathrooms} onValueChange={setBathrooms}>
                  <SelectTrigger className="mt-2 h-11 bg-secondary/30 border-border/50" aria-label="Bathrooms">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent className="bg-popover border-border">
                    {bathroomOptions.map((opt) => (
                      <SelectItem key={opt} value={opt}>{opt}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
          )}

          {showFrequency && (
            <div className="space-y-2">
              <Label className="text-sm font-medium">Frequency</Label>
              <Select 
                value={(() => {
                  if (showCustomInput) return '__custom__';
                  if (frequency !== 'custom') return frequency;

                  if (recurringDaysOfWeek && recurringDaysOfWeek.length > 0) {
                    const matchedPreset = customFrequencies.find((cf) => {
                      const days = cf.days_of_week || [];
                      if (days.length !== recurringDaysOfWeek.length) return false;
                      const a = [...days].sort((x, y) => x - y);
                      const b = [...recurringDaysOfWeek].sort((x, y) => x - y);
                      return a.every((day, idx) => day === b[idx]);
                    });
                    return matchedPreset ? `custom_days_${matchedPreset.id}` : '__custom__';
                  }

                  if (customFrequencyDays) return `custom_${customFrequencyDays}`;
                  return '__custom__';
                })()}
                onValueChange={(val) => {
                  if (val === '__custom__') {
                    setShowCustomInput(true);
                    setFrequency('custom');
                    setRecurringDaysOfWeek(null);
                  } else if (val.startsWith('custom_days_')) {
                    const presetId = val.replace('custom_days_', '');
                    const preset = customFrequencies.find(cf => cf.id === presetId);
                    if (preset) {
                      setFrequency('custom');
                      setCustomFrequencyDays(7);
                      setRecurringDaysOfWeek(preset.days_of_week || null);
                      setShowCustomInput(false);
                    }
                  } else if (val.startsWith('custom_')) {
                    const days = parseInt(val.replace('custom_', ''));
                    setFrequency('custom');
                    setCustomFrequencyDays(days);
                    setRecurringDaysOfWeek(null);
                    setShowCustomInput(false);
                  } else {
                    setFrequency(val);
                    setCustomFrequencyDays(null);
                    setRecurringDaysOfWeek(null);
                    setShowCustomInput(false);
                  }
                }}
              >
                <SelectTrigger className="mt-2 h-11 bg-secondary/30 border-border/50" aria-label="Frequency">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent className="bg-popover border-border">
                  {frequencyOptions.map((opt) => {
                    const pct = getFrequencyDiscountPct(opt.id, recurringDiscountConfig);
                    const displayLabel = pct > 0 ? `${opt.label} (${pct}% off)` : opt.label;
                    return (
                      <SelectItem key={opt.id} value={opt.id}>
                        {displayLabel}
                      </SelectItem>
                    );
                  })}
                  {customFrequencies.length > 0 && (
                    <>
                      <div className="px-2 py-1.5 text-xs font-semibold text-muted-foreground border-t mt-1 pt-2">
                        Custom Presets
                      </div>
                      {customFrequencies.map((cf) => {
                        const dayLabels = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
                        const base = cf.days_of_week && cf.days_of_week.length > 0
                          ? `${cf.name} (${cf.days_of_week.map(d => dayLabels[d]).join('/')})`
                          : `${cf.name} (Every ${cf.interval_days} day${cf.interval_days !== 1 ? 's' : ''})`;
                        const label = (cf.discount_pct ?? 0) > 0 ? `${base} (${cf.discount_pct}% off)` : base;
                        const value = cf.days_of_week && cf.days_of_week.length > 0
                          ? `custom_days_${cf.id}`
                          : `custom_${cf.interval_days}`;
                        return (
                          <SelectItem key={cf.id} value={value}>
                            {label}
                          </SelectItem>
                        );
                      })}
                    </>
                  )}
                  <div className="border-t mt-1 pt-1">
                    <SelectItem value="__custom__">
                      Custom interval...
                    </SelectItem>
                  </div>
                </SelectContent>
              </Select>
              {showCustomInput && (
                <div className="flex items-center gap-2 mt-2">
                  <Label className="text-sm whitespace-nowrap">Every</Label>
                  <Input
                    type="number"
                    min="1"
                    placeholder="e.g. 4"
                    value={customFrequencyDays ?? ''}
                    onChange={(e) => {
                      setCustomFrequencyDays(e.target.value ? parseInt(e.target.value) : null);
                      setRecurringDaysOfWeek(null);
                    }}
                    className="w-20 h-9"
                  />
                  <Label className="text-sm whitespace-nowrap">days</Label>
                </div>
              )}
            </div>
          )}

          {/* Don't need the entire home cleaned? — under Frequency */}
          {availableRooms.length > 0 && (
            <Collapsible open={excludeOpen} onOpenChange={setExcludeOpen}>
              <CollapsibleTrigger asChild>
                <button
                  type="button"
                  className="w-full flex items-center justify-between p-3 rounded-lg border border-border/50 bg-secondary/20 hover:bg-secondary/40 transition-colors"
                >
                  <span className="flex items-center gap-2 text-sm font-medium">
                    <DoorClosed className="h-4 w-4 text-muted-foreground" />
                    Don't need the entire home cleaned?
                  </span>
                  <div className="flex items-center gap-2">
                    {reductionsTotal > 0 && (
                      <Badge className="bg-success/10 text-success border-success/20">
                        -${reductionsTotal}
                      </Badge>
                    )}
                    <ChevronDown className={cn('h-4 w-4 transition-transform', excludeOpen && 'rotate-180')} />
                  </div>
                </button>
              </CollapsibleTrigger>
              <CollapsibleContent className="mt-3 space-y-2">
                <p className="text-xs text-muted-foreground">Skip rooms you don't need cleaned and reduce the price.</p>
                {availableRooms.map((r) => {
                  const count = roomReductions[r.key] || 0;
                  const price = roomReductionPrices[r.key] || 0;
                  return (
                    <div key={r.key} className="flex items-center justify-between gap-3 p-3 rounded-lg border border-border/50 bg-secondary/10">
                      <div className="flex-1">
                        <p className="text-sm font-medium">Skip {r.label}</p>
                        <p className="text-xs text-muted-foreground">-${price} per room</p>
                      </div>
                      <Select
                        value={String(count)}
                        onValueChange={(v) =>
                          setRoomReductions({ ...roomReductions, [r.key]: parseInt(v) || 0 })
                        }
                      >
                        <SelectTrigger className="w-24 h-9 bg-secondary/30 border-border/50" aria-label={`Number of ${r.label} to skip`}>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent className="bg-popover border-border">
                          {Array.from({ length: r.max + 1 }, (_, i) => (
                            <SelectItem key={i} value={String(i)}>{i}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  );
                })}
              </CollapsibleContent>
            </Collapsible>
          )}
        </CardContent>
      </Card>

      {/* Home Condition - only show if enabled */}
      {(showCondition || showPets) && (
        <Card className="border-border/50 shadow-sm">
          <CardContent className="pt-6 space-y-5">
            <div className="flex items-center justify-between mb-4">
              <div>
                <Label className="text-sm font-medium flex items-center gap-2">
                  <Home className="h-4 w-4 text-muted-foreground" />
                  Home Condition
                </Label>
                <p className="text-xs text-muted-foreground mt-1">Additional charges may apply</p>
              </div>
              {(conditionTotal > 0 || petTotal > 0) && (
                <Badge className="bg-warning/10 text-warning border-warning/20">
                  +${conditionTotal + petTotal}
                </Badge>
              )}
            </div>

            {showCondition && (
              <div>
                <Select value={homeCondition.toString()} onValueChange={(v) => setHomeCondition(parseInt(v))}>
                  <SelectTrigger className="mt-2 h-11 bg-secondary/30 border-border/50" aria-label="Home condition">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent className="bg-popover border-border">
                    {homeConditionOptions.map((opt) => (
                      <SelectItem key={opt.id} value={opt.id.toString()}>
                        <div className="flex items-center justify-between w-full gap-4">
                          <span>{opt.label}</span>
                          {opt.price > 0 && (
                            <span className="text-warning font-medium">+${opt.price}</span>
                          )}
                        </div>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}

            {showPets && paidPetOption && (
              <div className="flex items-center justify-between gap-3 p-3 rounded-lg border border-border/50 bg-secondary/10">
                <div className="flex items-center gap-2">
                  <PawPrint className="h-4 w-4 text-muted-foreground" />
                  <div>
                    <Label htmlFor="admin-pet-toggle" className="text-sm font-medium cursor-pointer">Pets?</Label>
                    {petFee > 0 && (
                      <p className="text-xs text-muted-foreground">+${petFee} pet fee</p>
                    )}
                  </div>
                </div>
                <Switch
                  id="admin-pet-toggle"
                  checked={petsOn}
                  onCheckedChange={(on) => setPetOption(on && paidPetOption ? paidPetOption.id : 'no_pets')}
                />
              </div>
            )}
          </CardContent>
        </Card>
      )}


      {/* Extras - only show if enabled */}
      {showAddons && (
        <Card className="border-border/50 shadow-sm">
          <CardContent className="pt-6">
            <div className="flex items-center justify-between mb-4">
              <Label className="text-sm font-medium">Add-On Services</Label>
              {totalAddOns > 0 && (
                <Badge className="bg-warning/10 text-warning border-warning/20">
                  +${totalAddOns} total
                </Badge>
              )}
            </div>
            <div className="grid grid-cols-2 gap-3">
              {extras.map((extra) => (
                <div 
                  key={extra.id}
                  className={cn(
                    "flex items-center gap-3 p-4 rounded-xl border-2 cursor-pointer transition-all duration-200",
                    selectedExtras.includes(extra.id) 
                      ? "border-primary bg-primary/5 shadow-sm" 
                      : "border-border/50 hover:border-primary/30 hover:bg-secondary/30"
                  )}
                  onClick={() => toggleExtra(extra.id)}
                >
                  <div className={cn(
                    "w-5 h-5 rounded-full border-2 flex items-center justify-center transition-colors flex-shrink-0",
                    selectedExtras.includes(extra.id)
                      ? "border-primary bg-primary"
                      : "border-border"
                  )}>
                    {selectedExtras.includes(extra.id) && (
                      <CheckCircle className="w-3 h-3 text-primary-foreground" />
                    )}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="font-medium text-sm">{extra.name}</p>
                    <p className="text-xs text-muted-foreground">
                      {extra.note ? extra.note : extra.price > 0 ? `$${extra.price}` : 'Custom pricing'}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Checklist Selection */}
      {availableChecklists.length > 0 && (
        <Card className="border-border/50 shadow-sm">
          <CardContent className="pt-6 space-y-4">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-teal-100 dark:bg-teal-900/30">
                <ClipboardCheck className="h-5 w-5 text-teal-600 dark:text-teal-400" />
              </div>
              <div>
                <Label className="text-sm font-medium">Cleaning Checklist (Optional)</Label>
                <p className="text-xs text-muted-foreground">Assign a checklist for quality assurance</p>
              </div>
            </div>
            
            <Select 
              value={selectedChecklistId || 'none'} 
              onValueChange={(value) => setSelectedChecklistId(value === 'none' ? null : value)}
            >
              <SelectTrigger className="h-11 bg-secondary/30 border-border/50" aria-label="Cleaning checklist">
                <SelectValue placeholder="No checklist" />
              </SelectTrigger>
              <SelectContent className="bg-popover border-border">
                <SelectItem value="none">No checklist</SelectItem>
                {availableChecklists.map((template) => (
                  <SelectItem key={template.id} value={template.id}>
                    <div className="flex items-center gap-2">
                      <span>{template.name}</span>
                      {template.service_id === selectedServiceId && (
                        <Badge variant="secondary" className="text-xs">
                          Match
                        </Badge>
                      )}
                      <span className="text-xs text-muted-foreground">
                        ({template.items.length} items)
                      </span>
                    </div>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>

            {/* Preview selected checklist */}
            {selectedChecklist && (
              <div className="border-t pt-4 mt-2">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-sm font-medium">Preview</span>
                  <Badge variant="outline" className="text-xs">
                    {selectedChecklist.items.length} items
                  </Badge>
                </div>
                <div className="space-y-1 max-h-40 overflow-y-auto">
                  {selectedChecklist.items.slice(0, 5).map((item) => (
                    <div 
                      key={item.id} 
                      className="flex items-center gap-2 p-2 bg-muted/50 rounded text-sm"
                    >
                      <CheckCircle className="h-3 w-3 text-muted-foreground shrink-0" />
                      <span className="flex-1 truncate">{item.title}</span>
                      {item.requires_photo && (
                        <Camera className="h-3 w-3 text-muted-foreground shrink-0" />
                      )}
                    </div>
                  ))}
                  {selectedChecklist.items.length > 5 && (
                    <p className="text-xs text-muted-foreground text-center py-1">
                      +{selectedChecklist.items.length - 5} more items
                    </p>
                  )}
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}