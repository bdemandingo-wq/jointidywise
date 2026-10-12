import { useEffect, useState } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { Badge } from '@/components/ui/badge';
import { Plus, Trash2, Send, ExternalLink, Loader2, Zap } from 'lucide-react';
import { toast } from 'sonner';
import { supabase } from '@/lib/supabase';
import { useOrganization } from '@/contexts/OrganizationContext';
import { useAuth } from '@/hooks/useAuth';
import { confirmDialog } from "@/components/AppDialogs";

const EVENT_TYPES = [
  { value: 'customer.created', label: 'New customer created' },
  { value: 'booking.created', label: 'Booking created' },
  { value: 'booking.completed', label: 'Booking completed' },
  { value: 'booking.cancelled', label: 'Booking cancelled' },
  { value: 'invoice.paid', label: 'Invoice paid' },
  { value: 'lead.created', label: 'New lead' },
  { value: 'estimate.sent', label: 'Estimate sent' },
  { value: 'review.received', label: 'Review received' },
];

interface Webhook {
  id: string;
  name: string;
  webhook_url: string;
  event_type: string;
  is_active: boolean;
  created_at: string;
}

export function ZapierWebhooksCard() {
  const { organization } = useOrganization();
  const { user } = useAuth();
  const [hooks, setHooks] = useState<Webhook[]>([]);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [testingId, setTestingId] = useState<string | null>(null);
  const [form, setForm] = useState({ name: '', webhook_url: '', event_type: EVENT_TYPES[0].value });

  const load = async () => {
    if (!organization?.id) return;
    setLoading(true);
    const { data, error } = await (supabase as any)
      .from('org_zapier_webhooks')
      .select('id,name,webhook_url,event_type,is_active,created_at')
      .eq('organization_id', organization.id)
      .order('created_at', { ascending: false });
    if (error) {
      toast.error('Failed to load Zapier webhooks');
    } else {
      setHooks((data ?? []) as Webhook[]);
    }
    setLoading(false);
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [organization?.id]);

  const handleCreate = async () => {
    if (!organization?.id) return;
    if (!form.name.trim() || !form.webhook_url.trim()) {
      toast.error('Name and webhook URL are required');
      return;
    }
    if (!/^https:\/\/hooks\.zapier\.com\/.+/i.test(form.webhook_url.trim())) {
      toast.error('Must be a Zapier webhook URL (https://hooks.zapier.com/...)');
      return;
    }
    setSaving(true);
    const { error } = await (supabase as any).from('org_zapier_webhooks').insert({
      organization_id: organization.id,
      name: form.name.trim(),
      webhook_url: form.webhook_url.trim(),
      event_type: form.event_type,
      created_by: user?.id ?? null,
    });
    setSaving(false);
    if (error) {
      toast.error(error.message || 'Failed to add webhook');
      return;
    }
    toast.success('Webhook added');
    setOpen(false);
    setForm({ name: '', webhook_url: '', event_type: EVENT_TYPES[0].value });
    load();
  };

  const toggleActive = async (hook: Webhook) => {
    const { error } = await (supabase as any)
      .from('org_zapier_webhooks')
      .update({ is_active: !hook.is_active })
      .eq('id', hook.id);
    if (error) {
      toast.error('Failed to update');
      return;
    }
    setHooks((prev) => prev.map((h) => (h.id === hook.id ? { ...h, is_active: !h.is_active } : h)));
  };

  const remove = async (id: string) => {
    if (!(await confirmDialog('Delete this webhook?'))) return;
    const { error } = await (supabase as any).from('org_zapier_webhooks').delete().eq('id', id);
    if (error) {
      toast.error('Failed to delete');
      return;
    }
    setHooks((prev) => prev.filter((h) => h.id !== id));
    toast.success('Webhook deleted');
  };

  const sendTest = async (hook: Webhook) => {
    if (!organization?.id) return;
    setTestingId(hook.id);
    try {
      const { data, error } = await supabase.functions.invoke('zapier-dispatch', {
        body: {
          organization_id: organization.id,
          event_type: hook.event_type,
          test_webhook_id: hook.id,
          payload: {
            test: true,
            sent_at: new Date().toISOString(),
            message: 'This is a test payload from your CRM',
          },
        },
      });
      if (error) throw error;
      const ok = (data as any)?.results?.[0]?.success;
      if (ok) toast.success('Test sent. Check your Zap run history.');
      else toast.error('Test sent but Zapier returned an error');
    } catch (e) {
      toast.error('Failed to send test');
    } finally {
      setTestingId(null);
    }
  };

  const labelFor = (v: string) => EVENT_TYPES.find((e) => e.value === v)?.label ?? v;

  return (
    <Card>
      <CardHeader className="flex flex-row items-start justify-between gap-4">
        <div>
          <CardTitle className="flex items-center gap-2">
            <Zap className="h-5 w-5 text-orange-500" />
            Zapier Webhooks
          </CardTitle>
          <CardDescription>
            Send CRM events to Zapier so you can connect Google Sheets, Slack, Mailchimp, and 6,000+
            other apps.{' '}
            <a
              href="https://zapier.com/apps/webhook/integrations"
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1 text-primary hover:underline"
            >
              Setup guide <ExternalLink className="h-3 w-3" />
            </a>
          </CardDescription>
        </div>
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild>
            <Button size="sm">
              <Plus className="h-4 w-4 mr-1" /> Add webhook
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Add Zapier webhook</DialogTitle>
              <DialogDescription>
                In Zapier, create a Zap with the "Webhooks by Zapier" trigger (Catch Hook), copy the
                URL it gives you, and paste it below.
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-3">
              <div className="space-y-1">
                <Label htmlFor="z-name">Name</Label>
                <Input
                  id="z-name"
                  placeholder="e.g. New customer → Google Sheet"
                  value={form.name}
                  onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                />
              </div>
              <div className="space-y-1">
                <Label htmlFor="z-url">Webhook URL</Label>
                <Input
                  id="z-url"
                  placeholder="https://hooks.zapier.com/hooks/catch/..."
                  value={form.webhook_url}
                  onChange={(e) => setForm((f) => ({ ...f, webhook_url: e.target.value }))}
                />
              </div>
              <div className="space-y-1">
                <Label>Event</Label>
                <Select
                  value={form.event_type}
                  onValueChange={(v) => setForm((f) => ({ ...f, event_type: v }))}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {EVENT_TYPES.map((e) => (
                      <SelectItem key={e.value} value={e.value}>
                        {e.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setOpen(false)}>
                Cancel
              </Button>
              <Button onClick={handleCreate} disabled={saving}>
                {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Add webhook'}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </CardHeader>
      <CardContent>
        {loading ? (
          <div className="py-8 flex justify-center text-muted-foreground">
            <Loader2 className="h-5 w-5 animate-spin" />
          </div>
        ) : hooks.length === 0 ? (
          <p className="text-sm text-muted-foreground py-6 text-center">
            No webhooks yet. Add one to start sending events to Zapier.
          </p>
        ) : (
          <div className="space-y-3">
            {hooks.map((h) => (
              <div
                key={h.id}
                className="flex items-center justify-between gap-3 rounded-lg border p-3"
              >
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <p className="font-medium truncate">{h.name}</p>
                    <Badge variant="secondary" className="shrink-0">
                      {labelFor(h.event_type)}
                    </Badge>
                  </div>
                  <p className="text-xs text-muted-foreground truncate mt-0.5">{h.webhook_url}</p>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <Switch checked={h.is_active} onCheckedChange={() => toggleActive(h)} />
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => sendTest(h)}
                    disabled={testingId === h.id}
                  >
                    {testingId === h.id ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <>
                        <Send className="h-4 w-4 mr-1" /> Test
                      </>
                    )}
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => remove(h.id)}>
                    <Trash2 className="h-4 w-4 text-destructive" />
                  </Button>
                </div>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
