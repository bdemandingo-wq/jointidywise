import { useState, useMemo, useEffect } from "react";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card } from "@/components/ui/card";
import { CheckCircle2, Loader2, Calendar as CalendarIcon, ArrowRight, ArrowLeft, ChevronLeft, ChevronRight, Clock } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { Sentry } from "@/lib/sentry";
import { format, addMonths, subMonths, startOfMonth, endOfMonth, startOfWeek, endOfWeek, eachDayOfInterval, isSameMonth, isSameDay, isToday, isBefore, startOfDay, addDays } from "date-fns";
import { DEFAULT_AVAILABILITY, parseAvailability, slotsForDay, type WeeklyAvailability } from "@/lib/demoAvailability";
import { orgTimeToUTCISO } from "@/lib/timezoneUtils";
import { calendarDayKey, orgDateKey } from "@/lib/orgDateRange";

/**
 * The demo is run by TIDYWISE from New York, and every slot in
 * demo_availability is a New York wall-clock time. So "today" here means New
 * York's today, not the visitor's — a visitor in Manila must not have a day
 * greyed out that the business would still take, and a visitor in Hawaii must
 * not be offered one it has finished.
 */
const DEMO_TZ = "America/New_York";

/** New York's current calendar day, as yyyy-MM-dd. */
const demoToday = () => orgDateKey(new Date(), DEMO_TZ);

const teamSizeOptions = ["Just me", "2-5 cleaners", "6-10 cleaners", "10+ cleaners"];
const challengeOptions = [
  "Scheduling & bookings",
  "Client communication",
  "Payments & invoicing",
  "Managing my team",
  "All of the above",
];

// Availability now comes from the demo_availability platform setting (read via
// the public get_demo_availability RPC). See @/lib/demoAvailability.

function formatTimeEST(time: string): string {
  const [h, m] = time.split(":").map(Number);
  const period = h >= 12 ? "PM" : "AM";
  const h12 = h === 0 ? 12 : h > 12 ? h - 12 : h;
  return `${h12}:${m.toString().padStart(2, "0")} ${period}`;
}

function getLocalTimezone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone;
  } catch {
    return "America/New_York";
  }
}

function convertESTToLocal(date: Date, estTime: string, localTz: string): string {
  const [h, m] = estTime.split(":").map(Number);

  /*
    This used to derive the EST/EDT offset by hand, via an isEDT() helper that
    computed DST as starting on the THIRD Sunday of March. The US rule is the
    second. So for one week every March — 8–14 Mar 2026, 14–20 Mar 2027 — it
    picked -5 instead of -4 and showed every visitor a demo time one hour wrong.

    orgTimeToUTCISO resolves the wall time against the real IANA zone, so the
    transition is the OS's problem and not ours. Verified round-tripping at
    every 2026-28 boundary including 8 Mar 2026, the date the old code missed.
  */
  // `date` is a calendar-grid token from the picker below: its y/m/d ARE the day
  // the visitor clicked, so resolving them through a timezone would shift the
  // day they chose. Only the TIME is converted.
  // eslint-disable-next-line local/no-device-local-dates
  const utcISO = orgTimeToUTCISO(date.getFullYear(), date.getMonth(), date.getDate(), h, m, DEMO_TZ);

  return new Intl.DateTimeFormat("en-US", {
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
    timeZone: localTz,
  }).format(new Date(utcISO));
}

interface FormData {
  fullName: string;
  email: string;
  phone: string;
  businessName: string;
  teamSize: string;
  biggestChallenge: string;
  additionalDetails: string;
}

interface FormErrors {
  fullName?: string;
  email?: string;
  phone?: string;
  businessName?: string;
  dateTime?: string;
}

type Step = "info" | "schedule" | "confirm";

export function DemoBookingForm() {
  const [step, setStep] = useState<Step>("info");
  const [form, setForm] = useState<FormData>({
    fullName: "",
    email: "",
    phone: "",
    businessName: "",
    teamSize: "",
    biggestChallenge: "",
    additionalDetails: "",
  });
  const [errors, setErrors] = useState<FormErrors>({});
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);

  // Calendar state
  const [currentMonth, setCurrentMonth] = useState(new Date());
  const [selectedDate, setSelectedDate] = useState<Date | null>(null);
  const [selectedTime, setSelectedTime] = useState<string | null>(null);
  const [bookedSlots, setBookedSlots] = useState<{ date: string; time: string }[]>([]);
  const [blockedDates, setBlockedDates] = useState<string[]>([]);
  // Seed with the hardcoded default so the calendar is never empty before the
  // demo_availability setting resolves (or if it's missing/malformed).
  const [availability, setAvailability] = useState<WeeklyAvailability>(DEFAULT_AVAILABILITY);
  const localTz = useMemo(() => getLocalTimezone(), []);
  const isLocalEST = localTz.includes("New_York") || localTz.includes("Eastern");

  // Fetch booked slots and blocked dates.
  // Uses the public get_demo_booked_slots() RPC instead of selecting
  // from demo_bookings directly — the table's SELECT policy was locked
  // down to platform admins in migration 20260428083904, so an anon
  // visitor querying the table received zero rows and the calendar
  // happily showed already-booked slots as available (silent
  // double-booking bug).
  useEffect(() => {
    const fetchSlots = async () => {
      const { data: bookings } = await (supabase
        .rpc("get_demo_booked_slots" as any) as any);

      if (bookings) {
        setBookedSlots(
          (bookings as any[]).map((b: any) => ({
            date: b.booked_date,
            time: typeof b.booked_time === "string"
              ? b.booked_time.substring(0, 5) // HH:MM
              : b.booked_time,
          }))
        );
      }

      const { data: blocked } = await supabase
        .from("demo_blocked_dates" as any)
        .select("blocked_date");

      if (blocked) {
        setBlockedDates((blocked as any[]).map((b: any) => b.blocked_date));
      }

      // Weekly schedule via the anon-readable SECURITY DEFINER RPC. On any
      // failure parseAvailability falls back to DEFAULT_AVAILABILITY.
      const { data: availRaw } = await (supabase.rpc("get_demo_availability" as any) as any);
      setAvailability(parseAvailability(availRaw));
    };
    fetchSlots();
  }, []);

  /*
    Calendar GRID GEOMETRY, not instants. "March 2026" spans the same 31 days
    and starts on the same weekday in every timezone, so building the grid from
    device-local dates produces the correct calendar. What must not come from
    the device is which cell is TODAY and which are PAST — those are New York's
    call and are handled separately below.

    The one soft edge: currentMonth starts at new Date(), so a visitor near a
    month boundary may open on their month rather than New York's. The grid is
    navigable and every cell is still judged against New York, so at worst they
    start one month over.
  */
  const calendarDays = useMemo(() => {
    /* eslint-disable local/no-device-local-dates -- grid geometry, see above */
    const monthStart = startOfMonth(currentMonth);
    const monthEnd = endOfMonth(currentMonth);
    const calStart = startOfWeek(monthStart);
    const calEnd = endOfWeek(monthEnd);
    return eachDayOfInterval({ start: calStart, end: calEnd });
    /* eslint-enable local/no-device-local-dates */
  }, [currentMonth]);

  const isDayAvailable = (date: Date): boolean => {
    // getDay() on a grid token is correct: the weekday of a calendar date is
    // the same in every timezone. 8 Mar 2026 is a Sunday in Manila and in NY.
    // eslint-disable-next-line local/no-device-local-dates
    const dow = date.getDay();
    if (!availability[dow]) return false;
    // Was isBefore(startOfDay(date), startOfDay(new Date())) — the VISITOR's
    // midnight. A visitor ahead of New York saw today already gone while the
    // business would still take it. Compared as calendar days against NY's.
    if (calendarDayKey(date) < demoToday()) return false;
    const dateStr = calendarDayKey(date);
    if (blockedDates.includes(dateStr)) return false;
    // Check if all slots are booked
    const slots = slotsForDay(availability, dow);
    const bookedForDay = bookedSlots.filter(s => s.date === dateStr);
    if (bookedForDay.length >= slots.length) return false;
    return true;
  };

  const isSlotBooked = (date: Date, time: string): boolean => {
    const dateStr = calendarDayKey(date);
    return bookedSlots.some(s => s.date === dateStr && s.time === time);
  };

  const validateInfo = (): boolean => {
    const newErrors: FormErrors = {};
    if (!form.fullName.trim()) newErrors.fullName = "Full name is required";
    if (!form.email.trim()) {
      newErrors.email = "Email is required";
    } else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email)) {
      newErrors.email = "Please enter a valid email";
    }
    if (!form.phone.trim()) {
      newErrors.phone = "Phone number is required";
    } else if (form.phone.replace(/\D/g, "").length < 10) {
      newErrors.phone = "Phone must be at least 10 digits";
    }
    if (!form.businessName.trim()) newErrors.businessName = "Business name is required";
    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const handleContinueToSchedule = () => {
    if (validateInfo()) setStep("schedule");
  };

  const handleSelectDate = (date: Date) => {
    if (!isDayAvailable(date)) return;
    setSelectedDate(date);
    setSelectedTime(null);
  };

  const handleSelectTime = (time: string) => {
    if (selectedDate && isSlotBooked(selectedDate, time)) return;
    setSelectedTime(time);
  };

  const handleConfirmBooking = async () => {
    if (!selectedDate || !selectedTime) {
      setErrors(prev => ({ ...prev, dateTime: "Please select a date and time" }));
      return;
    }

    setSubmitting(true);
    try {
      // The calendar day the visitor clicked, stored alongside a New York time.
      const bookedDate = calendarDayKey(selectedDate);
      const bookedTime = selectedTime + ":00"; // HH:MM:SS

      // Save to demo_bookings
      const { error: dbError } = await supabase.from("demo_bookings" as any).insert({
        full_name: form.fullName.trim(),
        email: form.email.trim(),
        phone: form.phone.trim(),
        business_name: form.businessName.trim(),
        team_size: form.teamSize || null,
        biggest_challenge: form.biggestChallenge || null,
        booked_date: bookedDate,
        booked_time: bookedTime,
        timezone: localTz,
        status: "confirmed",
      } as any);

      if (dbError) throw dbError;

      // Also save to demo_requests for backward compatibility.
      // supabase-js returns { error } instead of throwing, so a bare catch never saw a failed insert.
      const { error: requestError } = await supabase.from("demo_requests" as any).insert({
        full_name: form.fullName.trim(),
        email: form.email.trim(),
        phone: form.phone.trim(),
        business_name: form.businessName.trim(),
        team_size: form.teamSize || null,
        biggest_challenge: form.biggestChallenge || null,
        notes: form.additionalDetails.trim() || null,
        preferred_days: [format(selectedDate, "EEEE")],
        preferred_time: formatTimeEST(selectedTime) + " EST",
        status: "booked",
      } as any);
      if (requestError) {
        Sentry.captureException(requestError, { tags: { feature: "demo-booking", step: "demo_requests" } });
        toast.warning("Your demo time is saved. A follow-up request record did not save.");
      }

      // Notify via edge function. The booking row is already stored.
      const { error: notifyError } = await supabase.functions.invoke("notify-demo-request", {
        body: {
          fullName: form.fullName.trim(),
          email: form.email.trim(),
          phone: form.phone.trim(),
          businessName: form.businessName.trim(),
          teamSize: form.teamSize,
          biggestChallenge: form.biggestChallenge,
          bookedDate,
          bookedTime: selectedTime,
          timezone: localTz,
        },
      });
      if (notifyError) {
        Sentry.captureException(notifyError, { tags: { feature: "demo-booking", step: "notify" } });
        toast.warning("Your demo is booked. The confirmation notice did not send.");
      }

      // Add to booked slots locally
      setBookedSlots(prev => [...prev, { date: bookedDate, time: selectedTime }]);
      setSubmitted(true);
    } catch (err: any) {
      console.error("Demo booking error:", err);
      Sentry.captureException(err, { tags: { feature: "demo-booking", step: "demo_bookings" } });
      toast.error("Something went wrong. Please try again.");
    } finally {
      setSubmitting(false);
    }
  };

  const firstName = form.fullName.split(" ")[0];

  if (submitted) {
    const dateDisplay = selectedDate ? format(selectedDate, "EEEE, MMMM d, yyyy") : "";
    const timeDisplay = selectedTime ? formatTimeEST(selectedTime) : "";
    const localTimeDisplay = selectedDate && selectedTime && !isLocalEST
      ? convertESTToLocal(selectedDate, selectedTime, localTz)
      : null;

    return (
      <Card className="p-8 text-center bg-card border border-border">
        <div className="w-16 h-16 mx-auto mb-4 rounded-full bg-green-100 dark:bg-green-900/30 flex items-center justify-center animate-bounce">
          <CheckCircle2 className="h-8 w-8 text-green-600 dark:text-green-400" />
        </div>
        <h3 className="text-2xl font-bold text-foreground mb-2">
          🎉 Demo Booked{firstName ? `, ${firstName}` : ""}!
        </h3>
        <div className="bg-muted/50 rounded-xl p-4 mb-4 text-left space-y-2">
          <div className="flex items-center gap-2 text-foreground">
            <CalendarIcon className="h-4 w-4 text-primary" />
            <span className="font-medium">{dateDisplay}</span>
          </div>
          <div className="flex items-center gap-2 text-foreground">
            <Clock className="h-4 w-4 text-primary" />
            <span className="font-medium">{timeDisplay} EST</span>
            {localTimeDisplay && (
              <span className="text-sm text-muted-foreground">({localTimeDisplay} your time)</span>
            )}
          </div>
          <p className="text-sm text-muted-foreground mt-2">
            Emmanuel will call you at {form.phone}
          </p>
        </div>
        <p className="text-muted-foreground mb-6 text-sm">
          Check your email and phone for confirmation details.
        </p>
        <div className="space-y-3 text-left max-w-xs mx-auto">
          <a href="/pricing" className="flex items-center gap-2 text-primary hover:underline text-sm">
            <ArrowRight className="h-4 w-4" /> Explore pricing
          </a>
          <a href="/#features" className="flex items-center gap-2 text-primary hover:underline text-sm">
            <ArrowRight className="h-4 w-4" /> Explore features
          </a>
        </div>
      </Card>
    );
  }

  if (step === "info") {
    return (
      <Card className="p-6 md:p-8 bg-card border border-border shadow-lg">
        <div className="space-y-5">
          {/* Progress */}
          <div className="flex items-center gap-2 mb-2">
            <div className="flex-1 h-1.5 rounded-full bg-primary" />
            <div className="flex-1 h-1.5 rounded-full bg-muted" />
          </div>
          <p className="text-xs text-muted-foreground">Step 1 of 2 — Your Info</p>

          {/* Full Name */}
          <div>
            <Label htmlFor="demo-name" className="text-foreground">Full Name *</Label>
            <Input
              id="demo-name"
              value={form.fullName}
              onChange={(e) => { setForm(prev => ({ ...prev, fullName: e.target.value })); setErrors(prev => ({ ...prev, fullName: undefined })); }}
              placeholder="John Smith"
              className={`mt-1.5 h-12 ${errors.fullName ? "border-destructive" : ""}`}
            />
            {errors.fullName && <p className="text-destructive text-xs mt-1">{errors.fullName}</p>}
          </div>

          {/* Email */}
          <div>
            <Label htmlFor="demo-email" className="text-foreground">Email Address *</Label>
            <Input
              id="demo-email"
              type="email"
              value={form.email}
              onChange={(e) => { setForm(prev => ({ ...prev, email: e.target.value })); setErrors(prev => ({ ...prev, email: undefined })); }}
              placeholder="john@cleaningco.com"
              className={`mt-1.5 h-12 ${errors.email ? "border-destructive" : ""}`}
            />
            {errors.email && <p className="text-destructive text-xs mt-1">{errors.email}</p>}
          </div>

          {/* Phone */}
          <div>
            <Label htmlFor="demo-phone" className="text-foreground">Phone Number *</Label>
            <Input
              id="demo-phone"
              type="tel"
              value={form.phone}
              onChange={(e) => { setForm(prev => ({ ...prev, phone: e.target.value })); setErrors(prev => ({ ...prev, phone: undefined })); }}
              placeholder="(555) 123-4567"
              className={`mt-1.5 h-12 ${errors.phone ? "border-destructive" : ""}`}
            />
            {errors.phone && <p className="text-destructive text-xs mt-1">{errors.phone}</p>}
          </div>

          {/* Business Name */}
          <div>
            <Label htmlFor="demo-biz" className="text-foreground">Business Name *</Label>
            <Input
              id="demo-biz"
              value={form.businessName}
              onChange={(e) => { setForm(prev => ({ ...prev, businessName: e.target.value })); setErrors(prev => ({ ...prev, businessName: undefined })); }}
              placeholder="Sparkle Clean Co."
              className={`mt-1.5 h-12 ${errors.businessName ? "border-destructive" : ""}`}
            />
            {errors.businessName && <p className="text-destructive text-xs mt-1">{errors.businessName}</p>}
          </div>

          {/* Team Size */}
          <div>
            <Label className="text-foreground mb-2 block">How many cleaners on your team?</Label>
            <div className="grid grid-cols-2 gap-2">
              {teamSizeOptions.map((opt) => (
                <button
                  key={opt}
                  type="button"
                  onClick={() => setForm(prev => ({ ...prev, teamSize: opt }))}
                  className={`px-3 py-2.5 rounded-lg border text-sm transition-all ${
                    form.teamSize === opt
                      ? "bg-primary text-primary-foreground border-primary"
                      : "bg-background border-border text-foreground hover:border-primary/50"
                  }`}
                >
                  {opt}
                </button>
              ))}
            </div>
          </div>

          {/* Biggest Challenge */}
          <div>
            <Label className="text-foreground mb-2 block">What's your biggest challenge?</Label>
            <div className="space-y-2">
              {challengeOptions.map((opt) => (
                <button
                  key={opt}
                  type="button"
                  onClick={() => setForm(prev => ({ ...prev, biggestChallenge: opt }))}
                  className={`w-full text-left px-3 py-2.5 rounded-lg border text-sm transition-all ${
                    form.biggestChallenge === opt
                      ? "bg-primary text-primary-foreground border-primary"
                      : "bg-background border-border text-foreground hover:border-primary/50"
                  }`}
                >
                  {opt}
                </button>
              ))}
            </div>
          </div>

          {/* Additional Details */}
          <div>
            <Label className="text-foreground mb-2 block">Anything specific you'd like to discuss? <span className="text-muted-foreground font-normal">(optional)</span></Label>
            <Textarea
              placeholder="E.g. I need help setting up recurring bookings, I want to see the invoicing feature, etc."
              value={form.additionalDetails}
              onChange={(e) => setForm(prev => ({ ...prev, additionalDetails: e.target.value }))}
              className="resize-none text-sm"
              rows={3}
            />
          </div>

          <Button
            size="lg"
            className="w-full h-14 text-lg font-semibold"
            onClick={handleContinueToSchedule}
          >
            Choose Date & Time <ArrowRight className="ml-2 h-5 w-5" />
          </Button>
        </div>
      </Card>
    );
  }

  // Schedule step
  // Weekday of the selected calendar date — timezone-independent.
  // eslint-disable-next-line local/no-device-local-dates
  const timeSlots = selectedDate ? slotsForDay(availability, selectedDate.getDay()) : [];

  return (
    <Card className="p-6 md:p-8 bg-card border border-border shadow-lg">
      <div className="space-y-5">
        {/* Progress */}
        <div className="flex items-center gap-2 mb-2">
          <div className="flex-1 h-1.5 rounded-full bg-primary" />
          <div className="flex-1 h-1.5 rounded-full bg-primary" />
        </div>
        <div className="flex items-center justify-between">
          <p className="text-xs text-muted-foreground">Step 2 of 2 — Pick a Time</p>
          <button
            type="button"
            onClick={() => setStep("info")}
            className="text-xs text-primary hover:underline flex items-center gap-1"
          >
            <ArrowLeft className="h-3 w-3" /> Back
          </button>
        </div>

        {/* Calendar */}
        <div>
          <div className="flex items-center justify-between mb-4">
            <button
              type="button"
              onClick={() => setCurrentMonth(subMonths(currentMonth, 1))}
              className="p-2 hover:bg-muted rounded-lg transition-colors"
              // Whether the previous month is entirely past is a New York
              // question, not the visitor's — same reason as isDayAvailable.
              /* eslint-disable-next-line local/no-device-local-dates -- endOfMonth is grid geometry; the comparison is against New York */
              disabled={calendarDayKey(endOfMonth(subMonths(currentMonth, 1))) < demoToday()}
            >
              <ChevronLeft className="h-5 w-5 text-foreground" />
            </button>
            <h3 className="font-semibold text-foreground">
              {format(currentMonth, "MMMM yyyy")}
            </h3>
            <button
              type="button"
              onClick={() => setCurrentMonth(addMonths(currentMonth, 1))}
              className="p-2 hover:bg-muted rounded-lg transition-colors"
            >
              <ChevronRight className="h-5 w-5 text-foreground" />
            </button>
          </div>

          {/* Day headers */}
          <div className="grid grid-cols-7 mb-2">
            {["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map(d => (
              <div key={d} className="text-center text-xs font-medium text-muted-foreground py-1">
                {d}
              </div>
            ))}
          </div>

          {/* Calendar grid */}
          <div className="grid grid-cols-7 gap-1">
            {calendarDays.map((day, i) => {
              // Both compare two grid tokens to each other — "is this cell in the
              // month being shown", "is this cell the one clicked". Neither
              // involves now, so neither can be wrong by timezone.
              /* eslint-disable local/no-device-local-dates */
              const inMonth = isSameMonth(day, currentMonth);
              const available = inMonth && isDayAvailable(day);
              const selected = selectedDate && isSameDay(day, selectedDate);
              /* eslint-enable local/no-device-local-dates */
              // Both of these were the visitor's "today". The demo runs on New
              // York's calendar, so a visitor 12 hours ahead had the wrong cell
              // ringed as today and the wrong cells shaded as past.
              const dateStr = calendarDayKey(day);
              const today = dateStr === demoToday();
              const isBlocked = blockedDates.includes(dateStr);
              const isPast = dateStr < demoToday();

              return (
                <button
                  key={i}
                  type="button"
                  disabled={!available}
                  onClick={() => handleSelectDate(day)}
                  className={`
                    relative aspect-square flex flex-col items-center justify-center rounded-lg text-sm transition-all
                    ${!inMonth ? "text-muted-foreground/30" : ""}
                    ${available ? "hover:bg-primary/10 cursor-pointer" : "cursor-default"}
                    ${selected ? "bg-primary text-primary-foreground hover:bg-primary" : ""}
                    ${today && !selected ? "ring-2 ring-primary/30" : ""}
                    ${!available && inMonth && !isPast ? "text-muted-foreground/50" : ""}
                    ${isPast && inMonth ? "text-muted-foreground/30" : ""}
                    ${isBlocked ? "text-destructive/50 line-through" : ""}
                  `}
                >
                  <span className="text-sm">{format(day, "d")}</span>
                  {available && !selected && (
                    <span className="absolute bottom-1 w-1.5 h-1.5 rounded-full bg-primary" />
                  )}
                </button>
              );
            })}
          </div>

          {/* Legend */}
          <div className="flex items-center gap-4 mt-3 text-xs text-muted-foreground">
            <span className="flex items-center gap-1">
              <span className="w-2 h-2 rounded-full bg-primary" /> Available
            </span>
            <span className="flex items-center gap-1">
              <span className="w-2 h-2 rounded-full bg-muted-foreground/30" /> Unavailable
            </span>
          </div>
        </div>

        {/* Time slots */}
        {selectedDate && (
          <div className="animate-in fade-in-50 slide-in-from-bottom-2">
            <Label className="text-foreground mb-3 block font-medium">
              Available times for {format(selectedDate, "EEEE, MMM d")}
            </Label>
            {timeSlots.length === 0 ? (
              <p className="text-sm text-muted-foreground">No available times for this day.</p>
            ) : (
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                {timeSlots.map(time => {
                  const booked = isSlotBooked(selectedDate, time);
                  const selected = selectedTime === time;
                  const localTime = !isLocalEST ? convertESTToLocal(selectedDate, time, localTz) : null;

                  return (
                    <button
                      key={time}
                      type="button"
                      disabled={booked}
                      onClick={() => handleSelectTime(time)}
                      className={`
                        px-3 py-3 rounded-lg border text-sm font-medium transition-all text-center
                        ${selected
                          ? "bg-primary text-primary-foreground border-primary"
                          : booked
                            ? "bg-muted/50 text-muted-foreground/50 border-border line-through cursor-not-allowed"
                            : "bg-background border-border text-foreground hover:border-primary/50 hover:bg-primary/5"
                        }
                      `}
                    >
                      <span>{formatTimeEST(time)} EST</span>
                      {localTime && !booked && (
                        <span className="block text-xs opacity-70 mt-0.5">{localTime} local</span>
                      )}
                      {booked && <span className="block text-xs mt-0.5">Booked</span>}
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {errors.dateTime && (
          <p className="text-destructive text-xs">{errors.dateTime}</p>
        )}

        {/* Confirm */}
        {selectedDate && selectedTime && (
          <div className="bg-muted/50 rounded-xl p-4 space-y-1 animate-in fade-in-50">
            <p className="text-sm font-medium text-foreground">Your selection:</p>
            <p className="text-foreground flex items-center gap-2">
              <CalendarIcon className="h-4 w-4 text-primary" />
              {format(selectedDate, "EEEE, MMMM d, yyyy")}
            </p>
            <p className="text-foreground flex items-center gap-2">
              <Clock className="h-4 w-4 text-primary" />
              {formatTimeEST(selectedTime)} EST
              {!isLocalEST && (
                <span className="text-muted-foreground text-sm">
                  ({convertESTToLocal(selectedDate, selectedTime, localTz)} your time)
                </span>
              )}
            </p>
          </div>
        )}

        <Button
          size="lg"
          disabled={submitting || !selectedDate || !selectedTime}
          className="w-full h-14 text-lg font-semibold"
          onClick={handleConfirmBooking}
        >
          {submitting ? (
            <>
              <Loader2 className="mr-2 h-5 w-5 animate-spin" /> Booking...
            </>
          ) : (
            <>
              <CalendarIcon className="mr-2 h-5 w-5" /> Confirm Demo Booking <ArrowRight className="ml-2 h-5 w-5" />
            </>
          )}
        </Button>
      </div>
    </Card>
  );
}
