import { useOrganization } from '@/contexts/OrganizationContext';
import { supabase } from '@/integrations/supabase/client';
import { useQuery } from '@tanstack/react-query';
import {
  countPaying,
  progressLabel,
  type SaasReferralStatus,
} from '@/lib/referralProgram';

export interface SaasReferralRow {
  id: string;
  status: SaasReferralStatus | string;
  block_reason: string | null;
  referred_email: string | null;
  referred_org_name: string | null;
  paid_at: string | null;
  created_at: string;
}

export interface SaasRewardRow {
  id: string;
  status: 'banked' | 'applied' | 'reversed' | string;
  months: number;
  reward_index: number;
  created_at: string;
}

export interface SaasReferralOverview {
  code: string | null;
  rows: SaasReferralRow[];
  rewards: SaasRewardRow[];
  payingCount: number;
  progressLabel: string;
  monthsEarned: number;
  monthsBanked: number;
}

/**
 * Reads for Settings → Refer & earn.
 *
 * referral_codes / referral_signups / referral_rewards are not in the
 * generated types yet. PostgREST does not consult TypeScript. Writes stay
 * on the service role.
 *
 * The result is plain JSON. The query cache is persisted, and a Map or Set
 * would rehydrate as {} and throw on the next .get().
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = supabase as any;

export function useSaasReferrals() {
  const { organization } = useOrganization();
  const orgId = organization?.id;

  return useQuery<SaasReferralOverview>({
    queryKey: ['saas-referrals', orgId],
    enabled: !!orgId,
    queryFn: async () => {
      const [codeRes, rowsRes, rewardsRes] = await Promise.all([
        db
          .from('referral_codes')
          .select('code')
          .eq('organization_id', orgId)
          .maybeSingle(),
        db
          .from('referral_signups')
          .select('id, status, block_reason, referred_email, referred_org_name, paid_at, created_at')
          .eq('referrer_org_id', orgId)
          .order('created_at', { ascending: false })
          .order('id', { ascending: false }),
        db
          .from('referral_rewards')
          .select('id, status, months, reward_index, created_at')
          .eq('organization_id', orgId)
          .order('reward_index', { ascending: false })
          .order('id', { ascending: false }),
      ]);

      if (codeRes.error) throw codeRes.error;
      if (rowsRes.error) throw rowsRes.error;
      if (rewardsRes.error) throw rewardsRes.error;

      const rows = (rowsRes.data ?? []) as SaasReferralRow[];
      const rewards = (rewardsRes.data ?? []) as SaasRewardRow[];
      const payingCount = countPaying(rows.map((row) => ({
        status: row.status,
        blockReason: row.block_reason,
      })));

      return {
        code: (codeRes.data?.code as string | undefined) ?? null,
        rows,
        rewards,
        payingCount,
        progressLabel: progressLabel(payingCount),
        monthsEarned: rewards.filter((row) => row.status === 'banked' || row.status === 'applied').length,
        monthsBanked: rewards.filter((row) => row.status === 'banked').length,
      };
    },
  });
}
