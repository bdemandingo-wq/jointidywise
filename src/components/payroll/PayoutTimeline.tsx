import { CheckCircle2, Clock, Landmark, Send, XCircle, Undo2 } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { cn } from '@/lib/utils';

export type PayoutStatus = 'pending' | 'paid' | 'failed' | 'reversed' | 'deposited';

export interface PayoutRecord {
  payment_method: string;
  paid_at: string;
  payout_status: PayoutStatus | null;
  expected_arrival_date: string | null;
  failure_reason: string | null;
}

const fmtDate = (d: string | Date) =>
  new Date(d).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });

/** Calendar date (YYYY-MM-DD) → label without timezone drift. */
const fmtDay = (ymd: string) => {
  const [y, m, d] = ymd.split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
};

function addBusinessDays(from: Date, n: number) {
  const d = new Date(from);
  let added = 0;
  while (added < n) {
    d.setDate(d.getDate() + 1);
    if (d.getDay() !== 0 && d.getDay() !== 6) added++;
  }
  return d;
}

export function expectedDepositLabel(p: PayoutRecord): string | null {
  if (p.payment_method !== 'stripe_transfer') return null;
  const s = p.payout_status ?? 'pending';
  if (s === 'failed' || s === 'reversed') return null;
  if (p.expected_arrival_date) {
    return `${s === 'deposited' ? 'Deposited' : 'Expected deposit'}: ${fmtDay(p.expected_arrival_date)}`;
  }
  if (s === 'deposited') return 'Deposited';
  return `Estimated deposit: ${fmtDate(addBusinessDays(new Date(p.paid_at), 2))} (2–3 business days)`;
}

const META: Record<PayoutStatus, { label: string; className: string }> = {
  pending: { label: 'Pending', className: 'bg-warning/10 text-warning border-warning/30' },
  paid: { label: 'On the way', className: 'bg-primary/10 text-primary border-primary/30' },
  deposited: { label: 'Deposited', className: 'bg-success/10 text-success border-success/30' },
  failed: { label: 'Failed', className: 'bg-destructive/10 text-destructive border-destructive/30' },
  reversed: { label: 'Reversed', className: 'bg-muted text-muted-foreground border-border' },
};

export function PayoutStatusBadge({ record }: { record: PayoutRecord }) {
  if (record.payment_method !== 'stripe_transfer') {
    return <Badge variant="outline" className={META.deposited.className}>Marked paid</Badge>;
  }
  const s = record.payout_status ?? 'pending';
  return <Badge variant="outline" className={META[s].className}>{META[s].label}</Badge>;
}

export function PayoutTimeline({ record }: { record: PayoutRecord }) {
  if (record.payment_method !== 'stripe_transfer') {
    return <p className="text-sm text-muted-foreground">Marked paid outside Stripe on {fmtDate(record.paid_at)}.</p>;
  }
  const s = record.payout_status ?? 'pending';
  const reached = s === 'deposited' ? 2 : s === 'paid' ? 1 : 0;
  const steps = [
    { key: 'pending', icon: Send, title: 'Sent', sub: fmtDate(record.paid_at) },
    { key: 'paid', icon: Clock, title: 'On the way to bank', sub: record.expected_arrival_date ? `Arrives ${fmtDay(record.expected_arrival_date)}` : 'Waiting for Stripe' },
    { key: 'deposited', icon: Landmark, title: 'Deposited', sub: expectedDepositLabel(record) ?? '' },
  ];
  const ended = s === 'failed' || s === 'reversed';

  return (
    <div className="space-y-3">
      <ol className="space-y-3">
        {steps.map((st, i) => {
          const done = !ended && i <= reached;
          const Icon = done ? CheckCircle2 : st.icon;
          return (
            <li key={st.key} className="flex items-start gap-3">
              <Icon className={cn('w-5 h-5 mt-0.5 shrink-0', done ? 'text-success' : 'text-muted-foreground/50')} />
              <div>
                <p className={cn('text-sm font-medium', !done && 'text-muted-foreground')}>{st.title}</p>
                {st.sub && <p className="text-xs text-muted-foreground">{st.sub}</p>}
              </div>
            </li>
          );
        })}
        {ended && (
          <li className="flex items-start gap-3">
            {s === 'failed'
              ? <XCircle className="w-5 h-5 mt-0.5 shrink-0 text-destructive" />
              : <Undo2 className="w-5 h-5 mt-0.5 shrink-0 text-muted-foreground" />}
            <div>
              <p className="text-sm font-medium">{s === 'failed' ? 'Failed' : 'Reversed'}</p>
              <p className="text-xs text-muted-foreground">
                {s === 'failed'
                  ? `${record.failure_reason || 'The bank rejected this payout.'} Check the bank details in the Payouts tab.`
                  : 'This transfer was pulled back. No money will be deposited.'}
              </p>
            </div>
          </li>
        )}
      </ol>
    </div>
  );
}

export function PayoutTimelinePopover({ record }: { record: PayoutRecord }) {
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button type="button" aria-label="View payout timeline" className="min-h-[44px] sm:min-h-0">
          <PayoutStatusBadge record={record} />
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-72">
        <PayoutTimeline record={record} />
      </PopoverContent>
    </Popover>
  );
}
