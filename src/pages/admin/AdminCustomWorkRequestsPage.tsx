import { useEffect, useState } from 'react';
import { AdminLayout } from '@/components/admin/AdminLayout';
import { SEOHead } from '@/components/SEOHead';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { Loader2 } from 'lucide-react';
import { OrgTimestamp } from '@/components/OrgTimestamp';

type Status =
  | 'submitted'
  | 'approved'
  | 'in_progress'
  | 'completed'
  | 'declined'
  | 'cancelled';

interface AdminRequestRow {
  id: string;
  organization_id: string;
  user_id: string;
  request_type: string;
  details: string | null;
  status: Status;
  declined_reason: string | null;
  admin_notes: string | null;
  submitted_at: string;
  fulfilled_at: string | null;
  billing_period_start: string;
  billing_period_end: string;
  // Joined organization name for display
  organization?: { name: string | null } | null;
}

const TYPE_LABEL: Record<string, string> = {
  website_build: 'Build me a website',
  sms_setup: 'Set up my SMS',
  email_marketing_setup: 'Set up email marketing',
  customer_import: 'Import my customers',
  scripts_documents_pack: 'Scripts & documents pack',
  something_else: 'Something else',
};

const STATUS_OPTIONS: { value: Status; label: string }[] = [
  { value: 'submitted', label: 'Submitted' },
  { value: 'approved', label: 'Approved' },
  { value: 'in_progress', label: 'In progress' },
  { value: 'completed', label: 'Completed' },
  { value: 'declined', label: 'Declined' },
  { value: 'cancelled', label: 'Cancelled' },
];

export default function AdminCustomWorkRequestsPage() {
  const [requests, setRequests] = useState<AdminRequestRow[] | null>(null);
  const [filterStatus, setFilterStatus] = useState<Status | 'all'>('all');
  const [editingNotes, setEditingNotes] = useState<Record<string, string>>({});
  const [editingDeclineReason, setEditingDeclineReason] = useState<
    Record<string, string>
  >({});
  const [savingId, setSavingId] = useState<string | null>(null);

  async function load() {
    const { data, error } = await (supabase as any)
      .from('custom_work_requests')
      .select('*, organization:organizations(name)')
      .order('submitted_at', { ascending: false })
      .limit(200);
    if (error) {
      toast.error(error.message);
      return;
    }
    setRequests((data as AdminRequestRow[]) ?? []);
  }

  useEffect(() => {
    load();
  }, []);

  async function updateRequest(id: string, status: Status) {
    setSavingId(id);
    try {
      const { data, error } = await supabase.functions.invoke(
        'update-custom-work-request',
        {
          body: {
            request_id: id,
            status,
            admin_notes: editingNotes[id] || undefined,
            declined_reason:
              status === 'declined' ? editingDeclineReason[id] : undefined,
          },
        },
      );
      if (error) throw error;
      if ((data as any)?.error) throw new Error((data as any).error);
      toast.success('Updated.');
      await load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Update failed.');
    } finally {
      setSavingId(null);
    }
  }

  const visible =
    filterStatus === 'all'
      ? requests
      : (requests ?? []).filter((r) => r.status === filterStatus);

  return (
    <AdminLayout title="Custom work requests">
<div className="portal-v2 portal-v2-scroll">
      <SEOHead
        title="Custom work requests | Admin"
        description="Triage and fulfill Custom-plan done-for-you requests."
        noIndex
      />

      <div className="space-y-4 max-w-5xl">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center justify-between">
              <span>Queue</span>
              <Select
                value={filterStatus}
                onValueChange={(v) => setFilterStatus(v as Status | 'all')}
              >
                <SelectTrigger className="w-44">
                  <SelectValue placeholder="Filter" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All</SelectItem>
                  {STATUS_OPTIONS.map((s) => (
                    <SelectItem key={s.value} value={s.value}>
                      {s.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </CardTitle>
          </CardHeader>
          <CardContent>
            {visible === null ? (
              <p className="text-sm text-muted-foreground">Loading...</p>
            ) : visible.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                No requests match this filter.
              </p>
            ) : (
              <div className="space-y-4">
                {visible.map((r) => (
                  <div key={r.id} className="border rounded-lg p-5 space-y-3">
                    <div className="flex items-start justify-between gap-4 flex-wrap">
                      <div>
                        <div className="flex items-center gap-2 mb-1 flex-wrap">
                          <span className="font-medium">
                            {TYPE_LABEL[r.request_type] ?? r.request_type}
                          </span>
                          <Badge variant="secondary">{r.status}</Badge>
                          {r.organization?.name && (
                            <Badge variant="outline">{r.organization.name}</Badge>
                          )}
                        </div>
                        <p className="text-xs text-muted-foreground">
                          Submitted <OrgTimestamp value={r.submitted_at} /> ·
                          Period{' '}
                          {/* eslint-disable-next-line local/no-device-local-dates -- viewer-local display of a stored instant */}
                          {new Date(r.billing_period_start).toLocaleDateString()} →{' '}
                          {/* eslint-disable-next-line local/no-device-local-dates -- viewer-local display of a stored instant */}
                          {new Date(r.billing_period_end).toLocaleDateString()}
                        </p>
                      </div>
                    </div>

                    {r.details && (
                      <div className="bg-muted/50 rounded p-3 text-sm italic">
                        "{r.details}"
                      </div>
                    )}

                    <div className="space-y-2">
                      <Textarea
                        placeholder="Admin notes (shown to the customer)"
                        value={editingNotes[r.id] ?? r.admin_notes ?? ''}
                        onChange={(e) =>
                          setEditingNotes((p) => ({ ...p, [r.id]: e.target.value }))
                        }
                        rows={2}
                      />
                      {(editingNotes[r.id] !== undefined || r.status === 'declined') && (
                        <Textarea
                          placeholder="Decline reason (only used when status is declined)"
                          value={editingDeclineReason[r.id] ?? r.declined_reason ?? ''}
                          onChange={(e) =>
                            setEditingDeclineReason((p) => ({
                              ...p,
                              [r.id]: e.target.value,
                            }))
                          }
                          rows={2}
                        />
                      )}
                    </div>

                    <div className="flex flex-wrap gap-2">
                      {STATUS_OPTIONS.filter((s) => s.value !== r.status).map((s) => (
                        <Button
                          key={s.value}
                          size="sm"
                          variant={
                            s.value === 'completed'
                              ? 'default'
                              : s.value === 'declined'
                                ? 'destructive'
                                : 'outline'
                          }
                          disabled={savingId === r.id}
                          onClick={() => updateRequest(r.id, s.value)}
                        >
                          {savingId === r.id ? (
                            <Loader2 className="h-3 w-3 animate-spin" />
                          ) : (
                            `Mark ${s.label}`
                          )}
                        </Button>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
</AdminLayout>
  );
}
