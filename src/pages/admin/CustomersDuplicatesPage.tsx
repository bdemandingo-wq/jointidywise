import { useEffect, useMemo, useState } from 'react';
import { QueryError } from '@/components/QueryError';
import { useNavigate } from 'react-router-dom';
import { useQuery, useQueryClient, useMutation } from '@tanstack/react-query';
import { format } from 'date-fns';
import { ArrowLeft, ArrowRight, Loader2, ShieldX, Sparkles, Star, Trash2 } from 'lucide-react';

import { AdminLayout } from '@/components/admin/AdminLayout';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { SEOHead } from '@/components/SEOHead';
import { supabase } from '@/lib/supabase';
import { useOrganization } from '@/contexts/OrganizationContext';
import { useAuth } from '@/hooks/useAuth';
import { toast } from 'sonner';
import { confirmDialog } from "@/components/AppDialogs";

// ── Types ────────────────────────────────────────────────────────────────────

interface Customer {
  id: string;
  organization_id: string;
  first_name: string | null;
  last_name: string | null;
  email: string | null;
  phone: string | null;
  address: string | null;
  city: string | null;
  state: string | null;
  zip_code: string | null;
  created_at: string;
}

type MatchReason = 'email' | 'phone' | 'name_zip';

interface DuplicatePair {
  pairKey: string;
  a: Customer;
  b: Customer;
  reasons: MatchReason[];
  confidence: 'high' | 'medium';
}

interface CustomerStats {
  total_bookings: number;
  total_revenue: number;
}

// ── Detection helpers ────────────────────────────────────────────────────────

const norm = (s: string | null | undefined) => (s ?? '').trim().toLowerCase();
const phoneDigits = (s: string | null | undefined) =>
  (s ?? '').replace(/\D/g, '').slice(-10);

function pairKeyFor(idA: string, idB: string): string {
  return idA < idB ? `${idA}:${idB}` : `${idB}:${idA}`;
}

function detectDuplicates(
  customers: Customer[],
  ignoredKeys: Set<string>,
): DuplicatePair[] {
  // Bucket by signal so we don't run an O(n²) full comparison.
  const emailBuckets = new Map<string, Customer[]>();
  const phoneBuckets = new Map<string, Customer[]>();
  const nameZipBuckets = new Map<string, Customer[]>();

  for (const c of customers) {
    const e = norm(c.email);
    if (e) {
      const arr = emailBuckets.get(e) ?? [];
      arr.push(c);
      emailBuckets.set(e, arr);
    }
    const p = phoneDigits(c.phone);
    if (p.length >= 10) {
      const arr = phoneBuckets.get(p) ?? [];
      arr.push(c);
      phoneBuckets.set(p, arr);
    }
    const fn = norm(c.first_name);
    const ln = norm(c.last_name);
    const z = norm(c.zip_code);
    if (fn && ln && z) {
      const key = `${fn}|${ln}|${z}`;
      const arr = nameZipBuckets.get(key) ?? [];
      arr.push(c);
      nameZipBuckets.set(key, arr);
    }
  }

  const pairMap = new Map<string, DuplicatePair>();
  const considerBucket = (bucket: Map<string, Customer[]>, reason: MatchReason) => {
    for (const arr of bucket.values()) {
      if (arr.length < 2) continue;
      for (let i = 0; i < arr.length; i++) {
        for (let j = i + 1; j < arr.length; j++) {
          const a = arr[i];
          const b = arr[j];
          const key = pairKeyFor(a.id, b.id);
          if (ignoredKeys.has(key)) continue;
          const existing = pairMap.get(key);
          if (existing) {
            if (!existing.reasons.includes(reason)) existing.reasons.push(reason);
          } else {
            pairMap.set(key, {
              pairKey: key,
              a,
              b,
              reasons: [reason],
              confidence: 'medium',
            });
          }
        }
      }
    }
  };
  considerBucket(emailBuckets, 'email');
  considerBucket(phoneBuckets, 'phone');
  considerBucket(nameZipBuckets, 'name_zip');

  // Confidence: HIGH if email or phone match. Drop name-only since the
  // name_zip bucket already requires zip too — that's MEDIUM. We never
  // bucket on name alone, so LOW (per spec) doesn't surface.
  for (const pair of pairMap.values()) {
    pair.confidence =
      pair.reasons.includes('email') || pair.reasons.includes('phone')
        ? 'high'
        : 'medium';
  }

  return Array.from(pairMap.values()).sort((a, b) => {
    if (a.confidence !== b.confidence) return a.confidence === 'high' ? -1 : 1;
    return 0;
  });
}

// Score a customer for "best to keep" — more bookings wins, then more recent
// activity, then more complete profile (more non-empty contact fields).
function profileCompleteness(c: Customer): number {
  return [c.email, c.phone, c.address, c.city, c.state, c.zip_code, c.first_name, c.last_name]
    .filter((v) => !!norm(v))
    .length;
}

function pickRecommendedPrimary(
  a: Customer,
  b: Customer,
  statsA: CustomerStats | undefined,
  statsB: CustomerStats | undefined,
): 'a' | 'b' {
  const ba = statsA?.total_bookings ?? 0;
  const bb = statsB?.total_bookings ?? 0;
  if (ba !== bb) return ba > bb ? 'a' : 'b';
  const ta = new Date(a.created_at).getTime();
  const tb = new Date(b.created_at).getTime();
  if (ta !== tb) return ta > tb ? 'a' : 'b';
  return profileCompleteness(a) >= profileCompleteness(b) ? 'a' : 'b';
}

// ── Page ─────────────────────────────────────────────────────────────────────

export default function CustomersDuplicatesPage() {
  const navigate = useNavigate();
  const { organization, isAdmin } = useOrganization();
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const orgId = organization?.id;
  const [confirmMerge, setConfirmMerge] = useState<{
    pair: DuplicatePair;
    primary: Customer;
    secondary: Customer;
  } | null>(null);

  // Load active (non-merged) customers for this org.
  const { data: customers = [], isLoading: loadingCustomers, error: customersError } = useQuery({
    queryKey: ['customers-for-dedupe', orgId],
    queryFn: async () => {
      if (!orgId) return [];
      const { data, error } = await supabase
        .from('customers')
        .select(
          'id, organization_id, first_name, last_name, email, phone, address, city, state, zip_code, created_at',
        )
        .eq('organization_id', orgId)
        .is('merged_into', null);
      if (error) throw error;
      return (data ?? []) as Customer[];
    },
    enabled: !!orgId && isAdmin,
    staleTime: 1000 * 30,
  });

  // Load ignored pairs so we don't re-surface them.
  const { data: ignoredPairs = [], error: ignoredPairsError } = useQuery({
    queryKey: ['customer-duplicate-ignored', orgId],
    queryFn: async () => {
      if (!orgId) return [];
      // Generated types may not include the new table yet; cast through any.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const db = supabase as any;
      const { data, error } = await db
        .from('customer_duplicate_ignored')
        .select('customer_a_id, customer_b_id')
        .eq('organization_id', orgId);
      if (error) throw error;
      return (data ?? []) as Array<{ customer_a_id: string; customer_b_id: string }>;
    },
    enabled: !!orgId && isAdmin,
    staleTime: 1000 * 30,
  });

  // Per-customer booking counts + revenue for the side-by-side comparison
  // cards. Same shape as the customers list page so users see consistent
  // numbers when they jump between the two surfaces.
  // NOTE: query data must be JSON-serializable — the app persists the
  // react-query cache, and a Map rehydrates as a plain object (crash:
  // "stats.get is not a function"). Return a record, derive the Map below.
  const { data: statsRecord = {}, error: statsError } = useQuery({
    queryKey: ['customer-stats-for-dedupe-v2', orgId],
    queryFn: async () => {
      if (!orgId) return {};
      const { data, error } = await supabase
        .from('bookings')
        .select('customer_id, total_amount')
        .eq('organization_id', orgId)
        .neq('status', 'cancelled');
      if (error) throw error;
      const rec: Record<string, CustomerStats> = {};
      for (const b of (data ?? []) as Array<{
        customer_id: string | null;
        total_amount: number | null;
      }>) {
        if (!b.customer_id) continue;
        const cur = rec[b.customer_id] ?? { total_bookings: 0, total_revenue: 0 };
        cur.total_bookings += 1;
        cur.total_revenue += Number(b.total_amount) || 0;
        rec[b.customer_id] = cur;
      }
      return rec;
    },
    enabled: !!orgId && isAdmin,
    staleTime: 1000 * 60,
  });

  const stats = useMemo(
    () => new Map<string, CustomerStats>(Object.entries(statsRecord)),
    [statsRecord],
  );

  const ignoredKeys = useMemo(() => {
    const s = new Set<string>();
    for (const p of ignoredPairs) {
      s.add(pairKeyFor(p.customer_a_id, p.customer_b_id));
    }
    return s;
  }, [ignoredPairs]);

  useEffect(() => {
    if (ignoredPairsError) toast.error('Failed to load ignored pairs');
    if (statsError) toast.error('Failed to load customer stats');
  }, [ignoredPairsError, statsError]);

  const pairs = useMemo(
    () => detectDuplicates(customers, ignoredKeys),
    [customers, ignoredKeys],
  );

  // #9: delete a duplicate record outright (typical for 0-booking dupes)
  // Multi-select delete: owner picks specific records via checkboxes.
  // Uses .select('id') on the delete so we can detect the silent-RLS case
  // where 0 rows are actually removed despite a "successful" request.
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const toggleSelected = (id: string) =>
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const bulkDeleteMutation = useMutation({
    mutationFn: async () => {
      if (!orgId) throw new Error('No org');
      const ids = [...selectedIds];
      if (ids.length === 0) return { deleted: 0, requested: 0 };
      const { data, error } = await supabase
        .from('customers')
        .delete()
        .in('id', ids)
        .eq('organization_id', orgId)
        .select('id');
      if (error) throw error;
      return { deleted: (data || []).length, requested: ids.length };
    },
    onSuccess: ({ deleted, requested }) => {
      queryClient.invalidateQueries({ queryKey: ['customers'] });
      queryClient.invalidateQueries({ queryKey: ['customer-duplicates', orgId] });
      setSelectedIds(new Set());
      if (deleted === 0 && requested > 0) {
        toast.error(
          'Delete was blocked. No rows were removed. The customers table is likely missing a DELETE policy for org admins.',
        );
      } else if (deleted < requested) {
        toast.warning(`${deleted} of ${requested} deleted. The rest have bookings/invoices or were blocked.`);
      } else {
        toast.success(`${deleted} ${deleted === 1 ? 'record' : 'records'} deleted`);
      }
    },
    onError: (err: Error) => {
      toast.error(
        err.message?.includes('violates foreign key')
          ? 'Some records have bookings or invoices. Merge those instead of deleting.'
          : err.message || 'Delete failed',
      );
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (customer: Customer) => {
      if (!orgId) throw new Error('No org');
      const { data, error } = await supabase
        .from('customers')
        .delete()
        .eq('id', customer.id)
        .eq('organization_id', orgId)
        .select('id');
      if (error) throw error;
      if ((data || []).length === 0) {
        throw new Error('Delete was blocked. The customers table needs a DELETE policy for org admins.');
      }
      return customer;
    },
    onSuccess: (customer) => {
      queryClient.invalidateQueries({ queryKey: ['customers'] });
      queryClient.invalidateQueries({ queryKey: ['customer-duplicates', orgId] });
      toast.success(`${customer.first_name} ${customer.last_name} deleted`);
    },
    onError: (err: Error) => {
      toast.error(
        err.message?.includes('violates foreign key')
          ? 'This customer has bookings or invoices. Merge instead of deleting.'
          : err.message || 'Failed to delete customer',
      );
    },
  });

  const ignoreMutation = useMutation({    mutationFn: async (pair: DuplicatePair) => {
      if (!orgId || !user?.id) throw new Error('No org/user');
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const db = supabase as any;
      const { error } = await db.from('customer_duplicate_ignored').insert({
        organization_id: orgId,
        customer_a_id: pair.a.id,
        customer_b_id: pair.b.id,
        ignored_by: user.id,
      });
      if (error) throw error;
      return pair;
    },
    onSuccess: (pair) => {
      queryClient.invalidateQueries({ queryKey: ['customer-duplicate-ignored', orgId] });
      toast.success('Pair ignored', {
        duration: 5000,
        action: {
          label: 'Undo',
          onClick: async () => {
            try {
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              const db = supabase as any;
              const { error } = await db
                .from('customer_duplicate_ignored')
                .delete()
                .eq('organization_id', orgId)
                .eq('customer_a_id', pair.a.id)
                .eq('customer_b_id', pair.b.id);
              if (error) throw error;
              queryClient.invalidateQueries({ queryKey: ['customer-duplicate-ignored', orgId] });
              toast.success('Restored. Pair will show again.');
            } catch (err) {
              toast.error('Failed to undo');
              console.error(err);
            }
          },
        },
      });
    },
    onError: (err: Error) => toast.error(err.message ?? 'Failed to ignore pair'),
  });

  const mergeMutation = useMutation({
    mutationFn: async (args: { primary: Customer; secondary: Customer }) => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const db = supabase as any;
      const { primary, secondary } = args;

      // Snapshot the secondary's owned records BEFORE the merge so we can
      // reverse it if the admin clicks Undo.
      const [bookingsRes, recurringRes, quotesRes, locationsRes, notesRes, refRes1, refRes2,
             secPortalRes, priPortalRes] =
        await Promise.all([
          db.from('bookings').select('id').eq('customer_id', secondary.id),
          db.from('recurring_bookings').select('id').eq('customer_id', secondary.id),
          db.from('quotes').select('id').eq('customer_id', secondary.id),
          db.from('locations').select('id').eq('customer_id', secondary.id),
          db.from('property_notes').select('id').eq('customer_id', secondary.id),
          db.from('referrals').select('id').eq('referrer_customer_id', secondary.id),
          db.from('referrals').select('id').eq('referred_customer_id', secondary.id),
          // Portal logins for BOTH customers. merge_customers decides what to do
          // with the secondary's login purely from whether the primary already
          // has one, so that branch is knowable before the RPC runs — which is
          // just as well, because the RPC returns only COUNTS (portal_moved /
          // portal_deactivated) and unmerge_customers needs the row ID.
          //
          // UNIQUE (customer_id) means at most one row each, hence maybeSingle().
          db.from('client_portal_users').select('id').eq('customer_id', secondary.id).maybeSingle(),
          db.from('client_portal_users').select('id').eq('customer_id', primary.id).maybeSingle(),
        ]);

      // Mirror merge_customers' branch (20260731125520):
      //   secondary has a login, primary does NOT -> the login is MOVED
      //   secondary has a login, primary ALSO has -> the login is DEACTIVATED
      //   secondary has no login                  -> nothing happens
      const secondaryPortalId: string | null = secPortalRes.data?.id ?? null;
      const primaryHasPortal = !!priPortalRes.data?.id;
      const predictedMovedId = secondaryPortalId && !primaryHasPortal ? secondaryPortalId : null;
      const predictedDeactivatedId = secondaryPortalId && primaryHasPortal ? secondaryPortalId : null;

      const snapshot = {
        primary_fields: {
          email: primary.email ?? '',
          phone: primary.phone ?? '',
          address: primary.address ?? '',
          city: primary.city ?? '',
          state: primary.state ?? '',
          zip_code: primary.zip_code ?? '',
        },
        booking_ids: (bookingsRes.data ?? []).map((r: { id: string }) => r.id),
        recurring_ids: (recurringRes.data ?? []).map((r: { id: string }) => r.id),
        quote_ids: (quotesRes.data ?? []).map((r: { id: string }) => r.id),
        location_ids: (locationsRes.data ?? []).map((r: { id: string }) => r.id),
        property_note_ids: (notesRes.data ?? []).map((r: { id: string }) => r.id),
        referrer_ids: (refRes1.data ?? []).map((r: { id: string }) => r.id),
        referred_ids: (refRes2.data ?? []).map((r: { id: string }) => r.id),
        // Exact key names unmerge_customers reads (:248, :255). Null when the
        // branch did not apply; the RPC treats an absent/null key as a no-op.
        portal_user_moved_id: predictedMovedId,
        portal_user_deactivated_id: predictedDeactivatedId,
      };

      const { data, error } = await db.rpc('merge_customers', {
        primary_id: primary.id,
        secondary_id: secondary.id,
      });
      if (error) throw error;

      // Cross-check the prediction. A mismatch means the snapshot is wrong and
      // Undo will silently NOT restore the portal login.
      //
      // The known cause is permissions, not timing: merge_customers requires
      // is_org_admin (owner | admin | manager), but the RLS policy on
      // client_portal_users is role = ANY(ARRAY['admin','owner']) — and 'admin'
      // was retired on 2026-07-10, so it is effectively owner-only. A MANAGER can
      // therefore merge but cannot read that table, so both queries above return
      // nothing and the snapshot records no portal id while the RPC really did
      // move one. Detected here rather than discovered at Undo time.
      const portalResult = data as { portal_moved?: number; portal_deactivated?: number } | null;
      const rpcMoved = (portalResult?.portal_moved ?? 0) > 0;
      const rpcDeactivated = (portalResult?.portal_deactivated ?? 0) > 0;
      const snapshotIncomplete =
        (rpcMoved && !predictedMovedId) || (rpcDeactivated && !predictedDeactivatedId);

      if (snapshotIncomplete) {
        console.error(
          '[merge] Portal login was changed but no id was captured. Undo will not restore it.',
          { rpcMoved, rpcDeactivated, predictedMovedId, predictedDeactivatedId },
        );
      }

      return {
        result: data as { bookings_moved: number; recurring_moved: number; quotes_moved: number } | null,
        snapshot,
        primary_id: primary.id,
        secondary_id: secondary.id,
        snapshotIncomplete,
      };
    },
    onSuccess: ({ result, snapshot, primary_id, secondary_id, snapshotIncomplete }) => {
      const moved = (result?.bookings_moved ?? 0) + (result?.recurring_moved ?? 0);
      const invalidate = () => {
        queryClient.invalidateQueries({ queryKey: ['customers-for-dedupe', orgId] });
        queryClient.invalidateQueries({ queryKey: ['customers', orgId] });
        queryClient.invalidateQueries({ queryKey: ['customer-stats-for-dedupe', orgId] });
      };
      invalidate();
      setConfirmMerge(null);

      if (snapshotIncomplete) {
        toast.warning(
          "Merged, but this account could not record the customer's portal login. " +
          'Undo will restore everything except that login. Ask an owner to re-check it.',
          { duration: 12000 },
        );
      }

      toast.success(
        `Merged 2 customers. ${moved} booking${moved === 1 ? '' : 's'} transferred.`,
        {
          duration: 5000,
          action: {
            label: 'Undo',
            onClick: async () => {
              try {
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                const db = supabase as any;
                const { error } = await db.rpc('unmerge_customers', {
                  primary_id,
                  secondary_id,
                  snapshot,
                });
                if (error) throw error;
                invalidate();
                toast.success('Merge undone. Customer restored.');
              } catch (err: unknown) {
                const msg = err instanceof Error ? err.message : 'Failed to undo merge';
                toast.error(msg);
                console.error(err);
              }
            },
          },
        },
      );
    },
    onError: (err: Error) => {
      toast.error(err.message ?? 'Merge failed');
      setConfirmMerge(null);
    },
  });

  if (!isAdmin) {
    return (
      <AdminLayout title="Duplicates" subtitle="Admin only">
<div className="portal-v2 portal-v2-scroll">
        <SEOHead title="Duplicates | TidyWise" description="Admin-only duplicate review" noIndex />
        <Card>
          <CardContent className="pt-6 text-sm text-muted-foreground">
            This page is restricted to org owners and admins.
          </CardContent>
        </Card>
      </div>
</AdminLayout>
    );
  }

  return (
    <AdminLayout
      title="Duplicate Customers"
      subtitle={`${pairs.length} potential ${pairs.length === 1 ? 'duplicate' : 'duplicates'}`}
      actions={
        <div className="flex gap-2">
          {selectedIds.size > 0 && (
            <Button
              variant="outline"
              size="sm"
              className="text-destructive hover:text-destructive"
              disabled={bulkDeleteMutation.isPending}
              onClick={() => {
                void confirmDialog(`Delete ${selectedIds.size} selected ${selectedIds.size === 1 ? 'record' : 'records'}? This cannot be undone.`).then((ok) => {
                  if (ok) bulkDeleteMutation.mutate();
                });
              }}
            >
              {bulkDeleteMutation.isPending ? <Loader2 className="w-4 h-4 mr-1.5 animate-spin" /> : <Trash2 className="w-4 h-4 mr-1.5" />}
              Delete selected ({selectedIds.size})
            </Button>
          )}
          <Button variant="outline" size="sm" onClick={() => navigate('/dashboard/customers')}>
            <ArrowLeft className="w-4 h-4 mr-2" />
            Back to customers
          </Button>
        </div>
      }
    >
<div className="portal-v2 portal-v2-scroll">
      <SEOHead title="Duplicate Customers | TidyWise" description="Review and merge duplicate customers" noIndex />

      {loadingCustomers ? (
        <div className="flex items-center justify-center py-16">
          <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
        </div>
      ) : customersError ? (
        <QueryError subject="duplicate customers" onRetry={() => window.location.reload()} />
      ) : pairs.length === 0 ? (
        <Card>
          <CardContent className="pt-10 pb-10 text-center space-y-2">
            <Sparkles className="w-8 h-8 mx-auto text-primary" />
            <p className="font-semibold">No duplicates detected</p>
            <p className="text-sm text-muted-foreground">
              We compared every customer's email, phone, and name+zip and didn't find any matches.
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-4">
          {pairs.map((pair) => (
            <DuplicatePairCard
              key={pair.pairKey}
              pair={pair}
              statsA={stats.get(pair.a.id)}
              statsB={stats.get(pair.b.id)}
              onMerge={(primary, secondary) =>
                setConfirmMerge({ pair, primary, secondary })
              }
              onIgnore={() => ignoreMutation.mutate(pair)}
              selectedIds={selectedIds}
              onToggleSelected={toggleSelected}
              onDelete={(customer) => {
                void confirmDialog(`Delete ${customer.first_name} ${customer.last_name}? This cannot be undone.`).then((ok) => {
                  if (ok) deleteMutation.mutate(customer);
                });
              }}
              ignoring={ignoreMutation.isPending}
            />
          ))}
        </div>
      )}

      <AlertDialog
        open={!!confirmMerge}
        onOpenChange={(open) => !open && setConfirmMerge(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Merge customers?</AlertDialogTitle>
            <AlertDialogDescription>
              {confirmMerge && (
                <>
                  All bookings, quotes, recurring schedules, and notes from{' '}
                  <strong>
                    {confirmMerge.secondary.first_name} {confirmMerge.secondary.last_name}
                  </strong>{' '}
                  will move to{' '}
                  <strong>
                    {confirmMerge.primary.first_name} {confirmMerge.primary.last_name}
                  </strong>
                  . The secondary record is soft-deleted (audit history kept) but won't
                  appear in lists or counts. This action cannot be undone.
                </>
              )}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={mergeMutation.isPending}>
              Cancel
            </AlertDialogCancel>
            <AlertDialogAction
              disabled={mergeMutation.isPending}
              onClick={() => {
                if (!confirmMerge) return;
                mergeMutation.mutate({
                  primary: confirmMerge.primary,
                  secondary: confirmMerge.secondary,
                });
              }}
            >
              {mergeMutation.isPending && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
              Merge
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
</AdminLayout>
  );
}

// ── Pair card ────────────────────────────────────────────────────────────────

interface PairCardProps {
  pair: DuplicatePair;
  statsA: CustomerStats | undefined;
  statsB: CustomerStats | undefined;
  onMerge: (primary: Customer, secondary: Customer) => void;
  onIgnore: () => void;
  onDelete: (customer: Customer) => void;
  ignoring: boolean;
  selectedIds: Set<string>;
  onToggleSelected: (id: string) => void;
}

function DuplicatePairCard({
  pair,
  statsA,
  statsB,
  onMerge,
  onIgnore,
  onDelete,
  ignoring,
  selectedIds,
  onToggleSelected,
}: PairCardProps) {
  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between gap-2 flex-wrap">
          <div className="flex items-center gap-2">
            <CardTitle className="text-base">Possible match</CardTitle>
            <ConfidenceBadge confidence={pair.confidence} reasons={pair.reasons} />
          </div>
          <Button
            variant="ghost"
            size="sm"
            className="text-muted-foreground"
            onClick={onIgnore}
            disabled={ignoring}
          >
            <ShieldX className="w-4 h-4 mr-1.5" />
            These are different people, ignore
          </Button>
        </div>
      </CardHeader>
      <CardContent>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <CustomerCompareCard
            customer={pair.a}
            stats={statsA}
            otherCustomer={pair.b}
            reasons={pair.reasons}
            primaryLabel="Keep this one"
            mergeLabel={
              <>
                Merge into <ArrowRight className="w-4 h-4 ml-1.5 inline" />
              </>
            }
            onKeepThisOne={() => onMerge(pair.a, pair.b)}
            onDelete={() => onDelete(pair.a)}
            selected={selectedIds.has(pair.a.id)}
            onToggleSelected={() => onToggleSelected(pair.a.id)}
          />
          <CustomerCompareCard
            customer={pair.b}
            stats={statsB}
            otherCustomer={pair.a}
            reasons={pair.reasons}
            primaryLabel="Keep this one"
            mergeLabel={
              <>
                <ArrowLeft className="w-4 h-4 mr-1.5 inline" /> Merge into
              </>
            }
            onKeepThisOne={() => onMerge(pair.b, pair.a)}
            onDelete={() => onDelete(pair.b)}
            selected={selectedIds.has(pair.b.id)}
            onToggleSelected={() => onToggleSelected(pair.b.id)}
          />
        </div>
      </CardContent>
    </Card>
  );
}

function ConfidenceBadge({
  confidence,
  reasons,
}: {
  confidence: 'high' | 'medium';
  reasons: MatchReason[];
}) {
  const label = reasons
    .map((r) => (r === 'email' ? 'email' : r === 'phone' ? 'phone' : 'name + zip'))
    .join(', ');
  return (
    <Badge variant={confidence === 'high' ? 'default' : 'secondary'} className="gap-1.5">
      {confidence === 'high' ? 'High confidence' : 'Medium confidence'}
      <span className="text-xs opacity-80">· match: {label}</span>
    </Badge>
  );
}

function CustomerCompareCard({
  customer,
  stats,
  otherCustomer,
  reasons,
  primaryLabel,
  mergeLabel,
  onKeepThisOne,
  onDelete,
  selected,
  onToggleSelected,
}: {
  customer: Customer;
  stats: CustomerStats | undefined;
  otherCustomer: Customer;
  reasons: MatchReason[];
  primaryLabel: string;
  mergeLabel: React.ReactNode;
  onKeepThisOne: () => void;
  onDelete: () => void;
  selected: boolean;
  onToggleSelected: () => void;
}) {
  const sameField = (k: keyof Customer) =>
    norm(customer[k] as string | null) === norm(otherCustomer[k] as string | null) &&
    !!norm(customer[k] as string | null);

  const matchHints = {
    email: reasons.includes('email') && sameField('email'),
    phone:
      reasons.includes('phone') &&
      phoneDigits(customer.phone) === phoneDigits(otherCustomer.phone),
  };

  return (
    <div className="rounded-lg border bg-card p-4 space-y-2">
      <p className="font-semibold text-base">
        {customer.first_name} {customer.last_name}
      </p>
      <FieldLine label="Email" value={customer.email} highlight={matchHints.email} />
      <FieldLine label="Phone" value={customer.phone} highlight={matchHints.phone} />
      <FieldLine
        label="Address"
        value={[customer.address, customer.city, customer.state, customer.zip_code]
          .filter(Boolean)
          .join(', ')}
      />
      <p className="text-xs text-muted-foreground pt-1">
        Created {format(new Date(customer.created_at), 'MMM d, yyyy')}
      </p>
      <div className="flex items-center justify-between pt-1 text-sm">
        <span>
          <strong>{stats?.total_bookings ?? 0}</strong>{' '}
          {(stats?.total_bookings ?? 0) === 1 ? 'booking' : 'bookings'}
        </span>
        <span className="text-muted-foreground">
          ${(stats?.total_revenue ?? 0).toFixed(0)} spent
        </span>
      </div>
      <div className="pt-3 border-t flex flex-col gap-2">
        <Button size="sm" onClick={onKeepThisOne} className="w-full">
          {primaryLabel}
        </Button>
        {/* Multi-select delete: check the records to remove, then use the
            "Delete selected" button in the page header. */}
        <label className="flex items-center justify-center gap-2 rounded-md border border-dashed px-3 py-2 text-sm cursor-pointer hover:bg-muted/50">
          <input
            type="checkbox"
            className="h-4 w-4 accent-destructive"
            checked={selected}
            onChange={onToggleSelected}
          />
          <span className={selected ? 'text-destructive font-medium' : 'text-muted-foreground'}>
            {selected ? 'Selected for deletion' : 'Select to delete'}
          </span>
        </label>
        <p className="text-xs text-muted-foreground text-center">
          {mergeLabel}
        </p>
      </div>
    </div>
  );
}

function FieldLine({
  label,
  value,
  highlight,
}: {
  label: string;
  value: string | null;
  highlight?: boolean;
}) {
  return (
    <div className="flex items-center gap-2 text-sm">
      <span className="w-16 text-muted-foreground text-xs uppercase tracking-wide shrink-0">
        {label}
      </span>
      <span className={highlight ? 'text-primary font-medium' : ''}>
        {value || <span className="text-muted-foreground italic">—</span>}
      </span>
      {highlight && (
        <Badge variant="outline" className="text-[10px] py-0 px-1.5 h-5">
          match
        </Badge>
      )}
    </div>
  );
}
