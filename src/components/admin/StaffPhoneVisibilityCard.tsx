import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { supabase } from '@/integrations/supabase/client';
import { useOrganization } from '@/contexts/OrganizationContext';

/** Org setting: whether cleaners may see/call customer phone numbers. Enforced in the database. */
export function StaffPhoneVisibilityCard() {
  const { organization } = useOrganization();
  const orgId = organization?.id;
  const qc = useQueryClient();
  const key = ['org-show-customer-phone-to-staff', orgId];

  const q = useQuery({
    queryKey: key,
    enabled: !!orgId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('organizations')
        .select('show_customer_phone_to_staff')
        .eq('id', orgId!)
        .single();
      if (error) throw error;
      return !!data.show_customer_phone_to_staff;
    },
  });

  const m = useMutation({
    mutationFn: async (value: boolean) => {
      const { error } = await supabase
        .from('organizations')
        .update({ show_customer_phone_to_staff: value })
        .eq('id', orgId!);
      if (error) throw error;
      return value;
    },
    onSuccess: (value) => {
      qc.setQueryData(key, value);
      toast.success(value ? 'Cleaners can now see customer phone numbers' : 'Customer phone numbers are hidden from cleaners');
    },
    onError: (e: Error) => toast.error(e.message || 'Could not save setting'),
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle>Cleaner privacy</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="flex items-start justify-between gap-4">
          <div className="space-y-1">
            <Label htmlFor="show-customer-phone">Show customer phone to cleaners</Label>
            <CardDescription>
              When off, cleaners cannot see or call customer phone numbers in the staff portal. Customer name and address remain visible.
            </CardDescription>
            {q.error && <p className="text-sm text-destructive">Could not load this setting.</p>}
          </div>
          <Switch
            id="show-customer-phone"
            className="shrink-0"
            checked={q.data ?? false}
            disabled={!orgId || q.isLoading || !!q.error || m.isPending}
            onCheckedChange={(v) => m.mutate(v)}
            aria-label="Show customer phone to cleaners"
          />
        </div>
      </CardContent>
    </Card>
  );
}
