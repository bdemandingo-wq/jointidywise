import { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ScrollArea } from '@/components/ui/scroll-area';
import { TabsContent } from '@/components/ui/tabs';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { CalendarCheck, Phone, Mail, Briefcase, Users, Loader2 } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { format, startOfMonth } from 'date-fns';
import { toast } from 'sonner';
import { orgStartOfMonth } from '@/lib/orgDateRange';
import { useOrgTimezone } from '@/hooks/useOrgTimezone';
import { QueryError } from '@/components/QueryError';
import { OrgTimestamp } from '@/components/OrgTimestamp';

interface DemoRequest {
  id: string;
  full_name: string;
  email: string;
  phone: string;
  business_name: string;
  team_size: string | null;
  biggest_challenge: string | null;
  preferred_days: string[] | null;
  preferred_time: string | null;
  status: string;
  notes: string | null;
  created_at: string;
}

const statusColors: Record<string, string> = {
  pending: 'bg-warning/10 text-warning',
  contacted: 'bg-info/10 text-info',
  booked: 'bg-info/10 text-info',
  converted: 'bg-success/10 text-success',
  not_interested: 'bg-destructive/10 text-destructive',
};

export function DemoRequestsTab() {
  // Demo counts are per BUSINESS month.
  const { timezone: orgTimezone } = useOrgTimezone();
  const queryClient = useQueryClient();
  const [editingNotes, setEditingNotes] = useState<string | null>(null);
  const [notesValue, setNotesValue] = useState('');

  const { data: demos = [], isLoading, error: demosError } = useQuery({
    queryKey: ['demo-requests'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('demo_requests' as any)
        .select('*')
        .order('created_at', { ascending: false });
      if (error) throw error;
      return (data || []) as unknown as DemoRequest[];
    },
  });

  const updateMutation = useMutation({
    mutationFn: async ({ id, updates }: { id: string; updates: Record<string, any> }) => {
      const { error } = await supabase
        .from('demo_requests' as any)
        .update(updates as any)
        .eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['demo-requests'] });
      toast.success('Updated');
    },
  });

  // created_at is an instant, so "this month" is the business's month.
  const thisMonth = demos.filter(d => new Date(d.created_at) >= orgStartOfMonth(new Date(), orgTimezone));
  const pending = demos.filter(d => d.status === 'pending');
  const converted = demos.filter(d => d.status === 'converted');
  const conversionRate = demos.length > 0 ? Math.round((converted.length / demos.length) * 100) : 0;

  if (demosError) {
    return (
      <TabsContent value="demos">
        <QueryError subject="demo requests" />
      </TabsContent>
    );
  }

  return (
    <TabsContent value="demos">
      <div className="space-y-4">
        {/* Stats */}
        <div className="grid grid-cols-3 gap-3">
          <Card>
            <CardContent className="p-4 text-center">
              <p className="text-2xl font-bold text-foreground">{thisMonth.length}</p>
              <p className="text-xs text-muted-foreground">This Month</p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-4 text-center">
              <p className="text-2xl font-bold text-warning">{pending.length}</p>
              <p className="text-xs text-muted-foreground">Pending Follow-ups</p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-4 text-center">
              <p className="text-2xl font-bold text-success">{conversionRate}%</p>
              <p className="text-xs text-muted-foreground">Conversion Rate</p>
            </CardContent>
          </Card>
        </div>

        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-lg flex items-center gap-2">
              <CalendarCheck className="w-5 h-5 text-primary" />
              Demo Requests
              <Badge variant="secondary" className="ml-auto">{demos.length} total</Badge>
            </CardTitle>
          </CardHeader>
          <CardContent>
            {isLoading ? (
              <div className="flex justify-center py-12"><Loader2 className="w-8 h-8 animate-spin text-primary" /></div>
            ) : demos.length === 0 ? (
              <div className="text-center py-12 text-muted-foreground">
                <CalendarCheck className="w-12 h-12 mx-auto mb-3 opacity-30" />
                <p>No demo requests yet</p>
              </div>
            ) : (
              <ScrollArea className="h-[500px] pr-4">
                <div className="space-y-3">
                  {demos.map((demo) => (
                    <div key={demo.id} className="p-4 bg-muted/50 rounded-lg border border-border space-y-3">
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <p className="font-semibold text-foreground">{demo.full_name}</p>
                          <p className="text-sm text-muted-foreground flex items-center gap-1">
                            <Briefcase className="w-3 h-3" /> {demo.business_name}
                          </p>
                        </div>
                        <Select
                          value={demo.status}
                          onValueChange={(val) => updateMutation.mutate({ id: demo.id, updates: { status: val } })}
                        >
                          <SelectTrigger className="w-36 h-8">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="pending">Pending</SelectItem>
                            <SelectItem value="contacted">Contacted</SelectItem>
                            <SelectItem value="booked">Booked</SelectItem>
                            <SelectItem value="converted">Converted</SelectItem>
                            <SelectItem value="not_interested">Not Interested</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                      <div className="flex flex-wrap gap-3 text-sm">
                        <a href={`tel:${demo.phone}`} className="flex items-center gap-1 text-primary hover:underline">
                          <Phone className="w-3 h-3" /> {demo.phone}
                        </a>
                        <a href={`mailto:${demo.email}`} className="flex items-center gap-1 text-primary hover:underline">
                          <Mail className="w-3 h-3" /> {demo.email}
                        </a>
                      </div>
                      <div className="flex flex-wrap gap-2 text-xs text-muted-foreground">
                        {demo.team_size && <Badge variant="outline">{demo.team_size}</Badge>}
                        {demo.biggest_challenge && <Badge variant="outline">{demo.biggest_challenge}</Badge>}
                        {demo.preferred_days?.length ? <Badge variant="outline">{demo.preferred_days.join(', ')}</Badge> : null}
                        {demo.preferred_time && <Badge variant="outline">{demo.preferred_time}</Badge>}
                        <OrgTimestamp className="ml-auto" value={demo.created_at} />
                      </div>
                      {/* Inline notes */}
                      {editingNotes === demo.id ? (
                        <div className="flex gap-2">
                          <Input
                            value={notesValue}
                            onChange={(e) => setNotesValue(e.target.value)}
                            placeholder="Add notes..."
                            className="h-8 text-sm"
                          />
                          <Button
                            size="sm"
                            onClick={() => {
                              updateMutation.mutate({ id: demo.id, updates: { notes: notesValue } });
                              setEditingNotes(null);
                            }}
                          >
                            Save
                          </Button>
                          <Button size="sm" variant="ghost" onClick={() => setEditingNotes(null)}>Cancel</Button>
                        </div>
                      ) : (
                        <button
                          onClick={() => { setEditingNotes(demo.id); setNotesValue(demo.notes || ''); }}
                          className="text-xs text-muted-foreground hover:text-foreground transition-colors"
                        >
                          {demo.notes || '+ Add notes'}
                        </button>
                      )}
                    </div>
                  ))}
                </div>
              </ScrollArea>
            )}
          </CardContent>
        </Card>
      </div>
    </TabsContent>
  );
}
