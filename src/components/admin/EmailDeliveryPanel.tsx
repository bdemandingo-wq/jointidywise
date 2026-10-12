import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { CheckCircle2 } from 'lucide-react';
import { formatDistanceToNow } from 'date-fns';
import { useOrgEmailHealth } from '@/hooks/useOrgEmailHealth';
import { isHardFailure } from '@/lib/emailFailureClassification';

export function EmailDeliveryPanel() {
  const { canView, recentFailures, isLoading, isError } = useOrgEmailHealth();
  if (!canView) return null;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Email delivery</CardTitle>
        <CardDescription>Customer emails that failed to send in the last 7 days.</CardDescription>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <p className="text-sm text-muted-foreground">Loading…</p>
        ) : isError ? (
          <p className="text-sm text-destructive">Could not load email delivery. This is not the same as “no failures.”</p>
        ) : recentFailures.length === 0 ? (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <CheckCircle2 className="h-4 w-4 text-green-500" />
            No recent email delivery failures.
          </div>
        ) : (
          <div className="space-y-3">
            {recentFailures.map((f) => (
              <div key={f.id} className="rounded-lg border border-destructive/20 bg-destructive/5 p-3 text-sm">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="truncate font-medium">{f.subject || '(no subject)'}</p>
                    <p className="truncate text-xs text-muted-foreground">to {f.recipient || 'unknown'}</p>
                  </div>
                  <span className="whitespace-nowrap text-xs text-muted-foreground">
                    {formatDistanceToNow(new Date(f.created_at), { addSuffix: true })}
                  </span>
                </div>
                <p className="mt-1 break-words text-xs text-destructive">{f.error_message || 'Unknown error'}</p>
                <div className="mt-1.5 flex flex-wrap gap-1.5">
                  <Badge variant="outline" className="text-[10px]">via {f.method}</Badge>
                  {f.fell_back_to && (
                    <Badge variant="outline" className="text-[10px]">
                      {isHardFailure(f)
                        ? `fell back to ${f.fell_back_to}, also failed`
                        : `fell back to ${f.fell_back_to} (likely delivered)`}
                    </Badge>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
