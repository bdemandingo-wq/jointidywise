import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Search } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { supabase } from '@/lib/supabase';
import { useOrganization } from '@/contexts/OrganizationContext';

type Hit = { id: string; label: string; kind: 'Customer' | 'Booking' | 'Lead' | 'Campaign'; to: string };

function safeLike(raw: string): string {
  return `%${raw.replace(/[%_,]/g, '').trim()}%`;
}

export function AdminHeaderSearch({ className }: { className?: string }) {
  const { organization } = useOrganization();
  const navigate = useNavigate();
  const [q, setQ] = useState('');
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [hits, setHits] = useState<Hit[]>([]);
  const [failed, setFailed] = useState(false);
  const boxRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const query = q.trim();
    if (query.length < 2 || !organization?.id) {
      setHits([]);
      setFailed(false);
      setLoading(false);
      return;
    }
    let cancelled = false;
    const timer = window.setTimeout(async () => {
      setLoading(true);
      setFailed(false);
      const like = safeLike(query);
      const orgId = organization.id;
      try {
        const [customers, leads, campaigns, bookings] = await Promise.all([
          supabase.from('customers').select('id, first_name, last_name').eq('organization_id', orgId)
            .or(`first_name.ilike.${like},last_name.ilike.${like},email.ilike.${like},phone.ilike.${like}`)
            .order('id').limit(5),
          supabase.from('leads').select('id, name').eq('organization_id', orgId)
            .ilike('name', like)
            .order('id').limit(5),
          supabase.from('automated_campaigns').select('id, name').eq('organization_id', orgId)
            .ilike('name', like).order('id').limit(5),
          /^\d+$/.test(query)
            ? supabase.from('bookings').select('id, booking_number').eq('organization_id', orgId)
                .eq('booking_number', Number(query)).limit(5)
            : Promise.resolve({ data: [], error: null }),
        ]);
        if (cancelled) return;
        const errors = [customers.error, leads.error, campaigns.error, bookings.error].filter(Boolean);
        if (errors.length === 4) {
          setFailed(true);
          setHits([]);
          return;
        }
        const next: Hit[] = [];
        for (const row of customers.data ?? []) {
          next.push({
            id: row.id,
            kind: 'Customer',
            label: `${row.first_name ?? ''} ${row.last_name ?? ''}`.trim() || 'Customer',
            to: `/dashboard/customers?q=${encodeURIComponent(query)}`,
          });
        }
        for (const row of bookings.data ?? []) {
          next.push({
            id: row.id,
            kind: 'Booking',
            label: `Booking #${row.booking_number}`,
            to: `/dashboard/bookings?q=${encodeURIComponent(query)}`,
          });
        }
        for (const row of leads.data ?? []) {
          next.push({
            id: row.id,
            kind: 'Lead',
            label: row.name || 'Lead',
            to: `/dashboard/leads?q=${encodeURIComponent(query)}`,
          });
        }
        for (const row of campaigns.data ?? []) {
          next.push({
            id: row.id,
            kind: 'Campaign',
            label: row.name || 'Campaign',
            to: `/dashboard/campaigns?q=${encodeURIComponent(query)}`,
          });
        }
        setHits(next);
        setOpen(true);
      } catch {
        if (!cancelled) {
          setFailed(true);
          setHits([]);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }, 250);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [q, organization?.id]);

  useEffect(() => {
    const onDoc = (e: MouseEvent) => {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, []);

  return (
    <div className={className} ref={boxRef}>
      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
        <Input
          value={q}
          onChange={(e) => { setQ(e.target.value); setOpen(true); }}
          onFocus={() => q.trim().length >= 2 && setOpen(true)}
          placeholder="Search customers, bookings, leads…"
          aria-label="Search"
          className="w-60 pl-10 bg-secondary/50 border-0 focus-visible:ring-1"
        />
        {open && q.trim().length >= 2 && (
          <div className="absolute z-50 left-0 right-0 mt-1 bg-popover border border-border rounded-md shadow-lg max-h-80 overflow-auto">
            {loading && <p className="px-3 py-2 text-sm text-muted-foreground">Searching…</p>}
            {failed && <p className="px-3 py-2 text-sm text-destructive">Search failed. Try again.</p>}
            {!loading && !failed && hits.length === 0 && (
              <p className="px-3 py-2 text-sm text-muted-foreground">No matches</p>
            )}
            {hits.map((hit) => (
              <button
                key={`${hit.kind}-${hit.id}`}
                type="button"
                className="w-full text-left px-3 py-2 hover:bg-accent/60 flex items-center justify-between gap-3"
                onClick={() => {
                  setOpen(false);
                  navigate(hit.to);
                }}
              >
                <span className="text-sm truncate">{hit.label}</span>
                <span className="text-xs text-muted-foreground shrink-0">{hit.kind}</span>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
