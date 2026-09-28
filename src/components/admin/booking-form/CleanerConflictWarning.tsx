import { AlertTriangle, Clock, MapPin } from 'lucide-react';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { format, parseISO } from 'date-fns';
import { ConflictInfo } from '@/hooks/useCleanerConflicts';
import { OrgTimestamp } from '@/components/OrgTimestamp';

interface CleanerConflictWarningProps {
  cleanerName: string;
  conflicts: ConflictInfo[];
  overrideConflict: boolean;
  onOverrideChange: (checked: boolean) => void;
}

export function CleanerConflictWarning({
  cleanerName,
  conflicts,
  overrideConflict,
  onOverrideChange
}: CleanerConflictWarningProps) {
  if (conflicts.length === 0) return null;

  const hasOverlap = conflicts.some(c => c.overlapType === 'overlap');

  return (
    <Alert variant="destructive" className="border-destructive/50 bg-destructive/10">
      <AlertTriangle className="h-5 w-5" />
      <AlertTitle className="text-base font-semibold">
        Conflict Detected: {cleanerName} is already assigned
      </AlertTitle>
      <AlertDescription className="mt-3 space-y-3">
        <div className="space-y-2">
          {conflicts.map((conflict) => (
            <div 
              key={conflict.bookingId}
              className="flex items-start gap-3 p-2 bg-background/50 rounded-md border border-border/50"
            >
              <Badge 
                variant={conflict.overlapType === 'overlap' ? 'destructive' : 'secondary'}
                className="mt-0.5 shrink-0"
              >
                {conflict.overlapType === 'overlap' ? 'Overlap' : 'Too Close'}
              </Badge>
              <div className="flex-1 text-sm">
                <div className="font-medium">
                  Booking #{conflict.bookingNumber} - {conflict.customerName}
                </div>
                <div className="flex items-center gap-2 text-muted-foreground mt-1">
                  <Clock className="h-3 w-3" />
                  <OrgTimestamp value={conflict.scheduledAt} /> 
                  <span className="text-xs">
                    ({conflict.duration} min • {conflict.serviceName})
                  </span>
                </div>
                {conflict.overlapType === 'proximity' && (
                  <div className="flex items-center gap-2 text-amber-600 mt-1">
                    <MapPin className="h-3 w-3" />
                    <span className="text-xs">
                      Only {conflict.minutesApart} minutes between jobs (60 min travel buffer recommended)
                    </span>
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>

        <div className="flex items-center gap-3 pt-2 border-t border-border/50">
          <Checkbox 
            id="override-conflict" 
            checked={overrideConflict}
            onCheckedChange={(checked) => onOverrideChange(checked === true)}
          />
          <Label 
            htmlFor="override-conflict" 
            className="text-sm font-medium cursor-pointer text-foreground"
          >
            Ignore conflict and assign anyway
          </Label>
        </div>

        {!overrideConflict && (
          <p className="text-xs text-muted-foreground">
            You must either change the time/cleaner or check the override box to proceed.
          </p>
        )}
      </AlertDescription>
    </Alert>
  );
}
