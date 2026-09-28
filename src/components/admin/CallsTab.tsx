import { useState, useEffect, useMemo, useCallback } from 'react';
import { supabase } from '@/lib/supabase';
import { toast } from 'sonner';
import { format, isToday, isThisWeek } from 'date-fns';
import { useOrgTimezone } from '@/hooks/useOrgTimezone';
import { formatInTimezone, formatTimestampWithZone } from '@/lib/timezoneUtils';
import {
  Phone, PhoneIncoming, PhoneOutgoing, PhoneMissed, Voicemail,
  Search, Loader2, RefreshCw, FileText, Mic, Play, Download,
  MessageSquare, UserPlus, StickyNote, ChevronRight, X, Clock,
  Filter, Copy, Check, ExternalLink,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { cn } from '@/lib/utils';
import { useIsMobile } from '@/hooks/use-mobile';
import { hapticImpact } from '@/lib/haptics';
import { orgDateKey } from '@/lib/orgDateRange';

interface OpenPhoneCall {
  id: string;
  organization_id: string;
  openphone_call_id: string;
  // Nullable in openphone_calls. The interface claimed otherwise, which is
  // what made assigning a query row to it fail.
  direction: string;
  status: string;
  duration: number | null;
  caller_phone: string | null;
  caller_name: string | null;
  phone_number_id: string | null;
  started_at: string | null;
  ended_at: string | null;
  has_recording: boolean | null;
  has_transcript: boolean | null;
  has_summary: boolean | null;
  has_voicemail: boolean | null;
  ai_summary: string | null;
  transcript: any;
  recording_url: string | null;
  voicemail_url: string | null;
  voicemail_transcript: string | null;
  matched_customer_id: string | null;
  matched_lead_id: string | null;
  raw_data: any;
}

type CallFilter = 'all' | 'incoming' | 'outgoing' | 'missed' | 'voicemails';

interface CallsTabProps {
  organizationId: string;
}

const formatDuration = (seconds: number | null): string => {
  // `!seconds` already covered null before the type said so.
  if (!seconds || seconds <= 0) return '0:00';
  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  return `${mins}:${secs.toString().padStart(2, '0')}`;
};

const formatCallTime = (dateStr: string | null, timeZone: string) => {
  if (!dateStr) return '';
  const d = new Date(dateStr);
  // A call's timestamp is an instant; whether it happened "today" is the
  // business's question, not the viewer's.
  if (orgDateKey(d, timeZone) === orgDateKey(new Date(), timeZone)) return formatTimestampWithZone(d, timeZone);
  if (isThisWeek(d)) return formatTimestampWithZone(d, timeZone);
  return formatTimestampWithZone(d, timeZone);
};

const getCallIcon = (call: OpenPhoneCall) => {
  if (call.status === 'missed' || call.status === 'no-answer') {
    return <PhoneMissed className="h-4 w-4 text-destructive" />;
  }
  if (call.direction === 'inbound') {
    return <PhoneIncoming className="h-4 w-4 text-green-600" />;
  }
  return <PhoneOutgoing className="h-4 w-4 text-primary" />;
};

const getCallStatusLabel = (call: OpenPhoneCall) => {
  if (call.status === 'missed' || call.status === 'no-answer') return 'Missed';
  if (call.status === 'voicemail') return 'Voicemail';
  if (call.direction === 'inbound') return 'Incoming';
  return 'Outgoing';
};

const getInitials = (name: string | null, phone: string | null) => {
  if (name) return name.split(' ').map(n => n[0]).join('').toUpperCase().slice(0, 2);
  if (phone) return phone.slice(-2);
  return '??';
};

export default function CallsTab({ organizationId }: CallsTabProps) {
  const { timezone: orgTz } = useOrgTimezone();
  const [calls, setCalls] = useState<OpenPhoneCall[]>([]);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [activeFilter, setActiveFilter] = useState<CallFilter>('all');
  const [selectedCall, setSelectedCall] = useState<OpenPhoneCall | null>(null);
  const [detailsLoading, setDetailsLoading] = useState(false);
  const [copiedTranscript, setCopiedTranscript] = useState(false);
  const [notConfigured, setNotConfigured] = useState(false);
  const isMobile = useIsMobile();

  const fetchCalls = useCallback(async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from('openphone_calls')
      .select('*')
      .eq('organization_id', organizationId)
      .order('started_at', { ascending: false })
      .limit(100);

    if (error) {
      console.error('Failed to fetch calls:', error);
      toast.error('Failed to load calls');
    } else {
      setCalls(data || []);
    }
    setLoading(false);
  }, [organizationId]);

  const syncCalls = useCallback(async () => {
    setSyncing(true);
    hapticImpact('light');
    try {
      // Add a 15-second timeout to prevent infinite syncing state
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 15000);

      const { data, error } = await supabase.functions.invoke('sync-openphone-calls', {
        body: { organizationId, maxResults: 50 },
      });

      clearTimeout(timeout);

      if (error) throw error;
      if (data?.error) {
        if (data.code === 'NOT_CONFIGURED') {
          setNotConfigured(true);
          setSyncing(false);
          return;
        }
        throw new Error(data.error);
      }
      toast.success(`Synced ${data.synced || 0} calls`);
      await fetchCalls();
    } catch (err: any) {
      if (err?.name === 'AbortError') {
        toast.error('Sync timed out. Try again.');
      } else {
        toast.error(err.message || 'Failed to sync calls');
      }
    } finally {
      setSyncing(false);
    }
  }, [organizationId, fetchCalls]);

  useEffect(() => {
    fetchCalls();
  // eslint-disable-next-line react-hooks/exhaustive-deps -- fetchCalls is recreated each render; runs once per org
  }, [organizationId]);

  const fetchCallDetails = useCallback(async (call: OpenPhoneCall) => {
    if (call.ai_summary && call.transcript) return; // Already cached
    setDetailsLoading(true);
    try {
      const { data, error } = await supabase.functions.invoke('openphone-call-details', {
        body: { organizationId, callId: call.openphone_call_id },
      });
      if (error) throw error;
      // Update local state with fetched details
      setCalls(prev =>
        prev.map(c =>
          c.id === call.id
            ? {
                ...c,
                ai_summary: data.summary?.summary || data.summary || c.ai_summary,
                transcript: data.transcript || c.transcript,
                recording_url: data.recording?.url || data.recording?.media?.url || c.recording_url,
                voicemail_url: data.voicemail?.url || data.voicemail?.media?.url || c.voicemail_url,
                voicemail_transcript: data.voicemail?.transcript || c.voicemail_transcript,
                has_summary: !!data.summary && !(data.summary as any)?.unavailable,
                has_transcript: !!data.transcript && !(data.transcript as any)?.unavailable,
                has_recording: !!data.recording && !(data.recording as any)?.unavailable,
                has_voicemail: !!data.voicemail && !(data.voicemail as any)?.unavailable,
              }
            : c
        )
      );
      setSelectedCall(prev => {
        if (prev?.id === call.id) {
          return {
            ...prev,
            ai_summary: data.summary?.summary || data.summary || prev.ai_summary,
            transcript: data.transcript || prev.transcript,
            recording_url: data.recording?.url || data.recording?.media?.url || prev.recording_url,
            voicemail_url: data.voicemail?.url || data.voicemail?.media?.url || prev.voicemail_url,
            voicemail_transcript: data.voicemail?.transcript || prev.voicemail_transcript,
          };
        }
        return prev;
      });
    } catch (err: any) {
      console.error('Failed to fetch call details:', err);
    } finally {
      setDetailsLoading(false);
    }
  }, [organizationId]);

  const handleSelectCall = (call: OpenPhoneCall) => {
    hapticImpact('light');
    setSelectedCall(call);
    fetchCallDetails(call);
  };

  const filteredCalls = useMemo(() => {
    return calls.filter(call => {
      // Filter
      if (activeFilter === 'incoming' && call.direction !== 'inbound') return false;
      if (activeFilter === 'outgoing' && call.direction !== 'outbound') return false;
      if (activeFilter === 'missed' && call.status !== 'missed' && call.status !== 'no-answer') return false;
      if (activeFilter === 'voicemails' && !call.has_voicemail) return false;
      // Search
      if (searchQuery) {
        const q = searchQuery.toLowerCase();
        const matchesName = call.caller_name?.toLowerCase().includes(q);
        const matchesPhone = call.caller_phone?.includes(searchQuery);
        if (!matchesName && !matchesPhone) return false;
      }
      return true;
    });
  }, [calls, activeFilter, searchQuery]);

  // ─── Stats ────────────────────────────────────
  const stats = useMemo(() => {
    const total = calls.length;
    const missed = calls.filter(c => c.status === 'missed' || c.status === 'no-answer').length;
    const avgDuration = total > 0 ? Math.round(calls.reduce((sum, c) => sum + (c.duration || 0), 0) / total) : 0;
    return { total, missed, avgDuration };
  }, [calls]);

  const handleCopyTranscript = (transcript: any) => {
    let text = '';
    if (Array.isArray(transcript)) {
      text = transcript.map((t: any) => `[${t.speaker || 'Speaker'}]: ${t.text}`).join('\n');
    } else if (typeof transcript === 'string') {
      text = transcript;
    } else {
      text = JSON.stringify(transcript, null, 2);
    }
    navigator.clipboard.writeText(text);
    setCopiedTranscript(true);
    setTimeout(() => setCopiedTranscript(false), 2000);
    toast.success('Transcript copied');
  };

  if (notConfigured) {
    return (
      <div className="flex flex-col items-center justify-center p-12 text-center">
        <Phone className="h-12 w-12 text-muted-foreground/30 mb-4" />
        <h3 className="text-lg font-medium text-foreground mb-2">Connect OpenPhone</h3>
        <p className="text-sm text-muted-foreground max-w-sm">
          Connect OpenPhone in Settings → Phone & SMS to see your calls here.
        </p>
      </div>
    );
  }

  // ─── Call Detail Drawer ───────────────────────
  const renderCallDetail = () => {
    if (!selectedCall) return null;

    const isMissed = selectedCall.status === 'missed' || selectedCall.status === 'no-answer';
    const isUnknown = !selectedCall.matched_customer_id && !selectedCall.matched_lead_id;

    return (
      <Sheet open={!!selectedCall} onOpenChange={(open) => { if (!open) setSelectedCall(null); }}>
        <SheetContent side={isMobile ? "bottom" : "right"} className={cn(
          isMobile ? "h-[90dvh] rounded-t-2xl" : "w-[480px] sm:max-w-[480px]",
          "overflow-y-auto"
        )}>
          <SheetHeader className="pb-4">
            <SheetTitle className="flex items-center gap-3">
              <Avatar className="h-10 w-10">
                <AvatarFallback className={cn(
                  "text-sm font-semibold",
                  isMissed ? "bg-destructive/10 text-destructive" : "bg-primary/10 text-primary"
                )}>
                  {getInitials(selectedCall.caller_name, selectedCall.caller_phone)}
                </AvatarFallback>
              </Avatar>
              <div>
                <p className="text-base font-semibold">{selectedCall.caller_name || selectedCall.caller_phone || 'Unknown'}</p>
                <p className="text-sm text-muted-foreground font-normal">{selectedCall.caller_phone}</p>
              </div>
            </SheetTitle>
          </SheetHeader>

          <div className="space-y-6 pb-8">
            {/* Unknown caller banner */}
            {isMissed && isUnknown && (
              <div className="bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800 rounded-xl p-4">
                <p className="text-sm font-medium text-amber-800 dark:text-amber-200 mb-2">
                  ⚠️ Unknown caller — Create lead from this call?
                </p>
                <Button size="sm" variant="outline" className="gap-2"
                  onClick={() => {
                    toast.info('Navigate to Leads page to create a new lead');
                    setSelectedCall(null);
                  }}>
                  <UserPlus className="h-4 w-4" /> Create Lead
                </Button>
              </div>
            )}

            {/* Call Info */}
            <div className="space-y-3">
              <h4 className="text-sm font-semibold text-foreground">Call Info</h4>
              <div className="grid grid-cols-2 gap-3">
                <div className="bg-muted/50 rounded-lg p-3">
                  <p className="text-xs text-muted-foreground">Direction</p>
                  <div className="flex items-center gap-1.5 mt-1">
                    {getCallIcon(selectedCall)}
                    <span className="text-sm font-medium">{getCallStatusLabel(selectedCall)}</span>
                  </div>
                </div>
                <div className="bg-muted/50 rounded-lg p-3">
                  <p className="text-xs text-muted-foreground">Duration</p>
                  <div className="flex items-center gap-1.5 mt-1">
                    <Clock className="h-4 w-4 text-muted-foreground" />
                    <span className="text-sm font-medium">{formatDuration(selectedCall.duration)}</span>
                  </div>
                </div>
                <div className="bg-muted/50 rounded-lg p-3 col-span-2">
                  <p className="text-xs text-muted-foreground">Date & Time</p>
                  <p className="text-sm font-medium mt-1">
                    {selectedCall.started_at ? formatInTimezone(selectedCall.started_at, orgTz, { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit', hour12: true, timeZoneName: 'short' }) : 'N/A'}
                  </p>
                </div>
              </div>
            </div>

            {/* AI Summary */}
            <div className="space-y-2">
              <h4 className="text-sm font-semibold text-foreground flex items-center gap-2">
                🤖 AI Call Summary
              </h4>
              {detailsLoading ? (
                <div className="flex items-center gap-2 p-4 bg-muted/50 rounded-lg">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  <span className="text-sm text-muted-foreground">Loading summary...</span>
                </div>
              ) : selectedCall.ai_summary ? (
                <div className="bg-muted/50 rounded-lg p-4">
                  <p className="text-sm leading-relaxed">{typeof selectedCall.ai_summary === 'string' ? selectedCall.ai_summary : JSON.stringify(selectedCall.ai_summary)}</p>
                </div>
              ) : (
                <div className="bg-muted/30 rounded-lg p-4 text-center">
                  <p className="text-sm text-muted-foreground">Summary not available — requires OpenPhone Business plan</p>
                </div>
              )}
            </div>

            {/* Transcript */}
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <h4 className="text-sm font-semibold text-foreground flex items-center gap-2">
                  <FileText className="h-4 w-4" /> Full Transcript
                </h4>
                {selectedCall.transcript && (
                  <Button variant="ghost" size="sm" className="gap-1.5 min-h-[44px] text-xs"
                    onClick={() => handleCopyTranscript(selectedCall.transcript)}>
                    {copiedTranscript ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
                    {copiedTranscript ? 'Copied' : 'Copy'}
                  </Button>
                )}
              </div>
              {detailsLoading ? (
                <div className="flex items-center gap-2 p-4 bg-muted/50 rounded-lg">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  <span className="text-sm text-muted-foreground">Loading transcript...</span>
                </div>
              ) : selectedCall.transcript ? (
                <div className="bg-muted/50 rounded-lg p-4 max-h-60 overflow-y-auto space-y-2">
                  {Array.isArray(selectedCall.transcript) ? (
                    selectedCall.transcript.map((entry: any, i: number) => (
                      <div key={i} className="text-sm">
                        <span className="font-semibold text-primary">[{entry.speaker || `Speaker ${i + 1}`}]:</span>{' '}
                        <span>{entry.text}</span>
                      </div>
                    ))
                  ) : typeof selectedCall.transcript === 'string' ? (
                    <p className="text-sm whitespace-pre-wrap">{selectedCall.transcript}</p>
                  ) : (
                    <p className="text-sm whitespace-pre-wrap">{JSON.stringify(selectedCall.transcript, null, 2)}</p>
                  )}
                </div>
              ) : (
                <div className="bg-muted/30 rounded-lg p-4 text-center">
                  <p className="text-sm text-muted-foreground">Transcript not available — requires OpenPhone Business plan</p>
                </div>
              )}
            </div>

            {/* Recording */}
            <div className="space-y-2">
              <h4 className="text-sm font-semibold text-foreground flex items-center gap-2">
                <Mic className="h-4 w-4" /> Recording
              </h4>
              {selectedCall.recording_url ? (
                <div className="bg-muted/50 rounded-lg p-4 space-y-3">
                  <audio controls className="w-full" src={selectedCall.recording_url}>
                    Your browser does not support the audio element.
                  </audio>
                  <Button variant="outline" size="sm" className="gap-2" asChild>
                    <a href={selectedCall.recording_url} download target="_blank" rel="noopener noreferrer">
                      <Download className="h-4 w-4" /> Download Recording
                    </a>
                  </Button>
                </div>
              ) : (
                <div className="bg-muted/30 rounded-lg p-4 text-center">
                  <p className="text-sm text-muted-foreground">Recording not available</p>
                </div>
              )}
            </div>

            {/* Voicemail */}
            <div className="space-y-2">
              <h4 className="text-sm font-semibold text-foreground flex items-center gap-2">
                <Voicemail className="h-4 w-4" /> Voicemail
              </h4>
              {selectedCall.has_voicemail ? (
                <div className="bg-muted/50 rounded-lg p-4 space-y-3">
                  {selectedCall.voicemail_transcript && (
                    <p className="text-sm leading-relaxed">{selectedCall.voicemail_transcript}</p>
                  )}
                  {selectedCall.voicemail_url && (
                    <audio controls className="w-full" src={selectedCall.voicemail_url}>
                      Your browser does not support the audio element.
                    </audio>
                  )}
                </div>
              ) : (
                <div className="bg-muted/30 rounded-lg p-4 text-center">
                  <p className="text-sm text-muted-foreground">No voicemail</p>
                </div>
              )}
            </div>

            {/* Actions */}
            <div className="space-y-2">
              <h4 className="text-sm font-semibold text-foreground">Actions</h4>
              <div className="grid grid-cols-2 gap-2">
                <Button variant="outline" className="gap-2 h-11" asChild>
                  <a href={`tel:${selectedCall.caller_phone}`}>
                    <Phone className="h-4 w-4" /> Call Back
                  </a>
                </Button>
                <Button variant="outline" className="gap-2 h-11"
                  onClick={() => {
                    toast.info('Switch to Messages tab to send an SMS');
                    setSelectedCall(null);
                  }}>
                  <MessageSquare className="h-4 w-4" /> Send SMS
                </Button>
                {isUnknown && (
                  <>
                    <Button variant="outline" className="gap-2 h-11"
                      onClick={() => toast.info('Navigate to Leads to create a lead')}>
                      <UserPlus className="h-4 w-4" /> Create Lead
                    </Button>
                    <Button variant="outline" className="gap-2 h-11"
                      onClick={() => toast.info('Navigate to Customers to add')}>
                      <UserPlus className="h-4 w-4" /> Add Customer
                    </Button>
                  </>
                )}
              </div>
            </div>
          </div>
        </SheetContent>
      </Sheet>
    );
  };

  // ─── Filter Pills ────────────────────────────
  const filterTabs: { key: CallFilter; label: string }[] = [
    { key: 'all', label: 'All' },
    { key: 'incoming', label: 'Incoming' },
    { key: 'outgoing', label: 'Outgoing' },
    { key: 'missed', label: 'Missed' },
    { key: 'voicemails', label: 'Voicemails' },
  ];


  return (
    <div className="flex flex-col h-full">
      {/* Header with sync button */}
      <div className="px-4 pt-3 pb-2 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Badge variant="secondary" className="text-xs">{stats.total} calls</Badge>
          {stats.missed > 0 && (
            <Badge variant="destructive" className="text-xs">{stats.missed} missed</Badge>
          )}
        </div>
        <Button variant="ghost" size="sm" className="gap-2 min-h-[44px]" onClick={syncCalls} disabled={syncing}>
          {syncing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
          Sync
        </Button>
      </div>

      {/* Search */}
      <div className="px-4 pb-2">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search calls..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className={cn(
              "pl-10 h-9 rounded-xl border-0 focus-visible:ring-1 text-sm",
              isMobile ? "bg-[#E5E5EA]/60 dark:bg-[#3A3A3C]" : "bg-muted/50"
            )}
          />
        </div>
      </div>

      {/* Filter pills */}
      <div className="flex gap-2 px-4 py-2 overflow-x-auto no-scrollbar">
        {filterTabs.map(tab => (
          <button
            key={tab.key}
            onClick={() => { setActiveFilter(tab.key); hapticImpact('light'); }}
            className={cn(
              "px-3 py-1.5 rounded-full text-xs font-medium transition-all whitespace-nowrap",
              activeFilter === tab.key
                ? "bg-primary text-primary-foreground shadow-sm"
                : isMobile
                  ? "bg-[#E5E5EA] dark:bg-[#3A3A3C] text-[#3C3C43] dark:text-[#EBEBF5]"
                  : "bg-secondary text-secondary-foreground hover:bg-secondary/80"
            )}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Call list */}
      <div className="flex-1 overflow-y-auto">
        {loading ? (
          <div className="flex items-center justify-center p-12">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        ) : filteredCalls.length === 0 ? (
          <div className="flex flex-col items-center justify-center p-12 text-center">
            <Phone className="h-12 w-12 text-muted-foreground/30 mb-4" />
            <p className="text-sm text-muted-foreground">
              {calls.length === 0 ? 'No calls synced yet. Tap Sync to pull from OpenPhone.' : 'No calls match your filter.'}
            </p>
          </div>
        ) : (
          <div>
            {filteredCalls.map(call => {
              const isMissed = call.status === 'missed' || call.status === 'no-answer';
              return (
                <button
                  key={call.id}
                  onClick={() => handleSelectCall(call)}
                  className={cn(
                    "w-full flex items-center gap-3 px-4 py-3 transition-colors text-left",
                    isMobile
                      ? "active:bg-[#E5E5EA] dark:active:bg-[#2C2C2E]"
                      : "hover:bg-muted/50"
                  )}
                >
                  {/* Avatar */}
                  <Avatar className="h-10 w-10 shrink-0">
                    <AvatarFallback className={cn(
                      "text-xs font-semibold",
                      isMissed ? "bg-destructive/10 text-destructive" : "bg-primary/10 text-primary"
                    )}>
                      {getInitials(call.caller_name, call.caller_phone)}
                    </AvatarFallback>
                  </Avatar>

                  {/* Call info */}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className={cn(
                        "text-sm font-medium truncate",
                        isMissed && "text-destructive"
                      )}>
                        {call.caller_name || call.caller_phone || 'Unknown'}
                      </span>
                    </div>
                    <div className="flex items-center gap-2 mt-0.5">
                      {getCallIcon(call)}
                      <span className="text-xs text-muted-foreground">
                        {getCallStatusLabel(call)} • {formatDuration(call.duration)}
                      </span>
                      {call.has_voicemail && (
                        <Voicemail className="h-3 w-3 text-muted-foreground" />
                      )}
                      {call.has_transcript && (
                        <FileText className="h-3 w-3 text-muted-foreground" />
                      )}
                    </div>
                  </div>

                  {/* Time & chevron */}
                  <div className="flex items-center gap-1 shrink-0">
                    <span className="text-xs text-muted-foreground">
                      {formatCallTime(call.started_at, orgTz)}
                    </span>
                    <ChevronRight className="h-4 w-4 text-muted-foreground/50" />
                  </div>
                </button>
              );
            })}
          </div>
        )}
      </div>

      {/* Call Detail Drawer */}
      {renderCallDetail()}
    </div>
  );
}
