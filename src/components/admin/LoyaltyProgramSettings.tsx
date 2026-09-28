import { useState, useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { toast } from 'sonner';
import { Gift, Star, Trophy, Crown, Users, TrendingUp, Award } from 'lucide-react';
import { format } from 'date-fns';
import { useOrganization } from '@/contexts/OrganizationContext';
import { LoyaltyTierEditor } from './LoyaltyTierEditor';
import { useAdminOrgTiers } from '@/hooks/useAdminOrgTiers';
import { resolveTierName } from '@/lib/loyaltyTier';
import { QueryError } from '@/components/QueryError';
import { OrgTimestamp } from '@/components/OrgTimestamp';

interface CustomerLoyalty {
  id: string;
  customer_id: string;
  points: number;
  lifetime_points: number;
  tier: string;
  customer: {
    first_name: string;
    last_name: string;
    email: string;
  } | null;
}

interface LoyaltyTransaction {
  id: string;
  customer_id: string;
  points: number;
  transaction_type: string;
  description: string | null;
  created_at: string;
}

export function LoyaltyProgramSettings() {
  const queryClient = useQueryClient();
  const { organization } = useOrganization();
  const organizationId = organization?.id;
  const [selectedCustomer, setSelectedCustomer] = useState<CustomerLoyalty | null>(null);
  const [bonusPoints, setBonusPoints] = useState('');

  // error is consumed, not discarded. Without it a failed get_org_tiers renders
  // identically to an org where nobody has earned a tier: every badge reads
  // "No tier yet" and both stat cards read 0. The hook throws correctly; the
  // consumer has to say so.
  const { tiers: orgTiers, tierDefs, error: tiersError } = useAdminOrgTiers();

  const { data: loyaltyMembers = [], isLoading, error: membersError } = useQuery({
    queryKey: ['loyalty-members', organizationId],
    queryFn: async () => {
      if (!organizationId) return [];
      const { data, error } = await supabase
        .from('customer_loyalty')
        .select(`
          id, customer_id, points, lifetime_points, tier, lifetime_spend,
          customer:customers!inner(first_name, last_name, email, organization_id)
        `)
        .eq('customer.organization_id', organizationId)
        .order('lifetime_points', { ascending: false });

      if (error) throw error;
      return data as CustomerLoyalty[];
    },
    enabled: !!organizationId,
  });

  const { data: recentTransactions = [], error: transactionsError } = useQuery({
    queryKey: ['loyalty-transactions-recent', organizationId],
    queryFn: async () => {
      if (!organizationId) return [];
      // Get customer IDs for this org first, then filter transactions
      const { data: customers } = await supabase
        .from('customers')
        .select('id')
        .eq('organization_id', organizationId);
      
      const customerIds = customers?.map(c => c.id) || [];
      if (customerIds.length === 0) return [];
      
      const { data, error } = await supabase
        .from('loyalty_transactions')
        .select('*')
        .in('customer_id', customerIds)
        .order('created_at', { ascending: false })
        .limit(20);

      if (error) throw error;
      return data as LoyaltyTransaction[];
    },
    enabled: !!organizationId,
  });

  const addBonusPoints = useMutation({
    mutationFn: async ({ customerId, points }: { customerId: string; points: number }) => {
      // organization_id was previously omitted here. loyalty_transactions has an
      // INSERT policy using is_org_member(organization_id), and
      // is_org_member(NULL) is false, so this insert should be rejected with
      // 42501 — meaning this button was very likely failing outright. It fails
      // cleanly rather than half-applying: this insert runs first and throws
      // below, before customer_loyalty is touched.
      const { error: txError } = await supabase
        .from('loyalty_transactions')
        .insert({
          customer_id: customerId,
          organization_id: organizationId,
          points,
          transaction_type: 'bonus',
          description: 'Bonus points awarded by admin',
        });

      if (txError) throw txError;

      const { data: current, error: fetchError } = await supabase
        .from('customer_loyalty')
        .select('points, lifetime_points')
        .eq('customer_id', customerId)
        .single();

      if (fetchError) throw fetchError;

      // tier is deliberately NOT written here.
      //
      // It used to be set from calculateTier(lifetime_points), which hardcoded
      // 500/2000/5000 point thresholds and ignored client_tier_settings — so for
      // the 29 orgs with their own dollar thresholds this wrote the wrong tier,
      // and worse, it OVERWROTE the one-time correction the 3.1 migration applied
      // to 153 customers. Every bonus award silently undid part of that fix.
      //
      // Tier is now derived: resolve_customer_tier(customer_id) server-side, from
      // lifetime_spend against the org's own thresholds. Bonus points are not
      // spending, so they must not move anyone's tier at all.
      const { error: updateError } = await supabase
        .from('customer_loyalty')
        .update({
          points: (current?.points || 0) + points,
          lifetime_points: (current?.lifetime_points || 0) + points,
        })
        .eq('customer_id', customerId);

      if (updateError) throw updateError;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['loyalty-members'] });
      queryClient.invalidateQueries({ queryKey: ['loyalty-transactions-recent'] });
      toast.success('Bonus points added!');
      setBonusPoints('');
      setSelectedCustomer(null);
    },
    onError: () => {
      toast.error('Failed to add bonus points');
    },
  });

  // Tiers ascending by threshold, so index 0 is the entry tier.
  const ascendingTiers = useMemo(
    () => [...(orgTiers ?? [])].sort((a, b) => a.min_spending - b.min_spending),
    [orgTiers],
  );

  /** A member's tier, DERIVED from lifetime spend against this org's own
   *  thresholds — not read from the frozen customer_loyalty.tier column, which
   *  no trigger maintains any more. Null is a real state: below the lowest
   *  threshold, or tiers not loaded yet. */
  const tierOf = (m: CustomerLoyalty): string | null =>
    resolveTierName((m as unknown as { lifetime_spend: number | null }).lifetime_spend, tierDefs);

  // Icon by POSITION in this org's ladder, not by tier name. These used to
  // switch on 'platinum' | 'gold' | 'silver' with an orange-star default, so an
  // org that renamed its tiers got the same icon for every one of them.
  const RANK_ICONS = [Star, Award, Trophy, Crown];

  const getTierIcon = (tierName: string | null) => {
    const idx = ascendingTiers.findIndex(t => t.tier_name === tierName);
    const Icon = RANK_ICONS[Math.min(Math.max(idx, 0), RANK_ICONS.length - 1)];
    return <Icon className="w-4 h-4" />;
  };

  /** Badge tint from the tier's own configured colour. Tailwind classes cannot
   *  be built dynamically, so this is an inline style rather than a class. */
  const getTierStyle = (tierName: string | null): React.CSSProperties => {
    const c = ascendingTiers.find(t => t.tier_name === tierName)?.color;
    if (!c) return {};
    return { color: c, borderColor: c, backgroundColor: `${c}1a` };
  };

  // Top two tiers by threshold, with their REAL names. The two stat cards used
  // to filter for literal 'platinum' / 'gold', so any org with renamed tiers saw
  // 0 in both, permanently.
  const topTier = ascendingTiers[ascendingTiers.length - 1];
  const secondTier = ascendingTiers[ascendingTiers.length - 2];

  const countIn = (tierName: string | undefined) =>
    tierName ? loyaltyMembers.filter(m => tierOf(m) === tierName).length : 0;

  const stats = {
    totalMembers: loyaltyMembers.length,
    totalPoints: loyaltyMembers.reduce((sum, m) => sum + m.points, 0),
    topTierName: topTier?.tier_name ?? null,
    topTierMembers: countIn(topTier?.tier_name),
    secondTierName: secondTier?.tier_name ?? null,
    secondTierMembers: countIn(secondTier?.tier_name),
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
      </div>
    );
  }

  if (membersError || transactionsError) {
    return <QueryError subject="loyalty program data" />;
  }

  return (
    <div className="space-y-6">
      {tiersError && (
        <Card className="border-destructive/40 bg-destructive/5">
          <CardContent className="pt-6">
            <p className="text-sm font-medium text-destructive">
              Couldn't load this organisation's loyalty tiers.
            </p>
            <p className="text-xs text-muted-foreground mt-1">
              {tiersError.message} Member tiers and the counts below are unavailable —
              they are not zero, they are unknown.
            </p>
          </CardContent>
        </Card>
      )}

      {/* Stats */}
      <div className="grid gap-4 md:grid-cols-4">
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center">
                <Users className="w-5 h-5 text-primary" />
              </div>
              <div>
                <p className="text-2xl font-bold">{stats.totalMembers}</p>
                <p className="text-xs text-muted-foreground">Total Members</p>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-full bg-success/10 flex items-center justify-center">
                <Gift className="w-5 h-5 text-success" />
              </div>
              <div>
                <p className="text-2xl font-bold">{stats.totalPoints.toLocaleString()}</p>
                <p className="text-xs text-muted-foreground">Active Points</p>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-full bg-purple-100 flex items-center justify-center">
                <Crown className="w-5 h-5 text-purple-600" />
              </div>
              <div>
                <p className="text-2xl font-bold">{stats.topTierMembers}</p>
                <p className="text-xs text-muted-foreground">
                  {stats.topTierName ? `${stats.topTierName} Members` : 'Top Tier'}
                </p>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-full bg-amber-100 flex items-center justify-center">
                <Trophy className="w-5 h-5 text-amber-600" />
              </div>
              <div>
                <p className="text-2xl font-bold">{stats.secondTierMembers}</p>
                <p className="text-xs text-muted-foreground">
                  {stats.secondTierName ? `${stats.secondTierName} Members` : 'Next Tier'}
                </p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Tier Benefits Editor */}
      <LoyaltyTierEditor />

      {/* Members List */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Loyalty Members</CardTitle>
        </CardHeader>
        <CardContent>
          {loyaltyMembers.length === 0 ? (
            <div className="text-center py-8">
              <Gift className="w-12 h-12 mx-auto text-muted-foreground mb-3" />
              <p className="text-muted-foreground">No loyalty members yet</p>
              <p className="text-sm text-muted-foreground mt-1">
                Customers automatically join after their first completed booking
              </p>
            </div>
          ) : (
            <div className="space-y-3">
              {loyaltyMembers.map((member) => (
                <div 
                  key={member.id} 
                  className="flex flex-col gap-3 p-3 border rounded-lg hover:bg-muted/50 sm:flex-row sm:items-center sm:justify-between"
                >
                  <div className="flex items-start gap-3 min-w-0">
                    <Badge variant="outline" className="shrink-0" style={getTierStyle(tierOf(member))}>
                      {getTierIcon(tierOf(member))}
                      <span className="ml-1 capitalize">{tierOf(member) ?? 'No tier yet'}</span>
                    </Badge>
                    <div className="min-w-0">
                      <p className="font-medium truncate">
                        {member.customer?.first_name} {member.customer?.last_name}
                      </p>
                      <p className="text-xs text-muted-foreground truncate">{member.customer?.email}</p>
                    </div>
                  </div>
                  <div className="flex items-center justify-between gap-4 sm:justify-end">
                    <div className="text-left sm:text-right">
                      <p className="font-bold text-primary">{member.points.toLocaleString()} pts</p>
                      <p className="text-xs text-muted-foreground">
                        Lifetime: {member.lifetime_points.toLocaleString()}
                      </p>
                    </div>
                    <Button
                      variant="outline"
                      size="sm"
                      className="shrink-0"
                      onClick={() => setSelectedCustomer(member)}
                    >
                      Add Points
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Add Bonus Points Dialog */}
      {selectedCustomer && (
        <div className="fixed inset-0 bg-background/80 flex items-center justify-center z-50" onClick={() => setSelectedCustomer(null)}>
          <Card className="w-full max-w-md" onClick={(e) => e.stopPropagation()}>
            <CardHeader>
              <CardTitle>Add Bonus Points</CardTitle>
              <CardDescription>
                Add bonus points for {selectedCustomer.customer?.first_name} {selectedCustomer.customer?.last_name}
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div>
                <p className="text-sm text-muted-foreground mb-2">Current Points: {selectedCustomer.points}</p>
                <Input
                  type="text"
                  inputMode="numeric"
                  pattern="[0-9]*"
                  placeholder="Enter points to add"
                  value={bonusPoints}
                  onChange={(e) => setBonusPoints(e.target.value)}
                />
              </div>
              <div className="flex gap-2">
                <Button variant="outline" className="flex-1" onClick={() => setSelectedCustomer(null)}>
                  Cancel
                </Button>
                <Button 
                  className="flex-1"
                  onClick={() => addBonusPoints.mutate({
                    customerId: selectedCustomer.customer_id,
                    points: parseInt(bonusPoints) || 0
                  })}
                  disabled={!bonusPoints || addBonusPoints.isPending}
                >
                  Add Points
                </Button>
              </div>
            </CardContent>
          </Card>
        </div>
      )}

      {/* Recent Transactions */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Recent Transactions</CardTitle>
        </CardHeader>
        <CardContent>
          {recentTransactions.length === 0 ? (
            <p className="text-center text-muted-foreground py-4">No transactions yet</p>
          ) : (
            <div className="space-y-2">
              {recentTransactions.slice(0, 10).map((tx) => (
                <div key={tx.id} className="flex items-center justify-between text-sm py-2 border-b last:border-0">
                  <div>
                    <Badge variant="outline" className={
                      tx.transaction_type === 'earned' ? 'bg-success/10 text-success' :
                      tx.transaction_type === 'bonus' ? 'bg-info/10 text-info' :
                      tx.transaction_type === 'redeemed' ? 'bg-warning/10 text-warning' :
                      'bg-muted text-muted-foreground'
                    }>
                      {tx.transaction_type}
                    </Badge>
                    <span className="ml-2 text-muted-foreground">{tx.description}</span>
                  </div>
                  <div className="text-right">
                    <span className={tx.points >= 0 ? 'text-success font-medium' : 'text-destructive font-medium'}>
                      {tx.points >= 0 ? '+' : ''}{tx.points} pts
                    </span>
                    <p className="text-xs text-muted-foreground">
                      <OrgTimestamp value={tx.created_at} />
                    </p>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
