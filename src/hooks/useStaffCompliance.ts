import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';

export type ComplianceState = 'complete' | 'pending' | 'missing';

export interface StaffComplianceRow {
  id: string;
  name: string;
  email: string;
  profileStatus: ComplianceState;
  missingProfileFields: string[];
  hoursStatus: ComplianceState;
  docsStatus: ComplianceState;
  missingDocs: string[];
  sigsStatus: ComplianceState;
  sigsSigned: number;
  sigsRequired: number;
  payoutStatus: ComplianceState;
  completed: number;
  total: number;
  percentage: number;
}

const DOC_LABELS: Record<string, string> = {
  w9: 'W-9',
  id: 'Government ID',
};

/**
 * Single source of truth for staff onboarding compliance. Used by both the
 * Staff > Activity compliance grid and the per-staff checklist inside the
 * Edit Staff dialog so the two can never disagree.
 *
 * Kept fresh (staleTime 0 + refetch on mount/focus) because it reflects
 * actions taken elsewhere — document approval, payout onboarding, signatures.
 */
export function useStaffCompliance(organizationId: string | null | undefined) {
  return useQuery({
    queryKey: ['staff-compliance', organizationId],
    enabled: !!organizationId,
    staleTime: 0,
    refetchOnMount: 'always',
    refetchOnWindowFocus: true,
    queryFn: async (): Promise<StaffComplianceRow[]> => {
      const orgId = organizationId as string;
      const { data: staffList, error: staffError } = await supabase
        .from('staff')
        .select('id, name, email, phone, avatar_url, home_address, tax_classification')
        .eq('organization_id', orgId)
        .eq('is_active', true)
        .order('name');
      if (staffError) throw staffError;
      if (!staffList?.length) return [];

      const staffIds = staffList.map((s) => s.id);

      const [docsResult, sigsResult, payoutResult, availResult, signableDocsResult] = await Promise.all([
        supabase.from('staff_documents').select('staff_id, document_type, status').eq('organization_id', orgId).in('staff_id', staffIds),
        supabase.from('staff_signatures').select('staff_id, signable_document_id').in('staff_id', staffIds),
        supabase.from('staff_payout_accounts').select('staff_id, account_status, details_submitted, payouts_enabled').eq('organization_id', orgId).in('staff_id', staffIds),
        supabase.from('working_hours').select('staff_id').in('staff_id', staffIds),
        supabase.from('staff_signable_documents').select('id').eq('organization_id', orgId).eq('is_active', true),
      ]);

      if (docsResult.error) throw docsResult.error;
      if (sigsResult.error) throw sigsResult.error;
      if (payoutResult.error) throw payoutResult.error;
      if (availResult.error) throw availResult.error;
      if (signableDocsResult.error) throw signableDocsResult.error;

      const docs = docsResult.data || [];
      const sigs = sigsResult.data || [];
      const payouts = payoutResult.data || [];
      const avails = availResult.data || [];
      const signableDocs = signableDocsResult.data || [];

      const totalSignable = signableDocs.length;
      const signableIds = signableDocs.map((d) => d.id);

      return staffList
        .map((staff): StaffComplianceRow => {
          // Profile: phone, home address — photo is optional and must not block
          const missingProfileFields: string[] = [];
          if (!staff.phone) missingProfileFields.push('Phone');
          if (!staff.home_address) missingProfileFields.push('Home address');
          const profileStatus: ComplianceState = missingProfileFields.length === 0 ? 'complete' : 'missing';

          // Hours
          const hoursStatus: ComplianceState = avails.some((a) => a.staff_id === staff.id) ? 'complete' : 'missing';

          // Documents — required tax docs must be APPROVED in Document Review
          const isW2 = staff.tax_classification === 'w2';
          const requiredGroups: string[][] = isW2
            ? [['id', 'government_id']]
            : [['w9'], ['id', 'government_id']];
          const staffDocs = docs.filter((d) => d.staff_id === staff.id);
          const approvedGroups = requiredGroups.filter((group) =>
            staffDocs.some((d) => group.includes(d.document_type) && d.status === 'approved')
          );
          const uploadedGroups = requiredGroups.filter((group) =>
            staffDocs.some((d) => group.includes(d.document_type))
          );
          const docsComplete = approvedGroups.length >= requiredGroups.length;
          const docsStatus: ComplianceState = docsComplete
            ? 'complete'
            : uploadedGroups.length > 0
            ? 'pending'
            : 'missing';
          const missingDocs = requiredGroups
            .filter((g) => !approvedGroups.includes(g))
            .map((g) => DOC_LABELS[g[0]] ?? g[0]);

          // Signatures
          const staffSigs = sigs.filter(
            (s) => s.staff_id === staff.id && signableIds.includes(s.signable_document_id)
          );
          const sigsStatus: ComplianceState =
            totalSignable === 0 || staffSigs.length >= totalSignable ? 'complete' : 'missing';

          // Payouts — green as soon as the account is set up with Stripe
          const payout = payouts.find((p) => p.staff_id === staff.id);
          const payoutReady = !!payout && (
            payout.account_status === 'active' ||
            payout.payouts_enabled === true ||
            payout.details_submitted === true
          );
          const payoutStatus: ComplianceState = payoutReady ? 'complete' : payout ? 'pending' : 'missing';

          const checks = [profileStatus, hoursStatus, docsStatus, sigsStatus, payoutStatus];
          const total = checks.length;
          const completed = checks.filter((c) => c === 'complete').length;

          return {
            id: staff.id,
            name: staff.name,
            email: staff.email,
            profileStatus,
            missingProfileFields,
            hoursStatus,
            docsStatus,
            missingDocs,
            sigsStatus,
            sigsSigned: staffSigs.length,
            sigsRequired: totalSignable,
            payoutStatus,
            completed,
            total,
            percentage: Math.round((completed / total) * 100),
          };
        })
        .sort((a, b) => a.percentage - b.percentage);
    },
  });
}
