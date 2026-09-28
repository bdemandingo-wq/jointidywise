import { Phone, MapPin, User, Navigation, MapPinned, ClipboardList, Clock } from 'lucide-react';
import type { CleanerPayResult } from '@/lib/wageCalculation';
import { describeCleanerPay } from '@/lib/wageCalculation';
import { bookingStatusBadge, jobActionLabel } from '@/lib/bookingStatus';
import { Button } from './Button';
import { Card, CardTitle, Eyebrow, Skeleton } from './Card';
import { DetailHeader } from './DetailHeader';
import { InfoRow } from './InfoRow';
import { InverseCard } from './Card';
import { NoteWell } from './NoteWell';
import { StatusBadge } from './StatusBadge';
import { formatTimestampWithZone } from '@/lib/timezoneUtils';

/**
 * Screen 3a's presentation, with no data fetching in it.
 *
 * Split out of StaffJobDetailPage so the states that are hard or destructive to
 * reproduce against live data — missing pay, a deactivated cleaner, a booking
 * with no address, a team job with a pay share — can be rendered from fixtures
 * and actually looked at. A state nobody has ever seen is not verified, and
 * three of those four do not occur on demand in real data while the fourth
 * would mean deactivating a real person to look at a screen.
 */

export type JobDetailMode =
  | 'ready'
  | 'loading'
  | 'error'
  /* Offline with nothing cached. Distinct from 'error' because there is
     nothing to retry against, and distinct from 'noStaff' because the
     cleaner's record is fine — this device just cannot reach it. */
  | 'offline'
  | 'notFound'
  | 'deactivated'
  | 'noStaff';

export type JobDetailJob = {
  booking_number: number | null;
  scheduled_at: string | null;
  duration: number | null;
  status: string;
  address: string | null;
  city: string | null;
  state: string | null;
  zip_code: string | null;
  /** Already resolved to per-org LABELS by the caller via extrasToLabels().
   *  Raw `extras` is a Json array of SLUGS and labels vary per org, so a view
   *  that stringifies them renders "inside_oven" instead of "Inside oven". */
  extraLabels: string[];
  notes: string | null;
  customer_notes: string | null;
  cleaner_checkin_at: string | null;
  cleaner_checkout_at: string | null;
  customer: { first_name: string | null; last_name: string | null } | null;
  service: { name: string | null } | null;
};

const MONEY = (n: number) => n.toLocaleString('en-US', { style: 'currency', currency: 'USD' });

/* Both formatters pass an explicit timeZone, which is what
   local/no-device-local-dates asks for — the ban is on toLocale* WITHOUT one. */
const timeLabel = (iso: string, tz: string) =>
  formatTimestampWithZone(iso, tz);
const dayLabel = (iso: string, tz: string) =>
  new Date(iso).toLocaleDateString('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    timeZone: tz,
  });

function Shell({
  title,
  sub,
  badge,
  onBack,
  children,
}: {
  title: string;
  sub?: string;
  badge?: { tone: 'info' | 'success' | 'warn' | 'danger'; label: string };
  onBack?: () => void;
  children: React.ReactNode;
}) {
  return (
    <main className="portal-v2 flex min-h-dvh flex-col bg-[hsl(var(--pv-bg))]">
      <DetailHeader title={title} sub={sub} badge={badge} onBack={onBack} />
      <div className="flex flex-1 flex-col gap-3 px-5 pb-8">{children}</div>
    </main>
  );
}

export function JobDetailView({
  mode,
  job,
  pay,
  team,
  orgTz,
  onBack,
  onRetry,
}: {
  mode: JobDetailMode;
  job?: JobDetailJob | null;
  pay?: CleanerPayResult | null;
  team?: { pay_share: number | null; is_primary: boolean | null } | null;
  orgTz: string;
  onBack?: () => void;
  onRetry?: () => void;
}) {
  if (mode === 'deactivated') {
    return (
      <Shell title="Job" onBack={onBack}>
        <Card>
          <div role="alert">
            <CardTitle>Your access is paused</CardTitle>
            <p className="mt-2 text-[12.5px] font-semibold leading-[1.5] text-[hsl(var(--pv-ink-2))]">
              Your staff account is not active, so job details are hidden. Nothing has
              been deleted. Ask your admin to reactivate you.
            </p>
          </div>
        </Card>
      </Shell>
    );
  }

  if (mode === 'noStaff') {
    return (
      <Shell title="Job" onBack={onBack}>
        <Card>
          <div role="alert">
            <CardTitle>No staff record</CardTitle>
            <p className="mt-2 text-[12.5px] font-semibold text-[hsl(var(--pv-ink-2))]">
              This account isn&rsquo;t set up as a cleaner.
            </p>
          </div>
        </Card>
      </Shell>
    );
  }

  if (mode === 'offline') {
    return (
      <Shell title="Job" onBack={onBack}>
        <Card>
          <div role="status">
            <CardTitle>You&rsquo;re offline</CardTitle>
            <p className="mt-2 text-[12.5px] font-semibold leading-[1.5] text-[hsl(var(--pv-ink-2))]">
              This job is still assigned to you. It will load as soon as you have
              a signal again.
            </p>
          </div>
        </Card>
      </Shell>
    );
  }

  if (mode === 'error') {
    return (
      <Shell title="Job" onBack={onBack}>
        <Card>
          <div role="alert">
            <p className="text-[12.5px] font-semibold text-[hsl(var(--pv-ink-2))]">
              Couldn&rsquo;t load this job
            </p>
            <button
              type="button"
              onClick={onRetry}
              className="mt-1 text-[11.5px] font-bold text-[hsl(var(--pv-brand))] underline-offset-2 hover:underline"
            >
              Retry
            </button>
          </div>
        </Card>
      </Shell>
    );
  }

  if (mode === 'loading') {
    return (
      <Shell title="Job" onBack={onBack}>
        <InverseCard>
          <Eyebrow onInverse>Your pay</Eyebrow>
          <Skeleton onInverse className="mt-1.5 h-[30px] w-[132px]" />
        </InverseCard>
        <Card>
          <Skeleton className="h-3.5 w-1/3" />
          <div className="mt-3 flex flex-col gap-3">
            {[0, 1].map((i) => (
              <div key={i} className="flex items-center gap-3">
                <Skeleton className="h-7 w-7 rounded-full" />
                <div className="flex-1">
                  <Skeleton className="h-3 w-1/2" />
                  <Skeleton className="mt-1 h-2.5 w-1/3" />
                </div>
              </div>
            ))}
          </div>
        </Card>
      </Shell>
    );
  }

  if (mode === 'notFound' || !job) {
    return (
      <Shell title="Job" onBack={onBack}>
        <Card>
          <div className="py-4 text-center">
            <p className="text-[13px] font-bold text-[hsl(var(--pv-ink))]">
              This job isn&rsquo;t available
            </p>
            <p className="mt-1 text-[11.5px] font-normal text-[hsl(var(--pv-ink-3))]">
              It may have been cancelled or reassigned.
            </p>
            <button
              type="button"
              onClick={onBack}
              className="mt-2 text-[11.5px] font-bold text-[hsl(var(--pv-brand))] underline-offset-2 hover:underline"
            >
              Back to my jobs
            </button>
          </div>
        </Card>
      </Shell>
    );
  }

  const customerName = job.customer
    ? `${job.customer.first_name ?? ''} ${job.customer.last_name ?? ''}`.trim()
    : '';
  const addressLine = [job.address, job.city, job.state, job.zip_code].filter(Boolean).join(', ');
  const start = job.scheduled_at ? timeLabel(job.scheduled_at, orgTz) : null;
  const end =
    job.scheduled_at && job.duration
      ? timeLabel(
          new Date(new Date(job.scheduled_at).getTime() + job.duration * 60000).toISOString(),
          orgTz,
        )
      : null;
  const extras = job.extraLabels ?? [];
  const isTeam = !!team;
  const checkedIn = !!job.cleaner_checkin_at;
  const checkedOut = !!job.cleaner_checkout_at;
  /* The enum is a code, not a label — see lib/bookingStatus. */
  const statusBadge = bookingStatusBadge(job.status);
  /* Status leads, timestamps only refine `confirmed` — see jobActionLabel. */
  const actionLabel = jobActionLabel(job.status, { checkedIn, checkedOut });

  return (
    <Shell
      title={`#${job.booking_number ?? '—'} · ${job.service?.name ?? 'Cleaning'}`}
      sub={
        job.scheduled_at
          ? `${dayLabel(job.scheduled_at, orgTz)}${start ? ` · ${start}` : ''}${end ? ` – ${end}` : ''}`
          : 'Not scheduled'
      }
      badge={statusBadge}
      onBack={onBack}
    >
      <InverseCard>
        <div className="flex items-start gap-3">
          <Eyebrow onInverse>Your pay</Eyebrow>
          {isTeam && (
            <span className="ml-auto text-[10.5px] font-bold uppercase tracking-[0.06em] text-[hsl(var(--pv-on-inverse-muted))]">
              Team job
            </span>
          )}
        </div>

        {pay?.isMissingPay ? (
          /* §5.1 corrected: a third state. An admin has not set it — that is
             not a failed read, and it is certainly not $0.00. */
          <>
            <p className="mt-1 text-[17px] font-extrabold text-[hsl(var(--pv-on-inverse))]">
              Pay not set yet
            </p>
            <p className="mt-1 text-[11.5px] font-medium text-[hsl(var(--pv-on-inverse-muted))]">
              Your admin will confirm it before this job is paid out.
            </p>
          </>
        ) : (
          <>
            <p className="mt-0.5 text-[26px] font-extrabold leading-none tabular-nums text-[hsl(var(--pv-on-inverse))]">
              {MONEY(pay?.calculatedPay ?? 0)}
            </p>
            <p className="mt-1.5 text-[11.5px] font-medium text-[hsl(var(--pv-on-inverse-muted))]">
              {pay ? describeCleanerPay(pay) : ''}
              {isTeam && team?.is_primary ? ' · Lead' : ''}
            </p>
          </>
        )}
      </InverseCard>

      {(checkedIn || checkedOut) && (
        <Card>
          <CardTitle>Progress</CardTitle>
          <div className="mt-2.5 flex flex-col gap-2">
            <InfoRow
              icon={<Clock className="h-4 w-4" aria-hidden />}
              title="Checked in"
              sub={job.cleaner_checkin_at ? timeLabel(job.cleaner_checkin_at, orgTz) : 'Not yet'}
            />
            <InfoRow
              icon={<Clock className="h-4 w-4" aria-hidden />}
              title="Checked out"
              sub={job.cleaner_checkout_at ? timeLabel(job.cleaner_checkout_at, orgTz) : 'Not yet'}
            />
          </div>
        </Card>
      )}

      <Card>
        <CardTitle>Contact</CardTitle>
        <div className="mt-3 flex flex-col gap-3">
          <InfoRow
            icon={<User className="h-4 w-4" aria-hidden />}
            title={customerName || 'No customer on file'}
            sub={customerName ? 'Customer' : undefined}
          />
          <InfoRow
            icon={<Phone className="h-4 w-4" aria-hidden />}
            title="Customer phone"
            sub="Number hidden"
            action={{ label: 'Call', onClick: () => {} }}
          />
          <InfoRow
            icon={<MapPin className="h-4 w-4" aria-hidden />}
            title={addressLine || 'No address on file'}
            sub={addressLine ? undefined : 'Ask your admin to add one'}
            action={addressLine ? { label: 'Map', href: '#' } : undefined}
          />
        </div>
      </Card>

      {extras.length > 0 && (
        <Card>
          <CardTitle>Add-ons</CardTitle>
          <div className="mt-2.5 flex flex-wrap gap-1.5">
            {extras.map((e) => (
              <StatusBadge key={e} tone="info" label={e} />
            ))}
          </div>
        </Card>
      )}

      {job.notes && (
        <NoteWell tone="warn" label="Special instructions">
          {job.notes}
        </NoteWell>
      )}
      {job.customer_notes && (
        <NoteWell tone="info" label="From the customer">
          {job.customer_notes}
        </NoteWell>
      )}

      <Card>
        <CardTitle>Actions</CardTitle>
        <p className="mt-0.5 text-[10.5px] font-medium text-[hsl(var(--pv-ink-3))]">
          Full controls are on the My jobs card
        </p>
        <div className="mt-3 grid grid-cols-2 gap-2.5">
          <Button variant="primary" className="rounded-[10px]" icon={<Navigation className="h-4 w-4" aria-hidden />} onClick={onBack}>
            On the way
          </Button>
          <Button
            variant={addressLine ? 'secondary' : 'disabled-visible'}
            className="rounded-[10px]"
            icon={<MapPinned className="h-4 w-4" aria-hidden />}
          >
            Directions
          </Button>
          <Button variant="disabled-visible" className="rounded-[10px]">
            GPS check-in
          </Button>
          <Button variant="disabled-visible" className="rounded-[10px]" icon={<ClipboardList className="h-4 w-4" aria-hidden />}>
            Checklist
          </Button>
        </div>
        {actionLabel && (
          <Button variant="disabled-visible" size="lg" fullWidth className="mt-2.5">
            {actionLabel}
          </Button>
        )}
      </Card>
    </Shell>
  );
}
