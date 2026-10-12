import { useState, useEffect } from "react";
import { useSearchParams } from "react-router-dom";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { format } from "date-fns";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Card, CardContent } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Calendar } from "@/components/ui/calendar";
import {
  Sparkles, Send, Loader2, Copy, Check, Users, MessageSquare, Mail,
  CalendarDays, Clock, ChevronLeft, AlertCircle, Zap, UserX, X, Eye,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { stopComplianceError, withStopSentence } from "./stopCompliance";
import { supabase } from "@/lib/supabase";
import { useToast } from "@/hooks/use-toast";
import { describeCampaignDispatch, type CampaignDispatchResult } from "@/components/admin/campaigns/campaignDispatch";
import { ThrottleSelect, THROTTLE_OPTIONS } from "@/components/admin/campaigns/ThrottleSelect";
import { describeDuration } from "@/components/admin/campaigns/CampaignSendConfirmDialog";
import { zonedWallClockToIso, describeScheduledInstant, isInPast, isDayFullyPast, earliestTimeOnDay, clampTimeToDay } from "@/components/admin/campaigns/scheduleTime";

type AudienceType = "active_clients" | "inactive_clients" | "leads" | "all_customers";

interface AITemplate {
  name: string;
  message: string;
}

const audienceOptions = [
  { value: "active_clients", label: "Active Clients" },
  { value: "inactive_clients", label: "Inactive Clients" },
  { value: "leads", label: "Leads" },
  { value: "all_customers", label: "All Customers" },
];

const toneOptions = [
  { value: "professional", label: "Professional" },
  { value: "friendly", label: "Friendly" },
  { value: "urgent", label: "Urgent" },
  { value: "seasonal", label: "Seasonal" },
];

/** The curated day counts offered in the Days Inactive picker. */
const DAYS_INACTIVE_OPTIONS = [7, 14, 30, 60, 90];

/**
 * The picker must be able to display whatever days_inactive actually holds.
 *
 * A deep link can carry any value (?days=45), and a Radix Select whose `value`
 * matches no SelectItem renders an EMPTY trigger — so the form silently showed
 * a blank field while the audience preview was resolving against 45. The
 * operator then sees a recipient count computed from a number they cannot see.
 *
 * Snapping to the nearest curated value would be worse: it would quietly widen
 * or narrow the audience relative to what the link asked for. So instead, an
 * off-list value is added to the list, in order.
 */
function daysInactiveOptions(current: number): number[] {
  if (DAYS_INACTIVE_OPTIONS.includes(current)) return DAYS_INACTIVE_OPTIONS;
  return [...DAYS_INACTIVE_OPTIONS, current].sort((a, b) => a - b);
}

/**
 * The three-step "New Campaign" wizard: audience, message, review.
 *
 * Extracted verbatim from CampaignsPage.tsx along with the form state, the AI
 * template helper, the audience-preview query and both send paths. Markup,
 * copy, step logic and mutation bodies are unchanged.
 *
 * Only `open`/`onOpenChange` are owned by the page — everything else the
 * wizard needs it holds itself. `businessSettings` and `optedOutCount` are
 * passed in because the page already loads them for the stats bar.
 */
export function CampaignWizard({
  open,
  onOpenChange,
  orgId,
  businessSettings,
  optedOutCount,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  orgId: string | null;
  businessSettings: { company_name: string | null; timezone?: string | null } | null | undefined;
  optedOutCount: number;
}) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const setCreateOpen = onOpenChange;
  const [searchParams] = useSearchParams();


  // Deep link from Smart Suggestions: ?audience=...&days=...
  // The page owns the `create=1` half (opening the dialog); this is the form
  // half, which lives here now that the form state does.
  useEffect(() => {
    const audience = searchParams.get('audience');
    if (!audience) return;
    const days = parseInt(searchParams.get('days') || '', 10);
    setCampaignForm(prev => ({
      ...prev,
      audience: audience as AudienceType,
      ...(Number.isFinite(days) ? { days_inactive: days } : {}),
    }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const [createStep, setCreateStep] = useState(1);
  const [campaignForm, setCampaignForm] = useState({
    name: "",
    channel: "sms" as "sms" | "email" | "both",
    audience: "active_clients" as AudienceType,
    schedule: "now" as "now" | "later",
    scheduledDate: undefined as Date | undefined,
    scheduledTime: "09:00",
    smsBody: 'Hi {first_name}! This is {company_name}. We wanted to reach out — we\'d love to have you back! Reply STOP to opt out.',
    emailSubject: "",
    emailBody: "",
    days_inactive: 30,
    throttleSeconds: 60,
    excludeAlreadyReceived: false,
    excludeRecentDays: 0,
    onlyAfterDate: undefined as Date | undefined,
  });

  // AI
  const [aiTone, setAiTone] = useState("friendly");
  const [aiTemplates, setAiTemplates] = useState<AITemplate[]>([]);
  const [copiedIndex, setCopiedIndex] = useState<number | null>(null);

  // Test results
  const [testResult, setTestResult] = useState<{
    inactive: number; contactable: number; excludedCount?: number; customers?: any[];
  } | null>(null);

  const generateTemplates = useMutation({
    mutationFn: async () => {
      setAiTemplates([]);
      const { data, error } = await supabase.functions.invoke("generate-campaign-templates", {
        body: {
          companyName: businessSettings?.company_name || "Your Cleaning Service",
          serviceType: "cleaning",
          audience: campaignForm.audience,
          tone: aiTone,
          timestamp: Date.now(),
        },
      });
      if (error) throw error;
      return data;
    },
    onSuccess: (data) => {
      if (data.templates?.length > 0) {
        setAiTemplates(data.templates);
        toast({ title: "Templates generated!", description: "Pick one to use in your campaign" });
      } else {
        toast({ title: "Error", description: "No templates generated. Try again.", variant: "destructive" });
      }
    },
    onError: async (error: Error) => {
      const { handlePossibleAiCreditError } = await import('@/components/ai-credits/AiCreditLimitModal');
      const handled = await handlePossibleAiCreditError(error);
      if (!handled) toast({ title: "Error", description: error.message, variant: "destructive" });
    },
  });

  const createCampaign = useMutation({
    mutationFn: async () => {
      if (!orgId) throw new Error("Organization not found");
      if (smsChannelActive) {
        const err = stopComplianceError(campaignForm.smsBody);
        if (err) throw new Error(err);
      }
      const { error } = await supabase.from("automated_campaigns").insert({
        organization_id: orgId,
        name: campaignForm.name,
        type: "custom",
        days_inactive: campaignForm.days_inactive,
        subject: campaignForm.channel === "email" || campaignForm.channel === "both"
          ? campaignForm.emailSubject : "SMS Campaign",
        body: campaignForm.channel === "sms" ? campaignForm.smsBody : campaignForm.emailBody,
        // A draft is never live, even when the schedule picker still says "now".
        is_active: false,
        throttle_seconds: campaignForm.throttleSeconds,
        scheduled_at: scheduledAtIso,
        channel: campaignForm.channel,
        sms_body: smsChannelActive ? campaignForm.smsBody : null,
      } as never);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["campaigns"] });
      setCreateOpen(false);
      resetForm();
      toast({ title: "Campaign created!" });
    },
    onError: (error: Error) => toast({ title: "Error", description: error.message, variant: "destructive" }),
  });

  const testCampaign = useMutation({
    mutationFn: async (opts?: { silent?: boolean }) => {
      const { data, error } = await supabase.functions.invoke("run-inactive-campaign", {
        body: {
          organizationId: orgId,
          daysInactive: campaignForm.days_inactive,
          targetAudience: campaignForm.audience,
          testMode: true,
          excludeAlreadyReceived: campaignForm.excludeAlreadyReceived,
          excludeRecentDays: campaignForm.excludeRecentDays,
          onlyAfterDate: campaignForm.onlyAfterDate?.toISOString() || null,
        },
      });
      if (error) throw error;
      return { data, silent: opts?.silent };
    },
    onSuccess: ({ data, silent }) => {
      setTestResult({
        inactive: data.inactiveCount || 0,
        contactable: data.toContactCount || 0,
        excludedCount: data.excludedCount || 0,
        customers: data.customers,
      });
      if (!silent) toast({ title: "Preview ready", description: `${data.toContactCount || 0} recipients found` });
    },
    onError: (error: Error) => toast({ title: "Error", description: error.message, variant: "destructive" }),
  });

  // Auto-refresh recipient count on step 1 when audience params change
  useEffect(() => {
    if (!open || createStep !== 1 || !orgId) return;
    if (campaignForm.audience !== "inactive_clients") return;
    const t = setTimeout(() => testCampaign.mutate({ silent: true }), 400);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, createStep, orgId, campaignForm.audience, campaignForm.days_inactive, campaignForm.excludeAlreadyReceived, campaignForm.excludeRecentDays, campaignForm.onlyAfterDate]);

  const sendCampaignNow = useMutation({
    mutationFn: async () => {
      if (!orgId) throw new Error("Organization not found");

      const channel = campaignForm.channel;
      const isSMS   = channel === "sms" || channel === "both";
      const isEmail = channel === "email" || channel === "both";

      // Nothing downstream appends an opt-out line, so this is the last point at
      // which a non-compliant marketing SMS can be stopped.
      if (isSMS) {
        const err = stopComplianceError(campaignForm.smsBody);
        if (err) throw new Error(err);
      }

      const schedulingLater = campaignForm.schedule === "later" && !!scheduledAtIso;

      // Save the campaign record first (provides campaign_id for tracking)
      const { data: newCampaign, error: insertError } = await supabase.from("automated_campaigns").insert({
        organization_id: orgId,
        name: campaignForm.name || `Campaign ${format(new Date(), "MMM d, yyyy")}`,
        type: "custom",
        days_inactive: campaignForm.days_inactive,
        subject: isEmail ? campaignForm.emailSubject : "SMS Campaign",
        body: isEmail ? campaignForm.emailBody : campaignForm.smsBody,
        is_active: !schedulingLater,
        scheduled_at: schedulingLater ? scheduledAtIso : null,
        channel: campaignForm.channel,
        sms_body: isSMS ? campaignForm.smsBody : null,
      } as never).select("id").single();
      if (insertError) throw insertError;

      let smsResult: CampaignDispatchResult | null = null;
      let emailSentCount = 0;

      // SMS leg — run-inactive-campaign handles SMS only
      if (isSMS) {
        const { data: smsData, error: smsError } = await supabase.functions.invoke("run-inactive-campaign", {
          body: {
            organizationId: orgId,
            campaignId: newCampaign.id,
            daysInactive: campaignForm.days_inactive,
            message: campaignForm.smsBody,
            targetAudience: campaignForm.audience,
            testMode: false,
            throttleSeconds: campaignForm.throttleSeconds,
            scheduledAt: scheduledAtIso,
            excludeAlreadyReceived: campaignForm.excludeAlreadyReceived,
            excludeRecentDays: campaignForm.excludeRecentDays,
            onlyAfterDate: campaignForm.onlyAfterDate?.toISOString() || null,
          },
        });
        if (smsError) throw smsError;
        smsResult = smsData ?? null;
      }

      // Email has no later-send worker. A future date is stored on the row
      // and is not sent now. SMS still goes through run-inactive-campaign,
      // which honors scheduledAt.
      let emailDeferred = false;
      if (isEmail && schedulingLater) {
        emailDeferred = true;
      } else if (isEmail) {
        const { data: emailData, error: emailError } = await supabase.functions.invoke("send-followup-campaign", {
          body: {
            campaignId: newCampaign.id,
            targetAudience: campaignForm.audience,
          },
        });
        if (emailError) throw emailError;
        emailSentCount = emailData?.sentCount || 0;
      }

      return { smsResult, emailSentCount, isSMS, isEmail, emailDeferred, schedulingLater };
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["campaigns"] });
      queryClient.invalidateQueries({ queryKey: ["campaign-conversions"] });
      queryClient.invalidateQueries({ queryKey: ["campaign-tracking-stats"] });
      queryClient.invalidateQueries({ queryKey: ["campaign-runs"] });

      // SMS and email report differently on purpose: SMS is queued and
      // delivered over minutes/hours by process-campaign-queue, while email
      // still sends synchronously. Collapsing them into one "N delivered"
      // number would overstate what has actually gone out.
      const parts: string[] = [];
      if (data.isSMS) parts.push(describeCampaignDispatch(data.smsResult, { orgTimezone: (businessSettings as { timezone?: string | null } | null | undefined)?.timezone ?? null }).description);
      if (data.emailDeferred) parts.push("Email saved for that date. Nothing sends it automatically yet — open the campaign when you want it to go out.");
      else if (data.isEmail) parts.push(`${data.emailSentCount} email${data.emailSentCount === 1 ? "" : "s"} sent`);
      const scheduledSms = data.isSMS && data.smsResult?.scheduledAt
        && new Date(data.smsResult.scheduledAt as string).getTime() > Date.now();
      toast({ title: scheduledSms || data.schedulingLater ? "Campaign scheduled" : "Campaign started", description: parts.join(" · ") });

      setCreateOpen(false);
      resetForm();
    },
    onError: (error: Error) => toast({ title: "Error", description: error.message, variant: "destructive" }),
  });

  const resetForm = () => {
    setCampaignForm({
      name: "", channel: "sms", audience: "active_clients", schedule: "now",
      scheduledDate: undefined, scheduledTime: "09:00",
      smsBody: 'Hi {first_name}! This is {company_name}. We wanted to reach out. We\'d love to have you back! Reply STOP to opt out.',
      emailSubject: "", emailBody: "", days_inactive: 30, throttleSeconds: 60,
      excludeAlreadyReceived: false, excludeRecentDays: 0, onlyAfterDate: undefined,
    });
    setCreateStep(1);
    setAiTemplates([]);
    setTestResult(null);
  };

  const handleUseTemplate = (template: AITemplate) => {
    // generate-campaign-templates instructs the model to include the opt-out line,
    // but an instruction is not a guarantee. Append rather than reject: the owner
    // asked for this template, and silently handing them a body that then fails
    // validation would be a worse experience than quietly making it compliant.
    const smsBody = withStopSentence(template.message);
    setCampaignForm(prev => ({ ...prev, smsBody, emailBody: template.message }));
    toast({
      title: "Template applied!",
      description: smsBody !== template.message ? "Added the STOP opt-out line." : undefined,
    });
  };

  const orgTimezone = businessSettings?.timezone ?? null;

  // The picker collects wall-clock values; the org's zone decides the instant.
  const scheduledAtIso =
    campaignForm.schedule === "later" && campaignForm.scheduledDate
      ? zonedWallClockToIso(campaignForm.scheduledDate, campaignForm.scheduledTime, orgTimezone)
      : null;
  const earliestSlotToday = campaignForm.scheduledDate
    ? earliestTimeOnDay(campaignForm.scheduledDate, orgTimezone)
    : null;

  const scheduleIsIncomplete = campaignForm.schedule === "later" && !scheduledAtIso;
  const scheduleIsPast = !!scheduledAtIso && isInPast(scheduledAtIso);

  // Opt-out guard. Only when the campaign actually sends an SMS — a pure email
  // campaign uses an unsubscribe link instead and must NOT carry a STOP line.
  const smsChannelActive = campaignForm.channel === "sms" || campaignForm.channel === "both";
  const smsBodyError = smsChannelActive ? stopComplianceError(campaignForm.smsBody) : null;

  const charCount = campaignForm.smsBody.length;
  const segments = Math.ceil(charCount / 160) || 1;

  return (
            <Dialog open={open} onOpenChange={(next) => { onOpenChange(next); if (!next) resetForm(); }}>
        <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>
              {createStep === 1 ? "Campaign Setup" : createStep === 2 ? "Message Builder" : "Review & Send"}
            </DialogTitle>
            <DialogDescription>
              Step {createStep} of 3
            </DialogDescription>
          </DialogHeader>

          {/* Step indicators */}
          <div className="flex gap-1 mb-2">
            {[1, 2, 3].map(s => (
              <div key={s} className={cn("h-1 flex-1 rounded-full transition-colors", s <= createStep ? "bg-primary" : "bg-muted")} />
            ))}
          </div>

          {createStep === 1 && (
            <div className="space-y-4">
              <div className="space-y-2">
                <Label>Campaign Name</Label>
                <Input
                  value={campaignForm.name}
                  onChange={e => setCampaignForm(prev => ({ ...prev, name: e.target.value }))}
                  placeholder="e.g., Spring Cleaning Promo"
                />
              </div>

              <div className="space-y-2">
                <Label>Channel</Label>
                <div className="flex gap-2">
                  {(["sms", "email", "both"] as const).map(ch => (
                    <Button
                      key={ch}
                      variant={campaignForm.channel === ch ? "default" : "outline"}
                      size="sm"
                      className="gap-1.5 flex-1"
                      onClick={() => setCampaignForm(prev => ({ ...prev, channel: ch }))}
                    >
                      {ch === "sms" ? <MessageSquare className="w-3.5 h-3.5" /> : ch === "email" ? <Mail className="w-3.5 h-3.5" /> : <><MessageSquare className="w-3.5 h-3.5" /><Mail className="w-3.5 h-3.5" /></>}
                      {ch === "both" ? "Both" : ch.toUpperCase()}
                    </Button>
                  ))}
                </div>
              </div>

              <div className="space-y-2">
                <Label>Target Audience</Label>
                <Select value={campaignForm.audience} onValueChange={v => setCampaignForm(prev => ({ ...prev, audience: v as AudienceType }))}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {audienceOptions.map(o => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>

              {campaignForm.audience === "inactive_clients" && (
                <div className="space-y-2">
                  <Label>Days Inactive</Label>
                  <Select value={campaignForm.days_inactive.toString()} onValueChange={v => setCampaignForm(prev => ({ ...prev, days_inactive: parseInt(v) }))}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {daysInactiveOptions(campaignForm.days_inactive).map(d => (
                        <SelectItem key={d} value={d.toString()}>{d} days</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <div className="mt-2 flex items-center justify-between rounded-md border bg-muted/40 px-3 py-2 text-xs">
                    <span>
                      {testCampaign.isPending
                        ? 'Counting recipients…'
                        : testResult
                          ? <>Recipients: <strong>{testResult.contactable}</strong>{(testResult.excludedCount || 0) > 0 && <span className="text-muted-foreground"> · {testResult.excludedCount} excluded</span>}</>
                          : 'Recipient count will appear here.'}
                    </span>
                    <Button size="sm" variant="ghost" className="h-6 px-2 text-xs"
                      onClick={() => testCampaign.mutate(undefined)} disabled={testCampaign.isPending}>
                      Refresh
                    </Button>
                  </div>
                </div>
              )}

              {/* Exclude Filters */}
              <div className="space-y-3 rounded-lg border p-3">
                <Label className="text-sm font-medium flex items-center gap-2">
                  <UserX className="w-4 h-4" />
                  Duplicate Send Filters
                </Label>

                <div className="flex items-center justify-between">
                  <div className="space-y-0.5">
                    <p className="text-sm">Exclude already received</p>
                    <p className="text-xs text-muted-foreground">Skip clients who got this exact campaign before</p>
                  </div>
                  <Switch
                    checked={campaignForm.excludeAlreadyReceived}
                    onCheckedChange={c => setCampaignForm(prev => ({ ...prev, excludeAlreadyReceived: c }))}
                  />
                </div>

                <div className="space-y-1.5">
                  <p className="text-sm">Skip recently contacted</p>
                  <Select
                    value={campaignForm.excludeRecentDays.toString()}
                    onValueChange={v => setCampaignForm(prev => ({ ...prev, excludeRecentDays: parseInt(v) }))}
                  >
                    <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="0">No filter</SelectItem>
                      <SelectItem value="7">Last 7 days</SelectItem>
                      <SelectItem value="14">Last 14 days</SelectItem>
                      <SelectItem value="30">Last 30 days</SelectItem>
                      <SelectItem value="60">Last 60 days</SelectItem>
                      <SelectItem value="90">Last 90 days</SelectItem>
                    </SelectContent>
                  </Select>
                  <p className="text-xs text-muted-foreground">Skip clients who received any campaign within this window</p>
                </div>

                <div className="space-y-1.5">
                  <p className="text-sm">Only new clients after</p>
                  <Popover>
                    <PopoverTrigger asChild>
                      <Button variant="outline" size="sm" className={cn("w-full justify-start text-left font-normal", !campaignForm.onlyAfterDate && "text-muted-foreground")}>
                        <CalendarDays className="w-4 h-4 mr-2" />
                        {campaignForm.onlyAfterDate ? format(campaignForm.onlyAfterDate, "PPP") : "No date filter"}
                      </Button>
                    </PopoverTrigger>
                    <PopoverContent className="w-auto p-0" align="start">
                      <Calendar
                        mode="single"
                        selected={campaignForm.onlyAfterDate}
                        onSelect={d => setCampaignForm(prev => ({ ...prev, onlyAfterDate: d }))}
                        className={cn("p-3 pointer-events-auto")}
                      />
                    </PopoverContent>
                  </Popover>
                  {campaignForm.onlyAfterDate && (
                    <Button variant="ghost" size="sm" className="text-xs h-6 px-2" onClick={() => setCampaignForm(prev => ({ ...prev, onlyAfterDate: undefined }))}>
                      <X className="w-3 h-3 mr-1" /> Clear date filter
                    </Button>
                  )}
                  <p className="text-xs text-muted-foreground">Target only clients added after this date</p>
                </div>
              </div>

              <div className="space-y-2">
                <Label>Schedule</Label>
                <div className="flex gap-2">
                  <Button
                    variant={campaignForm.schedule === "now" ? "default" : "outline"}
                    size="sm" className="flex-1"
                    onClick={() => setCampaignForm(prev => ({ ...prev, schedule: "now" }))}
                  >
                    Send Now
                  </Button>
                  <Button
                    variant={campaignForm.schedule === "later" ? "default" : "outline"}
                    size="sm" className="flex-1"
                    onClick={() => setCampaignForm(prev => ({ ...prev, schedule: "later" }))}
                  >
                    Schedule for Later
                  </Button>
                </div>
                {campaignForm.schedule === "later" && (
                  <div className="flex gap-2 mt-2">
                    <Popover>
                      <PopoverTrigger asChild>
                        <Button variant="outline" className={cn("flex-1 justify-start text-left font-normal", !campaignForm.scheduledDate && "text-muted-foreground")}>
                          <CalendarDays className="w-4 h-4 mr-2" />
                          {campaignForm.scheduledDate ? format(campaignForm.scheduledDate, "PPP") : "Pick a date"}
                        </Button>
                      </PopoverTrigger>
                      <PopoverContent className="w-auto p-0" align="start">
                        <Calendar
                          mode="single"
                          selected={campaignForm.scheduledDate}
                          onSelect={d => setCampaignForm(prev => ({
                            ...prev,
                            scheduledDate: d,
                            // Picking today with the 09:00 default would resolve to
                            // the past; move it to the next open slot instead of
                            // silently leaving an unsendable time in the field.
                            scheduledTime: d ? (clampTimeToDay(d, prev.scheduledTime, orgTimezone) ?? prev.scheduledTime) : prev.scheduledTime,
                          }))}
                          disabled={d => isDayFullyPast(d, orgTimezone)}
                          className={cn("p-3 pointer-events-auto")}
                        />
                      </PopoverContent>
                    </Popover>
                    <Input
                      type="time"
                      value={campaignForm.scheduledTime}
                      min={earliestSlotToday ?? undefined}
                      onChange={e => setCampaignForm(prev => ({ ...prev, scheduledTime: e.target.value }))}
                      className="w-[130px]"
                    />
                  </div>
                )}
                {campaignForm.schedule === "later" && (
                  <p className={cn("text-xs mt-1", scheduleIsPast ? "text-destructive" : "text-muted-foreground")}>
                    {!campaignForm.scheduledDate
                      ? "Pick a date and time."
                      : scheduleIsIncomplete
                        ? "That time could not be read. Use HH:MM."
                        : scheduleIsPast
                          ? `${describeScheduledInstant(scheduledAtIso!, orgTimezone)} is in the past. It would send immediately.`
                          : `Sends ${describeScheduledInstant(scheduledAtIso!, orgTimezone)}.`}
                  </p>
                )}
              </div>

              <ThrottleSelect
                value={campaignForm.throttleSeconds}
                onChange={(seconds) => setCampaignForm(prev => ({ ...prev, throttleSeconds: seconds }))}
                recipientCount={testResult?.contactable ?? null}
              />
            </div>
          )}

          {createStep === 2 && (
            <div className="space-y-4">
              {/* AI Helper */}
              <Card className="border-primary/20 bg-primary/5">
                <CardContent className="p-4">
                  <div className="flex items-center gap-2 mb-3">
                    <Sparkles className="w-4 h-4 text-primary" />
                    <span className="font-medium text-sm">AI Template Generator</span>
                  </div>
                  <div className="flex flex-wrap gap-2 items-end">
                    <div className="space-y-1.5">
                      <Label className="text-xs">Tone</Label>
                      <Select value={aiTone} onValueChange={setAiTone}>
                        <SelectTrigger className="w-[140px] min-h-[44px] text-sm"><SelectValue /></SelectTrigger>
                        <SelectContent>
                          {toneOptions.map(t => <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>)}
                        </SelectContent>
                      </Select>
                    </div>
                    <Button size="sm" onClick={() => generateTemplates.mutate()} disabled={generateTemplates.isPending} className="gap-1.5">
                      {generateTemplates.isPending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Sparkles className="w-3.5 h-3.5" />}
                      Generate
                    </Button>
                  </div>
                  {aiTemplates.length > 0 && (
                    <div className="grid gap-2 mt-3 grid-cols-1 md:grid-cols-3">
                      {aiTemplates.map((t, i) => (
                        <div key={i} className="p-3 bg-background rounded-lg border text-xs">
                          <p className="font-medium text-primary mb-1">{t.name}</p>
                          <p className="text-muted-foreground line-clamp-3 mb-2">{t.message}</p>
                          <Button size="sm" variant="outline" className="w-full min-h-[44px] text-xs" onClick={() => handleUseTemplate(t)}>
                            Use This
                          </Button>
                        </div>
                      ))}
                    </div>
                  )}
                </CardContent>
              </Card>

              {(campaignForm.channel === "sms" || campaignForm.channel === "both") && (
                <div className="space-y-2">
                  <Label>SMS Message</Label>
                  <Textarea
                    value={campaignForm.smsBody}
                    onChange={e => setCampaignForm(prev => ({ ...prev, smsBody: e.target.value }))}
                    placeholder="Hi {first_name}! ..."
                    rows={4}
                  />
                  <div className="flex justify-between text-xs text-muted-foreground">
                    <span>Placeholders: {"{first_name}"}, {"{last_name}"}, {"{company_name}"}, {"{booking_link}"}</span>
                    <span className={cn(charCount > 160 ? "text-amber-600" : "")}>{charCount} chars · {segments} segment{segments > 1 ? "s" : ""}</span>
                  </div>
                  {smsBodyError && (
                    <div className="rounded-md border border-destructive/40 bg-destructive/5 p-2.5 space-y-2">
                      <p className="text-xs text-destructive">{smsBodyError}</p>
                      {campaignForm.smsBody.trim() && (
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          className="h-7 text-xs"
                          onClick={() => setCampaignForm(prev => ({ ...prev, smsBody: withStopSentence(prev.smsBody) }))}
                        >
                          Add it for me
                        </Button>
                      )}
                    </div>
                  )}
                </div>
              )}

              {(campaignForm.channel === "email" || campaignForm.channel === "both") && (
                <>
                  <div className="space-y-2">
                    <Label>Email Subject</Label>
                    <Input
                      value={campaignForm.emailSubject}
                      onChange={e => setCampaignForm(prev => ({ ...prev, emailSubject: e.target.value }))}
                      placeholder="Your next cleaning is waiting!"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label>Email Body</Label>
                    <Textarea
                      value={campaignForm.emailBody}
                      onChange={e => setCampaignForm(prev => ({ ...prev, emailBody: e.target.value }))}
                      placeholder="Hi {first_name},\n\nWe'd love to have you back..."
                      rows={6}
                    />
                    <p className="text-xs text-muted-foreground">
                      Placeholders: {"{first_name}"}, {"{last_name}"}, {"{company_name}"}, {"{booking_link}"}
                    </p>
                  </div>
                </>
              )}

              {/* Live Preview */}
              {(campaignForm.channel === "sms" || campaignForm.channel === "both") && campaignForm.smsBody && (
                <div className="space-y-2">
                  <Label className="text-xs text-muted-foreground">SMS Preview</Label>
                  <div className="bg-muted rounded-2xl p-4 max-w-full sm:max-w-[280px]">
                    <div className="bg-primary text-primary-foreground rounded-2xl rounded-bl-md px-4 py-3 text-sm whitespace-pre-wrap">
                      {campaignForm.smsBody
                        .replace(/\{first_name\}/g, "Sarah")
                        .replace(/\{last_name\}/g, "Johnson")
                        .replace(/\{company_name\}/g, businessSettings?.company_name || "Your Company")
                        .replace(/\{booking_link\}/g, "jointidywise.com/book/…?ref=abc123")
                        .replace(/\{booking_date\}/g, "Jan 15")
                        .replace(/\{service_type\}/g, "Deep Clean")}
                    </div>
                  </div>
                </div>
              )}
            </div>
          )}

          {createStep === 3 && (
            <div className="space-y-4">
              <div className="bg-muted rounded-lg p-4 space-y-3">
                <h4 className="font-medium text-sm">Campaign Summary</h4>
                <div className="grid grid-cols-2 gap-3 text-sm">
                  <div>
                    <p className="text-muted-foreground text-xs">Name</p>
                    <p className="font-medium">{campaignForm.name || "Untitled"}</p>
                  </div>
                  <div>
                    <p className="text-muted-foreground text-xs">Channel</p>
                    <p className="font-medium capitalize">{campaignForm.channel}</p>
                  </div>
                  <div>
                    <p className="text-muted-foreground text-xs">Audience</p>
                    <p className="font-medium capitalize">{campaignForm.audience.replace(/_/g, " ")}</p>
                  </div>
                  <div>
                    <p className="text-muted-foreground text-xs">Schedule</p>
                    <p className="font-medium">
                      {campaignForm.schedule === "now"
                        ? "Send immediately"
                        : scheduledAtIso
                          ? describeScheduledInstant(scheduledAtIso, orgTimezone)
                          : "Not set"}
                    </p>
                    <p className="text-xs text-muted-foreground mt-0.5">
                      {THROTTLE_OPTIONS.find(o => o.value === campaignForm.throttleSeconds)?.label
                        ?? `One every ${campaignForm.throttleSeconds} seconds`}
                      {testResult?.contactable && testResult.contactable > 1
                        ? ` · ${describeDuration(testResult.contactable, campaignForm.throttleSeconds)}`
                        : ""}
                    </p>
                  </div>
                </div>
                {optedOutCount > 0 && (
                  <p className="text-xs text-muted-foreground flex items-center gap-1">
                    <UserX className="w-3 h-3" /> {optedOutCount} opted-out contacts will be excluded
                  </p>
                )}
                {(campaignForm.excludeAlreadyReceived || campaignForm.excludeRecentDays > 0 || campaignForm.onlyAfterDate) && (
                  <div className="flex flex-wrap gap-2 mt-1">
                    {campaignForm.excludeAlreadyReceived && (
                      <Badge variant="secondary" className="text-xs">Excluding already received</Badge>
                    )}
                    {campaignForm.excludeRecentDays > 0 && (
                      <Badge variant="secondary" className="text-xs">Skip contacted in last {campaignForm.excludeRecentDays}d</Badge>
                    )}
                    {campaignForm.onlyAfterDate && (
                      <Badge variant="secondary" className="text-xs">Only after {format(campaignForm.onlyAfterDate, "MMM d, yyyy")}</Badge>
                    )}
                  </div>
                )}
              </div>

              {/* Preview audience */}
              <Button variant="outline" className="w-full gap-2" onClick={() => testCampaign.mutate(undefined)} disabled={testCampaign.isPending}>
                {testCampaign.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Eye className="w-4 h-4" />}
                Preview Recipients
              </Button>

              {testResult && (
                <div className="bg-muted rounded-lg p-4 space-y-2">
                  <div className="flex items-center gap-2">
                    <Check className="w-4 h-4 text-emerald-500" />
                    <p className="text-sm font-medium">
                      ✅ {testResult.contactable} clients match this audience
                    </p>
                  </div>
                  {(testResult.excludedCount || 0) > 0 && (
                    <p className="text-xs text-muted-foreground flex items-center gap-1">
                      <UserX className="w-3 h-3" /> {testResult.excludedCount} excluded by filters
                    </p>
                  )}
                  {testResult.customers && testResult.customers.length > 0 && (
                    <div className="max-h-60 overflow-y-auto space-y-1">
                      {testResult.customers.map((c: any) => {
                        const isExcluded = c.already_received || c.recently_contacted;
                        return (
                          <div key={c.id} className={cn("flex items-center justify-between text-sm p-2 rounded border", isExcluded ? "bg-muted/50 opacity-60" : "bg-background")}>
                            <span className="font-medium">{c.first_name} {c.last_name}</span>
                            <div className="flex items-center gap-2">
                              {c.already_received && (
                                <Badge variant="outline" className="text-xs text-muted-foreground">Already received</Badge>
                              )}
                              {c.recently_contacted && !c.already_received && (
                                <Badge variant="outline" className="text-xs text-muted-foreground">Recently contacted</Badge>
                              )}
                              <span className="text-xs text-muted-foreground">{c.phone || c.email || "No contact"}</span>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              )}

              {/* Message preview */}
              {(campaignForm.channel === "sms" || campaignForm.channel === "both") && (
                <div className="space-y-1">
                  <p className="text-xs text-muted-foreground">Message Preview</p>
                  <div className="bg-muted rounded-lg p-3 text-sm">{campaignForm.smsBody}</div>
                </div>
              )}
              {(campaignForm.channel === "email" || campaignForm.channel === "both") && campaignForm.emailSubject && (
                <div className="space-y-1">
                  <p className="text-xs text-muted-foreground">Email: {campaignForm.emailSubject}</p>
                  <div className="bg-muted rounded-lg p-3 text-sm whitespace-pre-wrap">{campaignForm.emailBody}</div>
                </div>
              )}
            </div>
          )}

          <DialogFooter className="flex-col sm:flex-row gap-2">
            {createStep > 1 && (
              <Button variant="outline" onClick={() => setCreateStep(s => s - 1)}>Back</Button>
            )}
            <div className="flex-1" />
            {createStep < 3 ? (
              <Button onClick={() => setCreateStep(s => s + 1)} disabled={createStep === 1 && !campaignForm.name}>
                Continue
              </Button>
            ) : (
              <div className="flex gap-2">
                <Button variant="outline" onClick={() => { createCampaign.mutate(); }} disabled={createCampaign.isPending || !!smsBodyError}>
                  {createCampaign.isPending && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
                  Save as Draft
                </Button>
                <Button
                  onClick={() => sendCampaignNow.mutate()}
                  // A schedule that cannot be resolved, or that is already in the
                  // past, must not be sendable — the old build showed the chosen
                  // date and then sent immediately anyway.
                  disabled={sendCampaignNow.isPending || scheduleIsIncomplete || scheduleIsPast || !!smsBodyError}
                >
                  {sendCampaignNow.isPending && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
                  {campaignForm.schedule === "later"
                    ? <CalendarDays className="w-4 h-4 mr-2" />
                    : <Send className="w-4 h-4 mr-2" />}
                  {campaignForm.schedule === "later" ? "Schedule Campaign" : "Send Campaign"}
                </Button>
              </div>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>

  );
}
