import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Calendar } from '@/components/ui/calendar';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Calendar as CalendarIcon, Clock, Users, X, UserPlus, DollarSign, AlertCircle, CheckCircle, MapPin, Car, Loader2 } from 'lucide-react';
import { format } from 'date-fns';
import { cn } from '@/lib/utils';
import { useBookingForm } from '../BookingFormContext';
import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';
import { useEffect, useMemo, useState, useRef, useCallback } from 'react';
import { useCleanerConflicts } from '@/hooks/useCleanerConflicts';
import { CleanerConflictWarning } from '../CleanerConflictWarning';
import { calculateDistanceMiles, estimateDriveMinutes, formatDistance, formatDriveTime, geocodeAddress } from '@/lib/distanceUtils';
import { useDistanceUnit, useOrgCountryCode } from '@/hooks/useDistanceUnit';
import { useSchedulingMode, formatWindowRange } from '@/hooks/useSchedulingMode';
import { useOrgId } from '@/hooks/useOrgId';

type Coordinates = { lat: number; lng: number };

type GeocodeCacheEntry = {
  coords: Coordinates | null;
  updatedAt: number;
};

// Module-level geocode cache persists across step navigation
const geocodeCache = new Map<string, GeocodeCacheEntry>();
const GEOCODE_SUCCESS_TTL_MS = 1000 * 60 * 60 * 12; // 12 hours
const GEOCODE_FAILURE_TTL_MS = 1000 * 60 * 2; // 2 minutes

// Business hours first. The list used to start at 12:00 AM, so the first
// thing in the menu — and the slot a cleared select fell into — was 1:30 AM.
const TIME_SLOTS = [
  { value: '07:00', label: '7:00 AM' }, { value: '07:30', label: '7:30 AM' },
  { value: '08:00', label: '8:00 AM' }, { value: '08:30', label: '8:30 AM' },
  { value: '09:00', label: '9:00 AM' }, { value: '09:30', label: '9:30 AM' },
  { value: '10:00', label: '10:00 AM' }, { value: '10:30', label: '10:30 AM' },
  { value: '11:00', label: '11:00 AM' }, { value: '11:30', label: '11:30 AM' },
  { value: '12:00', label: '12:00 PM' }, { value: '12:30', label: '12:30 PM' },
  { value: '13:00', label: '1:00 PM' }, { value: '13:30', label: '1:30 PM' },
  { value: '14:00', label: '2:00 PM' }, { value: '14:30', label: '2:30 PM' },
  { value: '15:00', label: '3:00 PM' }, { value: '15:30', label: '3:30 PM' },
  { value: '16:00', label: '4:00 PM' }, { value: '16:30', label: '4:30 PM' },
  { value: '17:00', label: '5:00 PM' }, { value: '17:30', label: '5:30 PM' },
  { value: '18:00', label: '6:00 PM' }, { value: '18:30', label: '6:30 PM' },
  { value: '19:00', label: '7:00 PM' }, { value: '19:30', label: '7:30 PM' },
  { value: '20:00', label: '8:00 PM' }, { value: '20:30', label: '8:30 PM' },
  { value: '21:00', label: '9:00 PM' }, { value: '21:30', label: '9:30 PM' },
  { value: '22:00', label: '10:00 PM' }, { value: '22:30', label: '10:30 PM' },
  { value: '23:00', label: '11:00 PM' }, { value: '23:30', label: '11:30 PM' },
  { value: '00:00', label: '12:00 AM' }, { value: '00:30', label: '12:30 AM' },
  { value: '01:00', label: '1:00 AM' }, { value: '01:30', label: '1:30 AM' },
  { value: '02:00', label: '2:00 AM' }, { value: '02:30', label: '2:30 AM' },
  { value: '03:00', label: '3:00 AM' }, { value: '03:30', label: '3:30 AM' },
  { value: '04:00', label: '4:00 AM' }, { value: '04:30', label: '4:30 AM' },
  { value: '05:00', label: '5:00 AM' }, { value: '05:30', label: '5:30 AM' },
  { value: '06:00', label: '6:00 AM' }, { value: '06:30', label: '6:30 AM' },
];

// Helper to get display label from 24h value
const getTimeLabel = (value: string) => TIME_SLOTS.find(t => t.value === value)?.label || value;

export function ScheduleStep({ currentBookingId }: { currentBookingId?: string }) {
  const {
    selectedDate,
    setSelectedDate,
    selectedTime,
    setSelectedTime,
    selectedStaffId,
    setSelectedStaffId,
    isTeamMode,
    setIsTeamMode,
    selectedTeamMembers,
    setSelectedTeamMembers,
    teamMemberPay,
    updateTeamMemberPay,
    staff,
    cleanerWage,
    cleanerWageType,
    totalAmount,
    calculatedPrice,
    selectedService,
    conflictOverride,
    setConflictOverride,
    address,
    city,
    state,
    zipCode,
    latitude,
    longitude,
  } = useBookingForm();
  const distanceUnit = useDistanceUnit();
  const orgCountry = useOrgCountryCode();

  const { organizationId } = useOrgId();
  const { data: schedulingConfig } = useSchedulingMode(organizationId);
  const isArrivalWindow = schedulingConfig?.mode === 'arrival_window';
  const enabledWindows = (schedulingConfig?.windows ?? []).filter((w) => w.enabled);

  // No hardcoded same-day/next-day blackout — per-org minimum-notice
  // enforcement will be reintroduced via business_settings when that
  // Settings UI ships.


  // State for job location coordinates (geocoded from address)
  const [jobCoordinates, setJobCoordinates] = useState<{ lat: number; lng: number } | null>(null);
  const [isGeocodingJob, setIsGeocodingJob] = useState(false);

  // The date popover needs to be a controlled Dialog so it can be closed
  // programmatically once a day is picked (Calendar's onSelect alone
  // doesn't close it — that's the 3.6 gap).
  const [isDatePickerOpen, setIsDatePickerOpen] = useState(false);
  const handleDateSelect = useCallback(
    (day: Date | undefined) => {
      setSelectedDate(day);
      setIsDatePickerOpen(false);
    },
    [setSelectedDate],
  );

  // Geocode the job address once per keystroke burst. No retries, no backoff:
  // the retry loop was making the form feel like it was fighting the user. We
  // cache successes for 12h and failures for 2m, and show a sticky spinner in
  // the staff card so the admin knows distances are being calculated.
  useEffect(() => {
    if (latitude != null && longitude != null) {
      setJobCoordinates({ lat: latitude, lng: longitude });
      setIsGeocodingJob(false);
      return;
    }

    const fullAddress = [address, city, state, zipCode].filter(Boolean).join(', ').trim();
    if (!fullAddress || fullAddress.length < 5) {
      setJobCoordinates(null);
      setIsGeocodingJob(false);
      return;
    }

    const cacheKey = fullAddress.toLowerCase();
    const cachedEntry = geocodeCache.get(cacheKey);

    if (cachedEntry) {
      const maxAge = cachedEntry.coords ? GEOCODE_SUCCESS_TTL_MS : GEOCODE_FAILURE_TTL_MS;
      const isFresh = Date.now() - cachedEntry.updatedAt < maxAge;

      if (isFresh) {
        setJobCoordinates(cachedEntry.coords);
        setIsGeocodingJob(false);
        return;
      }

      geocodeCache.delete(cacheKey);
    }

    let cancelled = false;
    setIsGeocodingJob(true);

    const runGeocode = async () => {
      const primaryCoords = await geocodeAddress(fullAddress, orgCountry);
      if (cancelled) return;

      if (primaryCoords) {
        geocodeCache.set(cacheKey, { coords: primaryCoords, updatedAt: Date.now() });
        setJobCoordinates(primaryCoords);
        setIsGeocodingJob(false);
        return;
      }

      // One pass over simpler fallback queries, no retries/backoff.
      const fallbackCandidates = [
        [address, state, zipCode].filter(Boolean).join(', '),
        [address, zipCode].filter(Boolean).join(', '),
        [city, state, zipCode].filter(Boolean).join(', '),
      ]
        .map((candidate) => candidate.trim())
        .filter((candidate) => candidate.length >= 5 && candidate.toLowerCase() !== cacheKey);

      for (const candidate of fallbackCandidates) {
        const fallbackCoords = await geocodeAddress(candidate, orgCountry);
        if (cancelled) return;

        if (fallbackCoords) {
          geocodeCache.set(cacheKey, { coords: fallbackCoords, updatedAt: Date.now() });
          setJobCoordinates(fallbackCoords);
          setIsGeocodingJob(false);
          return;
        }
      }

      geocodeCache.set(cacheKey, { coords: null, updatedAt: Date.now() });
      setJobCoordinates(null);
      setIsGeocodingJob(false);
    };

    const timeout = setTimeout(() => {
      void runGeocode();
    }, 500);

    return () => {
      cancelled = true;
      clearTimeout(timeout);
    };
  }, [address, city, state, zipCode, latitude, longitude, orgCountry]);

  // Calculate distance from staff home to job location
  const getStaffDistance = (staffMember: { home_latitude?: number | null; home_longitude?: number | null }) => {
    if (!jobCoordinates || !staffMember.home_latitude || !staffMember.home_longitude) {
      return null;
    }
    const miles = calculateDistanceMiles(
      staffMember.home_latitude,
      staffMember.home_longitude,
      jobCoordinates.lat,
      jobCoordinates.lng
    );
    return {
      miles,
      driveMinutes: estimateDriveMinutes(miles),
      display: formatDistance(miles, distanceUnit),
      driveDisplay: formatDriveTime(estimateDriveMinutes(miles)),
    };
  };

  // Use conflict detection hook
  const { checkConflictsForStaff, getStaffAvailability, isStaffWithinWorkingHours, loading: conflictLoading } = useCleanerConflicts(
    selectedDate,
    selectedTime,
    selectedService?.duration || 120,
    currentBookingId
  );

  // Get availability for all active staff
  // eslint-disable-next-line react-hooks/exhaustive-deps -- activeStaff is derived from staff prop inline; the filtered array is a new ref each render but its content only changes when staff changes
  const activeStaff = staff?.filter(s => s.is_active) || [];
  const staffAvailability = useMemo(() => {
    return getStaffAvailability(activeStaff.map(s => s.id));
  // eslint-disable-next-line react-hooks/exhaustive-deps -- activeStaff is a new array ref each render; the memo depends on staff content, not the ref
  }, [activeStaff, getStaffAvailability]);

  // Show ALL active staff so admins can always override and assign anyone.
  // Staff who are outside their working hours OR have conflicts are still shown
  // — they get a badge ("Off today" / "Busy") so the admin sees the warning
  // but can still assign them (e.g., last-minute coverage).
  const availableStaff = activeStaff;

  // Get conflicts for currently selected staff (single mode)
  const currentConflicts = useMemo(() => {
    if (!selectedStaffId || isTeamMode) return [];
    return checkConflictsForStaff(selectedStaffId);
  }, [selectedStaffId, isTeamMode, checkConflictsForStaff]);

  // Get conflicts for team mode
  const teamConflicts = useMemo(() => {
    if (!isTeamMode || selectedTeamMembers.length === 0) return new Map();
    const conflicts = new Map<string, ReturnType<typeof checkConflictsForStaff>>();
    for (const staffId of selectedTeamMembers) {
      const staffConflicts = checkConflictsForStaff(staffId);
      if (staffConflicts.length > 0) {
        conflicts.set(staffId, staffConflicts);
      }
    }
    return conflicts;
  }, [isTeamMode, selectedTeamMembers, checkConflictsForStaff]);

  const hasAnyConflict = currentConflicts.length > 0 || teamConflicts.size > 0;

  // Reset conflict override when staff/date/time changes
  useEffect(() => {
    setConflictOverride(false);
  // eslint-disable-next-line react-hooks/exhaustive-deps -- setConflictOverride is a stable setState; .join(',') is a complex expression but intentional for array-content comparison
  }, [selectedStaffId, selectedDate, selectedTime, selectedTeamMembers.join(',')]);

  // The primary cleaner is ALWAYS the first member of the team. BookingStepper
  // writes `is_primary: i === 0` on the assignments and `bookings.staff_id =
  // selectedStaffId` from the same submit, so these two pieces of state have to
  // move together. Letting them drift produced a booking whose staff_id pointed
  // at someone with no assignment row — payroll would still pay them (the Staff
  // Summary total feeds the Stripe payout amount) while the itemised Booking
  // Details table showed no line for it. Never call setSelectedTeamMembers
  // directly from this file; go through here.
  const applyTeamMembers = (next: string[]) => {
    setSelectedTeamMembers(next);
    setSelectedStaffId(next[0] ?? '');
  };

  // Handle team member toggle
  const toggleTeamMember = (staffId: string) => {
    applyTeamMembers(
      selectedTeamMembers.includes(staffId)
        ? selectedTeamMembers.filter(id => id !== staffId)
        : [...selectedTeamMembers, staffId]
    );
  };

  // Remove team member
  const removeTeamMember = (staffId: string) => {
    applyTeamMembers(selectedTeamMembers.filter(id => id !== staffId));
  };

  // Update primary staff when team mode changes
  const handleTeamModeChange = (checked: boolean) => {
    setIsTeamMode(checked);
    if (!checked) {
      // Leaving team mode: the primary becomes the sole cleaner. Falls back to
      // the current selection when the team was empty.
      setSelectedStaffId(selectedTeamMembers[0] ?? selectedStaffId);
      setSelectedTeamMembers([]);
    } else {
      // Entering team mode: seed the team with the current cleaner as primary.
      applyTeamMembers(selectedStaffId ? [selectedStaffId] : []);
    }
  };

  // Calculate suggested pay share for team members
  const calculateSuggestedPay = (staffId: string) => {
    const staffMember = staff?.find(s => s.id === staffId);
    if (!staffMember) return 0;

    const jobTotal = totalAmount > 0 ? totalAmount : calculatedPrice;
    const teamSize = selectedTeamMembers.length || 1;

    // Use booking-level wage if set, otherwise use staff's default
    const wageToUse = cleanerWage ? parseFloat(cleanerWage) : null;
    const wageTypeToUse = cleanerWageType;

    if (wageToUse) {
      if (wageTypeToUse === 'flat') {
        return wageToUse / teamSize;
      } else if (wageTypeToUse === 'percentage') {
        return (jobTotal * wageToUse / 100) / teamSize;
      } else {
        return wageToUse * 2; // Hourly - estimate 2 hours per person
      }
    }

    // Fall back to staff's default rates
    if (staffMember.percentage_rate && staffMember.percentage_rate > 0) {
      return (jobTotal * staffMember.percentage_rate / 100) / teamSize;
    }
    if (staffMember.hourly_rate && staffMember.hourly_rate > 0) {
      return staffMember.hourly_rate * 2;
    }

    return 0;
  };

  // Initialize pay ONLY for newly added team members (not pre-loaded ones from DB)
  // We check if the value is strictly undefined AND the amount is > 0 to avoid overwriting DB values
  useEffect(() => {
    selectedTeamMembers.forEach(staffId => {
      // Only auto-calculate if truly missing (undefined), not if it was loaded as 0 from DB
      if (teamMemberPay[staffId] === undefined) {
        const suggestedPay = calculateSuggestedPay(staffId);
        if (suggestedPay > 0) {
          updateTeamMemberPay(staffId, Math.round(suggestedPay * 100) / 100);
        }
        // If suggestedPay is 0, leave as 0 (don't auto-set $1 or any incorrect value)
      }
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps -- calculateSuggestedPay/teamMemberPay/updateTeamMemberPay are recreated each render; runs only when team members change
  }, [selectedTeamMembers]);

  // Helper to render availability badge
  const renderAvailabilityBadge = (staffId: string) => {
    if (!selectedDate || !selectedTime) return null;
    const availability = staffAvailability.get(staffId);
    if (!availability) return null;

    if (availability.isOutsideWorkingHours) {
      return (
        <Badge variant="outline" className="ml-2 bg-warning/10 text-warning border-warning/20 text-xs">
          <AlertCircle className="h-3 w-3 mr-1" />
          Off today
        </Badge>
      );
    }

    if (availability.isAvailable) {
      return (
        <Badge variant="outline" className="ml-2 bg-success/10 text-success border-success/20 text-xs">
          <CheckCircle className="h-3 w-3 mr-1" />
          Available
        </Badge>
      );
    } else {
      return (
        <Badge variant="outline" className="ml-2 bg-warning/10 text-warning border-warning/20 text-xs">
          <AlertCircle className="h-3 w-3 mr-1" />
          Busy
        </Badge>
      );
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3 mb-6">
        <div className="p-3 rounded-xl bg-gradient-to-br from-cyan-500/20 to-cyan-600/10">
          <CalendarIcon className="h-6 w-6 text-cyan-600 dark:text-cyan-400" />
        </div>
        <div>
          <h3 className="text-lg font-semibold">Schedule Appointment</h3>
          <p className="text-sm text-muted-foreground">Choose date, time, and assign staff</p>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <Card className="border-border/50 shadow-sm">
          <CardContent className="pt-6">
            <div className="flex items-center gap-2 mb-4">
              <CalendarIcon className="h-4 w-4 text-muted-foreground" />
              <Label className="text-sm font-medium">Select Date *</Label>
            </div>
            <Popover open={isDatePickerOpen} onOpenChange={setIsDatePickerOpen}>
              <PopoverTrigger asChild>
                <Button
                  variant="outline"
                  className={cn(
                    "w-full justify-start text-left font-normal h-12 bg-secondary/30 border-border/50",
                    !selectedDate && "text-muted-foreground"
                  )}
                >
                  <CalendarIcon className="mr-3 h-4 w-4" />
                  {selectedDate ? format(selectedDate, "EEEE, MMMM d, yyyy") : "Pick a date"}
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-auto p-0 z-[9999]" align="start">
                <Calendar
                  mode="single"
                  selected={selectedDate}
                  onSelect={handleDateSelect}
                  
                  initialFocus
                  className="pointer-events-auto"
                />
              </PopoverContent>
            </Popover>
          </CardContent>
        </Card>

        <Card className="border-border/50 shadow-sm">
          <CardContent className="pt-6">
            <div className="flex items-center gap-2 mb-4">
              <Clock className="h-4 w-4 text-muted-foreground" />
              <Label className="text-sm font-medium">
                {isArrivalWindow ? 'Select Arrival Window *' : 'Select Time *'}
              </Label>
            </div>
            {isArrivalWindow ? (
              enabledWindows.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  No arrival windows configured. Add them in Settings → Booking Form.
                </p>
              ) : (
                <div className="flex flex-wrap gap-2">
                  {enabledWindows.map((w) => {
                    const active = selectedTime === w.start_time;
                    return (
                      <Button
                        key={w.id}
                        type="button"
                        variant={active ? 'default' : 'outline'}
                        className={cn(
                          'h-12 px-4 justify-center whitespace-nowrap text-sm',
                          active && 'ring-2 ring-primary/30'
                        )}
                        onClick={() => setSelectedTime(w.start_time)}
                      >
                        {w.label || formatWindowRange(w)}
                      </Button>
                    );
                  })}
                </div>
              )
            ) : (
              <Select value={selectedTime} onValueChange={setSelectedTime}>
                <SelectTrigger className="h-12 bg-secondary/30 border-border/50" aria-label="Select time slot">
                  <SelectValue placeholder="Select time slot">
                    {selectedTime ? getTimeLabel(selectedTime) : 'Select time slot'}
                  </SelectValue>
                </SelectTrigger>
                <SelectContent className="bg-popover border-border max-h-64">
                  {TIME_SLOTS.map((slot) => (
                    <SelectItem key={slot.value} value={slot.value}>
                      {slot.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          </CardContent>
        </Card>
      </div>

      <Card className="border-border/50 shadow-sm">
        <CardContent className="pt-6">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-2">
              <Users className="h-4 w-4 text-muted-foreground" />
              <Label className="text-sm font-medium">Assign Staff (Optional)</Label>
            </div>
            <div className="flex items-center gap-3">
              {isGeocodingJob && (
                <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  Locating job address…
                </span>
              )}
              <div className="flex items-center gap-2">
                <Checkbox
                  id="teamMode"
                  checked={isTeamMode}
                  onCheckedChange={handleTeamModeChange}
                />
                <Label htmlFor="teamMode" className="text-sm text-muted-foreground cursor-pointer flex items-center gap-1">
                  <UserPlus className="h-3 w-3" />
                  Team Mode
                </Label>
              </div>
            </div>
          </div>

          {!isTeamMode ? (
            // Single staff selection - only show staff who are available based on working hours
            <>
              <Select value={selectedStaffId || "unassigned"} onValueChange={(val) => setSelectedStaffId(val === "unassigned" ? "" : val)}>
                <SelectTrigger className="h-12 bg-secondary/30 border-border/50" aria-label="Assign staff">
                  <SelectValue placeholder="Select a cleaner (optional)">
                    {selectedStaffId && (staff?.find(s => s.id === selectedStaffId)?.name || availableStaff.find(s => s.id === selectedStaffId)?.name)}
                  </SelectValue>
                </SelectTrigger>
                <SelectContent className="bg-popover border-border">
                  <SelectItem value="unassigned">Unassigned</SelectItem>
                  {availableStaff.length === 0 && selectedDate && selectedTime ? (
                    <div className="p-3 text-sm text-muted-foreground text-center">
                      No staff available for this time slot
                    </div>
                  ) : (
                    availableStaff.map((member) => {
                      const availability = staffAvailability.get(member.id);
                      // Only show busy badge for booking conflicts (not working hours since those are already filtered)
                      const hasConflicts = availability && availability.conflicts.length > 0;
                      const distance = getStaffDistance(member as { home_latitude?: number | null; home_longitude?: number | null });
                      return (
                        <SelectItem key={member.id} value={member.id} className="py-2">
                          <span className="flex items-center gap-2 w-full">
                            <span className="flex-1">{member.name}</span>
                            {/* Distance badge - show if staff has home coordinates */}
                            {distance && (
                              <span className="text-xs px-1.5 py-0.5 rounded bg-info/10 text-info flex items-center gap-0.5 shrink-0">
                                <Car className="h-3 w-3" />
                                {distance.display} ({distance.driveDisplay})
                              </span>
                            )}
                            {/* Availability badge */}
                            {selectedDate && selectedTime && (
                              <span className={cn(
                                "text-xs px-1.5 py-0.5 rounded shrink-0",
                                hasConflicts
                                  ? "bg-warning/10 text-warning"
                                  : "bg-success/10 text-success"
                              )}>
                                {hasConflicts ? 'Busy' : 'Available'}
                              </span>
                            )}
                          </span>
                        </SelectItem>
                      );
                    })
                  )}
                </SelectContent>
              </Select>

              {/* Conflict Warning for Single Staff */}
              {currentConflicts.length > 0 && (
                <div className="mt-4">
                  <CleanerConflictWarning
                    cleanerName={availableStaff.find(s => s.id === selectedStaffId)?.name || 'Selected cleaner'}
                    conflicts={currentConflicts}
                    overrideConflict={conflictOverride}
                    onOverrideChange={setConflictOverride}
                  />
                </div>
              )}
            </>
          ) : (
            // Team selection mode - only show staff who are available based on working hours
            <div className="space-y-4">
              {/* Selected Team Members with Editable Pay */}
              {selectedTeamMembers.length > 0 && (
                <div className="space-y-2 p-3 bg-primary/5 rounded-lg border border-primary/20">
                  <p className="text-xs font-medium text-muted-foreground mb-2">Team Members & Pay (Editable)</p>
                  {selectedTeamMembers.map((staffId, idx) => {
                    // For already selected members, look in activeStaff (they might have been selected before time changed)
                    const member = activeStaff.find(s => s.id === staffId);
                    const currentPay = teamMemberPay[staffId] ?? 0;
                    const memberConflicts = teamConflicts.get(staffId);
                    if (!member) return null;
                    return (
                      <div key={staffId}>
                        <div 
                          className={cn(
                            "flex items-center justify-between p-2 bg-background rounded border gap-2",
                            memberConflicts && memberConflicts.length > 0 && "border-warning/30 bg-warning/5"
                          )}
                        >
                          <div className="flex items-center gap-2 flex-shrink-0">
                            <Badge variant={idx === 0 ? "default" : "secondary"} className="text-xs">
                              {idx === 0 ? 'Lead' : `#${idx + 1}`}
                            </Badge>
                            <span className="font-medium">{member.name}</span>
                            {memberConflicts && memberConflicts.length > 0 && (
                              <Badge variant="outline" className="bg-warning/10 text-warning border-warning/20 text-xs">
                                <AlertCircle className="h-3 w-3 mr-1" />
                                Conflict
                              </Badge>
                            )}
                          </div>
                          <div className="flex items-center gap-2">
                            <div className="relative">
                              <DollarSign className="absolute left-2 top-1/2 -translate-y-1/2 h-3 w-3 text-muted-foreground" />
                              <Input
                                type="number"
                                min="0"
                                step="0.01"
                                value={currentPay || ''}
                                onChange={(e) => updateTeamMemberPay(staffId, parseFloat(e.target.value) || 0)}
                                className="w-24 h-8 pl-6 text-sm"
                                placeholder="0.00"
                              />
                            </div>
                            <button
                              type="button"
                              onClick={() => removeTeamMember(staffId)}
                              className="p-1 hover:text-destructive"
                            >
                              <X className="h-4 w-4" />
                            </button>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}

              {/* Team Conflict Warnings */}
              {teamConflicts.size > 0 && (
                <div className="space-y-3">
                  {Array.from(teamConflicts.entries()).map(([staffId, conflicts]) => {
                    const member = activeStaff.find(s => s.id === staffId);
                    return (
                      <CleanerConflictWarning
                        key={staffId}
                        cleanerName={member?.name || 'Team member'}
                        conflicts={conflicts}
                        overrideConflict={conflictOverride}
                        onOverrideChange={setConflictOverride}
                      />
                    );
                  })}
                </div>
              )}

              {/* Add Team Members - only show staff who are available based on working hours */}
              <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
                {availableStaff.length === 0 && selectedDate && selectedTime ? (
                  <div className="col-span-full p-3 text-sm text-muted-foreground text-center border border-dashed rounded-lg">
                    No staff available for this time slot
                  </div>
                ) : (
                  availableStaff.map((member) => {
                    const isSelected = selectedTeamMembers.includes(member.id);
                    const availability = staffAvailability.get(member.id);
                    // Only show busy badge for booking conflicts (not working hours since those are already filtered)
                    const hasConflicts = availability && availability.conflicts.length > 0;
                    const distance = getStaffDistance(member);
                    return (
                      <button
                        key={member.id}
                        type="button"
                        onClick={() => toggleTeamMember(member.id)}
                        className={cn(
                          "flex flex-col items-start gap-1 p-3 rounded-lg border text-left transition-all",
                          isSelected 
                            ? "border-primary bg-primary/10 text-primary" 
                            : "border-border/50 bg-secondary/30 hover:border-primary/50"
                        )}
                      >
                        <div className="flex items-center gap-2">
                          <Checkbox checked={isSelected} className="pointer-events-none" />
                          <span className="text-sm font-medium truncate">{member.name}</span>
                        </div>
                        <div className="flex items-center gap-1 ml-6">
                          {distance && (
                            <span className="text-xs px-1.5 py-0.5 rounded bg-muted text-muted-foreground flex items-center gap-0.5">
                              <Car className="h-3 w-3" />
                              {distance.display} ({distance.driveDisplay})
                            </span>
                          )}
                          {selectedDate && selectedTime && (
                            <span className={cn(
                              "text-xs px-1.5 py-0.5 rounded",
                              hasConflicts
                                ? "bg-warning/10 text-warning"
                                : "bg-success/10 text-success"
                            )}>
                              {hasConflicts ? 'Busy' : 'Available'}
                            </span>
                          )}
                        </div>
                      </button>
                    );
                  })
                )}
              </div>

              {selectedTeamMembers.length === 0 && availableStaff.length > 0 && (
                <p className="text-sm text-muted-foreground text-center py-2">
                  Select team members for this job
                </p>
              )}
            </div>
          )}

          {isTeamMode && selectedTeamMembers.length > 1 && (
            <p className="text-xs text-muted-foreground mt-3">
              <strong>Note:</strong> The first selected member will be the primary assignee. 
              Individual pay is calculated based on wage settings.
            </p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
