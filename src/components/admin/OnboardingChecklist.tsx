import { useNavigate } from 'react-router-dom';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Progress } from '@/components/ui/progress';
import { Button } from '@/components/ui/button';
import { Check, ChevronRight } from 'lucide-react';
import { useOnboardingChecklist } from '@/hooks/useOnboardingChecklist';
import { QueryError } from '@/components/QueryError';
import { cn } from '@/lib/utils';
import { useAuth } from '@/hooks/useAuth';
import { useOrganization } from '@/contexts/OrganizationContext';

// Login identities that should not see the new-owner checklist. Not the
// public support inbox — the first address is the platform owner's login.
const HIDE_CHECKLIST_EMAILS = ['support@tidywisecleaning.com', 'applereview@tidywise.com'];

export function OnboardingChecklist() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const { organization } = useOrganization();
  // This checklist belongs only to the person who created the business.
  // An invited teammate can hold an owner-level membership without being the
  // organization's actual owner and must never be asked to onboard it.
  // The seven live checks stay disabled for everyone else so they are not
  // part of the dashboard's first wave of requests.
  const email = user?.email?.toLowerCase() ?? '';
  const showChecklist = !!user
    && !!organization
    && organization.owner_id === user.id
    && !HIDE_CHECKLIST_EMAILS.includes(email);
  const { data: items = [], isLoading, isError, refetch } = useOnboardingChecklist(showChecklist);

  if (!showChecklist) return null;

  if (isLoading) return null;

  if (isError) {
    return (
      <Card className="border-destructive/30 mb-6" data-tour-id="setup-checklist">
        <CardHeader className="pb-3">
          <CardTitle className="text-lg">Complete your setup</CardTitle>
        </CardHeader>
        <CardContent>
          <QueryError subject="your setup checklist" onRetry={() => void refetch()} />
        </CardContent>
      </Card>
    );
  }

  if (items.length === 0) return null;

  const completedCount = items.filter(i => i.completed).length;
  const totalCount = items.length;
  const allComplete = completedCount === totalCount;

  // Hide once all complete
  if (allComplete) return null;

  const progressPercent = Math.round((completedCount / totalCount) * 100);

  return (
    <Card className="border-primary/20 bg-gradient-to-br from-primary/5 to-transparent mb-6" data-tour-id="setup-checklist">
      <CardHeader className="pb-3">
        <CardTitle className="text-lg flex items-center gap-2">
          🚀 Complete your setup
          <span className="text-sm font-normal text-muted-foreground ml-auto">
            {completedCount}/{totalCount} complete
          </span>
        </CardTitle>
        <Progress value={progressPercent} className="h-2 mt-2" />
      </CardHeader>
      <CardContent className="pt-0 space-y-2">
        {items.map((item) => (
          <button
            key={item.key}
            onClick={() => navigate(item.link)}
            className={cn(
              'w-full flex items-center gap-3 p-3 rounded-lg text-left transition-colors',
              item.completed
                ? 'bg-primary/5 opacity-60'
                : 'hover:bg-accent cursor-pointer'
            )}
          >
            <span className="text-xl flex-shrink-0">{item.icon}</span>
            <div className="flex-1 min-w-0">
              <p className={cn(
                'text-sm font-medium',
                item.completed && 'line-through text-muted-foreground'
              )}>
                {item.label}
              </p>
              {item.state === 'needs_attention' ? (
                <p className="text-xs text-amber-700 dark:text-amber-400">
                  {item.attention}
                </p>
              ) : (
                <p className="text-xs text-muted-foreground truncate">
                  {item.description}
                </p>
              )}
            </div>
            {item.completed ? (
              <Check className="w-5 h-5 text-primary flex-shrink-0" />
            ) : (
              <ChevronRight className="w-4 h-4 text-muted-foreground flex-shrink-0" />
            )}
          </button>
        ))}
      </CardContent>
    </Card>
  );
}
