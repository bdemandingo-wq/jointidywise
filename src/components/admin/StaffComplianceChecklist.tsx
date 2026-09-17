import { CheckCircle2, AlertCircle, Clock } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Progress } from '@/components/ui/progress';
import { useStaffCompliance, type ComplianceState, type StaffComplianceRow } from '@/hooks/useStaffCompliance';

export function ComplianceIcon({ status, className }: { status: ComplianceState; className?: string }) {
  if (status === 'complete') return <CheckCircle2 className={cn('w-3.5 h-3.5 text-green-500', className)} />;
  if (status === 'pending') return <Clock className={cn('w-3.5 h-3.5 text-yellow-500', className)} />;
  return <AlertCircle className={cn('w-3.5 h-3.5 text-destructive', className)} />;
}

function rowItems(row: StaffComplianceRow) {
  return [
    {
      key: 'profile',
      label: 'Profile',
      status: row.profileStatus,
      detail: row.missingProfileFields.length ? `Missing: ${row.missingProfileFields.join(', ')}` : 'Photo, phone and address on file',
    },
    {
      key: 'hours',
      label: 'Hours',
      status: row.hoursStatus,
      detail: row.hoursStatus === 'complete' ? 'Availability set' : 'No working hours set',
    },
    {
      key: 'docs',
      label: 'Documents',
      status: row.docsStatus,
      detail:
        row.docsStatus === 'complete'
          ? 'All required documents approved'
          : row.docsStatus === 'pending'
          ? `Awaiting approval: ${row.missingDocs.join(', ')}`
          : `Missing: ${row.missingDocs.join(', ')}`,
    },
    {
      key: 'sigs',
      label: 'Signatures',
      status: row.sigsStatus,
      detail:
        row.sigsRequired === 0
          ? 'No documents to sign'
          : `${row.sigsSigned}/${row.sigsRequired} signed`,
    },
    {
      key: 'payout',
      label: 'Payout',
      status: row.payoutStatus,
      detail:
        row.payoutStatus === 'complete'
          ? 'Payout account set up'
          : row.payoutStatus === 'pending'
          ? 'Payout setup started'
          : 'Not started',
    },
  ];
}

/** Per-staff onboarding checklist, shown inside the Edit Staff dialog. */
export function StaffComplianceChecklist({ staffId, organizationId }: { staffId: string; organizationId: string | null }) {
  const { data = [], isLoading } = useStaffCompliance(organizationId);
  const row = data.find((r) => r.id === staffId);

  if (isLoading || !row) return null;

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <span className="text-xs text-muted-foreground">{row.completed}/{row.total} complete</span>
        <span className="text-xs text-muted-foreground">{row.percentage}%</span>
      </div>
      <Progress value={row.percentage} className="h-1.5" />
      <div className="space-y-1.5 pt-1">
        {rowItems(row).map((item) => (
          <div key={item.key} className="flex items-start gap-2">
            <ComplianceIcon status={item.status} className="mt-0.5 flex-shrink-0" />
            <div className="min-w-0">
              <p className="text-sm leading-tight">{item.label}</p>
              <p className="text-xs text-muted-foreground">{item.detail}</p>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
