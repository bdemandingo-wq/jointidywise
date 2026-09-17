import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { ShieldCheck } from 'lucide-react';
import { cn } from '@/lib/utils';
import { QueryError } from '@/components/QueryError';
import { useStaffCompliance } from '@/hooks/useStaffCompliance';
import { ComplianceIcon } from '@/components/admin/StaffComplianceChecklist';

interface StaffComplianceDashboardProps {
  organizationId: string;
}

export function StaffComplianceDashboard({ organizationId }: StaffComplianceDashboardProps) {
  const { data: complianceData = [], isLoading, error: complianceError } = useStaffCompliance(organizationId);

  if (complianceError) return <QueryError subject="staff compliance data" />;
  if (isLoading) return null;
  if (!complianceData.length) return null;

  const fullyCompliant = complianceData.filter(s => s.percentage === 100).length;
  const overallPercent = Math.round(
    complianceData.reduce((sum, s) => sum + s.percentage, 0) / complianceData.length
  );

  const getInitials = (name: string) => name.split(' ').map(n => n[0]).join('').toUpperCase();

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="text-base flex items-center gap-2">
            <ShieldCheck className="w-4 h-4" />
            Staff Compliance
          </CardTitle>
          <Badge variant="outline" className={cn(
            'text-xs',
            overallPercent >= 80 ? 'text-green-500 border-green-500/30' : 'text-yellow-500 border-yellow-500/30'
          )}>
            {fullyCompliant}/{complianceData.length} ready
          </Badge>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        {complianceData.map((staff) => (
          <div key={staff.id} className="flex items-center gap-3 p-2 rounded-lg hover:bg-muted/50 transition-colors">
            <Avatar className="h-8 w-8 flex-shrink-0">
              <AvatarFallback className="text-xs">{getInitials(staff.name)}</AvatarFallback>
            </Avatar>

            <div className="flex-1 min-w-0">
              <div className="flex items-center justify-between mb-1">
                <p className="text-sm font-medium truncate">{staff.name}</p>
                <span className="text-xs text-muted-foreground ml-2">{staff.percentage}%</span>
              </div>
              <Progress value={staff.percentage} className="h-1.5 mb-1.5" />
              <div className="flex items-center gap-3 text-xs text-muted-foreground flex-wrap">
                <span className="flex items-center gap-1">
                  <ComplianceIcon status={staff.profileStatus} />
                  Profile
                </span>
                <span className="flex items-center gap-1">
                  <ComplianceIcon status={staff.hoursStatus} />
                  Hours
                </span>
                <span className="flex items-center gap-1">
                  <ComplianceIcon status={staff.docsStatus} />
                  Docs
                </span>
                <span className="flex items-center gap-1">
                  <ComplianceIcon status={staff.sigsStatus} />
                  Sigs
                </span>
                <span className="flex items-center gap-1">
                  <ComplianceIcon status={staff.payoutStatus} />
                  Payout
                </span>
              </div>
            </div>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}
